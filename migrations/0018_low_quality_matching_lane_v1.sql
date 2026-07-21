BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_low_quality_matching_lane_v1', 'system',
    'cimmich-low-quality-matching-lane', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

ALTER TABLE reference_bucket DROP CONSTRAINT reference_bucket_bucket_kind_check;
ALTER TABLE reference_bucket
    ADD CONSTRAINT reference_bucket_bucket_kind_check
    CHECK (bucket_kind IN ('prime','secondary','lq','head','specialty'));

DROP INDEX reference_bucket_one_active_main;
CREATE UNIQUE INDEX reference_bucket_one_active_main
    ON reference_bucket(person_id, bucket_kind)
    WHERE state = 'active' AND bucket_kind IN ('prime','secondary','lq','head');

ALTER TABLE source_pack_reference DROP CONSTRAINT source_pack_reference_bucket_kind_check;
ALTER TABLE source_pack_reference
    ADD CONSTRAINT source_pack_reference_bucket_kind_check
    CHECK (bucket_kind IN ('prime','secondary','lq','specialty'));

ALTER TABLE source_pack_reference DROP CONSTRAINT source_pack_reference_routing_state_check;
ALTER TABLE source_pack_reference
    ADD CONSTRAINT source_pack_reference_routing_state_check
    CHECK (routing_state IN ('eligible','condition_only','unmeasured','disabled'));

CREATE OR REPLACE FUNCTION enforce_bucket_membership_invariants()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_person_id text;
    v_bucket_kind text;
    v_latest_action text;
    v_latest_actor text;
BEGIN
    SELECT person_id, bucket_kind INTO v_person_id, v_bucket_kind
    FROM reference_bucket WHERE bucket_id = NEW.bucket_id;

    SELECT action, actor_kind INTO v_latest_action, v_latest_actor
    FROM bucket_membership_event
    WHERE bucket_id = NEW.bucket_id AND face_id = NEW.face_id
    ORDER BY created_at DESC, membership_event_id DESC
    LIMIT 1;

    IF NEW.actor_kind = 'policy'
       AND v_latest_actor = 'user'
       AND v_latest_action = 'pin'
       AND NEW.action IN ('demote','remove','ban') THEN
        RAISE EXCEPTION 'policy cannot override user pin' USING ERRCODE = '23514';
    END IF;

    IF NEW.actor_kind = 'policy'
       AND v_latest_actor = 'user'
       AND v_latest_action = 'ban'
       AND NEW.action IN ('activate','pin','unpin','unban') THEN
        RAISE EXCEPTION 'policy cannot override user ban' USING ERRCODE = '23514';
    END IF;

    IF NEW.action IN ('activate','pin','unpin') THEN
        IF NOT EXISTS (
            SELECT 1 FROM identity_claim ic
            WHERE ic.face_id = NEW.face_id AND ic.person_id = v_person_id AND ic.state = 'accepted'
        ) THEN
            RAISE EXCEPTION 'active evidence requires accepted face identity' USING ERRCODE = '23514';
        END IF;

        IF v_bucket_kind IN ('prime','secondary','lq','head') AND EXISTS (
            WITH latest_other AS (
                SELECT DISTINCT ON (e.bucket_id) e.bucket_id, e.action
                FROM bucket_membership_event e
                JOIN reference_bucket b ON b.bucket_id = e.bucket_id
                WHERE e.face_id = NEW.face_id
                  AND b.person_id = v_person_id
                  AND b.bucket_kind IN ('prime','secondary','lq','head')
                  AND b.bucket_id <> NEW.bucket_id
                ORDER BY e.bucket_id, e.created_at DESC, e.membership_event_id DESC
            )
            SELECT 1 FROM latest_other WHERE action IN ('activate','pin','unpin')
        ) THEN
            RAISE EXCEPTION 'face cannot be active in more than one main evidence tier' USING ERRCODE = '23514';
        END IF;

        IF v_bucket_kind = 'head' AND EXISTS (
            SELECT 1 FROM current_reference_gallery g
            WHERE g.person_id = v_person_id AND g.face_id = NEW.face_id
              AND g.bucket_kind = 'specialty' AND g.membership_state = 'active'
        ) THEN
            RAISE EXCEPTION 'head evidence cannot overlap a matching Specialty' USING ERRCODE = '23514';
        END IF;

        IF v_bucket_kind = 'specialty' AND EXISTS (
            SELECT 1 FROM current_reference_gallery g
            WHERE g.person_id = v_person_id AND g.face_id = NEW.face_id
              AND g.bucket_kind = 'head' AND g.membership_state = 'active'
        ) THEN
            RAISE EXCEPTION 'matching Specialty cannot overlap head evidence' USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMIT;
