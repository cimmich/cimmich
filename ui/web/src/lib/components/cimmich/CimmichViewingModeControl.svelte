<script lang="ts">
  import { clickOutside } from '$lib/actions/click-outside';
  import Portal from '$lib/elements/Portal.svelte';
  import { Icon } from '@immich/ui';
  import { mdiArrowTopRight, mdiLockOffOutline, mdiLockOutline, mdiShieldAccountOutline } from '@mdi/js';

  export type CimmichViewingMode = 'personal' | 'private' | 'standard';

  interface Props {
    disabled?: boolean;
    mode: CimmichViewingMode;
    onLock: () => Promise<void>;
    onSelectMode: (mode: CimmichViewingMode) => Promise<void>;
    onSwitchToImmich?: () => Promise<void>;
    onUnlock: (password: string) => Promise<void>;
    privateConfigured?: boolean;
    privateUnlocked: boolean;
    switchToImmichHref?: string;
    variant?: 'dashboard' | 'default' | 'overlay';
  }

  let {
    disabled = false,
    mode,
    onLock,
    onSelectMode,
    onSwitchToImmich,
    onUnlock,
    privateConfigured = true,
    privateUnlocked,
    switchToImmichHref = '/photos',
    variant = 'default',
  }: Props = $props();

  let busy = $state(false);
  let error = $state('');
  let isOpen = $state(false);
  let password = $state('');
  let showUnlock = $state(false);
  let overlayPanelStyle = $state('');
  let triggerElement = $state<HTMLButtonElement>();

  const modeLabel = $derived(mode === 'standard' ? 'Standard' : mode === 'personal' ? 'Personal' : 'Private');
  const modeIcon = $derived(
    mode === 'standard' ? mdiLockOutline : mode === 'personal' ? mdiShieldAccountOutline : mdiLockOffOutline,
  );

  const close = () => {
    isOpen = false;
    showUnlock = false;
    password = '';
    error = '';
  };

  const toggle = () => {
    if (isOpen) {
      close();
      return;
    }

    if (variant === 'overlay' && triggerElement) {
      const rect = triggerElement.getBoundingClientRect();
      const margin = 12;
      const width = Math.min(288, Math.max(0, window.innerWidth - margin * 2));
      const left = Math.min(Math.max(margin, rect.right - width), Math.max(margin, window.innerWidth - width - margin));
      overlayPanelStyle = `left: ${left}px; top: ${rect.bottom + 8}px; width: ${width}px;`;
    }

    isOpen = true;
  };

  const selectMode = async (nextMode: CimmichViewingMode) => {
    error = '';
    if (nextMode === 'private' && !privateConfigured) {
      error = 'Private viewing has not been configured on this Cimmich installation';
      return;
    }
    if (nextMode === 'private' && !privateUnlocked) {
      showUnlock = true;
      return;
    }

    busy = true;
    try {
      await onSelectMode(nextMode);
      close();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Viewing mode could not be changed';
    } finally {
      busy = false;
    }
  };

  const unlock = async () => {
    if (!password) {
      error = 'Enter the Private password';
      return;
    }

    busy = true;
    error = '';
    try {
      await onUnlock(password);
      close();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Private could not be unlocked';
    } finally {
      busy = false;
    }
  };

  const lock = async () => {
    busy = true;
    error = '';
    try {
      await onLock();
      close();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Private could not be locked';
    } finally {
      busy = false;
    }
  };

  const switchToImmich = async (event: MouseEvent) => {
    if (!onSwitchToImmich) {
      return;
    }
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await onSwitchToImmich();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'Immich could not be opened';
      busy = false;
    }
  };
</script>

{#snippet viewingModePanel(portaled = false)}
  <div
    class={[
      'z-200 overflow-hidden rounded-2xl border p-2 shadow-2xl',
      portaled ? 'fixed' : 'absolute top-[calc(100%+0.5rem)] right-0 w-72',
      variant === 'overlay'
        ? 'border-white/20 bg-black/92 text-white backdrop-blur-sm'
        : 'border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
    ]}
    style={portaled ? overlayPanelStyle : undefined}
    aria-label="Cimmich viewing mode"
    data-testid="cimmich-viewing-mode-panel"
    role="dialog"
    tabindex="-1"
    onmousedown={(event) => event.stopPropagation()}
    onpointerdown={(event) => event.stopPropagation()}
    onclick={(event) => event.stopPropagation()}
    onkeydown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        close();
      }
    }}
  >
    <div class="grid grid-cols-3 gap-1" aria-label="Choose viewing mode" role="group">
      {#each [{ icon: mdiLockOutline, label: 'Standard', value: 'standard' as const }, { icon: mdiShieldAccountOutline, label: 'Personal', value: 'personal' as const }, { icon: mdiLockOffOutline, label: 'Private', value: 'private' as const }] as option (option.value)}
        <button
          type="button"
          class="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-primary {mode ===
          option.value
            ? variant === 'overlay'
              ? 'bg-white text-black'
              : 'bg-primary/10 text-primary dark:bg-immich-dark-primary/15 dark:text-immich-dark-primary'
            : variant === 'overlay'
              ? 'hover:bg-white/12'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
          aria-pressed={mode === option.value}
          disabled={busy}
          onclick={() => void selectMode(option.value)}
          title={option.value === 'private'
            ? privateConfigured
              ? privateUnlocked
                ? 'Private viewing mode: all photos visible'
                : 'Unlock Private viewing mode'
              : 'Private viewing is not configured'
            : `${option.label} viewing mode`}
        >
          <Icon icon={option.icon} size="22" />
          {option.label}
        </button>
      {/each}
    </div>

    {#if showUnlock}
      <form
        class="mt-2 rounded-xl {variant === 'overlay' ? 'bg-white/10' : 'bg-gray-50 dark:bg-gray-800'} p-3"
        onsubmit={(event) => {
          event.preventDefault();
          void unlock();
        }}
      >
        <label class="sr-only" for="cimmich-private-password">Private password</label>
        <div class="flex gap-2">
          <input
            id="cimmich-private-password"
            class="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 dark:border-gray-600 dark:bg-gray-950 dark:text-white"
            type="password"
            autocomplete="current-password"
            bind:value={password}
            placeholder="Password"
            disabled={busy}
          />
          <button
            type="submit"
            class="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
            disabled={busy}>Unlock</button
          >
        </div>
      </form>
    {:else if privateUnlocked}
      <button
        type="button"
        class="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary {variant ===
        'overlay'
          ? 'text-white/80 hover:bg-white/12'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}"
        disabled={busy}
        onclick={() => void lock()}
      >
        <Icon icon={mdiLockOutline} size="18" />
        Exit Private mode
      </button>
    {/if}

    {#if error}
      <p
        class="px-2 pt-2 text-sm {variant === 'overlay' ? 'text-red-200' : 'text-red-600 dark:text-red-300'}"
        role="alert"
      >
        {error}
      </p>
    {/if}

    <div
      class="mt-2 border-t {variant === 'overlay' ? 'border-white/20' : 'border-gray-200 dark:border-gray-700'} pt-2"
    >
      <a
        class="flex min-h-11 items-center justify-between rounded-xl px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary {variant ===
        'overlay'
          ? 'hover:bg-white/12'
          : 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
        href={switchToImmichHref}
        onclick={switchToImmich}
      >
        <span>Switch to Immich</span>
        <Icon icon={mdiArrowTopRight} size="18" />
      </a>
    </div>
  </div>
{/snippet}

<div
  class="relative"
  use:clickOutside={{
    onOutclick: close,
    onEscape: close,
  }}
>
  <button
    bind:this={triggerElement}
    type="button"
    class="flex h-11 items-center justify-center text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60 {variant ===
    'overlay'
      ? 'size-11 rounded-full text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)] hover:bg-white/10'
      : variant === 'dashboard'
        ? 'gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 text-gray-700 hover:border-primary hover:bg-primary/5 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-immich-dark-primary'
        : 'gap-2 rounded-full px-3 text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}"
    aria-expanded={isOpen}
    aria-haspopup="dialog"
    aria-label={`Viewing mode: ${modeLabel}`}
    data-testid="cimmich-viewing-mode-trigger"
    {disabled}
    onclick={toggle}
    title={`Viewing mode: ${modeLabel}`}
  >
    <Icon icon={modeIcon} size="24" />
    {#if variant !== 'overlay'}
      <span class={variant === 'default' ? 'hidden xl:inline' : ''}>{modeLabel}</span>
    {/if}
  </button>

  {#if isOpen}
    {#if variant === 'overlay'}
      <Portal target="body">{@render viewingModePanel(true)}</Portal>
    {:else}
      {@render viewingModePanel()}
    {/if}
  {/if}
</div>
