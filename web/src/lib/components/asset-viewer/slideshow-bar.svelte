<script lang="ts">
  import { shortcuts } from '$lib/actions/shortcut';
  import ProgressBar from '$lib/components/shared-components/progress-bar/progress-bar.svelte';
  import { ProgressBarStatus } from '$lib/constants';
  import SlideshowSettingsModal from '$lib/modals/SlideshowSettingsModal.svelte';
  import { SlideshowNavigation, slideshowStore } from '$lib/stores/slideshow.store';
  import { IconButton, modalManager } from '@immich/ui';
  import { mdiChevronLeft, mdiChevronRight, mdiClose, mdiCog, mdiFullscreen, mdiPause, mdiPlay } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import { useSwipe } from 'svelte-gestures';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';

  interface Props {
    isFullScreen: boolean;
    isVideo?: boolean;
    videoElement?: HTMLVideoElement | undefined;
    onNext?: () => void;
    onPrevious?: () => void;
    onClose?: () => void;
    onSetToFullScreen?: () => void;
  }

  let {
    isFullScreen,
    isVideo = false,
    videoElement = undefined,
    onNext = () => {},
    onPrevious = () => {},
    onClose = () => {},
    onSetToFullScreen = () => {},
  }: Props = $props();

  let isVideoPaused = $state(true);
  let videoProgress = $state(0);

  $effect(() => {
    const el = videoElement;
    if (!el) {
      return;
    }

    const onPlay = () => (isVideoPaused = false);
    const onPause = () => (isVideoPaused = true);
    const onTimeUpdate = () => {
      videoProgress = el.duration && Number.isFinite(el.duration) ? el.currentTime / el.duration : 0;
    };

    isVideoPaused = el.paused;
    onTimeUpdate();
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTimeUpdate);

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTimeUpdate);
    };
  });

  const toggleVideoPlayback = () => {
    if (!videoElement) {
      return;
    }
    if (videoElement.paused) {
      void videoElement.play();
    } else {
      videoElement.pause();
    }
  };

  const { restartProgress, stopProgress, slideshowDelay, showProgressBar, slideshowNavigation, slideshowAutoplay } =
    slideshowStore;

  let progressBarStatus: ProgressBarStatus | undefined = $state();
  let progressBar = $state<ReturnType<typeof ProgressBar>>();
  let showControls = $state(true);
  let timer: NodeJS.Timeout;
  let isOverControls = $state(false);

  let unsubscribeRestart: () => void;
  let unsubscribeStop: () => void;

  const setCursorStyle = (style: string) => {
    document.body.style.cursor = style;
  };

  const stopControlsHideTimer = () => {
    clearTimeout(timer);
    setCursorStyle('');
  };

  const showControlBar = () => {
    showControls = true;
    stopControlsHideTimer();
    hideControlsAfterDelay();
  };

  const hideControlsAfterDelay = () => {
    timer = setTimeout(() => {
      if (!isOverControls) {
        showControls = false;
        setCursorStyle('none');
      }
    }, 2500);
  };

  onMount(() => {
    hideControlsAfterDelay();
    unsubscribeRestart = restartProgress.subscribe((value) => {
      if (value) {
        progressBar?.restart();
      }
    });

    unsubscribeStop = stopProgress.subscribe((value) => {
      if (value) {
        progressBar?.pause();
        stopControlsHideTimer();
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeRestart) {
      unsubscribeRestart();
    }

    if (unsubscribeStop) {
      unsubscribeStop();
    }
  });

  const handleDone = async () => {
    if (isVideo) {
      // Don't advance for videos — onVideoEnded handles navigation.
      // Reset the progress bar so it loops until the video finishes.
      await progressBar?.restart();
      return;
    }

    await progressBar?.resetProgress();

    if ($slideshowNavigation === SlideshowNavigation.AscendingOrder) {
      onPrevious();
      return;
    }
    onNext();
  };

  const onShowSettings = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
    await modalManager.show(SlideshowSettingsModal);
  };

  onMount(() => {
    function exitFullscreenHandler() {
      const doc = document as Document & {
        webkitIsFullScreen?: boolean;
      };

      if (!document.fullscreenElement && !doc.webkitIsFullScreen) {
        onClose();
      }
    }

    document.addEventListener('fullscreenchange', exitFullscreenHandler);
    document.addEventListener('webkitfullscreenchange', exitFullscreenHandler);

    return () => {
      document.removeEventListener('fullscreenchange', exitFullscreenHandler);
      document.removeEventListener('webkitfullscreenchange', exitFullscreenHandler);
    };
  });

  const { swipe, onswipe, onswipedown } = useSwipe(
    () => {},
    () => ({ touchAction: 'pan-x' }),
    { onswipedown: showControlBar },
    true,
  );
</script>

<svelte:document
  onmousemove={showControlBar}
  use:shortcuts={[
    { shortcut: { key: 'Escape' }, onShortcut: onClose },
    { shortcut: { key: 'ArrowLeft' }, onShortcut: onPrevious },
    { shortcut: { key: 'ArrowRight' }, onShortcut: onNext },
    {
      shortcut: { key: ' ' },
      onShortcut: () => {
        if (isVideo) {
          toggleVideoPlayback();
        } else if (progressBarStatus === ProgressBarStatus.Paused) {
          progressBar?.play();
        } else {
          progressBar?.pause();
        }
      },
      preventDefault: true,
    },
  ]}
/>

{/* @ts-expect-error https://github.com/Rezi/svelte-gestures/issues/38#issuecomment-3315953573 */ null}
<svelte:body {@attach swipe} {onswipe} {onswipedown} />

{#if showControls}
  <div
    class="flex h-12 w-full place-items-center gap-2 bg-black/50 dark"
    onmouseenter={() => (isOverControls = true)}
    onmouseleave={() => (isOverControls = false)}
    transition:fly={{ duration: 150 }}
    role="navigation"
  >
    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      icon={mdiClose}
      onclick={onClose}
      aria-label={$t('exit_slideshow')}
    />

    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      icon={isVideo
        ? (isVideoPaused ? mdiPlay : mdiPause)
        : (progressBarStatus === ProgressBarStatus.Paused ? mdiPlay : mdiPause)}
      onclick={() => {
        if (isVideo) {
          toggleVideoPlayback();
        } else if (progressBarStatus === ProgressBarStatus.Paused) {
          progressBar?.play();
        } else {
          progressBar?.pause();
        }
      }}
      aria-label={isVideo
        ? (isVideoPaused ? $t('play') : $t('pause'))
        : (progressBarStatus === ProgressBarStatus.Paused ? $t('play') : $t('pause'))}
    />
    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      icon={mdiChevronLeft}
      onclick={onPrevious}
      aria-label={$t('previous')}
    />
    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      icon={mdiChevronRight}
      onclick={onNext}
      aria-label={$t('next')}
    />
    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      icon={mdiCog}
      onclick={onShowSettings}
      aria-label={$t('slideshow_settings')}
    />
    {#if !isFullScreen}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        icon={mdiFullscreen}
        onclick={onSetToFullScreen}
        aria-label={$t('set_slideshow_to_fullscreen')}
      />
    {/if}
  </div>
{/if}

{#if isVideo && $showProgressBar}
  <span class="absolute start-0 h-0.75 bg-immich-primary shadow-2xl" style:width={`${videoProgress * 100}%`}></span>
{/if}

<ProgressBar
  autoplay={$slideshowAutoplay}
  hidden={!$showProgressBar || isVideo}
  duration={$slideshowDelay}
  bind:this={progressBar}
  bind:status={progressBarStatus}
  onDone={handleDone}
/>
