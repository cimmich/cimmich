import type { CimmichPlacePlanGeometry } from '$lib/services/cimmich.service';

export const PLAN_BRUSH_RADIUS_MIN = 0.005;
export const PLAN_BRUSH_RADIUS_DEFAULT = 0.012;
export const PLAN_BRUSH_RADIUS_MAX = 0.05;
const PLAN_BRUSH_RADIUS_SAVE_MAX = 0.15;

const clamp = (number: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, number));
const cleanCoordinate = (value: unknown) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError('A Plan tool produced an invalid point. Redraw that mark and try again.');
  }
  return Number(clamp(number, 0, 1).toFixed(6));
};

export const preparePlacePlanGeometryForSave = (geometry: CimmichPlacePlanGeometry): CimmichPlacePlanGeometry => {
  if (geometry.kind === 'paint') {
    if (geometry.strokes.length === 0 || geometry.strokes.length > 64) {
      throw new RangeError('Paint needs between 1 and 64 marks before this Plan can be saved.');
    }
    return {
      kind: 'paint',
      strokes: geometry.strokes.map((stroke) => {
        if (stroke.points.length === 0 || stroke.points.length > 256) {
          throw new RangeError('Each painted mark needs between 1 and 256 points before this Plan can be saved.');
        }
        const radius = Number(stroke.radius);
        return {
          points: stroke.points.map((point) => ({
            x: cleanCoordinate(point.x),
            y: cleanCoordinate(point.y),
          })),
          radius: Number(
            clamp(
              Number.isFinite(radius) ? radius : PLAN_BRUSH_RADIUS_DEFAULT,
              PLAN_BRUSH_RADIUS_MIN,
              PLAN_BRUSH_RADIUS_SAVE_MAX,
            ).toFixed(4),
          ),
        };
      }),
    };
  }
  if (geometry.kind === 'polygon') {
    return {
      kind: 'polygon',
      points: geometry.points.map((point) => ({ x: cleanCoordinate(point.x), y: cleanCoordinate(point.y) })),
    };
  }
  if (geometry.kind === 'rect') {
    return {
      h: cleanCoordinate(geometry.h),
      kind: 'rect',
      w: cleanCoordinate(geometry.w),
      x: cleanCoordinate(geometry.x),
      y: cleanCoordinate(geometry.y),
    };
  }
  return { kind: 'point', x: cleanCoordinate(geometry.x), y: cleanCoordinate(geometry.y) };
};
