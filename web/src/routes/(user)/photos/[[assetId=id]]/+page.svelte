<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import MemoryLane from '$lib/components/photos-page/memory-lane.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/button-context-menu.svelte';
  import AddToAlbum from '$lib/components/timeline/actions/AddToAlbumAction.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import AssetJobActions from '$lib/components/timeline/actions/AssetJobActions.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import LinkLivePhotoAction from '$lib/components/timeline/actions/LinkLivePhotoAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import StackAction from '$lib/components/timeline/actions/StackAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { appId, AppRoute, AssetAction, QueryParameter } from '$lib/constants';
  import { AggregatedTimelineManager, type MediaFilter } from '$lib/managers/timeline-manager/aggregated-timeline-manager.svelte';
  import { AssetInteraction } from '$lib/stores/asset-interaction.svelte';
  import { assetViewingStore } from '$lib/stores/asset-viewing.store';
  import { isFaceEditMode } from '$lib/stores/face-edit.svelte';
  import { embeddedInApp, initialUrl } from '$lib/stores/preferences.store';
  import { preferences, user } from '$lib/stores/user.store';
  import { sendMessageToApp, sendPageReadyToApp } from '$lib/utils';
  import { type OnLink, type OnUnlink } from '$lib/utils/actions';
  import { Icon } from '@immich/ui';
  import { mdiDotsVertical, mdiImageOffOutline, mdiPlus } from '@mdi/js';
  import { t } from 'svelte-i18n';

  let { isViewing: showAssetViewer } = assetViewingStore;
  let mediaFilter = $state<MediaFilter>('all');

  const aggregatedManager = new AggregatedTimelineManager();
  let timelineManager = $derived(aggregatedManager.getOrCreateManager(mediaFilter));

  const assetInteraction = new AssetInteraction();

  // Kevin: Only update `$embeddedInApp` if the `inApp` query parameter is present
  if (page.url.searchParams.has(QueryParameter.IN_APP)) {
    $embeddedInApp = ['1', 'true'].includes(page.url.searchParams.get(QueryParameter.IN_APP) || '');
  }
  
  let selectedAssets = $derived(assetInteraction.selectedAssets);
  let isAssetStackSelected = $derived(selectedAssets.length === 1 && !!selectedAssets[0].stack);
  let isLinkActionAvailable = $derived.by(() => {
    const isLivePhoto = selectedAssets.length === 1 && !!selectedAssets[0].livePhotoVideoId;
    const isLivePhotoCandidate =
      selectedAssets.length === 2 &&
      selectedAssets.some((asset) => asset.isImage) &&
      selectedAssets.some((asset) => asset.isVideo);

    return assetInteraction.isAllUserOwned && (isLivePhoto || isLivePhotoCandidate);
  });
  const handleEscape = () => {
    if ($showAssetViewer) {
      return;
    }
    if (assetInteraction.selectionActive) {
      assetInteraction.clearMultiselect();
      return;
    }
  };

  const handleLink: OnLink = ({ still, motion }) => {
    aggregatedManager.removeAssets([motion.id]);
    aggregatedManager.upsertAssets([still]);
  };

  const handleUnlink: OnUnlink = ({ still, motion }) => {
    aggregatedManager.upsertAssets([motion]);
    aggregatedManager.upsertAssets([still]);
  };

  const handleSetVisibility = (assetIds: string[]) => {
    aggregatedManager.removeAssets(assetIds);
    assetInteraction.clearMultiselect();
  };

  const onBack = () => {
    // Close webview if on /photos and initial entry was also /photos
    const initialPathname = new URL($initialUrl).pathname;
    return $embeddedInApp && page.url.pathname === AppRoute.PHOTOS && initialPathname === AppRoute.PHOTOS && sendMessageToApp('CMD_CLOSE_WINDOW');
  }

  beforeNavigate(() => {
    isFaceEditMode.value = false;
  });

  // Send CMD_PAGE_READY when the timeline is initialized
  $effect(() => {
    if ($embeddedInApp && timelineManager?.isInitialized) {
      sendPageReadyToApp();
    }
  });
</script>

<!-- Gavin has made the 'Upload' Button visible only for admins -->
<UserPageLayout hideNavbar={assetInteraction.selectionActive} showUploadButton={$user.isAdmin} scrollbar={false} onBack={onBack}>
  {#key mediaFilter}
    <Timeline
      enableRouting={true}
      timelineManager={timelineManager}
      {assetInteraction}
      removeAction={AssetAction.ARCHIVE}
      onEscape={handleEscape}
      withStacked
    >
      <div class="flex justify-center px-2 pt-3 pb-1">
        <div class="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800" class:opacity-40={assetInteraction.selectionActive}>
          {#each [{ key: 'all' as MediaFilter, label: 'All' }, { key: 'photo' as MediaFilter, label: 'Photos' }, { key: 'video' as MediaFilter, label: 'Videos' }] as { key, label } (key)}
            <button
              type="button"
              disabled={assetInteraction.selectionActive}
              class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors
                {mediaFilter === key
                  ? 'bg-white text-immich-primary shadow-sm dark:bg-gray-600 dark:text-immich-dark-primary'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
              onclick={() => (mediaFilter = key)}
            >
              {label}
            </button>
          {/each}
        </div>
      </div>
      {#if $preferences.memories.enabled && mediaFilter === 'all'}
        <MemoryLane />
      {/if}
      {#snippet empty()}
        <!-- Kevin has updated the default no photos message. -->
        <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
          <div class="flex flex-col content-center items-center text-center">
            <Icon icon={mdiImageOffOutline} size="3.5em" />
            <p class="mt-5 text-3xl font-medium">No photos available</p>
            <p class="text-base font-normal p-2">Subscribe to the KeepSafe service in the {appId === 'ultimatebackup' ? 'Ultimate Backup' : 'Picture Keeper Connect'} mobile app to view your photos here.</p>
          </div>
        </div>
      {/snippet}
    </Timeline>
  {/key}
</UserPageLayout>

{#if assetInteraction.selectionActive}
  <AssetSelectControlBar
    ownerId={$user.id}
    assets={assetInteraction.selectedAssets}
    clearSelect={() => assetInteraction.clearMultiselect()}
  >
    <CreateSharedLink />
    <SelectAllAssets {timelineManager} {assetInteraction} />
    <ButtonContextMenu icon={mdiPlus} title={$t('add_to')} offset={{ x: 0, y: 42 }}>
      <AddToAlbum />
      <AddToAlbum shared />
    </ButtonContextMenu>
    <FavoriteAction
      removeFavorite={assetInteraction.isAllFavorite}
      onFavorite={(ids, isFavorite) => aggregatedManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
    ></FavoriteAction>
    <ButtonContextMenu direction="left" align="top-right" color="secondary" title={$t('more')} icon={mdiDotsVertical} offset={{ x: 8, y: 40 }}>
      <DownloadAction menuItem />
      {#if assetInteraction.selectedAssets.length > 1 || isAssetStackSelected}
        <StackAction
          unstack={isAssetStackSelected}
          onStack={(result) => aggregatedManager.updateStacked(result)}
          onUnstack={(assets) => aggregatedManager.updateUnstacked(assets)}
        />
      {/if}
      {#if isLinkActionAvailable}
        <LinkLivePhotoAction
          menuItem
          unlink={assetInteraction.selectedAssets.length === 1}
          onLink={handleLink}
          onUnlink={handleUnlink}
        />
      {/if}
      <ChangeDate menuItem />
      <ChangeDescription menuItem />
      <ChangeLocation menuItem />
      <!-- Gavin has made 'Archive' button visible only for admins -->
      {#if $user.isAdmin}      
        <ArchiveAction
          menuItem
          onArchive={(ids, visibility) => aggregatedManager.update(ids, (asset) => (asset.visibility = visibility))}
        />
      {/if}
      {#if $preferences.tags.enabled}
        <TagAction menuItem />
      {/if}
      <DeleteAssets
        menuItem
        onAssetDelete={(assetIds) => aggregatedManager.removeAssets(assetIds)}
        onUndoDelete={(assets) => aggregatedManager.upsertAssets(assets)}
      />
      <!-- Gavin has made 'Move to locked folder', 'Refresh thumbnails', and 'Refresh metadata' buttons visible only for admins -->
      {#if $user.isAdmin}
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        <hr />
        <AssetJobActions />
      {/if}
    </ButtonContextMenu>
  </AssetSelectControlBar>
{/if}
