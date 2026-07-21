\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION assert_true(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(ok, false) THEN
    RAISE EXCEPTION 'acceptance failure: %', message;
  END IF;
END;
$$;

INSERT INTO source_snapshot VALUES
('snapshot_synthetic','fixture-v1','digest_synthetic','locator_synthetic',now(),now(),8,8,'complete','release-safe',1,now());

INSERT INTO producer_receipt(producer_receipt_id,producer_kind,producer_name,producer_version,config_digest,source_snapshot_id,started_at,completed_at,result_digest,privacy_class)
VALUES
('receipt_user','user','synthetic-user','1',NULL,'snapshot_synthetic',now(),now(),'result_user','release-safe'),
('receipt_import','trusted_import','synthetic-import','1','config_import','snapshot_synthetic',now(),now(),'result_import','release-safe'),
('receipt_model','model','synthetic-model','1','config_model','snapshot_synthetic',now(),now(),'result_model','release-safe'),
('receipt_policy','system','synthetic-policy','1','config_policy','snapshot_synthetic',now(),now(),'result_policy','release-safe'),
('receipt_link','derived_linkage','synthetic-linkage','1','config_link','snapshot_synthetic',now(),now(),'result_link','release-safe');

INSERT INTO asset(asset_id,content_hash,locator_token,media_kind,mime_type,width,height,source_snapshot_id,state,privacy_class)
SELECT id, 'hash_'||id, 'token_'||id, 'image','image/x-synthetic',1000,1000,'snapshot_synthetic','active','release-safe'
FROM unnest(ARRAY['asset_faces','asset_body_user','asset_body_link','asset_presence_user','asset_presence_series','asset_unknown','asset_other','asset_spare']) id;

INSERT INTO person(person_id,display_name,status,created_by_receipt_id,privacy_class) VALUES
('person_alpha','Synthetic Alpha','active','receipt_user','release-safe'),
('person_beta','Synthetic Beta','active','receipt_user','release-safe');
INSERT INTO person_alias(alias_id,person_id,label,alias_kind,state,producer_receipt_id,privacy_class) VALUES
('alias_alpha','person_alpha','Alpha Alias','nickname','active','receipt_user','release-safe');
SELECT assert_true((SELECT count(*)=1 FROM current_person WHERE person_id='person_alpha' AND 'Alpha Alias'=ANY(aliases)), '1 person aliases');

INSERT INTO face_observation(face_id,asset_id,box_x,box_y,box_w,box_h,detection_confidence,quality_measurements,state,producer_receipt_id,privacy_class)
SELECT id, CASE WHEN id LIKE 'unknown%' THEN 'asset_unknown' ELSE 'asset_faces' END,
       0.1,0.1,0.2,0.2,0.99,jsonb_build_object('quality',q,'source_group',g),'valid','receipt_model','release-safe'
FROM (VALUES
 ('alpha_1',0.99,'a'),('alpha_2',0.97,'b'),('alpha_3',0.95,'c'),('alpha_4',0.995,'d'),
 ('alpha_secondary',0.70,'e'),('alpha_sunglasses',0.60,'f'),
 ('beta_1',0.96,'g'),('beta_2',0.90,'h'),('unknown_1',0.80,'i'),('unknown_2',0.75,'j')) v(id,q,g);

INSERT INTO artifact(artifact_id,owner_type,owner_id,artifact_kind,storage_key,content_digest,mime_type,state,producer_receipt_id,privacy_class)
VALUES ('artifact_alpha_4','face_observation','alpha_4','crop','synthetic/artifact_alpha_4','artifact_digest','image/x-synthetic','active','receipt_model','release-safe');
UPDATE face_observation SET crop_artifact_id='artifact_alpha_4' WHERE face_id='alpha_4';

INSERT INTO decision(decision_id,subject_type,subject_id,action,actor_kind,actor_id,reason_code,producer_receipt_id,privacy_class)
SELECT 'decision_'||id,'identity_claim','claim_'||id,'accept','trusted_import','fixture','synthetic_truth','receipt_import','release-safe'
FROM unnest(ARRAY['alpha_1','alpha_2','alpha_3','alpha_4','alpha_secondary','alpha_sunglasses','beta_1','beta_2']) id;

INSERT INTO identity_claim(identity_claim_id,face_id,person_id,origin,state,evidence_refs,decision_id,producer_receipt_id,privacy_class)
SELECT 'claim_'||id,id,CASE WHEN id LIKE 'beta%' THEN 'person_beta' ELSE 'person_alpha' END,
       'trusted_import','accepted','["synthetic"]', 'decision_'||id,'receipt_import','release-safe'
FROM unnest(ARRAY['alpha_1','alpha_2','alpha_3','alpha_4','alpha_secondary','alpha_sunglasses','beta_1','beta_2']) id;
SELECT assert_true((SELECT count(*)=8 FROM identity_claim WHERE state='accepted'), '2 accepted synthetic faces');

INSERT INTO face_embedding(embedding_id,face_id,model_family,model_version,config_digest,dimension,normalized,embedding,vector_digest,state,producer_receipt_id,privacy_class) VALUES
('emb_alpha_1','alpha_1','synthetic-face','1','cfg',4,true,'[1,0,0,0]','v1','active','receipt_model','release-safe'),
('emb_alpha_2','alpha_2','synthetic-face','1','cfg',4,true,'[0.999,0.03,0,0]','v2','active','receipt_model','release-safe'),
('emb_alpha_3','alpha_3','synthetic-face','1','cfg',4,true,'[0.995,-0.05,0,0]','v3','active','receipt_model','release-safe'),
('emb_alpha_4','alpha_4','synthetic-face','1','cfg',4,true,'[0.999,0.01,0,0]','v4','active','receipt_model','release-safe'),
('emb_alpha_secondary','alpha_secondary','synthetic-face','1','cfg',4,true,'[0.7,0.7,0,0]','v5','active','receipt_model','release-safe'),
('emb_alpha_sunglasses','alpha_sunglasses','synthetic-face','1','cfg',4,true,'[0,0,1,0]','v6','active','receipt_model','release-safe'),
('emb_beta_1','beta_1','synthetic-face','1','cfg',4,true,'[0.99,0.05,0,0]','v7','active','receipt_model','release-safe'),
('emb_beta_2','beta_2','synthetic-face','1','cfg',4,true,'[0.98,0.08,0,0]','v8','active','receipt_model','release-safe'),
('emb_unknown_1','unknown_1','synthetic-face','1','cfg',4,true,'[0,1,0,0]','v9','active','receipt_model','release-safe'),
('emb_unknown_2','unknown_2','synthetic-face','1','cfg',4,true,'[0,0.99,0.05,0]','v10','active','receipt_model','release-safe');

INSERT INTO reference_bucket(bucket_id,person_id,bucket_kind,name,activation_hints,created_by,policy_version,state,producer_receipt_id,privacy_class) VALUES
('bucket_alpha_prime','person_alpha','prime',NULL,NULL,'system','policy-v1','active','receipt_policy','release-safe'),
('bucket_alpha_secondary','person_alpha','secondary',NULL,NULL,'system','policy-v1','active','receipt_policy','release-safe'),
('bucket_alpha_sunglasses','person_alpha','specialty','sunglasses','{"condition":"sunglasses"}','user','policy-v1','active','receipt_user','release-safe'),
('bucket_beta_prime','person_beta','prime',NULL,NULL,'system','policy-v1','active','receipt_policy','release-safe'),
('bucket_beta_secondary','person_beta','secondary',NULL,NULL,'system','policy-v1','active','receipt_policy','release-safe');

INSERT INTO bucket_membership_event(membership_event_id,bucket_id,face_id,action,actor_kind,reason_code,policy_version,producer_receipt_id,privacy_class) VALUES
('m_a1_p','bucket_alpha_prime','alpha_1','activate','policy','initial_prime','policy-v1','receipt_policy','release-safe'),
('m_a2_p','bucket_alpha_prime','alpha_2','activate','policy','initial_prime','policy-v1','receipt_policy','release-safe'),
('m_a3_p','bucket_alpha_prime','alpha_3','activate','policy','initial_prime','policy-v1','receipt_policy','release-safe'),
('m_as_s','bucket_alpha_secondary','alpha_secondary','activate','policy','usable_nonprime','policy-v1','receipt_policy','release-safe'),
('m_sg_s','bucket_alpha_secondary','alpha_sunglasses','activate','policy','usable_nonprime','policy-v1','receipt_policy','release-safe'),
('m_b1_p','bucket_beta_prime','beta_1','activate','policy','initial_prime','policy-v1','receipt_policy','release-safe'),
('m_b2_p','bucket_beta_prime','beta_2','activate','policy','initial_prime','policy-v1','receipt_policy','release-safe');
SELECT assert_true((SELECT count(*)=3 FROM current_reference_gallery WHERE person_id='person_alpha' AND bucket_kind='prime' AND membership_state='active'), '3 prime set');
SELECT assert_true((SELECT count(*)=2 FROM current_reference_gallery WHERE person_id='person_alpha' AND bucket_kind='secondary' AND membership_state='active'), '3 secondary set');

DO $$
BEGIN
  BEGIN
    INSERT INTO bucket_membership_event(membership_event_id,bucket_id,face_id,action,actor_kind,reason_code,policy_version,producer_receipt_id,privacy_class)
    VALUES ('m_a1_illegal_secondary','bucket_alpha_secondary','alpha_1','activate','policy','illegal_double_main','policy-v1','receipt_policy','release-safe');
    RAISE EXCEPTION 'main-tier conflict was not blocked';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
END;
$$;
SELECT assert_true(NOT EXISTS (SELECT 1 FROM bucket_membership_event WHERE membership_event_id='m_a1_illegal_secondary'), '3 main-tier exclusivity enforced');

INSERT INTO bucket_membership_event(membership_event_id,bucket_id,face_id,action,actor_kind,reason_code,policy_version,producer_receipt_id,privacy_class,created_at) VALUES
('m_a4_p','bucket_alpha_prime','alpha_4','activate','policy','better_quality','policy-v1','receipt_policy','release-safe',now()+interval '1 second'),
('m_a1_demote','bucket_alpha_prime','alpha_1','demote','policy','displaced','policy-v1','receipt_policy','release-safe',now()+interval '2 seconds'),
('m_a1_s','bucket_alpha_secondary','alpha_1','activate','policy','demoted_from_prime','policy-v1','receipt_policy','release-safe',now()+interval '3 seconds');
SELECT assert_true((SELECT count(*)=1 FROM current_reference_gallery WHERE face_id='alpha_4' AND bucket_kind='prime' AND membership_state='active'), '4 promotion');
SELECT assert_true((SELECT count(*)=1 FROM current_reference_gallery WHERE face_id='alpha_1' AND bucket_kind='secondary' AND membership_state='active'), '4 demotion');

INSERT INTO bucket_membership_event(membership_event_id,bucket_id,face_id,action,actor_kind,reason_code,producer_receipt_id,privacy_class,created_at) VALUES
('m_a2_pin','bucket_alpha_prime','alpha_2','pin','user','user_pin','receipt_user','release-safe',now()+interval '4 seconds'),
('m_a3_ban','bucket_alpha_prime','alpha_3','ban','user','user_ban','receipt_user','release-safe',now()+interval '4 seconds');
SELECT assert_true((SELECT membership_state='active' FROM current_reference_gallery WHERE face_id='alpha_2' AND bucket_id='bucket_alpha_prime'), '5 pin precedence');
SELECT assert_true((SELECT membership_state='inactive' FROM current_reference_gallery WHERE face_id='alpha_3' AND bucket_id='bucket_alpha_prime'), '5 ban precedence');
DO $$
BEGIN
  BEGIN
    INSERT INTO bucket_membership_event(membership_event_id,bucket_id,face_id,action,actor_kind,reason_code,policy_version,producer_receipt_id,privacy_class,created_at)
    VALUES ('m_a2_illegal_demote','bucket_alpha_prime','alpha_2','demote','policy','override_pin','policy-v1','receipt_policy','release-safe',now()+interval '5 seconds');
    RAISE EXCEPTION 'user pin override was not blocked';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
  BEGIN
    INSERT INTO bucket_membership_event(membership_event_id,bucket_id,face_id,action,actor_kind,reason_code,policy_version,producer_receipt_id,privacy_class,created_at)
    VALUES ('m_a3_illegal_activate','bucket_alpha_prime','alpha_3','activate','policy','override_ban','policy-v1','receipt_policy','release-safe',now()+interval '5 seconds');
    RAISE EXCEPTION 'user ban override was not blocked';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
END;
$$;

INSERT INTO bucket_membership_event(membership_event_id,bucket_id,face_id,action,actor_kind,reason_code,producer_receipt_id,privacy_class) VALUES
('m_sg_special','bucket_alpha_sunglasses','alpha_sunglasses','activate','user','condition_reference','receipt_user','release-safe');
SELECT assert_true((SELECT count(*)=2 FROM matching_gallery WHERE face_id='alpha_sunglasses'), '6 specialty overlap stores one embedding');

SELECT assert_true((SELECT person_id='person_alpha' FROM cimmich_match_scores('[1,0,0,0]','synthetic-face','1','cfg',ARRAY['prime']) LIMIT 1), '7 clean prime query');
SELECT assert_true((
  WITH ranked AS (SELECT *, row_number() over(order by best_cosine_score desc) n FROM cimmich_match_scores('[0.7,0.7,0,0]','synthetic-face','1','cfg',ARRAY['prime']))
  SELECT (max(best_cosine_score) - min(best_cosine_score)) < 0.06 FROM ranked WHERE n <= 2
), '8 prime ambiguity detected');
SELECT assert_true((SELECT person_id='person_alpha' AND best_cosine_score > 0.999 FROM cimmich_match_scores('[0.7,0.7,0,0]','synthetic-face','1','cfg',ARRAY['secondary']) LIMIT 1), '8 secondary tie break');
SELECT assert_true((SELECT person_id='person_alpha' AND best_cosine_score > 0.999 FROM cimmich_match_scores('[0,0,1,0]','synthetic-face','1','cfg',ARRAY['specialty']) LIMIT 1), '9 specialty route');
SELECT assert_true(COALESCE((SELECT max(best_cosine_score) < 0.2 FROM cimmich_match_scores('[0,0,0,1]','synthetic-face','1','cfg',ARRAY['prime','secondary','specialty'])),true), '10 ambiguous abstention threshold');

INSERT INTO reference_prototype(
  prototype_id,person_id,bucket_id,model_family,model_version,config_digest,dimension,
  normalized,embedding,member_face_ids,member_count,selection_metrics,policy_version,state,
  producer_receipt_id,privacy_class
) VALUES (
  'prototype_alpha_prime','person_alpha','bucket_alpha_prime','synthetic-face','1','cfg',4,
  true,'[0.7,0.7,0,0]',ARRAY['alpha_1','alpha_2','alpha_3'],3,'{"synthetic":true}',
  'policy-v1','active','receipt_policy','release-safe'
);
SELECT assert_true(
  (SELECT person_id='person_alpha' AND best_cosine_score > 0.99 FROM cimmich_match_scores('[0.7,0.7,0,0]','synthetic-face','1','cfg',ARRAY['prime']) LIMIT 1),
  '10 derived Prime prototype participates in matching'
);

INSERT INTO body_observation(body_id,asset_id,box_x,box_y,box_w,box_h,state,producer_receipt_id,privacy_class) VALUES
('body_user','asset_body_user',0.1,0.1,0.5,0.8,'valid','receipt_model','release-safe'),
('body_link','asset_faces',0.1,0.1,0.5,0.8,'valid','receipt_model','release-safe');
INSERT INTO decision(decision_id,subject_type,subject_id,action,actor_kind,actor_id,reason_code,producer_receipt_id,privacy_class) VALUES
('decision_body_user','body_tag','bodytag_user','accept','user','fixture','manual_body_tag','receipt_user','release-safe');
INSERT INTO body_tag(body_tag_id,person_id,body_id,origin,state,decision_id,producer_receipt_id,privacy_class) VALUES
('bodytag_user','person_alpha','body_user','user','accepted','decision_body_user','receipt_user','release-safe');
SELECT assert_true((SELECT count(*)=1 FROM asset_people WHERE asset_id='asset_body_user' AND association_type='body'), '11 user body tag without face');
INSERT INTO body_tag(body_tag_id,person_id,body_id,origin,state,supporting_face_id,identity_claim_id,producer_receipt_id,privacy_class) VALUES
('bodytag_link','person_alpha','body_link','face_body_linkage','accepted','alpha_4','claim_alpha_4','receipt_link','release-safe');
SELECT assert_true((SELECT origin='face_body_linkage' FROM current_body_tag WHERE body_tag_id='bodytag_link'), '12 derived linkage provenance');
SELECT assert_true((SELECT count(*)=1 FROM asset_people WHERE asset_id='asset_faces' AND association_type='body_link'), '12 derived linkage projects separately from Body evidence');

INSERT INTO decision(decision_id,subject_type,subject_id,action,actor_kind,actor_id,reason_code,producer_receipt_id,privacy_class) VALUES
('decision_presence_user','presence_tag','presence_user','accept','user','fixture','manual_presence','receipt_user','release-safe');
INSERT INTO presence_tag(presence_tag_id,person_id,asset_id,origin,reason_code,note,state,decision_id,producer_receipt_id,privacy_class) VALUES
('presence_user','person_alpha','asset_presence_user','user','user_memory','synthetic','accepted','decision_presence_user','receipt_user','release-safe'),
('presence_series','person_alpha','asset_presence_series','series_context','adjacent_series','synthetic','candidate',NULL,'receipt_model','release-safe');
SELECT assert_true((SELECT count(*)=1 FROM asset_people WHERE asset_id='asset_presence_user' AND association_type='presence' AND geometry_id IS NULL), '13 user presence without geometry');
SELECT assert_true((SELECT state='candidate' FROM current_presence_tag WHERE presence_tag_id='presence_series'), '14 series presence remains candidate');

INSERT INTO decision(decision_id,subject_type,subject_id,action,actor_kind,actor_id,reason_code,producer_receipt_id,privacy_class) VALUES
('decision_modifier_alpha_2','face_modifier','person_alpha:alpha_2:sunglasses','pin','user','fixture','identity_workspace_modifier','receipt_user','release-safe');
INSERT INTO face_modifier_event(
  modifier_event_id,face_id,modifier_key,modifier_label,modifier_class,action,
  actor_kind,actor_id,confidence,decision_id,producer_receipt_id,privacy_class
) VALUES (
  'modifier_alpha_2_sunglasses','alpha_2','sunglasses','Sunglasses','condition','add',
  'user','fixture',1,'decision_modifier_alpha_2','receipt_user','release-safe'
);
SELECT assert_true((
  SELECT count(*)=1 FROM current_face_modifier
  WHERE face_id='alpha_2' AND modifier_key='sunglasses'
), '14 modifier overlaps the ordinary evidence tier');
SELECT assert_true((
  SELECT count(*)=1 FROM matching_gallery WHERE face_id='alpha_2'
), '14 modifier does not duplicate the matching reference');

INSERT INTO face_modifier_proposal(
  proposal_id,face_id,modifier_key,modifier_label,modifier_class,
  provider_name,model_name,model_version,config_digest,vocabulary_version,
  calibrated_confidence,evidence,crop_digest,producer_receipt_id,privacy_class
) VALUES
('proposal_alpha_helmet','alpha_1','helmet','Helmet','accessory_obstruction',
 'fixture-provider','fixture-condition-model','v1',repeat('a',64),'cimmich-modifiers-v1',
 0.93,'{"visualCue":"protective headwear"}',repeat('b',64),'receipt_model','release-safe'),
('proposal_alpha_low_light','alpha_1','low-light','Low light','illumination',
 'fixture-provider','fixture-condition-model','v1',repeat('a',64),'cimmich-modifiers-v1',
 0.61,'{"visualCue":"weak and ambiguous"}',repeat('c',64),'receipt_model','release-safe');
INSERT INTO face_modifier_proposal_event(
  proposal_event_id,proposal_id,action,actor_kind,actor_id,
  producer_receipt_id,privacy_class
) VALUES
('proposal_event_alpha_helmet_candidate','proposal_alpha_helmet','candidate','model','fixture-condition-model','receipt_model','release-safe'),
('proposal_event_alpha_low_light_candidate','proposal_alpha_low_light','candidate','model','fixture-condition-model','receipt_model','release-safe');
SELECT assert_true((
  SELECT count(*)=2 FROM current_face_modifier_proposal
  WHERE face_id='alpha_1' AND state='candidate'
), '14.1 machine modifier proposals remain candidate-only');
SELECT assert_true(NOT EXISTS (
  SELECT 1 FROM current_face_modifier
  WHERE face_id='alpha_1' AND modifier_key IN ('helmet','low-light')
), '14.1 a proposal cannot silently become matching-active');

INSERT INTO face_local_measurement(
  measurement_id,face_id,measurement_state,provider_name,model_name,model_version,
  config_digest,measurement_version,crop_policy_version,policy_version,crop_digests,
  target_selection,contamination,geometry,pose,photometrics,visibility,quality,derived,
  producer_receipt_id,privacy_class
) VALUES (
  'face_measurement_alpha_1','alpha_1','measured','fixture-provider','fixture-landmarker','v1',
  repeat('d',64),'cimmich-face-local-measurement-v1','target-local-multicrop-v1',
  'cimmich-face-local-policy-v1','{"tight":"tight_digest_1234567890","face":"face_digest_1234567890"}',
  '{"state":"selected","landmarkCount":478}',
  '{"nearbyFaceCount":1,"maximumOverlap":0,"centerIntrusion":false}',
  '{"facePixelWidth":112,"facePixelHeight":128,"boundaryTruncated":false}',
  '{"yawDegrees":5,"pitchDegrees":2,"rollDegrees":1}',
  '{"lumaMedian":0.45,"dynamicRange":0.7,"sharpness":0.82}',
  '{"state":"unmeasured","regions":{}}',
  '{"calibrated":false,"score":0.82,"threshold":0.7}',
  '{"completeness":"unknown","primeEligibility":"unknown","visibleIdentityFraction":null}',
  'receipt_model','release-safe'
);
SELECT assert_true((
  SELECT count(*)=1 FROM current_face_local_measurement
  WHERE face_id='alpha_1' AND derived->>'completeness'='unknown'
), '14.2 face-local evidence preserves unknown completeness');
DO $$
BEGIN
  BEGIN
    UPDATE face_local_measurement SET derived='{"completeness":"complete_enough"}'
    WHERE measurement_id='face_measurement_alpha_1';
    RAISE EXCEPTION 'face-local measurement update was not blocked';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
END;
$$;
SELECT assert_true((
  SELECT derived->>'completeness'='unknown' FROM face_local_measurement
  WHERE measurement_id='face_measurement_alpha_1'
), '14.2 face-local evidence is immutable');
SELECT assert_true(EXISTS (
  SELECT 1 FROM producer_receipt
  WHERE producer_receipt_id='receipt_cimmich_partial_region_visibility_v2'
    AND producer_name='cimmich-face-local-measurement'
), '14.3 partial region visibility contract is installed');
SELECT assert_true(EXISTS (
  SELECT 1 FROM producer_receipt
  WHERE producer_receipt_id='receipt_cimmich_scoped_region_contamination_v3'
    AND producer_name='cimmich-face-local-measurement'
), '14.4 scoped region contamination contract is installed');

INSERT INTO decision(
  decision_id,subject_type,subject_id,action,actor_kind,actor_id,
  reason_code,producer_receipt_id,privacy_class
) VALUES
('decision_proposal_alpha_helmet','face_modifier_proposal','proposal_alpha_helmet','accept','user','fixture','modifier_proposal_review','receipt_user','release-safe'),
('decision_proposal_alpha_low_light','face_modifier_proposal','proposal_alpha_low_light','reject','user','fixture','modifier_proposal_review','receipt_user','release-safe');
INSERT INTO face_modifier_proposal_event(
  proposal_event_id,proposal_id,action,actor_kind,actor_id,decision_id,
  supersedes_event_id,producer_receipt_id,privacy_class
) VALUES
('proposal_event_alpha_helmet_accept','proposal_alpha_helmet','accept','user','fixture','decision_proposal_alpha_helmet','proposal_event_alpha_helmet_candidate','receipt_user','release-safe'),
('proposal_event_alpha_low_light_reject','proposal_alpha_low_light','reject','user','fixture','decision_proposal_alpha_low_light','proposal_event_alpha_low_light_candidate','receipt_user','release-safe');
INSERT INTO face_modifier_event(
  modifier_event_id,face_id,modifier_key,modifier_label,modifier_class,action,
  actor_kind,actor_id,confidence,metadata,decision_id,producer_receipt_id,privacy_class
) VALUES (
  'modifier_alpha_1_helmet','alpha_1','helmet','Helmet','condition','add',
  'user','fixture',1,'{"source":"accepted_modifier_proposal","proposalId":"proposal_alpha_helmet"}',
  'decision_proposal_alpha_helmet','receipt_user','release-safe'
);
SELECT assert_true((
  SELECT count(*)=1 FROM current_face_modifier
  WHERE face_id='alpha_1' AND modifier_key='helmet'
) AND NOT EXISTS (
  SELECT 1 FROM current_face_modifier
  WHERE face_id='alpha_1' AND modifier_key='low-light'
), '14.1 only accepted proposals materialize a modifier');

INSERT INTO face_observation(
  face_id,asset_id,box_x,box_y,box_w,box_h,detection_confidence,
  quality_measurements,state,producer_receipt_id,privacy_class
) VALUES
('alpha_context_a','asset_other',0.1,0.1,0.2,0.2,0.9,'{}','valid','receipt_model','release-safe'),
('alpha_context_c','asset_spare',0.1,0.1,0.2,0.2,0.9,'{}','valid','receipt_model','release-safe');
INSERT INTO decision(decision_id,subject_type,subject_id,action,actor_kind,actor_id,reason_code,producer_receipt_id,privacy_class) VALUES
('decision_context_face_a','identity_claim','claim_context_face_a','accept','trusted_import','fixture','synthetic_truth','receipt_import','release-safe'),
('decision_context_face_c','identity_claim','claim_context_face_c','accept','trusted_import','fixture','synthetic_truth','receipt_import','release-safe'),
('decision_context_sequence','capture_context','context_sequence','pin','user','fixture','capture_context_group','receipt_user','release-safe');
INSERT INTO identity_claim(
  identity_claim_id,face_id,person_id,origin,state,evidence_refs,decision_id,
  producer_receipt_id,privacy_class
) VALUES
('claim_context_face_a','alpha_context_a','person_alpha','trusted_import','accepted','[]','decision_context_face_a','receipt_import','release-safe'),
('claim_context_face_c','alpha_context_c','person_alpha','trusted_import','accepted','[]','decision_context_face_c','receipt_import','release-safe');
INSERT INTO capture_context(
  context_id,context_kind,label,state,confidence,grouping_features,created_by,
  actor_id,decision_id,producer_receipt_id,privacy_class
) VALUES (
  'context_sequence','sequence','Synthetic three-frame sequence','active',1,
  '{"candidateOnly":true}','user','fixture','decision_context_sequence','receipt_user','release-safe'
);
INSERT INTO capture_context_member_event(
  membership_event_id,context_id,asset_id,action,member_index,actor_kind,actor_id,
  confidence,reason_code,producer_receipt_id,privacy_class
) VALUES
('context_member_a','context_sequence','asset_other','add',0,'user','fixture',1,'synthetic_context','receipt_user','release-safe'),
('context_member_gap','context_sequence','asset_unknown','add',1,'user','fixture',1,'synthetic_context','receipt_user','release-safe'),
('context_member_c','context_sequence','asset_spare','add',2,'user','fixture',1,'synthetic_context','receipt_user','release-safe');
SELECT assert_true((
  SELECT count(DISTINCT asset_id)=3 AND min(member_count)=3 AND max(member_count)=3
  FROM current_face_capture_context
  WHERE context_id='context_sequence'
), '14 capture context size counts assets rather than joined faces');
SELECT assert_true((
  SELECT count(*)=1
  FROM source_pack_rebuild_request
  WHERE person_id='person_alpha' AND reason_code='capture_context_changed'
    AND subject_type='capture_context' AND subject_id='context_sequence'
    AND state IN ('pending','superseded')
), '15 capture context preserves one reason receipt for the Person rebuild');
SELECT assert_true((
  SELECT count(*)=1 FROM capture_context_presence_candidate
  WHERE context_id='context_sequence' AND person_id='person_alpha'
    AND asset_id='asset_unknown' AND evidence_refs->>'candidateOnly'='true'
), '16 capture gap is candidate-only Presence evidence');

INSERT INTO face_cluster(cluster_id,producer_receipt_id,status,member_count,privacy_class) VALUES
('cluster_unknown','receipt_model','open',2,'release-safe');
INSERT INTO face_cluster_member(cluster_id,face_id,membership_score,rank) VALUES
('cluster_unknown','unknown_1',0.99,1),('cluster_unknown','unknown_2',0.98,2);
SELECT assert_true((SELECT count(*)=1 FROM anonymous_cluster_summary WHERE cluster_id='cluster_unknown') AND (SELECT count(*)=2 FROM person), '15 anonymous cluster is not person');

CREATE TEMP TABLE digest_before AS
SELECT md5(string_agg(row_to_json(x)::text, '' ORDER BY x.person_id,x.asset_id,x.association_type,x.geometry_id NULLS LAST)) d
FROM person_assets x;
CREATE TEMP TABLE digest_after AS
SELECT md5(string_agg(row_to_json(x)::text, '' ORDER BY x.person_id,x.asset_id,x.association_type,x.geometry_id NULLS LAST)) d
FROM person_assets x;
SELECT assert_true((SELECT b.d=a.d FROM digest_before b CROSS JOIN digest_after a), '16 deterministic projection digest');

INSERT INTO decision(decision_id,subject_type,subject_id,action,actor_kind,actor_id,reason_code,producer_receipt_id,privacy_class) VALUES
('decision_holding','person_category','categoryevent_holding','pin','user','fixture','identity_holding_workflow','receipt_user','release-safe');
INSERT INTO person_category_membership_event(
  membership_event_id,person_id,category_id,action,actor_kind,actor_id,decision_id,producer_receipt_id,privacy_class
) VALUES (
  'categoryevent_holding','person_alpha','category_holding','add','user','fixture','decision_holding','receipt_user','release-safe'
);
SELECT assert_true((
  SELECT needs_holding AND needs_sort AND matching_authority='holding'
  FROM current_person_review_state WHERE person_id='person_alpha'
), '16 holding automatically inherits Sort and becomes nonmatching');
SELECT assert_true(NOT EXISTS (
  SELECT 1 FROM current_reference_gallery WHERE person_id='person_alpha'
), '16 holding retires every matching gallery');
SELECT assert_true(NOT EXISTS (
  SELECT 1 FROM current_reference_prototype WHERE person_id='person_alpha'
), '16 holding retires every prototype');
SELECT assert_true(NOT EXISTS (
  SELECT 1 FROM capture_context_presence_candidate WHERE person_id='person_alpha'
), '16 Sort and Holding identities cannot seed Burst Presence candidates');
DO $$
BEGIN
  BEGIN
    INSERT INTO person_category_membership_event(
      membership_event_id,person_id,category_id,action,actor_kind,actor_id,decision_id,producer_receipt_id,privacy_class
    ) VALUES (
      'categoryevent_illegal_sort_remove','person_alpha','category_sort','remove','user','fixture',
      'decision_holding','receipt_user','release-safe'
    );
    RAISE EXCEPTION 'Sort was removed while Holding remained active';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
END;
$$;

SELECT purge_person('person_alpha', true);
SELECT assert_true(NOT EXISTS (SELECT 1 FROM person WHERE person_id='person_alpha'), '17 person purged');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM person_alias WHERE person_id='person_alpha'), '17 aliases purged');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM identity_claim WHERE person_id='person_alpha'), '17 claims purged');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM face_embedding WHERE face_id LIKE 'alpha_%'), '17 embeddings purged');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM artifact WHERE artifact_id='artifact_alpha_4'), '17 reconstructive face artifact purged');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM body_tag WHERE person_id='person_alpha'), '17 body tags purged');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM presence_tag WHERE person_id='person_alpha'), '17 presence tags purged');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM face_modifier_event WHERE face_id LIKE 'alpha_%'), '17 face modifiers purged');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM face_modifier_proposal WHERE face_id LIKE 'alpha_%'), '17 modifier proposals purged');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM face_local_measurement WHERE face_id LIKE 'alpha_%'), '17 face-local measurements purged');
SELECT assert_true((SELECT count(*)=1 FROM privacy_purge_receipt), '17 nonidentifying purge receipt');
SELECT assert_true(NOT EXISTS (SELECT 1 FROM decision WHERE subject_id LIKE 'claim_alpha_%' OR subject_id IN ('bodytag_user','bodytag_link','presence_user','presence_series')), '17 reconstructive decisions purged');
SELECT assert_true((SELECT count(*)=1 FROM person WHERE person_id='person_beta'), '17 unrelated person preserved');

ROLLBACK;
\echo 'Cimmich SQL contract tests: PASS (18 data tests; release leak scan runs in shell)'
