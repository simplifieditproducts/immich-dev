<script lang="ts">
  import { videoViewerMuted } from '$lib/stores/preferences.store';
  import { Icon } from '@immich/ui';
  import { mdiFullscreen, mdiFullscreenExit, mdiPause, mdiPlay, mdiVolumeHigh, mdiVolumeOff } from '@mdi/js';

  interface Props {
    videoElement: HTMLVideoElement | undefined;
    controlsVisible: boolean;
  }

  let { videoElement, controlsVisible }: Props = $props();

  let currentTime = $state(0);
  let duration = $state(0);
  let paused = $state(true);
  let isSeeking = $state(false);
  let seekValue = $state(0);

  $effect(() => {
    if (!videoElement) {
      return;
    }

    const onTimeUpdate = () => {
      if (!isSeeking) {
        currentTime = videoElement!.currentTime;
      }
    };

    const onDurationChange = () => {
      duration = videoElement!.duration || 0;
    };

    const onPlay = () => {
      paused = false;
    };

    const onPause = () => {
      paused = true;
    };

    const onLoadedMetadata = () => {
      duration = videoElement!.duration || 0;
    };

    videoElement.addEventListener('timeupdate', onTimeUpdate);
    videoElement.addEventListener('durationchange', onDurationChange);
    videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
    videoElement.addEventListener('play', onPlay);
    videoElement.addEventListener('pause', onPause);

    // Sync initial state
    paused = videoElement.paused;
    duration = videoElement.duration || 0;
    currentTime = videoElement.currentTime;

    return () => {
      videoElement!.removeEventListener('timeupdate', onTimeUpdate);
      videoElement!.removeEventListener('durationchange', onDurationChange);
      videoElement!.removeEventListener('loadedmetadata', onLoadedMetadata);
      videoElement!.removeEventListener('play', onPlay);
      videoElement!.removeEventListener('pause', onPause);
    };
  });

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds)) {
      return '0:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlayPause = async () => {
    if (!videoElement) {
      return;
    }
    if (videoElement.paused) {
      await videoElement.play();
    } else {
      videoElement.pause();
    }
  };

  const toggleMute = () => {
    $videoViewerMuted = !$videoViewerMuted;
  };

  let isFullscreen = $state(false);

  const toggleFullscreen = async () => {
    if (!videoElement) {
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (videoElement.requestFullscreen) {
      await videoElement.requestFullscreen();
    } else if ('webkitEnterFullscreen' in videoElement) {
      // iOS Safari fallback — native video fullscreen (works without HTTPS)
      (videoElement as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
    }
  };

  $effect(() => {
    const onFullscreenChange = () => {
      isFullscreen = !!document.fullscreenElement;
    };

    const onWebkitFullscreenChange = () => {
      isFullscreen = !!(videoElement as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean })?.webkitDisplayingFullscreen;
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    videoElement?.addEventListener('webkitbeginfullscreen', onWebkitFullscreenChange);
    videoElement?.addEventListener('webkitendfullscreen', onWebkitFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      videoElement?.removeEventListener('webkitbeginfullscreen', onWebkitFullscreenChange);
      videoElement?.removeEventListener('webkitendfullscreen', onWebkitFullscreenChange);
    };
  });

  const handleSeekStart = (e: PointerEvent) => {
    e.stopPropagation();
    isSeeking = true;
    updateSeekFromPointer(e);

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
  };

  const handleSeekMove = (e: PointerEvent) => {
    if (!isSeeking) {
      return;
    }
    e.stopPropagation();
    updateSeekFromPointer(e);
  };

  const handleSeekEnd = (e: PointerEvent) => {
    if (!isSeeking) {
      return;
    }
    e.stopPropagation();
    isSeeking = false;
    if (videoElement) {
      videoElement.currentTime = seekValue;
    }
    currentTime = seekValue;
  };

  const updateSeekFromPointer = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekValue = fraction * duration;
    if (videoElement) {
      videoElement.currentTime = seekValue;
    }
  };

  let progress = $derived(duration > 0 ? ((isSeeking ? seekValue : currentTime) / duration) * 100 : 0);
</script>

<!-- Large centered play/pause button -->
<div
  class="absolute inset-0 flex items-center justify-center z-50 transition-opacity duration-300 pointer-events-none"
  class:opacity-0={!controlsVisible}
  class:opacity-100={controlsVisible}
>
  <button
    type="button"
    class="flex items-center justify-center w-20 h-20 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors border-2 border-white/25"
    class:pointer-events-auto={controlsVisible}
    onclick={(e) => { e.stopPropagation(); void togglePlayPause(); }}
    onpointerdown={(e) => e.stopPropagation()}
    aria-label={paused ? 'Play' : 'Pause'}
  >
    <Icon icon={paused ? mdiPlay : mdiPause} size="44" />
  </button>
</div>

<!-- Bottom controls bar -->
<!-- svelte-ignore a11y_interactive_supports_focus, a11y_click_events_have_key_events -->
<div
  role="toolbar"
  class="absolute bottom-0 left-0 right-0 z-50 transition-opacity duration-300"
  class:opacity-0={!controlsVisible}
  class:pointer-events-none={!controlsVisible}
  class:opacity-100={controlsVisible}
  onclick={(e) => e.stopPropagation()}
  onpointerdown={(e) => e.stopPropagation()}
>
  <div class="bg-linear-to-t from-black/60 to-transparent pt-8 pb-4 px-4">
    <!-- Seek bar -->
    <div
      class="relative w-full h-6 flex items-center cursor-pointer group"
      onpointerdown={handleSeekStart}
      onpointermove={handleSeekMove}
      onpointerup={handleSeekEnd}
    >
      <div class="absolute w-full h-1 rounded-full bg-white/30 group-hover:h-1.5 transition-all">
        <div class="h-full rounded-full bg-white" style="width: {progress}%"></div>
      </div>
      <div
        class="absolute w-3 h-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity"
        style="left: {progress}%; transform: translateX(-50%)"
      ></div>
    </div>

    <!-- Time and mute row -->
    <div class="flex items-center justify-between text-white text-xs mt-1">
      <span class="tabular-nums">{formatTime(isSeeking ? seekValue : currentTime)} / {formatTime(duration)}</span>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/20 transition-colors"
          onclick={toggleMute}
          aria-label={$videoViewerMuted ? 'Unmute' : 'Mute'}
        >
          <Icon icon={$videoViewerMuted ? mdiVolumeOff : mdiVolumeHigh} size="20" />
        </button>
        <button
          type="button"
          class="flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/20 transition-colors"
          onclick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          <Icon icon={isFullscreen ? mdiFullscreenExit : mdiFullscreen} size="20" />
        </button>
      </div>
    </div>
  </div>
</div>
