BEGIN;

-- Historical semantic exports may already contain the source-reconciliation
-- disposition that schema 19 subsequently removed from candidate authority.
-- Retain those restored rows as historical input while continuing to reject
-- the shape for every new INSERT or UPDATE. PostgreSQL NOT VALID constraints
-- enforce new writes; they only avoid retroactively rejecting restored truth.
ALTER TABLE identity_claim
  DROP CONSTRAINT IF EXISTS identity_claim_candidate_not_source_reconciliation;
ALTER TABLE identity_claim
  ADD CONSTRAINT identity_claim_candidate_not_source_reconciliation CHECK (
    state <> 'candidate'
    OR coalesce(evidence_refs->>'assignment_decision', '')
       <> 'accepted_matched_digikam_sidecar_face'
  ) NOT VALID;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_legacy_identity_claim_compatibility_v1', 'system',
    'cimmich-legacy-identity-claim-compatibility', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at;

COMMIT;
