import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const archiveBackupScanSchemaVersion = "cimmich.archive-backup-scan.v1";

const targetIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const count = (value) => Number(value || 0);

const typedError = (code, message, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

export const parseArchiveBackupTargets = (
  value,
  { sourceStorageDomain = "archive-primary" } = {},
) => {
  const input = String(value || "").trim();
  if (!input) return [];
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw typedError(
      "ARCHIVE_BACKUP_TARGETS_INVALID",
      "Backup scan targets must be valid JSON",
      500,
    );
  }
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw typedError(
      "ARCHIVE_BACKUP_TARGETS_INVALID",
      "Backup scan targets must be an array of at most eight destinations",
      500,
    );
  }
  const ids = new Set();
  return parsed.map((target) => {
    const id = String(target?.id || "").trim();
    const label = String(target?.label || "").trim();
    const root = String(target?.root || "").trim();
    const storageDomain = String(target?.storageDomain || "").trim();
    if (
      !targetIdPattern.test(id) ||
      ids.has(id) ||
      !label ||
      label.length > 120 ||
      !isAbsolute(root) ||
      !root.startsWith(`/backup${sep}`) ||
      !storageDomain ||
      storageDomain === sourceStorageDomain
    ) {
      throw typedError(
        "ARCHIVE_BACKUP_TARGETS_INVALID",
        "Each backup target needs a unique safe ID, label, /backup path and distinct storage domain",
        500,
      );
    }
    ids.add(id);
    return { id, label, root: resolve(root), storageDomain };
  });
};

const hashFile = (path) =>
  new Promise((resolveHash, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(digest.digest("hex")));
  });

const discoverFiles = async (root, maximumFiles) => {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(path);
      if (files.length > maximumFiles) {
        throw typedError(
          "ARCHIVE_BACKUP_SCAN_LIMIT_EXCEEDED",
          `Backup scan exceeded the ${maximumFiles.toLocaleString()} file safety limit`,
          413,
        );
      }
    }
  }
  return files;
};

const normalizedName = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase();

const compare = (manifest, backupFiles) => {
  const archiveByDigest = new Map(
    manifest.map((item) => [item.contentDigest, item]),
  );
  const archiveByName = new Map();
  for (const item of manifest) {
    for (const filename of item.filenames) {
      const key = normalizedName(filename);
      if (!key) continue;
      const candidates = archiveByName.get(key) ?? [];
      candidates.push(item);
      archiveByName.set(key, candidates);
    }
  }

  const exactArchiveDigests = new Set();
  const changedArchiveDigests = new Set();
  const items = [];
  for (const backup of backupFiles) {
    const exact = archiveByDigest.get(backup.contentDigest);
    if (exact) {
      exactArchiveDigests.add(exact.contentDigest);
      items.push({
        archive: exact,
        backup,
        changes: exact.byteLength === backup.byteLength ? [] : ["size"],
        kind: "exact",
      });
      continue;
    }
    const candidates = archiveByName.get(normalizedName(backup.filename)) ?? [];
    if (candidates.length > 0) {
      const closest = [...candidates].sort(
        (left, right) =>
          Math.abs(left.byteLength - backup.byteLength) -
          Math.abs(right.byteLength - backup.byteLength),
      )[0];
      const changes = ["content_or_embedded_metadata"];
      if (closest.byteLength !== backup.byteLength) changes.push("size");
      if (
        closest.fileModifiedAt &&
        backup.modifiedAt &&
        Date.parse(closest.fileModifiedAt) !== Date.parse(backup.modifiedAt)
      ) {
        changes.push("modified_time");
      }
      if (candidates.length > 1) changes.push("filename_ambiguous");
      changedArchiveDigests.add(closest.contentDigest);
      items.push({ archive: closest, backup, changes, kind: "changed" });
      continue;
    }
    items.push({ archive: null, backup, changes: [], kind: "backup_only" });
  }
  for (const archive of manifest) {
    if (
      !exactArchiveDigests.has(archive.contentDigest) &&
      !changedArchiveDigests.has(archive.contentDigest)
    ) {
      items.push({ archive, backup: null, changes: [], kind: "archive_only" });
    }
  }
  const exactItems = exactArchiveDigests.size;
  return {
    items,
    summary: {
      archiveItems: manifest.length,
      archiveOnlyItems: items.filter((item) => item.kind === "archive_only")
        .length,
      backupFiles: backupFiles.length,
      backupOnlyFiles: items.filter((item) => item.kind === "backup_only")
        .length,
      changedFiles: items.filter((item) => item.kind === "changed").length,
      exactItems,
      notExactItems: manifest.length - exactItems,
      sizeChangedFiles: items.filter(
        (item) => item.kind === "changed" && item.changes.includes("size"),
      ).length,
    },
  };
};

export const createArchiveBackupScanner = ({
  maximumFiles = 500_000,
  readManifest,
  sourceStorageDomain = "archive-primary",
  targets = [],
} = {}) => {
  const scans = new Map();
  let activeScanId = null;

  const publicTarget = async (target) => {
    let available;
    try {
      const resolved = await realpath(target.root);
      const metadata = await lstat(resolved);
      available = metadata.isDirectory();
    } catch {
      available = false;
    }
    return {
      available,
      distinctFailureDomain: target.storageDomain !== sourceStorageDomain,
      id: target.id,
      label: target.label,
      readOnly: true,
      storageDomain: target.storageDomain,
    };
  };

  const run = async (scan, target) => {
    try {
      scan.status = "scanning";
      scan.progress.phase = "inventory";
      const resolvedRoot = await realpath(target.root);
      const rootMetadata = await lstat(resolvedRoot);
      if (!rootMetadata.isDirectory()) {
        throw typedError(
          "ARCHIVE_BACKUP_TARGET_UNAVAILABLE",
          "The configured backup destination is unavailable",
          409,
        );
      }
      const [manifest, paths] = await Promise.all([
        readManifest(),
        discoverFiles(resolvedRoot, maximumFiles),
      ]);
      scan.progress.filesDiscovered = paths.length;
      scan.progress.phase = "hashing";
      const files = [];
      for (const path of paths) {
        const metadata = await lstat(path);
        const contentDigest = await hashFile(path);
        files.push({
          byteLength: count(metadata.size),
          contentDigest,
          filename: path.split(sep).at(-1),
          modifiedAt: metadata.mtime.toISOString(),
          relativePath: relative(resolvedRoot, path).split(sep).join("/"),
        });
        scan.progress.bytesHashed += count(metadata.size);
        scan.progress.filesHashed += 1;
      }
      scan.progress.phase = "comparing";
      const result = compare(manifest, files);
      scan.items = result.items;
      scan.summary = result.summary;
      scan.status = "complete";
      scan.progress.phase = "complete";
      scan.completedAt = new Date().toISOString();
    } catch (error) {
      scan.status = "failed";
      scan.progress.phase = "failed";
      scan.completedAt = new Date().toISOString();
      scan.error =
        error instanceof Error ? error.message : "Backup scan failed";
    } finally {
      if (activeScanId === scan.id) activeScanId = null;
    }
  };

  return {
    async listTargets() {
      return {
        items: await Promise.all(targets.map(publicTarget)),
        schemaVersion: archiveBackupScanSchemaVersion,
      };
    },
    async start({ targetId } = {}) {
      const target = targets.find((candidate) => candidate.id === targetId);
      if (!target) {
        throw typedError(
          "ARCHIVE_BACKUP_TARGET_NOT_FOUND",
          "Choose a configured backup destination",
          404,
        );
      }
      if (activeScanId) {
        throw typedError(
          "ARCHIVE_BACKUP_SCAN_BUSY",
          "Another backup scan is already running",
          409,
        );
      }
      const state = await publicTarget(target);
      if (!state.available || !state.distinctFailureDomain) {
        throw typedError(
          "ARCHIVE_BACKUP_TARGET_UNAVAILABLE",
          "The backup destination is unavailable or not independent",
          409,
        );
      }
      const now = new Date().toISOString();
      const scan = {
        completedAt: null,
        error: "",
        id: randomUUID(),
        items: [],
        progress: {
          bytesHashed: 0,
          filesDiscovered: 0,
          filesHashed: 0,
          phase: "queued",
        },
        schemaVersion: archiveBackupScanSchemaVersion,
        startedAt: now,
        status: "queued",
        summary: null,
        target: state,
      };
      scans.set(scan.id, scan);
      activeScanId = scan.id;
      void run(scan, target);
      return { ...scan, items: [] };
    },
    get({ id, kind = "all", limit = 100, offset = 0 } = {}) {
      const scan = scans.get(id);
      if (!scan) {
        throw typedError(
          "ARCHIVE_BACKUP_SCAN_NOT_FOUND",
          "Backup scan was not found in this API session",
          404,
        );
      }
      const cleanLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
      const cleanOffset = Math.max(Number(offset) || 0, 0);
      const filtered =
        kind === "all"
          ? scan.items
          : scan.items.filter((item) => item.kind === kind);
      const items = filtered.slice(cleanOffset, cleanOffset + cleanLimit);
      const nextOffset =
        cleanOffset + items.length < filtered.length
          ? cleanOffset + items.length
          : null;
      return {
        ...scan,
        items,
        limit: cleanLimit,
        nextOffset,
        offset: cleanOffset,
      };
    },
  };
};
