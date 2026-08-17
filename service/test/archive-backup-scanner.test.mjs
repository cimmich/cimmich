import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createArchiveBackupScanner,
  parseArchiveBackupTargets,
} from "../src/archive-backup-scanner.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("backup target configuration rejects the source storage domain and arbitrary roots", () => {
  assert.throws(() =>
    parseArchiveBackupTargets(
      JSON.stringify([
        {
          id: "same",
          label: "Same disk",
          root: "/backup/same",
          storageDomain: "archive-primary",
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseArchiveBackupTargets(
      JSON.stringify([
        { id: "root", label: "Unsafe", root: "/", storageDomain: "nas" },
      ]),
    ),
  );
});

test("backup scanner reports exact, changed, archive-only and backup-only files", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "cimmich-backup-scan-"));
  const root = join(temporary, "backup", "test");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "exact.jpg"), "exact");
  await writeFile(join(root, "changed.jpg"), "changed-backup");
  await writeFile(join(root, "extra.jpg"), "extra");
  try {
    const scanner = createArchiveBackupScanner({
      readManifest: async () => [
        {
          byteLength: 5,
          contentDigest: digest("exact"),
          fileModifiedAt: null,
          filenames: ["exact.jpg"],
          sourceAssetIds: ["one"],
        },
        {
          byteLength: 15,
          contentDigest: digest("changed-archive"),
          fileModifiedAt: null,
          filenames: ["changed.jpg"],
          sourceAssetIds: ["two"],
        },
        {
          byteLength: 7,
          contentDigest: digest("missing"),
          fileModifiedAt: null,
          filenames: ["missing.jpg"],
          sourceAssetIds: ["three"],
        },
      ],
      targets: [
        { id: "test", label: "Test", root, storageDomain: "test-disk" },
      ],
    });
    const started = await scanner.start({ targetId: "test" });
    let result;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      result = scanner.get({ id: started.id });
      if (result.status !== "queued" && result.status !== "scanning") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(result.status, "complete");
    assert.deepEqual(result.summary, {
      archiveItems: 3,
      archiveOnlyItems: 1,
      backupFiles: 3,
      backupOnlyFiles: 1,
      changedFiles: 1,
      exactItems: 1,
      notExactItems: 2,
      sizeChangedFiles: 1,
    });
    assert.deepEqual(
      [...new Set(result.items.map((item) => item.kind))].sort(),
      ["archive_only", "backup_only", "changed", "exact"],
    );
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
});
