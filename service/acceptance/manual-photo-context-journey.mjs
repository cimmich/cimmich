import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import postgres from "postgres";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_MANUAL_PHOTO_CONTEXT_PHASE || "write";
const statePath = "/tmp/cimmich-manual-photo-context-state.json";
const actor = "synthetic-photo-context-owner";
const deviceId = "synthetic-photo-context-device";
const principalId = "local-primary";
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const request = async (
  path,
  { body, extraHeaders = {}, method = "GET", status = 200 } = {},
) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": actor,
      "x-cimmich-device-id": deviceId,
      "x-cimmich-principal-id": principalId,
      ...extraHeaders,
    },
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, status, JSON.stringify(payload));
  return payload;
};

const privateHeaders = (token) => ({
  "x-cimmich-private-session": token,
  "x-cimmich-surface": "interactive",
});

try {
  if (phase === "write") {
    const [existingProjection] = await sql`
      SELECT immich_asset_id
      FROM immich_asset_projection
      WHERE cimmich_asset_id = 'asset_service_fixture' AND state = 'active'
      LIMIT 1
    `;
    let insertedProjection = false;
    if (!existingProjection) {
      const [run] = await sql`
        SELECT run_id FROM immich_inventory_run
        WHERE source_id = 'synthetic-immich-primary' AND state = 'completed'
        ORDER BY completed_at DESC, run_id DESC LIMIT 1
      `;
      assert.ok(run);
      await sql`
        INSERT INTO immich_asset_projection (
          source_id, immich_asset_id, cimmich_asset_id, owner_digest,
          input_revision, checksum, asset_type, visibility, original_mime_type,
          capture_time, source_updated_at, width, height, duration_seconds,
          is_archived, is_favorite, is_offline, is_trashed, state,
          first_seen_run_id, last_seen_run_id, original_file_name
        )
        SELECT 'synthetic-immich-primary',
          '55555555-5555-4555-8555-555555555555', asset.asset_id,
          ${"a".repeat(64)}, ${"b".repeat(64)}, 'manual-context-checksum',
          'image', 'timeline', asset.mime_type, asset.capture_time, now(),
          asset.width, asset.height, asset.duration_seconds,
          false, false, false, false, 'active', ${run.run_id}, ${run.run_id},
          'manual-photo-context.jpg'
        FROM asset WHERE asset.asset_id = 'asset_service_fixture'
      `;
      insertedProjection = true;
    }
    const [projection] = await sql`
      SELECT immich_asset_id FROM immich_asset_projection
      WHERE cimmich_asset_id = 'asset_service_fixture' AND state = 'active'
      LIMIT 1
    `;
    assert.ok(projection);
    const sourceAssetId = projection.immich_asset_id;
    const objects = await request(
      `/v1/objects?q=${encodeURIComponent("Synthetic blue roadster")}`,
    );
    const object = objects.items.find(
      (item) => item.displayName === "Synthetic blue roadster",
    );
    assert.ok(object);

    const attachBody = {
      commandId: "manual-context.object.attach-001",
      entityId: object.entityId,
      region: { h: 0.42, w: 0.48, x: 0.2, y: 0.31 },
    };
    const attached = await request(
      `/v1/assets/${sourceAssetId}/manual-context-tags`,
      { body: attachBody, method: "POST" },
    );
    assert.equal(attached.schemaVersion, "cimmich.manual-object-region.v1");
    assert.equal(attached.changed, true);
    assert.equal(attached.tag.entityId, object.entityId);
    assert.deepEqual(attached.tag.region, attachBody.region);
    const replay = await request(
      `/v1/assets/${sourceAssetId}/manual-context-tags`,
      { body: attachBody, method: "POST" },
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.tag.tagId, attached.tag.tagId);
    assert.equal(
      (
        await request(`/v1/assets/${sourceAssetId}/manual-context-tags`, {
          body: {
            ...attachBody,
            region: { h: 0.42, w: 0.47, x: 0.2, y: 0.31 },
          },
          method: "POST",
          status: 409,
        })
      ).code,
      "MANUAL_PHOTO_CONTEXT_COMMAND_CONFLICT",
    );
    const noChange = await request(
      `/v1/assets/${sourceAssetId}/manual-context-tags`,
      {
        body: {
          ...attachBody,
          commandId: "manual-context.object.nochange-001",
        },
        method: "POST",
      },
    );
    assert.equal(noChange.changed, false);
    assert.equal(noChange.decisionId, null);

    const replaced = await request(
      `/v1/manual-context-tags/${attached.tag.tagId}/replace`,
      {
        body: {
          commandId: "manual-context.object.replace-001",
          entityId: object.entityId,
          expectedDecisionId: attached.decisionId,
          region: { h: 0.4, w: 0.5, x: 0.18, y: 0.32 },
        },
        method: "POST",
      },
    );
    const replaceUndone = await request(
      `/v1/manual-photo-context/decisions/${replaced.decisionId}/undo`,
      {
        body: { commandId: "manual-context.object.replace-undo-001" },
        method: "POST",
      },
    );
    assert.equal(replaceUndone.thingRegions[0].tagId, attached.tag.tagId);
    assert.equal(
      (
        await request(`/v1/manual-context-tags/${attached.tag.tagId}/replace`, {
          body: {
            commandId: "manual-context.object.replace-stale-001",
            entityId: object.entityId,
            expectedDecisionId: attached.decisionId,
            region: { h: 0.4, w: 0.5, x: 0.18, y: 0.32 },
          },
          method: "POST",
          status: 409,
        })
      ).code,
      "MANUAL_OBJECT_REGION_STALE",
    );
    const rejected = await request(
      `/v1/manual-context-tags/${attached.tag.tagId}/reject`,
      {
        body: {
          commandId: "manual-context.object.reject-001",
          expectedDecisionId: replaceUndone.decisionId,
        },
        method: "POST",
      },
    );
    const rejectUndone = await request(
      `/v1/manual-photo-context/decisions/${rejected.decisionId}/undo`,
      {
        body: { commandId: "manual-context.object.reject-undo-001" },
        method: "POST",
      },
    );
    assert.equal(rejectUndone.thingRegions.length, 1);

    const firstSummary = await request(
      `/v1/assets/${sourceAssetId}/owner-summary`,
      {
        body: {
          commandId: "manual-context.summary.first-0001",
          expectedRevision: 0,
          summaryText: "Temporary first owner summary.",
        },
        method: "POST",
      },
    );
    const firstSummaryUndone = await request(
      `/v1/manual-photo-context/decisions/${firstSummary.decisionId}/undo`,
      {
        body: { commandId: "manual-context.summary.first-undo-0001" },
        method: "POST",
      },
    );
    assert.equal(firstSummaryUndone.ownerSummary.revision, 0);
    assert.equal(firstSummaryUndone.ownerSummary.summaryText, null);

    const summarySet = await request(
      `/v1/assets/${sourceAssetId}/owner-summary`,
      {
        body: {
          commandId: "manual-context.summary.set-0001",
          expectedRevision: 0,
          summaryText: "Owner-authored synthetic roadster memory.",
        },
        method: "POST",
      },
    );
    assert.equal(summarySet.summary.provenance, "manual_user");
    assert.equal(
      (
        await request(`/v1/assets/${sourceAssetId}/owner-summary`, {
          body: {
            commandId: "manual-context.summary.set-0001",
            expectedRevision: 0,
            summaryText: "Conflicting summary payload.",
          },
          method: "POST",
          status: 409,
        })
      ).code,
      "MANUAL_PHOTO_CONTEXT_COMMAND_CONFLICT",
    );
    assert.equal(
      (
        await request(`/v1/assets/${sourceAssetId}/owner-summary`, {
          body: {
            commandId: "manual-context.summary.stale-0001",
            expectedRevision: 0,
            summaryText: "Stale summary payload.",
          },
          method: "POST",
          status: 409,
        })
      ).code,
      "ASSET_OWNER_SUMMARY_STALE",
    );
    const summaryChanged = await request(
      `/v1/assets/${sourceAssetId}/owner-summary`,
      {
        body: {
          commandId: "manual-context.summary.set-0002",
          expectedRevision: 2,
          summaryText: "Temporary revised owner summary.",
        },
        method: "POST",
      },
    );
    const summaryUndone = await request(
      `/v1/manual-photo-context/decisions/${summaryChanged.decisionId}/undo`,
      {
        body: { commandId: "manual-context.summary.undo-0001" },
        method: "POST",
      },
    );
    assert.equal(
      summaryUndone.ownerSummary.summaryText,
      "Owner-authored synthetic roadster memory.",
    );

    const unlocked = await request("/v1/visibility/unlock", {
      body: { password: "1" },
      method: "POST",
    });
    const token = unlocked.privateSessionToken;
    const privacy = await request(
      `/v1/visibility/objects/context_entity/${object.entityId}`,
      {
        body: {
          commandId: "manual-context.object.private-001",
          visibilityTier: "private",
        },
        extraHeaders: privateHeaders(token),
        method: "PATCH",
      },
    );
    await request("/v1/visibility/mode", {
      body: { viewingMode: "standard" },
      extraHeaders: privateHeaders(token),
      method: "POST",
    });
    const hiddenEvidence = await request(
      `/v1/assets/evidence?sourceAssetId=${sourceAssetId}`,
    );
    assert.equal(hiddenEvidence.thingRegions.length, 0);
    assert.equal(
      hiddenEvidence.contexts.some(
        (item) => item.entity_id === object.entityId,
      ),
      false,
    );
    await request("/v1/visibility/mode", {
      body: { viewingMode: "private" },
      extraHeaders: privateHeaders(token),
      method: "POST",
    });
    assert.equal(
      (
        await request(`/v1/assets/evidence?sourceAssetId=${sourceAssetId}`, {
          extraHeaders: privateHeaders(token),
        })
      ).thingRegions.length,
      1,
    );
    await request(`/v1/visibility/decisions/${privacy.decisionId}/undo`, {
      body: { commandId: "manual-context.object.private-undo-001" },
      extraHeaders: privateHeaders(token),
      method: "POST",
    });
    await request("/v1/visibility/mode", {
      body: { viewingMode: "standard" },
      extraHeaders: privateHeaders(token),
      method: "POST",
    });

    await writeFile(
      statePath,
      JSON.stringify({
        attachCommand: attachBody,
        insertedProjection,
        objectId: object.entityId,
        sourceAssetId,
        tagId: attached.tag.tagId,
      }),
      { mode: 0o600 },
    );
    process.stdout.write(
      "Cimmich manual photo Context journey (write): PASS\n",
    );
  } else {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const evidence = await request(
      `/v1/assets/evidence?sourceAssetId=${state.sourceAssetId}`,
    );
    assert.equal(evidence.schemaVersion, "cimmich.asset-detailed-evidence.v3");
    assert.equal(evidence.ownerSummary.provenance, "manual_user");
    assert.equal(
      evidence.ownerSummary.summaryText,
      "Owner-authored synthetic roadster memory.",
    );
    assert.equal(evidence.thingRegions.length, 1);
    assert.equal(evidence.thingRegions[0].entityId, state.objectId);
    assert.equal(evidence.thingRegions[0].tagId, state.tagId);
    const replay = await request(
      `/v1/assets/${state.sourceAssetId}/manual-context-tags`,
      { body: state.attachCommand, method: "POST" },
    );
    assert.equal(replay.replayed, true);
    if (state.insertedProjection) {
      await sql`
        DELETE FROM immich_asset_projection
        WHERE cimmich_asset_id = 'asset_service_fixture'
          AND immich_asset_id = ${state.sourceAssetId}
      `;
    }
    await unlink(statePath);
    process.stdout.write(
      "Cimmich manual photo Context journey (restart/readback): PASS\n",
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
