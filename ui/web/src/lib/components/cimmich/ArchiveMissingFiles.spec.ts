import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArchiveMissingFiles from './ArchiveMissingFiles.svelte';

const mocks = vi.hoisted(() => ({
  getAssetInfo: vi.fn(),
  getFiles: vi.fn(),
  getScan: vi.fn(),
  removeAllTrashed: vi.fn(),
  remove: vi.fn(),
  startScan: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getAssetInfo: mocks.getAssetInfo,
}));

vi.mock('$lib/services/cimmich-archive-integrity.service', () => ({
  getCimmichArchiveMissingFiles: mocks.getFiles,
  getCimmichArchiveMissingFileScan: mocks.getScan,
  removeAllCimmichArchiveTrashedFiles: mocks.removeAllTrashed,
  removeCimmichArchiveMissingFiles: mocks.remove,
  startCimmichArchiveMissingFileScan: mocks.startScan,
}));

const idleScan = {
  completedAt: null,
  error: null,
  scanId: null,
  startedAt: null,
  state: 'idle',
};

const page = {
  items: [
    {
      assetId: 'asset-trashed',
      assetType: 'image',
      assignments: 0,
      captureTime: null,
      filename: 'in-trash.jpg',
      lastSeenAt: '2026-08-19T00:00:00.000Z',
      lastSeenRunId: 'run-one',
      people: 0,
      sourceAssetId: '11111111-1111-4111-8111-111111111111',
      sourceId: 'immich-primary',
      state: 'trashed',
    },
    {
      assetId: 'asset-missing',
      assetType: 'image',
      assignments: 2,
      captureTime: null,
      filename: 'deleted.jpg',
      lastSeenAt: '2026-08-18T00:00:00.000Z',
      lastSeenRunId: 'run-two',
      people: 1,
      sourceAssetId: '22222222-2222-4222-8222-222222222222',
      sourceId: 'immich-primary',
      state: 'missing',
    },
  ],
  limit: 50,
  nextOffset: null,
  offset: 0,
  schemaVersion: 'cimmich.archive-missing-files.v2',
  summary: { missing: 1, total: 2, trashed: 1 },
};

describe('Archive missing files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const sourceBytes = Uint8Array.from([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
    ]);
    vi.stubGlobal('crypto', {
      getRandomValues: (target: Uint8Array) => {
        target.set(sourceBytes);
        return target;
      },
    });
    mocks.getAssetInfo.mockImplementation(({ id }: { id: string }) =>
      id === '11111111-1111-4111-8111-111111111111'
        ? Promise.resolve({
            originalFileName: 'in-trash.jpg',
            originalPath: '/archive/2026/in-trash.jpg',
          })
        : Promise.reject(new Error('Asset not found')),
    );
    mocks.getFiles.mockResolvedValue(page);
    mocks.getScan.mockResolvedValue({ scan: idleScan });
    mocks.startScan.mockResolvedValue({
      replayed: true,
      scan: { ...idleScan, completedAt: '2026-08-20T00:00:00.000Z', state: 'complete' },
    });
    mocks.remove.mockResolvedValue({
      removedSourceAssetIds: ['22222222-2222-4222-8222-222222222222'],
      replayed: false,
      tombstonedAssets: 1,
    });
    mocks.removeAllTrashed.mockResolvedValue({
      removedSourceAssetIds: ['11111111-1111-4111-8111-111111111111'],
      replayed: false,
      tombstonedAssets: 1,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('makes both trash and deleted Immich records immediately removable', async () => {
    const { getAllByText, getByLabelText, getByRole, getByText } = render(ArchiveMissingFiles);

    await waitFor(() => expect(getByText('deleted.jpg')).toBeInTheDocument());
    expect(getByText(/Anything in Immich trash or no longer found/)).toBeInTheDocument();
    expect(getAllByText('Not found in current Immich')).toHaveLength(2);
    expect(getByLabelText('Select in-trash.jpg')).toBeEnabled();
    expect(getByLabelText('Select deleted.jpg')).toBeEnabled();
    expect(getByRole('link', { name: 'Open in-trash.jpg in Immich trash' })).toHaveAttribute(
      'href',
      '/trash/photos/11111111-1111-4111-8111-111111111111',
    );
    expect(getByRole('link', { name: 'Open deleted.jpg in Immich' })).toHaveAttribute(
      'href',
      '/photos/22222222-2222-4222-8222-222222222222',
    );
    expect(getByRole('img', { name: 'Preview of in-trash.jpg' })).toHaveAttribute(
      'src',
      '/api/assets/11111111-1111-4111-8111-111111111111/thumbnail?size=thumbnail&edited=true',
    );
    await waitFor(() => expect(getByText('/archive/2026/in-trash.jpg')).toBeInTheDocument());
    expect(getByText('/archive/2026/in-trash.jpg').closest('a')).toHaveAttribute(
      'href',
      '/folders/photos/11111111-1111-4111-8111-111111111111?cimmichContext=1&path=%2Farchive%2F2026',
    );
    expect(getByRole('button', { name: 'Copy full path for in-trash.jpg' })).toBeEnabled();
    await waitFor(() =>
      expect(getByText('Unavailable: this record is not in the current Immich catalogue.')).toBeInTheDocument(),
    );

    await fireEvent.click(getByLabelText('Select deleted.jpg'));
    await fireEvent.click(getByRole('button', { name: 'Remove from Cimmich (1)' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Confirm remove 1' }));

    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith(
        'immich-primary',
        ['22222222-2222-4222-8222-222222222222'],
        'archive-missing-00112233-4455-4677-8899-aabbccddeeff',
      ),
    );
  });

  it('removes every confirmed trash record without paging or selecting visible rows', async () => {
    const { getByRole, getByText } = render(ArchiveMissingFiles);

    await waitFor(() => expect(getByText('in-trash.jpg')).toBeInTheDocument());
    await fireEvent.click(getByRole('button', { name: 'Remove all 1 from Cimmich' }));
    expect(mocks.removeAllTrashed).not.toHaveBeenCalled();
    expect(getByText(/Remove all 1 trash links from Cimmich management/)).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Confirm remove all 1' }));

    await waitFor(() =>
      expect(mocks.removeAllTrashed).toHaveBeenCalledWith(
        'immich-primary',
        1,
        'archive-trash-all-00112233-4455-4677-8899-aabbccddeeff',
      ),
    );
  });

  it('refreshes Immich status automatically without a scan button', async () => {
    mocks.startScan.mockResolvedValue({
      scan: { ...idleScan, scanId: 'missing-file-scan-one', state: 'running' },
    });
    const { getByText, queryByRole } = render(ArchiveMissingFiles);

    await waitFor(() => expect(mocks.startScan).toHaveBeenCalledOnce());
    expect(getByText('Refreshing Immich status…')).toBeInTheDocument();
    expect(queryByRole('button', { name: /check immich catalogue/i })).not.toBeInTheDocument();
  });
});
