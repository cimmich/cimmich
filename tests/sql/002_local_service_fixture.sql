BEGIN;

INSERT INTO source_snapshot (
  snapshot_id, input_schema_version, source_digest, locator_root_token,
  started_at, completed_at, declared_asset_count, observed_asset_count, state
) VALUES (
  'snapshot_service_acceptance', 'synthetic.v1', 'digest_service_acceptance', 'root_synthetic',
  now(), now(), 5, 5, 'complete'
);

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  source_snapshot_id, started_at, completed_at
) VALUES (
  'receipt_service_fixture', 'model', 'synthetic-service-fixture', 'v1',
  'snapshot_service_acceptance', now(), now()
);

INSERT INTO asset (
  asset_id, content_hash, locator_token, media_kind, mime_type, width, height,
  capture_time, source_snapshot_id, state
) VALUES (
  'asset_service_fixture', 'synthetic:service-fixture', 'locator_service_fixture',
  'image', 'image/jpeg', 1000, 800, '2020-02-01T00:00:00Z', 'snapshot_service_acceptance', 'active'
);

INSERT INTO asset (
  asset_id, content_hash, locator_token, media_kind, mime_type, width, height,
  capture_time, source_snapshot_id, state
) VALUES (
  'asset_identity_fixture', 'synthetic:identity-fixture', 'locator_identity_fixture',
  'image', 'image/jpeg', 1200, 1600, '2020-01-01T00:00:00Z', 'snapshot_service_acceptance', 'active'
);

INSERT INTO asset (
  asset_id, content_hash, locator_token, media_kind, mime_type, width, height,
  capture_time, source_snapshot_id, state
) VALUES (
  'asset_split_fixture', 'synthetic:split-fixture', 'locator_split_fixture',
  'image', 'image/jpeg', 900, 1200, '2020-03-01T00:00:00Z', 'snapshot_service_acceptance', 'active'
);

INSERT INTO asset (
  asset_id, content_hash, locator_token, media_kind, mime_type, width, height,
  capture_time, source_snapshot_id, state
) VALUES
  (
    'asset_body_link_clear_fixture', 'synthetic:body-link-clear', 'locator_body_link_clear_fixture',
    'image', 'image/jpeg', 1000, 1000, '2020-04-01T00:00:00Z', 'snapshot_service_acceptance', 'active'
  ),
  (
    'asset_body_link_ambiguous_fixture', 'synthetic:body-link-ambiguous', 'locator_body_link_ambiguous_fixture',
    'image', 'image/jpeg', 1000, 1000, '2020-04-02T00:00:00Z', 'snapshot_service_acceptance', 'active'
  );

INSERT INTO person (
  person_id, display_name, status, created_by_receipt_id
) VALUES
  ('person_service_fixture', 'Synthetic Person', 'active', 'receipt_service_fixture'),
  ('person_candidate_fixture', 'Synthetic Candidate Person', 'active', 'receipt_service_fixture'),
  ('person_same_photo_fixture', 'Synthetic Same Photo', 'active', 'receipt_service_fixture'),
  ('person_match_fixture', 'Synthetic Closest Match', 'active', 'receipt_service_fixture'),
  ('person_reassign_fixture', 'Synthetic Person Two', 'active', 'receipt_service_fixture'),
  ('person_split_fixture', 'Synthetic Split Source', 'active', 'receipt_service_fixture'),
  ('person_body_link_fixture', 'Synthetic Body Link', 'active', 'receipt_service_fixture');

INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id
) VALUES (
  'face_service_fixture', 'asset_service_fixture', 0.25, 0.20, 0.20, 0.25, 0.92,
  '{"quality_score":0.81,"quality_bucket":"clean_core"}', 'valid', 'receipt_service_fixture'
), (
  'face_new_person_fixture', 'asset_service_fixture', 0.86, 0.05, 0.10, 0.15, 0.91,
  '{"quality_score":0.80,"quality_bucket":"clean_core"}', 'valid', 'receipt_service_fixture'
);

INSERT INTO person_alias (
  alias_id, person_id, label, alias_kind, state, producer_receipt_id
) VALUES (
  'alias_reassign_collision_fixture', 'person_reassign_fixture',
  'Synthetic Existing Alias', 'nickname', 'active', 'receipt_service_fixture'
);

INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id
) VALUES
  (
    'face_candidate_high_fixture', 'asset_service_fixture', 0.54, 0.18, 0.16, 0.22, 0.94,
    '{"quality_score":0.84,"quality_bucket":"clean_core"}', 'valid', 'receipt_service_fixture'
  ),
  (
    'face_candidate_low_fixture', 'asset_service_fixture', 0.76, 0.24, 0.12, 0.18, 0.79,
    '{"quality_score":0.61,"quality_bucket":"difficult"}', 'valid', 'receipt_service_fixture'
  ),
  (
    'face_candidate_reconciliation_fixture', 'asset_service_fixture', 0.245, 0.195, 0.21, 0.26, 0.90,
    '{"quality_score":0.80,"quality_bucket":"import_reconciliation"}', 'valid', 'receipt_service_fixture'
  ),
  (
    'face_same_photo_accepted_fixture', 'asset_service_fixture', 0.10, 0.70, 0.08, 0.12, 0.93,
    '{"quality_score":0.85,"quality_bucket":"clean_core"}', 'valid', 'receipt_service_fixture'
  ),
  (
    'face_same_photo_low_fixture', 'asset_service_fixture', 0.22, 0.70, 0.08, 0.12, 0.90,
    '{"quality_score":0.82,"quality_bucket":"clean_core"}', 'valid', 'receipt_service_fixture'
  ),
  (
    'face_same_photo_strong_fixture', 'asset_service_fixture', 0.34, 0.70, 0.08, 0.12, 0.91,
    '{"quality_score":0.83,"quality_bucket":"clean_core"}', 'valid', 'receipt_service_fixture'
  );

INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id
) VALUES (
  'face_identity_fixture', 'asset_identity_fixture', 0.38, 0.12, 0.18, 0.15, 0.96,
  '{"quality_score":0.91,"quality_bucket":"clean_core"}', 'valid', 'receipt_service_fixture'
);

INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id
) VALUES (
  'face_match_fixture', 'asset_service_fixture', 0.05, 0.12, 0.14, 0.20, 0.93,
  '{"quality_score":0.88,"quality_bucket":"clean_core"}', 'valid', 'receipt_service_fixture'
);

INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id
) VALUES (
  'face_split_fixture', 'asset_split_fixture', 0.35, 0.10, 0.20, 0.18, 0.80,
  '{"quality_score":0.62,"quality_bucket":"head_only"}', 'valid', 'receipt_service_fixture'
);

INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id
) VALUES
  (
    'face_body_link_clear_fixture', 'asset_body_link_clear_fixture', 0.40, 0.12, 0.16, 0.16, 0.95,
    '{"quality_score":0.90}', 'valid', 'receipt_service_fixture'
  ),
  (
    'face_body_link_ambiguous_fixture', 'asset_body_link_ambiguous_fixture', 0.40, 0.12, 0.16, 0.16, 0.95,
    '{"quality_score":0.90}', 'valid', 'receipt_service_fixture'
  );

INSERT INTO face_embedding (
  embedding_id, face_id, model_family, model_version, config_digest, dimension,
  normalized, embedding, vector_digest, state, producer_receipt_id
) VALUES
  (
    'embedding_identity_fixture', 'face_identity_fixture', 'synthetic-face', 'v1',
    'synthetic-config', 4, true, '[1,0,0,0]',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'active', 'receipt_service_fixture'
  ),
  (
    'embedding_split_fixture', 'face_split_fixture', 'synthetic-face', 'v1',
    'synthetic-config', 4, true, '[0,1,0,0]',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'active', 'receipt_service_fixture'
  ),
  (
    'embedding_match_fixture', 'face_match_fixture', 'synthetic-face', 'v1',
    'synthetic-config', 4, true, '[0.98,0.198997487,0,0]',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'active', 'receipt_service_fixture'
  );

INSERT INTO body_observation (
  body_id, asset_id, box_x, box_y, box_w, box_h, quality_measurements,
  state, producer_receipt_id
) VALUES (
  'body_identity_fixture', 'asset_identity_fixture', 0.20, 0.06, 0.55, 0.88,
  '{"quality_score":0.89}', 'valid', 'receipt_service_fixture'
);

INSERT INTO body_observation (
  body_id, asset_id, box_x, box_y, box_w, box_h, quality_measurements,
  state, producer_receipt_id
) VALUES (
  'body_split_fixture', 'asset_split_fixture', 0.18, 0.04, 0.58, 0.90,
  '{"quality_score":0.77}', 'valid', 'receipt_service_fixture'
);

INSERT INTO body_observation (
  body_id, asset_id, box_x, box_y, box_w, box_h,
  head_box_x, head_box_y, head_box_w, head_box_h,
  quality_measurements, state, producer_receipt_id
) VALUES
  (
    'body_link_clear_fixture', 'asset_body_link_clear_fixture', 0.20, 0.04, 0.60, 0.92,
    0.34, 0.08, 0.32, 0.26, '{"quality_score":0.92}', 'valid', 'receipt_service_fixture'
  ),
  (
    'body_link_ambiguous_a_fixture', 'asset_body_link_ambiguous_fixture', 0.20, 0.04, 0.60, 0.92,
    0.34, 0.08, 0.32, 0.26, '{"quality_score":0.92}', 'valid', 'receipt_service_fixture'
  ),
  (
    'body_link_ambiguous_b_fixture', 'asset_body_link_ambiguous_fixture', 0.20, 0.04, 0.60, 0.92,
    0.34, 0.08, 0.32, 0.26, '{"quality_score":0.92}', 'valid', 'receipt_service_fixture'
  );

INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, producer_receipt_id
) VALUES (
  'decision_identity_fixture', 'identity_claim', 'claim_identity_fixture', 'accept',
  'trusted_import', 'synthetic-fixture', 'synthetic_truth', 'receipt_service_fixture'
);

INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state, calibrated_confidence,
  evidence_refs, decision_id, producer_receipt_id
) VALUES (
  'claim_identity_fixture', 'face_identity_fixture', 'person_service_fixture',
  'trusted_import', 'accepted', 0.99, '["synthetic"]',
  'decision_identity_fixture', 'receipt_service_fixture'
);

INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, producer_receipt_id
) VALUES (
  'decision_split_fixture', 'identity_claim', 'claim_split_fixture', 'accept',
  'trusted_import', 'synthetic-fixture', 'synthetic_split_truth', 'receipt_service_fixture'
);

INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state, calibrated_confidence,
  evidence_refs, decision_id, producer_receipt_id
) VALUES (
  'claim_split_fixture', 'face_split_fixture', 'person_split_fixture',
  'trusted_import', 'accepted', 0.95, '["synthetic-split"]',
  'decision_split_fixture', 'receipt_service_fixture'
);

INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, producer_receipt_id
) VALUES (
  'decision_match_fixture', 'identity_claim', 'claim_match_fixture', 'accept',
  'trusted_import', 'synthetic-fixture', 'synthetic_match_truth', 'receipt_service_fixture'
);

INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state, calibrated_confidence,
  evidence_refs, decision_id, producer_receipt_id
) VALUES (
  'claim_match_fixture', 'face_match_fixture', 'person_match_fixture',
  'trusted_import', 'accepted', 0.97, '["synthetic-match"]',
  'decision_match_fixture', 'receipt_service_fixture'
);

INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, producer_receipt_id
) VALUES
  ('decision_body_link_clear_fixture', 'identity_claim', 'claim_body_link_clear_fixture', 'accept',
   'trusted_import', 'synthetic-fixture', 'synthetic_body_link_truth', 'receipt_service_fixture'),
  ('decision_body_link_ambiguous_fixture', 'identity_claim', 'claim_body_link_ambiguous_fixture', 'accept',
   'trusted_import', 'synthetic-fixture', 'synthetic_body_link_truth', 'receipt_service_fixture');

INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state, calibrated_confidence,
  evidence_refs, decision_id, producer_receipt_id
) VALUES
  ('claim_body_link_clear_fixture', 'face_body_link_clear_fixture', 'person_body_link_fixture',
   'trusted_import', 'accepted', 0.99, '["synthetic-body-link"]',
   'decision_body_link_clear_fixture', 'receipt_service_fixture'),
  ('claim_body_link_ambiguous_fixture', 'face_body_link_ambiguous_fixture', 'person_body_link_fixture',
   'trusted_import', 'accepted', 0.99, '["synthetic-body-link"]',
   'decision_body_link_ambiguous_fixture', 'receipt_service_fixture');

INSERT INTO body_tag (
  body_tag_id, person_id, body_id, origin, state, producer_receipt_id
) VALUES (
  'body_tag_split_fixture', 'person_split_fixture', 'body_split_fixture',
  'trusted_import', 'accepted', 'receipt_service_fixture'
);

INSERT INTO reference_bucket (
  bucket_id, person_id, bucket_kind, created_by, policy_version, state,
  producer_receipt_id
) VALUES
  ('bucket_identity_prime', 'person_service_fixture', 'prime', 'system', 'synthetic-v1', 'active', 'receipt_service_fixture'),
  ('bucket_identity_secondary', 'person_service_fixture', 'secondary', 'system', 'synthetic-v1', 'active', 'receipt_service_fixture');

INSERT INTO reference_bucket (
  bucket_id, person_id, bucket_kind, created_by, policy_version, state,
  producer_receipt_id
) VALUES (
  'bucket_split_head', 'person_split_fixture', 'head', 'user', 'synthetic-v1', 'active', 'receipt_service_fixture'
);

INSERT INTO bucket_membership_event (
  membership_event_id, bucket_id, face_id, action, actor_kind,
  reason_code, reason_text, producer_receipt_id
) VALUES (
  'membership_split_head', 'bucket_split_head', 'face_split_fixture', 'pin', 'user',
  'synthetic_head', 'Synthetic Head tier', 'receipt_service_fixture'
);

INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state, calibrated_confidence,
  evidence_refs, producer_receipt_id
) VALUES (
  'claim_service_fixture', 'face_service_fixture', 'person_service_fixture',
  'prime_match', 'candidate', 0.88, '{"automatic_acceptance":true}', 'receipt_service_fixture'
);

INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state,
  evidence_refs, producer_receipt_id
) VALUES
  (
    'claim_candidate_high_fixture', 'face_candidate_high_fixture', 'person_candidate_fixture',
    'prime_match', 'candidate',
    '{"automatic_acceptance":false,"best_score":1.12,"margin":0.31}', 'receipt_service_fixture'
  ),
  (
    'claim_candidate_low_fixture', 'face_candidate_low_fixture', 'person_candidate_fixture',
    'secondary_match', 'candidate',
    '{"automatic_acceptance":false,"best_score":0.42,"margin":0.08}', 'receipt_service_fixture'
  );

INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, producer_receipt_id
) VALUES (
  'decision_same_photo_accepted_fixture', 'identity_claim', 'claim_same_photo_accepted_fixture', 'accept',
  'trusted_import', 'synthetic-fixture', 'synthetic_same_photo_truth', 'receipt_service_fixture'
);

INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state,
  evidence_refs, decision_id, producer_receipt_id
) VALUES
  (
    'claim_same_photo_accepted_fixture', 'face_same_photo_accepted_fixture', 'person_same_photo_fixture',
    'trusted_import', 'accepted',
    '{"automatic_acceptance":false}', 'decision_same_photo_accepted_fixture', 'receipt_service_fixture'
  ),
  (
    'claim_same_photo_low_fixture', 'face_same_photo_low_fixture', 'person_same_photo_fixture',
    'prime_match', 'candidate',
    '{"automatic_acceptance":false,"best_score":0.79,"margin":0.20}', null, 'receipt_service_fixture'
  ),
  (
    'claim_same_photo_strong_fixture', 'face_same_photo_strong_fixture', 'person_same_photo_fixture',
    'prime_match', 'candidate',
    '{"automatic_acceptance":false,"best_score":0.80,"margin":0.21}', null, 'receipt_service_fixture'
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO identity_claim (
      identity_claim_id, face_id, person_id, origin, state,
      evidence_refs, producer_receipt_id
    ) VALUES (
      'claim_candidate_reconciliation_fixture', 'face_candidate_reconciliation_fixture',
      'person_candidate_fixture', 'prime_match', 'candidate',
      '{"automatic_acceptance":false,"best_score":0.97,"margin":0.0,"assignment_decision":"accepted_matched_digikam_sidecar_face"}',
      'receipt_service_fixture'
    );
    RAISE EXCEPTION 'source reconciliation was admitted as an identity candidate';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO presence_tag (
  presence_tag_id, person_id, asset_id, origin, reason_code, note, state,
  producer_receipt_id
) VALUES (
  'presence_asset_head_fixture', 'person_reassign_fixture', 'asset_service_fixture',
  'trusted_import', 'synthetic_presence', '', 'accepted', 'receipt_service_fixture'
);

COMMIT;
