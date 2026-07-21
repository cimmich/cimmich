import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { CimmichVisibilityObject } from '$lib/services/cimmich.service';
import CimmichObjectVisibility from './CimmichObjectVisibility.svelte';

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return {
    clearUndo: vi.fn(),
    notify: vi.fn(),
    rememberUndo: vi.fn(),
    setObject: vi.fn(),
    undo: vi.fn(),
    undoDecisions: {} as Record<string, string>,
  };
});

vi.mock('$lib/managers/cimmich-visibility-manager.svelte', () => ({
  cimmichVisibilityManager: {
    clearUndo: mocks.clearUndo,
    notify: mocks.notify,
    rememberUndo: mocks.rememberUndo,
    undoDecisions: mocks.undoDecisions,
  },
}));

vi.mock('$lib/services/cimmich.service', () => ({
  setCimmichVisibilityObject: mocks.setObject,
  undoCimmichVisibilityDecision: mocks.undo,
}));

const object: CimmichVisibilityObject = {
  decisionId: null,
  explicit: false,
  objectId: 'place_1',
  objectScope: 'context_entity',
  revision: 0,
  schemaVersion: 'cimmich.visibility.v1',
  visibilityTier: 'standard',
};

describe('Cimmich context entity visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mocks.undoDecisions)) {
      delete mocks.undoDecisions[key];
    }
  });

  it('sets the Place tier through the durable context_entity visibility object', async () => {
    const personal = {
      ...object,
      decisionId: 'decision_1',
      explicit: true,
      revision: 1,
      visibilityTier: 'personal' as const,
    };
    mocks.setObject.mockResolvedValue({ decisionId: 'decision_1', objects: [personal] });
    const onChange = vi.fn();
    const { getByRole, getByText } = render(CimmichObjectVisibility, { object, objectLabel: 'Place', onChange });

    expect(getByText('Standard')).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Place visibility: Standard' }));
    await fireEvent.click(getByRole('menuitemradio', { name: 'Personal' }));

    await waitFor(() => expect(mocks.setObject).toHaveBeenCalledWith('context_entity', 'place_1', 'personal'));
    expect(mocks.rememberUndo).toHaveBeenCalledWith('context_entity', 'place_1', 'decision_1');
    expect(onChange).toHaveBeenCalledWith(personal);
  });
});
