BEGIN;

-- Former is a temporal state on a relationship, not a separate relationship
-- type. Past labels may be nine characters longer than their owner label.
ALTER TABLE connection_type
    DROP CONSTRAINT connection_type_past_label_check,
    DROP CONSTRAINT connection_type_inverse_past_label_check;

ALTER TABLE connection_type
    ADD CONSTRAINT connection_type_past_label_check CHECK (
        past_label IS NULL OR (
            past_label = btrim(past_label) AND length(past_label) BETWEEN 1 AND 96
        )
    ),
    ADD CONSTRAINT connection_type_inverse_past_label_check CHECK (
        inverse_past_label IS NULL OR (
            inverse_past_label = btrim(inverse_past_label)
            AND length(inverse_past_label) BETWEEN 1 AND 96
        )
    );

UPDATE connection_type
SET temporal_mode = 'current_or_past',
    past_label = label || ' (Former)',
    inverse_past_label = inverse_label || ' (Former)'
WHERE target_kind = 'person'
  AND state = 'active'
  AND type_id <> 'connectiontype_ex';

-- Preserve every existing Person relationship in append-only history. Rows
-- that were timeless become current. A legacy Ex becomes Partner (Former)
-- before the standalone Ex catalogue entry is retired.
INSERT INTO connection_fact_event (
    event_id, fact_id, action, source_kind, source_id, target_kind, target_id,
    type_id, validity, date_start, date_end, note, command_id, actor_id,
    suggestion_key, supersedes_event_id
)
SELECT
    'connectionevent_' || md5('schema151:' || fact.event_id),
    fact.fact_id,
    'record',
    fact.source_kind,
    fact.source_id,
    fact.target_kind,
    fact.target_id,
    CASE WHEN fact.type_id = 'connectiontype_ex'
        THEN 'connectiontype_partner' ELSE fact.type_id END,
    CASE WHEN fact.type_id = 'connectiontype_ex' THEN 'past' ELSE 'current' END,
    fact.date_start,
    fact.date_end,
    fact.note,
    'migration.151.temporal.' || md5(fact.fact_id),
    'schema-151-former-migration',
    fact.suggestion_key,
    fact.event_id
FROM current_connection_fact fact
WHERE fact.target_kind = 'person'
  AND fact.validity = 'timeless';

UPDATE connection_type
SET state = 'retired'
WHERE type_id = 'connectiontype_ex' AND is_system_seed = true;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, privacy_class
) VALUES (
    'receipt_cimmich_former_person_relationship_v1', 'system',
    'cimmich-former-person-relationship', 'v1', now(), now(), 'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
    SET completed_at = excluded.completed_at;

COMMIT;
