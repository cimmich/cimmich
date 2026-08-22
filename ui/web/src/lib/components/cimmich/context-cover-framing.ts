import type { CimmichContextCoverCrop } from '$lib/services/cimmich.service';

export type CimmichContextCoverFrame = { centerX: number; centerY: number; zoom: number };

export const CIMMICH_CONTEXT_HERO_ASPECT = 12 / 5;

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export const contextCoverBaseCrop = (width: number, height: number): CimmichContextCoverCrop => {
  const sourceAspect = Math.max(1, width) / Math.max(1, height);
  if (sourceAspect > CIMMICH_CONTEXT_HERO_ASPECT) {
    const w = CIMMICH_CONTEXT_HERO_ASPECT / sourceAspect;
    return { h: 1, w, x: (1 - w) / 2, y: 0 };
  }
  const h = sourceAspect / CIMMICH_CONTEXT_HERO_ASPECT;
  return { h, w: 1, x: 0, y: (1 - h) / 2 };
};

export const contextCoverFrameFromCrop = (
  crop: CimmichContextCoverCrop | null,
  width: number,
  height: number,
): CimmichContextCoverFrame => {
  if (!crop) {
    return { centerX: 50, centerY: 50, zoom: 1 };
  }
  const base = contextCoverBaseCrop(width, height);
  return {
    centerX: clamp((crop.x + crop.w / 2) * 100, 0, 100),
    centerY: clamp((crop.y + crop.h / 2) * 100, 0, 100),
    zoom: clamp(Math.max(base.w / crop.w, base.h / crop.h), 1, 4),
  };
};

export const contextCoverCropFromFrame = (
  frame: CimmichContextCoverFrame,
  width: number,
  height: number,
): CimmichContextCoverCrop => {
  const base = contextCoverBaseCrop(width, height);
  const w = base.w / clamp(frame.zoom, 1, 4);
  const h = base.h / clamp(frame.zoom, 1, 4);
  return {
    h,
    w,
    x: clamp(frame.centerX / 100 - w / 2, 0, 1 - w),
    y: clamp(frame.centerY / 100 - h / 2, 0, 1 - h),
  };
};

export const contextCoverCropImageStyle = (crop: CimmichContextCoverCrop) =>
  [
    'position:absolute',
    `width:${100 / crop.w}%`,
    'height:auto',
    'max-width:none',
    `left:${(-crop.x / crop.w) * 100}%`,
    `top:${(-crop.y / crop.h) * 100}%`,
  ].join(';');

export const contextCoverHeroStyle = (crop: CimmichContextCoverCrop | null, width: number, height: number) => {
  if (!crop) {
    return '';
  }
  const frame = contextCoverFrameFromCrop(crop, width, height);
  return [
    `--context-cover-x:${frame.centerX}%`,
    `--context-cover-y:${frame.centerY}%`,
    `--context-cover-zoom:${frame.zoom}`,
  ].join(';');
};
