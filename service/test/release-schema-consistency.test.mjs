import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadMigrations } from "../src/migration-runner.mjs";

const exec = promisify(execFile);
const serviceDirectory = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const repositoryRoot = path.resolve(serviceDirectory, "..");
const migrationsDirectory = path.join(repositoryRoot, "migrations");
const schemaHelper = path.join(
  repositoryRoot,
  "tools/current_schema_version.sh",
);

test("release schema truth is derived from one contiguous migration ledger", async () => {
  const migrations = await loadMigrations(migrationsDirectory);
  const current = migrations.at(-1).version;
  const { stdout } = await exec("sh", [schemaHelper, migrationsDirectory]);
  assert.equal(Number(stdout.trim()), current);

  const [operator, bootstrap, repository, lifecycle, synthetic] =
    await Promise.all(
      [
        "tools/public_demo.sh",
        "service/bin/bootstrap-public-demo.mjs",
        "service/src/repository.mjs",
        "service/bin/document-lifecycle.mjs",
        "tools/run_synthetic_acceptance.sh",
      ].map((filename) =>
        readFile(path.join(repositoryRoot, filename), "utf8"),
      ),
    );
  assert.match(operator, /current_schema_version\.sh/);
  assert.doesNotMatch(operator, /CURRENT_SCHEMA_VERSION=\d+/);
  const coldImageBuild = operator.indexOf("compose build cimmich-api");
  const firstBootstrapRun = operator.indexOf(
    "cimmich-bootstrap node bin/migrate.mjs apply",
  );
  assert.notEqual(coldImageBuild, -1);
  assert.notEqual(firstBootstrapRun, -1);
  assert.ok(
    coldImageBuild < firstBootstrapRun,
    "fresh demo operator must build its project-scoped API image before bootstrap",
  );
  assert.match(bootstrap, /loadMigrations/);
  assert.doesNotMatch(bootstrap, /requires schema \d+/);
  assert.match(repository, /expectedSchemaVersion/);
  assert.doesNotMatch(repository, /applied_schema_version\) !== \d+/);
  assert.match(lifecycle, /loadMigrations/);
  assert.doesNotMatch(lifecycle, /maximumDatabaseSchemaVersion = \d+/);
  assert.match(synthetic, /current_schema_version\.sh/);
  await assert.rejects(
    exec("rg", [
      "-n",
      "health(?:\\.payload)?\\.schemaVersion, [0-9]+",
      path.join(repositoryRoot, "service/acceptance"),
    ]),
    (error) => error.code === 1,
  );
  assert.doesNotMatch(operator, /migration_(?:count|version).*\"[0-9]+\"/);

  for (const filename of [
    "service/README.md",
    "docs/RELEASE_READINESS.md",
    "docs/BUILD_WEEK.md",
  ]) {
    const source = await readFile(path.join(repositoryRoot, filename), "utf8");
    assert.match(source, new RegExp(`schema ${current}\\b`));
  }
});

test("schema helper fails closed on a non-contiguous release ledger", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cimmich-schema-ledger-"),
  );
  try {
    await writeFile(path.join(directory, "0001_first.sql"), "BEGIN; COMMIT;\n");
    await writeFile(path.join(directory, "0003_gap.sql"), "BEGIN; COMMIT;\n");
    await assert.rejects(
      exec("sh", [schemaHelper, directory]),
      (error) =>
        error.code === 1 && /not contiguous/.test(String(error.stderr)),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
