import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import CimmichVisibilityTierControl from './CimmichVisibilityTierControl.svelte';

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

describe('CimmichVisibilityTierControl', () => {
  it('names the object and current tier on the compact control', () => {
    const { getByRole, queryByText } = render(CimmichVisibilityTierControl, {
      objectLabel: 'Photo',
      onSelectTier: vi.fn(() => Promise.resolve()),
      tier: 'standard',
      variant: 'overlay',
    });

    const trigger = getByRole('button', { name: 'Photo visibility: Standard' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).not.toHaveClass('bg-black/78');
    expect(queryByText('Standard')).not.toBeInTheDocument();
  });

  it('can expose an explicit object and tier label in a viewer toolbar', () => {
    const { getByText } = render(CimmichVisibilityTierControl, {
      objectLabel: 'Photo',
      onSelectTier: vi.fn(() => Promise.resolve()),
      showLabel: true,
      showObjectLabel: true,
      tier: 'private',
      variant: 'overlay',
    });

    expect(getByText('Photo · Private')).toBeInTheDocument();
  });

  it('sends an explicit tier change through its supplied service callback', async () => {
    const onSelectTier = vi.fn(() => Promise.resolve());
    const { getByRole } = render(CimmichVisibilityTierControl, {
      objectLabel: 'Photo',
      onSelectTier,
      tier: 'standard',
      variant: 'overlay',
    });

    await fireEvent.click(getByRole('button', { name: 'Photo visibility: Standard' }));
    const privateOption = getByRole('menuitemradio', { name: 'Private' });
    await fireEvent.mouseDown(privateOption);
    await fireEvent.click(privateOption);

    await waitFor(() => expect(onSelectTier).toHaveBeenCalledWith('private'));
  });

  it('supports arrow navigation and Escape from the tier menu', async () => {
    const { getByRole, queryByRole } = render(CimmichVisibilityTierControl, {
      objectLabel: 'Person',
      onSelectTier: vi.fn(() => Promise.resolve()),
      tier: 'standard',
    });
    const user = userEvent.setup();
    const trigger = getByRole('button', { name: 'Person visibility: Standard' });

    await user.click(trigger);
    await waitFor(() => expect(getByRole('menuitemradio', { name: 'Standard' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(getByRole('menuitemradio', { name: 'Personal' })).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
