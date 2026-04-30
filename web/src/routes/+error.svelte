<script lang="ts">
  import { page } from '$app/state';
  import ErrorLayout from '$lib/components/layouts/ErrorLayout.svelte';
</script>

<ErrorLayout
  error={page.error
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...page.error, code: (page.error as any).code ?? page.status }
    : page.error}
></ErrorLayout>
