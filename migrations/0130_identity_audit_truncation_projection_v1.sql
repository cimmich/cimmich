BEGIN;

ALTER TABLE identity_audit_run
  ADD COLUMN query_frontier_limit integer NOT NULL DEFAULT 5000
    CHECK (query_frontier_limit >= 1),
  ADD COLUMN untagged_queries_eligible integer NOT NULL DEFAULT 0
    CHECK (untagged_queries_eligible >= 0),
  ADD COLUMN contradiction_queries_eligible integer NOT NULL DEFAULT 0
    CHECK (contradiction_queries_eligible >= 0),
  ADD COLUMN independence_comparison_limit integer DEFAULT 100
    CHECK (independence_comparison_limit IS NULL OR independence_comparison_limit >= 1),
  ADD COLUMN independence_candidates_eligible integer NOT NULL DEFAULT 0
    CHECK (independence_candidates_eligible >= 0),
  ADD COLUMN independence_candidates_verified integer NOT NULL DEFAULT 0
    CHECK (independence_candidates_verified >= 0),
  ADD COLUMN truncation_projection_complete boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT identity_audit_independence_verified_bound
    CHECK (independence_candidates_verified <= independence_candidates_eligible);

COMMENT ON COLUMN identity_audit_run.query_frontier_limit
IS 'Maximum eligible query Faces admitted to each ranked audit frontier.';

COMMENT ON COLUMN identity_audit_run.independence_comparison_limit
IS 'Maximum candidates admitted to independent-image verification; NULL means unbounded.';

COMMENT ON COLUMN identity_audit_run.truncation_projection_complete
IS 'True only when this run durably recorded every frontier and verification count.';

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_identity_audit_truncation_projection_v1', 'system',
  'cimmich-identity-audit-truncation-projection', 'v1', now(), now(),
  encode(digest('cimmich.identity-audit.truncation-projection.v1', 'sha256'), 'hex'),
  'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
