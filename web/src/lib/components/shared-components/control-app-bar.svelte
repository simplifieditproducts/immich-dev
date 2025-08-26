<script lang="ts">
  import { browser } from '$app/environment';

  import { isSelectingAllAssets } from '$lib/stores/assets-store.svelte';
  import { embeddedInApp } from '$lib/stores/preferences.store';
  import { IconButton } from '@immich/ui';
  import { mdiClose } from '@mdi/js';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';

  interface Props {
    showBackButton?: boolean;
    backIcon?: string;
    tailwindClasses?: string;
    forceDark?: boolean;
    multiRow?: boolean;
    onClose?: () => void;
    leading?: Snippet;
    children?: Snippet;
    trailing?: Snippet;
  }

  let {
    showBackButton = true,
    backIcon = mdiClose,
    tailwindClasses = '',
    forceDark = false,
    multiRow = false,
    onClose = () => {},
    leading,
    children,
    trailing,
  }: Props = $props();

  const onScroll = () => {
    if (window.scrollY > 80) {
      appBarBorder = 'border border-gray-200 bg-gray-50 dark:border-gray-600';

      if (forceDark) {
        appBarBorder = 'border border-gray-600';
      }
    } else {
      appBarBorder = 'bg-light border border-transparent';
    }
  };

  const handleClose = () => {
    $isSelectingAllAssets = false;
    onClose();
  };

  onMount(() => {
    if (browser) {
      document.addEventListener('scroll', onScroll, { passive: true });
    }
  });

  onDestroy(() => {
    if (browser) {
      document.removeEventListener('scroll', onScroll);
    }
  });
</script>

<div in:fly={{ y: 10, duration: 200 }} class="absolute top-0 w-full bg-transparent border-b">
  <nav
    id="asset-selection-app-bar"
    class={[
      'grid',
      multiRow && !$embeddedInApp && 'grid-cols-[100%] md:grid-cols-[25%_50%_25%]',
      !multiRow && !$embeddedInApp && 'grid-cols-[2.125rem_1fr_2.125rem] sm:grid-cols-[25%_50%_25%]',
      'justify-between lg:grid-cols-[25%_50%_25%]',
      $embeddedInApp && 'grid-cols-[2.125rem_1fr_2.125rem]',
      'place-items-center p-2 max-md:p-0 transition-all',
      tailwindClasses,
      forceDark ? 'bg-immich-dark-gray! text-white' : 'bg-white dark:bg-immich-dark-gray',
    ]}
  >
    <div class="flex place-items-center sm:gap-6 justify-self-start dark:text-immich-dark-fg {forceDark ? 'dark' : ''}">
      {#if showBackButton}
        <IconButton
          aria-label={$t('close')}
          onclick={handleClose}
          color={$embeddedInApp ? 'primary' : 'secondary'}
          shape="round"
          variant="ghost"
          icon={backIcon}
          size="large"
          class="-ml-1"
        />
      {/if}
      {@render leading?.()}
    </div>

    <div class="w-full">
      {@render children?.()}
    </div>

    <div class="flex place-items-center gap-1 justify-self-end">
      {@render trailing?.()}
    </div>
  </nav>
</div>
