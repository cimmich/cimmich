import { createHash } from "node:crypto";

export const mediaJobContractVersion = "cimmich.media-job.v1";

const operations = new Set([
  "detect_faces",
  "recognize_faces",
  "detect_and_recognize",
  "recognize_manual_face",
  "recognize_existing_faces",
]);
const stages = new Set([
  "queued",
  "inventory_verified",
  "observations_recorded",
  "recognition_recorded",
  "projection_ready",
]);
const digestPattern = /^[0-9a-f]{64}$/;
const errorCodePattern = /^[A-Z][A-Z0-9_]{2,79}$/;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

export const mediaJobDigest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalize(value)),
    )
    .digest("hex");

const requiredText = (value, label, maximum = 200) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Media job requires ${label}`);
  }
  return normalized;
};

const requiredDigest = (value, label) => {
  const digest = requiredText(value, label, 64);
  if (!digestPattern.test(digest)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return digest;
};

const boundedInteger = (value, label, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return number;
};

export const validateMediaJobRequest = (request = {}) => {
  const operation = requiredText(request.operation, "operation");
  if (!operations.has(operation)) {
    throw new Error(`Unsupported media job operation: ${operation}`);
  }
  return {
    assetId: requiredText(request.assetId, "assetId"),
    configDigest: requiredDigest(request.configDigest, "configDigest"),
    inputRevision: requiredDigest(request.inputRevision, "inputRevision"),
    maxAttempts: boundedInteger(request.maxAttempts ?? 3, "maxAttempts", 1, 20),
    operation,
    toolVersion: requiredText(request.toolVersion, "toolVersion"),
  };
};

export const validateMediaJobClaim = (claim = {}) => ({
  batchSize: boundedInteger(claim.batchSize ?? 1, "batchSize", 1, 100),
  leaseSeconds: boundedInteger(
    claim.leaseSeconds ?? 300,
    "leaseSeconds",
    30,
    3600,
  ),
  workerId: requiredText(claim.workerId, "workerId", 120),
});

export const validateMediaJobCheckpoint = (checkpoint = {}) => {
  const stage = requiredText(checkpoint.stage, "checkpoint stage");
  if (!stages.has(stage) || stage === "queued") {
    throw new Error(`Unsupported durable media job checkpoint stage: ${stage}`);
  }
  const payload = canonicalize(checkpoint.payload || {});
  return {
    checkpointDigest: mediaJobDigest({ payload, stage }),
    payload,
    stage,
  };
};

const projectJob = (row) => ({
  assetId: row.asset_id,
  attemptCount: Number(row.attempt_count),
  checkpoint: {
    digest: row.checkpoint_digest || null,
    payload: row.checkpoint_payload || {},
    revision: Number(row.checkpoint_revision),
    stage: row.checkpoint_stage,
  },
  completedAt: row.completed_at || null,
  configDigest: row.config_digest,
  inputRevision: row.input_revision,
  jobId: row.job_id,
  lastErrorCode: row.last_error_code || null,
  lease:
    row.lease_owner && row.lease_expires_at
      ? { expiresAt: row.lease_expires_at, owner: row.lease_owner }
      : null,
  maxAttempts: Number(row.max_attempts),
  operation: row.operation,
  requestedAt: row.requested_at,
  result:
    row.result_receipt_id && row.result_digest
      ? {
          digest: row.result_digest,
          receiptId: row.result_receipt_id,
        }
      : null,
  schemaVersion: mediaJobContractVersion,
  startedAt: row.started_at || null,
  state: row.state,
  toolVersion: row.tool_version,
  workKey: row.work_key,
});

export const createMediaJobLedger = (sql) => ({
  async claim(optionsInput) {
    const options = validateMediaJobClaim(optionsInput);
    const rows = await sql`
      SELECT * FROM claim_media_jobs(
        ${options.workerId}, ${options.leaseSeconds}, ${options.batchSize}
      )
    `;
    return rows.map(projectJob);
  },

  async checkpoint({ jobId, workerId, ...checkpointInput }) {
    const id = requiredText(jobId, "jobId");
    const worker = requiredText(workerId, "workerId", 120);
    const checkpoint = validateMediaJobCheckpoint(checkpointInput);
    const [row] = await sql`
      SELECT * FROM checkpoint_media_job(
        ${id}, ${worker}, ${checkpoint.stage}, ${sql.json(checkpoint.payload)}
      )
    `;
    return projectJob(row);
  },

  async complete({ jobId, resultDigest, resultReceiptId, workerId }) {
    const id = requiredText(jobId, "jobId");
    const worker = requiredText(workerId, "workerId", 120);
    const digest = requiredDigest(resultDigest, "resultDigest");
    const receiptId = requiredText(resultReceiptId, "resultReceiptId");
    const [row] = await sql`
      SELECT * FROM complete_media_job(
        ${id}, ${worker}, ${receiptId}, ${digest}
      )
    `;
    return projectJob(row);
  },

  async enqueue(requestInput) {
    const request = validateMediaJobRequest(requestInput);
    const [row] = await sql`
      SELECT * FROM enqueue_media_job(
        ${request.assetId}, ${request.operation}, ${request.toolVersion},
        ${request.configDigest}, ${request.inputRevision}, ${request.maxAttempts}
      )
    `;
    return projectJob(row);
  },

  async fail({ errorCode, jobId, workerId }) {
    const code = requiredText(errorCode, "errorCode", 80);
    if (!errorCodePattern.test(code)) {
      throw new Error("Media job errorCode must be stable and public-safe");
    }
    const [row] = await sql`
      SELECT * FROM fail_media_job(
        ${requiredText(jobId, "jobId")},
        ${requiredText(workerId, "workerId", 120)},
        ${code}
      )
    `;
    return projectJob(row);
  },

  async get({ jobId }) {
    const [row] = await sql`
      SELECT * FROM media_job WHERE job_id = ${requiredText(jobId, "jobId")}
    `;
    if (!row) return null;
    const events = await sql`
      SELECT event_kind, attempt_count, checkpoint_revision, public_details,
        created_at
      FROM media_job_event
      WHERE job_id = ${row.job_id}
      ORDER BY created_at, event_id
    `;
    return {
      ...projectJob(row),
      events: events.map((event) => ({
        attemptCount: Number(event.attempt_count),
        checkpointRevision: Number(event.checkpoint_revision),
        createdAt: event.created_at,
        details: event.public_details || {},
        kind: event.event_kind,
      })),
    };
  },

  async status() {
    const [summary] = await sql`SELECT * FROM media_job_status`;
    const recent = await sql`
      SELECT *
      FROM media_job
      ORDER BY requested_at DESC, job_id DESC
      LIMIT 20
    `;
    return {
      recent: recent.map(projectJob),
      schemaVersion: mediaJobContractVersion,
      summary,
    };
  },
});
