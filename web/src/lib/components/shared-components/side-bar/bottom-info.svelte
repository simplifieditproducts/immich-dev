<script lang="ts">
  // import PurchaseInfo from './purchase-info.svelte';
  import ServerStatus from './server-status.svelte';
  import StorageSpace from './storage-space.svelte';
</script>

<div class="mt-auto">
  <StorageSpace />
</div>

<!-- TODO: we could repurpose this model for our own subscription purchase offers. -->
<!-- Kevin fully commented out this component to solve some eslint warnings. -->
<!-- <PurchaseInfo /> -->

<div class="mb-6 mt-2">
  <ServerStatus />
</div>
