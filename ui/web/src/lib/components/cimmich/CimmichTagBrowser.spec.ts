import { AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichTagBrowser from './CimmichTagBrowser.svelte';

const mocks = vi.hoisted(() => ({
  getAssetInfo: vi.fn(),
  getAssetLabels: vi.fn(),
  getContextEntities: vi.fn(),
  getPeople: vi.fn(),
  getPersonAssets: vi.fn(),
  getPets: vi.fn(),
  getTagAssets: vi.fn(),
  goto: vi.fn(),
  searchAssets: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: { data: {}, url: new URL('http://localhost/tags') } }));
vi.mock('$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte', async () => {
  const module = await import('./CimmichTagBrowserGalleryStub.svelte');
  return { default: module.default };
});
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal()),
  getAssetInfo: mocks.getAssetInfo,
  searchAssets: mocks.searchAssets,
}));
vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal()),
  getCimmichContextEntities: mocks.getContextEntities,
  getCimmichAssetLabels: mocks.getAssetLabels,
  getCimmichPeople: mocks.getPeople,
  getCimmichPersonAssetsPage: mocks.getPersonAssets,
  getCimmichPets: mocks.getPets,
  getCimmichTagAssets: mocks.getTagAssets,
}));

const person = (id: string, name: string) => ({
  aliases: [],
  asset_count: 1,
  display_name: name,
  person_id: id,
  sourceAssetId: null,
  status: 'active',
  subject_kind: 'person',
});

const asset = (id: string) =>
  ({
    id,
    isArchived: false,
    isFavorite: false,
    tags: [],
    visibility: AssetVisibility.Timeline,
  }) as unknown as AssetResponseDto;

describe('CimmichTagBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPeople.mockResolvedValue([person('person_1', 'Alex Example'), person('person_2', 'Blair Example')]);
    mocks.getAssetLabels.mockResolvedValue([]);
    mocks.getPets.mockResolvedValue([]);
    mocks.getContextEntities.mockResolvedValue([]);
    mocks.getPersonAssets.mockResolvedValue({ items: [], nextCursor: null, summary: { total: 0 } });
    mocks.getTagAssets.mockResolvedValue({ items: [], nextCursor: null, pageSize: 120, total: 0 });
    mocks.getAssetInfo.mockImplementation(({ id }: { id: string }) => Promise.resolve(asset(id)));
  });

  it('keeps successful tag families usable and offers a real directory retry when one family fails', async () => {
    mocks.getPets.mockRejectedValueOnce(new Error('Pet directory unavailable'));
    const { findByText, getByRole } = render(CimmichTagBrowser, { tags: [] });

    expect(await findByText('Alex Example')).toBeInTheDocument();
    expect(getByRole('alert')).toHaveTextContent('Pets could not be loaded');
    expect(getByRole('button', { name: 'Try directory again' })).toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: 'Try directory again' }));
    await waitFor(() => expect(mocks.getPets).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getByRole('button', { name: 'Cimmich' })).toBeInTheDocument());
  });

  it('selects multiple Cimmich tags, renders their intersection, and follows the server cursor', async () => {
    mocks.getTagAssets
      .mockResolvedValueOnce({
        items: [{ assetId: 'asset_a', sourceAssetId: 'source_a' }],
        nextCursor: 'cursor_1',
        pageSize: 120,
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ assetId: 'asset_b', sourceAssetId: 'source_b' }],
        nextCursor: null,
        pageSize: 120,
        total: 2,
      });
    const { findByText, getByRole, getByTestId } = render(CimmichTagBrowser, { tags: [] });
    await findByText('Alex Example');

    await fireEvent.click(getByRole('checkbox', { name: /Alex Example/ }));
    await fireEvent.click(getByRole('checkbox', { name: /Blair Example/ }));

    await waitFor(() => expect(mocks.getTagAssets).toHaveBeenCalledTimes(1));
    expect(await findByText('Photos with all 2 selected tags')).toBeInTheDocument();
    await waitFor(() => expect(getByTestId('tag-result-gallery')).toHaveTextContent('source_a'));
    await fireEvent.click(getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(mocks.getTagAssets).toHaveBeenLastCalledWith(expect.any(Array), 120, 'cursor_1'));
    await waitFor(() => expect(getByTestId('tag-result-gallery')).toHaveTextContent('source_a,source_b'));
  });
});
