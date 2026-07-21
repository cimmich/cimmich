import { compileAndPersistSourcePack } from "./source-pack-repository.mjs";

export const sourcePackRebuildWorkerVersion =
  "cimmich-source-pack-rebuild-worker-v1";

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized)
    throw new Error(`SourcePack rebuild worker requires ${label}`);
  return normalized;
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

export const validateRebuildWorkerOptions = (options = {}) => {
  const cutoff = new Date(options.cutoff || "");
  if (!Number.isFinite(cutoff.getTime())) {
    throw new Error("SourcePack rebuild worker requires a valid cutoff");
  }
  return {
    batchSize: boundedInteger(options.batchSize ?? 500, "batchSize", 1, 5000),
    configDigest: requiredText(options.configDigest, "configDigest"),
    cutoff: cutoff.toISOString(),
    leaseSeconds: boundedInteger(
      options.leaseSeconds ?? 300,
      "leaseSeconds",
      30,
      3600,
    ),
    maxAttempts: boundedInteger(options.maxAttempts ?? 3, "maxAttempts", 1, 20),
    maxCycles: boundedInteger(options.maxCycles ?? 10, "maxCycles", 1, 100),
    modelFamily: requiredText(options.modelFamily, "modelFamily"),
    modelVersion: requiredText(options.modelVersion, "modelVersion"),
    workerId: requiredText(options.workerId, "workerId"),
  };
};

export const rebuildWorkerReceipt = ({ cycles, options, packs, requests }) => ({
  activationAuthority: "none",
  cycles,
  model: {
    configDigest: options.configDigest,
    family: options.modelFamily,
    version: options.modelVersion,
  },
  packs,
  requests,
  schemaVersion: "cimmich.source-pack-rebuild-worker-receipt.v1",
  status: "complete",
  workerVersion: sourcePackRebuildWorkerVersion,
});

export const claimSourcePackRebuildBatch = async (sql, optionsInput) => {
  const options = validateRebuildWorkerOptions(optionsInput);
  return sql.begin(async (tx) => {
    await tx`
      UPDATE source_pack_rebuild_request
      SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
        started_at = NULL,
        last_error = concat_ws(E'\n', nullif(last_error, ''), 'Recovered expired worker lease')
      WHERE state = 'processing' AND lease_expires_at < now()
    `;
    const rows = await tx`
      WITH claimable AS (
        SELECT rebuild_request_id
        FROM source_pack_rebuild_request
        WHERE state = 'pending'
          AND (model_family IS NULL OR model_family = ${options.modelFamily})
          AND (model_version IS NULL OR model_version = ${options.modelVersion})
          AND (config_digest IS NULL OR config_digest = ${options.configDigest})
        ORDER BY requested_at, rebuild_request_id
        FOR UPDATE SKIP LOCKED
        LIMIT ${options.batchSize}
      )
      UPDATE source_pack_rebuild_request request
      SET state = 'processing', attempt_count = request.attempt_count + 1,
        started_at = now(), lease_owner = ${options.workerId},
        lease_expires_at = now() + (${options.leaseSeconds} * interval '1 second'),
        last_error = NULL
      FROM claimable
      WHERE request.rebuild_request_id = claimable.rebuild_request_id
      RETURNING request.rebuild_request_id, request.person_id,
        request.reason_code, request.subject_type, request.subject_id,
        request.requested_at, request.attempt_count
    `;
    return { options, rows };
  });
};

const completeBatch = async (sql, claimed, workerId, packId) => {
  const ids = claimed.map((row) => row.rebuild_request_id);
  const rows = await sql`
    UPDATE source_pack_rebuild_request
    SET state = 'completed', result_pack_id = ${packId}, completed_at = now(),
      lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
    WHERE rebuild_request_id = ANY(${ids}) AND state = 'processing'
      AND lease_owner = ${workerId}
    RETURNING rebuild_request_id
  `;
  if (rows.length !== ids.length) {
    throw new Error("SourcePack rebuild lease changed before completion");
  }
};

const releaseFailedBatch = async (sql, claimed, options, error) => {
  const ids = claimed.map((row) => row.rebuild_request_id);
  const message = String(
    error?.message || error || "Unknown rebuild failure",
  ).slice(0, 4000);
  await sql`
    UPDATE source_pack_rebuild_request
    SET state = CASE WHEN attempt_count >= ${options.maxAttempts} THEN 'failed' ELSE 'pending' END,
      completed_at = CASE WHEN attempt_count >= ${options.maxAttempts} THEN now() ELSE NULL END,
      lease_owner = NULL, lease_expires_at = NULL, last_error = ${message}
    WHERE rebuild_request_id = ANY(${ids}) AND state = 'processing'
      AND lease_owner = ${options.workerId}
  `;
};

const activePredecessor = async (sql, options) => {
  const [row] = await sql`
    SELECT pack_id
    FROM source_pack
    WHERE state = 'active' AND model_family = ${options.modelFamily}
      AND model_version = ${options.modelVersion}
      AND config_digest = ${options.configDigest}
    ORDER BY created_at DESC, pack_id DESC
    LIMIT 1
  `;
  return row?.pack_id || null;
};

export const runSourcePackRebuildWorker = async (sql, optionsInput) => {
  const options = validateRebuildWorkerOptions(optionsInput);
  const packs = [];
  let requests = 0;
  let cycles = 0;
  for (; cycles < options.maxCycles; cycles += 1) {
    const claim = await claimSourcePackRebuildBatch(sql, options);
    if (claim.rows.length === 0) break;
    requests += claim.rows.length;
    try {
      const predecessorPackId = await activePredecessor(sql, options);
      const { pack, persistence } = await compileAndPersistSourcePack(
        sql,
        {
          configDigest: options.configDigest,
          cutoff: options.cutoff,
          modelFamily: options.modelFamily,
          modelVersion: options.modelVersion,
          predecessorPackId,
        },
        { execute: true },
      );
      await completeBatch(sql, claim.rows, options.workerId, pack.packId);
      packs.push({
        created: persistence.created,
        packDigest: pack.packDigest,
        packId: pack.packId,
        predecessorPackId,
        state: "proposed",
      });
    } catch (error) {
      await releaseFailedBatch(sql, claim.rows, options, error);
      throw error;
    }
  }
  return rebuildWorkerReceipt({ cycles, options, packs, requests });
};

export const sourcePackRebuildQueueStatus = async (sql) => {
  const [summary] = await sql`SELECT * FROM source_pack_rebuild_status`;
  const recent = await sql`
    SELECT rebuild_request_id, person_id, reason_code, state, attempt_count,
      requested_at, started_at, completed_at, result_pack_id, last_error
    FROM source_pack_rebuild_request
    ORDER BY requested_at DESC, rebuild_request_id DESC
    LIMIT 20
  `;
  return { recent, summary };
};
