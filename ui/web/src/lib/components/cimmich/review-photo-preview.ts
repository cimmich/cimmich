export type ReviewPhotoPreviewFit = {
  height: number;
  scale: number;
  width: number;
};

export const reviewPhotoPreviewZoomLevels = [1, 1.5, 2, 3, 4] as const;

export const fitReviewPhotoPreview = (
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
): ReviewPhotoPreviewFit => {
  const safeViewportWidth = Math.max(1, viewportWidth);
  const safeViewportHeight = Math.max(1, viewportHeight);
  const safeImageWidth = Math.max(1, imageWidth);
  const safeImageHeight = Math.max(1, imageHeight);
  const scale = Math.min(safeViewportWidth / safeImageWidth, safeViewportHeight / safeImageHeight);

  return {
    height: safeImageHeight * scale,
    scale,
    width: safeImageWidth * scale,
  };
};
