BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_review_query_performance_v1', 'system',
    'cimmich-review-query-performance', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

-- Machine review resolves the latest user action for every unresolved face.
-- Without this lookup PostgreSQL repeatedly scans the append-only decision
-- ledger before it can even select the small query batch.
CREATE INDEX IF NOT EXISTS decision_subject_actor_latest
    ON decision(subject_type, subject_id, actor_kind, created_at DESC, decision_id DESC);

-- Corrected-lane selection starts from one active model generation. The
-- existing uniqueness index starts with face_id and cannot serve that scan.
CREATE INDEX IF NOT EXISTS face_embedding_active_model_face
    ON face_embedding(model_version, face_id, config_digest)
    WHERE state = 'active';

-- Direct accepted-state probes are common in review and context isolation.
CREATE INDEX IF NOT EXISTS identity_claim_face_state_person
    ON identity_claim(face_id, state, person_id);

-- Overlap and same-photo guards are asset-local. Without this partial index a
-- correlated guard scans every FaceObservation once per unresolved face.
CREATE INDEX IF NOT EXISTS face_observation_valid_asset_geometry
    ON face_observation(asset_id, face_id)
    INCLUDE (box_x, box_y, box_w, box_h)
    WHERE state = 'valid';

COMMIT;
