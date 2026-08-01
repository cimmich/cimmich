BEGIN;

-- GPS creation is explicit geographic provenance, not an ambiguous legacy
-- Place. Correct only untouched schema-110 compatibility rows; an owner who
-- has already classified a Place is never overridden.
UPDATE context_entity entity
SET place_role = 'geography',
    revision = entity.revision + 1,
    updated_at = now()
FROM context_operation operation
JOIN context_command command
  ON command.command_id = operation.command_id
WHERE entity.entity_id = operation.entity_id
  AND entity.entity_kind = 'place'
  AND entity.status <> 'deleted'
  AND entity.place_role = 'unclassified'
  AND operation.operation_scope = 'entity'
  AND operation.action = 'create'
  AND command.command_kind = 'create'
  AND command.command_id LIKE 'context.gps-create.%';

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_gps_created_place_geography_v1', 'system',
    'cimmich-gps-created-place-geography', 'v1', now(), now(),
    encode(digest('cimmich-gps-created-place-geography-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

COMMIT;
