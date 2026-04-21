<script lang="ts">
  import Portal from '$lib/elements/Portal.svelte';
  import { Icon } from '@immich/ui';
  import { mdiBriefcase, mdiCakeVariant, mdiClose, mdiEmail, mdiMapMarker, mdiNoteText, mdiPhone } from '@mdi/js';
  import type { Contact } from '$lib/types';
  import { getInitials } from '$lib/utils/contact-utils';

  interface Props {
    contact: Contact;
    onClose: () => void;
  }

  let { contact, onClose }: Props = $props();

  function formatAddress(addr: { street: string; city: string; state: string; zip: string; country: string }): string {
    return [addr.street, addr.city, addr.state, addr.zip, addr.country].filter(Boolean).join(', ');
  }

  let showCopied = $state(false);
  let copiedTimeout: ReturnType<typeof setTimeout>;

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for iOS browsers where Clipboard API may not work
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

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Portal target="body">
  <div class="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 p-4" onclick={handleBackdropClick} role="presentation">
    <div
      class="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-immich-dark-gray"
      role="dialog"
      aria-label={contact.displayName}
    >
      <!-- Header -->
      <div class="relative flex shrink-0 flex-col items-center px-6 pt-6 pb-4">
        <button
          type="button"
          class="absolute right-3 top-3 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 active:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-300 dark:active:bg-gray-600"
          onclick={onClose}
        >
          <Icon icon={mdiClose} size="24" />
        </button>

        {#if contact.avatar}
          <img src={contact.avatar} alt={contact.displayName} class="h-20 w-20 rounded-full object-cover" />
        {:else}
          <div
            class="flex h-20 w-20 items-center justify-center rounded-full bg-immich-primary/10 text-2xl font-semibold text-immich-primary dark:bg-immich-dark-primary/20 dark:text-immich-dark-primary"
          >
            {getInitials(contact.displayName)}
          </div>
        {/if}

        <button type="button" class="mt-3 cursor-pointer rounded px-1 hover:bg-gray-100 dark:hover:bg-gray-700" onclick={() => copyToClipboard(contact.displayName)}>
          <h2 class="text-lg font-semibold text-immich-dark-bg dark:text-white">
            {contact.displayName}
          </h2>
        </button>

        {#if contact.organization || contact.title}
          <button type="button" class="cursor-pointer rounded px-1 hover:bg-gray-100 dark:hover:bg-gray-700" onclick={() => copyToClipboard([contact.title, contact.organization].filter(Boolean).join(' · '))}>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              {[contact.title, contact.organization].filter(Boolean).join(' · ')}
            </p>
          </button>
        {/if}
      </div>

      <!-- Details -->
      <div class="min-h-0 space-y-1 overflow-y-auto px-6 pb-6">
        <!-- Phones -->
        {#if contact.phones.length > 0}
          <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
            {#each contact.phones as phone, i (i)}
              <div
                class="flex items-center gap-3 {i > 0 ? 'mt-2 border-t border-gray-200 pt-2 dark:border-gray-700' : ''}"
              >
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

        <!-- Emails -->
        {#if contact.emails.length > 0}
          <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
            {#each contact.emails as email, i (i)}
              <div
                class="flex items-center gap-3 {i > 0 ? 'mt-2 border-t border-gray-200 pt-2 dark:border-gray-700' : ''}"
              >
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

        <!-- Organization & Title -->
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

        <!-- Addresses -->
        {#if contact.addresses.length > 0}
          <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
            {#each contact.addresses as address, i (i)}
              {@const formatted = formatAddress(address)}
              {#if formatted}
                <div
                  class="flex items-start gap-3 {i > 0
                    ? 'mt-2 border-t border-gray-200 pt-2 dark:border-gray-700'
                    : ''}"
                >
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

        <!-- Birthday -->
        {#if contact.birthday}
          <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
            <div class="flex items-center gap-3">
              <Icon icon={mdiCakeVariant} size="18" class="shrink-0 text-gray-400" />
              <button type="button" class="cursor-pointer rounded px-1 text-left hover:bg-gray-100 dark:hover:bg-gray-700" onclick={() => copyToClipboard(contact.birthday!)}>
                <p class="text-sm text-immich-dark-bg dark:text-white">{contact.birthday}</p>
              </button>
            </div>
          </div>
        {/if}

        <!-- Notes -->
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
    </div>
    {#if showCopied}
      <div class="pointer-events-none fixed bottom-8 left-0 right-0 z-10000 flex justify-center">
        <div class="rounded-full bg-gray-800 px-4 py-2 text-sm text-white shadow-lg dark:bg-gray-200 dark:text-gray-800">
          Copied to clipboard
        </div>
      </div>
    {/if}
  </div>
</Portal>
