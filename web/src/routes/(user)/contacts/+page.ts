import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import { getContacts } from '@immich/sdk';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  let contacts = null;
  try {
    contacts = await getContacts({ raw: 'false' });
  } catch {
    // No contacts backup exists yet
  }

  return {
    contacts,
    meta: {
      title: $t('contacts'),
    },
  };
}) satisfies PageLoad;
