BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_source_reconciliation_identity_guard_v1', 'system',
    'cimmich-source-reconciliation-identity-guard', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

-- A machine observation matched back to an already accepted source face is
-- valuable detector/reconciliation provenance, but it is not a second
-- identity hypothesis. Preserve the historical claims and their evidence as
-- superseded records instead of deleting them.
INSERT INTO decision (
    decision_id, subject_type, subject_id, action, actor_kind, actor_id,
    reason_code, note, producer_receipt_id, privacy_class
)
SELECT
    'decision_source_reconciliation_' || md5(claim.identity_claim_id),
    'identity_claim', claim.identity_claim_id, 'reject', 'policy',
    'cimmich-source-reconciliation-identity-guard-v1',
    'source_reconciliation_not_identity_candidate',
    'Detector-to-source reconciliation is observation provenance, not a novel identity candidate.',
    'receipt_cimmich_source_reconciliation_identity_guard_v1',
    claim.privacy_class
FROM identity_claim claim
WHERE claim.state = 'candidate'
  AND claim.evidence_refs->>'assignment_decision' = 'accepted_matched_digikam_sidecar_face'
ON CONFLICT (decision_id) DO NOTHING;

UPDATE identity_claim claim
SET state = 'superseded',
    decision_id = 'decision_source_reconciliation_' || md5(claim.identity_claim_id)
WHERE claim.state = 'candidate'
  AND claim.evidence_refs->>'assignment_decision' = 'accepted_matched_digikam_sidecar_face';

ALTER TABLE identity_claim
  DROP CONSTRAINT IF EXISTS identity_claim_candidate_not_source_reconciliation;
ALTER TABLE identity_claim
  ADD CONSTRAINT identity_claim_candidate_not_source_reconciliation CHECK (
    state <> 'candidate'
    OR coalesce(evidence_refs->>'assignment_decision', '')
       <> 'accepted_matched_digikam_sidecar_face'
  );

COMMIT;
