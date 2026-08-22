// Shared square-crop framing for Cimmich face/body observation thumbnails.
//
// The crop is square in SOURCE PIXELS whenever the source image dimensions are
// known, so a square tile shows the observation without stretching it. Callers
// without dimensions fall back to the legacy normalized square, which keeps the
// old (stretch-prone) framing rather than dropping the crop entirely.

export type CimmichSquareCropInput = {
  boxH: number;
  boxW: number;
  boxX: number;
  boxY: number;
  height: number;
  padding: number;
  width: number;
};

export type CimmichSquareCropFrame = {
  cropH: number;
  cropW: number;
  cropX: number;
  cropY: number;
};

export type CimmichPresentationSquareCropInput = {
  crop: { h: number; w: number; x: number; y: number } | null;
  height: number;
  presentationAspect: number;
  width: number;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export const cimmichSquareCropFrame = ({
  boxH,
  boxW,
  boxX,
  boxY,
  height,
  padding,
  width,
}: CimmichSquareCropInput): CimmichSquareCropFrame => {
  const centerX = boxX + boxW / 2;
  const centerY = boxY + boxH / 2;
  if (width > 0 && height > 0) {
    const cropPixels = Math.min(width, height, Math.max(boxW * width * padding, boxH * height * padding, 1));
    const cropW = cropPixels / width;
    const cropH = cropPixels / height;
    return {
      cropH,
      cropW,
      cropX: Math.max(0, Math.min(1 - cropW, centerX - cropW / 2)),
      cropY: Math.max(0, Math.min(1 - cropH, centerY - cropH / 2)),
    };
  }
  const cropSize = Math.min(1, Math.max(boxW * padding, boxH * padding, 0.01));
  return {
    cropH: cropSize,
    cropW: cropSize,
    cropX: Math.max(0, Math.min(1 - cropSize, centerX - cropSize / 2)),
    cropY: Math.max(0, Math.min(1 - cropSize, centerY - cropSize / 2)),
  };
};

// Positions an <img class="max-w-none"> inside an overflow-hidden square
// container. Without source dimensions the image falls back to a centered
// cover fill instead of guessing a frame.
export const cimmichSquareObservationStyle = (input: CimmichSquareCropInput): string => {
  if (!input.width || !input.height) {
    return 'position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;';
  }
  const { cropH, cropW, cropX, cropY } = cimmichSquareCropFrame(input);
  return [
    'position: absolute',
    `width: ${100 / cropW}%`,
    'height: auto',
    'max-width: none',
    `left: ${(-cropX / cropW) * 100}%`,
    `top: ${(-cropY / cropH) * 100}%`,
  ].join('; ');
};

// Replays a saved presentation frame inside a square portrait tile. This is
// shared by the People overview and every connection surface so choosing a
// face once does not silently fall back to the full source photo elsewhere.
export const cimmichPresentationSquareStyle = ({
  crop: savedCrop,
  height,
  presentationAspect,
  width,
}: CimmichPresentationSquareCropInput): string => {
  if (!width || !height) {
    return 'position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;';
  }
  const sourceAspect = width / height;
  const presentationBase =
    sourceAspect > presentationAspect
      ? { h: 1, w: presentationAspect / sourceAspect }
      : { h: sourceAspect / presentationAspect, w: 1 };
  const crop = savedCrop ?? {
    h: presentationBase.h,
    w: presentationBase.w,
    x: (1 - presentationBase.w) / 2,
    y: (1 - presentationBase.h) / 2,
  };
  const zoom = Math.max(1, Math.max(presentationBase.w / crop.w, presentationBase.h / crop.h));
  const squareBase = sourceAspect > 1 ? { h: 1, w: 1 / sourceAspect } : { h: sourceAspect, w: 1 };
  const cropW = squareBase.w / zoom;
  const cropH = squareBase.h / zoom;
  const centerX = crop.x + crop.w / 2;
  const centerY = crop.y + crop.h / 2;
  const cropX = Math.max(0, Math.min(1 - cropW, centerX - cropW / 2));
  const cropY = Math.max(0, Math.min(1 - cropH, centerY - cropH / 2));
  return [
    'position: absolute',
    `width: ${100 / cropW}%`,
    'height: auto',
    'max-width: none',
    `left: ${(-cropX / cropW) * 100}%`,
    `top: ${(-cropY / cropH) * 100}%`,
  ].join('; ');
};

// Background-image variant for tiles that render the crop as a CSS background.
export const cimmichSquareCropBackgroundStyle = (input: CimmichSquareCropInput & { url: string }): string => {
  const { cropH, cropW, cropX, cropY } = cimmichSquareCropFrame(input);
  const positionX = clampPercent((cropX / Math.max(0.0001, 1 - cropW)) * 100);
  const positionY = clampPercent((cropY / Math.max(0.0001, 1 - cropH)) * 100);
  return [
    `background-image: url("${input.url}")`,
    `background-size: ${100 / cropW}% ${100 / cropH}%`,
    `background-position: ${positionX}% ${positionY}%`,
  ].join('; ');
};
