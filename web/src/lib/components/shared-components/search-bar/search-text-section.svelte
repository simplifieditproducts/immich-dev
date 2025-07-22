<script lang="ts">
  import Icon from '$lib/components/elements/icon.svelte';
  import RadioButton from '$lib/components/elements/radio-button.svelte';
  import { user } from '$lib/stores/user.store';
  import { mdiImageOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    query: string | undefined;
    queryType?: 'smart' | 'metadata' | 'description';
  }

  let { query = $bindable(), queryType = $bindable('smart') }: Props = $props();
</script>

<!-- 
Kevin has customized this component:
  - Hide the "Search type" radio buttons for non-admin users
  - Various text and layout adjustments
-->
<div class="flex flex-col gap-4">
  <label for="context-input">
    <p class="immich-form-label text-gray-600 text-lg flex items-end -ml-0.5 gap-x-1 leading-6"><Icon path={mdiImageOutline} class="size-7" />What are you looking for?</p>
    <p class="text-gray-500 text-sm">Example: “Wedding in Hawaii” or “dog at the beach”</p>
  </label>
    
  {#if $user.isAdmin}
    <fieldset>
      <legend class="immich-form-label">{$t('search_type')}</legend>
      <div class="flex flex-wrap gap-x-5 gap-y-2 mt-1 mb-2">
        <RadioButton name="query-type" id="context-radio" label={$t('context')} bind:group={queryType} value="smart" />
        <RadioButton
          name="query-type"
          id="file-name-radio"
          label={$t('file_name_or_extension')}
          bind:group={queryType}
          value="metadata"
        />
        <RadioButton
          name="query-type"
          id="description-radio"
          label={$t('description')}
          bind:group={queryType}
          value="description"
        />
      </div>
    </fieldset>
  {/if}  
{#if queryType === 'smart'}
  <input
    class="immich-form-input hover:cursor-text w-full"
    type="text"
    id="context-input"
    name="context"
    placeholder="Describe your photo here"
    bind:value={query}
  />
{:else if queryType === 'metadata'}
  <!-- <label for="file-name-input" class="immich-form-label">{$t('search_by_filename')}</label> -->
  <input
    class="immich-form-input hover:cursor-text w-full"
    type="text"
    id="file-name-input"
    name="file-name"
    placeholder={$t('search_by_filename_example')}
    bind:value={query}
    aria-labelledby="file-name-label"
  />
{:else if queryType === 'description'}
  <!-- <label for="description-input" class="immich-form-label">{$t('search_by_description')}</label> -->
  <input
    class="immich-form-input hover:cursor-text w-full"
    type="text"
    id="description-input"
    name="description"
    placeholder={$t('search_by_description_example')}
    bind:value={query}
    aria-labelledby="description-label"
  />
{/if}
</div>