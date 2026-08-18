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

  it('keeps the exact reviewed Face distinct from saved People overlays', async () => {
    mocks.getEvidence.mockReset().mockResolvedValue({
      asset_id: 'asset-internal',
      bodies: [],
      faces: [
        {
          box_h: 0.4,
          box_w: 0.3,
          box_x: 0.2,
          box_y: 0.1,
          display_name: 'Existing Person',
          face_id: 'face-existing',
          person_id: 'person-existing',
        },
      ],
      identity_locators: [],
      presence: [],
    });
    const rendered = render(CimmichReviewPhotoMedia, {
      contextLabel: 'Cedar House',
      filename: 'portrait.jpg',
      image: { box: { h: 0.2, w: 0.15, x: 0.6, y: 0.3 }, height: 800, width: 1200 },
      onRotate: vi.fn(),
      sourceAssetId: 'source-asset-1',
      targetLabel: 'Review: Cammy',
    });

    await fireEvent.click(rendered.getByRole('button', { name: 'Preview portrait.jpg with context' }));
    expect(await rendered.findByTitle('Review: Cammy')).toBeInTheDocument();
    expect(await rendered.findByTitle('Existing Person · already tagged')).toBeInTheDocument();
  });

  it('opens fitted to the window and zooms without reloading review evidence', async () => {
    mocks.getEvidence.mockReset().mockResolvedValue({
      asset_id: 'asset-internal',
      bodies: [],
      faces: [],
      identity_locators: [],
      presence: [],
    });
    const rendered = render(CimmichReviewPhotoMedia, {
      contextLabel: 'Cedar House',
      filename: 'landscape.jpg',
      image: { box: { h: 0.2, w: 0.15, x: 0.6, y: 0.3 }, height: 3000, width: 4000 },
      onRotate: vi.fn(),
      sourceAssetId: 'source-asset-1',
    });

    await fireEvent.click(rendered.getByRole('button', { name: 'Preview landscape.jpg with context' }));
    expect(rendered.getByRole('region', { name: /The whole photo opens fitted to the window/ })).toBeInTheDocument();
    expect(rendered.getByRole('button', { name: 'Fit photo to window' })).toBeInTheDocument();
    expect(rendered.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(rendered.getByText('100%')).toBeInTheDocument();

    await fireEvent.click(rendered.getByRole('button', { name: 'Zoom in' }));
    expect(rendered.getByText('150%')).toBeInTheDocument();
    expect(rendered.getByRole('button', { name: 'Zoom out' })).toBeEnabled();

    await fireEvent.click(rendered.getByRole('button', { name: 'Fit photo to window' }));
    expect(rendered.getByText('100%')).toBeInTheDocument();
    await waitFor(() => expect(mocks.getEvidence).toHaveBeenCalledTimes(1));
  });
});
