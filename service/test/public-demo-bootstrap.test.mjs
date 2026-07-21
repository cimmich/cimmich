import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPublicDemoPlan,
  digest,
  parseCsv,
  publicDemoGpsForAsset,
  publicDemoImmichMapSchemaVersion,
  publicDemoSeedSchemaVersion,
} from "../src/public-demo-bootstrap.mjs";
import {
  IMMICH_READ_ONLY_COMPANION_PERMISSIONS,
  isExactImmichReadOnlyCompanionPermissionSet,
} from "../src/immich-companion-permissions.mjs";

const serviceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const archiveRoot =
  process.env.CIMMICH_DEMO_ARCHIVE_ROOT ||
  path.resolve(serviceRoot, "../demo/cedar-house-v1");
const manifestCsv = await readFile(
  path.join(archiveRoot, "provenance", "manifest.csv"),
  "utf8",
);
const shotLedgerCsv = await readFile(
  path.join(archiveRoot, "shot-ledger.csv"),
  "utf8",
);
const rightsSources = await Promise.all(
  ["LICENSE.md", "NOTICE.md", "ATTRIBUTION.md"].map(
    async (filename) =>
      `${filename}\u001f${await readFile(path.join(archiveRoot, filename), "utf8")}`,
  ),
);
const manifestRows = parseCsv(manifestCsv);

const mapFixture = () => ({
  archiveDigest: digest(
    [manifestCsv, shotLedgerCsv, ...rightsSources].join("\u001e"),
  ),
  assets: manifestRows.map((row, index) => ({
    assetId: row.asset_id,
    checksum: row.sha256,
    height: Number.parseInt(row.height, 10),
    immichAssetId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    inputRevision: digest(`revision:${row.sha256}`),
    sourceUpdatedAt: "2026-07-19T00:00:00.000Z",
    width: Number.parseInt(row.width, 10),
  })),
  generatedAt: "2026-07-19T00:00:00.000Z",
  immichVersion: "3.0.3",
  principalDigest: digest("cedar-house-demo-principal"),
  schemaVersion: publicDemoImmichMapSchemaVersion,
  source: "immich_api_upload",
});

test("CSV parser preserves quoted Cedar House manifest fields", () => {
  assert.equal(manifestRows.length, 51);
  assert.equal(manifestRows[0].asset_id, "CHA-001");
  assert.equal(manifestRows[50].asset_id, "CHA-051");
  assert.match(manifestRows[0].material_edits, /byte-for-byte/);
});

test("Cedar House coast and birthday scenes retain their corrected semantic bindings", () => {
  const bluewater = manifestRows.find((row) => row.asset_id === "CHA-030");
  const birthday = manifestRows.find((row) => row.asset_id === "CHA-031");
  assert.deepEqual(
    {
      chapter: bluewater.chapter,
      contexts: bluewater.contexts,
      filename: bluewater.filename,
      sha256: bluewater.sha256,
      subjects: bluewater.subjects,
    },
    {
      chapter: "bluewater",
      contexts: "Bluewater Beach;Bluewater Weekend",
      filename: "CHA-030-bluewater-overlook.png",
      sha256:
        "aa18c6a5c4c9af6449db5e736f79542b3b9cb12a533fd395e0fe09fa1097e49e",
      subjects: "Maya;Alex;Eli;Juniper",
    },
  );
  assert.deepEqual(
    {
      chapter: birthday.chapter,
      contexts: birthday.contexts,
      filename: birthday.filename,
      sha256: birthday.sha256,
      subjects: birthday.subjects,
    },
    {
      chapter: "birthday",
      contexts: "Star Quilt;Nora's 70th Birthday",
      filename: "CHA-031-setting-birthday-table.png",
      sha256:
        "6eacf4a6c49dd779953cee8c604efac1c7585a0fe996ed093a3e8aa9a8fa35e4",
      subjects: "Maya;Samira",
    },
  );
});

test("Cedar House departure and tide-pool scenes retain cast-sheet truth", () => {
  const departure = manifestRows.find((row) => row.asset_id === "CHA-021");
  const tidePool = manifestRows.find((row) => row.asset_id === "CHA-029");
  assert.equal(departure.subjects, "Samira;Alex;Eli");
  assert.equal(
    departure.sha256,
    "0727f82a36328ae2d6803394cd317eb04c946477ed6cf4bcbab501bcc599235b",
  );
  assert.equal(tidePool.subjects, "Nora;Samira;Eli");
  assert.equal(
    tidePool.sha256,
    "f650f6361e84b764a82887aa6ccb6b98271e5a21fc0fcdd42b58d2b59df1bc75",
  );
});

test("public demo GPS is deterministic, fictional and absent from Document artwork", () => {
  assert.deepEqual(publicDemoGpsForAsset("CHA-001"), {
    latitude: -33.85912,
    longitude: 151.1995,
  });
  assert.notDeepEqual(
    publicDemoGpsForAsset("CHA-021"),
    publicDemoGpsForAsset("CHA-039"),
  );
  assert.deepEqual(publicDemoGpsForAsset("CHA-004"), {
    latitude: -33.83878,
    longitude: 151.228,
  });
  assert.equal(publicDemoGpsForAsset("CHA-046"), null);
  assert.equal(publicDemoGpsForAsset("CHA-050"), null);
  assert.deepEqual(publicDemoGpsForAsset("CHA-051"), {
    latitude: -33.55022,
    longitude: 151.31375,
  });
  assert.equal(
    manifestRows.filter((row) => publicDemoGpsForAsset(row.asset_id)).length,
    46,
  );
});

test("public demo plan binds exactly 51 accepted assets and all product sections", () => {
  const plan = buildPublicDemoPlan({
    immichMap: mapFixture(),
    manifestCsv,
    shotLedgerCsv,
  });
  assert.equal(plan.schemaVersion, publicDemoSeedSchemaVersion);
  assert.equal(plan.assets.length, 51);
  assert.equal(plan.people.length, 8);
  assert.deepEqual(
    plan.people.map((person) => person.subjectKind),
    ["person", "person", "person", "person", "person", "person", "pet", "pet"],
  );
  assert.equal(plan.contexts.length, 12);
  assert.equal(plan.documents.length, 5);
  assert.deepEqual(
    plan.manualTags.map((tag) => tag.tagType),
    ["face", "head", "body", "presence"],
  );
  assert.equal(
    plan.assets.filter((asset) => asset.visibility === "private").length,
    1,
  );
  assert.ok(plan.assets.some((asset) => asset.visibility === "personal"));
  assert.match(plan.seedDigest, /^[0-9a-f]{64}$/);
});

test("public demo plan fails closed on rights, mapping and archive drift", () => {
  const wrongSource = mapFixture();
  wrongSource.source = "caller_asserted";
  assert.throws(
    () =>
      buildPublicDemoPlan({
        immichMap: wrongSource,
        manifestCsv,
        shotLedgerCsv,
      }),
    (error) => error.code === "PUBLIC_DEMO_INPUT_INVALID",
  );

  const wrongChecksum = mapFixture();
  wrongChecksum.assets[0].checksum = digest("wrong");
  assert.throws(
    () =>
      buildPublicDemoPlan({
        immichMap: wrongChecksum,
        manifestCsv,
        shotLedgerCsv,
      }),
    /checksum does not match/,
  );

  const unsafeManifest = manifestCsv.replace(
    '"true","anchors"',
    '"false","anchors"',
  );
  assert.throws(
    () =>
      buildPublicDemoPlan({
        immichMap: mapFixture(),
        manifestCsv: unsafeManifest,
        shotLedgerCsv,
      }),
    /not accepted synthetic media/,
  );

  const extraField = mapFixture();
  extraField.privatePath = "/private/archive";
  assert.throws(
    () =>
      buildPublicDemoPlan({
        immichMap: extraField,
        manifestCsv,
        shotLedgerCsv,
      }),
    /unsupported fields/,
  );
});

test("demo tooling contains no workspace-specific default outside its test fixture", async () => {
  const source = await readFile(
    path.join(serviceRoot, "bin", "bootstrap-public-demo.mjs"),
    "utf8",
  );
  const immichSource = await readFile(
    path.join(serviceRoot, "bin", "bootstrap-public-demo-immich.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /\/Users\/mb|Benji|RUI\/Core/);
  assert.doesNotMatch(immichSource, /\/Users\/mb|Benji|RUI\/Core/);
  assert.doesNotMatch(source, /requires schema \d+/);
  assert.match(source, /loadMigrations/);
  assert.match(source, /filenameAuthority: "canonical_source"/);
});

test("public demo stop and restart preserve state while destruction is explicit", async () => {
  const source = await readFile(
    path.resolve(serviceRoot, "../tools/public_demo.sh"),
    "utf8",
  );
  const acceptance = await readFile(
    path.resolve(serviceRoot, "../tools/public_demo_acceptance.sh"),
    "utf8",
  );
  assert.match(source, /stop_exact\(\)/);
  assert.match(source, /compose stop/);
  assert.match(source, /down_exact\(\)/);
  assert.match(source, /compose down --remove-orphans/);
  assert.match(source, /"dataPreserved":true/);
  assert.match(source, /restart\)/);
  assert.match(source, /destroy\)/);
  assert.match(source, /compose down --volumes --remove-orphans/);
  assert.match(source, /preflight_backup_databases/);
  assert.match(
    source,
    /backup schema manifest does not match its database ledger/,
  );
  assert.match(
    source,
    /backup database semantic counts do not match its manifest/,
  );
  assert.match(source, /backup checksum manifest is invalid/);
  assert.match(source, /BACKUP_SCHEMA_VERSION/);
  assert.match(source, /backup schema is newer than this Cimmich build/);
  assert.match(acceptance, /run_demo stop/);
  assert.match(acceptance, /run_demo restart/);
  assert.match(acceptance, /run_demo down/);
  assert.match(acceptance, /operator_lifecycle_marker/);
  assert.match(acceptance, /schema_version=74/);
  assert.match(acceptance, /backupSchemaVersion.*74/);
  assert.match(acceptance, /corrupt-database/);
  assert.match(acceptance, /semantic-count-drift/);
  assert.match(acceptance, /stopStartPreservesState/);
  assert.match(acceptance, /run_demo destroy "--confirm=\$PROJECT"/);
});

test("all bootstrap and refresh operators consume one exact read-only companion permission set", async () => {
  assert.deepEqual(IMMICH_READ_ONLY_COMPANION_PERMISSIONS, [
    "asset.read",
    "asset.download",
    "face.read",
    "person.read",
    "user.read",
  ]);
  assert.equal(
    isExactImmichReadOnlyCompanionPermissionSet(
      IMMICH_READ_ONLY_COMPANION_PERMISSIONS,
    ),
    true,
  );
  assert.equal(
    IMMICH_READ_ONLY_COMPANION_PERMISSIONS.some((permission) =>
      permission.endsWith(".write"),
    ),
    false,
  );
  const sources = await Promise.all(
    [
      "bin/bootstrap-public-demo-immich.mjs",
      "bin/refresh-public-demo-immich-companion.mjs",
      "acceptance/bootstrap-stock-immich.mjs",
    ].map((filename) => readFile(path.join(serviceRoot, filename), "utf8")),
  );
  for (const source of sources) {
    assert.match(source, /IMMICH_READ_ONLY_COMPANION_PERMISSIONS/);
    assert.doesNotMatch(source, /permissions:\s*\[\s*["']asset\.read["']/);
  }
});
