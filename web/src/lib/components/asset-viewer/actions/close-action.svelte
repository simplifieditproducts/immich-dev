<script lang="ts">
  import { shortcut } from '$lib/actions/shortcut';
  import { IconButton } from '@immich/ui';
  import { mdiArrowLeft } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
</script>

<svelte:document use:shortcut={{ shortcut: { key: 'Escape' }, onShortcut: onClose }} />

<IconButton
  color="secondary"
  variant="ghost"
  size="large"
  shape="round"
  icon={mdiArrowLeft}
  aria-label={$t('go_back')}
  onclick={onClose}
  class="focus-visible:ring-0 focus-visible:ring-offset-0"
/>
