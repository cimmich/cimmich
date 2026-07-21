const dot = (left, right) => {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
};

const groupKey = (face) =>
  [
    face.personId,
    face.modelFamily,
    face.modelVersion,
    face.configDigest,
    face.dimension,
  ].join("\u001f");

const canProveBodyPresenceAuthority = (face, { minDetection, minQuality }) =>
  face.sourceTierHint === "body_presence" &&
  (face.identityState == null || face.identityState === "accepted") &&
  !face.autoLowQuality &&
  !face.blockedPrime &&
  !face.userMainOverride &&
  Number(face.detection) >= minDetection &&
  Number(face.quality) >= minQuality &&
  (Array.isArray(face.vector) || ArrayBuffer.isView(face.vector));

const corroborates = (
  left,
  right,
  { competitorMargin, minCorroborationCosine },
) => {
  if (left.assetId === right.assetId) {
    return false;
  }
  const threshold = Math.max(
    minCorroborationCosine,
    Number.isFinite(Number(left.maxOtherPrimeSimilarity))
      ? Number(left.maxOtherPrimeSimilarity) + competitorMargin
      : -1,
    Number.isFinite(Number(right.maxOtherPrimeSimilarity))
      ? Number(right.maxOtherPrimeSimilarity) + competitorMargin
      : -1,
  );
  return dot(left.vector, right.vector) >= threshold;
};

/**
 * Imported body/presence tags are a conservative prior, not an irreversible
 * biometric prohibition. They earn matching authority only when two clean,
 * accepted observations on different photos corroborate one another above
 * both an absolute floor and their nearest outside-Person Prime competitor.
 *
 * The gate unlocks the cohort as Secondary evidence; the Prime curator still
 * chooses the smallest clean anchor set. Explicit user bucket choices remain
 * authoritative and a lone observation can never promote itself.
 */
export const applyBiometricAuthority = (
  faces,
  {
    competitorMargin = 0.04,
    minCorroborationCosine = 0.28,
    minDetection = 0.5,
    minQuality = 0.68,
  } = {},
) => {
  const groups = new Map();
  for (const face of faces) {
    const key = groupKey(face);
    const group = groups.get(key) || [];
    group.push(face);
    groups.set(key, group);
  }

  const authorityByFace = new Map();
  for (const group of groups.values()) {
    const candidates = group.filter((face) =>
      canProveBodyPresenceAuthority(face, { minDetection, minQuality }),
    );
    const corroborated = new Set();
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < candidates.length;
        rightIndex += 1
      ) {
        if (
          corroborates(candidates[leftIndex], candidates[rightIndex], {
            competitorMargin,
            minCorroborationCosine,
          })
        ) {
          corroborated.add(candidates[leftIndex].faceId);
          corroborated.add(candidates[rightIndex].faceId);
        }
      }
    }
    if (corroborated.size < 2) {
      continue;
    }
    for (const face of group) {
      if (
        face.sourceTierHint === "body_presence" &&
        !face.userMainOverride &&
        !face.blockedPrime
      ) {
        authorityByFace.set(face.faceId, "corroborated_body_presence");
      }
    }
  }

  return faces.map((face) => {
    const userAuthority =
      face.sourceTierHint === "body_presence" &&
      (face.identityState == null || face.identityState === "accepted") &&
      (face.pinnedPrime || face.userPinnedSecondary);
    const policyAuthority = authorityByFace.get(face.faceId);
    if (!userAuthority && !policyAuthority) {
      return face;
    }
    return {
      ...face,
      biometricAuthority: userAuthority
        ? "user_bucket_override"
        : policyAuthority,
      galleryPermission: "allowed",
      // Corroboration proves that accepted observations can participate as
      // guarded Secondary evidence. It does not prove that any crop contains
      // a complete, low-noise face. Until completeness is measured, only an
      // explicit user Prime or an already reviewed policy Prime may seed the
      // primary gallery.
      primeEligible: userAuthority
        ? face.primeEligible
        : face.faceCompletenessQualified === true ||
          face.currentBucketKind === "prime",
      preservedPrime: !userAuthority && face.currentBucketKind === "prime",
      sourceTierHint: "secondary",
    };
  });
};
