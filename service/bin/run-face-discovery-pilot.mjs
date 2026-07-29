#!/usr/bin/env node

import postgres from "postgres";
import { createImmichCompanionManager } from "../src/immich-companion-manager.mjs";
import { createLocalFaceDetectionWorker } from "../src/local-face-detection-worker.mjs";
import { loadLocalMediaProviderRuntime } from "../src/local-media-provider-runtime.mjs";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  return value && !value.startsWith("--") ? value : fallback;
};

const boundedInteger = (value, name, minimum, maximum) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
};

const requiredText = (value, name) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

const databaseUrl = requiredText(process.env.DATABASE_URL, "DATABASE_URL");
const sourceId = requiredText(
  process.env.CIMMICH_IMMICH_SOURCE_ID,
  "CIMMICH_IMMICH_SOURCE_ID",
);
const expectedDetectorConfigDigest = requiredText(
  process.env.CIMMICH_EXPECTED_DETECTOR_CONFIG_DIGEST,
  "CIMMICH_EXPECTED_DETECTOR_CONFIG_DIGEST",
);
const expectedRecognitionConfigDigest = requiredText(
  process.env.CIMMICH_EXPECTED_RECOGNITION_CONFIG_DIGEST,
  "CIMMICH_EXPECTED_RECOGNITION_CONFIG_DIGEST",
);
const expectedVectorSpaceId = requiredText(
  process.env.CIMMICH_EXPECTED_VECTOR_SPACE_ID,
  "CIMMICH_EXPECTED_VECTOR_SPACE_ID",
);
const limitJobs = boundedInteger(
  argument("limit-jobs", "250"),
  "limit-jobs",
  1,
  10_000,
);
const workerCount = boundedInteger(argument("workers", "4"), "workers", 1, 8);
const timeoutMs = boundedInteger(
  argument("timeout-ms", "120000"),
  "timeout-ms",
  1_000,
  600_000,
);
const resumeExisting = process.argv.includes("--resume-existing");
const stageOnly = process.argv.includes("--stage-only");
if (resumeExisting && stageOnly) {
  throw new Error("Face discovery cannot stage and resume the same tranche");
}

const sql = postgres(databaseUrl, {
  max: Math.max(4, workerCount + 2),
  prepare: true,
});
const companion = await createImmichCompanionManager({
  apiBaseUrl: process.env.IMMICH_API_URL || "",
  apiKey: process.env.IMMICH_API_KEY || "",
  credentialFile: process.env.CIMMICH_IMMICH_CREDENTIAL_FILE || "",
});
const runtimes = await Promise.all(
  Array.from({ length: stageOnly ? 1 : workerCount }, () =>
    loadLocalMediaProviderRuntime(),
  ),
);

const sum = (rows, key) =>
  rows.reduce((total, row) => total + Number(row[key] || 0), 0);

try {
  for (const runtime of runtimes) {
    if (!runtime.detectionEnabled || !runtime.recognitionEnabled) {
      throw new Error(
        "Face discovery pilot requires detection and recognition",
      );
    }
    if (
      runtime.detectorManifest.detectorConfigDigest !==
        expectedDetectorConfigDigest ||
      runtime.recognitionManifest.recognitionSpaceConfigDigest !==
        expectedRecognitionConfigDigest ||
      runtime.recognitionManifest.vectorSpaceId !== expectedVectorSpaceId
    ) {
      throw new Error("Face discovery pilot provider alignment check failed");
    }
  }

  const runtime = runtimes[0];
  const [existingWork] = await sql`
    SELECT count(*)::integer AS count
    FROM media_job
    WHERE operation = 'detect_faces'
      AND config_digest = ${expectedDetectorConfigDigest}
      AND state IN ('pending', 'processing')
  `;
  if (!resumeExisting && Number(existingWork?.count || 0) !== 0) {
    throw new Error(
      "Face discovery pilot found pre-existing nonterminal detector work",
    );
  }
  if (resumeExisting && Number(existingWork?.count || 0) < limitJobs) {
    throw new Error(
      `Face discovery resume found ${Number(existingWork?.count || 0)} of ${limitJobs} requested nonterminal jobs`,
    );
  }

  const selected = resumeExisting
    ? await sql`
      WITH triage_projection AS MATERIALIZED (
        SELECT * FROM media_asset_triage
      )
      SELECT job.asset_id, job.input_revision,
        triage.priority_tier, triage.accepted_person_count,
        triage.accepted_association_count, triage.human_observation_count,
        face_count.count AS existing_face_count,
        body_count.count AS existing_body_count,
        body_count.unlinked_count AS unlinked_body_count,
        head_count.count AS manual_head_count,
        body_count.pose_count AS existing_pose_count
      FROM media_job job
      JOIN triage_projection triage ON triage.asset_id = job.asset_id
      CROSS JOIN LATERAL (
        SELECT count(*)::integer AS count
        FROM face_observation face
        WHERE face.asset_id = job.asset_id
          AND face.state = 'valid'
      ) face_count
      CROSS JOIN LATERAL (
        SELECT count(*)::integer AS count,
          count(*) FILTER (
            WHERE body_tag.body_id IS NULL
          )::integer AS unlinked_count,
          count(*) FILTER (
            WHERE pose.body_id IS NOT NULL
          )::integer AS pose_count
        FROM body_observation body
        LEFT JOIN current_body_tag body_tag
          ON body_tag.body_id = body.body_id
         AND body_tag.state = 'accepted'
        LEFT JOIN body_pose_evidence pose
          ON pose.body_id = body.body_id
         AND pose.state = 'valid'
        WHERE body.asset_id = job.asset_id
          AND body.state = 'valid'
      ) body_count
      CROSS JOIN LATERAL (
        SELECT count(*)::integer AS count
        FROM manual_head_observation head
        WHERE head.asset_id = job.asset_id
          AND head.state = 'valid'
      ) head_count
      WHERE job.operation = 'detect_faces'
        AND job.config_digest = ${expectedDetectorConfigDigest}
        AND job.state IN ('pending', 'processing')
        AND triage.priority_tier = 0
      ORDER BY
        (body_count.count > face_count.count) DESC,
        (
          body_count.unlinked_count > 0 OR head_count.count > 0
        ) DESC,
        triage.accepted_person_count DESC,
        triage.accepted_association_count DESC,
        triage.human_observation_count DESC,
        job.requested_at, job.job_id
      LIMIT ${limitJobs}
    `
    : await sql.begin(async (transaction) => {
        const rows = await transaction`
      WITH unique_projection AS (
        SELECT DISTINCT ON (projection.cimmich_asset_id)
          projection.cimmich_asset_id AS asset_id,
          projection.input_revision
        FROM immich_asset_projection projection
        JOIN asset
          ON asset.asset_id = projection.cimmich_asset_id
         AND asset.state = 'active'
        WHERE projection.source_id = ${sourceId}
          AND projection.state = 'active'
          AND projection.asset_type = 'image'
          AND NOT EXISTS (
            SELECT 1
            FROM face_detection_result detection
            WHERE detection.asset_id = projection.cimmich_asset_id
              AND detection.detector_config_digest =
                ${expectedDetectorConfigDigest}
              AND detection.input_revision = projection.input_revision
          )
          AND NOT EXISTS (
            SELECT 1
            FROM media_job job
            WHERE job.asset_id = projection.cimmich_asset_id
              AND job.operation = 'detect_faces'
              AND job.config_digest = ${expectedDetectorConfigDigest}
              AND job.input_revision = projection.input_revision
          )
        ORDER BY projection.cimmich_asset_id, projection.last_seen_at DESC,
          projection.input_revision, projection.immich_asset_id
      )
      SELECT projection.asset_id, projection.input_revision,
        triage.priority_tier, triage.accepted_person_count,
        triage.accepted_association_count, triage.human_observation_count,
        face_count.count AS existing_face_count,
        body_count.count AS existing_body_count,
        body_count.unlinked_count AS unlinked_body_count,
        head_count.count AS manual_head_count,
        body_count.pose_count AS existing_pose_count
      FROM unique_projection projection
      JOIN media_asset_triage triage
        ON triage.asset_id = projection.asset_id
      CROSS JOIN LATERAL (
        SELECT count(*)::integer AS count
        FROM face_observation face
        WHERE face.asset_id = projection.asset_id
          AND face.state = 'valid'
      ) face_count
      CROSS JOIN LATERAL (
        SELECT count(*)::integer AS count,
          count(*) FILTER (
            WHERE body_tag.body_id IS NULL
          )::integer AS unlinked_count,
          count(*) FILTER (
            WHERE pose.body_id IS NOT NULL
          )::integer AS pose_count
        FROM body_observation body
        LEFT JOIN current_body_tag body_tag
          ON body_tag.body_id = body.body_id
         AND body_tag.state = 'accepted'
        LEFT JOIN body_pose_evidence pose
          ON pose.body_id = body.body_id
         AND pose.state = 'valid'
        WHERE body.asset_id = projection.asset_id
          AND body.state = 'valid'
      ) body_count
      CROSS JOIN LATERAL (
        SELECT count(*)::integer AS count
        FROM manual_head_observation head
        WHERE head.asset_id = projection.asset_id
          AND head.state = 'valid'
      ) head_count
      WHERE triage.priority_tier = 0
      ORDER BY
        (body_count.count > face_count.count) DESC,
        (
          body_count.unlinked_count > 0 OR head_count.count > 0
        ) DESC,
        triage.accepted_person_count DESC,
        triage.accepted_association_count DESC,
        triage.human_observation_count DESC,
        projection.asset_id, projection.input_revision
      LIMIT ${limitJobs}
    `;
        if (rows.length !== limitJobs) {
          throw new Error(
            `Face discovery pilot selected ${rows.length} of ${limitJobs} assets`,
          );
        }
        for (const row of rows) {
          await transaction`
        SELECT * FROM enqueue_media_job(
          ${row.asset_id}, ${runtime.inventoryJob.operation},
          ${runtime.inventoryJob.toolVersion},
          ${runtime.inventoryJob.configDigest}, ${row.input_revision},
          ${runtime.inventoryJob.maxAttempts}
        )
      `;
        }
        return rows;
      });
  if (selected.length !== limitJobs) {
    throw new Error(
      `Face discovery ${resumeExisting ? "resume" : "pilot"} selected ${selected.length} of ${limitJobs} assets`,
    );
  }
  const selectedJobs = await sql`
    SELECT job_id, asset_id, input_revision
    FROM media_job
    WHERE operation = 'detect_faces'
      AND config_digest = ${expectedDetectorConfigDigest}
      AND asset_id = ANY(${selected.map((row) => row.asset_id)})
  `;
  const jobIdByAssetRevision = new Map(
    selectedJobs.map((row) => [
      `${row.asset_id}\u0000${row.input_revision}`,
      row.job_id,
    ]),
  );
  const orderedJobIds = selected.map((row) =>
    jobIdByAssetRevision.get(`${row.asset_id}\u0000${row.input_revision}`),
  );
  if (orderedJobIds.some((jobId) => !jobId)) {
    throw new Error("Face discovery selected work without an exact media job");
  }

  const selection = {
    acceptedAssociations: sum(selected, "accepted_association_count"),
    acceptedPeople: sum(selected, "accepted_person_count"),
    assets: selected.length,
    bodyFaceGapAssets: selected.filter(
      (row) =>
        Number(row.existing_body_count) > Number(row.existing_face_count),
    ).length,
    existingBodies: sum(selected, "existing_body_count"),
    existingFaces: sum(selected, "existing_face_count"),
    existingPoses: sum(selected, "existing_pose_count"),
    manualHeads: sum(selected, "manual_head_count"),
    priorityTierMaximum: Math.max(
      ...selected.map((row) => Number(row.priority_tier)),
    ),
    priorityTierMinimum: Math.min(
      ...selected.map((row) => Number(row.priority_tier)),
    ),
    unlinkedBodies: sum(selected, "unlinked_body_count"),
  };
  process.stderr.write(`${JSON.stringify({ selection })}\n`);

  if (stageOnly) {
    process.stdout.write(
      `${JSON.stringify({
        activationAuthority: "none",
        automaticIdentityWrites: 0,
        detectorConfigDigest: expectedDetectorConfigDigest,
        jobsStaged: orderedJobIds.length,
        recognitionConfigDigest: expectedRecognitionConfigDigest,
        schemaVersion: "cimmich.face-discovery-pilot.v1",
        selection,
        sourceMediaWrite: "none",
        state: "jobs_staged",
        vectorSpaceId: expectedVectorSpaceId,
      })}\n`,
    );
  } else {
    const workers = runtimes.map((workerRuntime, index) =>
      createLocalFaceDetectionWorker({
        companion,
        detector: workerRuntime.detector,
        manifest: workerRuntime.detectorManifest,
        sql,
        workerId: `cimmich-face-discovery-pilot-${process.pid}-${index + 1}`,
      }),
    );
    const summary = {
      attempts: 0,
      completed: 0,
      failed: 0,
      facesDetected: 0,
      imagesWithFaces: 0,
      noFace: 0,
      retryPending: 0,
    };
    let nextJobIndex = 0;
    const runWorker = async (worker) => {
      while (nextJobIndex < orderedJobIds.length) {
        const jobIndex = nextJobIndex;
        nextJobIndex += 1;
        const result = await worker.runNext({
          expectedJobId: orderedJobIds[jobIndex],
          timeoutMs,
        });
        if (result?.state === "idle") {
          throw new Error("Face discovery exact media job was not claimable");
        }
        summary.attempts += 1;
        if (result?.status === "completed") {
          summary.completed += 1;
          const detected =
            Number(result?.observations?.inserted || 0) +
            Number(result?.observations?.reused || 0);
          summary.facesDetected += detected;
          if (result?.outcome === "faces_detected") {
            summary.imagesWithFaces += 1;
          } else if (result?.outcome === "no_face") {
            summary.noFace += 1;
          }
        } else if (result?.state === "failed") {
          summary.failed += 1;
        } else {
          summary.retryPending += 1;
        }
        process.stderr.write(
          `${JSON.stringify({
            progress: summary,
            ...(result?.timings ? { timings: result.timings } : {}),
          })}\n`,
        );
      }
    };
    await Promise.all(workers.map(runWorker));

    process.stdout.write(
      `${JSON.stringify({
        ...summary,
        activationAuthority: "none",
        automaticIdentityWrites: 0,
        detectorConfigDigest: expectedDetectorConfigDigest,
        recognitionConfigDigest: expectedRecognitionConfigDigest,
        schemaVersion: "cimmich.face-discovery-pilot.v1",
        selection,
        sourceMediaWrite: "none",
        state:
          summary.failed > 0 || summary.retryPending > 0
            ? "bounded_run_complete_with_failures"
            : "bounded_run_complete",
        vectorSpaceId: expectedVectorSpaceId,
      })}\n`,
    );
  }
} finally {
  await Promise.allSettled(
    runtimes.map((runtime) => runtime.recognizer?.close?.()),
  );
  await sql.end({ timeout: 5 });
}
