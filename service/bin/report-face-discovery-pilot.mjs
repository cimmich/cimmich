#!/usr/bin/env node

import postgres from "postgres";
import { dedupeAssetFaces } from "../src/repository.mjs";
import { projectAssetFaceBodyLinks } from "../src/face-body-linker.mjs";

const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value || value.startsWith("--")) throw new Error(`Missing --${name}`);
  return value;
};

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("Pilot report requires DATABASE_URL");
const detectorConfigDigest = argument("detector-config-digest");
const auditRunId = argument("audit-run-id");
const sql = postgres(databaseUrl, { max: 4, prepare: true });

try {
  const [faces, bodies, auditItems] = await Promise.all([
    sql`
      WITH pilot_assets AS (
        SELECT DISTINCT result.asset_id
        FROM face_detection_result result
        WHERE result.detector_config_digest = ${detectorConfigDigest}
      )
      SELECT face.asset_id, face.face_id, face.box_x::float8,
        face.box_y::float8, face.box_w::float8, face.box_h::float8,
        face.detection_confidence::float8, accepted.identity_claim_id,
        accepted.person_id,
        (pilot.face_id IS NOT NULL) AS is_pilot_face
      FROM face_observation face
      JOIN pilot_assets ON pilot_assets.asset_id = face.asset_id
      LEFT JOIN LATERAL (
        SELECT claim.identity_claim_id, claim.person_id
        FROM identity_claim claim
        WHERE claim.face_id = face.face_id AND claim.state = 'accepted'
        ORDER BY claim.created_at DESC, claim.identity_claim_id DESC
        LIMIT 1
      ) accepted ON true
      LEFT JOIN (
        SELECT observation.face_id
        FROM face_detection_result result
        JOIN face_detection_result_observation observation
          ON observation.detection_result_id = result.detection_result_id
        WHERE result.detector_config_digest = ${detectorConfigDigest}
      ) pilot ON pilot.face_id = face.face_id
      WHERE face.state = 'valid'
      ORDER BY face.asset_id, face.face_id
    `,
    sql`
      WITH pilot_assets AS (
        SELECT DISTINCT result.asset_id
        FROM face_detection_result result
        WHERE result.detector_config_digest = ${detectorConfigDigest}
      )
      SELECT body.asset_id, body.body_id, body.box_x::float8,
        body.box_y::float8, body.box_w::float8, body.box_h::float8,
        body.head_box_x::float8, body.head_box_y::float8,
        body.head_box_w::float8, body.head_box_h::float8,
        body_tag.supporting_face_id,
        (pose.body_id IS NOT NULL) AS has_pose,
        current_result.detector_config_digest,
        projection.immich_asset_id AS source_asset_id
      FROM body_observation body
      JOIN pilot_assets ON pilot_assets.asset_id = body.asset_id
      LEFT JOIN current_body_detection_result_observation current_result
        ON current_result.body_id = body.body_id
      LEFT JOIN immich_asset_projection projection
        ON projection.cimmich_asset_id = body.asset_id
       AND projection.source_id = 'x1-archive-immich'
       AND projection.state = 'active'
      LEFT JOIN LATERAL (
        SELECT tag.supporting_face_id
        FROM current_body_tag tag
        WHERE tag.body_id = body.body_id AND tag.state = 'accepted'
        ORDER BY tag.created_at DESC, tag.body_tag_id DESC
        LIMIT 1
      ) body_tag ON true
      LEFT JOIN body_pose_evidence pose
        ON pose.body_id = body.body_id AND pose.state = 'valid'
      WHERE body.state = 'valid'
      ORDER BY body.asset_id, body.body_id
    `,
    sql`
      SELECT item.face_id, item.audit_kind, item.review_state,
        item.suggested_person_id, person.display_name AS suggested_person_name,
        item.suggested_score::float8, item.asset_id,
        projection.immich_asset_id AS source_asset_id
      FROM identity_audit_item item
      JOIN person ON person.person_id = item.suggested_person_id
      JOIN face_detection_result_observation observation
        ON observation.face_id = item.face_id
      JOIN face_detection_result result
        ON result.detection_result_id = observation.detection_result_id
       AND result.detector_config_digest = ${detectorConfigDigest}
      LEFT JOIN immich_asset_projection projection
        ON projection.cimmich_asset_id = item.asset_id
       AND projection.source_id = 'x1-archive-immich'
       AND projection.state = 'active'
      WHERE item.audit_run_id = ${auditRunId}
      ORDER BY item.audit_kind, item.face_id
    `,
  ]);

  const facesByAsset = new Map();
  for (const face of faces) {
    const rows = facesByAsset.get(face.asset_id) || [];
    rows.push(face);
    facesByAsset.set(face.asset_id, rows);
  }
  const bodiesByAsset = new Map();
  for (const body of bodies) {
    const rows = bodiesByAsset.get(body.asset_id) || [];
    rows.push(body);
    bodiesByAsset.set(body.asset_id, rows);
  }

  let physicalFacesBefore = 0;
  let physicalFacesAfter = 0;
  const faceToBody = new Map();
  const bodyPose = new Map();
  for (const [assetId, assetFaces] of facesByAsset) {
    const before = dedupeAssetFaces(
      assetFaces.filter((face) => !face.is_pilot_face),
    );
    const after = dedupeAssetFaces(assetFaces);
    physicalFacesBefore += before.length;
    physicalFacesAfter += after.length;
    const projected = projectAssetFaceBodyLinks({
      assetId,
      bodies: (bodiesByAsset.get(assetId) || []).map((body) => ({
        bodyId: body.body_id,
        boxH: body.box_h,
        boxW: body.box_w,
        boxX: body.box_x,
        boxY: body.box_y,
        headBox:
          body.head_box_x == null
            ? null
            : {
                boxH: body.head_box_h,
                boxW: body.head_box_w,
                boxX: body.head_box_x,
                boxY: body.head_box_y,
              },
        supportingFaceId: body.supporting_face_id,
      })),
      faces: after.map((face) => ({
        boxH: face.box_h,
        boxW: face.box_w,
        boxX: face.box_x,
        boxY: face.box_y,
        faceId: face.face_id,
      })),
    });
    for (const body of bodiesByAsset.get(assetId) || []) {
      bodyPose.set(body.body_id, body.has_pose);
    }
    for (const body of projected) {
      if (body.faceLinkId) faceToBody.set(body.faceLinkId, body.bodyId);
    }
  }

  const openItems = auditItems.filter((item) => item.review_state === "open");
  const linkedItems = openItems.filter((item) => faceToBody.has(item.face_id));
  const poseLinkedItems = linkedItems.filter((item) =>
    bodyPose.get(faceToBody.get(item.face_id)),
  );
  const samples = linkedItems
    .map((item) => {
      const bodyId = faceToBody.get(item.face_id);
      return {
        assetId: item.asset_id,
        bodyId,
        faceId: item.face_id,
        hasPose: Boolean(bodyPose.get(bodyId)),
        sourceAssetId: item.source_asset_id,
        suggestedPersonId: item.suggested_person_id,
        suggestedPersonName: item.suggested_person_name,
        suggestedScore: item.suggested_score,
      };
    })
    .sort(
      (left, right) =>
        Number(right.hasPose) - Number(left.hasPose) ||
        right.suggestedScore - left.suggestedScore ||
        left.faceId.localeCompare(right.faceId),
    );
  const targetBodyIds = [
    ...new Set(
      linkedItems
        .map((item) => faceToBody.get(item.face_id))
        .filter((bodyId) => bodyId && !bodyPose.get(bodyId)),
    ),
  ].sort();
  const targetBodyIdSet = new Set(targetBodyIds);
  const targetAssets = [
    ...new Map(
      bodies
        .filter((body) => targetBodyIdSet.has(body.body_id))
        .map((body) => [
          body.asset_id,
          {
            assetId: body.asset_id,
            detectorConfigDigest: body.detector_config_digest || null,
            sourceAssetId: body.source_asset_id || null,
          },
        ]),
    ).values(),
  ].sort((left, right) => left.assetId.localeCompare(right.assetId));

  if (process.argv.includes("--source-assets-only")) {
    process.stdout.write(
      targetAssets
        .map((asset) => asset.sourceAssetId)
        .filter(Boolean)
        .join("\n") + "\n",
    );
  } else {
    process.stdout.write(
      `${JSON.stringify({
        audit: {
          openContradictions: openItems.filter(
            (item) => item.audit_kind === "accepted_contradiction",
          ).length,
          openItems: openItems.length,
          openUntaggedSuggestions: openItems.filter(
            (item) => item.audit_kind === "untagged_match",
          ).length,
          pilotItemsAllStates: auditItems.length,
        },
        geometry: {
          linkedOpenItems: linkedItems.length,
          linkedOpenItemsWithPose: poseLinkedItems.length,
          linkedOpenItemsWithoutPose:
            linkedItems.length - poseLinkedItems.length,
          samples: samples.slice(0, 12),
          targetAssetsWithoutPose: targetAssets,
          targetBodyIdsWithoutPose: targetBodyIds,
        },
        physicalFaces: {
          afterViewerDedupe: physicalFacesAfter,
          beforeViewerDedupe: physicalFacesBefore,
          genuinelyAdded: physicalFacesAfter - physicalFacesBefore,
          rawPilotDetectorFaces: faces.filter((face) => face.is_pilot_face)
            .length,
        },
        schemaVersion: "cimmich.face-discovery-pilot-report.v1",
      })}\n`,
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
