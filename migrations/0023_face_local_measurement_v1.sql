BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_face_local_measurement_v1', 'system',
    'cimmich-face-local-measurement', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at;

-- Append-only, provider-local evidence. These rows measure a face crop; they do
-- not assert identity, assign a modifier, or change matching authority.
CREATE TABLE face_local_measurement (
    measurement_id text PRIMARY KEY,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    measurement_state text NOT NULL CHECK (measurement_state IN ('measured','abstained')),
    provider_name text NOT NULL,
    model_name text NOT NULL,
    model_version text NOT NULL,
    config_digest text NOT NULL,
    measurement_version text NOT NULL,
    crop_policy_version text NOT NULL,
    policy_version text NOT NULL,
    crop_digests jsonb NOT NULL,
    target_selection jsonb NOT NULL,
    contamination jsonb NOT NULL,
    geometry jsonb NOT NULL,
    pose jsonb,
    photometrics jsonb,
    visibility jsonb NOT NULL,
    quality jsonb,
    derived jsonb NOT NULL,
    abstention_reason text,
    supersedes_measurement_id text REFERENCES face_local_measurement(measurement_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(btrim(provider_name)) BETWEEN 1 AND 120),
    CHECK (length(btrim(model_name)) BETWEEN 1 AND 120),
    CHECK (length(btrim(model_version)) BETWEEN 1 AND 120),
    CHECK (length(config_digest) BETWEEN 16 AND 128),
    CHECK (length(measurement_version) BETWEEN 1 AND 120),
    CHECK (length(crop_policy_version) BETWEEN 1 AND 120),
    CHECK (length(policy_version) BETWEEN 1 AND 120),
    CHECK (jsonb_typeof(crop_digests) = 'object' AND crop_digests <> '{}'::jsonb),
    CHECK (jsonb_typeof(target_selection) = 'object'),
    CHECK (jsonb_typeof(contamination) = 'object'),
    CHECK (jsonb_typeof(geometry) = 'object'),
    CHECK (pose IS NULL OR jsonb_typeof(pose) = 'object'),
    CHECK (photometrics IS NULL OR jsonb_typeof(photometrics) = 'object'),
    CHECK (jsonb_typeof(visibility) = 'object'),
    CHECK (quality IS NULL OR jsonb_typeof(quality) = 'object'),
    CHECK (jsonb_typeof(derived) = 'object'),
    CHECK ((measurement_state = 'abstained') = (abstention_reason IS NOT NULL)),
    CHECK (supersedes_measurement_id IS NULL OR supersedes_measurement_id <> measurement_id)
);

CREATE INDEX face_local_measurement_face_lookup
    ON face_local_measurement(face_id, created_at DESC, measurement_id DESC);

CREATE INDEX face_local_measurement_supersedes_lookup
    ON face_local_measurement(supersedes_measurement_id)
    WHERE supersedes_measurement_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_face_local_measurement_update()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Face-local measurements are immutable; append a successor measurement'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER face_local_measurement_immutable
BEFORE UPDATE ON face_local_measurement
FOR EACH ROW EXECUTE FUNCTION prevent_face_local_measurement_update();

-- A face may have independent provider streams. Current means every unsuperseded
-- tip, not whichever provider happened to run most recently.
CREATE VIEW current_face_local_measurement AS
SELECT measurement.*
FROM face_local_measurement measurement
WHERE NOT EXISTS (
    SELECT 1
    FROM face_local_measurement successor
    WHERE successor.supersedes_measurement_id = measurement.measurement_id
);

-- Burst/context continuity may recover a missing-frame candidate, but only
-- trusted People may seed it. Sort/Holding state is therefore an explicit
-- algorithmic trust boundary, and model-created contexts require high
-- confidence. This remains a read-only candidate view.
CREATE OR REPLACE VIEW capture_context_presence_candidate AS
WITH accepted_context_people AS (
    SELECT member.context_id, identity.person_id,
           count(DISTINCT member.asset_id)::int AS supporting_asset_count
    FROM current_capture_context_member member
    JOIN capture_context context USING (context_id)
    JOIN face_observation face ON face.asset_id = member.asset_id AND face.state = 'valid'
    JOIN current_face_identity identity ON identity.face_id = face.face_id
        AND identity.state = 'accepted'
    JOIN current_person_review_state review ON review.person_id = identity.person_id
        AND review.matching_authority = 'trusted'
    WHERE context.created_by <> 'model'
       OR (
           context.confidence >= 0.90
           AND member.confidence >= 0.90
           AND context.grouping_features->>'candidateOnly' = 'true'
       )
    GROUP BY member.context_id, identity.person_id
    HAVING count(DISTINCT member.asset_id) >= 2
)
SELECT support.context_id, support.person_id, member.asset_id,
       support.supporting_asset_count,
       LEAST(
           0.90,
           coalesce(context.confidence, 0.5) * (0.45 + 0.1 * support.supporting_asset_count)
       )::numeric AS confidence,
       jsonb_build_object(
           'candidateOnly', true,
           'reason', 'capture_context_gap',
           'contextKind', context.context_kind,
           'contextConfidence', context.confidence,
           'supportingAssetCount', support.supporting_asset_count,
           'sortAndHoldingExcluded', true
       ) AS evidence_refs
FROM accepted_context_people support
JOIN current_capture_context_member member USING (context_id)
JOIN capture_context context USING (context_id)
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
        'face_local_measurements', CASE WHEN p_delete_biometrics THEN (SELECT count(*) FROM face_local_measurement WHERE face_id = ANY(v_face_ids)) ELSE 0 END,
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
        DELETE FROM face_local_measurement WHERE face_id = ANY(v_face_ids);
    END IF;

    DELETE FROM person WHERE person_id = p_person_id;
    DELETE FROM decision WHERE subject_id = ANY(v_subject_ids) OR decision_id = ANY(v_modifier_decision_ids);

    INSERT INTO privacy_purge_receipt(person_token_digest, deleted_counts)
    VALUES (encode(digest(p_person_id, 'sha256'), 'hex'), v_counts);
    RETURN v_counts;
END;
$$;

COMMIT;
