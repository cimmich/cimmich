import { fitReviewPhotoPreview, reviewPhotoPreviewZoomLevels } from './review-photo-preview';

describe('review photo preview geometry', () => {
  it('fits a landscape photo within both viewport dimensions', () => {
    const fit = fitReviewPhotoPreview(1200, 700, 4000, 3000);

    expect(fit.width).toBeCloseTo(933.33, 2);
    expect(fit.height).toBe(700);
  });

  it('fits a portrait photo within both viewport dimensions', () => {
    const fit = fitReviewPhotoPreview(1200, 700, 3000, 4000);

    expect(fit.width).toBe(525);
    expect(fit.height).toBe(700);
  });

  it('fills an equal-aspect viewport without cropping', () => {
    const fit = fitReviewPhotoPreview(1200, 800, 3000, 2000);

    expect(fit.width).toBe(1200);
    expect(fit.height).toBe(800);
  });

  it('keeps invalid dimensions finite while layout is initializing', () => {
    const fit = fitReviewPhotoPreview(0, 0, 0, 0);

    expect(fit).toEqual({ height: 1, scale: 1, width: 1 });
  });

  it('offers bounded zoom levels relative to the fitted photo', () => {
    expect(reviewPhotoPreviewZoomLevels).toEqual([1, 1.5, 2, 3, 4]);
  });
});
