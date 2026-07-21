BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_body_pose_evidence_v1', 'system',
    'cimmich-body-pose-evidence', 'v1', now(), now(),
    encode(digest('cimmich.body-pose.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE OR REPLACE FUNCTION cimmich_validate_coco17_keypoints(value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    expected_joints constant text[] := ARRAY[
        'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
        'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
        'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
        'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
    ];
    item jsonb;
    ordinal bigint;
BEGIN
    IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) <> 17 THEN
        RETURN false;
    END IF;

    FOR item, ordinal IN
        SELECT element, position
        FROM jsonb_array_elements(value) WITH ORDINALITY AS row(element, position)
    LOOP
        IF jsonb_typeof(item) <> 'object'
           OR item - ARRAY['joint','x','y','confidence'] <> '{}'::jsonb
           OR NOT item ?& ARRAY['joint','x','y','confidence']
           OR item->>'joint' <> expected_joints[ordinal]
           OR jsonb_typeof(item->'confidence') <> 'number'
           OR (item->>'confidence')::numeric NOT BETWEEN 0 AND 1
           OR (jsonb_typeof(item->'x') = 'null') <> (jsonb_typeof(item->'y') = 'null')
        THEN
            RETURN false;
        END IF;

        IF jsonb_typeof(item->'x') <> 'null' AND (
            jsonb_typeof(item->'x') <> 'number'
            OR jsonb_typeof(item->'y') <> 'number'
            OR (item->>'x')::numeric NOT BETWEEN 0 AND 1
            OR (item->>'y')::numeric NOT BETWEEN 0 AND 1
        ) THEN
            RETURN false;
        END IF;
    END LOOP;

    RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN false;
END;
$$;

CREATE TABLE body_pose_evidence (
    body_id text PRIMARY KEY
        REFERENCES body_observation(body_id) ON DELETE CASCADE,
    coordinate_space text NOT NULL
        CHECK (coordinate_space = 'normalized_image'),
    joint_schema text NOT NULL
        CHECK (joint_schema = 'coco17'),
    topology_id text NOT NULL
        CHECK (topology_id = 'coco17.v1'),
    keypoints jsonb NOT NULL
        CHECK (cimmich_validate_coco17_keypoints(keypoints)),
    provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 120),
    model_family text NOT NULL CHECK (length(btrim(model_family)) BETWEEN 1 AND 120),
    model_name text NOT NULL CHECK (length(btrim(model_name)) BETWEEN 1 AND 120),
    model_version text NOT NULL CHECK (length(btrim(model_version)) BETWEEN 1 AND 160),
    model_digest text NOT NULL
        CHECK (model_digest ~ '^sha256:[0-9a-f]{64}$'),
    source_schema_version text NOT NULL
        CHECK (length(btrim(source_schema_version)) BETWEEN 1 AND 160),
    source_artifact_digest text NOT NULL
        CHECK (source_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
    state text NOT NULL CHECK (state IN ('valid','invalidated')),
    producer_receipt_id text NOT NULL
        REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX body_pose_evidence_valid_body
    ON body_pose_evidence(body_id) WHERE state = 'valid';

COMMIT;
