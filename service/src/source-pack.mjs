import { createHash } from "node:crypto";
import {
  curatePrimeSet,
  primeCuratorPolicyVersion,
  vectorText,
} from "./prime-curator.mjs";
import { applyBiometricAuthority } from "./biometric-authority.mjs";

export const sourcePackPolicyVersion =
  "cimmich-source-pack-v8-evidence-modifiers";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));
export const digestValue = (value) =>
  sha256(typeof value === "string" ? value : canonicalJson(value));

const groupKey = (face) =>
  [face.personId, face.modelFamily, face.modelVersion, face.configDigest].join(
    "\u001f",
  );
const configKey = (face) =>
  [face.modelFamily, face.modelVersion, face.configDigest, face.dimension].join(
    "\u001f",
  );

const dot = (left, right) => {
  let total = 0;
  for (let index = 0; index < left.length; index += 1)
    total += left[index] * right[index];
  return total;
};

const normalizedCenter = (faces) => {
  const center = new Float64Array(faces[0].vector.length);
  let totalWeight = 0;
  for (const face of faces) {
    const weight = 0.5 + (Number(face.cleanScore ?? face.quality) || 0) * 0.5;
    totalWeight += weight;
    for (let index = 0; index < center.length; index += 1)
      center[index] += face.vector[index] * weight;
  }
  const norm = Math.sqrt(dot(center, center));
  return Float32Array.from(
    center,
    (value) => value / Math.max(Number.EPSILON, norm),
  );
};

export const buildPrimeModes = (
  selectedFaces,
  {
    iterations = 4,
    maxModes = 0,
    minFacesForModes = 6,
    minFacesPerMode = 2,
  } = {},
) => {
  if (maxModes < 2 || selectedFaces.length < minFacesForModes) return [];
  const faces = [...selectedFaces].sort(
    (left, right) =>
      (Number(right.cleanScore) || 0) - (Number(left.cleanScore) || 0) ||
      left.faceId.localeCompare(right.faceId),
  );
  const modeCount = Math.min(
    Math.floor(faces.length / Math.max(1, minFacesPerMode)),
    Math.floor(maxModes),
  );
  if (modeCount < 2) return [];

  const seeds = [faces[0]];
  while (seeds.length < modeCount) {
    const next = faces
      .filter((face) => !seeds.some((seed) => seed.faceId === face.faceId))
      .map((face) => ({
        face,
        separation: Math.min(
          ...seeds.map((seed) => 1 - dot(face.vector, seed.vector)),
        ),
      }))
      .sort(
        (left, right) =>
          right.separation - left.separation ||
          (Number(right.face.cleanScore) || 0) -
            (Number(left.face.cleanScore) || 0) ||
          left.face.faceId.localeCompare(right.face.faceId),
      )[0]?.face;
    if (!next) break;
    seeds.push(next);
  }

  let centers = seeds.map((face) => face.vector);
  let clusters = [];
  for (let iteration = 0; iteration < Math.max(1, iterations); iteration += 1) {
    clusters = Array.from({ length: centers.length }, () => []);
    for (const face of faces) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let index = 0; index < centers.length; index += 1) {
        const score = dot(face.vector, centers[index]);
        if (score > bestScore) {
          bestIndex = index;
          bestScore = score;
        }
      }
      clusters[bestIndex].push(face);
    }
    centers = clusters.map((cluster, index) =>
      cluster.length > 0 ? normalizedCenter(cluster) : centers[index],
    );
  }

  return clusters
    .map((cluster, index) => ({
      center: centers[index],
      modeIndex: index,
      selected: cluster.sort((left, right) =>
        left.faceId.localeCompare(right.faceId),
      ),
    }))
    .filter((mode) => mode.selected.length >= minFacesPerMode)
    .sort((left, right) =>
      left.selected[0].faceId.localeCompare(right.selected[0].faceId),
    )
    .map((mode, index) => ({ ...mode, modeIndex: index }));
};

const trustedFace = (face) =>
  face.identityState === "accepted" &&
  (face.identityOrigin === "trusted_import" ||
    face.identityOrigin === "user" ||
    face.decisionActorKind === "user");

const faceReference = (
  face,
  bucketKind,
  routingState,
  provenance = {},
  { bucketIdentity = bucketKind, conditionFeatures = {} } = {},
) => ({
  bucketKind,
  conditionFeatures: {
    ...(face.conditionFeatures || {}),
    modifiers: face.modifiers || [],
    captureContexts: face.captureContexts || [],
    ...conditionFeatures,
  },
  embedding: face.vector,
  faceId: face.faceId,
  memberFaceIds: [],
  personId: face.personId,
  provenance: {
    ...provenance,
    identityReviewState: face.personNeedsSort ? "sort" : "trusted",
  },
  qualityScore: Number(face.quality) || 0,
  referenceId: `ref_${digestValue(`${bucketKind}\u001f${bucketIdentity}\u001f${face.personId}\u001f${face.faceId}\u001f${face.vectorDigest}`).slice(0, 32)}`,
  referenceKind: "face",
  routingState,
  vectorDigest: face.vectorDigest,
});

const prototypeReference = (curation) => {
  const memberFaceIds = curation.selected.map((face) => face.faceId).sort();
  const vectorDigest = digestValue(vectorText(curation.prototype));
  return {
    bucketKind: "prime",
    conditionFeatures: {},
    embedding: curation.prototype,
    faceId: null,
    memberFaceIds,
    personId: curation.personId,
    provenance: {
      identityReviewState: curation.selected.some(
        (face) => face.personNeedsSort,
      )
        ? "sort"
        : "trusted",
      metrics: curation.metrics,
      policyVersion: sourcePackPolicyVersion,
    },
    qualityScore: null,
    referenceId: `ref_${digestValue(`prototype\u001f${curation.personId}\u001f${vectorDigest}`).slice(0, 32)}`,
    referenceKind: "prototype",
    routingState: "eligible",
    vectorDigest,
  };
};

const modePrototypeReference = (personId, mode) => {
  const memberFaceIds = mode.selected.map((face) => face.faceId).sort();
  const vectorDigest = digestValue(vectorText(mode.center));
  return {
    bucketKind: "prime",
    conditionFeatures: { primeMode: mode.modeIndex },
    embedding: mode.center,
    faceId: null,
    memberFaceIds,
    personId,
    provenance: {
      modeIndex: mode.modeIndex,
      identityReviewState: mode.selected.some((face) => face.personNeedsSort)
        ? "sort"
        : "trusted",
      policyVersion: "cimmich-prime-mode-prototype-v1",
      prototypeKind: "prime_mode",
    },
    qualityScore: null,
    referenceId: `ref_${digestValue(`prototype_mode\u001f${personId}\u001f${mode.modeIndex}\u001f${vectorDigest}`).slice(0, 32)}`,
    referenceKind: "prototype",
    routingState: "eligible",
    vectorDigest,
  };
};

export const compileSourcePack = (
  rawSourceFaces,
  {
    cutoff,
    predecessorPackId = null,
    primeOptions = {},
    evaluationContext = null,
    primeModeOptions = {},
    lowQualityLimit = 24,
    secondaryLimit = 24,
  } = {},
) => {
  const sourceFaces = applyBiometricAuthority(rawSourceFaces);
  const evidenceCutoff = new Date(cutoff || "");
  if (!Number.isFinite(evidenceCutoff.getTime())) {
    throw new Error("SourcePack compilation requires a valid evidence cutoff");
  }
  const eligible = sourceFaces
    .filter(
      (face) =>
        trustedFace(face) &&
        face.captureTime != null &&
        Number.isFinite(new Date(face.captureTime).getTime()) &&
        new Date(face.captureTime).getTime() <= evidenceCutoff.getTime(),
    )
    .sort(
      (left, right) =>
        groupKey(left).localeCompare(groupKey(right)) ||
        left.faceId.localeCompare(right.faceId),
    );
  if (eligible.length === 0) {
    throw new Error(
      "SourcePack compilation found no trusted pre-cutoff evidence",
    );
  }

  const configurations = new Set(eligible.map(configKey));
  if (configurations.size !== 1) {
    throw new Error(
      "SourcePack compilation requires exactly one embedding configuration",
    );
  }

  const groups = new Map();
  for (const face of eligible) {
    const key = groupKey(face);
    const group = groups.get(key) || [];
    group.push(face);
    groups.set(key, group);
  }

  const references = [];
  const people = [];
  for (const group of [...groups.values()].sort((left, right) =>
    left[0].personId.localeCompare(right[0].personId),
  )) {
    const selected = curatePrimeSet(group, primeOptions);
    const selectedIds = new Set(selected.selected.map((face) => face.faceId));
    const selectedAssetIds = new Set(
      selected.selected.map((face) => face.assetId),
    );
    const primeReferences = selected.selected
      .map((face) =>
        faceReference(face, "prime", "eligible", {
          reason: face.reason,
          coverageGain: face.coverageGain,
          ...(face.biometricAuthority
            ? { biometricAuthority: face.biometricAuthority }
            : {}),
        }),
      )
      .sort((left, right) => left.faceId.localeCompare(right.faceId));
    references.push(...primeReferences);

    let prototype = null;
    if (selected.prototype && selected.selected.length > 0) {
      prototype = prototypeReference({
        ...selected,
        configDigest: group[0].configDigest,
        dimension: group[0].dimension,
        modelFamily: group[0].modelFamily,
        modelVersion: group[0].modelVersion,
        personId: group[0].personId,
      });
      references.push(prototype);
    }

    const modePrototypes = buildPrimeModes(
      selected.selected,
      primeModeOptions,
    ).map((mode) => modePrototypeReference(group[0].personId, mode));
    references.push(...modePrototypes);

    const lowQualityReferences = group
      .filter(
        (face) =>
          !selectedIds.has(face.faceId) &&
          !selectedAssetIds.has(face.assetId) &&
          face.currentBucketKind === "lq",
      )
      .sort(
        (left, right) =>
          Number(Boolean(right.userPinnedLq)) -
            Number(Boolean(left.userPinnedLq)) ||
          Math.min(right.facePixelWidth || 0, right.facePixelHeight || 0) -
            Math.min(left.facePixelWidth || 0, left.facePixelHeight || 0) ||
          right.quality - left.quality ||
          left.faceId.localeCompare(right.faceId),
      )
      .filter(
        (face, index, rows) =>
          rows.findIndex((candidate) => candidate.assetId === face.assetId) ===
          index,
      )
      .slice(0, lowQualityLimit)
      .map((face) =>
        faceReference(
          face,
          "lq",
          "condition_only",
          {
            reason: face.userPinnedLq
              ? "user_low_quality_pin"
              : "automatic_low_quality_route",
          },
          {
            conditionFeatures: {
              ...(face.conditionFeatures || {}),
              condition: "low_quality_query",
              evidenceState: "observed",
              facePixelHeight: face.facePixelHeight,
              facePixelWidth: face.facePixelWidth,
              reasons: face.lowQualityReasons || [],
            },
          },
        ),
      );
    references.push(...lowQualityReferences);

    const secondaryReferences = group
      .filter(
        (face) =>
          !selectedIds.has(face.faceId) &&
          !selectedAssetIds.has(face.assetId) &&
          face.galleryPermission !== "never" &&
          (face.userPinnedSecondary || !face.blockedPrime),
      )
      .sort(
        (left, right) =>
          Number(right.userPinnedSecondary) -
            Number(left.userPinnedSecondary) ||
          Number(right.sourceTierHint === "secondary") -
            Number(left.sourceTierHint === "secondary") ||
          Number(right.currentBucketKind === "secondary") -
            Number(left.currentBucketKind === "secondary") ||
          right.quality - left.quality ||
          right.detection - left.detection ||
          left.faceId.localeCompare(right.faceId),
      )
      .filter(
        (face, index, rows) =>
          rows.findIndex((candidate) => candidate.assetId === face.assetId) ===
          index,
      )
      .slice(0, secondaryLimit)
      .map((face) => {
        const measured = Object.keys(face.conditionFeatures || {}).length > 0;
        return faceReference(
          face,
          "secondary",
          "condition_only",
          {
            reason: face.userPinnedSecondary
              ? "user_secondary_pin"
              : face.biometricAuthority === "corroborated_body_presence"
                ? "corroborated_body_presence"
                : face.sourceTierHint === "secondary"
                  ? "trusted_import_secondary_prior"
                  : "guarded_secondary_fallback",
          },
          {
            conditionFeatures: {
              ...(face.conditionFeatures || {}),
              condition: "general_secondary",
              evidenceState: measured ? "measured" : "unmeasured",
              ...(face.biometricAuthority
                ? { biometricAuthority: face.biometricAuthority }
                : {}),
              sourceTierHint: face.sourceTierHint || "unknown",
            },
          },
        );
      });
    references.push(...secondaryReferences);

    people.push({
      identityReviewState: group[0].personNeedsSort ? "sort" : "trusted",
      personId: group[0].personId,
      primeFaceIds: primeReferences.map((reference) => reference.faceId),
      prototypeReferenceId: prototype?.referenceId || null,
      ...(modePrototypes.length > 0
        ? {
            modePrototypeReferenceIds: modePrototypes.map(
              (reference) => reference.referenceId,
            ),
          }
        : {}),
      secondaryFaceIds: secondaryReferences.map(
        (reference) => reference.faceId,
      ),
      secondaryRoutingReady: secondaryReferences.some(
        (reference) => reference.routingState === "condition_only",
      ),
      modifierFaceIds: [
        ...new Set(
          [...primeReferences, ...secondaryReferences, ...lowQualityReferences]
            .filter(
              (reference) =>
                (reference.conditionFeatures.modifiers || []).length > 0,
            )
            .map((reference) => reference.faceId),
        ),
      ].sort(),
      lowQualityFaceIds: lowQualityReferences.map(
        (reference) => reference.faceId,
      ),
      lowQualityRoutingReady: lowQualityReferences.length > 0,
      selectionMetrics: selected.metrics,
    });
  }

  const first = eligible[0];
  const sourceRevisionDigest = digestValue(
    eligible.map((face) => ({
      captureTime: new Date(face.captureTime).toISOString(),
      faceId: face.faceId,
      galleryPermission: face.galleryPermission,
      identityClaimId: face.identityClaimId,
      personId: face.personId,
      personNeedsSort: Boolean(face.personNeedsSort),
      sourceTierHint: face.sourceTierHint || "unknown",
      currentBucketKind: face.currentBucketKind || null,
      facePixelHeight: face.facePixelHeight || 0,
      facePixelWidth: face.facePixelWidth || 0,
      lowQualityReasons: face.lowQualityReasons || [],
      modifiers: face.modifiers || [],
      captureContexts: face.captureContexts || [],
      vectorDigest: face.vectorDigest,
    })),
  );
  const manifest = {
    evidenceCutoff: evidenceCutoff.toISOString(),
    evaluationContext,
    model: {
      configDigest: first.configDigest,
      dimension: first.dimension,
      family: first.modelFamily,
      version: first.modelVersion,
    },
    people,
    policy: {
      prime: { ...primeOptions, policyVersion: primeCuratorPolicyVersion },
      ...(Number(primeModeOptions.maxModes) >= 2
        ? {
            primeModes: {
              ...primeModeOptions,
              policyVersion: "cimmich-prime-mode-prototype-v1",
            },
          }
        : {}),
      resolver: { state: "not-calibrated" },
      lowQuality: {
        limitPerPerson: lowQualityLimit,
        policyVersion: "cimmich-low-quality-condition-v1",
        routing: "low-quality-query-only",
      },
      secondary: {
        limitPerPerson: secondaryLimit,
        policyVersion: "guarded-fallback-v1",
        routing: "ambiguity-gated",
      },
      modifiers: {
        policyVersion: "evidence-modifier-v1",
        routing: "condition-aware-single-reference",
        duplicateReferenceWeight: false,
      },
      sourcePack: sourcePackPolicyVersion,
      sortTrust: {
        policyVersion: "review-only-v1",
        scoring: "rankable",
        supervision: "excluded",
      },
    },
    predecessorPackId,
    referenceDigests: references
      .map((reference) => ({
        bucketKind: reference.bucketKind,
        conditionFeatures: reference.conditionFeatures,
        faceId: reference.faceId,
        memberFaceIds: reference.memberFaceIds,
        personId: reference.personId,
        provenance: reference.provenance,
        referenceId: reference.referenceId,
        referenceKind: reference.referenceKind,
        routingState: reference.routingState,
        vectorDigest: reference.vectorDigest,
      }))
      .sort((left, right) => left.referenceId.localeCompare(right.referenceId)),
    sourceRevisionDigest,
  };
  const packDigest = digestValue(manifest);
  return {
    dimension: first.dimension,
    evidenceCutoff: evidenceCutoff.toISOString(),
    manifest,
    modelFamily: first.modelFamily,
    modelVersion: first.modelVersion,
    configDigest: first.configDigest,
    packDigest,
    packId: `sourcepack_${packDigest.slice(0, 32)}`,
    policyVersion: sourcePackPolicyVersion,
    predecessorPackId,
    references,
    sourceRevisionDigest,
    summary: {
      people: people.length,
      reviewOnlyPeople: people.filter(
        (person) => person.identityReviewState === "sort",
      ).length,
      primeFaces: references.filter(
        (reference) =>
          reference.bucketKind === "prime" &&
          reference.referenceKind === "face",
      ).length,
      prototypes: references.filter(
        (reference) => reference.referenceKind === "prototype",
      ).length,
      secondaryFaces: references.filter(
        (reference) => reference.bucketKind === "secondary",
      ).length,
      secondaryRoutingReady: references.filter(
        (reference) =>
          reference.bucketKind === "secondary" &&
          reference.routingState === "condition_only",
      ).length,
      modifierFaces: references.filter(
        (reference) =>
          reference.referenceKind === "face" &&
          (reference.conditionFeatures.modifiers || []).length > 0,
      ).length,
      lowQualityFaces: references.filter(
        (reference) => reference.bucketKind === "lq",
      ).length,
      lowQualityRoutingReady: references.filter(
        (reference) =>
          reference.bucketKind === "lq" &&
          reference.routingState === "condition_only",
      ).length,
      sourceFaces: eligible.length,
    },
  };
};
