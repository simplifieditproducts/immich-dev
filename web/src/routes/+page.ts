import { AppRoute } from '$lib/constants';
import { serverConfig } from '$lib/stores/server-config.store';
import { getFormatter } from '$lib/utils/i18n';
import { init } from '$lib/utils/server';

import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { loadUser } from '../lib/utils/auth';
import type { PageLoad } from './$types';

export const ssr = false;
export const csr = true;

console.log(`Loading routes/page.ts`);

export const load = (async ({ fetch, url }) => {
  try {
    await init(fetch);
    const authenticated = await loadUser();
    const cachedEmail = authenticated?.email;
    const emailFromUrl = url.searchParams.get('email');

    console.log(`Calling 'load()' in web/src/routes/+page.ts with emailFromUrl: ${emailFromUrl} and cachedEmail: ${cachedEmail}`);

    if (cachedEmail /*&& emailFromUrl*/) {
      if (cachedEmail == emailFromUrl) {
        console.log(`Redirecting to PHOTOS page from web/src/routes/+page.ts, because cachedEmail == emailFromUrl`);
        redirect(302, AppRoute.PHOTOS);
      } else {
        console.log(`Redirecting to LOGIN because cachedEmail != emailFromUrl`)
        redirect(302, `${AppRoute.AUTH_LOGIN}?continue=${encodeURIComponent(url.pathname + url.search)}`);
      }
    }

    const { isInitialized } = get(serverConfig);
    if (isInitialized) {
      // Redirect to login page if there exists an admin account (i.e. server is initialized)
      console.log(`Redirecting to LOGIN page from web/src/routes/+page.ts, as user is unauthenticated but an admin account exists on the server`);
      //redirect(302, AppRoute.AUTH_LOGIN);
      redirect(302, `${AppRoute.AUTH_LOGIN}?continue=${encodeURIComponent(url.pathname + url.search)}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (redirectError: any) {
    if (redirectError?.status === 302) {
      throw redirectError;
    }
  }

  const $t = await getFormatter();

  return {
    meta: {
      title: $t('welcome') + ' 🎉',
      description: $t('immich_web_interface'),
    },
  };
}) satisfies PageLoad;
