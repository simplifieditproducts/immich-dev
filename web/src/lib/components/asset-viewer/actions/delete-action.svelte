<script lang="ts">
  import { shortcuts } from '$lib/actions/shortcut';
  import DeleteAssetDialog from '$lib/components/photos-page/delete-asset-dialog.svelte';
  import ToastAction from '$lib/components/ToastAction.svelte';
  import { AssetAction } from '$lib/constants';
  import Portal from '$lib/elements/Portal.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { showDeleteModal } from '$lib/stores/preferences.store';
  import { handleError } from '$lib/utils/handle-error';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { deleteAssets, restoreAssets, type AssetResponseDto } from '@immich/sdk';
  import { IconButton, toastManager } from '@immich/ui';
  import { mdiDeleteForeverOutline, mdiDeleteOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { OnAction, PreAction } from './action';

  interface Props {
    asset: AssetResponseDto;
    onAction: OnAction;
    preAction: PreAction;
  }

  let { asset, onAction, preAction }: Props = $props();

  let showConfirmModal = $state(false);

  const trashOrDelete = async (force = false) => {
    if (force || !featureFlagsManager.value.trash) {
      if ($showDeleteModal) {
        showConfirmModal = true;
        return;
      }
      await deleteAsset();
      return;
    }

    await trashAsset();
  };

  const trashAsset = async () => {
    // Capture asset data at trash time to avoid closure issues if user navigates to another asset
    const trashedAsset = toTimelineAsset(asset);
    const trashedAssetId = asset.id;

    const undoTrash = async () => {
      try {
        await restoreAssets({ bulkIdsDto: { ids: [trashedAssetId] } });
        onAction({ type: AssetAction.RESTORE, asset: trashedAsset });
      } catch (error) {
        handleError(error, $t('errors.unable_to_restore_assets'));
      }
    };

    try {
      preAction({ type: AssetAction.TRASH, asset: trashedAsset });
      await deleteAssets({ assetBulkDeleteDto: { ids: [trashedAssetId] } });
      onAction({ type: AssetAction.TRASH, asset: trashedAsset });
      toastManager.custom(
        {
          component: ToastAction,
          props: {
            title: $t('success'),
            description: $t('moved_to_trash'),
            color: 'success',
            button: {
              color: 'secondary',
              text: $t('undo'),
              onClick: undoTrash,
            },
          },
        },
        { timeout: 5000 },
      );
    } catch (error) {
      handleError(error, $t('errors.unable_to_trash_asset'));
    }
  };

  const deleteAsset = async () => {
    try {
      preAction({ type: AssetAction.DELETE, asset: toTimelineAsset(asset) });
      await deleteAssets({ assetBulkDeleteDto: { ids: [asset.id], force: true } });
      onAction({ type: AssetAction.DELETE, asset: toTimelineAsset(asset) });
      toastManager.success($t('permanently_deleted_asset'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_delete_asset'));
    } finally {
      showConfirmModal = false;
    }
  };
</script>

<svelte:document
  use:shortcuts={[
    { shortcut: { key: 'Delete' }, onShortcut: () => trashOrDelete(asset.isTrashed) },
    { shortcut: { key: 'Delete', shift: true }, onShortcut: () => trashOrDelete(true) },
  ]}
/>

<IconButton
  color="secondary"
  shape="round"
  variant="ghost"
  icon={asset.isTrashed ? mdiDeleteForeverOutline : mdiDeleteOutline}
  aria-label={asset.isTrashed ? $t('permanently_delete') : $t('delete')}
  onclick={() => trashOrDelete(asset.isTrashed)}
/>

{#if showConfirmModal}
  <Portal target="body">
    <DeleteAssetDialog size={1} onCancel={() => (showConfirmModal = false)} onConfirm={deleteAsset} />
  </Portal>
{/if}
