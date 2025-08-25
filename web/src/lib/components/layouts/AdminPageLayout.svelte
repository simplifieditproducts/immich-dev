<script lang="ts">
  import PageContent from '$lib/components/layouts/PageContent.svelte';
  import TitleLayout from '$lib/components/layouts/TitleLayout.svelte';
  import NavigationBarEmbedded from '$lib/components/shared-components/navigation-bar/navigation-bar-embedded.svelte';
  import NavigationBar from '$lib/components/shared-components/navigation-bar/navigation-bar.svelte';
  import AdminSidebar from '$lib/sidebars/AdminSidebar.svelte';
  import { embeddedInApp } from '$lib/stores/preferences.store';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import { AppShell, AppShellHeader, AppShellSidebar, Scrollable } from '@immich/ui';
  import type { Snippet } from 'svelte';

  type Props = {
    title: string;
    buttons?: Snippet;
    children?: Snippet;
  };

  let { title, buttons, children }: Props = $props();
</script>

<AppShell>
  <AppShellHeader>
    {#if $embeddedInApp}
      <NavigationBarEmbedded showUploadButton={false} noBorder />
    {:else}
      <NavigationBar showUploadButton={false} noBorder />
    {/if}
  </AppShellHeader>
  <AppShellSidebar bind:open={sidebarStore.isOpen}>
    <AdminSidebar />
  </AppShellSidebar>

  <TitleLayout {title} {buttons}>
    <Scrollable class="grow">
      <PageContent>
        {@render children?.()}
      </PageContent>
    </Scrollable>
  </TitleLayout>
</AppShell>
