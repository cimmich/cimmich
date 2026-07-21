import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SkipLink from './SkipLink.svelte';

afterEach(() => {
  document.querySelector('[data-skip-test]')?.remove();
});

describe('SkipLink', () => {
  it('lets Tab continue into the normal navigation order', async () => {
    const user = userEvent.setup();
    render(SkipLink, { text: 'Skip to content' });
    const next = document.createElement('a');
    next.dataset.skipTest = 'next';
    next.href = '#next';
    next.textContent = 'Next navigation item';
    document.body.append(next);

    const skip = screen.getByRole('button', { name: 'Skip to content' });
    skip.focus();
    await user.keyboard('{Tab}');

    expect(document.activeElement).toBe(next);
  });

  it('moves focus to the main landmark when activated', async () => {
    const user = userEvent.setup();
    render(SkipLink, { text: 'Skip to content' });
    const main = document.createElement('main');
    main.dataset.skipTest = 'main';
    document.body.append(main);

    const skip = screen.getByRole('button', { name: 'Skip to content' });
    skip.focus();
    await user.keyboard('{Enter}');

    expect(document.activeElement).toBe(main);
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('keeps the focused entry control visible and viewport-bounded at reflow widths', async () => {
    render(SkipLink, { text: 'Skip to content' });
    const skip = screen.getByRole('button', { name: 'Skip to content' });
    const wrapper = skip.parentElement;

    expect(wrapper).toHaveClass('sr-only');
    skip.focus();
    await tick();

    expect(wrapper).not.toHaveClass('sr-only');
    expect(wrapper).toHaveClass('fixed', 'z-1000', 'max-w-[calc(100vw-1rem)]');
    expect(skip).toHaveClass('min-h-11', 'max-w-full');
  });
});
