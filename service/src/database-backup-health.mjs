import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  readFile,
  realpath,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";

export const databaseBackupHealthSchemaVersion =
  "cimmich.database-backup-health.v1";

const destinationIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const frequencyMilliseconds = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const typedError = (code, message, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const cleanActor = (value) =>
  String(value || "")
    .trim()
    .slice(0, 160) || null;

const cleanDestinationIds = (
  values,
  destinations,
  { required = true } = {},
) => {
  if (!Array.isArray(values) || values.length > 8) {
    throw typedError(
      "DATABASE_BACKUP_DESTINATIONS_INVALID",
      "Choose up to eight configured database backup destinations",
    );
  }
  const ids = [...new Set(values.map((value) => String(value || "").trim()))];
  if (
    (required && ids.length === 0) ||
    ids.some((id) => !destinations.has(id))
  ) {
    throw typedError(
      "DATABASE_BACKUP_DESTINATIONS_INVALID",
      "Choose configured database backup destinations",
    );
  }
  return ids;
};

export const parseDatabaseBackupDestinations = (
  value,
  {
    rootPrefix = "/database-backup",
    sourceStorageDomain = "cimmich-database-primary",
  } = {},
) => {
  const input = String(value || "").trim();
  if (!input) return [];
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw typedError(
      "DATABASE_BACKUP_TARGETS_INVALID",
      "Database backup destinations must be valid JSON",
      500,
    );
  }
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw typedError(
      "DATABASE_BACKUP_TARGETS_INVALID",
      "Database backup destinations must be an array of at most eight locations",
      500,
    );
  }
  const ids = new Set();
  const normalizedPrefix = resolve(rootPrefix);
  return parsed.map((candidate) => {
    const id = String(candidate?.id || "").trim();
    const label = String(candidate?.label || "").trim();
    const description = String(candidate?.description || "").trim();
    const root = String(candidate?.root || "").trim();
    const storageDomain = String(candidate?.storageDomain || "").trim();
    const normalizedRoot = resolve(root);
    if (
      !destinationIdPattern.test(id) ||
      ids.has(id) ||
      !label ||
      label.length > 120 ||
      description.length > 240 ||
      !isAbsolute(root) ||
      (normalizedRoot !== normalizedPrefix &&
        !normalizedRoot.startsWith(`${normalizedPrefix}${sep}`)) ||
      !storageDomain ||
      storageDomain.length > 120 ||
      storageDomain === sourceStorageDomain
    ) {
      throw typedError(
        "DATABASE_BACKUP_TARGETS_INVALID",
        "Each database backup destination needs a unique safe ID, label, protected root and independent storage domain",
        500,
      );
    }
    ids.add(id);
    return { description, id, label, root: normalizedRoot, storageDomain };
  });
};

const databaseEnvironment = (databaseUrl) => {
  const parsed = new URL(databaseUrl);
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw typedError(
      "DATABASE_BACKUP_CONFIGURATION_INVALID",
      "Cimmich database connection is not PostgreSQL",
      500,
    );
  }
  return {
    ...process.env,
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    PGHOST: parsed.hostname,
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
  };
};

const defaultRunCommand = (command, args, environment) =>
  new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-32_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      reject(
        new Error(
          `${basename(command)} failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });

const hashFile = (path) =>
  new Promise((resolveHash, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(digest.digest("hex")));
  });

const publicDestination = async (destination) => {
  try {
    const resolvedRoot = await realpath(destination.root);
    const metadata = await lstat(resolvedRoot);
    await access(resolvedRoot, constants.W_OK);
    const capacity = await statfs(resolvedRoot);
    return {
      available: metadata.isDirectory(),
      description: destination.description,
      distinctFailureDomain: true,
      freeBytes: Number(capacity.bavail) * Number(capacity.bsize),
      id: destination.id,
      label: destination.label,
      storageDomain: destination.storageDomain,
      writable: true,
    };
  } catch {
    return {
      available: false,
      description: destination.description,
      distinctFailureDomain: true,
      freeBytes: null,
      id: destination.id,
      label: destination.label,
      storageDomain: destination.storageDomain,
      writable: false,
    };
  }
};

const artifactFromRow = (row) =>
  row
    ? {
        backupRunId: row.backup_run_id,
        byteLength: Number(row.byte_length),
        contentSha256: row.content_sha256,
        createdAt: row.created_at,
        databaseSchemaVersion: Number(row.database_schema_version),
        destinationId: row.destination_id,
        filename: row.filename,
        lastError: row.last_error || "",
        storageDomain: row.storage_domain,
        verificationState: row.verification_state,
        verifiedAt: row.verified_at,
      }
    : null;

const runFromRow = (row) =>
  row
    ? {
        backupRunId: row.backup_run_id,
        completedAt: row.completed_at,
        destinationIds: row.destination_ids ?? [],
        error: row.error || "",
        startedAt: row.started_at,
        state: row.state,
        triggerKind: row.trigger_kind,
      }
    : null;

const nextDueAt = (policy, latestCompletedAt) => {
  const interval = frequencyMilliseconds[policy.frequency];
  if (!interval || policy.destinationIds.length === 0) return null;
  const baseline = latestCompletedAt || policy.updatedAt;
  return new Date(new Date(baseline).getTime() + interval).toISOString();
};

export const createDatabaseBackupManager = ({
  databaseUrl,
  destinations = [],
  now = () => new Date(),
  pgDump = process.env.PG_DUMP || "pg_dump",
  pgRestore = process.env.PG_RESTORE || "pg_restore",
  runCommand = defaultRunCommand,
  scheduleIntervalMs = 60_000,
  sql,
} = {}) => {
  if (!databaseUrl || !sql) {
    throw new Error("Database backup health requires DATABASE_URL and SQL");
  }
  const destinationMap = new Map(
    destinations.map((destination) => [destination.id, destination]),
  );
  const commandEnvironment = databaseEnvironment(databaseUrl);
  let activeRun = null;
  let activeCheck = null;
  let scheduler = null;

  const readPolicy = async () => {
    const [row] = await sql`
      SELECT frequency, destination_ids, retention_count, updated_at
      FROM cimmich_database_backup_policy WHERE policy_id = 'default'
    `;
    return {
      destinationIds: row?.destination_ids ?? [],
      frequency: row?.frequency ?? "manual",
      retentionCount: Number(row?.retention_count || 3),
      updatedAt: row?.updated_at ?? now().toISOString(),
    };
  };

  const latestArtifacts = async () => {
    const rows = await sql`
      SELECT DISTINCT ON (destination_id) backup_run_id, byte_length,
        content_sha256, created_at, database_schema_version, destination_id,
        filename, last_error, storage_domain, verification_state, verified_at
      FROM cimmich_database_backup_artifact
      ORDER BY destination_id, created_at DESC
    `;
    return new Map(
      rows.map((row) => [row.destination_id, artifactFromRow(row)]),
    );
  };

  const latestCompletedRun = async () => {
    const [row] = await sql`
      SELECT backup_run_id, completed_at, destination_ids, error, started_at,
        state, trigger_kind
      FROM cimmich_database_backup_run
      WHERE state IN ('complete', 'partial')
      ORDER BY completed_at DESC NULLS LAST LIMIT 1
    `;
    return runFromRow(row);
  };

  const status = async () => {
    const activeCheckSnapshot = activeCheck
      ? structuredClone(activeCheck)
      : null;
    const activeRunSnapshot = activeRun ? structuredClone(activeRun) : null;
    const [policy, artifacts, latestRun, destinationStates] = await Promise.all(
      [
        readPolicy(),
        latestArtifacts(),
        latestCompletedRun(),
        Promise.all(destinations.map(publicDestination)),
      ],
    );
    return {
      activeCheck: activeCheckSnapshot,
      activeRun: activeRunSnapshot,
      destinations: destinationStates.map((destination) => ({
        ...destination,
        latest: artifacts.get(destination.id) ?? null,
        selected: policy.destinationIds.includes(destination.id),
      })),
      latestCompletedRun: latestRun,
      nextDueAt: nextDueAt(policy, latestRun?.completedAt),
      policy,
      schemaVersion: databaseBackupHealthSchemaVersion,
    };
  };

  const updatePolicy = async ({
    actorId,
    destinationIds,
    frequency,
    retentionCount,
  } = {}) => {
    const cleanFrequency = String(frequency || "").trim();
    if (
      !Object.hasOwn(
        { manual: true, daily: true, weekly: true },
        cleanFrequency,
      )
    ) {
      throw typedError(
        "DATABASE_BACKUP_FREQUENCY_INVALID",
        "Frequency must be Manual, Daily or Weekly",
      );
    }
    const ids = cleanDestinationIds(destinationIds, destinationMap, {
      required: cleanFrequency !== "manual",
    });
    const retention = Number(retentionCount);
    if (!Number.isInteger(retention) || retention < 1 || retention > 30) {
      throw typedError(
        "DATABASE_BACKUP_RETENTION_INVALID",
        "Keep between 1 and 30 database backups per destination",
      );
    }
    await sql`
      UPDATE cimmich_database_backup_policy
      SET frequency = ${cleanFrequency}, destination_ids = ${ids}::text[],
        retention_count = ${retention}, updated_by = ${cleanActor(actorId)},
        updated_at = now()
      WHERE policy_id = 'default'
    `;
    return status();
  };

  const recordArtifact = async ({
    byteLength,
    contentSha256,
    destination,
    filename,
    runId,
    schemaVersion,
  }) => {
    await sql`
      INSERT INTO cimmich_database_backup_artifact (
        backup_run_id, destination_id, storage_domain, filename, byte_length,
        content_sha256, database_schema_version
      ) VALUES (
        ${runId}, ${destination.id}, ${destination.storageDomain}, ${filename},
        ${byteLength}, ${contentSha256}, ${schemaVersion}
      )
    `;
  };

  const pruneDestination = async (destination, retentionCount) => {
    const rows = await sql`
      SELECT backup_run_id, filename
      FROM cimmich_database_backup_artifact
      WHERE destination_id = ${destination.id}
      ORDER BY created_at DESC OFFSET ${retentionCount}
    `;
    for (const row of rows) {
      const filename = basename(String(row.filename || ""));
      if (!filename || filename !== row.filename) continue;
      await unlink(join(destination.root, filename)).catch(() => {});
      await unlink(join(destination.root, `${filename}.json`)).catch(() => {});
      await sql`
        DELETE FROM cimmich_database_backup_artifact
        WHERE backup_run_id = ${row.backup_run_id}
          AND destination_id = ${destination.id}
      `;
    }
  };

  const createArtifact = async ({
    destination,
    filename,
    runId,
    schemaVersion,
  }) => {
    const finalPath = join(destination.root, filename);
    const temporaryPath = join(
      destination.root,
      `.${filename}.${randomUUID()}.partial`,
    );
    try {
      await runCommand(
        pgDump,
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          "--compress=6",
          `--file=${temporaryPath}`,
        ],
        commandEnvironment,
      );
      await chmod(temporaryPath, 0o600);
      await runCommand(
        pgRestore,
        ["--list", temporaryPath],
        commandEnvironment,
      );
      const [contentSha256, metadata] = await Promise.all([
        hashFile(temporaryPath),
        stat(temporaryPath),
      ]);
      await rename(temporaryPath, finalPath);
      const manifest = {
        byteLength: Number(metadata.size),
        contentSha256,
        contractVersion: databaseBackupHealthSchemaVersion,
        createdAt: now().toISOString(),
        databaseSchemaVersion: schemaVersion,
        destinationId: destination.id,
        filename,
        storageDomain: destination.storageDomain,
      };
      await writeFile(
        join(destination.root, `${filename}.json`),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      await recordArtifact({
        byteLength: Number(metadata.size),
        contentSha256,
        destination,
        filename,
        runId,
        schemaVersion,
      });
      return { ...manifest, state: "verified" };
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      await unlink(finalPath).catch(() => {});
      await unlink(join(destination.root, `${filename}.json`)).catch(() => {});
      throw error;
    }
  };

  const performBackup = async ({ actorId, destinationIds, triggerKind }) => {
    const runId = `databasebackup_${randomUUID().replaceAll("-", "")}`;
    const [schemaRow] = await sql`
      SELECT max(version)::int AS schema_version FROM cimmich_schema_migration
    `;
    const schemaVersion = Number(schemaRow?.schema_version);
    const startedAt = now().toISOString();
    activeRun = {
      backupRunId: runId,
      completedAt: null,
      destinationIds,
      destinations: destinationIds.map((destinationId) => ({
        destinationId,
        error: "",
        state: "queued",
      })),
      error: "",
      startedAt,
      state: "queued",
      triggerKind,
    };
    await sql`
      INSERT INTO cimmich_database_backup_run (
        backup_run_id, trigger_kind, destination_ids, state, actor_id,
        database_schema_version, started_at
      ) VALUES (
        ${runId}, ${triggerKind}, ${destinationIds}::text[], 'queued',
        ${cleanActor(actorId)}, ${schemaVersion}, ${startedAt}
      )
    `;
    void (async () => {
      const policy = await readPolicy();
      activeRun.state = "running";
      await sql`
        UPDATE cimmich_database_backup_run SET state = 'running'
        WHERE backup_run_id = ${runId}
      `;
      const filename = `cimmich-database-${startedAt.replaceAll(":", "-")}.dump`;
      let completed = 0;
      const errors = [];
      for (const destinationId of destinationIds) {
        const destination = destinationMap.get(destinationId);
        const item = activeRun.destinations.find(
          (candidate) => candidate.destinationId === destinationId,
        );
        item.state = "running";
        try {
          const state = await publicDestination(destination);
          if (!state.available || !state.writable) {
            throw typedError(
              "DATABASE_BACKUP_DESTINATION_UNAVAILABLE",
              `${destination.label} is unavailable or read-only`,
              409,
            );
          }
          item.artifact = await createArtifact({
            destination,
            filename,
            runId,
            schemaVersion,
          });
          item.state = "complete";
          completed += 1;
          await pruneDestination(destination, policy.retentionCount);
        } catch (error) {
          item.state = "failed";
          item.error = error instanceof Error ? error.message : "Backup failed";
          errors.push(`${destination.label}: ${item.error}`);
        }
      }
      const completedAt = now().toISOString();
      const runError = errors.join("\n");
      const runState =
        completed === destinationIds.length
          ? "complete"
          : completed > 0
            ? "partial"
            : "failed";
      await sql`
        UPDATE cimmich_database_backup_run
        SET state = ${runState}, completed_at = ${completedAt},
          error = ${runError || null}
        WHERE backup_run_id = ${runId}
      `;
      Object.assign(activeRun, {
        completedAt,
        error: runError,
        state: runState,
      });
    })().catch(async (error) => {
      const message = error instanceof Error ? error.message : "Backup failed";
      const completedAt = now().toISOString();
      await sql`
        UPDATE cimmich_database_backup_run SET state = 'failed',
          completed_at = ${completedAt}, error = ${message}
        WHERE backup_run_id = ${runId}
      `.catch(() => {});
      if (activeRun?.backupRunId === runId) {
        Object.assign(activeRun, {
          completedAt,
          error: message,
          state: "failed",
        });
      }
    });
    return activeRun;
  };

  const startBackup = async ({
    actorId,
    destinationIds,
    triggerKind = "manual",
  } = {}) => {
    if (activeRun && ["queued", "running"].includes(activeRun.state)) {
      throw typedError(
        "DATABASE_BACKUP_BUSY",
        "A database backup is already running",
        409,
      );
    }
    const policy = await readPolicy();
    const ids = cleanDestinationIds(
      destinationIds ?? policy.destinationIds,
      destinationMap,
    );
    return performBackup({ actorId, destinationIds: ids, triggerKind });
  };

  const startCheck = async ({ destinationIds } = {}) => {
    if (activeCheck && ["queued", "running"].includes(activeCheck.state)) {
      throw typedError(
        "DATABASE_BACKUP_CHECK_BUSY",
        "A latest-backup check is already running",
        409,
      );
    }
    const policy = await readPolicy();
    const ids = cleanDestinationIds(
      destinationIds ?? policy.destinationIds,
      destinationMap,
    );
    activeCheck = {
      completedAt: null,
      destinationIds: ids,
      items: ids.map((destinationId) => ({
        destinationId,
        error: "",
        state: "queued",
      })),
      startedAt: now().toISOString(),
      state: "queued",
    };
    void (async () => {
      activeCheck.state = "running";
      const artifacts = await latestArtifacts();
      let verified = 0;
      for (const destinationId of ids) {
        const item = activeCheck.items.find(
          (candidate) => candidate.destinationId === destinationId,
        );
        item.state = "running";
        const destination = destinationMap.get(destinationId);
        const artifact = artifacts.get(destinationId);
        try {
          if (!artifact)
            throw new Error("No database backup has been recorded");
          const filename = basename(artifact.filename);
          if (filename !== artifact.filename)
            throw new Error("Backup filename is invalid");
          const path = join(destination.root, filename);
          const [metadata, contentSha256, manifestSource] = await Promise.all([
            stat(path),
            hashFile(path),
            readFile(join(destination.root, `${filename}.json`), "utf8"),
          ]);
          const manifest = JSON.parse(manifestSource);
          if (
            Number(metadata.size) !== artifact.byteLength ||
            contentSha256 !== artifact.contentSha256 ||
            manifest.contentSha256 !== artifact.contentSha256
          ) {
            throw new Error("Backup size or SHA-256 does not match its record");
          }
          await runCommand(pgRestore, ["--list", path], commandEnvironment);
          const verifiedAt = now().toISOString();
          await sql`
            UPDATE cimmich_database_backup_artifact
            SET verification_state = 'verified', verified_at = ${verifiedAt},
              last_error = NULL
            WHERE backup_run_id = ${artifact.backupRunId}
              AND destination_id = ${destinationId}
          `;
          item.state = "verified";
          item.verifiedAt = verifiedAt;
          verified += 1;
        } catch (error) {
          item.state = "failed";
          item.error = error instanceof Error ? error.message : "Check failed";
          if (artifact) {
            await sql`
              UPDATE cimmich_database_backup_artifact
              SET verification_state = 'failed', verified_at = now(),
                last_error = ${item.error}
              WHERE backup_run_id = ${artifact.backupRunId}
                AND destination_id = ${destinationId}
            `;
          }
        }
      }
      activeCheck.completedAt = now().toISOString();
      activeCheck.state = verified === ids.length ? "complete" : "failed";
    })().catch((error) => {
      activeCheck.state = "failed";
      activeCheck.completedAt = now().toISOString();
      activeCheck.error =
        error instanceof Error ? error.message : "Check failed";
    });
    return activeCheck;
  };

  const tick = async () => {
    if (activeRun && ["queued", "running"].includes(activeRun.state)) return;
    const current = await status();
    if (!current.nextDueAt || new Date(current.nextDueAt) > now()) return;
    await startBackup({
      actorId: "cimmich-scheduler",
      destinationIds: current.policy.destinationIds,
      triggerKind: "scheduled",
    });
  };

  return {
    close() {
      if (scheduler) clearInterval(scheduler);
      scheduler = null;
    },
    startBackup,
    startCheck,
    startScheduler() {
      if (scheduler) return;
      scheduler = setInterval(() => {
        void tick().catch((error) => {
          console.error("Cimmich database backup scheduler failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }, scheduleIntervalMs);
      scheduler.unref?.();
      void tick().catch(() => {});
    },
    status,
    tick,
    updatePolicy,
  };
};
