<script lang="ts">
  import { assetViewerFadeDuration } from '$lib/constants';
  import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
  import { autoPlayVideo } from '$lib/stores/preferences.store';
  import { getAssetPlaybackUrl, getAssetThumbnailUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { onMount } from 'svelte';
  import { useSwipe, type SwipeCustomEvent } from 'svelte-gestures';
  import { fade } from 'svelte/transition';

  interface Props {
    asset: TimelineAsset;
    videoPlayer: HTMLVideoElement | undefined;
    videoViewerMuted?: boolean;
    videoViewerVolume?: number;
    onPreviousAsset?: () => void;
    onNextAsset?: () => void;
  }

  let { asset, videoPlayer = $bindable(), videoViewerVolume, videoViewerMuted, onPreviousAsset, onNextAsset }: Props = $props();

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

  let showVideo: boolean = $state(false);

  onMount(() => {
    // Show video after mount to ensure fading in.
    showVideo = true;
  });
</script>

{#if showVideo}
  <div class="h-full w-full bg-pink-9000" transition:fade={{ duration: assetViewerFadeDuration }}>
    <video
      bind:this={videoPlayer}
      autoplay={$autoPlayVideo}
      playsinline
      class="h-full w-full rounded-2xl object-contain transition-all"
      {...useSwipe(onSwipe)}
      src={getAssetPlaybackUrl({ id: asset.id })}
      poster={getAssetThumbnailUrl({ id: asset.id, size: AssetMediaSize.Preview })}
      draggable="false"
      muted={videoViewerMuted}
      volume={videoViewerVolume}
    ></video>
  </div>
{/if}
