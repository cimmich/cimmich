BEGIN;

ALTER TABLE identity_audit_item
  ADD COLUMN evidence_route text NOT NULL DEFAULT 'cross_person_match'
    CHECK (evidence_route IN ('cross_person_match', 'own_cluster_outlier'));

ALTER TABLE identity_audit_item
  DROP CONSTRAINT identity_audit_item_check;

ALTER TABLE identity_audit_item
  ADD CONSTRAINT identity_audit_item_assignment_evidence_check CHECK (
    (
      audit_kind = 'untagged_match'
      AND evidence_route = 'cross_person_match'
      AND assigned_person_id IS NULL
    )
    OR
    (
      audit_kind = 'accepted_contradiction'
      AND assigned_person_id IS NOT NULL
      AND comparison_score IS NOT NULL
      AND (
        (
          evidence_route = 'cross_person_match'
          AND assigned_person_id <> suggested_person_id
        )
        OR
        (
          evidence_route = 'own_cluster_outlier'
          AND assigned_person_id = suggested_person_id
        )
      )
    )
  );

COMMENT ON COLUMN identity_audit_item.evidence_route IS
  'Why a review-only audit row exists: another Person wins, or the accepted Face is an obvious outlier against even the low-quality confirmed Faces of its assigned Person.';

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_identity_audit_own_cluster_outlier_v1', 'system',
  'cimmich-identity-audit-own-cluster-outlier', 'v1', now(), now(),
  encode(digest('cimmich.identity-audit.own-cluster-outlier.v1', 'sha256'), 'hex'),
  'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
