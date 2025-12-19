<script lang="ts">
  import { clickOutside } from '$lib/actions/click-outside';
  import { focusTrap } from '$lib/actions/focus-trap';
  import { menuButtonId } from '$lib/components/shared-components/navigation-bar/navigation-bar.svelte';
  import { mobileDevice } from '$lib/stores/mobile-device.svelte';
  import { embeddedInApp } from '$lib/stores/preferences.store';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import { onMount, type Snippet } from 'svelte';

  interface Props {
    ariaLabel?: string;
    children?: Snippet;
  }

  let { ariaLabel, children }: Props = $props();

  const isHidden = $derived(!sidebarStore.isOpen && !mobileDevice.isFullSidebar);
  const isExpanded = $derived(sidebarStore.isOpen && !mobileDevice.isFullSidebar);

  onMount(() => {
    closeSidebar();
  });

  const closeSidebar = () => {
    if (!isExpanded) {
      return;
    }
    sidebarStore.reset();
    if (isHidden) {
      document.querySelector<HTMLButtonElement>(`#${menuButtonId}`)?.focus();
    }
  };
</script>

<nav
  id="sidebar"
  aria-label={ariaLabel}
  tabindex="-1"
  class="immich-scrollbar relative z-10 sidebar:w-64 overflow-y-auto overflow-x-hidden transition-all duration-200 bg-light
    {$embeddedInApp ? 'w-[min(100vw,16rem)] h-0' : 'w-0 pt-8'} {sidebarStore.isOpen ? ($embeddedInApp ? 'pt-3 h-full border rounded-lg' : 'w-[min(100vw,16rem)]') : ''}"
  class:shadow-2xl={isExpanded}
  class:dark:border-e-immich-dark-gray={isExpanded}
  class:border-r={isExpanded}
  data-testid="sidebar-parent"
  inert={isHidden}
  use:clickOutside={{ onOutclick: closeSidebar, onEscape: closeSidebar }}
  use:focusTrap={{ active: isExpanded }}
>
  <div class="{$embeddedInApp ? 'pe-4' : 'pe-6'} flex flex-col gap-1 h-max min-h-full">
    {@render children?.()}
  </div>
</nav>
