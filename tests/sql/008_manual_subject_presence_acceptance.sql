BEGIN;

DO $$
DECLARE
    v_face_count bigint;
    v_body_count bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM producer_receipt
        WHERE producer_receipt_id = 'receipt_cimmich_manual_subject_presence_v1'
    ) THEN
        RAISE EXCEPTION 'Manual subject Presence producer receipt is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'presence_tag'
          AND column_name = 'manual_geometry'
    ) THEN
        RAISE EXCEPTION 'Manual subject Presence geometry column is missing';
    END IF;

    SELECT count(*) INTO v_face_count FROM face_observation;
    SELECT count(*) INTO v_body_count FROM body_observation;

    INSERT INTO decision (
        decision_id, subject_type, subject_id, action, actor_kind, actor_id,
        reason_code, note, producer_receipt_id, privacy_class
    ) VALUES (
        'decision_manual_presence_sql_person', 'asset_subject_presence',
        'person:person_candidate_fixture:asset_body_link_ambiguous_fixture',
        'attach', 'user', 'sql-acceptance', 'manual_subject_presence_attach',
        'SQL acceptance fixture',
        'receipt_cimmich_manual_subject_presence_v1', 'private'
    );

    INSERT INTO presence_tag (
        presence_tag_id, person_id, asset_id, origin, reason_code, note,
        state, confidence, decision_id, producer_receipt_id, privacy_class,
        manual_geometry
    ) VALUES (
        'presence_tag_manual_presence_sql_person',
        'person_candidate_fixture', 'asset_body_link_ambiguous_fixture',
        'user', 'manual_person', '', 'accepted', 1,
        'decision_manual_presence_sql_person',
        'receipt_cimmich_manual_subject_presence_v1', 'private',
        '{"kind":"point","x":0.45,"y":0.32}'::jsonb
    );

    IF NOT EXISTS (
        SELECT 1 FROM current_presence_tag
        WHERE presence_tag_id = 'presence_tag_manual_presence_sql_person'
          AND manual_geometry = '{"kind":"point","x":0.45,"y":0.32}'::jsonb
    ) THEN
        RAISE EXCEPTION 'Valid manual Person Presence did not project';
    END IF;

    INSERT INTO person (
        person_id, display_name, status, created_by_receipt_id, subject_kind
    ) VALUES (
        'pet_manual_presence_sql_fixture', 'SQL Pet', 'active',
        'receipt_cimmich_manual_subject_presence_v1', 'pet'
    );

    BEGIN
        INSERT INTO presence_tag (
            presence_tag_id, person_id, asset_id, origin, reason_code, note,
            state, confidence, decision_id, producer_receipt_id, privacy_class,
            manual_geometry
        ) VALUES (
            'presence_tag_manual_presence_sql_kind_mismatch',
            'pet_manual_presence_sql_fixture', 'asset_service_fixture',
            'user', 'manual_person', '', 'candidate', 1, NULL,
            'receipt_cimmich_manual_subject_presence_v1', 'private',
            '{"kind":"point","x":0.2,"y":0.2}'::jsonb
        );
        RAISE EXCEPTION 'Pet accepted through manual Person reason';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO presence_tag (
            presence_tag_id, person_id, asset_id, origin, reason_code, note,
            state, confidence, decision_id, producer_receipt_id, privacy_class,
            manual_geometry
        ) VALUES (
            'presence_tag_manual_presence_sql_bad_region',
            'person_candidate_fixture', 'asset_service_fixture',
            'user', 'manual_person', '', 'candidate', 1, NULL,
            'receipt_cimmich_manual_subject_presence_v1', 'private',
            '{"kind":"region","x":0.8,"y":0.2,"w":0.4,"h":0.2}'::jsonb
        );
        RAISE EXCEPTION 'Out-of-bounds manual Presence region was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO presence_tag (
            presence_tag_id, person_id, asset_id, origin, reason_code, note,
            state, confidence, decision_id, producer_receipt_id, privacy_class,
            manual_geometry
        ) VALUES (
            'presence_tag_manual_presence_sql_model_geometry',
            'person_candidate_fixture', 'asset_service_fixture',
            'model', 'manual_person', '', 'candidate', 1, NULL,
            'receipt_cimmich_manual_subject_presence_v1', 'private',
            '{"kind":"point","x":0.2,"y":0.2}'::jsonb
        );
        RAISE EXCEPTION 'Model-origin manual Presence geometry was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    IF (SELECT count(*) FROM face_observation) <> v_face_count
       OR (SELECT count(*) FROM body_observation) <> v_body_count THEN
        RAISE EXCEPTION 'Manual Presence acceptance mutated observation truth';
    END IF;
END;
$$;

ROLLBACK;
