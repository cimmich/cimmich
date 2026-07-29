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

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

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
