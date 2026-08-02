import { describe, expect, it } from 'vitest';
import { PLAN_BRUSH_RADIUS_DEFAULT, preparePlacePlanGeometryForSave } from './place-plan-geometry';

describe('Plan geometry save preparation', () => {
  it('preserves a one-point brush mark and coerces a serialised radius to a number', () => {
    expect(
      preparePlacePlanGeometryForSave({
        kind: 'paint',
        strokes: [{ points: [{ x: 0.42, y: 0.57 }], radius: '0.012' as unknown as number }],
      }),
    ).toEqual({
      kind: 'paint',
      strokes: [{ points: [{ x: 0.42, y: 0.57 }], radius: 0.012 }],
    });
  });

  it('repairs a missing stale radius without shrinking valid legacy paint', () => {
    const geometry = preparePlacePlanGeometryForSave({
      kind: 'paint',
      strokes: [
        { points: [{ x: 0.2, y: 0.3 }], radius: undefined as unknown as number },
        { points: [{ x: 0.6, y: 0.7 }], radius: 0.1 },
      ],
    });
    expect(geometry).toEqual({
      kind: 'paint',
      strokes: [
        { points: [{ x: 0.2, y: 0.3 }], radius: PLAN_BRUSH_RADIUS_DEFAULT },
        { points: [{ x: 0.6, y: 0.7 }], radius: 0.1 },
      ],
    });
  });

  it('resamples an overlong mark to the service boundary while preserving both ends', () => {
    const points = Array.from({ length: 257 }, (_, index) => ({ x: index / 256, y: index / 512 }));
    const geometry = preparePlacePlanGeometryForSave({
      kind: 'paint',
      strokes: [{ points, radius: PLAN_BRUSH_RADIUS_DEFAULT }],
    });
    expect(geometry.kind).toBe('paint');
    if (geometry.kind !== 'paint') {
      return;
    }
    expect(geometry.strokes[0]?.points).toHaveLength(256);
    expect(geometry.strokes[0]?.points[0]).toEqual({ x: 0, y: 0 });
    expect(geometry.strokes[0]?.points.at(-1)).toEqual({ x: 1, y: 0.5 });
  });

  it('keeps the complete painted item inside the service total-point budget', () => {
    const points = Array.from({ length: 256 }, (_, index) => ({ x: index / 255, y: 0.5 }));
    const geometry = preparePlacePlanGeometryForSave({
      kind: 'paint',
      strokes: Array.from({ length: 9 }, () => ({ points, radius: PLAN_BRUSH_RADIUS_DEFAULT })),
    });
    expect(geometry.kind).toBe('paint');
    if (geometry.kind !== 'paint') {
      return;
    }
    expect(geometry.strokes.reduce((total, stroke) => total + stroke.points.length, 0)).toBe(2048);
  });
});
