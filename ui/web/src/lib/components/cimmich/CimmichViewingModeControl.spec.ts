import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichViewingModeControl from './CimmichViewingModeControl.svelte';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});

const renderControl = (overrides: Partial<Parameters<typeof render<typeof CimmichViewingModeControl>>[1]> = {}) => {
  const onLock = vi.fn(() => Promise.resolve());
  const onSelectMode = vi.fn(() => Promise.resolve());
  const onUnlock = vi.fn(() => Promise.resolve());
  const result = render(CimmichViewingModeControl, {
    disabled: false,
    mode: 'personal',
    onLock,
    onSelectMode,
    onUnlock,
    privateUnlocked: false,
    switchToImmichHref: '/photos',
    ...overrides,
  });

  return { ...result, onLock, onSelectMode, onUnlock };
};

describe('CimmichViewingModeControl', () => {
  it('exposes the current mode as a compact named control and keeps Immich as a separate destination', async () => {
    const { getByRole } = renderControl();

    const trigger = getByRole('button', { name: 'Viewing mode: Personal' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(getByRole('link', { name: 'Switch to Immich' })).toHaveAttribute('href', '/photos');
  });

  it('keeps the current mode visibly named in the dashboard treatment', () => {
    const { getByText } = renderControl({ variant: 'dashboard' });
    expect(getByText('Personal')).toBeVisible();
  });

  it('changes Standard and Personal through the supplied service callback', async () => {
    const { getByRole, onSelectMode } = renderControl();

    await fireEvent.click(getByRole('button', { name: 'Viewing mode: Personal' }));
    await fireEvent.click(getByRole('button', { name: 'Standard' }));

    await waitFor(() => expect(onSelectMode).toHaveBeenCalledWith('standard'));
  });

  it('keeps the overlay trigger icon-only and its portaled menu interactive', async () => {
    const { getByRole, onSelectMode, queryByText } = renderControl({ variant: 'overlay' });

    const trigger = getByRole('button', { name: 'Viewing mode: Personal' });
    expect(trigger).not.toHaveClass('bg-black/78');
    expect(queryByText('Personal')).not.toBeInTheDocument();

    await fireEvent.click(trigger);
    await fireEvent.click(getByRole('button', { name: 'Standard' }));

    await waitFor(() => expect(onSelectMode).toHaveBeenCalledWith('standard'));
  });

  it('requires an explicit password form before requesting Private unlock', async () => {
    const { getByLabelText, getByRole, onSelectMode, onUnlock } = renderControl();

    await fireEvent.click(getByRole('button', { name: 'Viewing mode: Personal' }));
    await fireEvent.click(getByRole('button', { name: 'Private' }));

    expect(onSelectMode).not.toHaveBeenCalledWith('private');
    const password = getByLabelText('Private password');
    await fireEvent.input(password, { target: { value: '1' } });
    await fireEvent.click(getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith('1'));
  });

  it('offers an explicit lock when a Private session exists', async () => {
    const { getByRole, onLock } = renderControl({ mode: 'private', privateUnlocked: true });

    await fireEvent.click(getByRole('button', { name: 'Viewing mode: Private' }));
    await fireEvent.click(getByRole('button', { name: 'Exit Private mode' }));

    await waitFor(() => expect(onLock).toHaveBeenCalledOnce());
  });

  it('does not ask for a password when the local Private credential is unconfigured', async () => {
    const { getByRole, queryByLabelText, onUnlock } = renderControl({ privateConfigured: false });

    await fireEvent.click(getByRole('button', { name: 'Viewing mode: Personal' }));
    await fireEvent.click(getByRole('button', { name: 'Private' }));

    expect(queryByLabelText('Private password')).not.toBeInTheDocument();
    expect(getByRole('alert')).toHaveTextContent('Private viewing has not been configured');
    expect(onUnlock).not.toHaveBeenCalled();
  });
});
