<script lang="ts">
  import FaceEditor from '$lib/components/asset-viewer/face-editor/face-editor.svelte';
  import VideoControls from '$lib/components/asset-viewer/video-controls.svelte';
  import VideoRemoteViewer from '$lib/components/asset-viewer/video-remote-viewer.svelte';
  import { assetViewerFadeDuration } from '$lib/constants';
  import { castManager } from '$lib/managers/cast-manager.svelte';
  import { isFaceEditMode } from '$lib/stores/face-edit.svelte';
  import {
    autoPlayVideo,
    loopVideo as loopVideoPreference,
    videoViewerMuted,
    videoViewerVolume,
  } from '$lib/stores/preferences.store';
  import { getAssetOriginalUrl, getAssetPlaybackUrl, getAssetThumbnailUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';
  import { useSwipe, type SwipeCustomEvent } from 'svelte-gestures';
  import { fade } from 'svelte/transition';

  interface Props {
    assetId: string;
    loopVideo: boolean;
    cacheKey: string | null;
    playOriginalVideo: boolean;
    controlsVisible?: boolean;
    onPreviousAsset?: () => void;
    onNextAsset?: () => void;
    onVideoEnded?: () => void;
    onVideoStarted?: (element?: HTMLVideoElement) => void;
    onClose?: () => void;
  }

  let {
    assetId,
    loopVideo,
    cacheKey,
    playOriginalVideo,
    controlsVisible = true,
    onPreviousAsset = () => {},
    onNextAsset = () => {},
    onVideoEnded = () => {},
    onVideoStarted = () => {},
    onClose = () => {},
  }: Props = $props();

  let videoPlayer: HTMLVideoElement | undefined = $state();
  let isLoading = $state(true);
  let assetFileUrl = $derived(
    playOriginalVideo ? getAssetOriginalUrl({ id: assetId, cacheKey }) : getAssetPlaybackUrl({ id: assetId, cacheKey }),
  );
  let isScrubbing = $state(false);
  let showVideo = $state(false);
  let previousAssetFileUrl = $state('');

  onMount(() => {
    // Show video after mount to ensure fading in.
    showVideo = true;
  });

  $effect(() => {
    // Only call load() when the URL changes after initial render (e.g., toggling
    // "play original video"). On initial mount, the src attribute already triggers
    // loading — calling load() again would interrupt autoplay and cause race conditions.
    if (assetFileUrl && videoPlayer && previousAssetFileUrl && previousAssetFileUrl !== assetFileUrl) {
      videoPlayer.load();
    }
    previousAssetFileUrl = assetFileUrl;
  });

  onDestroy(() => {
    if (videoPlayer) {
      videoPlayer.pause();
      videoPlayer.removeAttribute('src');
      videoPlayer.load(); // standard way to release the media resource
    }
  });

  const handleCanPlay = async (video: HTMLVideoElement) => {
    try {
      if (isScrubbing) {
        return;
      }
      if (!video.paused) {
        // autoplay already started playback — just notify
        onVideoStarted(video);
      } else if ($autoPlayVideo) {
        await video.play();
        onVideoStarted(video);
      }
    } catch (error) {
      // auto-play blocked by browser — user can tap the play button
      console.error('Auto-play blocked by browser:', error);
    } finally {
      isLoading = false;
    }
  };


  const onSwipe = (event: SwipeCustomEvent) => {
    if (event.detail.direction === 'left') {
      onNextAsset();
    }
    if (event.detail.direction === 'right') {
      onPreviousAsset();
    }
  };

  let containerWidth = $state(0);
  let containerHeight = $state(0);

  $effect(() => {
    if (isFaceEditMode.value) {
      videoPlayer?.pause();
    }
  });
</script>

{#if showVideo}
  <div
    transition:fade={{ duration: assetViewerFadeDuration }}
    class="flex h-full select-none place-content-center place-items-center"
    bind:clientWidth={containerWidth}
    bind:clientHeight={containerHeight}
  >
    {#if castManager.isCasting}
      <div class="place-content-center h-full place-items-center">
        <VideoRemoteViewer
          poster={getAssetThumbnailUrl({ id: assetId, size: AssetMediaSize.Preview, cacheKey })}
          {onVideoStarted}
          {onVideoEnded}
          {assetFileUrl}
        />
      </div>
    {:else}
      <video
        bind:this={videoPlayer}
        loop={$loopVideoPreference && loopVideo}
        autoplay={$autoPlayVideo}
        playsinline
        disablePictureInPicture
        class="h-full object-contain"
        {...useSwipe(onSwipe)}
        oncanplay={(e) => handleCanPlay(e.currentTarget)}
        onended={onVideoEnded}
        onvolumechange={(e) => ($videoViewerMuted = e.currentTarget.muted)}
        onseeking={() => (isScrubbing = true)}
        onseeked={() => (isScrubbing = false)}
        onplaying={(e) => {
          e.currentTarget.focus();
        }}
        onclose={() => onClose()}
        muted={$videoViewerMuted}
        bind:volume={$videoViewerVolume}
        poster={getAssetThumbnailUrl({ id: assetId, size: AssetMediaSize.Preview, cacheKey })}
        src={assetFileUrl}
      >
      </video>

      <VideoControls videoElement={videoPlayer} {controlsVisible} />

      {#if isLoading}
        <div class="absolute flex place-content-center place-items-center">
          <LoadingSpinner class="fill-gray-300!" />
        </div>
      {/if}

      {#if isFaceEditMode.value}
        <FaceEditor htmlElement={videoPlayer} {containerWidth} {containerHeight} {assetId} />
      {/if}
    {/if}
  </div>
{/if}
