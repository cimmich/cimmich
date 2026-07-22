<script lang="ts">
  import {
    clearCimmichPrivateCredential,
    getCimmichPrivateCredentialStatus,
    setCimmichPrivateCredential,
    type CimmichPrivateCredentialStatus,
  } from '$lib/services/cimmich.service';
  import { Button, Field, PasswordInput } from '@immich/ui';
  import { mdiEyeOffOutline } from '@mdi/js';
  import { Icon } from '@immich/ui';
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  let status = $state<CimmichPrivateCredentialStatus>();
  let loadError = $state('');
  let busy = $state(false);
  let editing = $state(false);
  let notice = $state('');
  let error = $state('');
  let password = $state('');

  const lastChanged = $derived(
    status?.updatedAt ? new Date(status.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '',
  );

  const load = async () => {
    loadError = '';
    try {
      status = await getCimmichPrivateCredentialStatus();
    } catch (error_) {
      loadError = error_ instanceof Error ? error_.message : 'Cimmich is unavailable';
    }
  };

  const reset = () => {
    editing = false;
    password = '';
    error = '';
  };

  const save = async (event: Event) => {
    event.preventDefault();
    busy = true;
    error = '';
    notice = '';
    try {
      status = await setCimmichPrivateCredential(password);
      notice = 'Private view password saved. Any open Private session has been closed.';
      reset();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The password could not be saved';
    } finally {
      busy = false;
    }
  };

  const turnOff = async () => {
    busy = true;
    error = '';
    notice = '';
    try {
      status = await clearCimmichPrivateCredential();
      notice = 'Private view password removed. Private view is unavailable until you set one again.';
      reset();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The password could not be removed';
    } finally {
      busy = false;
    }
  };

  onMount(() => void load());
</script>

<section class="my-4 sm:ms-8">
  <div class="flex flex-col gap-4" in:fade={{ duration: 200 }}>
    <div class="flex gap-3 rounded-2xl bg-gray-50 p-4 text-sm dark:bg-gray-800/60">
      <Icon icon={mdiEyeOffOutline} size="22" class="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
      <div class="flex flex-col gap-2 text-gray-600 dark:text-gray-300">
        <p>
          <span class="font-semibold text-gray-900 dark:text-gray-100">This password filters what is shown.</span>
          It does not control who can reach your library — Immich does that, with your Immich account and its own sign-in.
        </p>
        <p>
          Use it when someone is looking through your photos beside you, or when a TV is playing a slideshow: items you
          have marked Personal or Private stay off the screen in Cimmich until you unlock them. Switching to Immich
          shows everything, by design.
        </p>
        <p class="text-gray-500 dark:text-gray-400">
          Because it is a screen filter and not account security, you can reset it here at any time without entering the
          old one.
        </p>
      </div>
    </div>

    {#if loadError}
      <div class="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 dark:bg-red-950/30">
        <p class="text-sm text-red-700 dark:text-red-300">{loadError}</p>
        <Button shape="round" size="small" variant="ghost" onclick={() => void load()}>Retry</Button>
      </div>
    {:else if status}
      {#if status.privateLockMode === 'none'}
        <p class="text-sm text-gray-600 dark:text-gray-300">
          This installation is configured for passwordless Private view, so no password is needed. Private view is
          available to this device without a prompt.
        </p>
      {:else}
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-gray-700 dark:text-gray-200">
            {#if status.configured}
              <span class="font-semibold">Private view password is on.</span>
              {#if lastChanged}<span class="text-gray-500 dark:text-gray-400">Last changed {lastChanged}.</span>{/if}
            {:else}
              <span class="font-semibold">No password set.</span>
              <span class="text-gray-500 dark:text-gray-400">Private view is unavailable until you set one.</span>
            {/if}
          </p>

          {#if !editing}
            <div class="flex gap-2">
              <Button shape="round" size="small" disabled={busy} onclick={() => ((editing = true), (notice = ''))}>
                {status.configured ? 'Reset password' : 'Set password'}
              </Button>
              {#if status.configured}
                <Button shape="round" size="small" variant="ghost" color="danger" disabled={busy} onclick={turnOff}>
                  Turn off
                </Button>
              {/if}
            </div>
          {/if}
        </div>

        {#if editing}
          <form autocomplete="off" onsubmit={save} in:fade={{ duration: 150 }}>
            <div class="flex flex-col gap-3">
              <Field label={status.configured ? 'New password' : 'Password'} required>
                <PasswordInput bind:value={password} autocomplete="new-password" />
              </Field>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Any length is fine — pick something you can type quickly in front of other people. Saving closes any
                open Private session.
              </p>
              <div class="flex justify-end gap-2">
                <Button shape="round" size="small" variant="ghost" disabled={busy} onclick={reset}>Cancel</Button>
                <Button shape="round" size="small" type="submit" disabled={busy || !password}>Save</Button>
              </div>
            </div>
          </form>
        {/if}

        {#if error}
          <p class="text-sm text-red-600 dark:text-red-300" role="alert">{error}</p>
        {:else if notice}
          <p class="text-sm text-green-700 dark:text-green-300" role="status">{notice}</p>
        {/if}
      {/if}
    {:else}
      <div
        class="h-10 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800"
        aria-label="Loading Private view settings"
      ></div>
    {/if}
  </div>
</section>
