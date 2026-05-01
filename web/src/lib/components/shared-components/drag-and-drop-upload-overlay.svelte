<script lang="ts">
  import { page } from '$app/state';
  import { shouldIgnoreEvent } from '$lib/actions/shortcut';
  import Logo from '$lib/components/shared-components/logo.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { dragAndDropFilesStore } from '$lib/stores/drag-and-drop-files.store';
  import { getWebDeviceIdForFile } from '$lib/utils/contact-utils';
  import { fileUploadHandler } from '$lib/utils/file-uploader';
  import { handleError } from '$lib/utils/handle-error';
  import { isAlbumsRoute, isContactsRoute, isLockedFolderRoute } from '$lib/utils/navigation';
  import { refreshContacts } from '$lib/stores/contact.store';
  import { uploadContacts } from '@immich/sdk';
  import { toastManager } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  let albumId = $derived(isAlbumsRoute(page.route?.id) ? page.params.albumId : undefined);
  let isInLockedFolder = $derived(isLockedFolderRoute(page.route.id));
  let isOnContactsPage = $derived(isContactsRoute(page.route?.id));

  let dragStartTarget: EventTarget | null = $state(null);

  const onDragEnter = (e: DragEvent) => {
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
      dragStartTarget = e.target;
    }
  };

  const onDragLeave = (e: DragEvent) => {
    if (dragStartTarget === e.target) {
      dragStartTarget = null;
    }
  };

  const onDrop = async (e: DragEvent) => {
    dragStartTarget = null;
    await handleDataTransfer(e.dataTransfer);
  };

  const onPaste = (event: ClipboardEvent) => {
    if (shouldIgnoreEvent(event)) {
      return;
    }

    return handleDataTransfer(event.clipboardData);
  };

  const handleDataTransfer = async (dataTransfer?: DataTransfer | null) => {
    if (!dataTransfer) {
      return;
    }

    if (!browserSupportsDirectoryUpload()) {
      return handleFiles(dataTransfer.files);
    }

    const entries: FileSystemEntry[] = [];
    const files: File[] = [];
    for (const item of dataTransfer.items) {
      // eslint-disable-next-line tscompat/tscompat
      const entry = item.webkitGetAsEntry();
      if (entry) {
        entries.push(entry);
        continue;
      }

      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }

    const directoryFiles = await getAllFilesFromTransferEntries(entries);
    return handleFiles([...files, ...directoryFiles]);
  };

  // eslint-disable-next-line tscompat/tscompat
  const browserSupportsDirectoryUpload = () => typeof DataTransferItem.prototype.webkitGetAsEntry === 'function';

  const getAllFilesFromTransferEntries = async (transferEntries: FileSystemEntry[]): Promise<File[]> => {
    const allFiles: File[] = [];
    let entriesToCheckForSubDirectories = [...transferEntries];
    while (entriesToCheckForSubDirectories.length > 0) {
      const currentEntry = entriesToCheckForSubDirectories.pop();

      if (isFileSystemDirectoryEntry(currentEntry)) {
        entriesToCheckForSubDirectories = entriesToCheckForSubDirectories.concat(
          await getContentsFromFileSystemDirectoryEntry(currentEntry),
        );
      } else if (isFileSystemFileEntry(currentEntry)) {
        allFiles.push(await getFileFromFileSystemEntry(currentEntry));
      }
    }

    return allFiles;
  };

  const isFileSystemDirectoryEntry = (entry?: FileSystemEntry): entry is FileSystemDirectoryEntry =>
    !!entry && entry.isDirectory;
  const isFileSystemFileEntry = (entry?: FileSystemEntry): entry is FileSystemFileEntry => !!entry && entry.isFile;

  const getFileFromFileSystemEntry = async (fileSystemFileEntry: FileSystemFileEntry): Promise<File> => {
    return new Promise((resolve, reject) => {
      fileSystemFileEntry.file(resolve, reject);
    });
  };

  const readEntriesAsync = (reader: FileSystemDirectoryReader) => {
    return new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
  };

  const getContentsFromFileSystemDirectoryEntry = async (
    fileSystemDirectoryEntry: FileSystemDirectoryEntry,
  ): Promise<FileSystemEntry[]> => {
    const reader = fileSystemDirectoryEntry.createReader();
    const files: FileSystemEntry[] = [];
    let entries: FileSystemEntry[];

    do {
      entries = await readEntriesAsync(reader);
      files.push(...entries);
    } while (entries.length > 0);

    return files;
  };

  const handleFiles = async (files?: FileList | File[]) => {
    if (!files) {
      return;
    }

    const filesArray: File[] = Array.from<File>(files);

    if (isOnContactsPage) {
      const vcfFile = filesArray.find((f) => f.name.toLowerCase().endsWith('.vcf'));
      if (vcfFile) {
        await handleVcfUpload(vcfFile);
      }
      return;
    }

    if (authManager.isSharedLink) {
      dragAndDropFilesStore.set({ isDragging: true, files: filesArray });
    } else {
      await fileUploadHandler({ files: filesArray, albumId, isLockedAssets: isInLockedFolder });
    }
  };

  const handleVcfUpload = async (file: File) => {
    try {
      const deviceId = getWebDeviceIdForFile(file.name);
      const body = await file.arrayBuffer();
      await uploadContacts(
        { deviceId },
        { body, headers: { 'Content-Type': 'text/vcard' } } as RequestInit,
      );
      toastManager.success($t('contacts_uploaded'));
      // Signal the contacts page to re-fetch if mounted.
      refreshContacts();
    } catch (error) {
      handleError(error, $t('contacts_upload_failed'));
    }
  };

  const ondragenter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDragEnter(e);
  };

  const ondragleave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDragLeave(e);
  };

  const ondrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await onDrop(e);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
</script>

<svelte:window onpaste={onPaste} />

<svelte:body {ondragenter} {ondragleave} {ondrop} />

{#if dragStartTarget}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 flex h-full w-full flex-col items-center justify-center bg-gray-100/90 text-immich-dark-gray dark:bg-immich-dark-bg/90 dark:text-immich-gray"
    transition:fade={{ duration: 250 }}
    ondragover={onDragOver}
  >
    <Logo variant="icon" size="giant" class="m-16 animate-bounce" />
    <div class="text-2xl">{$t('drop_files_to_upload')}</div>
  </div>
{/if}
