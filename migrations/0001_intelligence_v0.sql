BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE source_snapshot (
    snapshot_id text PRIMARY KEY,
    input_schema_version text NOT NULL,
    source_digest text NOT NULL UNIQUE,
    locator_root_token text NOT NULL,
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    declared_asset_count bigint,
    observed_asset_count bigint NOT NULL CHECK (observed_asset_count >= 0),
    state text NOT NULL CHECK (state IN ('open','complete','incomplete','superseded')),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE producer_receipt (
    producer_receipt_id text PRIMARY KEY,
    producer_kind text NOT NULL CHECK (producer_kind IN ('user','trusted_import','import','model','derived_linkage','system')),
    producer_name text NOT NULL,
    producer_version text NOT NULL,
    config_digest text,
    source_snapshot_id text REFERENCES source_snapshot(snapshot_id),
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    result_digest text,
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset (
    asset_id text PRIMARY KEY,
    content_hash text,
    perceptual_hash text,
    locator_token text NOT NULL,
    media_kind text NOT NULL CHECK (media_kind IN ('image','video')),
    mime_type text NOT NULL,
    width integer CHECK (width IS NULL OR width > 0),
    height integer CHECK (height IS NULL OR height > 0),
    duration_seconds numeric CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    capture_time timestamptz,
    timezone_evidence jsonb,
    source_snapshot_id text NOT NULL REFERENCES source_snapshot(snapshot_id),
    state text NOT NULL CHECK (state IN ('active','missing','unreadable','unsupported','tombstoned')),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE person (
    person_id text PRIMARY KEY,
    display_name text,
    status text NOT NULL CHECK (status IN ('active','hidden','merged','purged')),
    merged_into_person_id text REFERENCES person(person_id),
    created_by_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    current_revision bigint NOT NULL DEFAULT 1 CHECK (current_revision > 0),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'merged') = (merged_into_person_id IS NOT NULL))
);

CREATE TABLE person_alias (
    alias_id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    label text NOT NULL,
    alias_kind text NOT NULL CHECK (alias_kind IN ('display','former_name','nickname','imported')),
    state text NOT NULL CHECK (state IN ('active','superseded','removed')),
    supersedes_alias_id text REFERENCES person_alias(alias_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artifact (
    artifact_id text PRIMARY KEY,
    owner_type text NOT NULL CHECK (owner_type IN ('asset','face_observation','body_observation')),
    owner_id text NOT NULL,
    artifact_kind text NOT NULL CHECK (artifact_kind IN ('crop','thumbnail','mask','overlay','report')),
    storage_key text NOT NULL,
    content_digest text NOT NULL,
    mime_type text NOT NULL,
    state text NOT NULL CHECK (state IN ('active','superseded','missing','purged')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE face_observation (
    face_id text PRIMARY KEY,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    box_x numeric NOT NULL CHECK (box_x BETWEEN 0 AND 1),
    box_y numeric NOT NULL CHECK (box_y BETWEEN 0 AND 1),
    box_w numeric NOT NULL CHECK (box_w > 0 AND box_w <= 1),
    box_h numeric NOT NULL CHECK (box_h > 0 AND box_h <= 1),
    landmark_digest text,
    detection_confidence numeric NOT NULL CHECK (detection_confidence BETWEEN 0 AND 1),
    quality_measurements jsonb NOT NULL DEFAULT '{}'::jsonb,
    crop_artifact_id text REFERENCES artifact(artifact_id) ON DELETE SET NULL,
    state text NOT NULL CHECK (state IN ('valid','hold','rejected','purged')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (box_x + box_w <= 1.000001 AND box_y + box_h <= 1.000001)
);

CREATE TABLE face_embedding (
    embedding_id text PRIMARY KEY,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    model_family text NOT NULL,
    model_version text NOT NULL,
    config_digest text NOT NULL,
    dimension integer NOT NULL CHECK (dimension > 0),
    normalized boolean NOT NULL,
    embedding vector NOT NULL,
    vector_digest text NOT NULL,
    state text NOT NULL CHECK (state IN ('active','superseded','purged')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (vector_dims(embedding) = dimension)
);
CREATE UNIQUE INDEX face_embedding_one_active_config
    ON face_embedding(face_id, model_family, model_version, config_digest)
    WHERE state = 'active';

CREATE TABLE body_observation (
    body_id text PRIMARY KEY,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    box_x numeric NOT NULL CHECK (box_x BETWEEN 0 AND 1),
    box_y numeric NOT NULL CHECK (box_y BETWEEN 0 AND 1),
    box_w numeric NOT NULL CHECK (box_w > 0 AND box_w <= 1),
    box_h numeric NOT NULL CHECK (box_h > 0 AND box_h <= 1),
    pose_ref text,
    mask_ref text,
    quality_measurements jsonb,
    state text NOT NULL CHECK (state IN ('valid','hold','rejected','purged')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (box_x + box_w <= 1.000001 AND box_y + box_h <= 1.000001)
);

CREATE TABLE decision (
    decision_id text PRIMARY KEY,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    action text NOT NULL CHECK (action IN ('accept','reject','merge','split','rename','promote','demote','pin','ban','ignore','restore')),
    actor_kind text NOT NULL CHECK (actor_kind IN ('user','policy','trusted_import')),
    actor_id text NOT NULL,
    reason_code text NOT NULL,
    note text NOT NULL DEFAULT '',
    supersedes_decision_id text REFERENCES decision(decision_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity_claim (
    identity_claim_id text PRIMARY KEY,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    origin text NOT NULL CHECK (origin IN ('user','trusted_import','import','prime_match','secondary_match','specialty_match','cluster_propagation')),
    state text NOT NULL CHECK (state IN ('candidate','accepted','rejected','superseded')),
    calibrated_confidence numeric CHECK (calibrated_confidence IS NULL OR calibrated_confidence BETWEEN 0 AND 1),
    evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    decision_id text REFERENCES decision(decision_id),
    supersedes_claim_id text REFERENCES identity_claim(identity_claim_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state IN ('accepted','rejected')) = (decision_id IS NOT NULL))
);
CREATE UNIQUE INDEX identity_claim_one_accepted_person_per_face
    ON identity_claim(face_id) WHERE state = 'accepted';

CREATE TABLE reference_bucket (
    bucket_id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    bucket_kind text NOT NULL CHECK (bucket_kind IN ('prime','secondary','specialty')),
    name text,
    activation_hints jsonb,
    created_by text NOT NULL CHECK (created_by IN ('user','model_candidate','system')),
    policy_version text NOT NULL,
    state text NOT NULL CHECK (state IN ('candidate','active','hidden','retired')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((bucket_kind = 'specialty') = (name IS NOT NULL)),
    CHECK (bucket_kind = 'specialty' OR activation_hints IS NULL)
);
CREATE UNIQUE INDEX reference_bucket_one_active_main
    ON reference_bucket(person_id, bucket_kind)
    WHERE state = 'active' AND bucket_kind IN ('prime','secondary');
CREATE UNIQUE INDEX reference_bucket_unique_active_specialty_name
    ON reference_bucket(person_id, lower(name))
    WHERE state IN ('candidate','active') AND bucket_kind = 'specialty';

CREATE TABLE bucket_membership_event (
    membership_event_id text PRIMARY KEY,
    bucket_id text NOT NULL REFERENCES reference_bucket(bucket_id) ON DELETE CASCADE,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('propose','activate','demote','remove','pin','unpin','ban','unban')),
    actor_kind text NOT NULL CHECK (actor_kind IN ('user','policy','import')),
    reason_code text NOT NULL,
    reason_text text NOT NULL DEFAULT '',
    policy_version text,
    score_snapshot jsonb,
    supersedes_event_id text REFERENCES bucket_membership_event(membership_event_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (actor_kind <> 'policy' OR policy_version IS NOT NULL)
);
CREATE INDEX bucket_membership_event_lookup
    ON bucket_membership_event(bucket_id, face_id, created_at DESC, membership_event_id DESC);

CREATE FUNCTION enforce_bucket_membership_invariants()
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
            RAISE EXCEPTION 'active reference requires accepted face identity' USING ERRCODE = '23514';
        END IF;

        IF v_bucket_kind IN ('prime','secondary') AND EXISTS (
            WITH latest_other AS (
                SELECT DISTINCT ON (e.bucket_id)
                       e.bucket_id, e.action
                FROM bucket_membership_event e
                JOIN reference_bucket b ON b.bucket_id = e.bucket_id
                WHERE e.face_id = NEW.face_id
                  AND b.person_id = v_person_id
                  AND b.bucket_kind IN ('prime','secondary')
                  AND b.bucket_id <> NEW.bucket_id
                ORDER BY e.bucket_id, e.created_at DESC, e.membership_event_id DESC
            )
            SELECT 1 FROM latest_other WHERE action IN ('activate','pin','unpin')
        ) THEN
            RAISE EXCEPTION 'face cannot be active in both prime and secondary' USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER bucket_membership_invariants
BEFORE INSERT ON bucket_membership_event
FOR EACH ROW EXECUTE FUNCTION enforce_bucket_membership_invariants();

CREATE TABLE body_tag (
    body_tag_id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    body_id text NOT NULL REFERENCES body_observation(body_id) ON DELETE CASCADE,
    origin text NOT NULL CHECK (origin IN ('user','trusted_import','face_body_linkage','model')),
    state text NOT NULL CHECK (state IN ('candidate','accepted','rejected','superseded')),
    supporting_face_id text REFERENCES face_observation(face_id),
    identity_claim_id text REFERENCES identity_claim(identity_claim_id),
    confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    decision_id text REFERENCES decision(decision_id),
    supersedes_body_tag_id text REFERENCES body_tag(body_tag_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((origin = 'face_body_linkage') = (supporting_face_id IS NOT NULL AND identity_claim_id IS NOT NULL)),
    CHECK (origin <> 'user' OR state <> 'accepted' OR decision_id IS NOT NULL)
);
CREATE UNIQUE INDEX body_tag_one_accepted_person_per_body
    ON body_tag(body_id) WHERE state = 'accepted';

CREATE TABLE presence_tag (
    presence_tag_id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    origin text NOT NULL CHECK (origin IN ('user','trusted_import','import','series_context','model','downstream')),
    reason_code text NOT NULL,
    note text NOT NULL DEFAULT '',
    state text NOT NULL CHECK (state IN ('candidate','accepted','rejected','superseded')),
    confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    decision_id text REFERENCES decision(decision_id),
    supersedes_presence_tag_id text REFERENCES presence_tag(presence_tag_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (origin <> 'user' OR state <> 'accepted' OR decision_id IS NOT NULL)
);
CREATE UNIQUE INDEX presence_tag_one_accepted_pair
    ON presence_tag(person_id, asset_id) WHERE state = 'accepted';

CREATE TABLE face_cluster (
    cluster_id text PRIMARY KEY,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    status text NOT NULL CHECK (status IN ('open','linked','merged','split','closed')),
    linked_person_id text REFERENCES person(person_id) ON DELETE SET NULL,
    member_count integer NOT NULL CHECK (member_count >= 0),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE face_cluster_member (
    cluster_id text NOT NULL REFERENCES face_cluster(cluster_id) ON DELETE CASCADE,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    membership_score numeric,
    rank integer NOT NULL CHECK (rank > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (cluster_id, face_id)
);

CREATE TABLE privacy_purge_receipt (
    purge_receipt_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    person_token_digest text NOT NULL,
    deleted_counts jsonb NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now(),
    schema_version integer NOT NULL DEFAULT 1
);

CREATE VIEW current_person AS
SELECT p.person_id, p.display_name, p.status, p.current_revision,
       COALESCE(array_agg(pa.label ORDER BY pa.created_at) FILTER (WHERE pa.state = 'active'), ARRAY[]::text[]) AS aliases
FROM person p
LEFT JOIN person_alias pa ON pa.person_id = p.person_id
WHERE p.status IN ('active','hidden')
GROUP BY p.person_id;

CREATE VIEW current_face_identity AS
SELECT DISTINCT ON (ic.face_id, ic.person_id)
       ic.face_id, ic.person_id, ic.state, ic.origin, ic.calibrated_confidence, ic.identity_claim_id
FROM identity_claim ic
ORDER BY ic.face_id, ic.person_id, ic.created_at DESC, ic.identity_claim_id DESC;

CREATE VIEW current_reference_gallery AS
WITH latest AS (
    SELECT DISTINCT ON (e.bucket_id, e.face_id)
           e.bucket_id, e.face_id, e.action, e.actor_kind, e.reason_code, e.created_at
    FROM bucket_membership_event e
    ORDER BY e.bucket_id, e.face_id, e.created_at DESC, e.membership_event_id DESC
)
SELECT b.person_id, b.bucket_id, b.bucket_kind, b.name AS bucket_name,
       l.face_id,
       CASE
         WHEN l.action IN ('activate','pin','unpin') THEN 'active'
         WHEN l.action = 'propose' THEN 'candidate'
         ELSE 'inactive'
       END AS membership_state,
       l.action AS latest_action, l.actor_kind, l.reason_code
FROM latest l
JOIN reference_bucket b ON b.bucket_id = l.bucket_id
WHERE b.state IN ('candidate','active');

CREATE VIEW current_body_tag AS
SELECT bt.*
FROM body_tag bt
WHERE bt.state <> 'superseded'
  AND NOT EXISTS (SELECT 1 FROM body_tag newer WHERE newer.supersedes_body_tag_id = bt.body_tag_id);

CREATE VIEW current_presence_tag AS
SELECT pt.*
FROM presence_tag pt
WHERE pt.state <> 'superseded'
  AND NOT EXISTS (SELECT 1 FROM presence_tag newer WHERE newer.supersedes_presence_tag_id = pt.presence_tag_id);

CREATE VIEW asset_people AS
SELECT fo.asset_id, cfi.person_id, 'face'::text AS association_type, cfi.state AS authority_state, fo.face_id AS geometry_id
FROM current_face_identity cfi JOIN face_observation fo ON fo.face_id = cfi.face_id
UNION ALL
SELECT bo.asset_id, bt.person_id, 'body', bt.state, bo.body_id
FROM current_body_tag bt JOIN body_observation bo ON bo.body_id = bt.body_id
UNION ALL
SELECT pt.asset_id, pt.person_id, 'presence', pt.state, NULL::text
FROM current_presence_tag pt;

CREATE VIEW person_assets AS
SELECT person_id, asset_id, association_type, authority_state, geometry_id FROM asset_people;

CREATE VIEW review_queue AS
SELECT identity_claim_id AS subject_id, 'identity_claim'::text AS subject_type, state, created_at
FROM identity_claim WHERE state = 'candidate'
UNION ALL
SELECT body_tag_id, 'body_tag', state, created_at FROM body_tag WHERE state = 'candidate'
UNION ALL
SELECT presence_tag_id, 'presence_tag', state, created_at FROM presence_tag WHERE state = 'candidate'
UNION ALL
SELECT bucket_id, 'reference_bucket', state, created_at FROM reference_bucket WHERE state = 'candidate';

CREATE VIEW anonymous_cluster_summary AS
SELECT cluster_id, status, member_count, created_at
FROM face_cluster WHERE linked_person_id IS NULL;

CREATE VIEW matching_gallery AS
SELECT g.person_id, g.bucket_id, g.bucket_kind, g.bucket_name, g.face_id,
       fe.embedding_id, fe.model_family, fe.model_version, fe.config_digest,
       fe.dimension, fe.embedding
FROM current_reference_gallery g
JOIN face_observation fo ON fo.face_id = g.face_id AND fo.state = 'valid'
JOIN face_embedding fe ON fe.face_id = g.face_id AND fe.state = 'active'
JOIN identity_claim ic ON ic.face_id = g.face_id AND ic.person_id = g.person_id AND ic.state = 'accepted'
WHERE g.membership_state = 'active';

CREATE FUNCTION cimmich_match_scores(
    p_query vector,
    p_model_family text,
    p_model_version text,
    p_config_digest text,
    p_bucket_kinds text[]
) RETURNS TABLE(person_id text, bucket_kind text, best_cosine_score double precision)
LANGUAGE sql STABLE AS $$
    SELECT mg.person_id, mg.bucket_kind,
           max(1 - (mg.embedding <=> p_query)) AS best_cosine_score
    FROM matching_gallery mg
    WHERE mg.model_family = p_model_family
      AND mg.model_version = p_model_version
      AND mg.config_digest = p_config_digest
      AND mg.bucket_kind = ANY (p_bucket_kinds)
      AND vector_dims(mg.embedding) = vector_dims(p_query)
    GROUP BY mg.person_id, mg.bucket_kind
    ORDER BY best_cosine_score DESC, mg.person_id, mg.bucket_kind;
$$;

CREATE FUNCTION purge_person(p_person_id text, p_delete_biometrics boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    v_face_ids text[];
    v_subject_ids text[];
    v_counts jsonb;
BEGIN
    SELECT COALESCE(array_agg(DISTINCT face_id), ARRAY[]::text[]) INTO v_face_ids
    FROM identity_claim WHERE person_id = p_person_id;

    v_counts := jsonb_build_object(
        'aliases', (SELECT count(*) FROM person_alias WHERE person_id = p_person_id),
        'identity_claims', (SELECT count(*) FROM identity_claim WHERE person_id = p_person_id),
        'embeddings', CASE WHEN p_delete_biometrics THEN (SELECT count(*) FROM face_embedding WHERE face_id = ANY(v_face_ids)) ELSE 0 END,
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
    END IF;

    DELETE FROM person WHERE person_id = p_person_id;
    DELETE FROM decision WHERE subject_id = ANY(v_subject_ids);

    INSERT INTO privacy_purge_receipt(person_token_digest, deleted_counts)
    VALUES (encode(digest(p_person_id, 'sha256'), 'hex'), v_counts);
    RETURN v_counts;
END;
$$;

COMMIT;
