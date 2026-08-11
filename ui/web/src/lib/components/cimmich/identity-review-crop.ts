export type IdentityReviewCropSource = {
  box: { h: number; w: number; x: number; y: number };
  height: number;
  width: number;
};

export type IdentityReviewCropFrame = {
  h: number;
  w: number;
  x: number;
  y: number;
};

export type IdentityReviewQuarterTurns = 0 | 1 | 2 | 3;

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const normalized = (value: number) => Number(value.toFixed(12));

export const normalizeIdentityReviewQuarterTurns = (quarterTurns: number) =>
  (((Math.trunc(quarterTurns) % 4) + 4) % 4) as IdentityReviewQuarterTurns;

export const rotateIdentityReviewPoint = (
  point: { x: number; y: number },
  quarterTurns: number,
): { x: number; y: number } => {
  const turns = normalizeIdentityReviewQuarterTurns(quarterTurns);
  if (turns === 1) {
    return { x: normalized(1 - point.y), y: normalized(point.x) };
  }
  if (turns === 2) {
    return { x: normalized(1 - point.x), y: normalized(1 - point.y) };
  }
  if (turns === 3) {
    return { x: normalized(point.y), y: normalized(1 - point.x) };
  }
  return point;
};

export const unrotateIdentityReviewPoint = (point: { x: number; y: number }, quarterTurns: number) =>
  rotateIdentityReviewPoint(point, 4 - normalizeIdentityReviewQuarterTurns(quarterTurns));

export const fitIdentityReviewCrop = (
  item: IdentityReviewCropSource,
  targetAspect = 4 / 3,
  facePadding = 2.8,
): IdentityReviewCropFrame => {
  const sourceWidth = Math.max(1, item.width);
  const sourceHeight = Math.max(1, item.height);
  const sourceAspect = sourceWidth / sourceHeight;
  const normalizedTargetAspect = targetAspect / sourceAspect;

  let w = clamp(item.box.w * facePadding, 0.01, 1);
  let h = clamp(item.box.h * facePadding, 0.01, 1);

  if (w / h < normalizedTargetAspect) {
    w = h * normalizedTargetAspect;
  } else {
    h = w / normalizedTargetAspect;
  }

  if (w > 1) {
    w = 1;
    h = w / normalizedTargetAspect;
  }
  if (h > 1) {
    h = 1;
    w = h * normalizedTargetAspect;
  }

  const centerX = item.box.x + item.box.w / 2;
  const centerY = item.box.y + item.box.h / 2;

  return {
    h,
    w,
    x: clamp(centerX - w / 2, 0, 1 - w),
    y: clamp(centerY - h / 2, 0, 1 - h),
  };
};

export const rotateIdentityReviewSource = (
  item: IdentityReviewCropSource,
  quarterTurns: number,
): IdentityReviewCropSource => {
  const turns = normalizeIdentityReviewQuarterTurns(quarterTurns);
  if (turns === 0) {
    return item;
  }
  const { h, w, x, y } = item.box;
  if (turns === 1) {
    return { box: { h: w, w: h, x: normalized(1 - y - h), y: x }, height: item.width, width: item.height };
  }
  if (turns === 2) {
    return {
      box: { h, w, x: normalized(1 - x - w), y: normalized(1 - y - h) },
      height: item.height,
      width: item.width,
    };
  }
  return { box: { h: w, w: h, x: y, y: normalized(1 - x - w) }, height: item.width, width: item.height };
};

export const identityReviewSvgTransform = (width: number, height: number, quarterTurns: number) => {
  const turns = normalizeIdentityReviewQuarterTurns(quarterTurns);
  if (turns === 1) {
    return `translate(${height} 0) rotate(90)`;
  }
  if (turns === 2) {
    return `translate(${width} ${height}) rotate(180)`;
  }
  if (turns === 3) {
    return `translate(0 ${width}) rotate(-90)`;
  }
  return '';
};

export const identityReviewCssTransform = (width: number, height: number, quarterTurns: number) =>
  identityReviewSvgTransform(width, height, quarterTurns)
    .replace(/translate\(([^ ]+) ([^)]+)\)/, 'translate($1px, $2px)')
    .replace(/rotate\(([-\d]+)\)/, 'rotate($1deg)');
