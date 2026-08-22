import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDatabaseBackupManager,
  parseDatabaseBackupDestinations,
} from "../src/database-backup-health.mjs";

test("database backup destination configuration rejects arbitrary roots and the database storage domain", () => {
  assert.throws(() =>
    parseDatabaseBackupDestinations(
      JSON.stringify([
        {
          id: "same",
          label: "Same disk",
          root: "/database-backup/same",
          storageDomain: "database-primary",
        },
      ]),
      { sourceStorageDomain: "database-primary" },
    ),
  );
  assert.throws(() =>
    parseDatabaseBackupDestinations(
      JSON.stringify([
        { id: "unsafe", label: "Unsafe", root: "/tmp", storageDomain: "nas" },
      ]),
    ),
  );
});

test("database backup publication and subprocesses fail closed", async () => {
  const source = await readFile(
    new URL("../src/database-backup-health.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /child\.kill\("SIGTERM"\)/);
  assert.match(source, /child\.kill\("SIGKILL"\)/);
  assert.match(source, /await link\(temporaryPath, finalPath\)/);
  assert.match(source, /flag: "wx"/);
  assert.match(source, /runId\.slice\(-12\)/);
});

test("database backup manager creates, records and fully rechecks a restorable artifact", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "cimmich-database-backup-"));
  const root = join(temporary, "database-backup", "primary");
  await mkdir(root, { recursive: true });
  const destinations = parseDatabaseBackupDestinations(
    JSON.stringify([
      {
        description: "Independent test storage",
        id: "primary",
        label: "Primary backup",
        root,
        storageDomain: "test-independent-disk",
      },
    ]),
    { rootPrefix: join(temporary, "database-backup") },
  );
  const state = {
    artifacts: [],
    policy: {
      destination_ids: [],
      frequency: "manual",
      retention_count: 3,
      updated_at: "2026-08-19T00:00:00.000Z",
    },
    runs: [],
  };
  const sql = (strings, ...values) => {
    const statement = strings.join(" ? ");
    if (statement.includes("FROM cimmich_database_backup_policy"))
      return Promise.resolve([state.policy]);
    if (statement.includes("UPDATE cimmich_database_backup_policy")) {
      state.policy = {
        destination_ids: values[1],
        frequency: values[0],
        retention_count: values[2],
        updated_at: "2026-08-19T00:01:00.000Z",
      };
      return Promise.resolve([]);
    }
    if (statement.includes("SELECT DISTINCT ON (destination_id)")) {
      return Promise.resolve(
        [...state.artifacts].sort((left, right) =>
          right.created_at.localeCompare(left.created_at),
        ),
      );
    }
    if (
      statement.includes("FROM cimmich_database_backup_run") &&
      statement.includes("state IN")
    ) {
      return Promise.resolve(
        state.runs
          .filter((run) => ["complete", "partial"].includes(run.state))
          .sort((left, right) =>
            right.completed_at.localeCompare(left.completed_at),
          )
          .slice(0, 1),
      );
    }
    if (statement.includes("max(version)::int"))
      return Promise.resolve([{ schema_version: 141 }]);
    if (statement.includes("INSERT INTO cimmich_database_backup_run")) {
      state.runs.push({
        backup_run_id: values[0],
        trigger_kind: values[1],
        destination_ids: values[2],
        state: "queued",
        started_at: values[5],
        completed_at: null,
        error: null,
      });
      return Promise.resolve([]);
    }
    if (
      statement.includes(
        "UPDATE cimmich_database_backup_run SET state = 'running'",
      )
    ) {
      state.runs.find((run) => run.backup_run_id === values[0]).state =
        "running";
      return Promise.resolve([]);
    }
    if (statement.includes("INSERT INTO cimmich_database_backup_artifact")) {
      state.artifacts.push({
        backup_run_id: values[0],
        destination_id: values[1],
        storage_domain: values[2],
        filename: values[3],
        byte_length: values[4],
        content_sha256: values[5],
        database_schema_version: values[6],
        verification_state: "verified",
        created_at: "2026-08-19T00:02:00.000Z",
        verified_at: "2026-08-19T00:02:00.000Z",
        last_error: null,
      });
      return Promise.resolve([]);
    }
    if (statement.includes("ORDER BY created_at DESC OFFSET"))
      return Promise.resolve([]);
    if (
      statement.includes("SET state =") &&
      statement.includes("completed_at")
    ) {
      const run = state.runs.find(
        (candidate) => candidate.backup_run_id === values[3],
      );
      run.state = values[0];
      run.completed_at = values[1];
      run.error = values[2];
      return Promise.resolve([]);
    }
    if (statement.includes("UPDATE cimmich_database_backup_artifact")) {
      const artifact = state.artifacts.find(
        (candidate) =>
          candidate.backup_run_id === values.at(-2) &&
          candidate.destination_id === values.at(-1),
      );
      artifact.verification_state = statement.includes("'verified'")
        ? "verified"
        : "failed";
      artifact.verified_at = values[0];
      artifact.last_error =
        artifact.verification_state === "verified" ? null : values[0];
      return Promise.resolve([]);
    }
    throw new Error(`Unexpected SQL: ${statement.slice(0, 160)}`);
  };
  const runCommand = async (command, args) => {
    if (command === "test-pg-dump") {
      const output = args
        .find((argument) => argument.startsWith("--file="))
        .slice("--file=".length);
      await writeFile(output, "restorable custom-format test backup");
    }
  };
  const manager = createDatabaseBackupManager({
    databaseUrl: "postgres://cimmich:secret@database:5432/cimmich",
    destinations,
    now: () => new Date("2026-08-19T00:02:00.000Z"),
    pgDump: "test-pg-dump",
    pgRestore: "test-pg-restore",
    runCommand,
    sql,
  });
  try {
    await manager.updatePolicy({
      destinationIds: ["primary"],
      frequency: "daily",
      retentionCount: 3,
    });
    await manager.startBackup({ destinationIds: ["primary"] });
    let current;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      current = await manager.status();
      if (current.activeRun?.state === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(current.activeRun.state, "complete");
    assert.equal(current.destinations[0].latest.databaseSchemaVersion, 141);
    assert.equal(current.destinations[0].latest.verificationState, "verified");
    const filename = current.destinations[0].latest.filename;
    assert.equal(
      await readFile(join(root, filename), "utf8"),
      "restorable custom-format test backup",
    );

    await manager.startCheck({ destinationIds: ["primary"] });
    for (let attempt = 0; attempt < 400; attempt += 1) {
      current = await manager.status();
      if (current.activeCheck?.state === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(current.activeCheck.state, "complete");
    assert.equal(current.activeCheck.items[0].state, "verified");

    await manager.startBackup({ destinationIds: ["primary"] });
    for (let attempt = 0; attempt < 400; attempt += 1) {
      current = await manager.status();
      if (
        current.activeRun?.state === "complete" &&
        current.activeRun.backupRunId !== state.runs[0].backup_run_id
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const artifacts = (await readdir(root)).filter((name) =>
      name.endsWith(".dump"),
    );
    assert.equal(artifacts.length, 2);
    assert.notEqual(artifacts[0], artifacts[1]);
    assert.equal(
      await readFile(join(root, filename), "utf8"),
      "restorable custom-format test backup",
    );
  } finally {
    manager.close();
    await rm(temporary, { force: true, recursive: true });
  }
});
