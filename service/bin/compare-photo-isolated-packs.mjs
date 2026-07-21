#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import postgres from "postgres";
import { loadSourcePackFaces } from "../src/source-pack-repository.mjs";
import {
  buildPhotoIsolatedPacks,
  chooseGuardedSecondaryPolicy,
  photoIsolatedOutcomes,
  summarizePhotoIsolatedScores,
} from "../src/source-pack-photo-holdout.mjs";
import { scorePhotoIsolatedPack } from "../src/source-pack-photo-holdout-repository.mjs";

const args = process.argv.slice(2);
const value = (name, fallback = "") =>
  args
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) || fallback;

const cutoff = value("cutoff");
const seed = value("seed", "cimmich-context-isolated-v2");
const packs = {
  left: {
    calibration: value("left-calibration-pack"),
    holdout: value("left-holdout-pack"),
  },
  right: {
    calibration: value("right-calibration-pack"),
    holdout: value("right-holdout-pack"),
  },
};
if (
  !cutoff ||
  Object.values(packs).some((pair) => !pair.calibration || !pair.holdout)
) {
  throw new Error(
    "Usage: compare-photo-isolated-packs.mjs --cutoff=<ISO timestamp> --left-calibration-pack=<id> --left-holdout-pack=<id> --right-calibration-pack=<id> --right-holdout-pack=<id> [--seed=<seed>]",
  );
}

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
  seed,
};

const compareOutcomes = (left, right) => {
  const rightByFace = new Map(
    right.map((outcome) => [outcome.queryFaceId, outcome]),
  );
  const lanes = {
    layered: ["layeredCorrect", "layeredWinnerPersonId"],
    raw: ["rawCorrect", "rawWinnerPersonId"],
    robust: ["robustCorrect", "robustWinnerPersonId"],
  };
  return Object.fromEntries(
    Object.entries(lanes).map(([lane, [correctKey, winnerKey]]) => {
      const result = {
        bothCorrect: 0,
        bothMiss: 0,
        leftOnlyCorrect: 0,
        rightOnlyCorrect: 0,
        winnerChanged: 0,
      };
      for (const leftOutcome of left) {
        const rightOutcome = rightByFace.get(leftOutcome.queryFaceId);
        if (!rightOutcome) continue;
        if (leftOutcome[correctKey] && rightOutcome[correctKey])
          result.bothCorrect += 1;
        else if (leftOutcome[correctKey]) result.leftOnlyCorrect += 1;
        else if (rightOutcome[correctKey]) result.rightOnlyCorrect += 1;
        else result.bothMiss += 1;
        if (leftOutcome[winnerKey] !== rightOutcome[winnerKey])
          result.winnerChanged += 1;
      }
      return [lane, result];
    }),
  );
};

const transitionDetails = (left, right) => {
  const rightByFace = new Map(
    right.map((outcome) => [outcome.queryFaceId, outcome]),
  );
  return left
    .map((leftOutcome) => ({
      left: leftOutcome,
      right: rightByFace.get(leftOutcome.queryFaceId),
    }))
    .filter(({ right }) => right)
    .filter(
      ({ left: leftOutcome, right: rightOutcome }) =>
        leftOutcome.layeredCorrect !== rightOutcome.layeredCorrect,
    )
    .map(({ left: leftOutcome, right: rightOutcome }) => ({
      direction: leftOutcome.layeredCorrect
        ? "left-only-correct"
        : "right-only-correct",
      leftWinnerPersonId: leftOutcome.layeredWinnerPersonId,
      queryAssetId: leftOutcome.queryAssetId,
      queryFaceId: leftOutcome.queryFaceId,
      rightWinnerPersonId: rightOutcome.layeredWinnerPersonId,
      sourceTierHint: leftOutcome.sourceTierHint,
      truthPersonId: leftOutcome.truthPersonId,
    }));
};

const referenceCountsByPerson = async (sql, packIds) => {
  const rows = await sql`
    SELECT pack_id, person_id, bucket_kind, reference_kind, count(*)::int AS references
    FROM source_pack_reference
    WHERE pack_id = ANY(${packIds})
    GROUP BY pack_id, person_id, bucket_kind, reference_kind
  `;
  const counts = new Map();
  for (const row of rows) {
    const key = `${row.pack_id}\u001f${row.person_id}`;
    const current = counts.get(key) || {};
    current[`${row.bucket_kind}:${row.reference_kind}`] = row.references;
    counts.set(key, current);
  }
  return counts;
};

const contextSupportByQuery = async (sql, packId, details, cohortQueries) => {
  if (details.length === 0) return new Map();
  const heldOutAssetIds = [
    ...new Set(cohortQueries.map((query) => query.assetId)),
  ];
  const heldOutContextIds = [
    ...new Set(cohortQueries.flatMap((query) => query.captureContextIds || [])),
  ];
  const requested = details.map((detail) => ({
    queryFaceId: detail.queryFaceId,
    truthPersonId: detail.truthPersonId,
  }));
  const rows = await sql`
    WITH requested AS (
      SELECT item->>'queryFaceId' AS query_face_id,
        item->>'truthPersonId' AS truth_person_id
      FROM jsonb_array_elements(${sql.json(requested)}::jsonb) item
    ), member_faces AS (
      SELECT requested.query_face_id, requested.truth_person_id,
        coalesce(reference.face_id, member_face_id) AS member_face_id
      FROM requested
      JOIN source_pack_reference reference
        ON reference.pack_id = ${packId}
        AND reference.person_id = requested.truth_person_id
        AND reference.bucket_kind = 'prime'
      LEFT JOIN LATERAL unnest(reference.member_face_ids) member_face_id
        ON reference.reference_kind = 'prototype'
      WHERE reference.reference_kind = 'face' OR member_face_id IS NOT NULL
    ), classified AS (
      SELECT member_faces.*, member_observation.asset_id,
        member_observation.asset_id = ANY(${heldOutAssetIds}) AS held_out_query_asset,
        EXISTS (
          SELECT 1 FROM current_face_capture_context held_context
          WHERE held_context.face_id = member_faces.member_face_id
            AND held_context.context_id = ANY(${heldOutContextIds})
        ) AS held_out_context,
        EXISTS (
          SELECT 1
          FROM current_face_capture_context query_context
          JOIN current_face_capture_context member_context
            ON member_context.context_id = query_context.context_id
          WHERE query_context.face_id = member_faces.query_face_id
            AND member_context.face_id = member_faces.member_face_id
        ) AS shares_context
      FROM member_faces
      JOIN face_observation member_observation
        ON member_observation.face_id = member_faces.member_face_id
    )
    SELECT query_face_id,
      count(DISTINCT member_face_id)::int AS truth_prime_members,
      count(DISTINCT member_face_id) FILTER (WHERE shares_context)::int AS shared_context_members,
      count(DISTINCT member_face_id) FILTER (WHERE NOT shares_context)::int AS independent_members,
      count(DISTINCT member_face_id) FILTER (WHERE held_out_query_asset)::int AS held_out_query_asset_members,
      count(DISTINCT member_face_id) FILTER (WHERE held_out_context)::int AS held_out_context_members,
      count(DISTINCT member_face_id) FILTER (
        WHERE NOT held_out_query_asset AND NOT held_out_context
      )::int AS current_fold_eligible_members
    FROM classified
    GROUP BY query_face_id
  `;
  return new Map(
    rows.map((row) => [
      row.query_face_id,
      {
        independentMembers: row.independent_members,
        sharedContextMembers: row.shared_context_members,
        truthPrimeMembers: row.truth_prime_members,
        heldOutQueryAssetMembers: row.held_out_query_asset_members,
        heldOutContextMembers: row.held_out_context_members,
        currentFoldEligibleMembers: row.current_fold_eligible_members,
      },
    ]),
  );
};

const sql = postgres(
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  { max: 1, prepare: true },
);
try {
  const faces = await loadSourcePackFaces(sql, options);
  const cohort = buildPhotoIsolatedPacks(faces, options);
  const results = {};
  for (const [label, pair] of Object.entries(packs)) {
    const calibrationRows = await scorePhotoIsolatedPack(
      sql,
      pair.calibration,
      cohort.calibration.queries,
    );
    const holdoutRows = await scorePhotoIsolatedPack(
      sql,
      pair.holdout,
      cohort.holdout.queries,
    );
    if (calibrationRows.length === 0 || holdoutRows.length === 0) {
      throw new Error(
        `${label} SourcePack is absent or incompatible with the current embedding configuration`,
      );
    }
    const policy = chooseGuardedSecondaryPolicy(calibrationRows);
    results[label] = {
      calibration: summarizePhotoIsolatedScores(calibrationRows, policy),
      holdout: summarizePhotoIsolatedScores(holdoutRows, policy),
      holdoutOutcomes: photoIsolatedOutcomes(holdoutRows, policy),
      packs: pair,
      policy,
    };
  }

  const details = transitionDetails(
    results.left.holdoutOutcomes,
    results.right.holdoutOutcomes,
  );
  const referenceCounts = await referenceCountsByPerson(sql, [
    packs.left.holdout,
    packs.right.holdout,
  ]);
  const leftContextSupport = await contextSupportByQuery(
    sql,
    packs.left.holdout,
    details,
    cohort.holdout.queries,
  );
  const receipt = {
    cohort: {
      cohortDigest: cohort.cohortDigest,
      seed,
      stats: cohort.stats,
    },
    comparison: compareOutcomes(
      results.left.holdoutOutcomes,
      results.right.holdoutOutcomes,
    ),
    transitionDetails: details.map((detail) => ({
      ...detail,
      leftTruthReferences:
        referenceCounts.get(
          `${packs.left.holdout}\u001f${detail.truthPersonId}`,
        ) || {},
      leftTruthContextSupport: leftContextSupport.get(detail.queryFaceId) || {
        independentMembers: 0,
        sharedContextMembers: 0,
        truthPrimeMembers: 0,
        heldOutQueryAssetMembers: 0,
        heldOutContextMembers: 0,
        currentFoldEligibleMembers: 0,
      },
      rightTruthReferences:
        referenceCounts.get(
          `${packs.right.holdout}\u001f${detail.truthPersonId}`,
        ) || {},
    })),
    left: {
      calibration: results.left.calibration,
      holdout: results.left.holdout,
      packs: results.left.packs,
      policy: results.left.policy,
    },
    right: {
      calibration: results.right.calibration,
      holdout: results.right.holdout,
      packs: results.right.packs,
      policy: results.right.policy,
    },
    schema: "cimmich.photo-isolated-pack-comparison.v1",
  };
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const outputPath = value("output");
  if (outputPath) await writeFile(outputPath, serialized);
  process.stdout.write(serialized);
} finally {
  await sql.end({ timeout: 5 });
}
