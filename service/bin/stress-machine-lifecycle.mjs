#!/usr/bin/env node
import postgres from "postgres";
import { createCimmichRepository } from "../src/repository.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!/cimmich_lifecycle_probe(?:\?|$)/.test(databaseUrl)) {
  throw new Error(
    "Lifecycle stress refuses to run outside cimmich_lifecycle_probe",
  );
}

const sql = postgres(databaseUrl, { max: 3, prepare: true });
const repository = createCimmichRepository(sql);
const actorId = "cimmich-lifecycle-probe";

try {
  const suggestions = await repository.machineSuggestions({ limit: 80 });
  const suggestion = suggestions.find((item) => item.candidates.length > 0);
  if (!suggestion)
    throw new Error(
      "No corrected machine suggestion is available for lifecycle stress",
    );
  const candidate = suggestion.candidates[0];

  const [before] = await sql`
    SELECT
      count(*) FILTER (WHERE state = 'candidate')::int AS candidates,
      count(*) FILTER (WHERE state = 'accepted')::int AS accepted
    FROM identity_claim WHERE face_id = ${suggestion.face_id}
  `;
  const accepted = await repository.reassignFaceIdentity({
    actorId,
    faceId: suggestion.face_id,
    personId: candidate.person_id,
  });
  const [afterAccept] = await sql`
    SELECT
      count(*) FILTER (WHERE state = 'candidate')::int AS candidates,
      count(*) FILTER (WHERE state = 'accepted')::int AS accepted
    FROM identity_claim WHERE face_id = ${suggestion.face_id}
  `;
  const [acceptedBody] = await sql`
    SELECT count(*)::int AS count
    FROM current_body_tag
    WHERE state = 'accepted' AND supporting_face_id = ${suggestion.face_id}
      AND origin = 'face_body_linkage'
  `;
  const [queued] = await sql`
    SELECT count(*)::int AS count
    FROM source_pack_rebuild_request
    WHERE person_id = ${candidate.person_id} AND state = 'pending'
      AND reason_code = 'identity_accepted'
      AND subject_type = 'identity_claim'
      AND subject_id = ${accepted.claimId}
  `;

  const rejected = await repository.rejectAcceptedIdentity({
    actorId,
    claimId: accepted.claimId,
    note: "Disposable clone lifecycle stress",
  });
  const [afterReject] = await sql`
    SELECT
      count(*) FILTER (WHERE state = 'accepted')::int AS accepted,
      count(*) FILTER (WHERE state = 'rejected')::int AS rejected
    FROM identity_claim WHERE face_id = ${suggestion.face_id}
  `;
  const [bodyAfterReject] = await sql`
    SELECT count(*)::int AS count
    FROM current_body_tag
    WHERE state = 'accepted' AND supporting_face_id = ${suggestion.face_id}
      AND origin = 'face_body_linkage'
  `;

  const ignoredOnce = await repository.dismissMachineSuggestion({
    actorId,
    faceId: suggestion.face_id,
  });
  const restoredOnce = await repository.restoreMachineSuggestion({
    actorId,
    faceId: suggestion.face_id,
  });
  const ignoredTwice = await repository.dismissMachineSuggestion({
    actorId,
    faceId: suggestion.face_id,
  });
  const restoredTwice = await repository.restoreMachineSuggestion({
    actorId,
    faceId: suggestion.face_id,
  });
  const [latestDecision] = await sql`
    SELECT action
    FROM decision
    WHERE subject_type = 'machine_suggestion'
      AND subject_id = ${`${suggestion.face_id}:${ignoredOnce.modelVersion}:${ignoredOnce.configDigest}:${ignoredOnce.policyVersion}`}
      AND actor_kind = 'user'
    ORDER BY created_at DESC, decision_id DESC
    LIMIT 1
  `;

  const proof = {
    schema_version: "cimmich.machine-lifecycle-stress.v1",
    database_boundary: "disposable-restored-clone",
    suggestion_available: true,
    accept: {
      accepted_claim_created: accepted.changed && afterAccept.accepted === 1,
      competing_candidates_before: before.candidates,
      competing_candidates_after: afterAccept.candidates,
      body_link_applied: acceptedBody.count === 1,
      body_link_abstained_honestly:
        acceptedBody.count === 0 &&
        Number(accepted.bodyLinkage?.abstained || 0) > 0,
      rebuild_request_present: queued.count > 0,
      maintenance_pending: accepted.maintenancePending,
    },
    correction: {
      accepted_claim_removed: rejected.changed && afterReject.accepted === 0,
      rejected_claim_recorded: afterReject.rejected > 0,
      face_derived_body_removed: bodyAfterReject.count === 0,
    },
    unknown_restore: {
      first_ignore_appended: ignoredOnce.changed,
      first_restore_appended: restoredOnce.changed,
      second_ignore_appended: ignoredTwice.changed,
      second_restore_appended: restoredTwice.changed,
      final_state_active: latestDecision?.action === "restore",
      matcher_contract_scoped: Boolean(
        ignoredOnce.configDigest && ignoredOnce.policyVersion,
      ),
    },
  };
  const pass =
    proof.accept.accepted_claim_created &&
    proof.accept.competing_candidates_after === 0 &&
    proof.accept.rebuild_request_present &&
    !proof.accept.maintenance_pending &&
    proof.correction.accepted_claim_removed &&
    proof.correction.rejected_claim_recorded &&
    proof.correction.face_derived_body_removed &&
    Object.values(proof.unknown_restore).every(Boolean);
  process.stdout.write(
    `${JSON.stringify({ ...proof, status: pass ? "pass" : "fail" })}\n`,
  );
  if (!pass) process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
