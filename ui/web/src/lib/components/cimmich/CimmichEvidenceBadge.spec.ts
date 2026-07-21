import '@testing-library/jest-dom';
import { renderWithTooltips } from '$tests/helpers';
import CimmichEvidenceBadge from './CimmichEvidenceBadge.svelte';

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

describe('CimmichEvidenceBadge', () => {
  it('exposes compact evidence information as a named keyboard control', () => {
    const description = 'Existing Pet evidence from the current projection.';
    const { getByRole } = renderWithTooltips(CimmichEvidenceBadge, {
      compact: true,
      description,
      origin: 'system',
    });

    const trigger = getByRole('button', { name: description });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveClass('size-11');
  });

  it('keeps the visible badge form for information that must remain inline', () => {
    const { getByText } = renderWithTooltips(CimmichEvidenceBadge, {
      label: 'Added by you',
      origin: 'user',
    });

    expect(getByText('Added by you')).toBeInTheDocument();
  });
});
