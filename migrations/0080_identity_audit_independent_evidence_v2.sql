BEGIN;

ALTER TABLE identity_audit_run
  ADD COLUMN derivative_candidates_suppressed integer NOT NULL DEFAULT 0
    CHECK (derivative_candidates_suppressed >= 0),
  ADD COLUMN independence_provider_config_digest text
    CHECK (
      independence_provider_config_digest IS NULL
      OR independence_provider_config_digest ~ '^[0-9a-f]{64}$'
    ),
  ADD COLUMN independence_score_floor double precision NOT NULL DEFAULT 0.75
    CHECK (independence_score_floor BETWEEN 0 AND 1);

ALTER TABLE identity_audit_item
  ADD COLUMN suggested_reference_asset_id text
    REFERENCES asset(asset_id) ON DELETE CASCADE;

COMMENT ON COLUMN identity_audit_run.derivative_candidates_suppressed
IS 'Review candidates withheld because replay-consistent local image evidence identified the query and its strongest Prime reference as derivatives of the same photo.';

COMMENT ON COLUMN identity_audit_run.independence_score_floor
IS 'Face-match score at or above which independent-photo verification is mandatory before a candidate can enter the review queue.';

COMMENT ON COLUMN identity_audit_item.suggested_reference_asset_id
IS 'Exact strongest Prime reference used to create and independently verify this suggestion.';

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_identity_audit_independent_evidence_v2', 'system',
  'cimmich-identity-audit-independent-evidence', 'v2', now(), now(),
  encode(digest('cimmich.identity-audit.independent-evidence.v2', 'sha256'), 'hex'),
  'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
