<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    onClick: (e: MouseEvent) => void;
    label: string;
    children?: Snippet;
  }

  let { onClick, label, children }: Props = $props();
</script>

<button
  type="button"
  class="my-auto mx-4 rounded-full p-2 bg-black/70 text-white shadow-lg border border-white/20 transition hover:bg-black/50 hover:scale-110 select-none"
  aria-label={label}
  onclick={onClick}
>
  {@render children?.()}
</button>
