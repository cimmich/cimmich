import { AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
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

const deferred = <T>() => {
  let resolve = (_: T) => {};
  let reject = (_: Error) => {};
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
};

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

  it('reloads the complete Cimmich directory when server-backed search is cleared', async () => {
    mocks.getPeople.mockImplementation((_limit: number, query = '') =>
      Promise.resolve(
        query
          ? [person('person_1', 'Alex Example')]
          : [person('person_1', 'Alex Example'), person('person_2', 'Blair Example')],
      ),
    );
    const { findByText, getByRole, queryByText } = render(CimmichTagBrowser, { tags: [] });
    await findByText('Blair Example');

    await fireEvent.input(getByRole('searchbox', { name: 'Search Cimmich tags' }), {
      target: { value: 'Alex' },
    });
    await waitFor(() => expect(mocks.getPeople).toHaveBeenLastCalledWith(500, 'Alex', { presentation: false }));
    await waitFor(() => expect(queryByText('Blair Example')).not.toBeInTheDocument());

    await fireEvent.click(getByRole('button', { name: 'Clear tag search' }));
    await waitFor(() => expect(mocks.getPeople).toHaveBeenLastCalledWith(500, '', { presentation: false }));
    expect(await findByText('Blair Example')).toBeInTheDocument();
  });

  it('keeps selected tags active while a server search replaces the visible directory subset', async () => {
    mocks.getPeople.mockImplementation((_limit: number, query = '') =>
      Promise.resolve(query ? [person('person_1', 'Alex Example')] : [person('person_2', 'Blair Example')]),
    );
    const { findByText, getByRole } = render(CimmichTagBrowser, { tags: [] });
    await findByText('Blair Example');
    await fireEvent.click(getByRole('checkbox', { name: /Blair Example/ }));

    await fireEvent.input(getByRole('searchbox', { name: 'Search Cimmich tags' }), {
      target: { value: 'Alex' },
    });
    await waitFor(() => expect(mocks.getPeople).toHaveBeenLastCalledWith(500, 'Alex', { presentation: false }));
    expect(getByRole('button', { name: 'Remove Blair Example' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Photos tagged Blair Example' })).toBeInTheDocument();
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
    const { findByRole, findByText, getByRole, getByTestId } = render(CimmichTagBrowser, { tags: [] });
    await findByText('Alex Example');

    await fireEvent.click(getByRole('checkbox', { name: /Alex Example/ }));
    await fireEvent.click(getByRole('checkbox', { name: /Blair Example/ }));

    await waitFor(() => expect(mocks.getTagAssets).toHaveBeenCalledTimes(1));
    expect(await findByText('Photos with all 2 selected tags')).toBeInTheDocument();
    await waitFor(() => expect(getByTestId('tag-result-gallery')).toHaveTextContent('source_a'));
    await fireEvent.click(await findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(mocks.getTagAssets).toHaveBeenLastCalledWith(expect.any(Array), 120, 'cursor_1'));
    await waitFor(() => expect(getByTestId('tag-result-gallery')).toHaveTextContent('source_a,source_b'));
  });

  it('ignores an obsolete load-more failure after the selected tags change', async () => {
    let rejectMore: (error: Error) => void = () => {};
    const staleMore = new Promise<never>((_resolve, reject) => {
      rejectMore = reject;
    });
    mocks.getTagAssets
      .mockResolvedValueOnce({
        items: [{ assetId: 'asset_a', sourceAssetId: 'source_a' }],
        nextCursor: 'cursor_1',
        pageSize: 120,
        total: 2,
      })
      .mockReturnValueOnce(staleMore);
    const { findByRole, findByText, getByRole, queryByText } = render(CimmichTagBrowser, { tags: [] });
    await findByText('Alex Example');
    await fireEvent.click(getByRole('checkbox', { name: /Alex Example/ }));
    await fireEvent.click(getByRole('checkbox', { name: /Blair Example/ }));
    await waitFor(() => expect(mocks.getTagAssets).toHaveBeenCalledOnce());
    await fireEvent.click(await findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(mocks.getTagAssets).toHaveBeenCalledTimes(2));

    await fireEvent.click(getByRole('checkbox', { name: /Blair Example/ }));
    await waitFor(() => expect(mocks.getPersonAssets).toHaveBeenCalledWith('person_1', 250));
    rejectMore(new Error('obsolete page failure'));
    await waitFor(() => expect(queryByText('obsolete page failure')).not.toBeInTheDocument());
    expect(await findByText('Photos tagged Alex Example')).toBeInTheDocument();
  });

  it('keeps a newer intersection when obsolete single-Person asset hydration finishes last', async () => {
    const staleAsset = deferred<AssetResponseDto>();
    mocks.getPersonAssets.mockResolvedValue({
      items: [{ assetId: 'asset_stale', sourceAssetId: 'source_stale' }],
      nextCursor: null,
      summary: { total: 1 },
    });
    mocks.getTagAssets.mockResolvedValue({
      items: [{ assetId: 'asset_new', sourceAssetId: 'source_new' }],
      nextCursor: null,
      pageSize: 120,
      total: 1,
    });
    mocks.getAssetInfo.mockImplementation(({ id }: { id: string }) =>
      id === 'source_stale' ? staleAsset.promise : Promise.resolve(asset(id)),
    );
    const { findByText, getByRole, getByTestId } = render(CimmichTagBrowser, { tags: [] });
    await findByText('Alex Example');

    await fireEvent.click(getByRole('checkbox', { name: /Alex Example/ }));
    await waitFor(() => expect(mocks.getAssetInfo).toHaveBeenCalledWith({ id: 'source_stale' }));
    await fireEvent.click(getByRole('checkbox', { name: /Blair Example/ }));
    await waitFor(() => expect(getByTestId('tag-result-gallery')).toHaveTextContent('source_new'));

    staleAsset.resolve(asset('source_stale'));
    await staleAsset.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getByTestId('tag-result-gallery')).toHaveTextContent('source_new');
  });

  it('keeps a newer single-Person result when obsolete intersection hydration finishes last', async () => {
    const staleAsset = deferred<AssetResponseDto>();
    mocks.getPersonAssets.mockResolvedValue({
      items: [{ assetId: 'asset_new', sourceAssetId: 'source_new' }],
      nextCursor: null,
      summary: { total: 1 },
    });
    mocks.getTagAssets.mockResolvedValue({
      items: [{ assetId: 'asset_stale', sourceAssetId: 'source_stale' }],
      nextCursor: null,
      pageSize: 120,
      total: 1,
    });
    mocks.getAssetInfo.mockImplementation(({ id }: { id: string }) =>
      id === 'source_stale' ? staleAsset.promise : Promise.resolve(asset(id)),
    );
    const { findByText, getByRole, getByTestId } = render(CimmichTagBrowser, { tags: [] });
    await findByText('Alex Example');

    await fireEvent.click(getByRole('checkbox', { name: /Alex Example/ }));
    await waitFor(() => expect(getByTestId('tag-result-gallery')).toHaveTextContent('source_new'));
    await fireEvent.click(getByRole('checkbox', { name: /Blair Example/ }));
    await waitFor(() => expect(mocks.getAssetInfo).toHaveBeenCalledWith({ id: 'source_stale' }));
    await fireEvent.click(getByRole('checkbox', { name: /Blair Example/ }));
    await waitFor(() => expect(getByTestId('tag-result-gallery')).toHaveTextContent('source_new'));

    staleAsset.resolve(asset('source_stale'));
    await staleAsset.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getByTestId('tag-result-gallery')).toHaveTextContent('source_new');
  });

  it('clears selected tags and disclosed photos while a visibility reprojection is pending and after failure', async () => {
    const reprojection = deferred<ReturnType<typeof person>[]>();
    mocks.getPersonAssets.mockResolvedValue({
      items: [{ assetId: 'asset_private', sourceAssetId: 'source_private' }],
      nextCursor: null,
      summary: { total: 1 },
    });
    const rendered = render(CimmichTagBrowser, { tags: [] });
    await rendered.findByText('Alex Example');
    await fireEvent.click(rendered.getByRole('checkbox', { name: /Alex Example/ }));
    await waitFor(() => expect(rendered.getByTestId('tag-result-gallery')).toHaveTextContent('source_private'));

    mocks.getPeople.mockReturnValueOnce(reprojection.promise);
    cimmichVisibilityManager.notify();

    await waitFor(() => expect(rendered.queryByTestId('tag-result-gallery')).not.toBeInTheDocument());
    expect(rendered.queryByRole('button', { name: 'Remove Alex Example' })).not.toBeInTheDocument();

    reprojection.reject(new Error('replacement tag directory unavailable'));
    expect(await rendered.findByRole('alert')).toHaveTextContent('People could not be loaded');
    expect(rendered.queryByTestId('tag-result-gallery')).not.toBeInTheDocument();
  });
});
