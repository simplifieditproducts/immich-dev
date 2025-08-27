<script lang="ts">
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
  }

  let { person, onSetBirthDate, onMergePeople, onHidePerson, onToggleFavorite }: Props = $props();
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
    <div class="w-full h-full rounded-xl brightness-95 filter">
      <ImageThumbnail
        shadow
        url={getPeopleThumbnailUrl(person)}
        altText={person.name}
        title={person.name}
        widthStyle="100%"
        circle
      />
      {#if person.isFavorite}
        <div class="absolute top-4 start-4">
          <Icon path={mdiHeart} size="24" class="text-white" />
        </div>
      {/if}
    </div>
  </a>

  <div class="absolute -bottom-10.5 end-0.5 z-1">
    <ButtonContextMenu
      buttonClass="hover:opacity-100 opacity-70"
      color="secondary"
      size="small"
      icon={mdiDotsVertical}
      title={$t('show_person_options')}
      offset={{ x: 0, y: 32 }}
    >
      <MenuOption onClick={onHidePerson} icon={mdiEyeOffOutline} text={$t('hide_person')} />
      <MenuOption onClick={onSetBirthDate} icon={mdiCalendarEditOutline} text={$t('set_date_of_birth')} />
      <MenuOption onClick={onMergePeople} icon={mdiAccountMultipleCheckOutline} text={$t('merge_people')} />
      <MenuOption
        onClick={onToggleFavorite}
        icon={person.isFavorite ? mdiHeartMinusOutline : mdiHeartOutline}
        text={person.isFavorite ? $t('unfavorite') : $t('to_favorite')}
      />
    </ButtonContextMenu>
  </div>
</div>
