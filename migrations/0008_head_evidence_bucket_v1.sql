BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_head_evidence_bucket_v1', 'system',
    'cimmich-head-evidence-bucket', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

ALTER TABLE reference_bucket DROP CONSTRAINT reference_bucket_bucket_kind_check;
ALTER TABLE reference_bucket
    ADD CONSTRAINT reference_bucket_bucket_kind_check
    CHECK (bucket_kind IN ('prime','secondary','head','specialty'));

DROP INDEX reference_bucket_one_active_main;
CREATE UNIQUE INDEX reference_bucket_one_active_main
    ON reference_bucket(person_id, bucket_kind)
    WHERE state = 'active' AND bucket_kind IN ('prime','secondary','head');

INSERT INTO reference_bucket (
    bucket_id, person_id, bucket_kind, name, activation_hints,
    created_by, policy_version, state, producer_receipt_id, privacy_class
)
SELECT
    'bucket_head_' || substr(encode(digest(p.person_id || E'\x1fhead', 'sha256'), 'hex'), 1, 32),
    p.person_id, 'head', NULL, NULL,
    'system', 'cimmich-head-evidence-v1', 'active',
    'receipt_cimmich_head_evidence_bucket_v1', 'sensitive-biometric'
FROM person p
WHERE p.status = 'active' AND p.subject_kind = 'person'
  AND NOT EXISTS (
      SELECT 1 FROM reference_bucket b
      WHERE b.person_id = p.person_id AND b.bucket_kind = 'head' AND b.state = 'active'
  );

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

        IF v_bucket_kind IN ('prime','secondary','head') AND EXISTS (
            WITH latest_other AS (
                SELECT DISTINCT ON (e.bucket_id)
                       e.bucket_id, e.action
                FROM bucket_membership_event e
                JOIN reference_bucket b ON b.bucket_id = e.bucket_id
                WHERE e.face_id = NEW.face_id
                  AND b.person_id = v_person_id
                  AND b.bucket_kind IN ('prime','secondary','head')
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

CREATE OR REPLACE VIEW asset_people AS
SELECT fo.asset_id, cfi.person_id,
       CASE WHEN head.face_id IS NULL THEN 'face'::text ELSE 'head'::text END AS association_type,
       cfi.state AS authority_state, fo.face_id AS geometry_id
FROM current_face_identity cfi
JOIN face_observation fo ON fo.face_id = cfi.face_id
LEFT JOIN LATERAL (
    SELECT g.face_id
    FROM current_reference_gallery g
    WHERE g.person_id = cfi.person_id AND g.face_id = cfi.face_id
      AND g.bucket_kind = 'head' AND g.membership_state = 'active'
    LIMIT 1
) head ON true
UNION ALL
SELECT bo.asset_id, bt.person_id, 'body', bt.state, bo.body_id
FROM current_body_tag bt JOIN body_observation bo ON bo.body_id = bt.body_id
UNION ALL
SELECT pt.asset_id, pt.person_id, 'presence', pt.state, NULL::text
FROM current_presence_tag pt;

COMMIT;
