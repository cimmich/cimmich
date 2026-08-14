BEGIN;

CREATE OR REPLACE VIEW current_physical_identity_audit_item AS
SELECT ranked.audit_run_id, ranked.audit_kind, ranked.face_id,
  ranked.asset_id, ranked.assigned_person_id, ranked.suggested_person_id,
  ranked.suggested_score, ranked.comparison_score, ranked.margin,
  ranked.review_state, ranked.reviewed_at, ranked.reviewed_by,
  ranked.created_at, ranked.privacy_class,
  ranked.suggested_reference_asset_id, ranked.physical_face_id,
  ranked.physical_rank, ranked.evidence_route
FROM (
  SELECT item.*, member.physical_face_id,
    row_number() OVER (
      PARTITION BY item.audit_run_id, item.audit_kind,
        item.suggested_person_id, member.physical_face_id
      ORDER BY CASE
          WHEN item.audit_kind = 'accepted_contradiction' AND EXISTS (
            SELECT 1
            FROM current_face_identity accepted
            WHERE accepted.face_id = item.face_id
              AND accepted.person_id = item.assigned_person_id
              AND accepted.state = 'accepted'
          ) THEN 0 ELSE 1
        END,
        item.suggested_score DESC, item.margin DESC, item.face_id
    ) AS physical_rank
  FROM identity_audit_item item
  JOIN current_face_physical_member member ON member.face_id = item.face_id
) ranked
WHERE ranked.physical_rank = 1;

COMMENT ON VIEW current_physical_identity_audit_item IS
  'Current physical-Face audit evidence, including the schema-136 evidence route required to distinguish cross-Person matches from own-cluster outliers.';

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_identity_audit_evidence_route_projection_v1', 'system',
  'cimmich-identity-audit-evidence-route-projection', 'v1', now(), now(),
  encode(digest('cimmich.identity-audit.evidence-route-projection.v1', 'sha256'), 'hex'),
  'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
