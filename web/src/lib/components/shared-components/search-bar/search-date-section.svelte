<script lang="ts" module>
  export interface SearchDateFilter {
    takenBefore?: string;
    takenAfter?: string;
  }
</script>

<script lang="ts">
  import DateInput from '$lib/elements/DateInput.svelte';
  import { Icon } from '@immich/ui';
  import { mdiCalendarRangeOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    filters: SearchDateFilter;
  }

  let { filters = $bindable() }: Props = $props();

  let invalid = $derived(filters.takenAfter && filters.takenBefore && filters.takenAfter > filters.takenBefore);

  const inputClasses = $derived(
    `immich-form-input w-full mt-1 hover:cursor-pointer ${invalid ? 'border border-danger' : ''}`,
  );
</script>

<!-- Kevin has customized text and layout in this component. -->
<div id="date-range-selection">
  <p class="immich-form-label text-gray-600 text-lg flex items-end -ml-0.5 gap-x-1 leading-6"><Icon icon={mdiCalendarRangeOutline} class="size-7" />When was it taken?</p>
  <p class="text-gray-500 text-sm">Narrow your search by photo's taken date.</p>

  <div class="grid grid-auto-fit-40 gap-5 mt-4">
    <label class="immich-form-label relative" for="start-date">
      <span class="absolute -top-1 left-2 text-xs px-1 rounded-md bg-white dark:bg-gray-800">{$t('start_date')}</span>
      <DateInput
        class="immich-form-input w-full min-w-0 mt-1 hover:cursor-pointer appearance-none"
        type="date"
        id="start-date"
        name="start-date"
        placeholder=""
        max={filters.takenBefore}
        bind:value={filters.takenAfter}
      />
    </label>

    <label class="immich-form-label relative" for="end-date">
      <span class="absolute -top-1 left-2 text-xs px-1 rounded-md bg-white dark:bg-gray-800">{$t('end_date')}</span>
      <DateInput
        class="immich-form-input w-full min-w-0 mt-1 hover:cursor-pointer appearance-none"
        type="date"
        id="end-date"
        name="end-date"
        placeholder=""
        min={filters.takenAfter}
        bind:value={filters.takenBefore}
      />
    </label>
  </div>
  {#if invalid}
    <Text color="danger">{$t('start_date_before_end_date')}</Text>
  {/if}
</div>
