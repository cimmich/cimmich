import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichImmichPersonResolution from './CimmichImmichPersonResolution.svelte';

const mocks = vi.hoisted(() => ({
  getPeople: vi.fn(),
  preview: vi.fn(),
  resolve: vi.fn(),
  undo: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', () => ({
  getCimmichPeople: mocks.getPeople,
  previewCimmichImmichPersonClusters: mocks.preview,
  resolveCimmichImmichPersonCluster: mocks.resolve,
  undoCimmichImmichPersonClusterResolution: mocks.undo,
}));

vi.mock('$lib/utils', () => ({
  getAssetMediaUrl: ({ id }: { id: string }) => `/asset/${id}`,
}));

const scope = {
  importPeople: true,
  includeHiddenPeople: false,
  mediaKinds: ['image', 'video'] as Array<'image' | 'video'>,
  providerMode: 'deferred' as const,
  visibilities: ['timeline'] as Array<'timeline'>,
};

const cluster = {
  faceCount: 5,
  immichPersonId: 'immich-person-1',
  representative: {
    assetInputRevision: 'c'.repeat(64),
    box: { h: 0.2, w: 0.2, x: 0.1, y: 0.1 },
    faceId: 'immich-face-1',
    sourceAssetId: 'source-asset-1',
  },
  resolution: { state: 'unresolved' as const },
  snapshotDigest: 'b'.repeat(64),
  sourceRevision: 'a'.repeat(64),
};

const person = {
  aliases: [],
  bodyPreview: null,
  box_h: null,
  box_w: null,
  box_x: null,
  box_y: null,
  categories: [],
  display_name: 'Maya Chen',
  filename: '',
  person_id: 'person-1',
  representative_asset_id: null,
  representative_face_id: null,
  sourceAssetId: null,
  subject_kind: 'person',
};

describe('Immich unnamed Person resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPeople.mockResolvedValue([person]);
    mocks.preview.mockResolvedValue({
      clusters: [cluster],
      schemaVersion: 'cimmich.immich-person-resolution.v1',
      scope,
    });
  });

  it('maps only the explicitly selected visible Person with exact revision bindings', async () => {
    mocks.resolve.mockResolvedValue({
      changed: true,
      replayed: false,
      resolution: {
        action: 'existing_person',
        decisionId: 'decision-1',
        personId: 'person-1',
        resolutionId: 'resolution-1',
        state: 'resolved',
      },
      schemaVersion: 'cimmich.immich-person-resolution.v1',
    });
    const { getByRole, getByText } = render(CimmichImmichPersonResolution, { scope });

    await waitFor(() => expect(getByText('Unnamed face group')).toBeInTheDocument());
    expect(getByText('5 Faces in this upstream group')).toBeInTheDocument();
    await fireEvent.change(getByRole('combobox', { name: 'Map to an existing Person' }), {
      target: { value: 'person-1' },
    });
    await fireEvent.click(getByRole('button', { name: 'Use selected Person' }));

    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledOnce());
    expect(mocks.resolve).toHaveBeenCalledWith(
      'immich-person-1',
      expect.objectContaining({
        action: 'existing_person',
        expectedSourceRevision: 'a'.repeat(64),
        personId: 'person-1',
        snapshotDigest: 'b'.repeat(64),
      }),
    );
  });

  it('uses a human label and bounded preview while relegating the raw upstream ID to technical details', async () => {
    const { getByLabelText, getByText } = render(CimmichImmichPersonResolution, { scope });

    await waitFor(() => expect(getByText('Unnamed face group')).toBeInTheDocument());
    expect(getByLabelText('Representative crop for unnamed Immich face group with 5 Faces')).toBeInTheDocument();
    expect(getByText('immich-person-1').closest('details')).toHaveTextContent('Technical details');
    expect(getByText(/separate upstream Immich face groups/)).toBeInTheDocument();
  });

  it('reports import readiness only after every Face group has a final resolution', async () => {
    const onreadiness = vi.fn();
    const { rerender } = render(CimmichImmichPersonResolution, { onreadiness, scope });

    await waitFor(() => expect(onreadiness).toHaveBeenLastCalledWith(false));
    mocks.preview.mockResolvedValue({
      clusters: [
        {
          ...cluster,
          resolution: {
            action: 'existing_person',
            decisionId: 'decision-1',
            personId: 'person-1',
            resolutionId: 'resolution-1',
            state: 'resolved',
          },
        },
      ],
      schemaVersion: 'cimmich.immich-person-resolution.v1',
      scope,
    });
    await rerender({ onreadiness, scope: { ...scope, mediaKinds: ['image'] } });
    await waitFor(() => expect(onreadiness).toHaveBeenLastCalledWith(true));
  });

  it('undoes only the exact current decision', async () => {
    mocks.preview.mockResolvedValue({
      clusters: [
        {
          ...cluster,
          resolution: {
            action: 'unknown',
            decisionId: 'decision-1',
            personId: null,
            resolutionId: 'resolution-1',
            state: 'resolved',
          },
        },
      ],
      schemaVersion: 'cimmich.immich-person-resolution.v1',
      scope,
    });
    mocks.undo.mockResolvedValue({
      changed: true,
      decisionId: 'decision-undo-1',
      replayed: false,
      resolution: null,
      schemaVersion: 'cimmich.immich-person-resolution.v1',
      state: 'reverted',
    });
    const { getByRole } = render(CimmichImmichPersonResolution, { scope });

    await waitFor(() => expect(getByRole('button', { name: 'Undo decision' })).toBeInTheDocument());
    await fireEvent.click(getByRole('button', { name: 'Undo decision' }));

    await waitFor(() => expect(mocks.undo).toHaveBeenCalledOnce());
    expect(mocks.undo).toHaveBeenCalledWith(
      'decision-1',
      expect.objectContaining({ commandId: expect.stringMatching(/^immich-person\.undo\./), scope }),
    );
  });
});
