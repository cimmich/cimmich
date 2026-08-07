import { describe, expect, it } from 'vitest';
import { fitIdentityReviewCrop, identityReviewSvgTransform, rotateIdentityReviewSource } from './identity-review-crop';

describe('fitIdentityReviewCrop', () => {
  it.each([
    { height: 3000, width: 4000 },
    { height: 4000, width: 3000 },
    { height: 1080, width: 1920 },
  ])('preserves a 4:3 pixel crop for a $width × $height source', ({ height, width }) => {
    const frame = fitIdentityReviewCrop({
      box: { h: 0.18, w: 0.16, x: 0.68, y: 0.12 },
      height,
      width,
    });

    expect((frame.w * width) / (frame.h * height)).toBeCloseTo(4 / 3, 10);
  });

  it('keeps the face inside the fitted crop when the crop meets an image edge', () => {
    const item = {
      box: { h: 0.2, w: 0.16, x: 0.82, y: 0.72 },
      height: 4000,
      width: 3000,
    };
    const frame = fitIdentityReviewCrop(item);

    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.w).toBeLessThanOrEqual(1);
    expect(frame.y + frame.h).toBeLessThanOrEqual(1);
    expect(frame.x).toBeLessThanOrEqual(item.box.x);
    expect(frame.y).toBeLessThanOrEqual(item.box.y);
    expect(frame.x + frame.w).toBeGreaterThanOrEqual(item.box.x + item.box.w);
    expect(frame.y + frame.h).toBeGreaterThanOrEqual(item.box.y + item.box.h);
  });

  it('rotates normalized geometry and swaps dimensions without changing source truth', () => {
    const source = { box: { h: 0.2, w: 0.1, x: 0.2, y: 0.3 }, height: 3000, width: 4000 };
    expect(rotateIdentityReviewSource(source, 1)).toEqual({
      box: { h: 0.1, w: 0.2, x: 0.5, y: 0.2 },
      height: 4000,
      width: 3000,
    });
    expect(rotateIdentityReviewSource(source, 2).box).toEqual({ h: 0.2, w: 0.1, x: 0.7, y: 0.5 });
    expect(rotateIdentityReviewSource(source, 3).box).toEqual({ h: 0.1, w: 0.2, x: 0.3, y: 0.7 });
    expect(source).toEqual({ box: { h: 0.2, w: 0.1, x: 0.2, y: 0.3 }, height: 3000, width: 4000 });
  });

  it('projects exact SVG transforms for every quarter turn', () => {
    expect(identityReviewSvgTransform(4000, 3000, 0)).toBe('');
    expect(identityReviewSvgTransform(4000, 3000, 1)).toBe('translate(3000 0) rotate(90)');
    expect(identityReviewSvgTransform(4000, 3000, 2)).toBe('translate(4000 3000) rotate(180)');
    expect(identityReviewSvgTransform(4000, 3000, 3)).toBe('translate(0 4000) rotate(-90)');
  });
});
