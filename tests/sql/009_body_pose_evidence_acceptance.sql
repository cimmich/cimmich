\set ON_ERROR_STOP on

INSERT INTO body_pose_evidence (
    body_id, coordinate_space, joint_schema, topology_id, keypoints,
    provider, model_family, model_name, model_version, model_digest,
    source_schema_version, source_artifact_digest, state, producer_receipt_id
) VALUES (
    'body_identity_fixture', 'normalized_image', 'coco17', 'coco17.v1',
    '[
      {"joint":"nose","x":0.50,"y":0.10,"confidence":0.99},
      {"joint":"left_eye","x":0.48,"y":0.09,"confidence":0.98},
      {"joint":"right_eye","x":0.52,"y":0.09,"confidence":0.98},
      {"joint":"left_ear","x":null,"y":null,"confidence":0.01},
      {"joint":"right_ear","x":0.55,"y":0.11,"confidence":0.80},
      {"joint":"left_shoulder","x":0.42,"y":0.24,"confidence":0.97},
      {"joint":"right_shoulder","x":0.58,"y":0.24,"confidence":0.97},
      {"joint":"left_elbow","x":0.36,"y":0.39,"confidence":0.93},
      {"joint":"right_elbow","x":0.64,"y":0.39,"confidence":0.93},
      {"joint":"left_wrist","x":0.32,"y":0.54,"confidence":0.88},
      {"joint":"right_wrist","x":0.68,"y":0.54,"confidence":0.88},
      {"joint":"left_hip","x":0.45,"y":0.55,"confidence":0.96},
      {"joint":"right_hip","x":0.55,"y":0.55,"confidence":0.96},
      {"joint":"left_knee","x":0.44,"y":0.74,"confidence":0.91},
      {"joint":"right_knee","x":0.56,"y":0.74,"confidence":0.91},
      {"joint":"left_ankle","x":0.43,"y":0.93,"confidence":0.86},
      {"joint":"right_ankle","x":0.57,"y":0.93,"confidence":0.86}
    ]'::jsonb,
    'synthetic', 'synthetic-pose', 'synthetic-coco17', 'v1',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'synthetic.pose.v1',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'valid', 'receipt_service_fixture'
);

DO $$
BEGIN
    IF (SELECT count(*) FROM body_pose_evidence WHERE state = 'valid') <> 1 THEN
        RAISE EXCEPTION 'body pose evidence fixture was not stored exactly once';
    END IF;
    IF NOT cimmich_validate_coco17_keypoints(
        (SELECT keypoints FROM body_pose_evidence WHERE body_id = 'body_identity_fixture')
    ) THEN
        RAISE EXCEPTION 'valid COCO17 evidence failed validation';
    END IF;
    IF cimmich_validate_coco17_keypoints('[{"joint":"nose","x":0.5,"y":0.5,"confidence":1}]'::jsonb) THEN
        RAISE EXCEPTION 'incomplete COCO17 evidence passed validation';
    END IF;
    IF EXISTS (
        SELECT 1 FROM body_pose_evidence
        WHERE keypoints::text ILIKE '%' || chr(47) || 'Users' || chr(47) || '%'
           OR model_name ILIKE '%' || chr(47) || 'Users' || chr(47) || '%'
           OR source_schema_version ILIKE '%' || chr(47) || 'Users' || chr(47) || '%'
    ) THEN
        RAISE EXCEPTION 'body pose evidence leaked a source path';
    END IF;
END;
$$;
