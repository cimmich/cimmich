import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichPossiblePeople from './CimmichPossiblePeople.svelte';

const mocks = vi.hoisted(() => ({
  getPeople: vi.fn(),
  refresh: vi.fn(),
  preview: vi.fn(),
  resolve: vi.fn(),
  undo: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', () => ({
  getCimmichPeople: mocks.getPeople,
}));

vi.mock('$lib/services/possible-people.service', () => ({
  getCimmichPossiblePeople: mocks.preview,
  refreshCimmichPossiblePeople: mocks.refresh,
  resolveCimmichPossiblePerson: mocks.resolve,
  undoCimmichPossiblePersonResolution: mocks.undo,
}));

vi.mock('$lib/utils', () => ({
  getAssetMediaUrl: ({ id }: { id: string }) => `/asset/${id}`,
}));

const cluster = (
  id: string,
  photoCount: number,
  resolution:
    | { state: 'unresolved' }
    | { action: 'later'; decisionId: string; personId: null; resolutionId: string; state: 'later' },
) => ({
  evidence: {
    distinctYears: photoCount > 3 ? 4 : 1,
    firstCaptureTime: '2020-01-01T00:00:00.000Z',
    lastCaptureTime: photoCount > 3 ? '2024-01-01T00:00:00.000Z' : '2020-01-01T00:00:00.000Z',
    locationCount: photoCount > 4 ? 2 : 0,
    locations: photoCount > 4 ? ['Athens', 'London'] : [],
    photoCount,
    timeSpanDays: photoCount > 3 ? 1461 : 0,
  },
  faceCount: photoCount,
  immichPersonId: id,
  representative: {
    assetInputRevision: 'c'.repeat(64),
    box: { h: 0.2, w: 0.2, x: 0.1, y: 0.1 },
    faceId: `face-${id}`,
    sourceAssetId: `asset-${id}`,
  },
  resolution,
  snapshotDigest: 'b'.repeat(64),
  sourceRevision: 'a'.repeat(64),
});

describe('Possible people', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPeople.mockResolvedValue([
      {
        display_name: 'Maya Chen',
        person_id: 'person-maya',
        subject_kind: 'person',
      },
    ]);
    mocks.preview.mockResolvedValue({
      activeRun: null,
      clusters: [
        cluster('recurring', 8, { state: 'unresolved' }),
        cluster('background', 2, { state: 'unresolved' }),
        cluster('ignored', 6, {
          action: 'later',
          decisionId: 'decision-ignore',
          personId: null,
          resolutionId: 'resolution-ignore',
          state: 'later',
        }),
      ],
      completedRun: {
        clusterCount: 3,
        completedAt: '2026-08-08T00:00:00.000Z',
        createdAt: '2026-08-08T00:00:00.000Z',
        edgeCount: 20,
        errorCode: null,
        errorMessage: null,
        processedSeeds: 100,
        runId: 'possible_run_test',
        startedAt: '2026-08-08T00:00:00.000Z',
        state: 'completed',
        totalSeeds: 100,
      },
      schemaVersion: 'cimmich.possible-people-snapshot.v1',
    });
  });

  it('shows only recurring active groups with time and place evidence', async () => {
    const { getByRole, getByTestId, getByText, queryByText } = render(CimmichPossiblePeople, { mode: 'active' });

    await waitFor(() => expect(getByText('8 photos')).toBeInTheDocument());
    expect(getByText('Seen 2020–2024 · 4 years')).toBeInTheDocument();
    expect(getByText('2 known places')).toBeInTheDocument();
    expect(queryByText('2 photos')).not.toBeInTheDocument();
    expect(getByTestId('possible-person-photo')).toHaveClass('w-full', 'aspect-square');
    expect(getByTestId('possible-person-face-marker')).toHaveClass('border-dotted', 'rounded-full');
    expect(getByRole('button', { name: 'Ignore' })).toBeInTheDocument();
  });

  it('admits three-photo groups only when time or place spread makes them meaningful', async () => {
    const spreadRecurring = cluster('spread-recurring', 3, { state: 'unresolved' });
    spreadRecurring.evidence.distinctYears = 2;
    spreadRecurring.evidence.lastCaptureTime = '2024-01-01T00:00:00.000Z';
    spreadRecurring.evidence.timeSpanDays = 1461;
    mocks.preview.mockResolvedValue({
      activeRun: null,
      clusters: [spreadRecurring, cluster('incidental-repeat', 3, { state: 'unresolved' })],
      completedRun: { clusterCount: 2, completedAt: '2026-08-08T00:00:00.000Z', state: 'completed' },
      schemaVersion: 'cimmich.possible-people-snapshot.v1',
    });

    const { getByText, getAllByRole } = render(CimmichPossiblePeople, { mode: 'active' });

    await waitFor(() => expect(getByText('3 photos')).toBeInTheDocument());
    expect(getAllByRole('link', { name: 'Open representative photo for possible person' })).toHaveLength(1);
  });

  it('moves Ignore into a recoverable later decision', async () => {
    mocks.resolve.mockResolvedValue({
      changed: true,
      replayed: false,
      resolution: {
        action: 'later',
        decisionId: 'decision-recurring',
        personId: null,
        resolutionId: 'resolution-recurring',
        state: 'later',
      },
    });
    const { getByRole, queryByText } = render(CimmichPossiblePeople, { mode: 'active' });

    await waitFor(() => expect(getByRole('button', { name: 'Ignore' })).toBeInTheDocument());
    await fireEvent.click(getByRole('button', { name: 'Ignore' }));

    await waitFor(() =>
      expect(mocks.resolve).toHaveBeenCalledWith(
        'recurring',
        expect.objectContaining({
          action: 'later',
          snapshotDigest: 'b'.repeat(64),
        }),
      ),
    );
    expect(queryByText('8 photos')).not.toBeInTheDocument();
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('maps a recurring group to a selected known Person without leaving the page', async () => {
    mocks.resolve.mockResolvedValue({ changed: true });
    const { getByRole } = render(CimmichPossiblePeople, { mode: 'active' });

    await waitFor(() => expect(getByRole('button', { name: 'Name or match' })).toBeInTheDocument());
    await fireEvent.click(getByRole('button', { name: 'Name or match' }));
    const picker = await waitFor(() => getByRole('combobox', { name: 'Match an existing Person' }));
    await fireEvent.change(picker, { target: { value: 'person-maya' } });
    await fireEvent.click(getByRole('button', { name: 'Use selected Person' }));

    await waitFor(() =>
      expect(mocks.resolve).toHaveBeenCalledWith(
        'recurring',
        expect.objectContaining({
          action: 'existing_person',
          personId: 'person-maya',
        }),
      ),
    );
  });

  it('restores ignored groups from Needs attention', async () => {
    mocks.undo.mockResolvedValue({ changed: true });
    const { getByRole } = render(CimmichPossiblePeople, { mode: 'ignored' });

    await waitFor(() => expect(getByRole('button', { name: 'Restore' })).toBeInTheDocument());
    await fireEvent.click(getByRole('button', { name: 'Restore' }));

    await waitFor(() =>
      expect(mocks.undo).toHaveBeenCalledWith('decision-ignore', expect.stringContaining('possible-person.restore.')),
    );
  });

  it('sorts possible people by estimated photo count before time or place spread', async () => {
    const highSpread = cluster('high-spread', 6, { state: 'unresolved' });
    highSpread.evidence.distinctYears = 20;
    highSpread.evidence.locationCount = 10;
    highSpread.evidence.timeSpanDays = 7300;
    const higherPhotoCount = cluster('higher-photo-count', 7, { state: 'unresolved' });
    higherPhotoCount.evidence.distinctYears = 1;
    higherPhotoCount.evidence.locationCount = 0;
    higherPhotoCount.evidence.timeSpanDays = 0;
    mocks.preview.mockResolvedValue({
      activeRun: null,
      clusters: [highSpread, higherPhotoCount],
      completedRun: { clusterCount: 2, completedAt: '2026-08-08T00:00:00.000Z', state: 'completed' },
      schemaVersion: 'cimmich.possible-people-snapshot.v1',
    });

    const { getAllByRole, getByText } = render(CimmichPossiblePeople, { mode: 'active' });

    await waitFor(() => expect(getByText('7 photos')).toBeInTheDocument());
    const links = getAllByRole('link', { name: 'Open representative photo for possible person' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/photos/asset-higher-photo-count');
  });
});
