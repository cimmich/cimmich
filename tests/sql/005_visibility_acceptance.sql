BEGIN;

DO $$
DECLARE
    v_decision_id text := 'visibility_sql_decision_fixture';
BEGIN
    INSERT INTO cimmich_visibility_decision (
        decision_id, actor_id, principal_id, device_id, decision_kind,
        before_state, after_state, state
    ) VALUES (
        v_decision_id, 'sql-acceptance', 'local-primary', 'sql-device', 'set',
        '[]'::jsonb, '[]'::jsonb, 'active'
    );

    IF cimmich_visibility_asset_rank('asset_service_fixture') <> 0 THEN
        RAISE EXCEPTION 'Unassigned asset did not default to Standard';
    END IF;

    BEGIN
        INSERT INTO cimmich_visibility_object (
            object_scope, object_id, visibility_tier, decision_id
        ) VALUES ('asset', 'asset_service_fixture', 'secret', v_decision_id);
        RAISE EXCEPTION 'Invalid visibility tier was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO cimmich_visibility_object (
            object_scope, object_id, visibility_tier, decision_id
        ) VALUES ('album', 'native-immich-album', 'personal', v_decision_id);
        RAISE EXCEPTION 'Unavailable container scope was persisted';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%VISIBILITY_SCOPE_UNAVAILABLE_DB%' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        INSERT INTO cimmich_visibility_object (
            object_scope, object_id, visibility_tier, decision_id
        ) VALUES ('asset', 'asset_missing_visibility_fixture', 'personal', v_decision_id);
        RAISE EXCEPTION 'Missing Cimmich asset was persisted';
    EXCEPTION WHEN foreign_key_violation THEN
        IF SQLERRM NOT LIKE '%VISIBILITY_OBJECT_NOT_FOUND_DB%' THEN
            RAISE;
        END IF;
    END;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cimmich_visibility_private_credential'
          AND column_name ILIKE '%password%'
    ) THEN
        RAISE EXCEPTION 'Visibility credential schema contains a password column';
    END IF;

    DELETE FROM cimmich_visibility_decision WHERE decision_id = v_decision_id;
END;
$$;

COMMIT;
