import { describe, expect, it } from 'vitest';
import {
  contextCoverBaseCrop,
  contextCoverCropFromFrame,
  contextCoverFrameFromCrop,
  contextCoverHeroStyle,
} from './context-cover-framing';

describe('Context hero framing', () => {
  it('derives a wide normalized crop for a portrait source', () => {
    const crop = contextCoverBaseCrop(1200, 1600);
    expect(crop.h).toBeCloseTo(5 / 16);
    expect(crop.w).toBe(1);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeCloseTo(11 / 32);
  });

  it('round-trips pan and zoom through the durable crop', () => {
    const crop = contextCoverCropFromFrame({ centerX: 68, centerY: 32, zoom: 2 }, 1200, 1600);
    const frame = contextCoverFrameFromCrop(crop, 1200, 1600);
    expect(frame).toEqual({ centerX: 68, centerY: 32, zoom: 2 });
  });

  it('projects saved framing into the live hero rather than reverting to centre', () => {
    const style = contextCoverHeroStyle({ h: 0.2, w: 0.64, x: 0.3, y: 0.1 }, 1600, 1000);
    expect(style).toContain('--context-cover-x:62%');
    expect(style).toContain('--context-cover-y:20%');
    expect(style).toContain('--context-cover-zoom:');
  });
});
