<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { shortcut } from '$lib/actions/shortcut';
  import AlbumCardGroup from '$lib/components/album-page/album-card-group.svelte';
  import Icon from '$lib/components/elements/icon.svelte';
  import AddToAlbum from '$lib/components/photos-page/actions/add-to-album.svelte';
  import ArchiveAction from '$lib/components/photos-page/actions/archive-action.svelte';
  import AssetJobActions from '$lib/components/photos-page/actions/asset-job-actions.svelte';
  import ChangeDate from '$lib/components/photos-page/actions/change-date-action.svelte';
  import ChangeDescription from '$lib/components/photos-page/actions/change-description-action.svelte';
  import ChangeLocation from '$lib/components/photos-page/actions/change-location-action.svelte';
  import CreateSharedLink from '$lib/components/photos-page/actions/create-shared-link.svelte';
  import DeleteAssets from '$lib/components/photos-page/actions/delete-assets.svelte';
  import DownloadAction from '$lib/components/photos-page/actions/download-action.svelte';
  import FavoriteAction from '$lib/components/photos-page/actions/favorite-action.svelte';
  import SetVisibilityAction from '$lib/components/photos-page/actions/set-visibility-action.svelte';
  import TagAction from '$lib/components/photos-page/actions/tag-action.svelte';
  import AssetSelectControlBar from '$lib/components/photos-page/asset-select-control-bar.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/button-context-menu.svelte';
  import ControlAppBar from '$lib/components/shared-components/control-app-bar.svelte';
  import GalleryViewer from '$lib/components/shared-components/gallery-viewer/gallery-viewer.svelte';
  import LoadingSpinner from '$lib/components/shared-components/loading-spinner.svelte';
  import SearchBar from '$lib/components/shared-components/search-bar/search-bar.svelte';
  import { AppRoute, QueryParameter } from '$lib/constants';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset, Viewport } from '$lib/managers/timeline-manager/types';
  import { AssetInteraction } from '$lib/stores/asset-interaction.svelte';
  import { assetViewingStore } from '$lib/stores/asset-viewing.store';
  import { mobileDevice } from '$lib/stores/mobile-device.svelte';
  import { lang, locale } from '$lib/stores/preferences.store';
  import { featureFlags } from '$lib/stores/server-config.store';
  import { preferences, user } from '$lib/stores/user.store';
  import { handlePromiseError } from '$lib/utils';
  import { cancelMultiselect } from '$lib/utils/asset-utils';
  import { parseUtcDate } from '$lib/utils/date-time';
  import { handleError } from '$lib/utils/handle-error';
  import { getMetadataSearchQuery } from '$lib/utils/metadata-search';
  import { isAlbumsRoute, isPeopleRoute } from '$lib/utils/navigation';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import {
    type AlbumResponseDto,
    getPerson,
    getTagById,
    type MetadataSearchDto,
    searchAssets,
    searchSmart,
    type SmartSearchDto,
  } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiArrowLeft, mdiDotsVertical, mdiImageOffOutline, mdiPlus, mdiSelectAll } from '@mdi/js';
  import { onDestroy, onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';

  /* Gavin added these two lines as part of the "Show More" feature. */
  let hasActivatedPagination = $state(false);
  const INITIAL_ASSET_LIMIT = 16;

  const MAX_ASSET_COUNT = 5000;
  let { isViewing: showAssetViewer } = assetViewingStore;
  const viewport: Viewport = $state({ width: 0, height: 0 });

  // The GalleryViewer pushes it's own history state, which causes weird
  // behavior for history.back(). To prevent that we store the previous page
  // manually and navigate back to that.
  /* Gavin changed this so PHOTOS is the previous page when we link directly to SEARCH. */
  let previousRoute = $state(AppRoute.PHOTOS as string);

  let nextPage = $state(1);
  let searchResultAlbums: AlbumResponseDto[] = $state([]);
  let searchResultAssets: TimelineAsset[] = $state([]);
  let isLoading = $state(true);
  let scrollY = $state(0);
  let scrollYHistory = 0;

  const assetInteraction = new AssetInteraction();

  type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query'>;
  let searchQuery = $derived(page.url.searchParams.get(QueryParameter.QUERY));
  let inApp = $derived(['1', 'true'].includes(page.url.searchParams.get(QueryParameter.IN_APP) || ''));
  let smartSearchEnabled = $derived($featureFlags.loaded && $featureFlags.smartSearch);
  let terms = $derived(searchQuery ? JSON.parse(searchQuery) : {});

  // Normally, we would use $effect to react to changes in search terms, but we want to
  // avoid unnecessary updates when the search terms are updated by 'Filter Extraction'.
  let shouldReactToTermsChange = true;

  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    terms;
    setTimeout(() => {
      if (!shouldReactToTermsChange) {
        shouldReactToTermsChange = true;
        return;
      }
      handlePromiseError(onSearchQueryUpdate());
    });
  });

  let timelineManager = new TimelineManager();

  const onEscape = () => {
    if ($showAssetViewer) {
      return;
    }

    if (assetInteraction.selectionActive) {
      assetInteraction.selectedAssets = [];
      return;
    }
    handlePromiseError(goto(previousRoute));
  };

  $effect(() => {
    if (scrollY) {
      scrollYHistory = scrollY;
    }
  });

  afterNavigate(({ from }) => {
    // Prevent setting previousRoute to the current page.
    if (from?.url && from.route.id !== page.route.id) {
      previousRoute = from.url.href;
    }
    const route = from?.route?.id;

    if (isPeopleRoute(route)) {
      previousRoute = AppRoute.PHOTOS;
    }

    if (isAlbumsRoute(route)) {
      previousRoute = AppRoute.EXPLORE;
    }

    tick()
      .then(() => {
        window.scrollTo(0, scrollYHistory);
      })
      .catch(() => {
        // do nothing
      });
  });

  const onAssetDelete = (assetIds: string[]) => {
    const assetIdSet = new Set(assetIds);
    searchResultAssets = searchResultAssets.filter((asset: TimelineAsset) => !assetIdSet.has(asset.id));
  };

  const handleSetVisibility = (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    assetInteraction.clearMultiselect();
    onAssetDelete(assetIds);
  };

  const handleSelectAll = () => {
    assetInteraction.selectAssets(searchResultAssets);
  };

  async function onSearchQueryUpdate() {
    /* Gavin added this line as part of the "Show More" feature. If user changes the search query, disable pagination again. */
    hasActivatedPagination = false;

    nextPage = 1;
    searchResultAssets = [];
    searchResultAlbums = [];
    await loadNextPage(true);
  }

  // eslint-disable-next-line svelte/valid-prop-names-in-kit-pages
  export const loadNextPage = async (force?: boolean) => {
    if (!nextPage || searchResultAssets.length >= MAX_ASSET_COUNT) {
      return;
    }
    if (isLoading && !force) {
      return;
    }
    isLoading = true;

    const searchDto: SearchTerms = {
      page: nextPage,
      withExif: true,
      isVisible: true,
      language: $lang,
      ...terms,
    };

    try {
      const { albums, assets, terms: extractedTerms } =
        'query' in searchDto && smartSearchEnabled
          ? await searchSmart({ smartSearchDto: searchDto })
          : await searchAssets({ metadataSearchDto: searchDto });

      searchResultAlbums.push(...albums.items);
      searchResultAssets.push(...assets.items.map((asset) => toTimelineAsset(asset)));

      if (extractedTerms) {
        // loop through the items in the extractedTerms object, compare to the original terms object,
        // and check if any of the values have changed.
        let haveTermsChanged = false;
        for (const key in extractedTerms) {
          if (terms[key] !== (extractedTerms as Record<string, unknown>)[key]) {
            haveTermsChanged = true;
            break;
          }
        }
        if (haveTermsChanged) {
          shouldReactToTermsChange = false;
          const params = getMetadataSearchQuery(extractedTerms);
          await goto(`${AppRoute.SEARCH}?${params}`, { replaceState: true });
        }
      }

      nextPage = Number(assets.nextPage) || 0;
    } catch (error) {
      handleError(error, $t('loading_search_results_failed'));
    } finally {
      isLoading = false;
    }
  };

  function getHumanReadableDate(dateString: string) {
    const date = parseUtcDate(dateString).startOf('day');
    return date.toLocaleString(
      {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      },
      { locale: $locale },
    );
  }

  function getHumanReadableSearchKey(key: keyof SearchTerms): string {
    const keyMap: Partial<Record<keyof SearchTerms, string>> = {
      takenAfter: $t('start_date'),
      takenBefore: $t('end_date'),
      visibility: $t('in_archive'),
      isFavorite: $t('favorite'),
      isNotInAlbum: $t('not_in_any_album'),
      type: $t('media_type'),
      query: $t('context'),
      city: $t('city'),
      country: $t('country'),
      state: $t('state'),
      make: $t('camera_brand'),
      model: $t('camera_model'),
      lensModel: $t('lens_model'),
      personIds: $t('people'),
      tagIds: $t('tags'),
      originalFileName: $t('file_name'),
      description: $t('description'),
    };
    return keyMap[key] || key;
  }

  async function getPersonName(personIds: string[]) {
    const personNames = await Promise.all(
      personIds.map(async (personId) => {
        const person = await getPerson({ id: personId });

        if (person.name == '') {
          return $t('no_name');
        }

        return person.name;
      }),
    );

    return personNames.join(', ');
  }

  async function getTagNames(tagIds: string[] | null) {
    if (tagIds === null) {
      return $t('untagged');
    }
    const tagNames = await Promise.all(
      tagIds.map(async (tagId) => {
        const tag = await getTagById({ id: tagId });

        return tag.value;
      }),
    );

    return tagNames.join(', ');
  }

  const onAddToAlbum = (assetIds: string[]) => {
    cancelMultiselect(assetInteraction);

    if (terms.isNotInAlbum.toString() == 'true') {
      const assetIdSet = new Set(assetIds);
      searchResultAssets = searchResultAssets.filter((asset) => !assetIdSet.has(asset.id));
    }
  };

  function getObjectKeys<T extends object>(obj: T): (keyof T)[] {
    return Object.keys(obj) as (keyof T)[];
  }

  // Kevin: Set the height of photo gallery to fill the viewport minus the top bar's height.
  let height = $state('100vh');
  const updateHeight = () => {
    const viewportHeight = window.visualViewport?.height;
    const isMobile = window.innerWidth < 768; // adjustable breakpoint
    const topBarHeight = isMobile ? '4rem' : '6rem';
    height = viewportHeight ? `calc(${viewportHeight}px - ${topBarHeight})` : `calc(100vh - ${topBarHeight})`;
  };
  onMount(() => {
    updateHeight();
    window.visualViewport?.addEventListener('resize', updateHeight);
    window.addEventListener('resize', updateHeight);
  });
  onDestroy(() => {
    window.visualViewport?.removeEventListener('resize', updateHeight);
    window.removeEventListener('resize', updateHeight);
  });
</script>

<svelte:window bind:scrollY />
<svelte:document use:shortcut={{ shortcut: { key: 'Escape' }, onShortcut: onEscape }} />

<!-- 
  Kevin: Try to solve a problem Gavin found that the images could temporarily overlap the top bar while scrolling upwards. 
  In this fix, the search chips and search results are wrapped in a div with a top margin so that the images will always be below the top bar.
  The margin has been adjusted to align with the 'photos' page, and the chips will be hidden if it is a simple context search.
  Also, the text in the search chips is now truncated to prevent overflow.
-->
<div
  class="mt-16 sm:mt-24 overflow-y-auto w-full"
  style="height: {height};"
>
{#if terms && Object.keys(terms).length > 0 && !(Object.keys(terms).length == 1 && terms.query?.length > 0)}
  <section
    id="search-chips"
    class="mt-2 mb-4 sm:my-5 text-center w-full flex gap-3 place-content-center place-items-center flex-wrap px-14 sm:px-24"
  >
    {#each getObjectKeys(terms) as searchKey (searchKey)}
      {@const value = terms[searchKey]}
      <div class="flex place-content-center place-items-center text-xs w-full">
        <div
          class="bg-immich-primary py-2 pl-4 pr-3 text-white dark:text-black dark:bg-immich-dark-primary
          {value === true ? 'rounded-full' : 'rounded-s-full'}"
        >
          {getHumanReadableSearchKey(searchKey as keyof SearchTerms)}
        </div>

        {#if value !== true}
          <div class="bg-gray-300 py-2 pl-3 pr-4 dark:bg-gray-800 dark:text-white rounded-e-full truncate">
            {#if (searchKey === 'takenAfter' || searchKey === 'takenBefore') && typeof value === 'string'}
              {getHumanReadableDate(value)}
            {:else if searchKey === 'personIds' && Array.isArray(value)}
              {#await getPersonName(value) then personName}
                {personName}
              {/await}
            {:else if searchKey === 'tagIds' && (Array.isArray(value) || value === null)}
              {#await getTagNames(value) then tagNames}
                {tagNames}
              {/await}
            {:else if value === null || value === ''}
              {$t('unknown')}
            {:else}
              {value}
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<section
  class="bg-immich-bg dark:bg-immich-dark-bg mx-2"
  bind:clientHeight={viewport.height}
  bind:clientWidth={viewport.width}
>
  {#if searchResultAlbums.length > 0}
    <section>
      <div class="ms-6 text-4xl font-medium text-black/70 dark:text-white/80">{$t('albums').toUpperCase()}</div>
      <AlbumCardGroup albums={searchResultAlbums} showDateRange showItemCount />

      <div class="m-6 text-4xl font-medium text-black/70 dark:text-white/80">
        {$t('photos_and_videos').toUpperCase()}
      </div>
    </section>
  {/if}
  <!-- Gavin added this as part of the "Show More" feature. Displays a button labeled "Show More" that invokes pagination.
       Gavin also changed `pageHeaderOffset` for mobile to prevent thumbnails from disappearing prematurely when scrolling.
       Gavin also added a check for `hasActivatedPagination` before calling `loadNextPage()`.
       Gavin also added bottom padding to this element to add space between the bottom-most images and the screen bottom when scrolled all the way down. -->
  <section id="search-content" class="pb-6">
    {#if searchResultAssets.length > 0}
      <GalleryViewer
        assets={hasActivatedPagination ? searchResultAssets : searchResultAssets.slice(0, INITIAL_ASSET_LIMIT)}
        {assetInteraction}
        onIntersected={async () => {
          if (hasActivatedPagination) {
            await loadNextPage();
          }
        }}
        showArchiveIcon={true}
        {viewport}
        pageHeaderOffset={mobileDevice.pointerCoarse ? 86 : 54}
      />

    {#if (!hasActivatedPagination && searchResultAssets.length > INITIAL_ASSET_LIMIT)}
      <div class="flex justify-center py-8">
        <button
          type="button"
          class="bg-immich-primary dark:bg-immich-dark-primary text-white dark:text-black font-medium px-6 py-2 rounded-lg shadow-md hover:brightness-110 transition"
          onclick={async () => {
            if (hasActivatedPagination) {
              await loadNextPage();
            } else {
              hasActivatedPagination = true;
            }
          }}
        >
          Show More
        </button>
      </div>
    {/if}
    <!-- END Gavin added -->

    {:else if !isLoading}
      <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
        <div class="flex flex-col content-center items-center text-center">
          <Icon path={mdiImageOffOutline} size="3.5em" />
          <p class="mt-5 text-3xl font-medium">{$t('no_results')}</p>
          <p class="text-base font-normal">{$t('no_results_description')}</p>
        </div>
      </div>
    {/if}

    {#if isLoading}
      <div class="flex justify-center py-16 items-center">
        <LoadingSpinner size="48" />
      </div>
    {/if}
  </section>

  <section>
    {#if assetInteraction.selectionActive}
      <div class="fixed top-0 start-0 w-full">
        <AssetSelectControlBar
          assets={assetInteraction.selectedAssets}
          clearSelect={() => cancelMultiselect(assetInteraction)}
        >
          <CreateSharedLink />
          <IconButton
            shape="round"
            color="secondary"
            variant="ghost"
            aria-label={$t('select_all')}
            icon={mdiSelectAll}
            onclick={handleSelectAll}
          />
          <ButtonContextMenu icon={mdiPlus} title={$t('add_to')}>
            <AddToAlbum {onAddToAlbum} />
            <AddToAlbum shared {onAddToAlbum} />
          </ButtonContextMenu>
          <FavoriteAction
            removeFavorite={assetInteraction.isAllFavorite}
            onFavorite={(ids, isFavorite) => {
              for (const id of ids) {
                const asset = searchResultAssets.find((asset) => asset.id === id);
                if (asset) {
                  asset.isFavorite = isFavorite;
                }
              }
            }}
          />

          <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
            <DownloadAction menuItem />
            <ChangeDate menuItem />
            <ChangeDescription menuItem />
            <ChangeLocation menuItem />
            <!-- Kevin has made 'Archive' and 'Move to locked folder' buttons visible only for admins -->
            {#if $user.isAdmin}
              <ArchiveAction menuItem unarchive={assetInteraction.isAllArchived} />
              {#if assetInteraction.isAllUserOwned}
                <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
              {/if}
              {#if $preferences.tags.enabled && assetInteraction.isAllUserOwned}
                <TagAction menuItem />
              {/if}
            {/if}
            <DeleteAssets menuItem {onAssetDelete} onUndoDelete={onSearchQueryUpdate} />
            <!-- Kevin has made 'Refresh thumbnails' and 'Refresh metadata' buttons visible only for admins -->
            {#if $user.isAdmin}
              <hr />
              <AssetJobActions />
            {/if}
          </ButtonContextMenu>
        </AssetSelectControlBar>
      </div>
    {:else}
      <div class="fixed top-0 start-0 w-full">
        <ControlAppBar onClose={() => goto(previousRoute)} backIcon={mdiArrowLeft} inAppSearch={inApp}>
          <div class="absolute bg-light"></div>
          <!-- Kevin has center-aligned the search box on mobile. -->
          <div class="w-full flex-1 px-2 sm:ps-4">
            <SearchBar grayTheme={false} value={terms?.query ?? ''} searchQuery={terms} />
          </div>
        </ControlAppBar>
      </div>
    {/if}
  </section>
</section>

</div>