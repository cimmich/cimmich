#!/usr/bin/env node
import postgres from "postgres";
import { loadSourcePackFaces } from "../src/source-pack-repository.mjs";
import {
  buildPhotoIsolatedPacks,
  chooseGuardedSecondaryPolicy,
  photoIsolatedOutcomes,
  summarizeSecondaryTransitions,
} from "../src/source-pack-photo-holdout.mjs";
import { scorePhotoIsolatedPack } from "../src/source-pack-photo-holdout-repository.mjs";
import { digestValue } from "../src/source-pack.mjs";

const args = process.argv.slice(2);
const value = (name, fallback = "") =>
  args
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) || fallback;
const cutoff = value("cutoff");
if (!cutoff) {
  throw new Error(
    "Usage: diagnose-photo-isolated.mjs --cutoff=<ISO timestamp> [--seeds=v1,v2,v3]",
  );
}

const seeds = value(
  "seeds",
  "cimmich-context-isolated-v2-a,cimmich-context-isolated-v2-b,cimmich-context-isolated-v2-c",
)
  .split(",")
  .map((seed) => seed.trim())
  .filter(Boolean);
const options = {
  configDigest: value("config-digest"),
  cutoff,
  modelFamily: value("model-family"),
  modelVersion: value("model-version", "cimmich-source-anchor-v1"),
  primeOptions: {
    maxPrime: Number(value("max-prime", "12")),
    minPrime: Number(value("min-prime", "1")),
    minCoverageGain: Number(value("min-coverage-gain", "0.002")),
  },
  secondaryLimit: Number(value("secondary-limit", "24")),
};

const increment = (object, key, amount = 1) => {
  object[key] = (object[key] || 0) + amount;
};

const sql = postgres(
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  { max: 1, prepare: true },
);
try {
  const faces = await loadSourcePackFaces(sql, options);
  const allOutcomes = [];
  const folds = [];
  for (const seed of seeds) {
    const cohort = buildPhotoIsolatedPacks(faces, { ...options, seed });
    const calibrationRows = await scorePhotoIsolatedPack(
      sql,
      cohort.calibration.pack.packId,
      cohort.calibration.queries,
    );
    if (calibrationRows.length === 0) {
      throw new Error(
        `Calibration pack is not persisted: ${cohort.calibration.pack.packId}`,
      );
    }
    const policy = chooseGuardedSecondaryPolicy(calibrationRows);
    const holdoutRows = await scorePhotoIsolatedPack(
      sql,
      cohort.holdout.pack.packId,
      cohort.holdout.queries,
    );
    const outcomes = photoIsolatedOutcomes(holdoutRows, policy).map(
      (outcome) => ({ ...outcome, seed }),
    );
    allOutcomes.push(...outcomes);
    folds.push({
      holdoutPackId: cohort.holdout.pack.packId,
      queries: outcomes.length,
      secondaryThreshold: policy.threshold,
      secondaryWeight: policy.weight,
      seed,
    });
  }

  const transitions = {
    robustFalseFlipsFromRaw: 0,
    robustRescuesFromRaw: 0,
    secondaryFalseFlipsFromRobust: 0,
    secondaryRescuesFromRobust: 0,
  };
  const byTier = {};
  const people = new Map();
  for (const outcome of allOutcomes) {
    if (outcome.rawCorrect && !outcome.robustCorrect)
      transitions.robustFalseFlipsFromRaw += 1;
    if (!outcome.rawCorrect && outcome.robustCorrect)
      transitions.robustRescuesFromRaw += 1;
    if (outcome.robustCorrect && !outcome.layeredCorrect)
      transitions.secondaryFalseFlipsFromRobust += 1;
    if (!outcome.robustCorrect && outcome.layeredCorrect)
      transitions.secondaryRescuesFromRobust += 1;
    const tier = byTier[outcome.sourceTierHint] || {
      layeredMisses: 0,
      queries: 0,
      rawMisses: 0,
      robustMisses: 0,
    };
    tier.queries += 1;
    if (!outcome.rawCorrect) tier.rawMisses += 1;
    if (!outcome.robustCorrect) tier.robustMisses += 1;
    if (!outcome.layeredCorrect) tier.layeredMisses += 1;
    byTier[outcome.sourceTierHint] = tier;

    const person = people.get(outcome.truthPersonId) || {
      folds: 0,
      layeredMisses: 0,
      rawGaps: [],
      rawMisses: 0,
      robustMisses: 0,
      missedQueryAssetIds: [],
      missedQueryFaceIds: [],
      wrongWinners: [],
    };
    person.folds += 1;
    if (!outcome.rawCorrect) {
      person.rawMisses += 1;
      person.rawGaps.push(
        (outcome.winnerRawScore ?? 0) - (outcome.truthRawScore ?? 0),
      );
      person.wrongWinners.push(outcome.rawWinnerPersonId);
      person.missedQueryFaceIds.push(outcome.queryFaceId);
      if (outcome.queryAssetId)
        person.missedQueryAssetIds.push(outcome.queryAssetId);
    }
    if (!outcome.robustCorrect) person.robustMisses += 1;
    if (!outcome.layeredCorrect) person.layeredMisses += 1;
    people.set(outcome.truthPersonId, person);
  }

  const recurrence = {};
  for (const person of people.values())
    increment(recurrence, String(person.rawMisses));
  const persistent = [...people.entries()]
    .filter(([, person]) => person.rawMisses >= 2)
    .map(([personId, person]) => {
      const wrongWinnerCounts = {};
      for (const winnerPersonId of person.wrongWinners)
        increment(wrongWinnerCounts, winnerPersonId || "none");
      const mostRepeatedWrongWinner = Math.max(
        0,
        ...Object.values(wrongWinnerCounts),
      );
      return {
        folds: person.folds,
        layeredMisses: person.layeredMisses,
        meanRawGap:
          person.rawGaps.reduce((total, gap) => total + gap, 0) /
          Math.max(1, person.rawGaps.length),
        personKey: digestValue(personId).slice(0, 12),
        rawMisses: person.rawMisses,
        uniqueMissedAssets: new Set(person.missedQueryAssetIds).size,
        uniqueMissedFaces: new Set(person.missedQueryFaceIds).size,
        repeatedWrongWinner: mostRepeatedWrongWinner,
        robustMisses: person.robustMisses,
      };
    })
    .sort(
      (left, right) =>
        right.rawMisses - left.rawMisses ||
        right.meanRawGap - left.meanRawGap ||
        left.personKey.localeCompare(right.personKey),
    );

  process.stdout.write(
    `${JSON.stringify({
      byTier,
      folds,
      persistentPeople: persistent,
      recurrence,
      totals: {
        layeredMisses: allOutcomes.filter((outcome) => !outcome.layeredCorrect)
          .length,
        people: people.size,
        queries: allOutcomes.length,
        rawMisses: allOutcomes.filter((outcome) => !outcome.rawCorrect).length,
        robustMisses: allOutcomes.filter((outcome) => !outcome.robustCorrect)
          .length,
        uniqueRawMissAssets: new Set(
          allOutcomes
            .filter((outcome) => !outcome.rawCorrect)
            .map((outcome) => outcome.queryAssetId)
            .filter(Boolean),
        ).size,
        uniqueRawMissFaces: new Set(
          allOutcomes
            .filter((outcome) => !outcome.rawCorrect)
            .map((outcome) => outcome.queryFaceId),
        ).size,
      },
      secondaryGateMetrics: summarizeSecondaryTransitions(allOutcomes),
      transitions,
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
