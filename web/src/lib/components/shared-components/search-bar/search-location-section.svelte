<script lang="ts" module>
  export interface SearchLocationFilter {
    country?: string;
    state?: string;
    city?: string;
  }
</script>

<script lang="ts">
  import { run } from 'svelte/legacy';

  import Icon from '$lib/components/elements/icon.svelte';
  import Combobox, { asComboboxOptions, asSelectedOption } from '$lib/components/shared-components/combobox.svelte';
  import { handlePromiseError } from '$lib/utils';
  import { getSearchSuggestions, SearchSuggestionType } from '@immich/sdk';
  import { mdiImageMarkerOutline } from '@mdi/js';

  interface Props {
    filters: SearchLocationFilter;
  }

  let { filters = $bindable() }: Props = $props();

  let countries: string[] = $state([]);
  let states: string[] = $state([]);
  let cities: string[] = $state([]);

  async function updateCountries() {
    const results: Array<string | null> = await getSearchSuggestions({
      $type: SearchSuggestionType.Country,
      includeNull: true,
    });

    countries = results.map((result) => result ?? '');

    if (filters.country && !countries.includes(filters.country)) {
      filters.country = undefined;
    }
  }

  async function updateStates(country?: string) {
    const results: Array<string | null> = await getSearchSuggestions({
      $type: SearchSuggestionType.State,
      country,
      includeNull: true,
    });

    states = results.map((result) => result ?? '');

    if (filters.state && !states.includes(filters.state)) {
      filters.state = undefined;
    }
  }

  async function updateCities(country?: string, state?: string) {
    const results: Array<string | null> = await getSearchSuggestions({
      $type: SearchSuggestionType.City,
      country,
      state,
    });

    cities = results.map((result) => result ?? '');

    if (filters.city && !cities.includes(filters.city)) {
      filters.city = undefined;
    }
  }
  let countryFilter = $derived(filters.country);
  let stateFilter = $derived(filters.state);
  run(() => {
    handlePromiseError(updateCountries());
  });
  run(() => {
    handlePromiseError(updateStates(countryFilter));
  });
  run(() => {
    handlePromiseError(updateCities(countryFilter, stateFilter));
  });
</script>

<!-- Kevin has customized text and layout in this component. -->
<div id="location-selection">
  <p class="immich-form-label text-gray-600 text-lg flex items-end -ml-0.5 gap-x-1 leading-6"><Icon path={mdiImageMarkerOutline} class="size-7" />Where was it taken?</p>
  <p class="text-gray-500 text-sm -mt-0.5">Narrow your search by country, state, or city.</p>

  <div class="grid grid-auto-fit-40 gap-5 mt-4">
    <div class="w-full">
      <Combobox
        label=""
        onSelect={(option) => (filters.country = option?.value)}
        options={asComboboxOptions(countries)}
        placeholder="Country"
        selectedOption={asSelectedOption(filters.country)}
      />
    </div>

    <div class="w-full">
      <Combobox
        label=""
        onSelect={(option) => (filters.state = option?.value)}
        options={asComboboxOptions(states)}
        placeholder="State"
        selectedOption={asSelectedOption(filters.state)}
      />
    </div>

    <div class="w-full">
      <Combobox
        label=""
        onSelect={(option) => (filters.city = option?.value)}
        options={asComboboxOptions(cities)}
        placeholder="City"
        selectedOption={asSelectedOption(filters.city)}
      />
    </div>
  </div>
</div>
