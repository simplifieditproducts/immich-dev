<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import { appId } from '$lib/constants';
  import ContactDetailModal from '$lib/modals/ContactDetailModal.svelte';
  import type { Contact, ContactsData } from '$lib/types';
  import { getInitials } from '$lib/utils/contact-utils';
  import { Icon } from '@immich/ui';
  import { mdiAccountOffOutline, mdiClose, mdiMagnify } from '@mdi/js';
  import { tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteMap } from 'svelte/reactivity';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let contactsData = $derived(data.contacts as ContactsData | null);
  let contacts = $derived(contactsData?.contacts ?? []);

  let searchQuery = $state('');
  let searchOpen = $state(false);
  let searchInput: HTMLInputElement | undefined = $state();
  let selectedContact: Contact | null = $state(null);

  const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

  const CONTACT_HEIGHT = 56;
  const HEADER_HEIGHT = 36;
  const BUFFER = 10;

  let filteredContacts = $derived.by(() => {
    if (!searchQuery) {
      return contacts;
    }
    const query = searchQuery.toLowerCase();
    return contacts.filter((c) => {
      const fields = [c.displayName, c.firstName, c.lastName, c.organization, c.title, c.birthday, c.notes];
      return (
        fields.some((f) => f?.toLowerCase().includes(query)) ||
        c.phones.some((p) => p.value.includes(query)) ||
        c.emails.some((e) => e.value.toLowerCase().includes(query)) ||
        c.addresses.some(
          (a) =>
            [a.street, a.city, a.state, a.zip, a.country].some((f) => f?.toLowerCase().includes(query)),
        )
      );
    });
  });

  function getLetterForContact(contact: Contact): string {
    const first = contact.displayName.charAt(0).toUpperCase();
    return /[A-Z]/.test(first) ? first : '#';
  }

  // Assumes contacts are sorted by displayName from the server
  let groupedContacts = $derived.by(() => {
    const groups: { letter: string; contacts: Contact[] }[] = [];
    let currentLetter = '';
    for (const contact of filteredContacts) {
      const letter = getLetterForContact(contact);
      if (letter === currentLetter) {
        groups.at(-1)!.contacts.push(contact);
      } else {
        currentLetter = letter;
        groups.push({ letter, contacts: [contact] });
      }
    }
    return groups;
  });

  let activeLetters = $derived(new Set(groupedContacts.map((g) => g.letter)));

  // Virtual list: flatten groups into rows
  type VirtualRow =
    | { type: 'header'; letter: string; key: string }
    | { type: 'contact'; contact: Contact; key: string };

  let virtualRows = $derived.by(() => {
    const rows: VirtualRow[] = [];
    for (const group of groupedContacts) {
      rows.push({ type: 'header', letter: group.letter, key: `h-${group.letter}` });
      for (const contact of group.contacts) {
        rows.push({
          type: 'contact',
          contact,
          key: `c-${contact.displayName}-${contact.phones[0]?.value}`,
        });
      }
    }
    return rows;
  });

  let rowOffsets = $derived.by(() => {
    const offsets: number[] = [];
    let y = 0;
    for (const row of virtualRows) {
      offsets.push(y);
      y += row.type === 'header' ? HEADER_HEIGHT : CONTACT_HEIGHT;
    }
    return offsets;
  });

  let totalHeight = $derived(
    rowOffsets.length > 0
      ? rowOffsets.at(-1)! + (virtualRows.at(-1)!.type === 'header' ? HEADER_HEIGHT : CONTACT_HEIGHT)
      : 0,
  );

  let letterOffsets = $derived.by(() => {
    const map = new SvelteMap<string, number>();
    for (let i = 0; i < virtualRows.length; i++) {
      const row = virtualRows[i];
      if (row.type === 'header') {
        map.set(row.letter, rowOffsets[i]);
      }
    }
    return map;
  });

  let scrollContainer: HTMLElement | null = $state(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let scrollCleanup: (() => void) | null = null;

  function initScrollContainer(container: HTMLElement) {
    if (scrollCleanup) {
      return;
    }

    scrollContainer = container;
    viewportHeight = container.clientHeight;
    scrollTop = container.scrollTop;

    const handleScroll = () => {
      scrollTop = container.scrollTop;
      if (searchOpen && !searchQuery) {
        searchInput?.blur();
      }
    };

    const observer = new ResizeObserver((entries) => {
      viewportHeight = entries[0].contentRect.height;
    });

    container.addEventListener('scroll', handleScroll, { passive: true });
    observer.observe(container);

    scrollCleanup = () => {
      container.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }

  function findScrollContainer(from: HTMLElement): HTMLElement | null {
    return from.closest('#main-content') as HTMLElement | null
      ?? document.querySelector('#main-content') as HTMLElement | null;
  }

  let visibleRange = $derived.by(() => {
    if (rowOffsets.length === 0) {
      return { start: 0, end: 0 };
    }

    // Before the container is measured, render all rows
    if (viewportHeight === 0) {
      return { start: 0, end: rowOffsets.length - 1 };
    }

    // Binary search for first visible row
    let lo = 0;
    let hi = rowOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const height = virtualRows[mid].type === 'header' ? HEADER_HEIGHT : CONTACT_HEIGHT;
      if (rowOffsets[mid] + height <= scrollTop) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const start = Math.max(0, lo - BUFFER);

    const bottom = scrollTop + viewportHeight;
    let last = lo;
    while (last < rowOffsets.length && rowOffsets[last] < bottom) {
      last++;
    }
    const end = Math.min(rowOffsets.length - 1, last + BUFFER);

    return { start, end };
  });

  let visibleRows = $derived(
    virtualRows.slice(visibleRange.start, visibleRange.end + 1).map((row, i) => ({
      ...row,
      offset: rowOffsets[visibleRange.start + i],
    })),
  );

  let isScrubbing = $state(false);
  let activeHoverLetter = $state('');
  let listNode: HTMLElement | undefined;

  function scrollToLetter(letter: string) {
    if (!scrollContainer && listNode) {
      const container = findScrollContainer(listNode);
      if (container) {
        initScrollContainer(container);
      }
    }
    const offset = letterOffsets.get(letter);
    if (offset !== undefined) {
      scrollTop = offset;
      if (scrollContainer) {
        scrollContainer.scrollTop = offset;
      }
    }
  }

  function getLetterFromPointer(event: PointerEvent) {
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    return target?.dataset?.letter ?? '';
  }

  function handleScrubberPointerDown(event: PointerEvent) {
    event.preventDefault();
    isScrubbing = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const letter = getLetterFromPointer(event);
    if (letter && activeLetters.has(letter)) {
      activeHoverLetter = letter;
      scrollToLetter(letter);
    }
  }

  function handleScrubberPointerMove(event: PointerEvent) {
    if (!isScrubbing) {
      return;
    }
    event.preventDefault();
    const letter = getLetterFromPointer(event);
    if (letter && letter !== activeHoverLetter && activeLetters.has(letter)) {
      activeHoverLetter = letter;
      scrollToLetter(letter);
    }
  }

  function handleScrubberPointerUp() {
    isScrubbing = false;
    activeHoverLetter = '';
  }

  function setupScrollContainer(node: HTMLElement) {
    listNode = node;
    const container = findScrollContainer(node);
    if (container) {
      initScrollContainer(container);
    }
    return {
      destroy() {
        scrollCleanup?.();
        scrollCleanup = null;
        listNode = undefined;
      },
    };
  }
</script>

{#snippet contactCard(contact: Contact)}
  <button
    type="button"
    class="flex w-full select-none items-center gap-4 overflow-hidden rounded-lg px-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-immich-dark-gray/80 dark:active:bg-immich-dark-gray"
    style="height: {CONTACT_HEIGHT}px;"
    onclick={() => (selectedContact = contact)}
  >
    {#if contact.avatar}
      <img
        src={contact.avatar}
        alt={contact.displayName}
        class="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    {:else}
      <div
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-immich-primary/10 text-sm font-medium text-immich-primary dark:bg-immich-dark-primary/20 dark:text-immich-dark-primary"
      >
        {getInitials(contact.displayName)}
      </div>
    {/if}

    <div class="min-w-0 flex-1">
      <p class="truncate font-medium text-immich-dark-bg dark:text-white">
        {contact.displayName}
      </p>

      {#if contact.organization || contact.title}
        <p class="truncate text-xs text-gray-400 dark:text-gray-500">
          {[contact.title, contact.organization].filter(Boolean).join(' · ')}
        </p>
      {/if}

    </div>
  </button>
{/snippet}

<UserPageLayout title={data.meta.title} description={contactsData && contacts.length > 0 ? `(${contactsData.total})` : undefined}>
  {#snippet buttons()}
    {#if contactsData && contacts.length > 0}
      <div class="relative flex items-center justify-end">
        <button
          type="button"
          class="absolute z-1 text-gray-400 dark:text-gray-500
            {searchOpen ? 'left-2' : 'right-0'}"
          onclick={() => {
            if (!searchOpen) {
              searchOpen = true;
              void tick().then(() => searchInput?.focus());
            }
          }}
        >
          <Icon icon={mdiMagnify} size="22" />
        </button>
        <input
          bind:this={searchInput}
          type="text"
          placeholder="Search..."
          bind:value={searchQuery}
          onblur={() => { if (!searchQuery) { searchOpen = false; } }}
          class="rounded-lg border py-2 pl-8 pr-8 text-sm transition-[width,opacity] duration-300 ease-in-out
            {searchOpen
              ? 'w-56 border-gray-300 bg-white opacity-100 dark:border-gray-600 dark:bg-immich-dark-gray dark:text-white'
              : 'pointer-events-none w-0 cursor-pointer border-transparent bg-transparent opacity-0'}"
          tabindex={searchOpen ? 0 : -1}
        />
        {#if searchQuery}
          <button
            type="button"
            class="absolute right-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            onmousedown={(e: MouseEvent) => {
              e.preventDefault();
              searchQuery = '';
              searchInput?.focus();
            }}
          >
            <Icon icon={mdiClose} size="22" />
          </button>
        {/if}
      </div>
    {/if}
  {/snippet}

  {#if !contactsData || contacts.length === 0}
    <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
      <div class="flex flex-col content-center items-center text-center">
        <Icon icon={mdiAccountOffOutline} size="3.5em" />
        <p class="mt-5 text-3xl font-medium">No contacts available</p>
        <p class="text-base font-normal p-2">Subscribe to the KeepSafe service in the {appId === 'ultimatebackup' ? 'Ultimate Backup' : 'Picture Keeper Connect'} mobile app to view your contacts here.</p>
      </div>
    </div>
  {:else if searchQuery && filteredContacts.length === 0}
    <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
      <div class="flex flex-col content-center items-center text-center">
        <Icon icon={mdiAccountOffOutline} size="3.5em" />
        <p class="mt-5 text-3xl font-medium">No results found</p>
        <p class="text-base font-normal p-2">{$t('contacts_no_results')}</p>
      </div>
    </div>
  {:else}
    <div use:setupScrollContainer class="relative flex">
      <!-- Virtual list -->
      <div class="min-w-0 flex-1 px-3">
        <div style="height: {totalHeight}px; position: relative;">
          {#each visibleRows as row (row.key)}
            {#if row.type === 'header'}
              <div
                class="flex items-center gap-3 px-1 select-none"
                style="position: absolute; top: {row.offset}px; height: {HEADER_HEIGHT}px; left: 0; right: 0;"
              >
                <span class="text-sm font-semibold text-immich-primary dark:text-immich-dark-primary">{row.letter}</span>
                <div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
              </div>
            {:else}
              <div
                style="position: absolute; top: {row.offset}px; height: {CONTACT_HEIGHT}px; left: 0; right: 0;"
              >
                {@render contactCard(row.contact)}
              </div>
            {/if}
          {/each}
        </div>
      </div>

      <!-- Alphabet scrubber -->
      <div
        class="fixed sm:hidden right-0 top-[calc(50%+4rem)] z-2 flex -translate-y-1/2 touch-none flex-col items-center"
        role="navigation"
        aria-label="Alphabet scrubber"
        onpointerdown={handleScrubberPointerDown}
        onpointermove={handleScrubberPointerMove}
        onpointerup={handleScrubberPointerUp}
        onpointercancel={handleScrubberPointerUp}
      >
        {#each alphabet as letter (letter)}
          <button
            type="button"
            data-letter={letter}
            class="flex h-4.5 w-10 select-none items-center justify-center pl-5 text-[11px] font-semibold leading-none transition-colors
              {activeHoverLetter === letter
                ? 'origin-right scale-125 text-immich-primary dark:text-immich-dark-primary'
                : activeLetters.has(letter)
                  ? 'text-gray-600 dark:text-gray-300'
                  : 'text-gray-300 dark:text-gray-600'}"
            tabindex={-1}
          >
            {letter}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</UserPageLayout>

{#if selectedContact}
  <ContactDetailModal contact={selectedContact} onClose={() => (selectedContact = null)} />
{/if}
