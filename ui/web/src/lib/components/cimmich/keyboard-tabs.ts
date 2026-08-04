const TAB_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * Adds the expected WAI-ARIA keyboard behaviour to a tablist. Individual tab
 * buttons still own their selected state; this action only moves focus and
 * activates the destination tab.
 */
export const keyboardTabs = (node: HTMLElement) => {
  const onKeydown = (event: KeyboardEvent) => {
    if (!TAB_KEYS.has(event.key)) {
      return;
    }

    const tabs = [...node.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter(
      (tab) => !tab.disabled && tab.getAttribute('aria-disabled') !== 'true',
    );
    const current =
      event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>('[role="tab"]') : null;
    const index = current ? tabs.indexOf(current) : -1;
    if (index < 0 || tabs.length === 0) {
      return;
    }

    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % tabs.length
            : (index - 1 + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    next?.focus();
    next?.click();
  };

  node.addEventListener('keydown', onKeydown);
  return { destroy: () => node.removeEventListener('keydown', onKeydown) };
};
