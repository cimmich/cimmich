import '@testing-library/jest-dom';
import { fireEvent, render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import CimmichPlaceDeleteDialog from './CimmichPlaceDeleteDialog.svelte';

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

describe('Cimmich Place deletion', () => {
  it('keeps Cimmich tags by default and explains the media/Immich safety boundary', async () => {
    const onconfirm = vi.fn();
    const { getByRole, getByText } = render(CimmichPlaceDeleteDialog, {
      displayName: 'Parents House - Gulmarrad',
      oncancel: vi.fn(),
      onconfirm,
      tagCount: 3,
    });

    expect(getByRole('dialog', { name: 'Delete Parents House - Gulmarrad?' })).toBeInTheDocument();
    expect(getByText(/This cannot be undone/)).toBeInTheDocument();
    expect(getByText('Your photos and videos are untouched.')).toBeInTheDocument();
    expect(getByText(/does not alter raw media or write to the Immich database/)).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Delete place' }));
    expect(onconfirm).toHaveBeenCalledWith(false);
  });

  it('makes deleting the Place tags a distinct explicit choice', async () => {
    const onconfirm = vi.fn();
    const { getByRole } = render(CimmichPlaceDeleteDialog, {
      displayName: 'Parents House',
      oncancel: vi.fn(),
      onconfirm,
      tagCount: 1,
    });

    await fireEvent.click(getByRole('checkbox', { name: /Also delete 1 Cimmich photo tag/ }));
    await fireEvent.click(getByRole('button', { name: 'Delete place and tags' }));
    expect(onconfirm).toHaveBeenCalledWith(true);
  });

  it('uses the same permanent safety model in human-facing Thing copy', async () => {
    const onconfirm = vi.fn();
    const { getByRole, getByText } = render(CimmichPlaceDeleteDialog, {
      displayName: 'ATV',
      entityLabel: 'Thing',
      oncancel: vi.fn(),
      onconfirm,
      tagCount: 1,
    });

    expect(getByText(/permanently removes the Thing from Cimmich/)).toBeInTheDocument();
    expect(getByText(/outside the active Things UI/)).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Delete thing' }));
    expect(onconfirm).toHaveBeenCalledWith(false);
  });

  it('cancels from Escape without performing deletion', async () => {
    const oncancel = vi.fn();
    const onconfirm = vi.fn();
    render(CimmichPlaceDeleteDialog, {
      displayName: 'Cedar House',
      oncancel,
      onconfirm,
      tagCount: 8,
    });

    await userEvent.setup().keyboard('{Escape}');

    expect(oncancel).toHaveBeenCalledOnce();
    expect(onconfirm).not.toHaveBeenCalled();
  });
});
