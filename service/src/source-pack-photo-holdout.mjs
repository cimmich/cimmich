import { compileSourcePack, digestValue } from "./source-pack.mjs";
import { applyBiometricAuthority } from "./biometric-authority.mjs";

export const photoHoldoutEvaluatorVersion =
  "cimmich-context-isolated-holdout-v2";

const trustedFace = (face) =>
  face.identityState === "accepted" &&
  (face.identityOrigin === "trusted_import" ||
    face.identityOrigin === "user" ||
    face.decisionActorKind === "user");

const queryEligible = (face) =>
  trustedFace(face) &&
  !face.personNeedsSort &&
  (face.galleryPermission !== "never" || face.currentBucketKind === "lq") &&
  (face.sourceTierHint !== "body_presence" ||
    face.currentBucketKind === "lq") &&
  face.captureTime != null &&
  Number.isFinite(new Date(face.captureTime).getTime());

const faceScore = (face) =>
  (Number(face.quality) || 0) * 0.7 + (Number(face.detection) || 0) * 0.3;

const contextIds = (face) =>
  [
    ...new Set(
      (face.captureContexts || [])
        .map((context) => context.contextId)
        .filter(Boolean),
    ),
  ].sort();

const bestFacePerAsset = (faces) => {
  const assets = new Map();
  for (const face of faces) {
    const current = assets.get(face.assetId);
    const score = faceScore(face);
    const currentScore = current ? faceScore(current) : -1;
    if (
      !current ||
      score > currentScore ||
      (score === currentScore && face.faceId < current.faceId)
    ) {
      assets.set(face.assetId, face);
    }
  }
  return [...assets.values()];
};

const bestFacePerIndependentContext = (faces) => {
  const assets = bestFacePerAsset(faces);
  const parent = new Map(assets.map((face) => [face.assetId, face.assetId]));
  const find = (assetId) => {
    const current = parent.get(assetId);
    if (current === assetId) return assetId;
    const root = find(current);
    parent.set(assetId, root);
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent.set(
        leftRoot < rightRoot ? rightRoot : leftRoot,
        leftRoot < rightRoot ? leftRoot : rightRoot,
      );
    }
  };
  const firstAssetByContext = new Map();
  for (const face of assets) {
    for (const contextId of contextIds(face)) {
      const first = firstAssetByContext.get(contextId);
      if (first) union(first, face.assetId);
      else firstAssetByContext.set(contextId, face.assetId);
    }
  }

  const units = new Map();
  for (const face of assets) {
    const unitId =
      contextIds(face).length > 0 ? find(face.assetId) : face.assetId;
    const current = units.get(unitId);
    if (
      !current ||
      faceScore(face) > faceScore(current) ||
      (faceScore(face) === faceScore(current) && face.faceId < current.faceId)
    ) {
      units.set(unitId, face);
    }
  }
  return [...units.values()];
};

const heldOutContextClosure = (sourceFaces, queryFaces) => {
  const heldOutAssets = new Set(queryFaces.map((face) => face.assetId));
  const heldOutContexts = new Set(queryFaces.flatMap(contextIds));
  let changed = true;
  while (changed) {
    changed = false;
    for (const face of sourceFaces) {
      const contexts = contextIds(face);
      if (
        !heldOutAssets.has(face.assetId) &&
        !contexts.some((contextId) => heldOutContexts.has(contextId))
      ) {
        continue;
      }
      if (!heldOutAssets.has(face.assetId)) {
        heldOutAssets.add(face.assetId);
        changed = true;
      }
      for (const contextId of contexts) {
        if (!heldOutContexts.has(contextId)) {
          heldOutContexts.add(contextId);
          changed = true;
        }
      }
    }
  }
  return { heldOutAssets, heldOutContexts };
};

const buildFold = (sourceFaces, queryFaces, split, options) => {
  // A capture context is the isolation unit. Connected contexts are closed
  // transitively so nested Burst/Same-moment groupings cannot leak a sibling
  // back into gallery selection or prototype compilation. Ungrouped photos
  // retain complete-asset isolation.
  const { heldOutAssets, heldOutContexts } = heldOutContextClosure(
    sourceFaces,
    queryFaces,
  );
  const trainingFaces = sourceFaces.filter(
    (face) => !heldOutAssets.has(face.assetId),
  );
  const pack = compileSourcePack(trainingFaces, {
    cutoff: options.cutoff,
    evaluationContext: {
      evaluatorVersion: photoHoldoutEvaluatorVersion,
      queryDigest: digestValue(
        queryFaces.map((face) => ({
          assetId: face.assetId,
          captureContextIds: contextIds(face),
          faceId: face.faceId,
          personId: face.personId,
        })),
      ),
      seed: options.seed,
      split,
    },
    primeOptions: options.primeOptions,
    primeModeOptions: options.primeModeOptions,
    lowQualityLimit: options.lowQualityLimit,
    secondaryLimit: options.secondaryLimit,
  });
  return {
    pack,
    queries: queryFaces.map((face) => ({
      assetId: face.assetId,
      captureContextIds: contextIds(face),
      faceId: face.faceId,
      personId: face.personId,
      sourceTierHint: face.sourceTierHint || "unknown",
    })),
    split,
    heldOutAssets: heldOutAssets.size,
    heldOutContexts: heldOutContexts.size,
    trainingFaces: trainingFaces.length,
  };
};

export const buildPhotoIsolatedPacks = (
  rawSourceFaces,
  {
    cutoff,
    primeOptions = {},
    primeModeOptions = {},
    lowQualityLimit = 24,
    secondaryLimit = 24,
    seed = "cimmich-context-isolated-v2",
  } = {},
) => {
  const queryAuthorityFaces = applyBiometricAuthority(rawSourceFaces);
  const byPerson = new Map();
  for (const face of queryAuthorityFaces.filter(queryEligible)) {
    const group = byPerson.get(face.personId) || [];
    group.push(face);
    byPerson.set(face.personId, group);
  }

  const calibration = [];
  const holdout = [];
  let singleIndependentContextPeople = 0;
  for (const [personId, faces] of [...byPerson.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const independentContexts = bestFacePerIndependentContext(faces).sort(
      (left, right) =>
        digestValue(
          `${seed}\u001f${personId}\u001f${left.assetId}`,
        ).localeCompare(
          digestValue(`${seed}\u001f${personId}\u001f${right.assetId}`),
        ) || left.faceId.localeCompare(right.faceId),
    );
    if (independentContexts.length < 2) {
      singleIndependentContextPeople += 1;
      continue;
    }
    calibration.push(independentContexts[0]);
    holdout.push(independentContexts[1]);
  }
  if (calibration.length === 0) {
    throw new Error(
      "Context-isolated evaluation requires at least one Person with two independent eligible capture contexts",
    );
  }

  const options = {
    cutoff,
    lowQualityLimit,
    primeModeOptions,
    primeOptions,
    secondaryLimit,
    seed,
  };
  const calibrationFold = buildFold(
    rawSourceFaces,
    calibration,
    "calibration",
    options,
  );
  const holdoutFold = buildFold(rawSourceFaces, holdout, "holdout", options);
  return {
    calibration: calibrationFold,
    cohortDigest: digestValue({
      calibration: calibrationFold.queries,
      holdout: holdoutFold.queries,
      seed,
    }),
    holdout: holdoutFold,
    stats: {
      evaluablePeople: calibration.length,
      singleIndependentContextPeople,
      // Compatibility alias for older diagnostics. Its meaning is now the
      // stronger independent-context count, not raw photo count.
      singlePhotoPeople: singleIndependentContextPeople,
      sortPeopleExcluded: new Set(
        queryAuthorityFaces
          .filter((face) => face.personNeedsSort)
          .map((face) => face.personId),
      ).size,
      sourceFaces: rawSourceFaces.length,
    },
  };
};

const winner = (rows, scoreKey) =>
  [...rows].sort(
    (left, right) =>
      right[scoreKey] - left[scoreKey] ||
      left.personId.localeCompare(right.personId),
  )[0];

const layeredScore = (row, ambiguous, policy, { useModifier = true } = {}) => {
  const secondary =
    ambiguous && row.secondaryScore != null
      ? (1 - policy.weight) * row.robustPrimeScore +
        policy.weight * row.secondaryScore
      : row.robustPrimeScore;
  const modifier =
    useModifier && row.modifierScore != null
      ? 0.35 * row.robustPrimeScore + 0.65 * row.modifierScore
      : row.robustPrimeScore;
  const lowQuality =
    row.queryLowQuality && row.lowQualityScore != null
      ? 0.65 * row.robustPrimeScore + 0.35 * row.lowQualityScore
      : row.robustPrimeScore;
  return Math.max(secondary, modifier, lowQuality);
};

export const summarizeModifierTransitions = (rows, policy) => {
  const queries = Map.groupBy(rows, (row) => row.queryFaceId);
  const summary = {
    baselineCorrect: 0,
    changedWinner: 0,
    conditionedCorrect: 0,
    falseFlips: 0,
    modifierEligible: 0,
    queries: queries.size,
    rescues: 0,
    unchangedCorrect: 0,
    unchangedMiss: 0,
  };
  for (const group of queries.values()) {
    const routableGroup = group.filter(
      (row) =>
        row.robustRank == null ||
        row.robustRank <= 2 ||
        row.modifierScore != null ||
        row.lowQualityScore != null,
    );
    const ambiguous = (group[0]?.primeMargin ?? 1) < policy.threshold;
    const baseline = winner(
      routableGroup.map((row) => ({
        ...row,
        finalScore: layeredScore(row, ambiguous, policy, {
          useModifier: false,
        }),
      })),
      "finalScore",
    );
    const conditioned = winner(
      routableGroup.map((row) => ({
        ...row,
        finalScore: layeredScore(row, ambiguous, policy),
      })),
      "finalScore",
    );
    const truthPersonId = group[0]?.truthPersonId;
    const baselineCorrect = baseline?.personId === truthPersonId;
    const conditionedCorrect = conditioned?.personId === truthPersonId;
    if (baselineCorrect) summary.baselineCorrect += 1;
    if (conditionedCorrect) summary.conditionedCorrect += 1;
    if (routableGroup.some((row) => row.modifierScore != null))
      summary.modifierEligible += 1;
    if (baseline?.personId !== conditioned?.personId)
      summary.changedWinner += 1;
    if (!baselineCorrect && conditionedCorrect) summary.rescues += 1;
    if (baselineCorrect && !conditionedCorrect) summary.falseFlips += 1;
    if (baselineCorrect && conditionedCorrect) summary.unchangedCorrect += 1;
    if (!baselineCorrect && !conditionedCorrect) summary.unchangedMiss += 1;
  }
  return summary;
};

export const chooseGuardedSecondaryPolicy = (calibrationRows) => {
  const thresholds = [0.01, 0.02, 0.04, 0.06, 0.08];
  const weights = [0.05, 0.1, 0.15, 0.2, 0.25];
  const queries = Map.groupBy(calibrationRows, (row) => row.queryFaceId);
  const candidates = [];
  for (const threshold of thresholds) {
    for (const weight of weights) {
      let correct = 0;
      let falseFlips = 0;
      let rescues = 0;
      let routed = 0;
      for (const rows of queries.values()) {
        const routableRows = rows.filter(
          (row) => row.robustRank == null || row.robustRank <= 2,
        );
        const margin = rows[0]?.primeMargin ?? 1;
        const ambiguous = margin < threshold;
        const scored = routableRows.map((row) => ({
          ...row,
          finalScore: layeredScore(row, ambiguous, { weight }),
        }));
        const selected = winner(scored, "finalScore");
        const baseline = winner(rows, "robustPrimeScore");
        const baselineCorrect = baseline?.personId === baseline?.truthPersonId;
        const selectedCorrect = selected?.personId === selected?.truthPersonId;
        if (selected?.personId === selected?.truthPersonId) correct += 1;
        if (baselineCorrect && !selectedCorrect) falseFlips += 1;
        if (!baselineCorrect && selectedCorrect) rescues += 1;
        if (ambiguous && routableRows.some((row) => row.secondaryScore != null))
          routed += 1;
      }
      candidates.push({
        correct,
        falseFlips,
        netGain: rescues - falseFlips,
        rescues,
        routed,
        threshold,
        weight,
      });
    }
  }
  return candidates.sort(
    (left, right) =>
      right.netGain - left.netGain ||
      left.falseFlips - right.falseFlips ||
      right.correct - left.correct ||
      left.routed - right.routed ||
      left.weight - right.weight ||
      left.threshold - right.threshold,
  )[0];
};

export const summarizePhotoIsolatedScores = (rows, policy) => {
  const queries = Map.groupBy(rows, (row) => row.queryFaceId);
  const summary = {
    layeredResolver: {
      correct: 0,
      queries: queries.size,
      secondaryRouted: 0,
      modifierRouted: 0,
      lowQualityRouted: 0,
    },
    rawPrime: { correct: 0, queries: queries.size },
    robustPrime: { correct: 0, queries: queries.size },
    tiers: {},
  };
  for (const group of queries.values()) {
    const routableGroup = group.filter(
      (row) =>
        row.robustRank == null ||
        row.robustRank <= 2 ||
        row.modifierScore != null ||
        row.lowQualityScore != null,
    );
    const raw = winner(group, "rawPrimeScore");
    const robust = winner(group, "robustPrimeScore");
    const ambiguous = (group[0]?.primeMargin ?? 1) < policy.threshold;
    const guarded = winner(
      routableGroup.map((row) => ({
        ...row,
        finalScore: layeredScore(row, ambiguous, policy),
      })),
      "finalScore",
    );
    if (raw?.personId === raw?.truthPersonId) summary.rawPrime.correct += 1;
    if (robust?.personId === robust?.truthPersonId)
      summary.robustPrime.correct += 1;
    if (guarded?.personId === guarded?.truthPersonId)
      summary.layeredResolver.correct += 1;
    if (ambiguous && routableGroup.some((row) => row.secondaryScore != null))
      summary.layeredResolver.secondaryRouted += 1;
    if (routableGroup.some((row) => row.modifierScore != null))
      summary.layeredResolver.modifierRouted += 1;
    if (
      routableGroup.some(
        (row) => row.queryLowQuality && row.lowQualityScore != null,
      )
    )
      summary.layeredResolver.lowQualityRouted += 1;
    const tier = group[0]?.sourceTierHint || "unknown";
    const tierSummary = summary.tiers[tier] || { correct: 0, queries: 0 };
    tierSummary.queries += 1;
    if (guarded?.personId === guarded?.truthPersonId) tierSummary.correct += 1;
    summary.tiers[tier] = tierSummary;
  }
  for (const lane of [
    summary.rawPrime,
    summary.robustPrime,
    summary.layeredResolver,
  ]) {
    lane.accuracy = lane.correct / Math.max(1, lane.queries);
    lane.macroAccuracy = lane.accuracy;
  }
  for (const tier of Object.values(summary.tiers)) {
    tier.accuracy = tier.correct / Math.max(1, tier.queries);
  }
  return summary;
};

export const photoIsolatedOutcomes = (rows, policy) => {
  const queries = Map.groupBy(rows, (row) => row.queryFaceId);
  return [...queries.values()].map((group) => {
    const routableGroup = group.filter(
      (row) =>
        row.robustRank == null ||
        row.robustRank <= 2 ||
        row.modifierScore != null ||
        row.lowQualityScore != null,
    );
    const raw = winner(group, "rawPrimeScore");
    const robust = winner(group, "robustPrimeScore");
    const ambiguous = (group[0]?.primeMargin ?? 1) < policy.threshold;
    const layered = winner(
      routableGroup.map((row) => ({
        ...row,
        finalScore: layeredScore(row, ambiguous, policy),
      })),
      "finalScore",
    );
    const truth = group.find((row) => row.personId === row.truthPersonId);
    return {
      layeredCorrect: layered?.personId === truth?.truthPersonId,
      layeredWinnerPersonId: layered?.personId || null,
      primeMargin: group[0]?.primeMargin ?? null,
      queryAssetId: group[0]?.queryAssetId ?? null,
      queryFaceId: group[0]?.queryFaceId,
      rawCorrect: raw?.personId === truth?.truthPersonId,
      rawTruthRank: truth?.rawRank ?? null,
      rawWinnerPersonId: raw?.personId || null,
      robustCorrect: robust?.personId === truth?.truthPersonId,
      robustTruthRank: truth?.robustRank ?? null,
      robustWinnerPersonId: robust?.personId || null,
      secondaryRouted:
        ambiguous && routableGroup.some((row) => row.secondaryScore != null),
      lowQualityRouted: routableGroup.some(
        (row) => row.queryLowQuality && row.lowQualityScore != null,
      ),
      sourceTierHint: group[0]?.sourceTierHint || "unknown",
      modifierRouted: routableGroup.some((row) => row.modifierScore != null),
      truthPersonId: truth?.truthPersonId || group[0]?.truthPersonId,
      truthRawScore: truth?.rawPrimeScore ?? null,
      truthRobustScore: truth?.robustPrimeScore ?? null,
      winnerRawScore: raw?.rawPrimeScore ?? null,
      winnerRobustScore: robust?.robustPrimeScore ?? null,
    };
  });
};

export const summarizeSecondaryTransitions = (outcomes) => {
  const summary = {
    baselineCorrect: 0,
    changedWinners: 0,
    conditionedCorrect: 0,
    falseFlips: 0,
    ordinaryBaselineCorrect: 0,
    ordinaryConditionedCorrect: 0,
    ordinaryQueries: 0,
    queries: outcomes.length,
    rescues: 0,
    secondaryRouted: 0,
  };
  for (const outcome of outcomes) {
    if (outcome.robustCorrect) summary.baselineCorrect += 1;
    if (outcome.layeredCorrect) summary.conditionedCorrect += 1;
    if (!outcome.robustCorrect && outcome.layeredCorrect) summary.rescues += 1;
    if (outcome.robustCorrect && !outcome.layeredCorrect)
      summary.falseFlips += 1;
    if (outcome.robustWinnerPersonId !== outcome.layeredWinnerPersonId) {
      summary.changedWinners += 1;
    }
    if (outcome.secondaryRouted) summary.secondaryRouted += 1;
    if (outcome.sourceTierHint === "prime") {
      summary.ordinaryQueries += 1;
      if (outcome.robustCorrect) summary.ordinaryBaselineCorrect += 1;
      if (outcome.layeredCorrect) summary.ordinaryConditionedCorrect += 1;
    }
  }
  return summary;
};
