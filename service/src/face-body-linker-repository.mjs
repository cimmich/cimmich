import { createHash } from "node:crypto";
import {
  faceBodyLinkPolicyVersion,
  linkFacesToBodies,
} from "./face-body-linker.mjs";

const bodyTagId = (link) =>
  `bodytag_${createHash("sha256")
    .update(
      `${faceBodyLinkPolicyVersion}\u001f${link.bodyId}\u001f${link.faceId}\u001f${link.personId}\u001f${link.identityClaimId}`,
    )
    .digest("hex")
    .slice(0, 32)}`;

export const loadFaceBodyLinkAssets = async (sql, assetId = "") => {
  const faces = await sql`
    SELECT fo.asset_id, fo.face_id, fo.box_x::float8, fo.box_y::float8, fo.box_w::float8, fo.box_h::float8,
      accepted.identity_claim_id, accepted.person_id
    FROM face_observation fo
    JOIN LATERAL (
      SELECT ic.identity_claim_id, ic.person_id
      FROM identity_claim ic
      JOIN current_person person ON person.person_id = ic.person_id
        AND person.status = 'active' AND person.subject_kind = 'person'
      WHERE ic.face_id = fo.face_id AND ic.state = 'accepted'
      ORDER BY ic.created_at DESC, ic.identity_claim_id DESC
      LIMIT 1
    ) accepted ON true
    JOIN asset ON asset.asset_id = fo.asset_id AND asset.state = 'active'
    WHERE fo.state = 'valid' AND (${String(assetId || "")} = '' OR fo.asset_id = ${String(assetId || "")})
      AND NOT EXISTS (
        SELECT 1 FROM current_body_tag tag
        WHERE tag.supporting_face_id = fo.face_id AND tag.state = 'accepted'
      )
    ORDER BY fo.asset_id, fo.face_id
  `;
  const bodies = await sql`
    SELECT bo.asset_id, bo.body_id, bo.box_x::float8, bo.box_y::float8, bo.box_w::float8, bo.box_h::float8,
      bo.head_box_x::float8, bo.head_box_y::float8, bo.head_box_w::float8, bo.head_box_h::float8
    FROM body_observation bo
    JOIN asset ON asset.asset_id = bo.asset_id AND asset.state = 'active'
    WHERE bo.state = 'valid'
      AND (${String(assetId || "")} = '' OR bo.asset_id = ${String(assetId || "")})
      AND NOT EXISTS (
        SELECT 1 FROM current_body_tag tag WHERE tag.body_id = bo.body_id AND tag.state = 'accepted'
      )
    ORDER BY bo.asset_id, bo.body_id
  `;

  const byAsset = new Map();
  for (const row of faces) {
    const asset = byAsset.get(row.asset_id) || {
      assetId: row.asset_id,
      bodies: [],
      faces: [],
    };
    asset.faces.push({
      boxH: row.box_h,
      boxW: row.box_w,
      boxX: row.box_x,
      boxY: row.box_y,
      faceId: row.face_id,
      identityClaimId: row.identity_claim_id,
      personId: row.person_id,
    });
    byAsset.set(row.asset_id, asset);
  }
  for (const row of bodies) {
    const asset = byAsset.get(row.asset_id);
    if (!asset) continue;
    asset.bodies.push({
      bodyId: row.body_id,
      boxH: row.box_h,
      boxW: row.box_w,
      boxX: row.box_x,
      boxY: row.box_y,
      headBox:
        row.head_box_x == null
          ? null
          : {
              boxH: row.head_box_h,
              boxW: row.head_box_w,
              boxX: row.head_box_x,
              boxY: row.head_box_y,
            },
    });
  }
  return [...byAsset.values()].filter(
    (asset) => asset.faces.length > 0 && asset.bodies.length > 0,
  );
};

export const buildFaceBodyLinks = (assets, options = {}) =>
  linkFacesToBodies(assets, options);

export const applyFaceBodyLinks = async (
  sql,
  proposal,
  { execute = false } = {},
) => {
  const summary = {
    accepted: proposal.accepted.length,
    alreadyLinked: 0,
    applied: 0,
    assets: proposal.assets.length,
    abstained: proposal.abstained.length,
    conflicts: 0,
  };
  if (!execute || proposal.accepted.length === 0) return summary;

  const acceptedLinks = [...proposal.accepted].sort((left, right) =>
    [left.bodyId, left.faceId, left.personId, left.identityClaimId]
      .join("\u001f")
      .localeCompare(
        [
          right.bodyId,
          right.faceId,
          right.personId,
          right.identityClaimId,
        ].join("\u001f"),
      ),
  );
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        policy: proposal.policy,
        links: acceptedLinks.map((link) => [
          link.bodyId,
          link.faceId,
          link.personId,
          link.identityClaimId,
          link.confidence,
        ]),
      }),
    )
    .digest("hex");
  const receiptId = `receipt_cimmich_face_body_linker_${digest.slice(0, 24)}`;

  await sql.begin(async (tx) => {
    const now = new Date();
    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, result_digest, privacy_class
      ) VALUES (
        ${receiptId}, 'derived_linkage', 'cimmich-face-body-linker', ${faceBodyLinkPolicyVersion},
        ${now}, ${now}, ${digest}, 'private'
      ) ON CONFLICT (producer_receipt_id) DO NOTHING
    `;

    for (const link of acceptedLinks) {
      const [existing] = await tx`
        SELECT person_id, supporting_face_id
        FROM current_body_tag
        WHERE body_id = ${link.bodyId} AND state = 'accepted'
        LIMIT 1
        FOR UPDATE
      `;
      if (existing) {
        if (
          existing.person_id === link.personId &&
          existing.supporting_face_id === link.faceId
        )
          summary.alreadyLinked += 1;
        else summary.conflicts += 1;
        continue;
      }
      const [faceLink] = await tx`
        SELECT body_id
        FROM current_body_tag
        WHERE supporting_face_id = ${link.faceId} AND state = 'accepted'
        LIMIT 1
        FOR UPDATE
      `;
      if (faceLink) {
        if (faceLink.body_id === link.bodyId) summary.alreadyLinked += 1;
        else summary.conflicts += 1;
        continue;
      }
      const [current] = await tx`
        SELECT claim.identity_claim_id, claim.person_id
        FROM face_observation face
        JOIN body_observation body ON body.asset_id = face.asset_id
        JOIN identity_claim claim ON claim.face_id = face.face_id
          AND claim.state = 'accepted'
        JOIN current_person person ON person.person_id = claim.person_id
          AND person.status = 'active' AND person.subject_kind = 'person'
        WHERE face.face_id = ${link.faceId} AND face.state = 'valid'
          AND body.body_id = ${link.bodyId} AND body.state = 'valid'
          AND claim.identity_claim_id = ${link.identityClaimId} AND claim.person_id = ${link.personId}
        LIMIT 1
      `;
      if (!current) {
        summary.conflicts += 1;
        continue;
      }
      const inserted = await tx`
        INSERT INTO body_tag (
          body_tag_id, person_id, body_id, origin, state, supporting_face_id,
          identity_claim_id, confidence, producer_receipt_id, privacy_class
        ) VALUES (
          ${bodyTagId(link)}, ${link.personId}, ${link.bodyId}, 'face_body_linkage', 'accepted', ${link.faceId},
          ${link.identityClaimId}, ${link.confidence}, ${receiptId}, 'private'
        ) ON CONFLICT (body_tag_id) DO NOTHING
        RETURNING body_tag_id
      `;
      if (inserted.length > 0) summary.applied += 1;
      else summary.alreadyLinked += 1;
    }
  });
  return summary;
};

export { faceBodyLinkPolicyVersion };
