<script lang="ts">
  import type { HTMLImgAttributes } from 'svelte/elements';
  import logoLightUrl from '$lib/assets/shield-logo-with-text.png';  

  interface Props extends HTMLImgAttributes {
    noText?: boolean;
    draggable?: boolean;
  }

  let { noText = false, draggable = false, ...rest }: Props = $props();

</script>

<!-- Gavin customized this so there is only a logo in the top-left of the main UI on desktops.
     We hide this logo on mobile devices, since the WebView already has a logo at the top.  -->
{#if !noText}
  <img src={logoLightUrl} alt="Shield Logo" {draggable} {...rest} />
{/if}