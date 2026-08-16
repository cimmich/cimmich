<script lang="ts">
  import {
    getCimmichVisibilityStatus,
    lockCimmichPrivateMode,
    createCimmichViewingModeIntentSequence,
    setCimmichViewingMode,
    unlockCimmichPrivateMode,
    type CimmichViewingMode as ViewingMode,
    type CimmichVisibilityStatus,
  } from '$lib/services/cimmich.service';
  import { isViewingModeStatus } from '$lib/managers/cimmich-visibility-intent';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiShieldAlertOutline } from '@mdi/js';
  import { onDestroy, onMount } from 'svelte';
  import {
    loadCimmichViewingModePreference,
    saveCimmichViewingModePreference,
  } from './cimmich-viewing-mode-preference';
  import CimmichViewingModeControl from './CimmichViewingModeControl.svelte';

  interface Props {
    restorePreference?: boolean;
    sourceAssetId?: string;
    variant?: 'dashboard' | 'default' | 'overlay';
  }

  let { restorePreference = true, sourceAssetId, variant = 'default' }: Props = $props();

  let status = $state<CimmichVisibilityStatus>();
  let statusError = $state('');
  let isLoading = $state(true);
  let refreshTimer: number | undefined;
  let loadGeneration = 0;

  const notifyVisibilityChange = () => {
    if (status) {
      cimmichVisibilityManager.recordVisibilityStatus(status);
    }
    cimmichVisibilityManager.notify();
    globalThis.dispatchEvent(new CustomEvent('cimmich:visibility-changed', { detail: status }));
  };

  const loadStatus = async () => {
    const generation = ++loadGeneration;
    isLoading = true;
    statusError = '';
    try {
      const previous = status;
      const loaded = await getCimmichVisibilityStatus();
      if (generation !== loadGeneration) {
        return;
      }
      let next = loaded;
      if (restorePreference) {
        const preferredMode = loadCimmichViewingModePreference();
        if (preferredMode !== loaded.viewingMode && (preferredMode !== 'private' || loaded.privateAuthorized)) {
          const intentSequence = createCimmichViewingModeIntentSequence();
          cimmichVisibilityManager.beginViewingModeIntent(intentSequence);
          const preferred = await setCimmichViewingMode(preferredMode, intentSequence);
          if (
            generation !== loadGeneration ||
            !cimmichVisibilityManager.isCurrentViewingModeIntent(preferred.intentSequence)
          ) {
            return;
          }
          next = preferred;
        }
      }
      status = next;
      cimmichVisibilityManager.recordVisibilityStatus(next);
      if (
        (previous &&
          (previous.viewingMode !== next.viewingMode || previous.privateAuthorized !== next.privateAuthorized)) ||
        loaded.viewingMode !== next.viewingMode
      ) {
        notifyVisibilityChange();
      }
    } catch (error) {
      if (generation === loadGeneration) {
        statusError = error instanceof Error ? error.message : 'Viewing mode is unavailable';
      }
    } finally {
      if (generation === loadGeneration) {
        isLoading = false;
      }
    }
  };

  const selectMode = async (mode: ViewingMode) => {
    loadGeneration += 1;
    statusError = '';
    const intentSequence = createCimmichViewingModeIntentSequence();
    cimmichVisibilityManager.beginViewingModeIntent(intentSequence);
    try {
      const next = await setCimmichViewingMode(mode, intentSequence);
      if (!cimmichVisibilityManager.isCurrentViewingModeIntent(next.intentSequence)) {
        return;
      }
      status = next;
      saveCimmichViewingModePreference(next.viewingMode);
      notifyVisibilityChange();
    } catch (error) {
      statusError = error instanceof Error ? error.message : 'Viewing mode could not be changed';
      throw error;
    }
  };

  const unlock = async (password: string) => {
    loadGeneration += 1;
    statusError = '';
    try {
      await unlockCimmichPrivateMode(password);
      status = await getCimmichVisibilityStatus();
      saveCimmichViewingModePreference('private');
      notifyVisibilityChange();
    } catch (error) {
      statusError = error instanceof Error ? error.message : 'Private could not be unlocked';
      throw error;
    }
  };

  const lock = async () => {
    loadGeneration += 1;
    statusError = '';
    try {
      status = await lockCimmichPrivateMode('explicit');
      saveCimmichViewingModePreference(status.viewingMode);
      notifyVisibilityChange();
    } catch (error) {
      statusError = error instanceof Error ? error.message : 'Private could not be locked';
      throw error;
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'hidden') {
      if (restorePreference) {
        void loadStatus();
      }
      return;
    }
    if (!status?.privateAuthorized) {
      return;
    }
    loadGeneration += 1;
    void lockCimmichPrivateMode('background')
      .then((nextStatus) => {
        status = nextStatus;
        notifyVisibilityChange();
      })
      .catch((error) => {
        statusError = error instanceof Error ? error.message : 'Private could not be locked';
      });
  };

  const handleExternalVisibilityChange = (event: Event) => {
    const next = (event as CustomEvent<unknown>).detail;
    if (isViewingModeStatus(next)) {
      status = next;
      cimmichVisibilityManager.recordVisibilityStatus(next);
    }
  };

  onMount(() => {
    void loadStatus();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    globalThis.addEventListener('cimmich:visibility-changed', handleExternalVisibilityChange);
    refreshTimer = globalThis.window.setInterval(() => void loadStatus(), 30_000);
  });

  onDestroy(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    globalThis.removeEventListener('cimmich:visibility-changed', handleExternalVisibilityChange);
    if (refreshTimer) {
      globalThis.window.clearInterval(refreshTimer);
    }
  });
</script>

{#if status}
  <CimmichViewingModeControl
    disabled={isLoading}
    mode={status.viewingMode}
    onLock={lock}
    onSelectMode={selectMode}
    onUnlock={unlock}
    privateConfigured={status.privateConfigured}
    privateUnlocked={status.privateAuthorized}
    {sourceAssetId}
    {variant}
  />
{:else if statusError}
  <button
    type="button"
    class="flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary {variant ===
    'overlay'
      ? 'text-red-200 drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)] hover:bg-white/10'
      : 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30'}"
    aria-label={`${statusError}. Retry viewing mode`}
    onclick={() => void loadStatus()}
    title="Viewing mode unavailable"
  >
    <Icon icon={mdiShieldAlertOutline} size="24" />
  </button>
{:else}
  <span
    class="block size-11 animate-pulse rounded-full {variant === 'overlay'
      ? 'bg-white/15'
      : 'bg-gray-100 dark:bg-gray-800'}"
    aria-label="Loading viewing mode"
  ></span>
{/if}
