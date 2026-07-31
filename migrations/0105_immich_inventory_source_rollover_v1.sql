BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_immich_inventory_source_rollover_v1', 'system',
    'cimmich-immich-inventory-source-rollover', 'v1', now(), now(),
    encode(digest('cimmich.immich-inventory-source-rollover.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE immich_inventory_source
    ADD COLUMN superseded_by_source_id text
    REFERENCES immich_inventory_source(source_id);

ALTER TABLE immich_inventory_source
    ADD CONSTRAINT immich_inventory_source_rollover_state_check CHECK (
        superseded_by_source_id IS NULL
        OR (
            state = 'disabled'
            AND superseded_by_source_id <> source_id
        )
    );

CREATE INDEX immich_inventory_source_successor_lookup
    ON immich_inventory_source(superseded_by_source_id)
    WHERE superseded_by_source_id IS NOT NULL;

CREATE TABLE immich_inventory_source_rollover_command (
    command_id text PRIMARY KEY CHECK (
        length(btrim(command_id)) BETWEEN 1 AND 200
    ),
    actor_id text NOT NULL CHECK (
        length(btrim(actor_id)) BETWEEN 1 AND 200
    ),
    predecessor_source_id text NOT NULL
        REFERENCES immich_inventory_source(source_id),
    successor_source_id text NOT NULL
        REFERENCES immich_inventory_source(source_id),
    request_digest text NOT NULL CHECK (
        request_digest ~ '^[0-9a-f]{64}$'
    ),
    response jsonb NOT NULL CHECK (
        jsonb_typeof(response) = 'object'
    ),
    producer_receipt_id text NOT NULL
        REFERENCES producer_receipt(producer_receipt_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    CHECK (predecessor_source_id <> successor_source_id)
);

CREATE UNIQUE INDEX immich_inventory_source_one_successor
    ON immich_inventory_source_rollover_command(predecessor_source_id);

COMMIT;
