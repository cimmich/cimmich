export const readVisibleCanonicalPhysicalFace = async (
  tx,
  { faceId, presentationRank },
) => {
  const [face] = await tx`
    SELECT canonical.face_id, canonical.asset_id, physical.physical_face_id
    FROM current_face_physical_member physical
    JOIN face_observation canonical
      ON canonical.face_id = physical.canonical_face_id
      AND canonical.state = 'valid'
    WHERE physical.face_id = ${String(faceId || "")}
      AND cimmich_visibility_asset_rank(canonical.asset_id) <= ${presentationRank}
    FOR UPDATE OF canonical
  `;
  return face || null;
};

export const readAcceptedPhysicalFaceClaims = async (tx, physicalFaceId) =>
  tx`
    SELECT accepted.identity_claim_id, accepted.person_id, accepted.face_id
    FROM current_face_physical_member physical
    JOIN identity_claim accepted ON accepted.face_id = physical.face_id
      AND accepted.state = 'accepted'
    WHERE physical.physical_face_id = ${physicalFaceId}
    ORDER BY accepted.created_at DESC, accepted.identity_claim_id DESC
    FOR UPDATE OF accepted
  `;

export const readActivePhysicalFaceMemberships = async (tx, faceIds) =>
  faceIds.length === 0
    ? []
    : tx`
        SELECT bucket_id, face_id
        FROM current_reference_gallery
        WHERE face_id = ANY(${faceIds}) AND membership_state = 'active'
      `;

export const retireAcceptedPhysicalFaceEvidence = async (
  tx,
  { claims, reasonCode, reasonText, userCommandReceiptId },
) => {
  if (claims.length === 0) return;
  const memberships = await readActivePhysicalFaceMemberships(
    tx,
    claims.map((claim) => claim.face_id),
  );
  for (const membership of memberships) {
    await tx`
      INSERT INTO bucket_membership_event (
        membership_event_id, bucket_id, face_id, action, actor_kind,
        reason_code, reason_text, producer_receipt_id, privacy_class
      ) VALUES (
        ${`membership_${randomUUID().replaceAll("-", "")}`},
        ${membership.bucket_id}, ${membership.face_id}, 'remove', 'user',
        ${reasonCode}, ${reasonText}, ${userCommandReceiptId},
        'sensitive-biometric'
      )
    `;
  }
  await tx`
    UPDATE identity_claim SET state = 'superseded'
    WHERE identity_claim_id = ANY(${claims.map((claim) => claim.identity_claim_id)})
      AND state = 'accepted'
  `;
};

export const supersedeOtherPhysicalFaceCandidates = async (
  tx,
  { decisionId, exceptClaimId = null, physicalFaceId },
) => tx`
  UPDATE identity_claim duplicate
  SET state = 'superseded', decision_id = ${decisionId}
  WHERE duplicate.state = 'candidate'
    AND (${exceptClaimId}::text IS NULL
      OR duplicate.identity_claim_id <> ${exceptClaimId})
    AND duplicate.face_id IN (
      SELECT physical.face_id
      FROM current_face_physical_member physical
      WHERE physical.physical_face_id = ${physicalFaceId}
    )
`;
import { randomUUID } from "node:crypto";
