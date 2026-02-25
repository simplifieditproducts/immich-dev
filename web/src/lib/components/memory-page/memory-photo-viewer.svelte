<script lang="ts">
  import { assetViewerFadeDuration } from '$lib/constants';
  import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
  import { getAssetThumbnailUrl } from '$lib/utils';
  import { getAltText } from '$lib/utils/thumbnail-util';
  import { AssetMediaSize } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { onMount } from 'svelte';
  import { useSwipe, type SwipeCustomEvent } from 'svelte-gestures';
  import { fade } from 'svelte/transition';

  interface Props {
    asset: TimelineAsset;
    onImageLoad: () => void;
    onPreviousAsset?: () => void;
    onNextAsset?: () => void;
  }

  const { asset, onImageLoad, onPreviousAsset, onNextAsset }: Props = $props();

  const onSwipe = (event: SwipeCustomEvent) => {
    const { direction } = event.detail;
    if (onNextAsset && direction === 'left') {
      onNextAsset();
    }
    if (onPreviousAsset && direction === 'right') {
      onPreviousAsset();
    }
    if (direction === 'top' || direction === 'bottom') {
      const scrollAmount = direction === 'top' ? 300 : -300;
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    }
  };

  let assetFileUrl: string = $state('');
  let imageLoaded: boolean = $state(false);
  let loader = $state<HTMLImageElement>();

  const onLoadCallback = () => {
    imageLoaded = true;
    assetFileUrl = imageLoaderUrl;
    onImageLoad();
  };

  onMount(() => {
    if (loader?.complete) {
      onLoadCallback();
    }
    loader?.addEventListener('load', onLoadCallback);
    return () => {
      loader?.removeEventListener('load', onLoadCallback);
    };
  });

  const imageLoaderUrl = $derived(getAssetThumbnailUrl({ id: asset.id, size: AssetMediaSize.Preview }));
</script>

{#if !imageLoaded}
  <!-- svelte-ignore a11y_missing_attribute -->
  <img bind:this={loader} style="display:none" src={imageLoaderUrl} aria-hidden="true" />
{/if}

{#if !imageLoaded}
  <div id="spinner" class="flex h-full items-center justify-center">
    <LoadingSpinner />
  </div>
{:else if imageLoaded}
  <div transition:fade={{ duration: assetViewerFadeDuration }} class="h-full w-full" {...useSwipe(onSwipe)}>
    <img
      class="h-full w-full rounded-2xl object-contain transition-all"
      src={assetFileUrl}
      alt={$getAltText(asset)}
      draggable="false"
    />
  </div>
{/if}

<style>
  @keyframes delayedVisibility {
    to {
      visibility: visible;
    }
  }
  #spinner {
    visibility: hidden;
    animation: 0s linear 0.4s forwards delayedVisibility;
  }
</style>
