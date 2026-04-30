import { AppRoute } from '$lib/constants';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import { getContact } from '@immich/sdk';
import { error, redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  if (!params.contactId) {
    redirect(302, AppRoute.CONTACTS);
  }

  try {
    const contact = await getContact({ id: params.contactId });
    return {
      contact,
      meta: {
        title: contact.displayName || $t('contacts'),
      },
    };
  } catch {
    error(404, 'Contact not found');
  }
}) satisfies PageLoad;
