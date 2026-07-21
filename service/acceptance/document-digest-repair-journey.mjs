import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const storeRoot = process.env.CIMMICH_DOCUMENT_STORE_ROOT;
const phase = process.env.CIMMICH_DOCUMENT_DIGEST_REPAIR_PHASE || "corrupt";
const statePath = "/tmp/cimmich-document-acceptance.json";
const repairStatePath = "/tmp/cimmich-document-digest-repair-acceptance.json";
assert.ok(databaseUrl);
assert.ok(storeRoot);

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
const legacyDigest = (bytes) =>
  sha256(Buffer.from(JSON.stringify(legacyCanonical(bytes))));

const sql = postgres(databaseUrl, { max: 1, prepare: true });
try {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  if (phase === "corrupt") {
    const [document] = await sql`
      SELECT storage_key, content_sha256, byte_size
      FROM cimmich_document
      WHERE document_id = ${state.importedDocumentId}
    `;
    assert.ok(document);
    const source = join(storeRoot, document.storage_key);
    const bytes = await readFile(source);
    const rawDigest = sha256(bytes);
    const oldDigest = legacyDigest(bytes);
    assert.equal(document.content_sha256, rawDigest);
    assert.equal(document.storage_key, `${rawDigest.slice(0, 2)}/${rawDigest}`);
    assert.notEqual(oldDigest, rawDigest);
    const oldStorageKey = `${oldDigest.slice(0, 2)}/${oldDigest}`;
    const oldPath = join(storeRoot, oldStorageKey);
    await mkdir(dirname(oldPath), { recursive: true });
    await rename(source, oldPath);
    try {
      const updated = await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended('cimmich-document-store-quota', 0))`;
        return tx`
          UPDATE cimmich_document SET
            content_sha256 = ${oldDigest}, storage_key = ${oldStorageKey}
          WHERE source_kind = 'cimmich_file'
            AND content_sha256 = ${rawDigest}
            AND storage_key = ${document.storage_key}
          RETURNING document_id
        `;
      });
      assert.equal(updated.length, 2);
      await writeFile(
        repairStatePath,
        JSON.stringify({
          byteSize: bytes.length,
          documentCount: updated.length,
          oldDigest,
          oldStorageKey,
          rawDigest,
          rawStorageKey: document.storage_key,
        }),
      );
    } catch (error) {
      await rename(oldPath, source).catch(() => {});
      throw error;
    }
    console.log("Cimmich schema-47 legacy Document digest fixture: READY");
  } else if (phase === "verify") {
    const repair = JSON.parse(await readFile(repairStatePath, "utf8"));
    const documents = await sql`
      SELECT document_id, storage_key, content_sha256, byte_size
      FROM cimmich_document
      WHERE document_id IN (${state.importedDocumentId}, ${state.successorDocumentId})
      ORDER BY document_id
    `;
    assert.equal(documents.length, repair.documentCount);
    for (const document of documents) {
      assert.equal(document.storage_key, repair.rawStorageKey);
      assert.equal(document.content_sha256, repair.rawDigest);
      assert.equal(Number(document.byte_size), repair.byteSize);
    }
    const bytes = await readFile(join(storeRoot, repair.rawStorageKey));
    assert.equal(bytes.length, repair.byteSize);
    assert.equal(sha256(bytes), repair.rawDigest);
    await assert.rejects(stat(join(storeRoot, repair.oldStorageKey)), {
      code: "ENOENT",
    });
    const [receipt] = await sql`
      SELECT repaired_document_count, repaired_blob_count
      FROM cimmich_document_digest_repair_receipt
      ORDER BY completed_at DESC LIMIT 1
    `;
    assert.equal(Number(receipt.repaired_document_count), repair.documentCount);
    assert.equal(Number(receipt.repaired_blob_count), 1);
    console.log("Cimmich schema-47 legacy Document digest repair: PASS");
  } else {
    throw new Error(`Unknown CIMMICH_DOCUMENT_DIGEST_REPAIR_PHASE ${phase}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
