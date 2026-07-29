BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_stabilization_query_indexes_v1', 'system',
    'cimmich-stabilization-query-indexes', 'v1', now(), now(),
    encode(digest('cimmich.stabilization-query-indexes.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- identity_audit_item carries five cascading foreign keys (face_observation,
-- asset x2, person x2) with no supporting index beyond the run-leading primary
-- key and queue index. Every parent delete, the asset-split repair guard, the
-- dismissal carry-forward self-join, and the lead-scoped review lookup
-- otherwise scan the whole item table.

CREATE INDEX IF NOT EXISTS identity_audit_item_face_lookup
    ON identity_audit_item (face_id);

CREATE INDEX IF NOT EXISTS identity_audit_item_asset_lookup
    ON identity_audit_item (asset_id);

CREATE INDEX IF NOT EXISTS identity_audit_item_suggested_person_lookup
    ON identity_audit_item (suggested_person_id, audit_run_id);

CREATE INDEX IF NOT EXISTS identity_audit_item_assigned_person_lookup
    ON identity_audit_item (assigned_person_id, audit_run_id)
    WHERE assigned_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS identity_audit_item_reference_asset_lookup
    ON identity_audit_item (suggested_reference_asset_id)
    WHERE suggested_reference_asset_id IS NOT NULL;

COMMENT ON INDEX identity_audit_item_suggested_person_lookup IS
    'Supports the person cascade and the lead-scoped review item lookup: leads drill-down filters one audit run by suggested person.';
COMMENT ON INDEX identity_audit_item_assigned_person_lookup IS
    'Supports the person cascade and the lead-scoped contradiction lookup; partial because untagged matches always leave assigned_person_id NULL.';

-- Pet-match cascading foreign keys. The observation unique key leads with
-- run_id and the pending suggestion index is partial, so asset deletes, the
-- asset-split repair guard, and Person purges scan both tables.

CREATE INDEX IF NOT EXISTS pet_match_observation_asset_lookup
    ON pet_match_observation (asset_id);

CREATE INDEX IF NOT EXISTS pet_match_suggestion_pet_lookup
    ON pet_match_suggestion (pet_id);

COMMENT ON INDEX pet_match_suggestion_pet_lookup IS
    'Full-state pet cascade support. The pending review index cannot back the person cascade once a suggestion leaves the pending state.';

-- The exact provider-scoped claim shapes introduced with the recognition and
-- body-detection backlog lanes all reduce a pending claim to
-- (operation, tool_version, config_digest). The original pending index orders
-- only by request time, so every provider-bound claim rescans all pending work.

CREATE INDEX IF NOT EXISTS media_job_pending_operation_binding
    ON media_job (operation, tool_version, config_digest)
    WHERE state = 'pending';

COMMENT ON INDEX media_job_pending_operation_binding IS
    'Provider-bound pending claims: exact recognition and body-detection workers claim only their own (operation, tool_version, config_digest) slice.';

-- The media job status projection lists the twenty most recent jobs across all
-- states on every poll. The only request-time index is partial over pending
-- work, so the recent list re-sorts the whole job table.

CREATE INDEX IF NOT EXISTS media_job_recent
    ON media_job (requested_at DESC, job_id DESC);

-- The pending pet suggestion index breaks created_at ties by suggestion_id,
-- but the review list breaks them by rank before suggestion_id (suggestions
-- share their observation's insert timestamp). Recreate the index with the
-- sort keys the query actually uses.

DROP INDEX pet_match_suggestion_pet_pending;
CREATE INDEX pet_match_suggestion_pet_pending
    ON pet_match_suggestion (pet_id, created_at DESC, rank, suggestion_id)
    WHERE state = 'pending';

COMMENT ON INDEX pet_match_suggestion_pet_pending IS
    'Pending review list for one Pet, newest import first, ranked within a tie the way the suggestions endpoint sorts.';

COMMIT;
