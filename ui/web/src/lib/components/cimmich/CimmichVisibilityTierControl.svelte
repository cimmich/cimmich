<script lang="ts">
  import { clickOutside } from '$lib/actions/click-outside';
  import Portal from '$lib/elements/Portal.svelte';
  import { Icon } from '@immich/ui';
  import { mdiLockOpenVariantOutline, mdiLockOutline, mdiShieldAccountOutline } from '@mdi/js';
  import { tick } from 'svelte';

  export type CimmichVisibilityTier = 'personal' | 'private' | 'standard';

  interface Props {
    disabled?: boolean;
    objectLabel?: string;
    onSelectTier: (tier: CimmichVisibilityTier) => Promise<void>;
    showLabel?: boolean;
    tier: CimmichVisibilityTier;
    variant?: 'default' | 'overlay';
  }

  let {
    disabled = false,
    objectLabel = 'item',
    onSelectTier,
    showLabel = false,
    tier,
    variant = 'default',
  }: Props = $props();

  let busy = $state(false);
  let error = $state('');
  let isOpen = $state(false);
  let overlayMenuStyle = $state('');
  let triggerElement = $state<HTMLButtonElement>();

  const tierLabel = $derived(tier === 'standard' ? 'Standard' : tier === 'personal' ? 'Personal' : 'Private');
  const tierIcon = $derived(
    tier === 'standard' ? mdiLockOpenVariantOutline : tier === 'personal' ? mdiShieldAccountOutline : mdiLockOutline,
  );

  const close = () => {
    const shouldRestoreFocus = isOpen;
    isOpen = false;
    error = '';
    if (shouldRestoreFocus) {
      void tick().then(() => triggerElement?.focus());
    }
  };

  const toggle = () => {
    if (isOpen) {
      close();
      return;
    }
    if (variant === 'overlay' && triggerElement) {
      const rect = triggerElement.getBoundingClientRect();
      const margin = 12;
      const width = Math.min(192, Math.max(0, window.innerWidth - margin * 2));
      const left = Math.min(Math.max(margin, rect.right - width), Math.max(margin, window.innerWidth - width - margin));
      overlayMenuStyle = `left: ${left}px; top: ${rect.bottom + 8}px; width: ${width}px;`;
    }
    isOpen = true;
    void tick().then(() => {
      const menu = document.querySelector<HTMLElement>(`[aria-label="${objectLabel} visibility"]`);
      menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    });
  };

  const handleMenuKeydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const menuItems = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const currentIndex = Math.max(0, menuItems.indexOf(document.activeElement as HTMLElement));
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? menuItems.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % menuItems.length
            : (currentIndex - 1 + menuItems.length) % menuItems.length;
    event.preventDefault();
    menuItems[nextIndex]?.focus();
  };

  const selectTier = async (nextTier: CimmichVisibilityTier) => {
    if (nextTier === tier) {
      close();
      return;
    }

    busy = true;
    error = '';
    try {
      await onSelectTier(nextTier);
      close();
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : `${objectLabel} visibility could not be changed`;
    } finally {
      busy = false;
    }
  };
</script>

{#snippet tierMenu(portaled = false)}
  <div
    class={[
      'z-200 rounded-2xl border p-2 shadow-2xl',
      portaled ? 'fixed' : 'absolute top-[calc(100%+0.5rem)] right-0 w-48',
      variant === 'overlay'
        ? 'border-white/20 bg-black/92 text-white backdrop-blur-sm'
        : 'border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
    ]}
    style={portaled ? overlayMenuStyle : undefined}
    aria-label={`${objectLabel} visibility`}
    role="menu"
    tabindex="-1"
    onpointerdown={(event) => event.stopPropagation()}
    onclick={(event) => event.stopPropagation()}
    onkeydown={handleMenuKeydown}
  >
    {#each [{ icon: mdiLockOpenVariantOutline, label: 'Standard', value: 'standard' as const }, { icon: mdiShieldAccountOutline, label: 'Personal', value: 'personal' as const }, { icon: mdiLockOutline, label: 'Private', value: 'private' as const }] as option (option.value)}
      <button
        type="button"
        class="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-primary {tier ===
        option.value
          ? variant === 'overlay'
            ? 'bg-white text-black'
            : 'bg-primary/10 text-primary dark:bg-immich-dark-primary/15 dark:text-immich-dark-primary'
          : variant === 'overlay'
            ? 'hover:bg-white/12'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800'}"
        aria-checked={tier === option.value}
        disabled={busy}
        onclick={() => void selectTier(option.value)}
        role="menuitemradio"
      >
        <Icon icon={option.icon} size="20" />
        {option.label}
      </button>
    {/each}

    {#if error}
      <p class="px-2 pt-2 text-sm text-red-600 dark:text-red-300" role="alert">{error}</p>
    {/if}
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
    class={[
      'flex min-h-11 items-center justify-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60',
      showLabel ? 'gap-2 px-3' : 'size-11',
      variant === 'overlay'
        ? 'text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)] hover:bg-white/10'
        : 'hover:bg-gray-100 dark:hover:bg-gray-800',
    ]}
    aria-expanded={isOpen}
    aria-haspopup="menu"
    aria-label={`${objectLabel} visibility: ${tierLabel}`}
    data-testid="cimmich-visibility-tier-trigger"
    {disabled}
    onclick={toggle}
    title={`${objectLabel} visibility: ${tierLabel}`}
  >
    <Icon icon={tierIcon} size="24" />
    {#if showLabel}<span class="text-sm font-semibold">{tierLabel}</span>{/if}
  </button>

  {#if isOpen}
    {#if variant === 'overlay'}
      <Portal target="body">{@render tierMenu(true)}</Portal>
    {:else}
      {@render tierMenu()}
    {/if}
  {/if}
</div>
