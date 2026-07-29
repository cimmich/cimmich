BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_identity_audit_liveness_and_claim_index_v1', 'system',
    'cimmich-identity-audit-liveness-and-claim-index', 'v1', now(), now(),
    encode(
        digest('cimmich.identity-audit-liveness-and-claim-index.v1', 'sha256'),
        'hex'
    ),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- The interrupted-run reconcile sweep judged liveness on started_at alone,
-- but a legitimate audit run holds two transactions bounded at 31 minutes
-- each plus an unbounded provider verification phase. last_progress_at gives
-- the run a durable liveness signal: phase boundaries and the provider loop
-- update it, and the sweep only fails runs whose last recorded progress is
-- older than one transaction bound (identity-audit.mjs derives the exact
-- threshold from its configured timeouts).
ALTER TABLE identity_audit_run
    ADD COLUMN last_progress_at timestamptz;

-- Serves the incremental-audit staleness probe in identity-audit.mjs start():
-- an existence check over identity_claim.created_at >= base.started_at. No
-- prior migration indexes bare created_at (0001, 0011, 0026, 0027 all serve
-- other shapes), so the probe seq-scanned the append-only claim history on
-- the interactive POST path. BRIN fits an append-only, insertion-ordered
-- timestamp column at negligible size and build cost.
CREATE INDEX identity_claim_created_at_brin
    ON identity_claim USING brin (created_at);

COMMIT;
