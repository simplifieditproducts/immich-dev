<script lang="ts">
  import { mdiArrowBackIos } from '$lib/constants';
  import { embeddedInApp } from '$lib/stores/preferences.store';
  import { handleError } from '$lib/utils/handle-error';
  import { formatBirthday, getInitials, shareContactsViaApp } from '$lib/utils/contact-utils';
  import { refreshContacts } from '$lib/stores/contacts.store';
  import { type ContactDto, deleteContact, exportContacts } from '@immich/sdk';
  import { Icon, IconButton, modalManager } from '@immich/ui';
  import {
    mdiBriefcase,
    mdiCakeVariant,
    mdiDelete,
    mdiEmail,
    mdiMapMarker,
    mdiNoteText,
    mdiPhone,
    mdiShareVariantOutline,
  } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { t } from 'svelte-i18n';

  interface Props {
    contact: ContactDto;
    onClose: () => void;
  }

  let { contact, onClose }: Props = $props();
  let busy = $state(false);

  let showCopied = $state(false);
  let copiedTimeout: ReturnType<typeof setTimeout>;

  // Prefetched vCard blob. Used by the web (non-embedded) download path so the
  // share button can trigger an instant download without an extra round-trip.
  // In embedded mode we hand the share off to the native app via CMD, and the
  // native side fetches the vCard itself — no prefetch needed.
  let shareBlob = $state<Blob | null>(null);

  onMount(() => {
    if (!$embeddedInApp) {
      void prefetchShareBlob();
    }
  });

  onDestroy(() => clearTimeout(copiedTimeout));

  async function prefetchShareBlob() {
    try {
      const text = (await exportContacts({ contactBulkRequestDto: { ids: [contact.id] } })) as unknown as string;
      shareBlob = new Blob([text], { type: 'text/vcard' });
    } catch {
      // Swallow — handleShare will surface a real error if the user actually taps Share.
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onClose();
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    showCopied = true;
    clearTimeout(copiedTimeout);
    copiedTimeout = setTimeout(() => (showCopied = false), 2000);
  }

  function formatAddress(addr: { street: string; city: string; state: string; zip: string; country: string }): string {
    return [addr.street, addr.city, addr.state, addr.zip, addr.country].filter(Boolean).join(', ');
  }

  async function handleShare() {
    if (busy) {
      return;
    }
    if ($embeddedInApp) {
      shareContactsViaApp([{ id: contact.id, displayName: contact.displayName }]);
      return;
    }
    busy = true;
    try {
      let blob = shareBlob;
      if (!blob) {
        const text = (await exportContacts({ contactBulkRequestDto: { ids: [contact.id] } })) as unknown as string;
        blob = new Blob([text], { type: 'text/vcard' });
        shareBlob = blob;
      }
      const filename = `${contact.displayName || 'contact'}.vcf`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleError(error, 'Failed to share contact');
    } finally {
      busy = false;
    }
  }

  async function handleDelete() {
    if (busy) {
      return;
    }
    const confirmed = await modalManager.showDialog({
      icon: mdiDelete,
      title: $t('delete'),
      prompt: `Delete "${contact.displayName}"? It will reappear on the next sync from your phone — to remove it permanently, delete it on the phone.`,
      confirmText: $t('delete'),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }

    busy = true;
    try {
      await deleteContact({ id: contact.id });
      refreshContacts();
      onClose();
    } catch (error) {
      handleError(error, 'Failed to delete contact');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div in:fade={{ duration: 150 }} class="fixed top-0 left-0 right-0 z-20 flex max-sm:h-(--navbar-height-embedded-md) h-(--navbar-height-embedded) items-center border-b border-gray-200 bg-white sm:px-2 sm:py-3 dark:border-gray-700 dark:bg-immich-dark-gray">
  <IconButton
    aria-label={$t('close')}
    onclick={() => !busy && onClose()}
    color="primary"
    shape="round"
    variant="ghost"
    icon={mdiArrowBackIos}
    size="large"
    class="-ml-1"
  />
  <div class="ml-auto flex items-center gap-1 pr-1">
    <IconButton
      aria-label={$t('share')}
      onclick={handleShare}
      color="secondary"
      shape="round"
      variant="ghost"
      icon={mdiShareVariantOutline}
      size="medium"
      disabled={busy}
    />
    <IconButton
      aria-label={$t('delete')}
      onclick={handleDelete}
      color="secondary"
      shape="round"
      variant="ghost"
      icon={mdiDelete}
      size="medium"
      disabled={busy}
    />
  </div>
</div>

<div in:fade={{ duration: 150 }} class="mx-auto max-sm:mt-(--navbar-height-embedded-md) mt-(--navbar-height-embedded) flex max-w-md flex-col gap-2 px-4 pt-6 pb-12">
  <div class="flex flex-col items-center pb-4">
    {#if contact.avatar}
      <img src={contact.avatar} alt={contact.displayName} class="h-24 w-24 rounded-full object-cover" />
    {:else}
      <div class="flex h-24 w-24 items-center justify-center rounded-full bg-immich-primary/10 text-2xl font-semibold text-immich-primary dark:bg-immich-dark-primary/20 dark:text-immich-dark-primary">
        {getInitials(contact.displayName)}
      </div>
    {/if}

    <button type="button" class="mt-3 cursor-pointer rounded px-1 hover:bg-gray-100 dark:hover:bg-gray-700" onclick={() => copyToClipboard(contact.displayName)}>
      <h2 class="text-lg font-semibold text-immich-dark-bg dark:text-white">{contact.displayName}</h2>
    </button>

    {#if contact.organization || contact.title}
      <button type="button" class="cursor-pointer rounded px-1 hover:bg-gray-100 dark:hover:bg-gray-700" onclick={() => copyToClipboard([contact.title, contact.organization].filter(Boolean).join(' · '))}>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {[contact.title, contact.organization].filter(Boolean).join(' · ')}
        </p>
      </button>
    {/if}
  </div>

  {#if contact.phones.length > 0}
    <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
      {#each contact.phones as phone, i (i)}
        <div class="flex items-center gap-3 {i > 0 ? 'mt-2 border-t border-gray-200 pt-2 dark:border-gray-700' : ''}">
          <Icon icon={mdiPhone} size="18" class="shrink-0 text-gray-400" />
          <div class="min-w-0 flex-1">
            <a href="tel:{phone.value}" class="text-sm text-immich-primary hover:underline dark:text-immich-dark-primary">{phone.value}</a>
            {#if phone.type}
              <p class="text-xs text-gray-400 dark:text-gray-500">{phone.type}</p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if contact.emails.length > 0}
    <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
      {#each contact.emails as email, i (i)}
        <div class="flex items-center gap-3 {i > 0 ? 'mt-2 border-t border-gray-200 pt-2 dark:border-gray-700' : ''}">
          <Icon icon={mdiEmail} size="18" class="shrink-0 text-gray-400" />
          <div class="min-w-0 flex-1">
            <a href="mailto:{email.value}" class="truncate text-sm text-immich-primary hover:underline dark:text-immich-dark-primary">{email.value}</a>
            {#if email.type}
              <p class="text-xs text-gray-400 dark:text-gray-500">{email.type}</p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if contact.organization || contact.title}
    <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
      <div class="flex items-center gap-3">
        <Icon icon={mdiBriefcase} size="18" class="shrink-0 text-gray-400" />
        <button type="button" class="min-w-0 flex-1 cursor-pointer rounded px-1 text-left hover:bg-gray-100 dark:hover:bg-gray-700" onclick={() => copyToClipboard([contact.title, contact.organization].filter(Boolean).join(' · '))}>
          {#if contact.title}
            <p class="text-sm text-immich-dark-bg dark:text-white">{contact.title}</p>
          {/if}
          {#if contact.organization}
            {#if contact.title}
              <p class="text-xs text-gray-400 dark:text-gray-500">{contact.organization}</p>
            {:else}
              <p class="text-sm text-immich-dark-bg dark:text-white">{contact.organization}</p>
            {/if}
          {/if}
        </button>
      </div>
    </div>
  {/if}

  {#if contact.addresses.length > 0}
    <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
      {#each contact.addresses as address, i (i)}
        {@const formatted = formatAddress(address)}
        {#if formatted}
          <div class="flex items-start gap-3 {i > 0 ? 'mt-2 border-t border-gray-200 pt-2 dark:border-gray-700' : ''}">
            <Icon icon={mdiMapMarker} size="18" class="mt-0.5 shrink-0 text-gray-400" />
            <button type="button" class="min-w-0 flex-1 cursor-pointer rounded px-1 text-left hover:bg-gray-100 dark:hover:bg-gray-700" onclick={() => copyToClipboard(formatted)}>
              <p class="text-sm text-immich-dark-bg dark:text-white">{formatted}</p>
              {#if address.type}
                <p class="text-xs text-gray-400 dark:text-gray-500">{address.type}</p>
              {/if}
            </button>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if contact.birthday}
    <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
      <div class="flex items-center gap-3">
        <Icon icon={mdiCakeVariant} size="18" class="shrink-0 text-gray-400" />
        <button type="button" class="cursor-pointer rounded px-1 text-left hover:bg-gray-100 dark:hover:bg-gray-700" onclick={() => copyToClipboard(contact.birthday!)}>
          <p class="text-sm text-immich-dark-bg dark:text-white">{formatBirthday(contact.birthday)}</p>
        </button>
      </div>
    </div>
  {/if}

  {#if contact.notes}
    <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
      <div class="flex items-start gap-3">
        <Icon icon={mdiNoteText} size="18" class="mt-0.5 shrink-0 text-gray-400" />
        <button type="button" class="cursor-pointer rounded px-1 text-left hover:bg-gray-100 dark:hover:bg-gray-700" onclick={() => copyToClipboard(contact.notes!)}>
          <p class="whitespace-pre-wrap text-sm text-immich-dark-bg dark:text-white">{contact.notes}</p>
        </button>
      </div>
    </div>
  {/if}

</div>

{#if showCopied}
  <div class="pointer-events-none fixed bottom-8 left-0 right-0 z-10000 flex justify-center">
    <div class="rounded-full bg-gray-800 px-4 py-2 text-sm text-white shadow-lg dark:bg-gray-200 dark:text-gray-800">
      Copied to clipboard
    </div>
  </div>
{/if}
