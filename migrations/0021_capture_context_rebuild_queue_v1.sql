BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    config_digest, source_snapshot_id, started_at, completed_at,
    result_digest, privacy_class
) VALUES (
    'receipt_cimmich_capture_context_rebuild_queue_v1', 'system',
    'cimmich-capture-context-rebuild-queue', '1',
    'config_cimmich_capture_context_rebuild_queue_v1', NULL,
    now(), now(), 'result_cimmich_capture_context_rebuild_queue_v1',
    'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE FUNCTION enqueue_capture_context_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_person_id text;
BEGIN
    FOR v_person_id IN
        SELECT DISTINCT identity.person_id
        FROM (
            SELECT member.asset_id
            FROM current_capture_context_member member
            WHERE member.context_id = NEW.context_id
            UNION
            SELECT NEW.asset_id
        ) affected_asset
        JOIN face_observation face
          ON face.asset_id = affected_asset.asset_id AND face.state = 'valid'
        JOIN current_face_identity identity
          ON identity.face_id = face.face_id AND identity.state = 'accepted'
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM source_pack_rebuild_request request
            WHERE request.person_id = v_person_id
              AND request.reason_code = 'capture_context_changed'
              AND request.subject_type = 'capture_context'
              AND request.subject_id = NEW.context_id
              AND request.state IN ('pending', 'processing')
        ) THEN
            PERFORM enqueue_source_pack_rebuild(
                v_person_id, 'capture_context_changed', 'capture_context', NEW.context_id
            );
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER capture_context_source_pack_rebuild
AFTER INSERT ON capture_context_member_event
FOR EACH ROW EXECUTE FUNCTION enqueue_capture_context_source_pack_rebuild();

COMMIT;
