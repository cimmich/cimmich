BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_face_modifier_proposal_v1', 'system',
    'cimmich-face-modifier-proposal', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

CREATE TABLE face_modifier_proposal (
    proposal_id text PRIMARY KEY,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    modifier_key text NOT NULL,
    modifier_label text NOT NULL,
    modifier_class text NOT NULL
        CHECK (modifier_class IN ('accessory_obstruction','pose','illumination','visibility')),
    provider_name text NOT NULL,
    model_name text NOT NULL,
    model_version text NOT NULL,
    config_digest text NOT NULL,
    vocabulary_version text NOT NULL,
    calibrated_confidence numeric NOT NULL CHECK (calibrated_confidence BETWEEN 0 AND 1),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    crop_digest text NOT NULL,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (modifier_key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
    CHECK (length(btrim(modifier_label)) BETWEEN 1 AND 64),
    CHECK (length(btrim(provider_name)) BETWEEN 1 AND 120),
    CHECK (length(btrim(model_name)) BETWEEN 1 AND 120),
    CHECK (length(btrim(model_version)) BETWEEN 1 AND 120),
    CHECK (length(config_digest) BETWEEN 16 AND 128),
    CHECK (length(vocabulary_version) BETWEEN 1 AND 120),
    CHECK (length(crop_digest) BETWEEN 16 AND 128),
    UNIQUE (face_id, modifier_key, provider_name, model_name, model_version,
            config_digest, vocabulary_version, crop_digest)
);

CREATE INDEX face_modifier_proposal_face_lookup
    ON face_modifier_proposal(face_id, modifier_key, created_at DESC, proposal_id DESC);

CREATE TABLE face_modifier_proposal_event (
    proposal_event_id text PRIMARY KEY,
    proposal_id text NOT NULL REFERENCES face_modifier_proposal(proposal_id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('candidate','accept','reject','supersede')),
    actor_kind text NOT NULL CHECK (actor_kind IN ('user','policy','model')),
    actor_id text NOT NULL,
    note text NOT NULL DEFAULT '',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    decision_id text REFERENCES decision(decision_id),
    supersedes_event_id text REFERENCES face_modifier_proposal_event(proposal_event_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (action = 'candidate' OR decision_id IS NOT NULL),
    CHECK (actor_kind <> 'user' OR decision_id IS NOT NULL),
    CHECK (action <> 'candidate' OR actor_kind IN ('model','policy'))
);

CREATE INDEX face_modifier_proposal_event_lookup
    ON face_modifier_proposal_event(proposal_id, created_at DESC, proposal_event_id DESC);

CREATE VIEW current_face_modifier_proposal AS
SELECT proposal.proposal_id, proposal.face_id, proposal.modifier_key,
       proposal.modifier_label, proposal.modifier_class,
       proposal.provider_name, proposal.model_name, proposal.model_version,
       proposal.config_digest, proposal.vocabulary_version,
       proposal.calibrated_confidence, proposal.evidence, proposal.crop_digest,
       latest.action AS state, latest.actor_kind, latest.actor_id,
       latest.note, latest.metadata AS decision_metadata,
       latest.decision_id, latest.proposal_event_id,
       proposal.created_at AS proposed_at, latest.created_at AS decided_at
FROM face_modifier_proposal proposal
JOIN LATERAL (
    SELECT event.*
    FROM face_modifier_proposal_event event
    WHERE event.proposal_id = proposal.proposal_id
    ORDER BY event.created_at DESC, event.proposal_event_id DESC
    LIMIT 1
) latest ON true;

-- Later-table purge coverage: proposal decisions are private biometric state
-- and must follow the same explicit delete-biometrics boundary as modifiers.
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
    FROM (
        SELECT decision_id FROM face_modifier_event WHERE face_id = ANY(v_face_ids)
        UNION ALL
        SELECT event.decision_id
        FROM face_modifier_proposal_event event
        JOIN face_modifier_proposal proposal USING (proposal_id)
        WHERE proposal.face_id = ANY(v_face_ids)
    ) decisions;

    v_counts := jsonb_build_object(
        'aliases', (SELECT count(*) FROM person_alias WHERE person_id = p_person_id),
        'identity_claims', (SELECT count(*) FROM identity_claim WHERE person_id = p_person_id),
        'embeddings', CASE WHEN p_delete_biometrics THEN (SELECT count(*) FROM face_embedding WHERE face_id = ANY(v_face_ids)) ELSE 0 END,
        'face_modifiers', CASE WHEN p_delete_biometrics THEN (SELECT count(*) FROM face_modifier_event WHERE face_id = ANY(v_face_ids)) ELSE 0 END,
        'modifier_proposals', CASE WHEN p_delete_biometrics THEN (SELECT count(*) FROM face_modifier_proposal WHERE face_id = ANY(v_face_ids)) ELSE 0 END,
        'body_tags', (SELECT count(*) FROM body_tag WHERE person_id = p_person_id),
        'presence_tags', (SELECT count(*) FROM presence_tag WHERE person_id = p_person_id),
        'buckets', (SELECT count(*) FROM reference_bucket WHERE person_id = p_person_id)
    );

    SELECT ARRAY[p_person_id]
           || COALESCE((SELECT array_agg(identity_claim_id) FROM identity_claim WHERE person_id = p_person_id), ARRAY[]::text[])
           || COALESCE((SELECT array_agg(body_tag_id) FROM body_tag WHERE person_id = p_person_id), ARRAY[]::text[])
           || COALESCE((SELECT array_agg(presence_tag_id) FROM presence_tag WHERE person_id = p_person_id), ARRAY[]::text[])
           || COALESCE((SELECT array_agg(bucket_id) FROM reference_bucket WHERE person_id = p_person_id), ARRAY[]::text[])
           || COALESCE((SELECT array_agg(proposal_id) FROM face_modifier_proposal WHERE face_id = ANY(v_face_ids)), ARRAY[]::text[])
    INTO v_subject_ids;

    IF p_delete_biometrics THEN
        DELETE FROM artifact WHERE owner_type = 'face_observation' AND owner_id = ANY(v_face_ids);
        DELETE FROM face_embedding WHERE face_id = ANY(v_face_ids);
        DELETE FROM face_modifier_event WHERE face_id = ANY(v_face_ids);
        DELETE FROM face_modifier_proposal WHERE face_id = ANY(v_face_ids);
    END IF;

    DELETE FROM person WHERE person_id = p_person_id;
    DELETE FROM decision WHERE subject_id = ANY(v_subject_ids) OR decision_id = ANY(v_modifier_decision_ids);

    INSERT INTO privacy_purge_receipt(person_token_digest, deleted_counts)
    VALUES (encode(digest(p_person_id, 'sha256'), 'hex'), v_counts);
    RETURN v_counts;
END;
$$;

COMMIT;
