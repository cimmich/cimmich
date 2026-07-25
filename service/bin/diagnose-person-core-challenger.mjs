#!/usr/bin/env node
import postgres from "postgres";
import {
  evaluatePersonCoreChallengerHoldout,
  selectPersonCoreChallenger,
} from "../src/person-core-challenger.mjs";
import {
  buildPhotoIsolatedPacks,
  chooseGuardedSecondaryPolicy,
  photoIsolatedOutcomes,
} from "../src/source-pack-photo-holdout.mjs";
import { scorePhotoIsolatedPack } from "../src/source-pack-photo-holdout-repository.mjs";
import {
  loadSourcePackFaces,
  persistSourcePack,
} from "../src/source-pack-repository.mjs";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const value = (name, fallback = "") =>
  args
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) || fallback;
const list = (name) =>
  value(name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const targetPersonId = value("person-id");
const cutoff = value("cutoff");
const cutoffDate = new Date(cutoff);
const baselineCoreFaceIds = list("baseline-core");
const candidateCoreFaceIds = list("candidate-core");
if (
  !targetPersonId ||
  !cutoff ||
  baselineCoreFaceIds.length === 0 ||
  candidateCoreFaceIds.length === 0
) {
  throw new Error(
    "Usage: diagnose-person-core-challenger.mjs --person-id=<id> --cutoff=<ISO> --baseline-core=<face,...> --candidate-core=<face,...> --model-family=<family> --model-version=<version> --config-digest=<digest> [--execute]",
  );
}
if (
  !Number.isFinite(cutoffDate.getTime()) ||
  cutoffDate.getTime() > Date.now()
) {
  throw new Error(
    "Person Core challenger cutoff must be a valid date that is not in the future",
  );
}

const options = {
  configDigest: value("config-digest"),
  cutoff: cutoffDate.toISOString(),
  excludedQueryFaceIds: [
    ...new Set([...baselineCoreFaceIds, ...candidateCoreFaceIds]),
  ],
  modelFamily: value("model-family"),
  modelVersion: value("model-version"),
  primeOptions: {
    maxPrime: Number(value("max-prime", "12")),
    minPrime: Number(value("min-prime", "1")),
    minCoverageGain: Number(value("min-coverage-gain", "0.002")),
  },
  primeModeOptions: {
    maxModes: Number(value("max-prime-modes", "0")),
  },
  secondaryLimit: Number(value("secondary-limit", "24")),
  seed: value("seed", "cimmich-person-core-challenger-v1"),
};

const sql = postgres(
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  { max: 1, prepare: true },
);
try {
  const faces = await loadSourcePackFaces(sql, options);
  const build = (faceIds) =>
    buildPhotoIsolatedPacks(faces, {
      ...options,
      diagnosticPrimeFaceIdsByPerson: {
        [targetPersonId]: faceIds,
      },
    });
  const baseline = build(baselineCoreFaceIds);
  const candidate = build(candidateCoreFaceIds);
  if (baseline.cohortDigest !== candidate.cohortDigest) {
    throw new Error("Person Core challenger produced different cohorts");
  }
  const persist = async (cohort) => ({
    calibration: await persistSourcePack(sql, cohort.calibration.pack, {
      execute,
    }),
    holdout: await persistSourcePack(sql, cohort.holdout.pack, { execute }),
  });
  const persisted = {
    baseline: await persist(baseline),
    candidate: await persist(candidate),
  };
  if (!execute) {
    process.stdout.write(
      `${JSON.stringify(
        {
          activationAuthority: "none",
          cohortDigest: baseline.cohortDigest,
          persisted,
          status: "compiled-not-scored",
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const baselineCalibrationRows = await scorePhotoIsolatedPack(
      sql,
      baseline.calibration.pack.packId,
      baseline.calibration.queries,
    );
    const policy = chooseGuardedSecondaryPolicy(baselineCalibrationRows);
    const candidateCalibrationRows = await scorePhotoIsolatedPack(
      sql,
      candidate.calibration.pack.packId,
      candidate.calibration.queries,
    );
    const selection = selectPersonCoreChallenger({
      baselineCoreFaceIds,
      baselinePackId: baseline.calibration.pack.packId,
      baselineRows: photoIsolatedOutcomes(baselineCalibrationRows, policy),
      candidateCoreFaceIds,
      candidatePackId: candidate.calibration.pack.packId,
      candidateRows: photoIsolatedOutcomes(candidateCalibrationRows, policy),
      cohortDigest: baseline.cohortDigest,
      targetPersonId,
    });
    let holdout = null;
    if (selection.selection === "selected_for_holdout") {
      const [baselineHoldoutRows, candidateHoldoutRows] = await Promise.all([
        scorePhotoIsolatedPack(
          sql,
          baseline.holdout.pack.packId,
          baseline.holdout.queries,
        ),
        scorePhotoIsolatedPack(
          sql,
          candidate.holdout.pack.packId,
          candidate.holdout.queries,
        ),
      ]);
      holdout = evaluatePersonCoreChallengerHoldout(selection, {
        baselineRows: photoIsolatedOutcomes(baselineHoldoutRows, policy),
        candidateRows: photoIsolatedOutcomes(candidateHoldoutRows, policy),
      });
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          activationAuthority: "none",
          cohort: {
            cohortDigest: baseline.cohortDigest,
            stats: baseline.stats,
          },
          holdout,
          persisted,
          policy,
          selection,
          status:
            holdout?.status ||
            (selection.selection === "selected_for_holdout"
              ? "holdout-pending"
              : "rejected-at-calibration"),
        },
        null,
        2,
      )}\n`,
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
