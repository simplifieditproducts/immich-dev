<script lang="ts">
  import { goto } from '$app/navigation';
  import ContactDetail from '$lib/components/contact-detail.svelte';
  import { AppRoute } from '$lib/constants';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<ContactDetail contact={data.contact} onClose={() => goto(AppRoute.CONTACTS)} />
