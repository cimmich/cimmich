<script lang="ts">
  import { t } from 'svelte-i18n';

  interface Props {
    /**
     * Target for the skip link to move focus to.
     */
    target?: string;
    /**
     * Text for the skip link button.
     */
    text?: string;
    /**
     * Breakpoint at which the skip link is visible. Defaults to always being visible.
     */
    breakpoint?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  }

  let { target = 'main', text = $t('skip_to_content'), breakpoint }: Props = $props();

  let isFocused = $state(false);

  const moveFocus = () => {
    const targetEl = document.querySelector<HTMLElement>(target);
    if (targetEl) {
      if (!targetEl.hasAttribute('tabindex')) {
        targetEl.tabIndex = -1;
      }
      targetEl.focus();
    }
  };

  const getBreakpoint = () => {
    if (!breakpoint) {
      return '';
    }
    switch (breakpoint) {
      case 'sm': {
        return 'hidden sm:block';
      }
      case 'md': {
        return 'hidden md:block';
      }
      case 'lg': {
        return 'hidden lg:block';
      }
      case 'xl': {
        return 'hidden xl:block';
      }
      case '2xl': {
        return 'hidden 2xl:block';
      }
    }
  };
</script>

<div
  class="fixed inset-s-2 top-2 z-1000 max-w-[calc(100vw-1rem)] transition-transform {isFocused
    ? 'translate-y-0'
    : 'sr-only -translate-y-10'}"
>
  <button
    type="button"
    class="min-h-11 max-w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary {getBreakpoint()}"
    onclick={moveFocus}
    onfocus={() => (isFocused = true)}
    onblur={() => (isFocused = false)}
  >
    {text}
  </button>
</div>
