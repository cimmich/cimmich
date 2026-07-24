import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichImmichSetup from './CimmichImmichSetup.svelte';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  getPeople: vi.fn(),
  getStatus: vi.fn(),
  importCurrent: vi.fn(),
  preview: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', () => ({
  CimmichServiceError: class extends Error {
    code: string;
    details?: Record<string, unknown>;
    status: number;

    constructor(message: string, options: { code: string; details?: Record<string, unknown>; status: number }) {
      super(message);
      this.code = options.code;
      this.details = options.details;
      this.status = options.status;
    }
  },
  connectCimmichImmich: mocks.connect,
  getCimmichPeople: mocks.getPeople,
  getCimmichImmichOnboardingStatus: mocks.getStatus,
  importCimmichImmichOnboarding: mocks.importCurrent,
  previewCimmichImmichOnboarding: mocks.preview,
}));

const connection = {
  capabilities: {
    assetRead: true,
    assetSearch: true,
    faceRead: true,
    mediaRead: true,
    personList: true,
    personRead: true,
  },
  databaseIsolation: 'separate',
  immichVersion: '3.0.3',
  principal: { isAdmin: true, userId: 'owner-fixture' },
  readOnly: true,
  schemaVersion: 'cimmich.immich-companion.v1',
  state: 'ready',
  supportedRange: '>=3.0.0 <4.0.0',
};

const readyStatus = {
  connection,
  latestRun: null,
  next: 'preview',
  schemaVersion: 'cimmich.immich-onboarding.v1',
};

const scope = {
  importPeople: true,
  includeHiddenPeople: false,
  mediaKinds: ['image', 'video'],
  providerMode: 'deferred',
  visibilities: ['timeline'],
};

const preview = {
  connection: {
    immichVersion: '3.0.3',
    permissionVerification: 'verified',
    permissions: {
      assets: true,
      faces: true,
      locked: 'interactive_elevated_session_required',
      media: true,
      people: true,
    },
    principalId: 'owner-fixture',
    readOnly: true,
  },
  counts: {
    assignedFaces: 12,
    assets: 56,
    hiddenPeople: 0,
    images: 56,
    labelledPeople: 6,
    people: 6,
    unassignedFaces: 4,
    unlabelledPeople: 0,
    videos: 0,
    visibilityLanes: { timeline: 56 },
  },
  coverage: { visibilityLanes: { timeline: { accessState: 'available', itemCount: 56 } } },
  previewDigest: 'a'.repeat(64),
  schemaVersion: 'cimmich.immich-onboarding.v1',
  scope,
  unsupported: {
    albums: 'not_exposed_by_onboarding_v1',
    exif: 'separate_disclosed_choice_not_exposed',
    genericTags: 'separate_disclosed_choice_not_exposed',
    locked: 'interactive_elevated_session_required',
  },
};

describe('Cimmich first-run Immich setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPeople.mockResolvedValue([]);
  });

  it('keeps the credential write-only and transitions into a connected preview journey', async () => {
    mocks.getStatus.mockResolvedValueOnce({
      ...readyStatus,
      connection: {
        ...connection,
        capabilities: Object.fromEntries(Object.keys(connection.capabilities).map((key) => [key, false])),
        immichVersion: undefined,
        principal: undefined,
        state: 'not_configured',
      },
      next: 'connect',
    });
    mocks.connect.mockResolvedValue({ changed: true, connection, replayed: false, state: 'connected' });
    mocks.getStatus.mockResolvedValueOnce(readyStatus);
    const { getByLabelText, getByRole, queryByDisplayValue } = render(CimmichImmichSetup);

    await waitFor(() => expect(getByRole('button', { name: 'Verify and connect' })).toBeInTheDocument());
    await fireEvent.input(getByLabelText('Immich server'), { target: { value: 'http://immich.test:2283' } });
    await fireEvent.input(getByLabelText('Read-only API key'), { target: { value: 'write-only-secret-value' } });
    await fireEvent.click(getByRole('button', { name: 'Verify and connect' }));

    await waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
    expect(mocks.connect.mock.calls[0][0]).toMatchObject({
      apiBaseUrl: 'http://immich.test:2283',
      credential: 'write-only-secret-value',
    });
    await waitFor(() => expect(getByRole('button', { name: 'Preview this scope' })).toBeInTheDocument());
    expect(queryByDisplayValue('write-only-secret-value')).not.toBeInTheDocument();
  });

  it('previews before mutation and imports the exact digest and scope', async () => {
    const onChanged = vi.fn();
    mocks.getStatus.mockResolvedValue(readyStatus);
    mocks.preview.mockResolvedValue(preview);
    mocks.importCurrent.mockResolvedValue({
      changed: true,
      commandId: 'onboarding.import.fixture',
      import: {
        ambiguous: 0,
        assignedFaces: 12,
        exactProviderBinds: 5,
        importedSourceFaces: 7,
        personConflicts: 0,
        projectedPeople: 6,
        reviewItems: 0,
        unassignedFaces: 4,
      },
      inventory: { activeAssets: 56, runId: 'inventory-fixture' },
      next: {
        action: 'configure_provider_or_build_when_ready',
        automaticIdentityAuthority: 'none',
        sourcePackActivation: 'not_performed',
      },
      replayed: false,
      runId: 'onboarding-fixture',
      schemaVersion: 'cimmich.immich-onboarding.v1',
      state: 'completed',
    });
    const { getAllByText, getByRole, getByText } = render(CimmichImmichSetup, { onChanged });

    await waitFor(() => expect(getByRole('button', { name: 'Preview this scope' })).toBeInTheDocument());
    await fireEvent.click(getByRole('button', { name: 'Preview this scope' }));
    await waitFor(() => expect(getByText('Current preview')).toBeInTheDocument());
    expect(getByText(/56 supported media/)).toBeInTheDocument();
    expect(getAllByText('Not included')).toHaveLength(2);
    expect(getAllByText('Excluded')).toHaveLength(2);
    expect(mocks.importCurrent).not.toHaveBeenCalled();

    await fireEvent.click(getByRole('button', { name: 'Import this preview' }));
    await waitFor(() => expect(mocks.importCurrent).toHaveBeenCalledOnce());
    expect(mocks.importCurrent.mock.calls[0][0]).toMatchObject({ previewDigest: 'a'.repeat(64), scope });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('holds unnamed upstream face groups for review without blocking the safe first import', async () => {
    mocks.getPeople.mockResolvedValue([
      { person_id: 'person-1', subject_kind: 'person' },
      { person_id: 'person-2', subject_kind: 'person' },
      { person_id: 'pet-1', subject_kind: 'pet' },
    ]);
    mocks.getStatus.mockResolvedValue(readyStatus);
    mocks.preview.mockResolvedValue({
      ...preview,
      counts: {
        ...preview.counts,
        assignedFaces: 53,
        labelledPeople: 0,
        unassignedFaces: 8,
        unlabelledPeople: 8,
      },
    });
    const { getByRole, getByText } = render(CimmichImmichSetup);

    await waitFor(() => expect(getByText(/Your 2 existing Cimmich People are preserved/)).toBeInTheDocument());
    expect(getByRole('link', { name: 'Not now — continue using Cimmich' })).toHaveAttribute('href', '/cimmich/home');

    await fireEvent.click(getByRole('button', { name: 'Preview this scope' }));
    await waitFor(() => expect(getByText(/0 labelled Immich People/)).toBeInTheDocument());
    expect(getByText(/8 unnamed Immich face groups/)).toBeInTheDocument();
    expect(getByText(/53 Faces assigned upstream/)).toBeInTheDocument();
    expect(getByRole('button', { name: 'Import this preview' })).toBeEnabled();
    expect(getByText(/groups will remain unresolved/)).toBeInTheDocument();
    expect(getByText(/Media and labelled People can import now/)).toBeInTheDocument();
  });

  it('turns a completed import into a clear ready state with optional next steps', async () => {
    mocks.getStatus.mockResolvedValue({
      ...readyStatus,
      latestRun: {
        commandId: 'onboarding.import.completed',
        completedAt: '2026-07-24T00:00:01.000Z',
        previewDigest: 'a'.repeat(64),
        progress: { processedAssets: 56 },
        result: {
          changed: true,
          commandId: 'onboarding.import.completed',
          import: {
            assignedFaces: 12,
            projectedPeople: 6,
            reviewItems: 8,
          },
          inventory: { activeAssets: 56, runId: 'inventory-fixture' },
          next: {
            action: 'configure_provider_or_build_when_ready',
            automaticIdentityAuthority: 'none',
            sourcePackActivation: 'not_performed',
          },
          replayed: false,
          runId: 'onboarding-fixture',
          schemaVersion: 'cimmich.immich-onboarding.v1',
          state: 'completed_with_review',
        },
        runId: 'onboarding-fixture',
        scope,
        startedAt: '2026-07-24T00:00:00.000Z',
        state: 'completed',
        updatedAt: '2026-07-24T00:00:01.000Z',
      },
      next: 'review_summary',
    });
    const { getByRole, getByText, queryByRole } = render(CimmichImmichSetup);

    await waitFor(() => expect(getByRole('heading', { name: 'Core library ready' })).toBeInTheDocument());
    expect(getByText('56 media ready')).toBeInTheDocument();
    expect(getByText('6 People')).toBeInTheDocument();
    expect(getByText('8 recorded exceptions')).toBeInTheDocument();
    expect(getByRole('link', { name: 'Open Cimmich' })).toHaveAttribute('href', '/cimmich/home');
    expect(getByRole('link', { name: 'Optional matching' })).toHaveAttribute('href', '#cimmich-face-matching-title');
    expect(queryByRole('button', { name: 'Preview this scope' })).not.toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: 'Update import' }));
    expect(getByRole('button', { name: 'Preview this scope' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Cancel update' })).toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: 'Cancel update' }));
    expect(getByRole('heading', { name: 'Core library ready' })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Preview this scope' })).not.toBeInTheDocument();
  });

  it('reloads its independently owned setup status when the page refreshes', async () => {
    mocks.getStatus.mockResolvedValue(readyStatus);
    const { rerender } = render(CimmichImmichSetup, { refreshRevision: 0 });

    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledOnce());
    await rerender({ refreshRevision: 1 });
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(2));
  });
});
