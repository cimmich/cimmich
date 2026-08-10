import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichReviewPhotoMedia from './CimmichReviewPhotoMedia.svelte';

const mocks = vi.hoisted(() => ({
  getEvidence: vi.fn(),
  getManualPresences: vi.fn(),
  getManualTags: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/cimmich.service')>()),
  getCimmichAssetEvidence: mocks.getEvidence,
  getCimmichManualPresences: mocks.getManualPresences,
  getCimmichManualSubjectTags: mocks.getManualTags,
}));

describe('CimmichReviewPhotoMedia preview evidence', () => {
  beforeEach(() => {
    mocks.getEvidence
      .mockReset()
      .mockRejectedValueOnce(new Error('Saved People tags are temporarily unavailable'))
      .mockResolvedValueOnce({
        asset_id: 'asset-internal',
        bodies: [],
        faces: [],
        identity_locators: [],
        presence: [],
      });
    mocks.getManualPresences.mockReset().mockResolvedValue({ items: [] });
    mocks.getManualTags.mockReset().mockResolvedValue({ items: [] });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('retries a failed saved-People overlay without closing the preview', async () => {
    const rendered = render(CimmichReviewPhotoMedia, {
      contextLabel: 'Cedar House',
      filename: 'portrait.jpg',
      image: { box: { h: 0.4, w: 0.3, x: 0.2, y: 0.1 }, height: 800, width: 1200 },
      onRotate: vi.fn(),
      sourceAssetId: 'source-asset-1',
    });

    await fireEvent.click(rendered.getByRole('button', { name: 'Preview portrait.jpg with context' }));
    expect(await rendered.findByRole('alert')).toHaveTextContent('Saved People tags are temporarily unavailable');

    await fireEvent.click(rendered.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.getEvidence).toHaveBeenCalledTimes(2));

    expect(rendered.queryByRole('alert')).not.toBeInTheDocument();
    expect(rendered.getByRole('region', { name: /portrait\.jpg large preview/ })).toBeInTheDocument();
    expect(mocks.getManualTags).toHaveBeenCalledWith('asset-internal');
    expect(mocks.getManualPresences).toHaveBeenCalledWith('asset-internal');
  });
});
