<script lang="ts" module>
  export const menuButtonId = 'top-menu-button';
</script>

<script lang="ts">
  import { page } from '$app/state';
  import { clickOutside } from '$lib/actions/click-outside';
  import CastButton from '$lib/cast/cast-button.svelte';
  import SkipLink from '$lib/elements/SkipLink.svelte';
  import NotificationPanel from '$lib/components/shared-components/navigation-bar/notification-panel.svelte';
  import { AppRoute, mdiArrowBackIos } from '$lib/constants';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { notificationManager } from '$lib/stores/notification-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import { user } from '$lib/stores/user.store';
  import { Button, IconButton } from '@immich/ui';
  import { mdiBellBadge, mdiBellOutline, mdiMagnify, mdiMenu, mdiTrayArrowUp } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import ThemeButton from '../theme-button.svelte';
  import UserAvatar from '../user-avatar.svelte';
  import AccountInfoPanel from './account-info-panel.svelte';

  interface Props {
    onBackClick?: () => void;
    showUploadButton?: boolean;
    onUploadClick?: () => void;
    // TODO: remove once this is only used in <AppShellHeader>
    noBorder?: boolean;
  }

  let { onBackClick = () => {}, showUploadButton = true, onUploadClick, noBorder = false }: Props = $props();

  let shouldShowAccountInfoPanel = $state(false);
  let shouldShowNotificationPanel = $state(false);
  let innerWidth: number = $state(0);
  const hasUnreadNotifications = $derived(notificationManager.notifications.length > 0);
</script>

<svelte:window bind:innerWidth />

<nav id="dashboard-navbar" class="max-sm:h-(--navbar-height-embedded-md) h-(--navbar-height-embedded) w-dvw text-sm">
  <SkipLink text={$t('skip_to_content')} />
  <div
    class="grid grid-cols-[--spacing(32)_auto] items-center sm:px-2 sm:py-3 sidebar:grid-cols-[--spacing(64)_auto] {noBorder
      ? ''
      : 'border-b'}"
  >

    <IconButton
      id={menuButtonId}
      shape="round"
      color="primary"
      variant="ghost"
      size="large"
      aria-label="Back"
      icon={mdiArrowBackIos}
      class="-ml-1"
      onclick={onBackClick}
    />

    <div class="flex justify-between gap-4 lg:gap-8">
      <section class="flex place-items-center justify-end gap-1 md:gap-2 w-full">
        {#if featureFlagsManager.value.search && !page.url.pathname.startsWith(AppRoute.CONTACTS)}
          <IconButton
            color="secondary"
            shape="round"
            variant="ghost"
            size="medium"
            icon={mdiMagnify}
            href={AppRoute.SEARCH}
            id="search-button"
            aria-label={$t('go_to_search')}
          />
        {/if}

        {#if !page.url.pathname.includes('/admin') && showUploadButton && onUploadClick}
          <Button
            leadingIcon={mdiTrayArrowUp}
            onclick={onUploadClick}
            class="hidden lg:flex"
            variant="ghost"
            size="medium"
            color="secondary"
            >{$t('upload')}
          </Button>
          <IconButton
            color="secondary"
            shape="round"
            variant="ghost"
            size="medium"
            onclick={onUploadClick}
            title={$t('upload')}
            aria-label={$t('upload')}
            icon={mdiTrayArrowUp}
            class="lg:hidden"
          />
        {/if}

        <!-- Gavin has made the "Theme Switch" button visible only for admins. -->
        {#if $user.isAdmin}
          <ThemeButton />
        {/if}

        <!-- Kevin/Gavin have made the 'Notifications' button visible only for admins. -->
        {#if $user.isAdmin}
          <div
            use:clickOutside={{
              onOutclick: () => (shouldShowNotificationPanel = false),
              onEscape: () => (shouldShowNotificationPanel = false),
            }}
          >
            <IconButton
              shape="round"
              color={hasUnreadNotifications ? 'primary' : 'secondary'}
              variant="ghost"
              size="medium"
              icon={hasUnreadNotifications ? mdiBellBadge : mdiBellOutline}
              onclick={() => (shouldShowNotificationPanel = !shouldShowNotificationPanel)}
              aria-label={$t('notifications')}
            />

            {#if shouldShowNotificationPanel}
              <NotificationPanel />
            {/if}
          </div>
        {/if}

        <CastButton />

        <IconButton
          id={menuButtonId}
          shape="round"
          color="secondary"
          variant="ghost"
          size="medium"
          aria-label={$t('main_menu')}
          icon={mdiMenu}
          onclick={() => {
            sidebarStore.toggle();
          }}
          onmousedown={(event: MouseEvent) => {
            if (sidebarStore.isOpen) {
              // stops event from reaching the default handler when clicking outside of the sidebar
              event.stopPropagation();
            }
          }}
        />        

        {#if $user.isAdmin}
        <div
          use:clickOutside={{
            onOutclick: () => (shouldShowAccountInfoPanel = false),
            onEscape: () => (shouldShowAccountInfoPanel = false),
          }}
        >
          <button
            type="button"
            class="flex pe-2"
            onclick={() => (shouldShowAccountInfoPanel = !shouldShowAccountInfoPanel)}
            title={`${$user.name} (${$user.email})`}
          >
            {#key $user}
              <UserAvatar user={$user} size="md" noTitle interactive />
            {/key}
          </button>

          {#if shouldShowAccountInfoPanel}
            <AccountInfoPanel
              onLogout={() => authManager.logout()}
              onClose={() => (shouldShowAccountInfoPanel = false)}
            />
          {/if}
        </div>
        {/if}
      </section>
    </div>
  </div>
</nav>