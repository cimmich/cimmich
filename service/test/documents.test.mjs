import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentStore, projectDocumentRow } from "../src/documents.mjs";

const row = {
  byte_size: null,
  content_sha256: null,
  display_title: "Bluewater Weekend itinerary",
  document_id: "document_00000000000000000000000000000001",
  document_kind: "booking",
  document_label: null,
  effective_visibility_rank: 0,
  expires_on: null,
  immich_asset_id: "33333333-3333-4333-8333-333333333333",
  issued_on: "2024-02-01",
  mime_type: "image/png",
  revision: 1,
  source_asset_id: "asset_demo_cha_046",
  source_content_hash: "f".repeat(64),
  source_filename: "CHA-046.png",
  source_kind: "immich_asset",
  status: "active",
  subject_count: 2,
  superseded_by_document_id: null,
  supersedes_document_id: null,
  updated_at: "2026-07-19T00:00:00.000Z",
  visibility_tier: "standard",
};

test("Immich-backed Document projection exposes the current Immich UUID and preserves its stable Cimmich ID", () => {
  const document = projectDocumentRow(row);
  assert.deepEqual(document.source, {
    assetId: "33333333-3333-4333-8333-333333333333",
    byteSize: null,
    cimmichAssetId: "asset_demo_cha_046",
    contentSha256: null,
    filename: "CHA-046.png",
    kind: "immich_asset",
    mimeType: "image/png",
    sourceContentHash: "f".repeat(64),
  });
  assert.deepEqual(document.preview, {
    available: true,
    disposition: "immich",
    mimeType: "image/png",
  });
});

test("local Document projection never invents an Immich UUID", () => {
  const document = projectDocumentRow({
    ...row,
    immich_asset_id: null,
    source_asset_id: null,
    source_kind: "cimmich_file",
  });
  assert.equal(document.source.assetId, null);
  assert.equal(document.source.cimmichAssetId, null);
});

test("Document collection counts admit Person, Pet and context links through the current visibility rank", async () => {
  const statements = [];
  const sql = async (strings) => {
    statements.push(strings.join("?"));
    return [];
  };
  const store = createDocumentStore(sql, { presentationRank: () => 0 });
  await store.list({ limit: 20 });
  assert.equal(statements.length, 1);
  assert.match(
    statements[0],
    /link\.subject_kind NOT IN \('person','pet'\)[\s\S]*cimmich_visibility_subject_rank\([\s\S]*link\.subject_kind,[\s\S]*link\.subject_id/,
  );
  assert.match(
    statements[0],
    /link\.subject_kind NOT IN \('place','object','event'\)[\s\S]*cimmich_visibility_context_entity_rank\(link\.subject_id\)/,
  );
});
