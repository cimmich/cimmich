export const lowQualityPolicyVersion = "cimmich-low-quality-condition-v1";

export const lowQualityReasons = ({
  detection = 0,
  facePixelHeight = 0,
  facePixelWidth = 0,
  quality = 0,
} = {}) => {
  const reasons = [];
  const minimumPixels = Math.min(
    Math.max(0, Number(facePixelWidth) || 0),
    Math.max(0, Number(facePixelHeight) || 0),
  );
  if (minimumPixels > 0 && minimumPixels < 80) reasons.push("tiny_face");
  const qualityScore = Number(quality) || 0;
  const detectionScore = Number(detection) || 0;
  if (
    qualityScore > 0 &&
    detectionScore > 0 &&
    qualityScore < 0.68 &&
    detectionScore < 0.75
  ) {
    reasons.push("noisy_or_uncertain");
  }
  return reasons;
};

export const isLowQualityEvidence = (face) =>
  lowQualityReasons(face).length > 0;
