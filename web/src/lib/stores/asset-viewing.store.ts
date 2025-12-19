import { authManager } from '$lib/managers/auth-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import { type AssetGridRouteSearchParams } from '$lib/utils/navigation';
import { getAssetInfo, type AssetResponseDto } from '@immich/sdk';
import { Mutex } from 'async-mutex';
import { readonly, writable } from 'svelte/store';

function createAssetViewingStore() {
  const viewingAssetStoreState = writable<AssetResponseDto>();
  const preloadAssets = writable<TimelineAsset[]>([]);
  const viewState = writable<boolean>(false);

  /**
   * Identifies the source of assets being viewed to distinguish between multiple
   * gallery viewers (e.g., when multiple galleries exist on the '/search' page).
   * Each gallery viewer can have its own asset viewer instance.
   * 
   * @known-issue Fresh URL loads to '/photos/<uuid>' default to index 0 in the
   * first gallery due to missing context about the photo's original source and position.
   */
  const dataSourceName = writable<string>('default');

  const viewingAssetMutex = new Mutex();
  const gridScrollTarget = writable<AssetGridRouteSearchParams | null | undefined>();

  const setAsset = (asset: AssetResponseDto, assetsToPreload: TimelineAsset[] = []) => {
    preloadAssets.set(assetsToPreload);
    viewingAssetStoreState.set(asset);
    viewState.set(true);
  };

  const setAssetId = async (id: string): Promise<AssetResponseDto> => {
    const asset = await getAssetInfo({ ...authManager.params, id });
    setAsset(asset);
    return asset;
  };

  const showAssetViewer = (show: boolean) => {
    viewState.set(show);
  };

  return {
    asset: readonly(viewingAssetStoreState),
    mutex: viewingAssetMutex,
    preloadAssets: readonly(preloadAssets),
    isViewing: viewState,
    dataSourceName,
    gridScrollTarget,
    setAsset,
    setAssetId,
    showAssetViewer,
  };
}

export const assetViewingStore = createAssetViewingStore();
