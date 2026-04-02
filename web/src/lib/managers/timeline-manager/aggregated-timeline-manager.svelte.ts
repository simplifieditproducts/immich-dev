import type { StackResponse } from '$lib/utils/asset-utils';
import { AssetTypeEnum, AssetVisibility } from '@immich/sdk';
import { onDestroy } from 'svelte';
import { TimelineManager } from './timeline-manager.svelte';
import type { TimelineAsset } from './types';

export type MediaFilter = 'all' | 'photo' | 'video';

const filterAssetType: Record<MediaFilter, AssetTypeEnum | undefined> = {
  all: undefined,
  photo: AssetTypeEnum.Image,
  video: AssetTypeEnum.Video,
};

/**
 * Manages multiple TimelineManager instances for media type filtering.
 * Each filter tab (All/Photos/Videos) gets its own lazily-initialized manager
 * that is reused when switching back and forth between tabs.
 *
 * Websocket events are filtered by asset type in WebsocketSupport, so all
 * managers can stay connected simultaneously without assets leaking across tabs.
 *
 * User-initiated mutations (delete, favorite, archive, etc.) are broadcast
 * to all managers so that switching tabs shows consistent data immediately.
 */
export class AggregatedTimelineManager {
  // Using plain Map — SvelteMap would cause state_unsafe_mutation in $derived
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #managerCache = new Map<MediaFilter, TimelineManager>();

  constructor() {
    onDestroy(() => this.destroy());
  }

  getOrCreateManager(filter: MediaFilter): TimelineManager {
    let manager = this.#managerCache.get(filter);
    if (!manager) {
      manager = new TimelineManager();
      this.#managerCache.set(filter, manager);
      void manager.updateOptions({
        visibility: AssetVisibility.Timeline,
        withStacked: true,
        withPartners: true,
        assetType: filterAssetType[filter],
      });
    }
    return manager;
  }

  // --- Broadcast mutations to all cached managers ---

  removeAssets(ids: string[]) {
    for (const manager of this.#managerCache.values()) {
      manager.removeAssets(ids);
    }
  }

  upsertAssets(assets: TimelineAsset[]) {
    for (const manager of this.#managerCache.values()) {
      manager.upsertAssets(assets);
    }
  }

  update(...args: Parameters<TimelineManager['update']>) {
    for (const manager of this.#managerCache.values()) {
      manager.update(...args);
    }
  }

  updateStacked(result: StackResponse) {
    if (result.stack != undefined) {
      this.update(
        [result.stack.primaryAssetId],
        (asset) =>
          (asset.stack = {
            id: result.stack!.id,
            primaryAssetId: result.stack!.primaryAssetId,
            assetCount: result.stack!.assets.length,
          }),
      );
      this.removeAssets(result.toDeleteIds);
    }
  }

  updateUnstacked(assets: TimelineAsset[]) {
    this.update(
      assets.map((asset) => asset.id),
      (asset) => {
        asset.stack = null;
        return { remove: false };
      },
    );
    this.upsertAssets(assets);
  }

  destroy() {
    for (const manager of this.#managerCache.values()) {
      manager.destroy();
    }
    this.#managerCache.clear();
  }
}
