<script lang="ts">
  import { goto } from '$app/navigation';
  import AuthPageLayout from '$lib/components/layouts/AuthPageLayout.svelte';
  import { AppRoute } from '$lib/constants';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { featureFlags, serverConfig } from '$lib/stores/server-config.store';
  import { oauth } from '$lib/utils';
  import { getServerErrorMessage, handleError } from '$lib/utils/handle-error';
  import { login, type LoginResponseDto } from '@immich/sdk';
  import { Alert, Button, Field, Input, PasswordInput, Stack } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { preferences as preferences$, user as user$, resetSavedUser } from '$lib/stores/user.store';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let errorMessage: string = $state('');
  let email = $state('');
  let password = $state('');
  let oauthError = $state('');
  let loading = $state(false);
  let oauthLoading = $state(true);

  const onSuccess = async (user: LoginResponseDto) => {
    console.log(`Calling 'onSuccess' with continueUrl: ${data.continueUrl}`);
    await goto(data.continueUrl, { invalidateAll: true });
    eventManager.emit('auth.login', user);
  };

  const onFirstLogin = async () => await goto(AppRoute.AUTH_CHANGE_PASSWORD);
  const onOnboarding = async () => await goto(AppRoute.AUTH_ONBOARDING);

  onMount(async () => {

    const url = globalThis.location.href

    console.log(`Calling 'onMount() within 'web/src/routes/auth/login/+page.svelte' with url: ${url}`);

    // TODO: Instead of using this, save the values of email and password locally. Remove it immediately after using it.
    console.log(`ResendImmichAutoLoginInfo`);

    // BEGIN auto-login logic added by Gavin.
    // To use auto-login, use `window.postMessage` to pass in `email` and `password` fields while opening the Immich Web UI.
    globalThis.addEventListener("message", (event) => {
      const { autoEmail, autoPassword, autoUrl } = event.data;
      if (!autoEmail || !autoPassword) { return };

      resetSavedUser();

      email = autoEmail;
      password = autoPassword;

      console.log(`Auto-login started with email: ${autoEmail} and autoUrl: ${autoUrl}`);
      handleLogin().catch((error) => console.error("Auto-login failed", error));
    });
    // END auto-login logic added by Gavin.

    if (!$featureFlags.oauth) {
      oauthLoading = false;
      return;
    }

    if (oauth.isCallback(globalThis.location)) {
      try {
        const user = await oauth.login(globalThis.location);

        if (!user.isOnboarded) {
          await onOnboarding();
          return;
        }

        await onSuccess(user);
        return;
      } catch (error) {
        console.error('Error [login-form] [oauth.callback]', error);
        oauthError = getServerErrorMessage(error) || $t('errors.unable_to_complete_oauth_login');
        oauthLoading = false;
      }
    }

    try {
      if (
        ($featureFlags.oauthAutoLaunch && !oauth.isAutoLaunchDisabled(globalThis.location)) ||
        oauth.isAutoLaunchEnabled(globalThis.location)
      ) {
        await goto(`${AppRoute.AUTH_LOGIN}?autoLaunch=0`, { replaceState: true });
        await oauth.authorize(globalThis.location);
        return;
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_connect'));
    }

    oauthLoading = false;
  });

  const handleLogin = async () => {
    try {
      console.log(`Calling 'handleLogin() method'`)
      errorMessage = '';
      loading = true;
      const user = await login({ loginCredentialDto: { email, password } });

      if (user.isAdmin && !$serverConfig.isOnboarded) {
        await onOnboarding();
        return;
      }

      // change the user password before we onboard them
      if (!user.isAdmin && user.shouldChangePassword) {
        await onFirstLogin();
        return;
      }

      // We want to onboard after the first login since their password will change
      // and handleLogin will be called again (relogin). We then do onboarding on that next call.
      if (!user.isOnboarded) {
        await onOnboarding();
        return;
      }

      await onSuccess(user);
      return;
    } catch (error) {
      errorMessage = getServerErrorMessage(error) || $t('errors.incorrect_email_or_password');
      loading = false;
      return;
    }
  };

  const handleOAuthLogin = async () => {
    oauthLoading = true;
    oauthError = '';
    const success = await oauth.authorize(globalThis.location);
    if (!success) {
      oauthLoading = false;
      oauthError = $t('errors.unable_to_login_with_oauth');
    }
  };

  const onsubmit = async (event: Event) => {
    event.preventDefault();
    await handleLogin();
  };
</script>

{#if $featureFlags.loaded}
  <AuthPageLayout title={data.meta.title}>
    <Stack gap={4}>
      {#if $serverConfig.loginPageMessage}
        <Alert color="primary" class="mb-6">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html $serverConfig.loginPageMessage}
        </Alert>
      {/if}

      {#if !oauthLoading && $featureFlags.passwordLogin}
        <form {onsubmit} class="flex flex-col gap-4">
          {#if errorMessage}
            <Alert color="danger" title={errorMessage} closable />
          {/if}

          <Field label={$t('email')}>
            <Input id="email" name="email" type="email" autocomplete="email" bind:value={email} />
          </Field>

          <Field label={$t('password')}>
            <PasswordInput id="password" bind:value={password} autocomplete="current-password" />
          </Field>

          <Button type="submit" size="large" shape="round" fullWidth {loading} class="mt-6">{$t('to_login')}</Button>
        </form>
      {/if}

      {#if $featureFlags.oauth}
        {#if $featureFlags.passwordLogin}
          <div class="inline-flex w-full items-center justify-center my-4">
            <hr class="my-4 h-px w-3/4 border-0 bg-gray-200 dark:bg-gray-600" />
            <span
              class="absolute start-1/2 -translate-x-1/2 bg-gray-50 px-3 font-medium text-gray-900 dark:bg-neutral-900 dark:text-white"
            >
              {$t('or').toUpperCase()}
            </span>
          </div>
        {/if}
        {#if oauthError}
          <Alert color="danger" title={oauthError} closable />
        {/if}
        <Button
          shape="round"
          loading={loading || oauthLoading}
          disabled={loading || oauthLoading}
          size="large"
          fullWidth
          color={$featureFlags.passwordLogin ? 'secondary' : 'primary'}
          onclick={handleOAuthLogin}
        >
          {$serverConfig.oauthButtonText}
        </Button>
      {/if}

      {#if !$featureFlags.passwordLogin && !$featureFlags.oauth}
        <Alert color="warning" title={$t('login_has_been_disabled')} />
      {/if}
    </Stack>
  </AuthPageLayout>
{/if}
