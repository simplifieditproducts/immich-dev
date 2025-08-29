<script lang="ts">
  import { shortcut } from '$lib/actions/shortcut';
  import Icon from '$lib/components/elements/icon.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/button-context-menu.svelte';
  import { AppRoute, QueryParameter } from '$lib/constants';
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import { type PersonResponseDto } from '@immich/sdk';
  import {
    mdiAccountMultipleCheckOutline,
    mdiCalendarEditOutline,
    mdiDotsVertical,
    mdiEyeOffOutline,
    mdiHeart,
    mdiHeartMinusOutline,
    mdiHeartOutline,
    mdiPencilPlusOutline,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import ImageThumbnail from '../assets/thumbnail/image-thumbnail.svelte';
  import MenuOption from '../shared-components/context-menu/menu-option.svelte';

  interface Props {
    person: PersonResponseDto;
    onSetBirthDate: () => void;
    onMergePeople: () => void;
    onHidePerson: () => void;
    onToggleFavorite: () => void;
    onInputFocusIn: () => void;
    onInputFocusOut: () => void;
    onInput: (e: Event) => void;
  }

  let { person, onSetBirthDate, onMergePeople, onHidePerson, onToggleFavorite, onInputFocusIn, onInputFocusOut, onInput }: Props = $props();
  let currentInputValue = $state(person.name);
</script>

<div
  id="people-card"
  class="relative"
  role="group"
>
  <a
    href="{AppRoute.PEOPLE}/{person.id}?{QueryParameter.PREVIOUS_ROUTE}={AppRoute.PEOPLE}"
    draggable="false"
  >
    <div class="w-full h-full rounded-full brightness-95 filter">
      <ImageThumbnail
        shadow
        url={getPeopleThumbnailUrl(person)}
        altText={person.name}
        title={person.name}
        widthStyle="100%"
        circle
      />
      {#if person.isFavorite}
        <div class="absolute top-6 start-6">
          <Icon path={mdiHeart} size="24" class="text-white" />
        </div>
      {/if}
    </div>
  </a>

  <div class="relative">
    <input
      type="text"
      class="bg-white border-b dark:bg-immich-dark-gray border-gray-300 placeholder-gray-400 text-center dark:border-gray-900 w-full mt-3 py-1.5 font-medium px-3 text-sm text-immich-primary dark:text-immich-dark-primary focus:border-immich-primary focus:dark:border-immich-dark-primary"
      bind:value={currentInputValue}
      placeholder={$t('add_a_name')}
      use:shortcut={{ shortcut: { key: 'Enter' }, onShortcut: (e) => e.currentTarget.blur() }}
      onfocusin={() => onInputFocusIn()}
      onfocusout={() => onInputFocusOut()}
      oninput={(event) => onInput(event)}
    />  
    {#if !currentInputValue || currentInputValue.trim().length === 0}
      <Icon path={mdiPencilPlusOutline} size="20" class="hidden xs:block absolute left-3.5 top-4.5 text-gray-400 dark:text-gray-200" />
    {/if}
  </div>
  <div class="flex mt-2.5 text-gray-600 dark:text-gray-200">
    <button type="button" class="flex-1 border rounded-l-full bg-gray-50 dark:bg-gray-800 dark:border-gray-600 pl-3 pr-1 py-1 text-xs flex items-center gap-x-1 font-semibold truncate select-none hover:bg-gray-200 active:bg-gray-200 dark:active:bg-gray-900 transition-colors duration-300 ease-in-out" onclick={onHidePerson}>
      <Icon path={mdiEyeOffOutline} size="20" class="hidden xs:block flex-none" /> <p class="flex-1 text-center pt-0.5">{$t('hide_person')}</p>
    </button>
    <ButtonContextMenu
      buttonClass="rounded-l-none rounded-r-full border border-l-0 bg-gray-50 dark:bg-gray-800 dark:border-gray-600 active:bg-gray-200 dark:active:bg-gray-900 transition-colors duration-300 ease-in-out"
      color="secondary"
      size="small"
      icon={mdiDotsVertical}
      title={$t('show_person_options')}
      offset={{ x: 0, y: 34 }}
      >
      <MenuOption onClick={onMergePeople} icon={mdiAccountMultipleCheckOutline} text={$t('merge_people')} />
      <MenuOption onClick={onSetBirthDate} icon={mdiCalendarEditOutline} text={$t('set_date_of_birth')} />
      <MenuOption
        onClick={onToggleFavorite}
        icon={person.isFavorite ? mdiHeartMinusOutline : mdiHeartOutline}
        text={person.isFavorite ? $t('unfavorite') : $t('to_favorite')}
      />
    </ButtonContextMenu>
  </div>
</div>
