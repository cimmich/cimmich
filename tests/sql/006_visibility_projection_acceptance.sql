BEGIN;

DO $$
DECLARE
    v_surface_count integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM producer_receipt
        WHERE producer_receipt_id = 'receipt_cimmich_visibility_projection_guard_v1'
    ) THEN
        RAISE EXCEPTION 'Visibility projection producer receipt is missing';
    END IF;

    SELECT count(*) INTO v_surface_count
    FROM cimmich_visibility_projection_surface;
    IF v_surface_count <> 17 THEN
        RAISE EXCEPTION 'Expected 17 registered projection surfaces, got %', v_surface_count;
    END IF;

    IF EXISTS (
        SELECT 1 FROM cimmich_visibility_projection_surface
        WHERE coverage_state <> 'enforced' OR reason_code IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'A Product V1 surface lacks a native visibility-safe projection';
    END IF;

    IF EXISTS (
        SELECT 1 FROM cimmich_visibility_projection_surface
        WHERE coverage_state = 'enforced' AND reason_code IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Enforced projection carries a failure reason';
    END IF;

    BEGIN
        UPDATE cimmich_visibility_projection_surface
        SET coverage_state = 'blocked', reason_code = NULL
        WHERE surface_key = 'summary';
        RAISE EXCEPTION 'Blocked projection without a reason was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO cimmich_visibility_projection_surface (
            surface_key, coverage_state, asset_derived, route_family,
            reason_code, producer_receipt_id
        ) VALUES (
            'unsafe_fixture', 'assumed_safe', true, '/v1/unsafe', NULL,
            'receipt_cimmich_visibility_projection_guard_v1'
        );
        RAISE EXCEPTION 'Unknown projection coverage state was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$$;

INSERT INTO person (
    person_id, display_name, status, subject_kind,
    created_by_receipt_id, privacy_class
) VALUES (
    'person_visibility_human_fixture', 'Visibility Human', 'active', 'person',
    'receipt_service_fixture', 'private'
), (
    'person_visibility_pet_fixture', 'Visibility Pet', 'active', 'pet',
    'receipt_service_fixture', 'private'
);

INSERT INTO cimmich_visibility_decision (
    decision_id, actor_id, principal_id, device_id, decision_kind,
    before_state, after_state, state
) VALUES (
    'visibility_decision_person_acceptance', 'acceptance', 'local-primary',
    'acceptance-device', 'set', '[]'::jsonb, '[]'::jsonb, 'active'
);

INSERT INTO cimmich_visibility_object (
    object_scope, object_id, visibility_tier, decision_id
) VALUES (
    'person', 'person_visibility_human_fixture', 'personal',
    'visibility_decision_person_acceptance'
);

DO $$
BEGIN
    IF cimmich_visibility_person_rank('person_visibility_human_fixture') <> 1 THEN
        RAISE EXCEPTION 'Person visibility rank did not project Personal';
    END IF;
    IF cimmich_visibility_person_rank('person_visibility_default_fixture') <> 0 THEN
        RAISE EXCEPTION 'Person visibility did not default to Standard';
    END IF;
    BEGIN
        INSERT INTO cimmich_visibility_object (
            object_scope, object_id, visibility_tier, decision_id
        ) VALUES (
            'person', 'person_visibility_pet_fixture', 'private',
            'visibility_decision_person_acceptance'
        );
        RAISE EXCEPTION 'Pet was accepted through Person visibility scope';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;
END;
$$;

DELETE FROM cimmich_visibility_object
WHERE object_scope = 'person'
  AND object_id = 'person_visibility_human_fixture';
DELETE FROM cimmich_visibility_decision
WHERE decision_id = 'visibility_decision_person_acceptance';
DELETE FROM person
WHERE person_id IN (
    'person_visibility_human_fixture',
    'person_visibility_pet_fixture'
);

COMMIT;
