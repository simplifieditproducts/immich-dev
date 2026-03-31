<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/empty-placeholder.svelte';
  import ContactDetailModal from '$lib/modals/ContactDetailModal.svelte';
  import type { Contact, ContactsData } from '$lib/types';
  import { getInitials } from '$lib/utils/contact-utils';
  import { Icon } from '@immich/ui';
  import { mdiClose, mdiEmail, mdiMagnify, mdiPhone } from '@mdi/js';
  import { tick } from 'svelte';
  import { t } from 'svelte-i18n';
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

  let isScrubbing = $state(false);
  let activeHoverLetter = $state('');

  function scrollToLetter(letter: string) {
    const element = document.querySelector(`[data-letter-section="${letter}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'auto', block: 'start' });
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
</script>

{#snippet contactCard(contact: Contact)}
  <button
    type="button"
    class="flex w-full items-center gap-4 overflow-hidden p-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-immich-dark-gray/80 dark:active:bg-immich-dark-gray"
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
      <p class="font-medium text-immich-dark-bg dark:text-white">
        {contact.displayName}
      </p>

      {#if contact.organization || contact.title}
        <p class="truncate text-xs text-gray-400 dark:text-gray-500">
          {[contact.title, contact.organization].filter(Boolean).join(' · ')}
        </p>
      {/if}

      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
        {#if contact.phones.length > 0}
          <span class="flex items-center gap-1">
            <Icon icon={mdiPhone} size="14" />
            {contact.phones[0].value}
          </span>
        {/if}
        {#if contact.emails.length > 0}
          <span class="flex min-w-0 items-center gap-1">
            <Icon icon={mdiEmail} size="14" class="shrink-0" />
            <span class="truncate">{contact.emails[0].value}</span>
          </span>
        {/if}
      </div>
    </div>
  </button>
{/snippet}

<UserPageLayout title={data.meta.title} description={contactsData && contacts.length > 0 ? `(${contactsData.total})` : undefined}>
  {#snippet buttons()}
    {#if contactsData && contacts.length > 0}
      <div class="relative flex items-center justify-end">
        <button
          type="button"
          class="absolute z-10 text-gray-400 dark:text-gray-500
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
          class="rounded-lg border py-2 pl-8 pr-8 text-sm transition-all duration-300 ease-in-out
            {searchOpen
              ? 'w-56 border-gray-300 bg-white opacity-100 dark:border-gray-600 dark:bg-immich-dark-gray dark:text-white'
              : 'w-0 cursor-pointer border-transparent bg-transparent opacity-0'}"
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
    <EmptyPlaceholder text={$t('contacts_no_backup')} class="mt-10 mx-auto" />
  {:else if searchQuery && filteredContacts.length === 0}
    <EmptyPlaceholder text={$t('contacts_no_results')} class="mt-10 mx-auto" />
  {:else}
    <div class="relative flex">
      <div class="min-w-0 flex-1 px-4">
        {#each groupedContacts as group (group.letter)}
          <div data-letter-section={group.letter} class="mb-2">
            <div class="sticky -top-2 z-1 flex items-center gap-3 bg-white/60 py-1 backdrop-blur dark:bg-immich-dark-bg/90">
              <span class="text-sm font-semibold text-immich-primary dark:text-immich-dark-primary">{group.letter}</span>
              <div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
            </div>
            <div class="divide-y divide-gray-200 dark:divide-gray-700">
              {#each group.contacts as contact (contact.displayName + contact.phones[0]?.value)}
                {@render contactCard(contact)}
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <!-- Alphabet scrubber -->
      <div
        class="fixed sm:hidden right-0 top-1/2 z-20 flex -translate-y-1/2 touch-none flex-col items-center"
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
            class="flex h-4.5 w-6 select-none items-center justify-center text-[11px] font-semibold leading-none transition-colors
              {activeHoverLetter === letter
                ? 'scale-125 text-immich-primary dark:text-immich-dark-primary'
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
