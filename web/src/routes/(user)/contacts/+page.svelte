<script lang="ts">
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
  import ContactDetail from '$lib/components/contact-detail.svelte';
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/button-context-menu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/menu-option.svelte';
  import ControlAppBar from '$lib/components/shared-components/control-app-bar.svelte';
  import { QueryParameter } from '$lib/constants';
  import { contactsRevision } from '$lib/stores/contacts.store';
  import { embeddedInApp } from '$lib/stores/preferences.store';
  import {
    downloadAllContactsViaApp,
    downloadContactsViaApp,
    getInitials,
    shareContactsViaApp,
  } from '$lib/utils/contact-utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    type ContactDto,
    type ContactListItemDto,
    deleteContact,
    deleteContacts,
    exportContacts,
    getAllVcf,
    getContact,
    getContacts,
  } from '@immich/sdk';
  import { Icon, IconButton, modalManager } from '@immich/ui';
  import {
    mdiAccountOffOutline,
    mdiCheck,
    mdiClose,
    mdiDelete,
    mdiDotsVertical,
    mdiDownload,
    mdiExportVariant,
    mdiMagnify,
    mdiSelectAll,
    mdiSelectRemove,
    mdiShareVariantOutline,
  } from '@mdi/js';
  import { tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { get } from 'svelte/store';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Kevin: Only update `$embeddedInApp` if the `inApp` query parameter is present
  if (page.url.searchParams.has(QueryParameter.IN_APP)) {
    $embeddedInApp = ['1', 'true'].includes(page.url.searchParams.get(QueryParameter.IN_APP) || '');
  }

  const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

  // Fixed-height virtualization. With 3000+ contacts, rendering every row makes
  // selection toggles (select-all / deselect-all) re-evaluate `isSelected`
  // across thousands of nodes — visibly janky. We render only the rows in the
  // viewport (plus a small over-scan buffer).
  const CONTACT_HEIGHT = 60;
  const HEADER_HEIGHT = 36;
  const BUFFER = 8;

  let contacts = $state<ContactListItemDto[]>([]);
  let initialLoading = $state(true);

  let searchQuery = $state('');
  let searchOpen = $state(false);
  let searchInput: HTMLInputElement | undefined = $state();

  let selectionMode = $state(false);
  const selectedIds = new SvelteSet<string>();
  let busy = $state(false);

  let scrollTarget: HTMLElement | null = $state(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);

  async function loadAll() {
    try {
      const result = await getContacts();
      contacts = result.contacts;
    } catch (error) {
      handleError(error, 'Failed to load contacts');
    } finally {
      initialLoading = false;
    }
  }

  void loadAll();

  // Re-fetch when an external mutation (e.g. vCard upload, contact delete from
  // detail page) bumps the revision while we're mounted.
  let lastRevision = get(contactsRevision);
  $effect(() => {
    const v = $contactsRevision;
    if (v !== lastRevision) {
      lastRevision = v;
      void loadAll();
    }
  });

  function findScrollContainer(from: HTMLElement): HTMLElement | null {
    return (from.closest('#main-content') as HTMLElement | null) ?? document.querySelector('#main-content');
  }

  function attachScrollContainer(node: HTMLElement) {
    const target = findScrollContainer(node);
    scrollTarget = target;
    if (!target) {
      return {};
    }

    viewportHeight = target.clientHeight;
    scrollTop = target.scrollTop;

    const onScroll = () => {
      scrollTop = target.scrollTop;
      if (searchInput && document.activeElement === searchInput) {
        searchInput.blur();
      }
    };
    target.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver((entries) => {
      viewportHeight = entries[0].contentRect.height;
    });
    observer.observe(target);

    return {
      destroy() {
        target.removeEventListener('scroll', onScroll);
        observer.disconnect();
        scrollTarget = null;
      },
    };
  }

  function letterFor(name: string): string {
    const ch = name.charAt(0).toUpperCase();
    return /[A-Z]/.test(ch) ? ch : '#';
  }

  let filteredContacts = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return contacts;
    }
    return contacts.filter((c) => {
      const haystack = [c.displayName, c.organization ?? '', c.title ?? ''].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  });

  type Row = { type: 'header'; key: string; letter: string } | { type: 'contact'; key: string; contact: ContactListItemDto };

  let rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    let lastLetter = '';
    for (const contact of filteredContacts) {
      const letter = letterFor(contact.displayName);
      if (letter !== lastLetter) {
        out.push({ type: 'header', key: `h-${letter}`, letter });
        lastLetter = letter;
      }
      out.push({ type: 'contact', key: `c-${contact.id}`, contact });
    }
    return out;
  });

  let activeLetters = $derived.by(() => {
    const set = new SvelteSet<string>();
    for (const row of rows) {
      if (row.type === 'header') {
        set.add(row.letter);
      }
    }
    return set;
  });

  // Cumulative pixel offset of every row from the top of the list.
  let rowOffsets = $derived.by(() => {
    let y = 0;
    return rows.map((row) => {
      const offset = y;
      y += row.type === 'header' ? HEADER_HEIGHT : CONTACT_HEIGHT;
      return offset;
    });
  });

  let totalHeight = $derived.by(() => {
    const last = rows.at(-1);
    if (!last) {
      return 0;
    }
    return rowOffsets[rows.length - 1] + (last.type === 'header' ? HEADER_HEIGHT : CONTACT_HEIGHT);
  });

  // Map letter → first-row offset for the alphabet scrubber.
  let letterOffsets = $derived.by(() => {
    const map = new SvelteMap<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.type === 'header') {
        map.set(row.letter, rowOffsets[i]);
      }
    }
    return map;
  });

  // Binary-search the visible window [start, end] (inclusive) and pad with BUFFER.
  let visibleRange = $derived.by(() => {
    if (rows.length === 0 || viewportHeight === 0) {
      return { start: 0, end: -1 };
    }
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const rowHeight = rows[mid].type === 'header' ? HEADER_HEIGHT : CONTACT_HEIGHT;
      if (rowOffsets[mid] + rowHeight <= scrollTop) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const start = Math.max(0, lo - BUFFER);

    const bottom = scrollTop + viewportHeight;
    let last = lo;
    while (last < rows.length && rowOffsets[last] < bottom) {
      last++;
    }
    const end = Math.min(rows.length - 1, last + BUFFER);
    return { start, end };
  });

  let visibleRows = $derived.by(() => {
    if (visibleRange.end < visibleRange.start) {
      return [] as Array<Row & { top: number }>;
    }
    const out: Array<Row & { top: number }> = [];
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      out.push({ ...rows[i], top: rowOffsets[i] });
    }
    return out;
  });

  function scrollToLetter(letter: string) {
    const offset = letterOffsets.get(letter);
    if (offset === undefined || !scrollTarget) {
      return;
    }
    scrollTarget.scrollTop = offset;
  }

  let isScrubbing = $state(false);
  let activeHoverLetter = $state('');

  function getLetterFromPointer(event: PointerEvent): string {
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    return target?.dataset?.letter ?? '';
  }

  function handleScrubberPointerDown(event: PointerEvent) {
    event.preventDefault();
    searchInput?.blur();
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

  function toggleSelection(id: string) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    if (selectedIds.size === 0) {
      selectionMode = false;
    }
  }

  function enterSelection(id: string) {
    selectionMode = true;
    selectedIds.add(id);
  }

  function exitSelection() {
    selectedIds.clear();
    selectionMode = false;
  }

  function handleCardClick(contact: ContactListItemDto, event?: MouseEvent) {
    if (!selectionMode && event && (event.metaKey || event.ctrlKey)) {
      enterSelection(contact.id);
      return;
    }
    if (selectionMode) {
      toggleSelection(contact.id);
    } else {
      // Shallow routing: change the URL to `/contacts/<id>` and stash the id
      // in `page.state` without unmounting this component. The list (and its
      // scroll position) stays in the DOM; an overlay is rendered on top.
      // Browser back / popstate clears `page.state.contactId` and the overlay
      // disappears. Hard-loading the URL still works via the standalone route.
      pushState(`/contacts/${contact.id}`, { contactId: contact.id });
    }
  }

  // Active overlay state. `page.state.contactId` is the source of truth (it
  // survives back/forward). We fetch the full ContactDto on activation; the
  // list-row DTO doesn't carry phones/emails/etc.
  const getStateContactId = () => (page.state as { contactId?: string }).contactId;
  let activeContactId = $derived(getStateContactId() ?? null);
  let activeContact = $state<ContactDto | null>(null);
  let activeContactLoading = $state(false);

  $effect(() => {
    const id = activeContactId;
    if (!id) {
      activeContact = null;
      activeContactLoading = false;
      return;
    }
    if (activeContact?.id === id) {
      return;
    }
    activeContact = null;
    // Defer the "Loading…" text so sub-200ms fetches don't flash it.
    const loadingTextTimer = setTimeout(() => {
      if (getStateContactId() === id) {
        activeContactLoading = true;
      }
    }, 200);
    void getContact({ id })
      .then((c) => {
        if (getStateContactId() === id) {
          activeContact = c;
        }
      })
      .catch((error) => handleError(error, 'Failed to load contact'))
      .finally(() => {
        if (getStateContactId() === id) {
          activeContactLoading = false;
        }
        clearTimeout(loadingTextTimer);
      });
    return () => clearTimeout(loadingTextTimer);
  });

  function closeContactOverlay() {
    if (getStateContactId()) {
      history.back();
    }
  }

  async function fetchSelectedVcfBlob(): Promise<Blob | undefined> {
    // SDK returns the vCard payload as a string (fetchText). Wrap it in a real
    // Blob so URL.createObjectURL and File can consume it correctly.
    const text = (await exportContacts({ contactBulkRequestDto: { ids: [...selectedIds] } })) as unknown as string;
    return new Blob([text], { type: 'text/vcard' });
  }

  function selectedContactRefs() {
    const set = selectedIds;
    return contacts.filter((c) => set.has(c.id)).map((c) => ({ id: c.id, displayName: c.displayName }));
  }

  async function handleExportAll() {
    if (busy || contacts.length === 0) {
      return;
    }
    if ($embeddedInApp) {
      downloadAllContactsViaApp();
      return;
    }
    busy = true;
    try {
      const text = (await getAllVcf()) as unknown as string;
      const blob = new Blob([text], { type: 'text/vcard' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `contacts-${new Date().toISOString().slice(0, 10)}.vcf`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleError(error, 'Failed to export contacts');
    } finally {
      busy = false;
    }
  }

  function selectedVcfFilename() {
    if (selectedIds.size === 1) {
      const [id] = selectedIds;
      const name = contacts.find((c) => c.id === id)?.displayName.trim();
      if (name) {
        // Strip characters disallowed in Windows/macOS filenames; collapse runs of whitespace.
        const safe = name.replaceAll(/[\\/:*?"<>|]/g, '').replaceAll(/\s+/g, ' ').trim();
        if (safe) {
          return `${safe}.vcf`;
        }
      }
    }
    return `contacts (${selectedIds.size} selected).vcf`;
  }

  async function handleExport() {
    if (selectedIds.size === 0 || busy) {
      return;
    }
    if ($embeddedInApp) {
      downloadContactsViaApp(selectedContactRefs());
      return;
    }
    busy = true;
    try {
      const blob = await fetchSelectedVcfBlob();
      if (!blob) {
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = selectedVcfFilename();
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleError(error, 'Failed to export contacts');
    } finally {
      busy = false;
    }
  }

  async function handleShare() {
    if (selectedIds.size === 0 || busy) {
      return;
    }
    if ($embeddedInApp) {
      shareContactsViaApp(selectedContactRefs());
      return;
    }
    // Outside of embedded mode "share" behaves the same as download — see
    // CMD_SHARE_ASSETS / CMD_DOWNLOAD_ASSETS pattern. Avoids navigator.share's
    // user-gesture restriction (NotAllowedError on iOS Safari after async work).
    busy = true;
    try {
      const blob = await fetchSelectedVcfBlob();
      if (!blob) {
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = selectedVcfFilename();
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleError(error, 'Failed to share contacts');
    } finally {
      busy = false;
    }
  }

  async function handleDelete() {
    if (selectedIds.size === 0 || busy) {
      return;
    }
    const count = selectedIds.size;
    const confirmed = await modalManager.showDialog({
      icon: mdiDelete,
      title: $t('delete'),
      prompt:
        count === 1
          ? `Delete this contact? It will reappear on the next sync from your phone — to remove it permanently, delete it on the phone.`
          : `Delete ${count} contacts? They will reappear on the next sync from your phone — to remove them permanently, delete them on the phone.`,
      confirmText: $t('delete'),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }

    busy = true;
    try {
      const ids = [...selectedIds];
      await (ids.length === 1
        ? deleteContact({ id: ids[0] })
        : deleteContacts({ contactBulkRequestDto: { ids } }));
      contacts = contacts.filter((c) => !selectedIds.has(c.id));
      exitSelection();
    } catch (error) {
      handleError(error, 'Failed to delete contacts');
    } finally {
      busy = false;
    }
  }

  let allFilteredSelected = $derived(
    filteredContacts.length > 0 && filteredContacts.every((c) => selectedIds.has(c.id)),
  );

  function handleToggleSelectAll() {
    if (allFilteredSelected) {
      exitSelection();
    } else {
      for (const c of filteredContacts) {
        selectedIds.add(c.id);
      }
      selectionMode = true;
    }
  }

  async function openSearch() {
    if (!searchOpen) {
      searchOpen = true;
      await tick();
      searchInput?.focus();
    }
  }
</script>

<UserPageLayout
  hideNavbar={selectionMode}
  title={data.meta.title}
  description={contacts.length > 0 ? `(${contacts.length})` : undefined}
>
  {#snippet buttons()}
    <!-- In selection mode we hide both controls entirely; the active filter (if any)
         is surfaced as a label in the ControlAppBar's leading slot so the user still
         sees what their selection was filtered against. -->
    {#if !selectionMode}
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="text-gray-400 disabled:cursor-not-allowed disabled:opacity-40 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          aria-label="Search"
          disabled={contacts.length === 0}
          onclick={openSearch}
          tabindex={searchOpen ? -1 : 0}
        >
          <Icon icon={mdiMagnify} size="22" />
        </button>
        <div class="relative flex items-center">
          <input
            bind:this={searchInput}
            type="text"
            placeholder="Search..."
            bind:value={searchQuery}
            onblur={() => {
              if (!searchQuery.trim()) {
                searchQuery = '';
                searchOpen = false;
              }
            }}
            class="rounded-lg text-sm transition-[width,padding,opacity,background-color,border-color,border-width] duration-300 ease-in-out
              {searchOpen
                ? 'w-40 border border-gray-300 py-2 pl-3 pr-8 opacity-100 dark:border-gray-600 dark:text-white bg-white dark:bg-immich-dark-gray'
                : 'pointer-events-none w-0 border-0 p-0 cursor-pointer border-transparent bg-transparent opacity-0'}"
            tabindex={searchOpen ? 0 : -1}
          />
          {#if searchQuery}
            <button
              type="button"
              class="absolute right-2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              aria-label="Clear search"
              onmousedown={(e) => {
                e.preventDefault();
                searchQuery = '';
                searchInput?.focus();
              }}
            >
              <Icon icon={mdiClose} size="22" />
            </button>
          {/if}
        </div>
        <button
          type="button"
          class="text-gray-400 disabled:cursor-not-allowed disabled:opacity-40 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          aria-label="Export all contacts"
          disabled={busy || contacts.length === 0}
          onclick={handleExportAll}
        >
          <Icon icon={mdiExportVariant} size="22" />
        </button>
      </div>
    {/if}
  {/snippet}

  <div use:attachScrollContainer class="relative flex">
    <div class="min-w-0 flex-1 px-3">
      {#if initialLoading}
        <div class="flex min-h-[40vh] w-full items-center justify-center text-gray-400 dark:text-gray-500">
          Loading…
        </div>
      {:else if contacts.length === 0}
        <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
          <div class="flex flex-col content-center items-center text-center">
            <Icon icon={mdiAccountOffOutline} size="3.5em" />
            <p class="mt-5 text-3xl font-medium">No contacts available</p>
            <p class="text-base font-normal p-2">Once KeepSafe backs up your contacts, they will be shown here.</p>
          </div>
        </div>
      {:else if filteredContacts.length === 0}
        <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
          <div class="flex flex-col content-center items-center text-center">
            <Icon icon={mdiAccountOffOutline} size="3.5em" />
            <p class="mt-5 text-3xl font-medium">No results found</p>
            <p class="text-base font-normal p-2">{$t('contacts_no_results')}</p>
          </div>
        </div>
      {:else}
        <div class="relative" style="height: {totalHeight}px;">
          {#each visibleRows as row (row.key)}
            {#if row.type === 'header'}
              <div
                class="absolute left-0 right-0 flex items-center gap-3 px-1 select-none"
                style="top: {row.top}px; height: {HEADER_HEIGHT}px;"
              >
                <span class="text-sm font-semibold text-immich-primary dark:text-immich-dark-primary">{row.letter}</span>
                <div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
              </div>
            {:else}
              {@const contact = row.contact}
              {@const isSelected = selectedIds.has(contact.id)}
              <div
                class="group/row absolute left-0 right-0"
                style="top: {row.top + 2}px; height: {CONTACT_HEIGHT - 4}px;"
              >
                <button
                  type="button"
                  class="absolute inset-0 flex select-none items-center gap-4 overflow-hidden rounded-lg px-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-immich-dark-gray/80 dark:active:bg-immich-dark-gray
                    {isSelected ? 'bg-immich-primary/10 dark:bg-immich-dark-primary/20' : ''}"
                  onclick={(e) => handleCardClick(contact, e)}
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    enterSelection(contact.id);
                  }}
                >
                  {#if selectionMode}
                    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full
                      {isSelected
                        ? 'bg-immich-primary text-white dark:bg-immich-dark-primary'
                        : 'bg-gray-200 text-gray-400 dark:bg-gray-600 dark:text-gray-400'}">
                      <Icon icon={mdiCheck} size="28" />
                    </div>
                  {:else if contact.avatar}
                    <img src={contact.avatar} alt={contact.displayName} class="h-12 w-12 shrink-0 rounded-full object-cover transition-opacity group-hover/row:opacity-0" />
                  {:else}
                    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-immich-primary/10 text-sm font-medium text-immich-primary transition-opacity group-hover/row:opacity-0 dark:bg-immich-dark-primary/20 dark:text-immich-dark-primary">
                      {getInitials(contact.displayName)}
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium text-immich-dark-bg dark:text-white">{contact.displayName}</p>
                    {#if contact.organization || contact.title}
                      <p class="truncate text-xs text-gray-400 dark:text-gray-500">
                        {[contact.title, contact.organization].filter(Boolean).join(' · ')}
                      </p>
                    {/if}
                  </div>
                </button>
                {#if !selectionMode}
                  <!-- group-hover is gated behind (hover: hover), so this stays hidden on touch devices. -->
                  <button
                    type="button"
                    class="absolute left-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-gray-200 text-gray-400 transition-colors group-hover/row:flex hover:bg-immich-primary hover:text-white dark:bg-gray-600 dark:text-gray-400 dark:hover:bg-immich-dark-primary dark:hover:text-white"
                    aria-label="Select contact"
                    onclick={() => enterSelection(contact.id)}
                  >
                    <Icon icon={mdiCheck} size="28" />
                  </button>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    {#if !initialLoading && filteredContacts.length > 0}
      <!-- Alphabet scrubber -->
      <div
        class="fixed sm:hidden right-0 top-[calc(50%+4rem)] z-20 flex -translate-y-1/2 touch-none flex-col items-center"
        role="navigation"
        aria-label="Alphabet scrubber"
        onpointerdown={handleScrubberPointerDown}
        onpointermove={handleScrubberPointerMove}
        onpointerup={handleScrubberPointerUp}
        onpointercancel={handleScrubberPointerUp}
      >
        {#each ALPHABET as letter (letter)}
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
    {/if}
  </div>
</UserPageLayout>

{#if selectionMode}
  <ControlAppBar onClose={exitSelection} backIcon={mdiClose} tailwindClasses="bg-white shadow-md">
    {#snippet leading()}
      <div class="flex items-center gap-2 min-w-0">
        <div class="font-medium pt-0.5 sm:pt-0 text-primary dark:text-dark-primary whitespace-nowrap">
          <p class="block sm:hidden">{selectedIds.size}</p>
          <p class="hidden sm:block">{$t('selected_count', { values: { count: selectedIds.size } })}</p>
        </div>
        {#if searchQuery}
          <span
            class="inline-flex max-w-48 items-center gap-1 truncate rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            title={searchQuery}
          >
            <Icon icon={mdiMagnify} size="14" />
            <span class="truncate">{searchQuery}</span>
          </span>
        {/if}
      </div>
    {/snippet}
    {#snippet trailing()}
      <IconButton
        shape="round"
        color="secondary"
        variant="ghost"
        aria-label={$t('share')}
        icon={mdiShareVariantOutline}
        disabled={busy || selectedIds.size === 0}
        onclick={handleShare}
      />
      <IconButton
        shape="round"
        color="secondary"
        variant="ghost"
        aria-label={allFilteredSelected ? $t('unselect_all') : $t('select_all')}
        icon={allFilteredSelected ? mdiSelectRemove : mdiSelectAll}
        onclick={handleToggleSelectAll}
      />
      <ButtonContextMenu
        direction="left"
        align="top-right"
        color="secondary"
        title={$t('more')}
        icon={mdiDotsVertical}
        offset={{ x: 8, y: 40 }}
      >
        <MenuOption text={$t('download')} icon={mdiDownload} onClick={handleExport} />
        <MenuOption text={$t('delete')} icon={mdiDelete} onClick={handleDelete} />
      </ButtonContextMenu>
    {/snippet}
  </ControlAppBar>
{/if}

<!-- Shallow-routed contact detail overlay. Covers the list while keeping it
     mounted underneath, so closing this snaps back to the exact same scroll
     position with no remount and no jump. -->
{#if activeContactId}
  <div class="fixed inset-0 z-50 overflow-y-auto bg-white dark:bg-immich-dark-bg">
    {#if activeContact}
      <ContactDetail contact={activeContact} onClose={closeContactOverlay} />
    {:else if activeContactLoading}
      <div class="flex h-full w-full items-center justify-center text-gray-400 dark:text-gray-500">
        Loading…
      </div>
    {/if}
  </div>
{/if}
