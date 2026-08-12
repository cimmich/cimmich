import { randomUUID } from "node:crypto";

import { retireAcceptedPhysicalFaceEvidence } from "./physical-face-repository.mjs";

const staleSelection = (claimId = null) =>
  Object.assign(
    new Error("Candidate selection is stale; refresh and try again"),
    {
      details: claimId ? { claimId } : undefined,
      statusCode: 409,
    },
  );

export const createBulkPersonCandidateAcceptor = ({
  cleanActor,
  deferPrimeAfterCommand,
  ensureUserCommandReceipt,
  invalidateMachineSuggestions,
  sql,
  userCommandReceiptId,
}) =>
  async function bulkAcceptPersonCandidates({ actorId, claimIds, personId }) {
    const actor = cleanActor(actorId);
    if (!actor)
      throw Object.assign(new Error("Missing Cimmich actor"), {
        statusCode: 400,
      });
    if (!Array.isArray(claimIds)) {
      throw Object.assign(new Error("claimIds must be an array"), {
        statusCode: 400,
      });
    }
    const selectedIds = [
      ...new Set(
        claimIds.map((value) => String(value || "").trim()).filter(Boolean),
      ),
    ];
    if (selectedIds.length === 0) {
      throw Object.assign(new Error("Select at least one candidate"), {
        statusCode: 400,
      });
    }
    if (selectedIds.length > 100) {
      throw Object.assign(
        new Error("Accept no more than 100 candidates at once"),
        { statusCode: 400 },
      );
    }

    const result = await sql
      .begin(async (tx) => {
        const [target] = await tx`
          SELECT person_id, display_name
          FROM person
          WHERE person_id = ${String(personId || "")}
            AND status = 'active' AND subject_kind = 'person'
          FOR UPDATE
        `;
        if (!target)
          throw Object.assign(new Error("Active Person not found"), {
            statusCode: 404,
          });
        await ensureUserCommandReceipt(tx);

        const selectedClaims = await tx`
          SELECT claim.identity_claim_id, claim.face_id, claim.person_id,
            claim.state, claim.evidence_refs, physical.physical_face_id
          FROM identity_claim claim
          JOIN current_face_physical_member physical
            ON physical.face_id = claim.face_id
          LEFT JOIN source_pack pack
            ON pack.pack_id = claim.evidence_refs->>'source_pack_id'
            AND pack.state = 'active'
            AND pack.evaluation_status = 'passed'
            AND pack.evaluation_summary->'matcherPolicy'->>'policyVersion' =
              claim.evidence_refs->>'policy_version'
          JOIN face_observation face ON face.face_id = claim.face_id
            AND face.state = 'valid'
            AND cimmich_face_match_eligible(
              face.detection_confidence, face.box_w, face.box_h
            )
          WHERE claim.identity_claim_id = ANY(${selectedIds})
            AND cimmich_person_candidate_reviewable(
              claim.origin, claim.evidence_refs, pack.pack_id
            )
          ORDER BY claim.identity_claim_id
          FOR UPDATE OF claim
        `;
        const selectedClaimById = new Map(
          selectedClaims.map((claim) => [claim.identity_claim_id, claim]),
        );
        const claims = [];
        const physicalFaceIds = new Set();
        for (const claimId of selectedIds) {
          const claim = selectedClaimById.get(claimId);
          if (
            !claim ||
            claim.person_id !== target.person_id ||
            claim.state !== "candidate"
          ) {
            throw staleSelection(claimId);
          }
          if (physicalFaceIds.has(claim.physical_face_id)) {
            throw Object.assign(
              new Error(
                "Selection contains more than one candidate for the same face",
              ),
              {
                details: { faceId: claim.face_id },
                statusCode: 409,
              },
            );
          }
          physicalFaceIds.add(claim.physical_face_id);
          claims.push(claim);
        }

        const currentClaims = await tx`
          SELECT physical.physical_face_id, accepted.identity_claim_id,
            accepted.person_id, accepted.face_id
          FROM current_face_physical_member physical
          JOIN identity_claim accepted ON accepted.face_id = physical.face_id
            AND accepted.state = 'accepted'
          WHERE physical.physical_face_id = ANY(${[...physicalFaceIds]})
          ORDER BY physical.physical_face_id, accepted.created_at DESC,
            accepted.identity_claim_id DESC
          FOR UPDATE OF accepted
        `;
        const currentClaimsByPhysicalFace = new Map();
        for (const acceptedClaim of currentClaims) {
          const physicalClaims =
            currentClaimsByPhysicalFace.get(acceptedClaim.physical_face_id) ||
            [];
          physicalClaims.push(acceptedClaim);
          currentClaimsByPhysicalFace.set(
            acceptedClaim.physical_face_id,
            physicalClaims,
          );
        }

        const affectedPersonIds = new Set([target.person_id]);
        const accepted = [];
        for (const claim of claims) {
          const acceptedPhysicalClaims =
            currentClaimsByPhysicalFace.get(claim.physical_face_id) || [];
          const current = acceptedPhysicalClaims[0] || null;
          if (current?.person_id === target.person_id) {
            throw Object.assign(
              new Error(
                "Candidate selection is stale; this face is already accepted for the Person",
              ),
              {
                details: {
                  claimId: claim.identity_claim_id,
                  faceId: claim.face_id,
                },
                statusCode: 409,
              },
            );
          }
          acceptedPhysicalClaims.forEach((acceptedClaim) =>
            affectedPersonIds.add(acceptedClaim.person_id),
          );
          accepted.push({
            claimId: claim.identity_claim_id,
            decisionId: `decision_${randomUUID().replaceAll("-", "")}`,
            faceId: claim.face_id,
            physicalFaceId: claim.physical_face_id,
            previousClaimId: current?.identity_claim_id || "",
            previousPersonId: current?.person_id || null,
          });
        }

        await retireAcceptedPhysicalFaceEvidence(tx, {
          claims: currentClaims,
          reasonCode: "candidate_bulk_reassignment",
          reasonText: "Removed after accepting a candidate for another Person",
          userCommandReceiptId,
        });

        await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, producer_receipt_id, privacy_class
          )
          SELECT batch.decision_id, 'identity_claim', batch.claim_id, 'accept',
            'user', ${actor}, 'person_candidate_bulk_accept',
            ${`Accepted from ranked candidates for ${target.display_name}`},
            ${userCommandReceiptId}, 'sensitive-biometric'
          FROM unnest(
            ${accepted.map((item) => item.decisionId)}::text[],
            ${accepted.map((item) => item.claimId)}::text[]
          ) AS batch(decision_id, claim_id)
        `;

        await tx`
          WITH selected AS (
            SELECT * FROM unnest(
              ${accepted.map((item) => item.physicalFaceId)}::text[],
              ${accepted.map((item) => item.decisionId)}::text[],
              ${accepted.map((item) => item.claimId)}::text[]
            ) AS batch(physical_face_id, decision_id, except_claim_id)
          )
          UPDATE identity_claim duplicate
          SET state = 'superseded', decision_id = selected.decision_id
          FROM current_face_physical_member physical, selected
          WHERE duplicate.state = 'candidate'
            AND duplicate.identity_claim_id <> selected.except_claim_id
            AND duplicate.face_id = physical.face_id
            AND physical.physical_face_id = selected.physical_face_id
        `;

        const updatedClaims = await tx`
          WITH selected AS (
            SELECT * FROM unnest(
              ${accepted.map((item) => item.claimId)}::text[],
              ${accepted.map((item) => item.decisionId)}::text[],
              ${accepted.map((item) => item.previousClaimId)}::text[]
            ) AS batch(claim_id, decision_id, previous_claim_id)
          )
          UPDATE identity_claim claim
          SET state = 'accepted', decision_id = selected.decision_id,
            supersedes_claim_id = coalesce(
              nullif(selected.previous_claim_id, ''),
              claim.supersedes_claim_id
            )
          FROM selected
          WHERE claim.identity_claim_id = selected.claim_id
            AND claim.state = 'candidate'
          RETURNING claim.identity_claim_id
        `;
        if (updatedClaims.length !== accepted.length) {
          const updatedIds = new Set(
            updatedClaims.map((claim) => claim.identity_claim_id),
          );
          throw staleSelection(
            accepted.find((claim) => !updatedIds.has(claim.claimId))?.claimId,
          );
        }

        return {
          accepted: accepted.map(
            ({
              physicalFaceId: _physicalFaceId,
              previousClaimId: _previousClaimId,
              ...item
            }) => item,
          ),
          affectedPersonIds: [...affectedPersonIds],
          changed: true,
          personId: target.person_id,
        };
      })
      .catch((error) => {
        // A concurrent accept outside this selection can win a Face after the
        // claim locks are taken. Treat the unique-index loser as stale input.
        if (error?.code !== "23505") throw error;
        throw staleSelection();
      });

    // The identity transaction is durable. Prime maintenance stays detached so
    // a committed owner action cannot become a false interactive failure.
    const maintenancePending = result.affectedPersonIds
      .map((affectedPersonId) => deferPrimeAfterCommand(sql, affectedPersonId))
      .some(Boolean);
    invalidateMachineSuggestions();
    return {
      accepted: result.accepted,
      acceptedCount: result.accepted.length,
      changed: result.changed,
      maintenancePending,
      personId: result.personId,
    };
  };
