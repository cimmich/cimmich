import {
  cimmichSquareCropBackgroundStyle,
  cimmichSquareCropFrame,
  cimmichSquareObservationStyle,
} from '$lib/utils/cimmich-crop';
import { describe, expect, it } from 'vitest';

const box = { boxH: 0.2, boxW: 0.1, boxX: 0.4, boxY: 0.3 };

describe('cimmichSquareCropFrame', () => {
  it('frames a crop that is square in source pixels when dimensions are known', () => {
    const frame = cimmichSquareCropFrame({ ...box, height: 2000, padding: 2, width: 4000 });

    // box is 400x400px padded to 800px; the crop must cover the same pixel
    // count on both axes so a square tile does not stretch the face.
    expect(frame.cropW * 4000).toBeCloseTo(frame.cropH * 2000);
    expect(frame.cropW).toBeCloseTo(800 / 4000);
    expect(frame.cropH).toBeCloseTo(800 / 2000);
  });

  it('clamps the frame inside the image', () => {
    const frame = cimmichSquareCropFrame({
      boxH: 0.4,
      boxW: 0.4,
      boxX: 0.75,
      boxY: 0.8,
      height: 1000,
      padding: 2,
      width: 1000,
    });

    expect(frame.cropX).toBeGreaterThanOrEqual(0);
    expect(frame.cropY).toBeGreaterThanOrEqual(0);
    expect(frame.cropX + frame.cropW).toBeLessThanOrEqual(1);
    expect(frame.cropY + frame.cropH).toBeLessThanOrEqual(1);
  });

  it('never exceeds the smaller image side', () => {
    const frame = cimmichSquareCropFrame({
      boxH: 0.9,
      boxW: 0.9,
      boxX: 0.05,
      boxY: 0.05,
      height: 1000,
      padding: 4,
      width: 3000,
    });

    expect(frame.cropH).toBeCloseTo(1);
    expect(frame.cropW).toBeCloseTo(1000 / 3000);
  });

  it('falls back to the legacy normalized square without source dimensions', () => {
    const frame = cimmichSquareCropFrame({ ...box, height: 0, padding: 2, width: 0 });

    expect(frame.cropW).toBeCloseTo(0.4);
    expect(frame.cropH).toBeCloseTo(0.4);
  });
});

describe('cimmichSquareObservationStyle', () => {
  it('positions an absolute img against the frame', () => {
    const style = cimmichSquareObservationStyle({ ...box, height: 2000, padding: 2, width: 4000 });

    expect(style).toContain('position: absolute');
    expect(style).toContain('max-width: none');
    expect(style).toContain(`width: ${100 / (800 / 4000)}%`);
  });

  it('covers the tile when dimensions are unavailable', () => {
    const style = cimmichSquareObservationStyle({ ...box, height: 0, padding: 2, width: 0 });

    expect(style).toBe('position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;');
  });
});

describe('cimmichSquareCropBackgroundStyle', () => {
  it('sizes the background per axis so the crop stays proportional', () => {
    const style = cimmichSquareCropBackgroundStyle({
      ...box,
      height: 2000,
      padding: 2,
      url: 'https://example.test/preview.jpg',
      width: 4000,
    });

    expect(style).toContain('background-image: url("https://example.test/preview.jpg")');
    expect(style).toContain(`background-size: ${100 / (800 / 4000)}% ${100 / (800 / 2000)}%`);
    expect(style).toContain('background-position:');
  });

  it('reproduces the legacy square framing without dimensions', () => {
    const style = cimmichSquareCropBackgroundStyle({
      ...box,
      height: 0,
      padding: 2,
      url: 'https://example.test/preview.jpg',
      width: 0,
    });

    expect(style).toContain(`background-size: ${100 / 0.4}% ${100 / 0.4}%`);
  });
});
