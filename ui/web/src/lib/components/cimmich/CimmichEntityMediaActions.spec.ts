import '@testing-library/jest-dom';
import { fireEvent, waitFor } from '@testing-library/svelte';
import type { CimmichContextEntity } from '$lib/services/cimmich.service';
import { renderWithTooltips } from '$tests/helpers';
import CimmichEntityMediaActions from './CimmichEntityMediaActions.svelte';
import { saveCimmichEntityMediaActionReceipt } from './entity-media-actions';

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
  Object.defineProperty(globalThis, 'confirm', { configurable: true, value: vi.fn(() => true) });
  Object.defineProperty(globalThis, 'visualViewport', {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      height: 800,
      removeEventListener: vi.fn(),
    },
  });
  return {
    attachContext: vi.fn(),
    changeLabel: vi.fn(),
    createLabel: vi.fn(),
    detachContext: vi.fn(),
    getLabels: vi.fn(() => Promise.resolve([])),
    getEntities: vi.fn((family: string, options: unknown): Promise<CimmichContextEntity[]> => {
      void family;
      void options;
      return Promise.resolve([]);
    }),
    getPeople: vi.fn(() => Promise.resolve([])),
    getPets: vi.fn(() => Promise.resolve([])),
    setPresence: vi.fn(),
    setVisibility: vi.fn(),
    undoLabel: vi.fn(),
    undoContext: vi.fn(),
    undoPresence: vi.fn(),
    undoVisibility: vi.fn(),
    values,
  };
});

vi.mock('$lib/services/cimmich.service', () => ({
  attachCimmichContextAssets: mocks.attachContext,
  changeCimmichAssetLabelMembership: mocks.changeLabel,
  createCimmichAssetLabel: mocks.createLabel,
  createCimmichAssetLabelCommandId: () => 'label-command',
  createCimmichContextCommandId: () => 'context-command',
  createCimmichManualPresenceCommandId: () => 'presence-command',
  createCimmichVisibilityCommandId: () => 'visibility-command',
  detachCimmichContextAssets: mocks.detachContext,
  getCimmichContextEntities: mocks.getEntities,
  getCimmichAssetLabels: mocks.getLabels,
  getCimmichPeople: mocks.getPeople,
  getCimmichPets: mocks.getPets,
  setCimmichManualPresence: mocks.setPresence,
  setCimmichVisibilityObjects: mocks.setVisibility,
  undoCimmichContextDecision: mocks.undoContext,
  undoCimmichAssetLabelDecision: mocks.undoLabel,
  undoCimmichManualPresence: mocks.undoPresence,
  undoCimmichVisibilityDecision: mocks.undoVisibility,
}));

vi.mock('./cimmich-undo-receipt-context.svelte', () => ({
  CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY: 'cimmich.entity-media-action.receipt.v1',
  currentCimmichUndoReceiptContext: () => ({
    ownerId: 'owner-test',
    sessionId: 'session-test',
    viewingMode: 'standard',
  }),
}));

const items = [
  { assetId: 'asset-1', directlyAssigned: true, filename: 'one.jpg', sourceAssetId: 'source-1' },
  { assetId: 'asset-2', directlyAssigned: true, filename: 'two.jpg', sourceAssetId: 'source-2' },
];

describe('CimmichEntityMediaActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.values.clear();
    mocks.getLabels.mockResolvedValue([]);
    mocks.getPeople.mockResolvedValue([]);
    mocks.getPets.mockResolvedValue([]);
    mocks.getEntities.mockResolvedValue([]);
  });

  it('starts neutrally and presents page-aware actions through an icon-led category bar', async () => {
    const { getByRole, getByText, queryByLabelText, queryByText } = renderWithTooltips(CimmichEntityMediaActions, {
      currentScope: { displayName: 'Gulmarrad', entityId: 'place-1', family: 'places' },
      currentSubject: { displayName: 'Avery Example', subjectId: 'person-1', subjectKind: 'person' },
      items,
      onClear: vi.fn(),
    });

    expect(getByText('2 selected')).toBeInTheDocument();
    expect(getByRole('toolbar', { name: 'Selected photo actions' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Organise' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByRole('button', { name: 'People & pets' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Privacy' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Clear selection' })).toBeInTheDocument();
    expect(queryByText('What would you like to do?')).not.toBeInTheDocument();
    expect(queryByText('Choose an icon above to see its actions and controls here.')).not.toBeInTheDocument();
    expect(queryByLabelText('Destination')).not.toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Organise' }));
    expect(getByRole('button', { name: 'Add to Event' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Remove from Gulmarrad' })).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'People & pets' }));
    expect(getByRole('button', { name: 'Mark Avery Example present' })).toBeInTheDocument();
  });

  it('keeps parent-scope actions available for photos already inside a subsection', async () => {
    const onMoveWithinPlace = vi.fn();
    const { getByRole, queryByRole } = renderWithTooltips(CimmichEntityMediaActions, {
      currentScope: { displayName: "Parent's Home", entityId: 'parent-home', family: 'places' },
      items: [{ ...items[0], directlyAssigned: false }],
      moveWithinPlaceTargets: [{ depth: 0, entityId: 'office', label: 'Office', path: 'Office' }],
      onClear: vi.fn(),
      onMoveWithinPlace,
    });

    await fireEvent.click(getByRole('button', { name: 'Organise' }));
    expect(getByRole('button', { name: "Move within Parent's Home" })).toBeInTheDocument();
    expect(queryByRole('button', { name: "Remove from Parent's Home" })).not.toBeInTheDocument();
  });

  it('loads only the current destination list and deduplicates a slow request', async () => {
    let resolveEvents: (value: []) => void = () => undefined;
    mocks.getEntities.mockImplementation((family: string, options: unknown) => {
      void options;
      return family === 'events' ? new Promise<[]>((resolve) => (resolveEvents = resolve)) : Promise.resolve([]);
    });

    const { getByRole } = renderWithTooltips(CimmichEntityMediaActions, { items, onClear: vi.fn() });

    expect(mocks.getEntities).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Organise' }));
    await fireEvent.click(getByRole('button', { name: 'Add to Event' }));
    await waitFor(() => expect(mocks.getEntities).toHaveBeenCalledTimes(1));
    expect(mocks.getEntities).toHaveBeenCalledWith('events', { limit: 500 });
    expect(mocks.getLabels).not.toHaveBeenCalled();
    expect(mocks.getPeople).not.toHaveBeenCalled();
    expect(mocks.getPets).not.toHaveBeenCalled();
    resolveEvents([]);
  });

  it('opens a smart destination dropdown, filters it by typing and requires selection before Apply', async () => {
    mocks.getEntities.mockResolvedValue([
      {
        aliases: [],
        assetCount: 0,
        coverAssetId: null,
        dateEnd: null,
        datePrecision: 'unknown',
        dateStart: null,
        description: null,
        displayName: 'Birthday',
        entityId: 'event-1',
        entityKind: 'event',
        geometry: null,
        parentEntityId: null,
        revision: 1,
        status: 'active',
        typeKind: 'event',
      },
    ]);
    const { getByLabelText, getByRole } = renderWithTooltips(CimmichEntityMediaActions, {
      items,
      onClear: vi.fn(),
    });

    await fireEvent.click(getByRole('button', { name: 'Organise' }));
    await fireEvent.click(getByRole('button', { name: 'Add to Event' }));
    const destination = await waitFor(() => getByLabelText('Destination'));
    await waitFor(() => expect(destination).toBeEnabled());

    await fireEvent.focus(destination);
    expect(getByRole('option', { name: 'Birthday' })).toBeInTheDocument();

    await fireEvent.input(destination, { target: { value: 'Birth' } });
    expect(getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(getByRole('option', { name: 'Birthday' })).toBeInTheDocument();

    await fireEvent.click(getByRole('option', { name: 'Birthday' }));
    expect(getByRole('button', { name: 'Apply' })).toBeEnabled();

    await fireEvent.focus(destination);
    await fireEvent.input(destination, { target: { value: 'Something else' } });
    expect(getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('sets photo privacy through one Cimmich visibility decision and saves Undo', async () => {
    mocks.setVisibility.mockResolvedValue({ decisionId: 'visibility-decision' });
    const onClear = vi.fn();
    const { getByRole, getByText } = renderWithTooltips(CimmichEntityMediaActions, {
      items,
      onClear,
    });

    await fireEvent.click(getByRole('button', { name: 'Privacy' }));
    await fireEvent.click(getByRole('button', { name: 'Set photo privacy to Private' }));
    await fireEvent.click(getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(mocks.setVisibility).toHaveBeenCalledWith(
        [
          { objectId: 'asset-1', objectScope: 'asset', visibilityTier: 'private' },
          { objectId: 'asset-2', objectScope: 'asset', visibilityTier: 'private' },
        ],
        'visibility-command',
      ),
    );
    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(getByText('Undo is saved across navigation and reload.')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Undo last' })).toBeInTheDocument();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('marks the current subject present without creating typed Face evidence', async () => {
    mocks.setPresence.mockResolvedValue({
      changed: true,
      decisionId: 'presence-decision',
      undo: { eligible: true },
    });
    const { getByRole } = renderWithTooltips(CimmichEntityMediaActions, {
      currentSubject: { displayName: 'Avery Example', subjectId: 'person-1', subjectKind: 'person' },
      items: [items[0]],
      onClear: vi.fn(),
    });

    await fireEvent.click(getByRole('button', { name: 'People & pets' }));
    await fireEvent.click(getByRole('button', { name: 'Mark Avery Example present' }));
    await fireEvent.click(getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(mocks.setPresence).toHaveBeenCalledWith('asset-1', {
        action: 'attach',
        commandId: 'presence-command',
        subjectId: 'person-1',
        subjectKind: 'person',
      }),
    );
  });

  it('keeps a saved Undo visible after selection mode closes', async () => {
    saveCimmichEntityMediaActionReceipt(
      globalThis.localStorage,
      {
        action: 'visibility-private',
        assetIds: ['asset-1'],
        completedAt: new Date().toISOString(),
        contextDecisionIds: [],
        label: 'Set photo privacy to Private',
        labelDecisionIds: [],
        presenceDecisionIds: [],
        targetId: '',
        version: 2,
        visibilityDecisionIds: ['visibility-decision'],
      },
      { ownerId: 'owner-test', sessionId: 'session-test', viewingMode: 'standard' },
    );

    const { getByRole, getByText, queryByRole } = renderWithTooltips(CimmichEntityMediaActions, {
      items: [],
      onClear: vi.fn(),
      showControls: false,
    });

    await waitFor(() => expect(getByRole('button', { name: 'Undo last' })).toBeInTheDocument());
    expect(getByText('Undo is saved across navigation and reload.')).toBeInTheDocument();
    expect(queryByRole('toolbar', { name: 'Selected photo actions' })).not.toBeInTheDocument();
  });

  it('moves directly to an explicitly selected deeper Place subsection', async () => {
    const onMoveWithinPlace = vi.fn(() => Promise.resolve(true));
    const { getByLabelText, getByRole, getByText } = renderWithTooltips(CimmichEntityMediaActions, {
      currentScope: { displayName: 'Gulmarrad', entityId: 'place-root', family: 'places' },
      items,
      moveWithinPlaceTargets: [
        { depth: 0, entityId: 'place-home', label: "Parent's Home", path: "Parent's Home" },
        {
          depth: 1,
          entityId: 'place-office',
          label: 'Office',
          path: "Parent's Home › Office",
        },
      ],
      onClear: vi.fn(),
      onMoveWithinPlace,
    });

    await fireEvent.click(getByRole('button', { name: 'Organise' }));
    await fireEvent.click(getByRole('button', { name: 'Move within Gulmarrad' }));
    const destination = getByLabelText('Destination subsection');
    expect(getByRole('button', { name: 'Move 2' })).toBeDisabled();

    await fireEvent.focus(destination);
    expect(getByRole('option', { name: "Parent's Home" })).toBeInTheDocument();
    const office = getByRole('option', { name: "Office Parent's Home › Office" });
    expect(office).toHaveStyle({ paddingInlineStart: '2.25rem' });
    expect(getByText("Parent's Home › Office")).toBeInTheDocument();

    await fireEvent.click(office);
    expect(getByRole('button', { name: 'Move 2' })).toBeEnabled();
    await fireEvent.click(getByRole('button', { name: 'Move 2' }));
    await waitFor(() => expect(onMoveWithinPlace).toHaveBeenCalledWith('place-office'));
  });
});
