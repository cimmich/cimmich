BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_pet_manual_management_v1', 'system',
    'cimmich-pet-manual-management', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at;

ALTER TABLE person
    ADD COLUMN description text NOT NULL DEFAULT '',
    ADD COLUMN cover_asset_id text REFERENCES asset(asset_id) ON DELETE SET NULL,
    ADD COLUMN cover_crop jsonb;

ALTER TABLE person
    ADD CONSTRAINT person_cover_crop_shape CHECK (
        cover_crop IS NULL OR (
            jsonb_typeof(cover_crop) = 'object'
            AND cover_crop ?& ARRAY['x','y','w','h']
            AND (cover_crop->>'x')::numeric >= 0
            AND (cover_crop->>'y')::numeric >= 0
            AND (cover_crop->>'w')::numeric > 0
            AND (cover_crop->>'h')::numeric > 0
            AND (cover_crop->>'x')::numeric + (cover_crop->>'w')::numeric <= 1.000001
            AND (cover_crop->>'y')::numeric + (cover_crop->>'h')::numeric <= 1.000001
        )
    ),
    ADD CONSTRAINT person_cover_crop_requires_asset CHECK (
        cover_crop IS NULL OR cover_asset_id IS NOT NULL
    );

ALTER TABLE decision DROP CONSTRAINT IF EXISTS decision_action_check;
ALTER TABLE decision ADD CONSTRAINT decision_action_check
  CHECK (action IN (
    'accept','reject','merge','split','rename','promote','demote','pin','ban',
    'ignore','restore','classify','create','update','attach','detach','archive','undo'
  ));

CREATE OR REPLACE VIEW current_person AS
SELECT p.person_id, p.display_name, p.status, p.current_revision,
       COALESCE(array_agg(pa.label ORDER BY pa.created_at)
         FILTER (WHERE pa.state = 'active'), ARRAY[]::text[]) AS aliases,
       p.subject_kind, p.merged_into_person_id, p.description,
       p.cover_asset_id, p.cover_crop
FROM person p
LEFT JOIN person_alias pa ON pa.person_id = p.person_id
WHERE p.status IN ('active','hidden')
GROUP BY p.person_id;

CREATE TABLE pet_command (
    command_id text PRIMARY KEY,
    command_kind text NOT NULL CHECK (command_kind IN (
        'create','update','attach','detach','undo'
    )),
    actor_id text NOT NULL,
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    decision_id text REFERENCES decision(decision_id),
    response jsonb NOT NULL,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pet_association_operation (
    operation_id text PRIMARY KEY,
    command_id text NOT NULL UNIQUE REFERENCES pet_command(command_id),
    pet_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('attach','detach')),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    state text NOT NULL CHECK (state IN ('active','reverted')),
    snapshot jsonb NOT NULL,
    undo_decision_id text UNIQUE REFERENCES decision(decision_id),
    reverted_at timestamptz,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'reverted') = (undo_decision_id IS NOT NULL AND reverted_at IS NOT NULL))
);

CREATE INDEX pet_association_operation_pet_state
    ON pet_association_operation(pet_id, state, created_at DESC);

COMMIT;
