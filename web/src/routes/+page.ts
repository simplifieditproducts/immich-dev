import { AppRoute } from '$lib/constants';
import { serverConfig } from '$lib/stores/server-config.store';
import { getFormatter } from '$lib/utils/i18n';
import { init } from '$lib/utils/server';

import { goto } from '$app/navigation';
import type { UserAdminResponseDto } from '@immich/sdk';
import { redirect } from '@sveltejs/kit';
import { get } from 'svelte/store';
import { loadUser } from '../lib/utils/auth';
import type { PageLoad } from './$types';

export const ssr = false;
export const csr = true;

let authenticatedUser: UserAdminResponseDto | null = null;
let autoLoginData: { autoEmail: string; autoPassword: string; continueUrl: string } | null = null;

export const load = (async ({ fetch, url }) => {
  try {
    const emailFromUrl = url.searchParams.get('email');

    if (emailFromUrl) {
      autoLoginData = await new Promise<{ autoEmail: string; autoPassword: string; continueUrl: string }>((resolve) => {
        const listener = (event: MessageEvent) => {
          const { autoEmail, autoPassword, continueUrl } = event.data;
          if (autoEmail && autoPassword) {
            console.log(`Fetched auto-login credentials in 'web/src/routes/+page.ts' with autoEmail: ${autoEmail} and continueUrl: ${continueUrl}`);
            window.removeEventListener("message", listener);
            resolve({ autoEmail, autoPassword, continueUrl });
          }
        };
        window.addEventListener("message", listener);
      });
    }

    await init(fetch);
    authenticatedUser = await loadUser();

    if (authenticatedUser && autoLoginData) {
      if (autoLoginData.autoEmail && autoLoginData.autoEmail != authenticatedUser.email) {
        localStorage.setItem('autoEmail', autoLoginData.autoEmail);
        localStorage.setItem('autoPassword', autoLoginData.autoPassword);
        console.log(`Redirecting to LOGIN page, because cachedEmail is not the same as the autoEmail`);
        redirect(302, `${AppRoute.AUTH_LOGIN}?continue=${encodeURIComponent(autoLoginData.continueUrl.toString())}`);
      } else {
        console.log(`Redirecting to continueUrl from web/src/routes/+page.ts, because cachedEmail == emailFromUrl`);
        await goto(new URL(autoLoginData.continueUrl.toString()));
        return;
      }
    }

    const isInitialized = get(serverConfig);
    if (isInitialized && autoLoginData) {
      localStorage.setItem('autoEmail', autoLoginData.autoEmail);
      localStorage.setItem('autoPassword', autoLoginData.autoPassword);
      console.log(`Redirecting to LOGIN page, as user is unauthenticated but an admin account exists on the server`);
      redirect(302, `${AppRoute.AUTH_LOGIN}?continue=${encodeURIComponent(autoLoginData.continueUrl.toString())}`);
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