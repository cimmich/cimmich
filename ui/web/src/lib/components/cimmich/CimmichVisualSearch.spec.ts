import { render, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { assetFactory } from '@test-data/factories/asset-factory';
import CimmichVisualSearch from './CimmichVisualSearch.svelte';

const mocks = vi.hoisted(() => ({
  evidence: vi.fn(),
  searchSmart: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  searchSmart: mocks.searchSmart,
}));

vi.mock('$lib/managers/cimmich-visibility-manager.svelte', () => ({
  cimmichVisibilityManager: { version: 0 },
}));

vi.mock('$lib/services/cimmich-archive-integrity.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/cimmich-archive-integrity.service')>()),
  getCimmichArchiveSourceEvidence: mocks.evidence,
}));

describe('Cimmich visual search', () => {
  beforeEach(() => {
    mocks.evidence.mockReset();
    mocks.searchSmart.mockReset();
  });

  it('uses a reference asset, filters through Cimmich visibility and pages only when asked', async () => {
    const user = userEvent.setup();
    const onStateChange = vi.fn();
    const reference = assetFactory.build({ id: 'reference-asset', originalFileName: 'reference.jpg' });
    const first = assetFactory.build({ id: 'visible-1', originalFileName: 'first.jpg' });
    const hidden = assetFactory.build({ id: 'hidden-1', originalFileName: 'hidden.jpg' });
    const second = assetFactory.build({ id: 'visible-2', originalFileName: 'second.jpg' });
    mocks.searchSmart
      .mockResolvedValueOnce({ assets: { items: [reference, first, hidden], nextPage: '2' } })
      .mockResolvedValueOnce({ assets: { items: [second], nextPage: null } });
    mocks.evidence
      .mockResolvedValueOnce({ items: [{ assetId: 'internal-1', sourceAssetId: first.id }] })
      .mockResolvedValueOnce({ items: [{ assetId: 'internal-2', sourceAssetId: second.id }] });

    const rendered = render(CimmichVisualSearch, { initialQueryAssetId: reference.id, onStateChange });

    await waitFor(() => expect(mocks.searchSmart).toHaveBeenCalledTimes(1));
    expect(onStateChange).not.toHaveBeenCalled();
    expect(mocks.searchSmart).toHaveBeenCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ page: 1, queryAssetId: reference.id }) }),
    );
    expect(await rendered.findByRole('heading', { name: '1 visual lead' })).toBeInTheDocument();
    expect(rendered.getByRole('link', { name: 'Open first.jpg' })).toBeInTheDocument();
    expect(rendered.queryByRole('link', { name: 'Open hidden.jpg' })).not.toBeInTheDocument();
    expect(rendered.queryByRole('link', { name: 'Open reference.jpg' })).not.toBeInTheDocument();

    await user.click(rendered.getByRole('button', { name: /Load 24 more/ }));

    await waitFor(() => expect(mocks.searchSmart).toHaveBeenCalledTimes(2));
    expect(mocks.searchSmart).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ page: 2, queryAssetId: reference.id }) }),
    );
    expect(await rendered.findByRole('heading', { name: '2 visual leads' })).toBeInTheDocument();
    expect(rendered.getByRole('link', { name: 'Open first.jpg' })).toBeInTheDocument();
    expect(rendered.getByRole('link', { name: 'Open second.jpg' })).toBeInTheDocument();
  });

  it('updates the shareable route only after a person submits a new query', async () => {
    const user = userEvent.setup();
    const onStateChange = vi.fn();
    mocks.searchSmart.mockResolvedValue({ assets: { items: [], nextPage: null } });
    mocks.evidence.mockResolvedValue({ items: [] });
    const rendered = render(CimmichVisualSearch, { onStateChange });

    await user.type(rendered.getByRole('textbox', { name: 'Describe what the photos look like' }), 'red bicycle');
    await user.click(rendered.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(onStateChange).toHaveBeenCalledWith('red bicycle', ''));
    expect(mocks.searchSmart).toHaveBeenCalledTimes(1);
  });
});
