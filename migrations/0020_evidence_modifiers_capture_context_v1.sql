BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_evidence_modifiers_capture_context_v1', 'system',
    'cimmich-evidence-modifiers-capture-context', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

CREATE TABLE face_modifier_event (
    modifier_event_id text PRIMARY KEY,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    modifier_key text NOT NULL,
    modifier_label text NOT NULL,
    modifier_class text NOT NULL DEFAULT 'condition'
        CHECK (modifier_class IN ('condition','presentation','quality')),
    action text NOT NULL CHECK (action IN ('add','remove')),
    actor_kind text NOT NULL CHECK (actor_kind IN ('user','policy','import','model')),
    actor_id text NOT NULL,
    confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    decision_id text REFERENCES decision(decision_id),
    supersedes_event_id text REFERENCES face_modifier_event(modifier_event_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (modifier_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
    CHECK (length(btrim(modifier_label)) BETWEEN 1 AND 64),
    CHECK (actor_kind <> 'user' OR decision_id IS NOT NULL)
);

CREATE INDEX face_modifier_event_lookup
    ON face_modifier_event(face_id, modifier_key, created_at DESC, modifier_event_id DESC);

CREATE VIEW current_face_modifier AS
SELECT latest.face_id, latest.modifier_key, latest.modifier_label,
       latest.modifier_class, latest.actor_kind, latest.actor_id,
       latest.confidence, latest.metadata, latest.decision_id,
       latest.modifier_event_id, latest.created_at
FROM (
    SELECT DISTINCT ON (face_id, modifier_key) *
    FROM face_modifier_event
    ORDER BY face_id, modifier_key, created_at DESC, modifier_event_id DESC
) latest
WHERE latest.action = 'add';

CREATE TABLE capture_context (
    context_id text PRIMARY KEY,
    context_kind text NOT NULL CHECK (context_kind IN ('same_moment','rapid_burst','sequence')),
    label text NOT NULL DEFAULT '',
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','retired')),
    start_time timestamptz,
    end_time timestamptz,
    confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    grouping_features jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by text NOT NULL CHECK (created_by IN ('user','policy','import','model')),
    actor_id text NOT NULL,
    decision_id text REFERENCES decision(decision_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (start_time IS NULL OR end_time IS NULL OR start_time <= end_time),
    CHECK (created_by <> 'user' OR decision_id IS NOT NULL)
);

CREATE TABLE capture_context_member_event (
    membership_event_id text PRIMARY KEY,
    context_id text NOT NULL REFERENCES capture_context(context_id) ON DELETE CASCADE,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('add','remove')),
    member_index integer CHECK (member_index IS NULL OR member_index >= 0),
    actor_kind text NOT NULL CHECK (actor_kind IN ('user','policy','import','model')),
    actor_id text NOT NULL,
    confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    reason_code text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    supersedes_event_id text REFERENCES capture_context_member_event(membership_event_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX capture_context_member_event_lookup
    ON capture_context_member_event(context_id, asset_id, created_at DESC, membership_event_id DESC);

CREATE VIEW current_capture_context_member AS
SELECT latest.context_id, latest.asset_id, latest.member_index,
       latest.actor_kind, latest.actor_id, latest.confidence,
       latest.reason_code, latest.metadata, latest.membership_event_id,
       latest.created_at
FROM (
    SELECT DISTINCT ON (context_id, asset_id) *
    FROM capture_context_member_event
    ORDER BY context_id, asset_id, created_at DESC, membership_event_id DESC
) latest
JOIN capture_context context USING (context_id)
WHERE latest.action = 'add' AND context.state = 'active';

CREATE VIEW current_face_capture_context AS
SELECT fo.face_id, member.asset_id, context.context_id, context.context_kind,
       context.label, context.confidence AS context_confidence,
       context.grouping_features, member.member_index,
       (
           SELECT count(*)::int
           FROM current_capture_context_member sibling
           WHERE sibling.context_id = context.context_id
       ) AS member_count
FROM current_capture_context_member member
JOIN capture_context context USING (context_id)
JOIN face_observation fo ON fo.asset_id = member.asset_id AND fo.state = 'valid';

-- Context may suggest that a Person is present in a missing middle frame, but
-- this view is deliberately candidate-only. It never writes Presence truth.
CREATE VIEW capture_context_presence_candidate AS
WITH accepted_context_people AS (
    SELECT member.context_id, identity.person_id,
           count(DISTINCT member.asset_id)::int AS supporting_asset_count
    FROM current_capture_context_member member
    JOIN face_observation face ON face.asset_id = member.asset_id AND face.state = 'valid'
    JOIN current_face_identity identity ON identity.face_id = face.face_id
        AND identity.state = 'accepted'
    GROUP BY member.context_id, identity.person_id
    HAVING count(DISTINCT member.asset_id) >= 2
)
SELECT support.context_id, support.person_id, member.asset_id,
       support.supporting_asset_count,
       LEAST(0.95, 0.45 + 0.1 * support.supporting_asset_count)::numeric AS confidence,
       jsonb_build_object(
           'candidateOnly', true,
           'reason', 'capture_context_gap',
           'supportingAssetCount', support.supporting_asset_count
       ) AS evidence_refs
FROM accepted_context_people support
JOIN current_capture_context_member member USING (context_id)
WHERE NOT EXISTS (
    SELECT 1
    FROM face_observation face
    JOIN current_face_identity identity ON identity.face_id = face.face_id
        AND identity.state = 'accepted'
    WHERE face.asset_id = member.asset_id AND face.state = 'valid'
      AND identity.person_id = support.person_id
)
AND NOT EXISTS (
    SELECT 1 FROM current_presence_tag presence
    WHERE presence.asset_id = member.asset_id
      AND presence.person_id = support.person_id
      AND presence.state = 'accepted'
);

-- Preserve every observed Specialty decision as a condition modifier. The old
-- bucket/event rows remain immutable history but cease to be matching inputs.
INSERT INTO face_modifier_event (
    modifier_event_id, face_id, modifier_key, modifier_label, modifier_class,
    action, actor_kind, actor_id, confidence, metadata,
    producer_receipt_id, privacy_class
)
SELECT
    'modifier_backfill_' || md5(gallery.person_id || ':' || gallery.face_id || ':' || lower(gallery.bucket_name)),
    gallery.face_id,
    trim(both '-' FROM regexp_replace(lower(gallery.bucket_name), '[^a-z0-9]+', '-', 'g')),
    gallery.bucket_name,
    'condition', 'add',
    CASE gallery.actor_kind WHEN 'user' THEN 'import' WHEN 'policy' THEN 'policy' ELSE 'import' END,
    'cimmich-specialty-backfill-v1',
    CASE WHEN gallery.actor_kind = 'user' THEN 1 ELSE NULL END,
    jsonb_build_object(
        'legacyBucketId', gallery.bucket_id,
        'legacyReasonCode', gallery.reason_code,
        'migratedFrom', 'specialty_bucket'
    ),
    'receipt_cimmich_evidence_modifiers_capture_context_v1',
    'sensitive-biometric'
FROM current_reference_gallery gallery
WHERE gallery.bucket_kind = 'specialty'
  AND gallery.membership_state = 'active'
ON CONFLICT (modifier_event_id) DO NOTHING;

CREATE FUNCTION enqueue_modifier_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_person_id text;
BEGIN
    SELECT person_id INTO v_person_id
    FROM current_face_identity
    WHERE face_id = NEW.face_id AND state = 'accepted'
    LIMIT 1;
    IF v_person_id IS NOT NULL THEN
        PERFORM enqueue_source_pack_rebuild(
            v_person_id, 'face_modifier_changed', 'face_modifier_event', NEW.modifier_event_id
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER modifier_source_pack_rebuild
AFTER INSERT ON face_modifier_event
FOR EACH ROW EXECUTE FUNCTION enqueue_modifier_source_pack_rebuild();

CREATE OR REPLACE FUNCTION purge_person(p_person_id text, p_delete_biometrics boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    v_face_ids text[];
    v_modifier_decision_ids text[];
    v_subject_ids text[];
    v_counts jsonb;
BEGIN
    SELECT COALESCE(array_agg(DISTINCT face_id), ARRAY[]::text[]) INTO v_face_ids
    FROM identity_claim WHERE person_id = p_person_id;

    SELECT COALESCE(array_agg(DISTINCT decision_id) FILTER (WHERE decision_id IS NOT NULL), ARRAY[]::text[])
    INTO v_modifier_decision_ids
    FROM face_modifier_event WHERE face_id = ANY(v_face_ids);

    v_counts := jsonb_build_object(
        'aliases', (SELECT count(*) FROM person_alias WHERE person_id = p_person_id),
        'identity_claims', (SELECT count(*) FROM identity_claim WHERE person_id = p_person_id),
        'embeddings', CASE WHEN p_delete_biometrics THEN (SELECT count(*) FROM face_embedding WHERE face_id = ANY(v_face_ids)) ELSE 0 END,
        'face_modifiers', CASE WHEN p_delete_biometrics THEN (SELECT count(*) FROM face_modifier_event WHERE face_id = ANY(v_face_ids)) ELSE 0 END,
        'body_tags', (SELECT count(*) FROM body_tag WHERE person_id = p_person_id),
        'presence_tags', (SELECT count(*) FROM presence_tag WHERE person_id = p_person_id),
        'buckets', (SELECT count(*) FROM reference_bucket WHERE person_id = p_person_id)
    );

    SELECT ARRAY[p_person_id]
           || COALESCE((SELECT array_agg(identity_claim_id) FROM identity_claim WHERE person_id = p_person_id), ARRAY[]::text[])
           || COALESCE((SELECT array_agg(body_tag_id) FROM body_tag WHERE person_id = p_person_id), ARRAY[]::text[])
           || COALESCE((SELECT array_agg(presence_tag_id) FROM presence_tag WHERE person_id = p_person_id), ARRAY[]::text[])
           || COALESCE((SELECT array_agg(bucket_id) FROM reference_bucket WHERE person_id = p_person_id), ARRAY[]::text[])
    INTO v_subject_ids;

    IF p_delete_biometrics THEN
        DELETE FROM artifact WHERE owner_type = 'face_observation' AND owner_id = ANY(v_face_ids);
        DELETE FROM face_embedding WHERE face_id = ANY(v_face_ids);
        DELETE FROM face_modifier_event WHERE face_id = ANY(v_face_ids);
    END IF;

    DELETE FROM person WHERE person_id = p_person_id;
    DELETE FROM decision WHERE subject_id = ANY(v_subject_ids) OR decision_id = ANY(v_modifier_decision_ids);

    INSERT INTO privacy_purge_receipt(person_token_digest, deleted_counts)
    VALUES (encode(digest(p_person_id, 'sha256'), 'hex'), v_counts);
    RETURN v_counts;
END;
$$;

COMMIT;
