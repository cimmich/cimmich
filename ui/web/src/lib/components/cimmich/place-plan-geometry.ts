import type { CimmichPlacePlanGeometry } from '$lib/services/cimmich.service';

export const PLAN_BRUSH_RADIUS_MIN = 0.005;
export const PLAN_BRUSH_RADIUS_DEFAULT = 0.012;
export const PLAN_BRUSH_RADIUS_MAX = 0.05;
const PLAN_BRUSH_RADIUS_SAVE_MAX = 0.15;
const PLAN_PAINT_POINTS_PER_STROKE_MAX = 256;
const PLAN_PAINT_POINTS_TOTAL_MAX = 2048;

const clamp = (number: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, number));
const cleanCoordinate = (value: unknown) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError('A Plan tool produced an invalid point. Redraw that mark and try again.');
  }
  return Number(clamp(number, 0, 1).toFixed(6));
};

const samplePoints = <Point>(points: Point[], limit: number) => {
  if (points.length <= limit) {
    return points;
  }
  if (limit === 1) {
    return [points[0]!];
  }
  return Array.from({ length: limit }, (_, index) => points[Math.round((index * (points.length - 1)) / (limit - 1))]!);
};

export const preparePlacePlanGeometryForSave = (geometry: CimmichPlacePlanGeometry): CimmichPlacePlanGeometry => {
  if (geometry.kind === 'paint') {
    if (geometry.strokes.length === 0 || geometry.strokes.length > 64) {
      throw new RangeError('Paint needs between 1 and 64 marks before this Plan can be saved.');
    }
    const baseBudget = Math.floor(PLAN_PAINT_POINTS_TOTAL_MAX / geometry.strokes.length);
    const extraBudget = PLAN_PAINT_POINTS_TOTAL_MAX % geometry.strokes.length;
    return {
      kind: 'paint',
      strokes: geometry.strokes.map((stroke, strokeIndex) => {
        if (stroke.points.length === 0) {
          throw new RangeError('An empty painted mark cannot be saved. Paint it again or remove it.');
        }
        const pointLimit = Math.min(PLAN_PAINT_POINTS_PER_STROKE_MAX, baseBudget + (strokeIndex < extraBudget ? 1 : 0));
        const radius = Number(stroke.radius);
        return {
          points: samplePoints(stroke.points, pointLimit).map((point) => ({
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
