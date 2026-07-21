import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadMigrations } from "../src/migration-runner.mjs";

const contractVersion = "cimmich.document-lifecycle.v1";
const minimumDatabaseSchemaVersion = 48;
const serviceDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseMigrations = await loadMigrations(
  resolve(
    process.env.CIMMICH_MIGRATIONS_DIRECTORY ||
      join(serviceDirectory, "../migrations"),
  ),
);
const maximumDatabaseSchemaVersion = releaseMigrations.at(-1)?.version || 0;
const databaseUrl = process.env.DATABASE_URL || "";
const defaultStoreRoot = process.env.CIMMICH_DOCUMENT_STORE_ROOT || "";

const fail = (message, code = "DOCUMENT_LIFECYCLE_INVALID") =>
  Object.assign(new Error(message), { code });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const legacyCanonical = (value) => {
  if (Array.isArray(value)) return value.map(legacyCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, legacyCanonical(nested)]),
    );
  }
  return value;
};
const legacyBufferDigest = (bytes) =>
  sha256(Buffer.from(JSON.stringify(legacyCanonical(bytes))));
const parseArguments = (values) => {
  const [command = "", ...rest] = values;
  const options = {};
  for (const value of rest) {
    if (!value.startsWith("--") || !value.includes("=")) {
      throw fail(`Invalid argument: ${value}`);
    }
    const [key, ...parts] = value.slice(2).split("=");
    options[key] = parts.join("=");
  }
  return { command, options };
};
const required = (options, key, fallback = "") => {
  const value = String(options[key] || fallback).trim();
  if (!value) throw fail(`--${key}=... is required`);
  return value;
};
const requiredDatabaseUrl = (options) => {
  if (Object.hasOwn(options, "database-url")) {
    throw fail(
      "Supply the database connection through DATABASE_URL, never a command argument",
      "DOCUMENT_LIFECYCLE_SECRET_TRANSPORT_INVALID",
    );
  }
  const value = String(databaseUrl || "").trim();
  if (!value) throw fail("DATABASE_URL is required");
  return value;
};
const readDatabaseSchemaVersion = async (sql) => {
  const [row] = await sql`
    SELECT max(version)::int AS schema_version FROM cimmich_schema_migration
  `;
  const schemaVersion = Number(row?.schema_version);
  if (
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < minimumDatabaseSchemaVersion ||
    schemaVersion > maximumDatabaseSchemaVersion
  ) {
    throw fail(
      "Cimmich database schema is unsupported by this lifecycle tool",
      "DOCUMENT_LIFECYCLE_SCHEMA_UNSUPPORTED",
    );
  }
  return schemaVersion;
};
const databaseEnvironment = (value) => {
  const url = new URL(value);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw fail("DATABASE_URL must use postgres:// or postgresql://");
  }
  return {
    ...process.env,
    PGDATABASE: url.pathname.slice(1),
    PGHOST: url.hostname,
    PGPASSWORD: decodeURIComponent(url.password),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
  };
};
const databaseName = (value) => new URL(value).pathname.slice(1);
const run = (command, args, env) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString("utf8");
    });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else
        rejectPromise(
          fail(
            `${basename(command)} failed (${code}): ${errorText.trim() || "no diagnostic"}`,
            "DOCUMENT_LIFECYCLE_DATABASE_TOOL_FAILED",
          ),
        );
    });
  });
const exists = async (path) =>
  access(path)
    .then(() => true)
    .catch(() => false);
const requireRegularFile = async (path) => {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw fail(
      `Expected a regular file: ${path}`,
      "DOCUMENT_LIFECYCLE_ISOLATION_FAILED",
    );
  }
  return details;
};
const requireInside = (root, relative) => {
  if (!/^[0-9a-f]{2}\/[0-9a-f]{64}$/.test(relative)) {
    throw fail(
      "Document storage key is invalid",
      "DOCUMENT_LIFECYCLE_ISOLATION_FAILED",
    );
  }
  const absolute = resolve(root, relative);
  if (!absolute.startsWith(`${resolve(root)}${sep}`)) {
    throw fail(
      "Document storage path escaped its root",
      "DOCUMENT_LIFECYCLE_ISOLATION_FAILED",
    );
  }
  return absolute;
};
const copyVerified = async ({ byteSize, destination, sha, source }) => {
  const details = await requireRegularFile(source);
  if (details.size !== Number(byteSize)) {
    throw fail(
      `Document byte size mismatch: ${source}`,
      "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
    );
  }
  const bytes = await readFile(source);
  if (sha256(bytes) !== sha) {
    throw fail(
      `Document SHA-256 mismatch: ${source}`,
      "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
    );
  }
  await mkdir(dirname(destination), { mode: 0o700, recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o600);
};
const writeManifest = async (path, manifest) => {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
};
const readManifest = async (root) => {
  const path = join(root, "manifest.json");
  await requireRegularFile(path);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw fail("Document lifecycle manifest is not valid JSON");
  }
  if (
    manifest?.contractVersion !== contractVersion ||
    !Number.isSafeInteger(manifest?.schemaVersion) ||
    manifest.schemaVersion < minimumDatabaseSchemaVersion ||
    manifest.schemaVersion > maximumDatabaseSchemaVersion
  ) {
    throw fail("Document lifecycle manifest version is unsupported");
  }
  if (!Array.isArray(manifest.files))
    throw fail("Document lifecycle manifest files are invalid");
  if (
    !Number.isSafeInteger(manifest.documentCount) ||
    manifest.documentCount < 0 ||
    !Number.isSafeInteger(manifest.totalContentBytes) ||
    manifest.totalContentBytes < 0 ||
    !/^[0-9a-f]{64}$/.test(String(manifest.databaseDumpSha256 || ""))
  ) {
    throw fail("Document lifecycle manifest summary is invalid");
  }
  const storageKeys = new Set();
  for (const item of manifest.files) {
    if (
      !item ||
      !Number.isSafeInteger(item.byteSize) ||
      item.byteSize < 1 ||
      item.byteSize > 25 * 1024 * 1024 ||
      !/^[0-9a-f]{64}$/.test(String(item.sha256 || "")) ||
      item.storageKey !== `${item.sha256.slice(0, 2)}/${item.sha256}` ||
      storageKeys.has(item.storageKey)
    ) {
      throw fail("Document lifecycle manifest content entry is invalid");
    }
    storageKeys.add(item.storageKey);
  }
  return manifest;
};
const verify = async (rootValue) => {
  const root = resolve(rootValue);
  const manifest = await readManifest(root);
  const dumpPath = join(root, "database.dump");
  await requireRegularFile(dumpPath);
  const dumpBytes = await readFile(dumpPath);
  if (sha256(dumpBytes) !== manifest.databaseDumpSha256) {
    throw fail(
      "Database dump SHA-256 mismatch",
      "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
    );
  }
  let totalBytes = 0;
  for (const item of manifest.files) {
    const source = requireInside(join(root, "documents"), item.storageKey);
    const details = await requireRegularFile(source);
    if (
      details.size !== Number(item.byteSize) ||
      sha256(await readFile(source)) !== item.sha256
    ) {
      throw fail(
        `Backup content integrity failed: ${item.storageKey}`,
        "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
      );
    }
    totalBytes += details.size;
  }
  if (totalBytes !== Number(manifest.totalContentBytes)) {
    throw fail(
      "Backup content total is invalid",
      "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
    );
  }
  return { ...manifest, root, status: "verified" };
};

const backup = async (options) => {
  const db = requiredDatabaseUrl(options);
  const storeRoot = resolve(required(options, "store-root", defaultStoreRoot));
  const output = resolve(required(options, "output"));
  if (await exists(output)) throw fail("Backup output already exists");
  const staging = `${output}.tmp-${randomUUID()}`;
  let published = false;
  await mkdir(staging, { mode: 0o700, recursive: true });
  const sql = postgres(db, { max: 1, prepare: true });
  try {
    await sql.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('cimmich-document-store-quota', 0))`;
      const [schema] = await tx`
        SELECT EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_document_lifecycle_compatibility_v1'
        ) AS ready
      `;
      if (!schema?.ready) throw fail("Current Cimmich schema is required");
      const schemaVersion = await readDatabaseSchemaVersion(tx);
      const [{ pg_export_snapshot: snapshot }] =
        await tx`SELECT pg_export_snapshot()`;
      const files = await tx`
        SELECT storage_key, max(byte_size)::bigint AS byte_size, content_sha256
        FROM cimmich_document
        WHERE source_kind = 'cimmich_file'
        GROUP BY storage_key, content_sha256
        ORDER BY storage_key
      `;
      const [{ count: documentCount }] = await tx`
        SELECT count(*)::int AS count FROM cimmich_document
      `;
      const dumpPath = join(staging, "database.dump");
      await run(
        process.env.PG_DUMP || "pg_dump",
        [
          "--format=custom",
          "--no-owner",
          "--no-acl",
          `--snapshot=${snapshot}`,
          `--file=${dumpPath}`,
        ],
        databaseEnvironment(db),
      );
      await chmod(dumpPath, 0o600);
      const manifestFiles = [];
      for (const file of files) {
        const item = {
          byteSize: Number(file.byte_size),
          sha256: file.content_sha256,
          storageKey: file.storage_key,
        };
        await copyVerified({
          ...item,
          destination: requireInside(
            join(staging, "documents"),
            item.storageKey,
          ),
          sha: item.sha256,
          source: requireInside(storeRoot, item.storageKey),
        });
        manifestFiles.push(item);
      }
      const dumpBytes = await readFile(dumpPath);
      await writeManifest(join(staging, "manifest.json"), {
        contractVersion,
        createdAt: new Date().toISOString(),
        databaseDumpSha256: sha256(dumpBytes),
        documentCount: Number(documentCount),
        files: manifestFiles,
        schemaVersion,
        totalContentBytes: manifestFiles.reduce(
          (sum, item) => sum + item.byteSize,
          0,
        ),
      });
    });
    await rename(staging, output);
    published = true;
    return verify(output);
  } catch (error) {
    await rm(published ? output : staging, {
      force: true,
      recursive: true,
    }).catch(() => {});
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const restore = async (options) => {
  const input = resolve(required(options, "input"));
  const db = requiredDatabaseUrl(options);
  const storeRoot = resolve(required(options, "store-root", defaultStoreRoot));
  const manifest = await verify(input);
  const sql = postgres(db, { max: 1, prepare: true });
  const staging = `${storeRoot}.restore-${randomUUID()}`;
  try {
    const [{ count }] = await sql`
      SELECT count(*)::int AS count FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p')
    `;
    if (Number(count) !== 0) {
      throw fail(
        "Restore target database is not empty",
        "DOCUMENT_LIFECYCLE_TARGET_NOT_EMPTY",
      );
    }
    if (await exists(storeRoot)) {
      const entries = await readdir(storeRoot);
      if (entries.length) {
        throw fail(
          "Restore target document store is not empty",
          "DOCUMENT_LIFECYCLE_TARGET_NOT_EMPTY",
        );
      }
    }
    await mkdir(staging, { mode: 0o700, recursive: true });
    for (const item of manifest.files) {
      await copyVerified({
        ...item,
        destination: requireInside(staging, item.storageKey),
        sha: item.sha256,
        source: requireInside(join(input, "documents"), item.storageKey),
      });
    }
    await run(
      process.env.PG_RESTORE || "pg_restore",
      [
        "--exit-on-error",
        "--no-owner",
        "--no-acl",
        `--dbname=${databaseName(db)}`,
        join(input, "database.dump"),
      ],
      databaseEnvironment(db),
    );
    const [restored] = await sql`
      SELECT
        EXISTS (
          SELECT 1 FROM producer_receipt
          WHERE producer_receipt_id = 'receipt_cimmich_document_lifecycle_compatibility_v1'
        ) AS ready,
        (SELECT count(*)::int FROM cimmich_document) AS document_count,
        (SELECT max(version)::int FROM cimmich_schema_migration) AS schema_version
    `;
    if (
      !restored?.ready ||
      Number(restored.document_count) !== Number(manifest.documentCount) ||
      Number(restored.schema_version) !== Number(manifest.schemaVersion)
    ) {
      throw fail(
        "Restored database does not match the manifest",
        "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
      );
    }
    if (await exists(storeRoot)) await rmdir(storeRoot);
    await rename(staging, storeRoot);
    return {
      contractVersion,
      documentCount: Number(restored.document_count),
      fileCount: manifest.files.length,
      schemaVersion: Number(restored.schema_version),
      status: "restored",
    };
  } catch (error) {
    await rm(staging, { force: true, recursive: true }).catch(() => {});
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const exportDocument = async (options) => {
  const db = requiredDatabaseUrl(options);
  const storeRoot = resolve(required(options, "store-root", defaultStoreRoot));
  const documentId = required(options, "document-id");
  const output = resolve(required(options, "output"));
  if (!/^document_[0-9a-f]{32}$/.test(documentId) || (await exists(output))) {
    throw fail("Export target or Document ID is invalid");
  }
  const sql = postgres(db, { max: 1, prepare: true });
  try {
    return await sql.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('cimmich-document-store-quota', 0))`;
      const schemaVersion = await readDatabaseSchemaVersion(tx);
      const [document] = await tx`
        SELECT * FROM cimmich_document WHERE document_id = ${documentId}
      `;
      if (!document) throw fail("Document not found", "DOCUMENT_NOT_FOUND");
      const links = await tx`
        SELECT subject_kind, subject_id, relation_kind
        FROM current_cimmich_document_link WHERE document_id = ${documentId}
        ORDER BY subject_kind, subject_id, relation_kind
      `;
      const staging = `${output}.tmp-${randomUUID()}`;
      await mkdir(staging, { mode: 0o700, recursive: true });
      try {
        let content = null;
        if (document.source_kind === "cimmich_file") {
          const safeName = String(document.source_filename)
            .replaceAll("/", "_")
            .replaceAll("\\", "_");
          const destination = join(staging, safeName);
          await copyVerified({
            byteSize: Number(document.byte_size),
            destination,
            sha: document.content_sha256,
            source: requireInside(storeRoot, document.storage_key),
          });
          content = { filename: safeName, sha256: document.content_sha256 };
        }
        await writeManifest(join(staging, "document.json"), {
          content,
          contractVersion,
          document: {
            documentId: document.document_id,
            documentKind: document.document_kind,
            documentLabel: document.document_label,
            displayTitle: document.display_title,
            expiresOn: document.expires_on,
            issuedOn: document.issued_on,
            revision: Number(document.revision),
            source: {
              assetId: document.source_asset_id,
              byteSize:
                document.byte_size === null ? null : Number(document.byte_size),
              filename: document.source_filename,
              kind: document.source_kind,
              mimeType: document.mime_type,
              sha256: document.content_sha256,
            },
            status: document.status,
            visibilityTier: document.visibility_tier,
          },
          exportedAt: new Date().toISOString(),
          links: links.map((link) => ({
            relationKind: link.relation_kind,
            subjectId: link.subject_id,
            subjectKind: link.subject_kind,
          })),
          schemaVersion,
        });
        await rename(staging, output);
        return { contractVersion, documentId, status: "exported" };
      } catch (error) {
        await rm(staging, { force: true, recursive: true }).catch(() => {});
        throw error;
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const repairLegacyDigests = async (options) => {
  const db = requiredDatabaseUrl(options);
  const storeRoot = resolve(required(options, "store-root", defaultStoreRoot));
  if (required(options, "confirm") !== "repair-schema47-document-digests") {
    throw fail(
      "Digest repair requires --confirm=repair-schema47-document-digests",
    );
  }
  const sql = postgres(db, { max: 1, prepare: true });
  const createdTargets = [];
  const obsoleteSources = [];
  let committed = false;
  try {
    const result = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('cimmich-document-store-quota', 0))`;
      const schemaVersion = await readDatabaseSchemaVersion(tx);
      const rows = await tx`
        SELECT document_id, storage_key, content_sha256, byte_size
        FROM cimmich_document
        WHERE source_kind = 'cimmich_file'
        ORDER BY storage_key, document_id
        FOR UPDATE
      `;
      const grouped = new Map();
      for (const row of rows) {
        const key = `${row.storage_key}\u0000${row.content_sha256}`;
        const existing = grouped.get(key);
        if (existing && Number(existing.byte_size) !== Number(row.byte_size)) {
          throw fail(
            `Documents sharing content disagree on byte size: ${row.storage_key}`,
            "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
          );
        }
        grouped.set(key, {
          ...row,
          document_count: Number(existing?.document_count || 0) + 1,
        });
      }
      const groups = [...grouped.values()];
      const repairs = [];
      for (const group of groups) {
        const source = requireInside(storeRoot, group.storage_key);
        const details = await requireRegularFile(source);
        if (details.size !== Number(group.byte_size)) {
          throw fail(
            `Document byte size mismatch: ${source}`,
            "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
          );
        }
        const bytes = await readFile(source);
        const rawDigest = sha256(bytes);
        const correctStorageKey = `${rawDigest.slice(0, 2)}/${rawDigest}`;
        if (
          rawDigest === group.content_sha256 &&
          group.storage_key === correctStorageKey
        ) {
          continue;
        }
        if (
          legacyBufferDigest(bytes) !== group.content_sha256 ||
          group.storage_key !==
            `${group.content_sha256.slice(0, 2)}/${group.content_sha256}`
        ) {
          throw fail(
            `Document digest is neither raw SHA-256 nor the schema-47 legacy form: ${group.storage_key}`,
            "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
          );
        }
        const destination = requireInside(storeRoot, correctStorageKey);
        if (await exists(destination)) {
          const destinationDetails = await requireRegularFile(destination);
          if (
            destinationDetails.size !== Number(group.byte_size) ||
            sha256(await readFile(destination)) !== rawDigest
          ) {
            throw fail(
              `Existing corrected content failed integrity: ${correctStorageKey}`,
              "DOCUMENT_LIFECYCLE_INTEGRITY_FAILED",
            );
          }
        } else {
          await copyVerified({
            byteSize: Number(group.byte_size),
            destination,
            sha: rawDigest,
            source,
          });
          createdTargets.push(destination);
        }
        repairs.push({
          documentCount: Number(group.document_count),
          newDigest: rawDigest,
          newStorageKey: correctStorageKey,
          oldDigest: group.content_sha256,
          oldStorageKey: group.storage_key,
          source,
        });
      }
      if (!repairs.length) {
        return {
          contractVersion,
          repairedBlobCount: 0,
          repairedDocumentCount: 0,
          schemaVersion,
          status: "no_repair_needed",
        };
      }
      for (const repair of repairs) {
        await tx`
          UPDATE cimmich_document SET
            content_sha256 = ${repair.newDigest},
            storage_key = ${repair.newStorageKey},
            updated_at = now()
          WHERE source_kind = 'cimmich_file'
            AND content_sha256 = ${repair.oldDigest}
            AND storage_key = ${repair.oldStorageKey}
        `;
        obsoleteSources.push(repair.source);
      }
      const repairReceiptId = `document_digest_repair_${randomUUID().replaceAll("-", "")}`;
      const repairedDocumentCount = repairs.reduce(
        (sum, repair) => sum + repair.documentCount,
        0,
      );
      await tx`
        INSERT INTO cimmich_document_digest_repair_receipt (
          repair_receipt_id, prior_token_digest,
          repaired_document_count, repaired_blob_count
        ) VALUES (
          ${repairReceiptId},
          ${sha256(
            Buffer.from(
              repairs
                .map((repair) => repair.oldDigest)
                .sort()
                .join(":"),
            ),
          )},
          ${repairedDocumentCount}, ${repairs.length}
        )
      `;
      return {
        contractVersion,
        repairReceiptId,
        repairedBlobCount: repairs.length,
        repairedDocumentCount,
        schemaVersion,
        status: "repaired",
      };
    });
    committed = true;
    let obsoleteBlobCount = 0;
    for (const source of obsoleteSources) {
      await rm(source, { force: true }).catch(() => {
        obsoleteBlobCount += 1;
      });
    }
    return {
      ...result,
      obsoleteBlobCount,
      ...(obsoleteBlobCount ? { status: "repaired_with_obsolete_blobs" } : {}),
    };
  } catch (error) {
    if (!committed) {
      for (const target of createdTargets.reverse())
        await rm(target, { force: true });
    }
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const purge = async (options) => {
  const db = requiredDatabaseUrl(options);
  const storeRoot = resolve(required(options, "store-root", defaultStoreRoot));
  const documentId = required(options, "document-id");
  if (
    required(options, "confirm") !== documentId ||
    !/^document_[0-9a-f]{32}$/.test(documentId)
  ) {
    throw fail("Purge requires --confirm=<document-id>");
  }
  const sql = postgres(db, { max: 1, prepare: true });
  const quarantined = [];
  let committed = false;
  try {
    const result = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('cimmich-document-store-quota', 0))`;
      const schemaVersion = await readDatabaseSchemaVersion(tx);
      const chainIds = await tx`
        WITH RECURSIVE ancestors AS (
          SELECT document_id, supersedes_document_id
          FROM cimmich_document WHERE document_id = ${documentId}
          UNION ALL
          SELECT parent.document_id, parent.supersedes_document_id
          FROM cimmich_document parent
          JOIN ancestors child ON child.supersedes_document_id = parent.document_id
        ), descendants AS (
          SELECT document_id, supersedes_document_id
          FROM cimmich_document WHERE document_id = ${documentId}
          UNION ALL
          SELECT child.document_id, child.supersedes_document_id
          FROM cimmich_document child
          JOIN descendants parent ON child.supersedes_document_id = parent.document_id
        )
        SELECT DISTINCT document_id FROM (
          SELECT document_id FROM ancestors
          UNION ALL
          SELECT document_id FROM descendants
        ) editions ORDER BY document_id
      `;
      const chain = chainIds.length
        ? await tx`
            SELECT * FROM cimmich_document
            WHERE document_id = ANY(${chainIds.map((row) => row.document_id)})
            ORDER BY created_at, document_id
            FOR UPDATE
          `
        : [];
      if (!chain.length) throw fail("Document not found", "DOCUMENT_NOT_FOUND");
      const ids = chain.map((row) => row.document_id);
      const legacyRows = await tx`
        SELECT adoption_id, legacy_link_id, command_id, decision_id, undo_decision_id
        FROM cimmich_document_legacy_pet_adoption WHERE document_id = ANY(${ids})
      `;
      const genericRows = await tx`
        SELECT command_id, decision_id FROM cimmich_document_command
        WHERE command_id IN (
          SELECT command_id FROM cimmich_document_operation WHERE document_id = ANY(${ids})
        ) OR response_body->>'documentId' = ANY(${ids})
      `;
      const decisionIds = [
        ...new Set(
          [
            ...legacyRows.flatMap((row) => [
              row.decision_id,
              row.undo_decision_id,
            ]),
            ...genericRows.map((row) => row.decision_id),
          ].filter(Boolean),
        ),
      ];
      const [counts] = await tx`
        SELECT
          (SELECT count(*)::int FROM cimmich_document_link
            WHERE document_id = ANY(${ids})) AS links,
          (SELECT count(*)::int FROM cimmich_document_operation
            WHERE document_id = ANY(${ids})) AS operations,
          (SELECT count(*)::int FROM cimmich_document_legacy_pet_adoption
            WHERE document_id = ANY(${ids})) AS legacy_adoptions,
          (SELECT count(*)::int FROM cimmich_visibility_object
            WHERE object_scope = 'document' AND object_id = ANY(${ids})) AS visibility_objects
      `;
      const localFiles = [];
      for (const row of chain.filter(
        (item) => item.source_kind === "cimmich_file",
      )) {
        const [{ count }] = await tx`
          SELECT count(*)::int AS count FROM cimmich_document
          WHERE storage_key = ${row.storage_key} AND document_id <> ALL(${ids})
        `;
        if (
          Number(count) === 0 &&
          !localFiles.some((item) => item.storageKey === row.storage_key)
        ) {
          localFiles.push({
            sha256: row.content_sha256,
            storageKey: row.storage_key,
          });
        }
      }
      for (const file of localFiles) {
        const source = requireInside(storeRoot, file.storageKey);
        if (!(await exists(source))) continue;
        const quarantine = `${source}.purge-${randomUUID()}`;
        await rename(source, quarantine);
        quarantined.push({ quarantine, source });
      }
      await tx`
        UPDATE cimmich_visibility_decision SET
          before_state = coalesce((
            SELECT jsonb_agg(item) FROM jsonb_array_elements(before_state) item
            WHERE NOT (item->>'objectScope' = 'document' AND item->>'objectId' = ANY(${ids}))
          ), '[]'::jsonb),
          after_state = coalesce((
            SELECT jsonb_agg(item) FROM jsonb_array_elements(after_state) item
            WHERE NOT (item->>'objectScope' = 'document' AND item->>'objectId' = ANY(${ids}))
          ), '[]'::jsonb)
        WHERE before_state @? '$[*] ? (@.objectScope == "document")'
           OR after_state @? '$[*] ? (@.objectScope == "document")'
      `;
      await tx`
        UPDATE cimmich_visibility_command SET response_body = jsonb_set(
          response_body, '{objects}', coalesce((
            SELECT jsonb_agg(item) FROM jsonb_array_elements(response_body->'objects') item
            WHERE NOT (item->>'objectScope' = 'document' AND item->>'objectId' = ANY(${ids}))
          ), '[]'::jsonb)
        )
        WHERE response_body ? 'objects'
      `;
      await tx`
        DELETE FROM cimmich_visibility_object
        WHERE object_scope = 'document' AND object_id = ANY(${ids})
      `;
      await tx`DELETE FROM cimmich_document_legacy_pet_adoption WHERE document_id = ANY(${ids})`;
      if (legacyRows.length) {
        await tx`
          DELETE FROM cimmich_document_legacy_pet_command
          WHERE command_id = ANY(${legacyRows.map((row) => row.command_id)})
        `;
      }
      await tx`DELETE FROM cimmich_document_link WHERE document_id = ANY(${ids})`;
      await tx`DELETE FROM cimmich_document_operation WHERE document_id = ANY(${ids})`;
      if (genericRows.length) {
        await tx`
          DELETE FROM cimmich_document_command
          WHERE command_id = ANY(${genericRows.map((row) => row.command_id)})
        `;
      }
      await tx`DELETE FROM cimmich_document WHERE document_id = ANY(${ids})`;
      if (decisionIds.length)
        await tx`DELETE FROM decision WHERE decision_id = ANY(${decisionIds})`;
      const receiptId = `document_purge_${randomUUID().replaceAll("-", "")}`;
      const contentDigest = localFiles.length
        ? sha256(
            Buffer.from(
              localFiles
                .map((item) => item.sha256)
                .sort()
                .join(":"),
            ),
          )
        : null;
      const deletedCounts = {
        decisions: decisionIds.length,
        documents: ids.length,
        genericCommands: genericRows.length,
        legacyPetAdoptions: Number(counts.legacy_adoptions),
        legacyPetCommands: new Set(legacyRows.map((row) => row.command_id))
          .size,
        localContentBlobs: localFiles.length,
        links: Number(counts.links),
        operations: Number(counts.operations),
        visibilityObjects: Number(counts.visibility_objects),
      };
      await tx`
        INSERT INTO cimmich_document_purge_receipt (
          purge_receipt_id, document_token_digest, content_token_digest,
          deleted_counts, content_deleted
        ) VALUES (
          ${receiptId}, ${sha256(Buffer.from(ids.sort().join(":")))},
          ${contentDigest}, ${tx.json(deletedCounts)}, ${localFiles.length > 0}
        )
      `;
      return {
        contractVersion,
        deletedCounts,
        purgeReceiptId: receiptId,
        schemaVersion,
        status: "purged",
      };
    });
    committed = true;
    let quarantinedContentBlobs = 0;
    for (const file of quarantined) {
      await rm(file.quarantine, { force: true }).catch(() => {
        quarantinedContentBlobs += 1;
      });
    }
    if (quarantinedContentBlobs) {
      const updatedCounts = {
        ...result.deletedCounts,
        quarantinedContentBlobs,
      };
      await sql`
        UPDATE cimmich_document_purge_receipt SET
          deleted_counts = ${sql.json(updatedCounts)}, content_deleted = false
        WHERE purge_receipt_id = ${result.purgeReceiptId}
      `;
      return {
        ...result,
        contentDeleted: false,
        deletedCounts: updatedCounts,
        status: "purged_with_retained_quarantine",
      };
    }
    return { ...result, contentDeleted: true };
  } catch (error) {
    if (!committed) {
      for (const file of quarantined.reverse()) {
        if (await exists(file.quarantine))
          await rename(file.quarantine, file.source).catch(() => {});
      }
    }
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const removeEmptyStore = async (options) => {
  const db = requiredDatabaseUrl(options);
  const storeRoot = resolve(required(options, "store-root", defaultStoreRoot));
  if (required(options, "confirm") !== "remove-empty-document-store") {
    throw fail("Removal requires --confirm=remove-empty-document-store");
  }
  const sql = postgres(db, { max: 1, prepare: true });
  try {
    return sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended('cimmich-document-store-quota', 0))`;
      const schemaVersion = await readDatabaseSchemaVersion(tx);
      const [{ count }] = await tx`
        SELECT count(*)::int AS count FROM cimmich_document WHERE source_kind = 'cimmich_file'
      `;
      if (Number(count) !== 0) {
        throw fail(
          "Document store is still referenced",
          "DOCUMENT_LIFECYCLE_TARGET_NOT_EMPTY",
        );
      }
      await rm(storeRoot, { force: true, recursive: true });
      return {
        contractVersion,
        schemaVersion,
        status: "removed_empty_store",
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
};

const { command, options } = parseArguments(process.argv.slice(2));
let result;
if (command === "backup") result = await backup(options);
else if (command === "verify")
  result = await verify(resolve(required(options, "input")));
else if (command === "restore") result = await restore(options);
else if (command === "export") result = await exportDocument(options);
else if (command === "repair-legacy-digests")
  result = await repairLegacyDigests(options);
else if (command === "purge") result = await purge(options);
else if (command === "remove-empty-store")
  result = await removeEmptyStore(options);
else {
  throw fail(
    "Command must be backup, verify, restore, export, repair-legacy-digests, purge or remove-empty-store",
  );
}
process.stdout.write(`${JSON.stringify(result)}\n`);
