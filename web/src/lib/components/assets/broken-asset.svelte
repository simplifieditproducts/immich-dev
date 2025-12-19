<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiImage } from '@mdi/js';

  interface Props {
    class?: string;
    hideMessage?: boolean;
    width?: string | undefined;
    height?: string | undefined;
  }

  let { class: className = '', hideMessage = false, width = undefined, height = undefined }: Props = $props();
</script>

<div
  class="flex flex-col overflow-hidden max-h-full max-w-full justify-center items-center text-gray-500 bg-gray-100/40 dark:bg-gray-700/40 dark:text-gray-100 p-2 {className}"
  style:width
  style:height
>
  <Icon icon={mdiImage} size="7em" class="max-w-full" />
  {#if !hideMessage}
    <span class="text-center text-sm">Processing...</span>
  {/if}
</div>
