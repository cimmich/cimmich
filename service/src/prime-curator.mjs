const clamp = (value, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));
const requiredPrime = (face) => face.pinnedPrime || face.preservedPrime;

export const primeCuratorPolicyVersion =
  "cimmich-prime-biometric-v7-usable-lq-anchor";

const sourceTierPrior = (face) => {
  if (face.sourceTierHint === "prime") return 1;
  if (face.sourceTierHint === "secondary") return 0.72;
  if (face.sourceTierHint === "body_presence") return 0;
  return 0.5;
};

const dot = (left, right) => {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }
  return total;
};

const normalize = (vector) => {
  const norm = Math.sqrt(dot(vector, vector));
  if (!Number.isFinite(norm) || norm <= 0) {
    throw new Error("Prime curator received an invalid embedding");
  }
  return Float32Array.from(vector, (value) => value / norm);
};

const weightedCenter = (rows) => {
  const dimension = rows[0]?.vector.length || 0;
  const center = new Float64Array(dimension);
  let totalWeight = 0;
  for (const row of rows) {
    const weight = row.weight ?? 1;
    totalWeight += weight;
    for (let index = 0; index < dimension; index += 1) {
      center[index] += row.vector[index] * weight;
    }
  }
  if (totalWeight <= 0) {
    throw new Error("Prime curator cannot build an empty prototype");
  }
  return normalize(center);
};

const quantile = (values, fraction) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(fraction) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const sampleEvenly = (rows, limit) => {
  if (rows.length <= limit) {
    return rows;
  }
  const sampled = [];
  for (let index = 0; index < limit; index += 1) {
    sampled.push(rows[Math.round((index * (rows.length - 1)) / (limit - 1))]);
  }
  return sampled;
};

const uniqueByAsset = (faces) => {
  const byAsset = new Map();
  for (const face of faces) {
    const current = byAsset.get(face.assetId);
    const score = face.quality * 0.7 + face.detection * 0.3;
    const currentScore = current
      ? current.quality * 0.7 + current.detection * 0.3
      : -1;
    if (
      !current ||
      (requiredPrime(face) && !requiredPrime(current)) ||
      (requiredPrime(face) === requiredPrime(current) &&
        score > currentScore) ||
      (requiredPrime(face) === requiredPrime(current) &&
        score === currentScore &&
        face.faceId < current.faceId)
    ) {
      byAsset.set(face.assetId, face);
    }
  }
  return [...byAsset.values()];
};

const sharesCaptureContext = (left, right) => {
  const leftIds = new Set(
    (left.captureContexts || []).map((context) => context.contextId),
  );
  return (right.captureContexts || []).some((context) =>
    leftIds.has(context.contextId),
  );
};

const coverageScore = (scores) => {
  const mean =
    scores.reduce((total, value) => total + value, 0) /
    Math.max(1, scores.length);
  const p10 = quantile(scores, 0.1);
  return { mean, objective: p10 * 0.65 + mean * 0.35, p10 };
};

export const parseVector = (value) => {
  if (Array.isArray(value)) {
    return normalize(value.map(Number));
  }
  const text = String(value || "").trim();
  if (!text.startsWith("[") || !text.endsWith("]")) {
    throw new Error("Prime curator could not parse an embedding");
  }
  return normalize(text.slice(1, -1).split(",").map(Number));
};

export const vectorText = (vector) =>
  `[${[...vector].map((value) => Number(value).toFixed(9)).join(",")}]`;

export const curatePrimeSet = (
  sourceFaces,
  {
    candidatePoolLimit = 128,
    centralitySlack = 0.08,
    maxPrime = 12,
    minCoverageGain = 0.002,
    minDetection = 0.5,
    minPrime = 1,
    minQuality = 0.68,
    nearDuplicateCosine = 0.995,
    validationLimit = 256,
  } = {},
) => {
  const normalizedFaces = uniqueByAsset(
    sourceFaces.map((face) => ({
      ...face,
      detection: clamp(Number(face.detection) || 0),
      quality: clamp(Number(face.quality) || 0),
      vector: normalize(face.vector),
    })),
  );
  if (normalizedFaces.length === 0) {
    return {
      prototype: null,
      selected: [],
      metrics: { eligibleCount: 0, sourceCount: 0 },
    };
  }

  const allowed = normalizedFaces.filter(
    (face) =>
      requiredPrime(face) ||
      (!face.blockedPrime &&
        face.primeEligible !== false &&
        face.galleryPermission !== "never" &&
        face.quality >= minQuality &&
        face.detection >= minDetection),
  );
  const fallback = normalizedFaces
    .filter(
      (face) =>
        !face.blockedPrime &&
        face.primeEligible !== false &&
        face.galleryPermission !== "never",
    )
    .sort(
      (left, right) =>
        sourceTierPrior(right) - sourceTierPrior(left) ||
        right.quality - left.quality ||
        right.detection - left.detection ||
        left.faceId.localeCompare(right.faceId),
    );
  const eligibleSeed =
    allowed.length >= Math.min(minPrime, fallback.length)
      ? allowed
      : fallback.slice(0, Math.max(minPrime, allowed.length));
  if (eligibleSeed.length === 0) {
    return {
      prototype: null,
      selected: [],
      metrics: { eligibleCount: 0, sourceCount: normalizedFaces.length },
    };
  }

  let robustCenter = weightedCenter(
    eligibleSeed.map((face) => ({
      vector: face.vector,
      weight: 0.45 + face.quality * 0.45 + sourceTierPrior(face) * 0.1,
    })),
  );
  let core = eligibleSeed;
  let centralityFloor = -1;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const similarities = eligibleSeed.map((face) =>
      dot(face.vector, robustCenter),
    );
    const median = quantile(similarities, 0.5);
    const mad = quantile(
      similarities.map((value) => Math.abs(value - median)),
      0.5,
    );
    centralityFloor = median - Math.max(centralitySlack, mad * 3);
    core = eligibleSeed.filter(
      (face) =>
        dot(face.vector, robustCenter) >= centralityFloor ||
        requiredPrime(face),
    );
    if (core.length < Math.min(minPrime, eligibleSeed.length)) {
      core = [...eligibleSeed]
        .sort(
          (left, right) =>
            dot(right.vector, robustCenter) - dot(left.vector, robustCenter),
        )
        .slice(0, Math.min(minPrime, eligibleSeed.length));
    }
    robustCenter = weightedCenter(
      core.map((face) => ({
        vector: face.vector,
        weight: 0.45 + face.quality * 0.45 + sourceTierPrior(face) * 0.1,
      })),
    );
  }

  const scored = core
    .map((face) => {
      const centrality = dot(face.vector, robustCenter);
      return {
        ...face,
        centrality,
        cleanScore:
          centrality * 0.62 +
          face.quality * 0.18 +
          face.detection * 0.14 +
          sourceTierPrior(face) * 0.06,
      };
    })
    .sort(
      (left, right) =>
        right.cleanScore - left.cleanScore ||
        left.faceId.localeCompare(right.faceId),
    );

  const highPurity = scored.slice(0, Math.min(80, scored.length));
  const byCentrality = [...scored].sort(
    (left, right) =>
      right.centrality - left.centrality ||
      right.cleanScore - left.cleanScore ||
      left.faceId.localeCompare(right.faceId),
  );
  const poolMap = new Map(
    [
      ...highPurity,
      ...sampleEvenly(byCentrality, Math.min(64, byCentrality.length)),
    ].map((face) => [face.faceId, face]),
  );
  for (const face of scored.filter(requiredPrime)) {
    poolMap.set(face.faceId, face);
  }
  const candidates = [...poolMap.values()]
    .sort(
      (left, right) =>
        Number(requiredPrime(right)) - Number(requiredPrime(left)) ||
        right.cleanScore - left.cleanScore ||
        left.faceId.localeCompare(right.faceId),
    )
    .slice(
      0,
      Math.max(candidatePoolLimit, scored.filter(requiredPrime).length),
    );
  const validation = sampleEvenly(
    [...scored].sort(
      (left, right) =>
        left.centrality - right.centrality ||
        left.faceId.localeCompare(right.faceId),
    ),
    validationLimit,
  );
  const candidateCoverage = new Map(
    candidates.map((candidate) => [
      candidate.faceId,
      Float32Array.from(validation, (face) =>
        dot(candidate.vector, face.vector),
      ),
    ]),
  );

  const selected = [];
  const selectedIds = new Set();
  let bestCoverage = new Float32Array(validation.length).fill(-1);
  let currentCoverage = coverageScore(bestCoverage);
  const addCandidate = (candidate, reason, gain = 0) => {
    selected.push({ ...candidate, reason, coverageGain: gain });
    selectedIds.add(candidate.faceId);
    const scores =
      candidateCoverage.get(candidate.faceId) ||
      Float32Array.from(validation, (face) =>
        dot(candidate.vector, face.vector),
      );
    bestCoverage = Float32Array.from(bestCoverage, (value, index) =>
      Math.max(value, scores[index]),
    );
    currentCoverage = coverageScore(bestCoverage);
  };

  for (const candidate of candidates.filter(requiredPrime)) {
    addCandidate(
      candidate,
      candidate.pinnedPrime ? "user_pin" : "reviewed_prime_preserved",
    );
  }

  while (selected.length < Math.max(maxPrime, selected.length)) {
    let best = null;
    for (const candidate of candidates) {
      if (selectedIds.has(candidate.faceId)) {
        continue;
      }
      if (
        selected.some(
          (row) => dot(row.vector, candidate.vector) >= nearDuplicateCosine,
        )
      ) {
        continue;
      }
      const scores = candidateCoverage.get(candidate.faceId);
      const independentIndexes = validation
        .map((face, index) => ({ face, index }))
        .filter(
          ({ face }) =>
            face.faceId !== candidate.faceId &&
            face.assetId !== candidate.assetId &&
            !sharesCaptureContext(face, candidate),
        )
        .map(({ index }) => index);
      const gain =
        selected.length < Math.min(minPrime, candidates.length)
          ? Number.POSITIVE_INFINITY
          : independentIndexes.length === 0
            ? 0
            : coverageScore(
                independentIndexes.map((index) =>
                  Math.max(bestCoverage[index], scores[index]),
                ),
              ).objective -
              coverageScore(
                independentIndexes.map((index) => bestCoverage[index]),
              ).objective;
      if (
        !best ||
        gain > best.gain + 1e-12 ||
        (Math.abs(gain - best.gain) <= 1e-12 &&
          candidate.cleanScore > best.candidate.cleanScore) ||
        (Math.abs(gain - best.gain) <= 1e-12 &&
          candidate.cleanScore === best.candidate.cleanScore &&
          candidate.faceId < best.candidate.faceId)
      ) {
        best = { candidate, gain };
      }
    }
    if (!best) {
      break;
    }
    if (
      selected.length >= Math.min(minPrime, candidates.length) &&
      best.gain < minCoverageGain
    ) {
      break;
    }
    addCandidate(
      best.candidate,
      selected.length < minPrime
        ? "minimum_clean_gallery"
        : "independent_matching_coverage_gain",
      Number.isFinite(best.gain) ? best.gain : 0,
    );
  }

  const prototype = weightedCenter(
    selected.map((face) => ({
      vector: face.vector,
      weight: 0.5 + clamp(face.cleanScore) * 0.5,
    })),
  );
  const prototypeSimilarities = validation.map((face) =>
    dot(face.vector, prototype),
  );
  return {
    prototype,
    selected,
    metrics: {
      candidateCount: candidates.length,
      centralityFloor,
      coverageMean: currentCoverage.mean,
      coverageP10: currentCoverage.p10,
      eligibleCount: scored.length,
      prototypeMean:
        prototypeSimilarities.reduce((total, value) => total + value, 0) /
        prototypeSimilarities.length,
      prototypeP10: quantile(prototypeSimilarities, 0.1),
      selectedCount: selected.length,
      sourceCount: normalizedFaces.length,
      validationCount: validation.length,
    },
  };
};
