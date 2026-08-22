#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CURRENT_SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
PREVIEW18_VERSION=v1.1.0-community-preview.18
PREVIEW18_COMMIT=ce4534cf96c5dbe8e6d048c6472e4dc7215087e7
PREVIEW18_SCHEMA_VERSION=142
PREVIEW18_SEMANTIC_LEDGER_SHA256=556461408a7667724c853ecba93543481d8314387882b4cc27a20c7bf27687af
CONTAINER=cimmich-migration-acceptance
IMAGE=pgvector/pgvector:0.8.2-pg17-trixie
PORT=55433
TMP_ROOT=$(mktemp -d)

copy_migrations_through() {
  destination=$1
  maximum_version=$2
  mkdir -p "$destination"
  for migration in "$ROOT"/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
    filename=${migration##*/}
    version=${filename%%_*}
    while [ "${version#0}" != "$version" ]; do
      version=${version#0}
    done
    version=${version:-0}
    if [ "$version" -le "$maximum_version" ]; then
      cp "$migration" "$destination/"
    fi
  done
}

migration_semantic_ledger_digest() {
  ledger_root=$1
  find "$ledger_root" -type f -print | sed "s#^$ledger_root/##" | LC_ALL=C sort |
    while IFS= read -r relative; do
      # A privacy scrub may remove historical comments without changing the
      # published migration program. Bind the executable ledger while retaining
      # filenames, ordering and every non-comment SQL line.
      file_digest=$(sed '/^[[:space:]]*--/d; /^[[:space:]]*$/d' \
        "$ledger_root/$relative" | sha256sum | awk '{ print $1 }')
      printf '%s  migrations/%s\n' "$file_digest" "$relative"
    done | sha256sum | awk '{ print $1 }'
}

cleanup() {
  status=$?
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
  return "$status"
}
trap cleanup EXIT INT TERM
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=cimmich_migration_test \
  -e POSTGRES_USER=cimmich_migration_test \
  -e POSTGRES_PASSWORD=synthetic-migration-password \
  -p "127.0.0.1:${PORT}:5432" \
  --tmpfs /var/lib/postgresql/data \
  "$IMAGE" >/dev/null

i=0
until docker exec "$CONTAINER" pg_isready -U cimmich_migration_test -d cimmich_migration_test >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "migration database readiness timeout" >&2
    exit 1
  fi
  sleep 1
done

DATABASE_URL="postgres://cimmich_migration_test:synthetic-migration-password@127.0.0.1:${PORT}/cimmich_migration_test"
export DATABASE_URL
npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/first.log" &
first_pid=$!
npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/second.log" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"

read -r migration_count migration_version migration_timing_count patch_count patch_timing_count <<EOF
$(docker exec "$CONTAINER" psql -U cimmich_migration_test -d cimmich_migration_test -AtF ' ' -c \
  "SELECT (SELECT count(*) FROM cimmich_schema_migration), (SELECT max(version) FROM cimmich_schema_migration), (SELECT count(*) FROM cimmich_schema_migration WHERE execution_ms IS NOT NULL), (SELECT count(*) FROM cimmich_schema_patch), (SELECT count(*) FROM cimmich_schema_patch WHERE execution_ms IS NOT NULL)")
EOF
if [ "$migration_count" != "$CURRENT_SCHEMA_VERSION" ] || \
  [ "$migration_version" != "$CURRENT_SCHEMA_VERSION" ] || \
  [ "$migration_timing_count" != "$CURRENT_SCHEMA_VERSION" ] || \
  [ "$patch_count" != "1" ] || \
  [ "$patch_timing_count" != "1" ]; then
  echo "migration ledger count/version verification failed" >&2
  exit 1
fi

# Prove the published Public Beta Patch 6 boundary explicitly. Build the exact
# schema-75 ledger, preserve representative imported archive rows, then run the
# current candidate migrations over it. This must remain separate from the
# fresh-install and legacy semantic-restore lanes above and below.
docker exec "$CONTAINER" createdb -U cimmich_migration_test cimmich_schema75_upgrade_test
copy_migrations_through "$TMP_ROOT/through-75-migrations" 75
mkdir -p "$TMP_ROOT/through-75-migrations/patches"
cp "$ROOT/migrations/patches/0048_0001_inventory_two_strike_v1.sql" \
  "$TMP_ROOT/through-75-migrations/patches/"
SCHEMA75_DATABASE_URL="postgres://cimmich_migration_test:synthetic-migration-password@127.0.0.1:${PORT}/cimmich_schema75_upgrade_test"
DATABASE_URL="$SCHEMA75_DATABASE_URL" CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/through-75-migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/schema75-install.log"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_migration_test \
  -d cimmich_schema75_upgrade_test <<'SQL'
INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, privacy_class
) VALUES (
  'receipt_schema75_upgrade_fixture', 'import', 'schema75-upgrade-fixture',
  'v1', now(), now(), 'private'
);
INSERT INTO source_snapshot (
  snapshot_id, input_schema_version, source_digest, locator_root_token,
  started_at, completed_at, declared_asset_count, observed_asset_count, state
) VALUES (
  'snapshot_schema75_upgrade_fixture', 'schema75-fixture-v1', repeat('7', 64),
  'schema75-fixture-token', now(), now(), 1, 1, 'complete'
);
INSERT INTO asset (
  asset_id, locator_token, media_kind, mime_type, source_snapshot_id, state
) VALUES (
  'asset_schema75_upgrade_fixture', 'schema75-fixture-asset', 'image',
  'image/jpeg', 'snapshot_schema75_upgrade_fixture', 'active'
);
INSERT INTO person (
  person_id, display_name, status, created_by_receipt_id
) VALUES (
  'person_schema75_upgrade_fixture', 'Schema 75 Fixture', 'active',
  'receipt_schema75_upgrade_fixture'
);
INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id
) VALUES (
  'face_schema75_upgrade_fixture', 'asset_schema75_upgrade_fixture',
  0.1, 0.1, 0.2, 0.2, 0.9, '{}'::jsonb, 'valid',
  'receipt_schema75_upgrade_fixture'
);
SQL
schema75_before=$(docker exec "$CONTAINER" psql -U cimmich_migration_test \
  -d cimmich_schema75_upgrade_test -Atc \
  "SELECT max(version) || ':' || count(*) FROM cimmich_schema_migration")
test "$schema75_before" = "75:75" || {
  echo "schema-75 fixture did not reach the published Patch 6 boundary" >&2
  exit 1
}
DATABASE_URL="$SCHEMA75_DATABASE_URL" npm --prefix "$ROOT/service" run migrate -- apply \
  >"$TMP_ROOT/schema75-upgrade.log"
schema75_after=$(docker exec "$CONTAINER" psql -U cimmich_migration_test \
  -d cimmich_schema75_upgrade_test -Atc \
  "SELECT max(version) || ':' || count(*) || ':' ||
    (SELECT count(*) FROM asset WHERE asset_id='asset_schema75_upgrade_fixture') || ':' ||
    (SELECT count(*) FROM person WHERE person_id='person_schema75_upgrade_fixture') || ':' ||
    (SELECT count(*) FROM face_observation WHERE face_id='face_schema75_upgrade_fixture')
   FROM cimmich_schema_migration")
test "$schema75_after" = "$CURRENT_SCHEMA_VERSION:$CURRENT_SCHEMA_VERSION:1:1:1" || {
  echo "schema-75 to current upgrade did not preserve the fixture" >&2
  exit 1
}

# Rebuild the exact public Preview 18/schema-142 migration ledger by its
# immutable release digest, seed every durable domain that must cross the final
# V1 boundary, upgrade it, then restore the exact pre-upgrade dump. This makes
# rollback a tested state transition rather than a count-only claim.
docker exec "$CONTAINER" createdb -U cimmich_migration_test cimmich_preview18_upgrade_test
copy_migrations_through "$TMP_ROOT/preview18/migrations" "$PREVIEW18_SCHEMA_VERSION"
mkdir -p "$TMP_ROOT/preview18/migrations/patches"
cp "$ROOT/migrations/patches/0048_0001_inventory_two_strike_v1.sql" \
  "$TMP_ROOT/preview18/migrations/patches/"
test "$(migration_semantic_ledger_digest "$TMP_ROOT/preview18/migrations")" = \
  "$PREVIEW18_SEMANTIC_LEDGER_SHA256" || {
  echo "Preview 18 executable migration ledger does not match $PREVIEW18_COMMIT" >&2
  exit 1
}
PREVIEW18_DATABASE_URL="postgres://cimmich_migration_test:synthetic-migration-password@127.0.0.1:${PORT}/cimmich_preview18_upgrade_test"
DATABASE_URL="$PREVIEW18_DATABASE_URL" \
  CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/preview18/migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/preview18-install.log"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_migration_test \
  -d cimmich_preview18_upgrade_test <<'SQL'
INSERT INTO source_snapshot (
  snapshot_id, input_schema_version, source_digest, locator_root_token,
  started_at, completed_at, declared_asset_count, observed_asset_count, state
) VALUES (
  'snapshot_preview18_final_seed', 'preview18-final-seed-v1', repeat('1', 64),
  'preview18-final-seed-root', now(), now(), 1, 1, 'complete'
);
INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  source_snapshot_id, started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_preview18_final_seed', 'trusted_import', 'preview18-final-seed', 'v1',
  'snapshot_preview18_final_seed', now(), now(), repeat('2', 64), 'private'
);
INSERT INTO asset (
  asset_id, content_hash, locator_token, media_kind, mime_type,
  source_snapshot_id, state
) VALUES (
  'asset_preview18_final_seed', repeat('3', 40), 'preview18-final-seed-asset',
  'image', 'image/jpeg', 'snapshot_preview18_final_seed', 'active'
);
INSERT INTO media_content (content_id, byte_length)
VALUES ('media_content_1111111111111111111111111111111111111111', 1);
INSERT INTO media_content_fingerprint (
  content_id, hash_algorithm, content_digest, verification, producer_receipt_id
) VALUES (
  'media_content_1111111111111111111111111111111111111111',
  'sha1', repeat('3', 40), 'byte_verified', 'receipt_preview18_final_seed'
);
INSERT INTO asset_content_link (asset_id, content_id, producer_receipt_id)
VALUES (
  'asset_preview18_final_seed',
  'media_content_1111111111111111111111111111111111111111',
  'receipt_preview18_final_seed'
);
INSERT INTO person (
  person_id, display_name, status, created_by_receipt_id
) VALUES (
  'person_preview18_final_seed', 'Preview 18 Final Seed', 'active',
  'receipt_preview18_final_seed'
);
INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id
) VALUES (
  'face_preview18_final_seed', 'asset_preview18_final_seed',
  0.1, 0.1, 0.2, 0.2, 0.95, '{}'::jsonb, 'valid',
  'receipt_preview18_final_seed'
);
INSERT INTO face_embedding (
  embedding_id, face_id, model_family, model_version, config_digest,
  dimension, normalized, embedding, vector_digest, state, producer_receipt_id
) VALUES (
  'embedding_preview18_final_seed', 'face_preview18_final_seed',
  'preview18-fixture', 'v1', repeat('4', 64), 3, true,
  '[1,0,0]'::vector, repeat('5', 64), 'active', 'receipt_preview18_final_seed'
);
INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, note, producer_receipt_id
) VALUES (
  'decision_preview18_final_seed', 'face_observation',
  'face_preview18_final_seed', 'accept', 'user', 'preview18-owner',
  'owner_confirmed', 'Preview 18 rollback fixture', 'receipt_preview18_final_seed'
);
INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state,
  calibrated_confidence, evidence_refs, decision_id, producer_receipt_id
) VALUES (
  'claim_preview18_final_seed', 'face_preview18_final_seed',
  'person_preview18_final_seed', 'user', 'accepted', 1,
  '{"fixture":"preview18"}'::jsonb, 'decision_preview18_final_seed',
  'receipt_preview18_final_seed'
);
INSERT INTO cimmich_document (
  document_id, source_kind, source_asset_id, source_filename, mime_type,
  display_title, document_kind, status, visibility_tier, created_by
) VALUES (
  'document_11111111111111111111111111111111', 'immich_asset',
  'asset_preview18_final_seed', 'release-fixture.jpg', 'image/jpeg',
  'Preview 18 document seed', 'other', 'active', 'private', 'preview18-owner'
);
INSERT INTO asset_label (
  label_id, display_name, normalized_name, label_kind, created_by_actor_id
) VALUES (
  'label_11111111111111111111111111111111', 'Release collection',
  'release collection', 'collection', 'preview18-owner'
);
INSERT INTO immich_companion_owner (principal_id)
VALUES ('preview18-owner-principal');
INSERT INTO asset_source_binding (
  binding_id, asset_id, content_id, source_kind, source_id,
  external_asset_id, locator_token, input_revision, state
) SELECT
  'source_binding_1111111111111111111111111111111111111111',
  'asset_preview18_final_seed', content_id, 'immich', 'preview18-source',
  'preview18-external-asset', 'preview18-source-locator', repeat('6', 64), 'active'
FROM asset_content_link WHERE asset_id = 'asset_preview18_final_seed';
SQL
preview18_before=$(docker exec "$CONTAINER" psql -U cimmich_migration_test \
  -d cimmich_preview18_upgrade_test -Atc \
  "SELECT max(version) || ':' || count(*) FROM cimmich_schema_migration")
test "$preview18_before" = "$PREVIEW18_SCHEMA_VERSION:$PREVIEW18_SCHEMA_VERSION" || {
  echo "$PREVIEW18_VERSION fixture did not reach exact schema $PREVIEW18_SCHEMA_VERSION" >&2
  exit 1
}
docker exec "$CONTAINER" pg_dump -U cimmich_migration_test \
  -d cimmich_preview18_upgrade_test -Fc > "$TMP_ROOT/preview18-schema142.dump"
DATABASE_URL="$PREVIEW18_DATABASE_URL" npm --prefix "$ROOT/service" run migrate -- apply \
  >"$TMP_ROOT/preview18-upgrade.log"
preview18_after=$(docker exec "$CONTAINER" psql -U cimmich_migration_test \
  -d cimmich_preview18_upgrade_test -Atc \
  "SELECT (SELECT max(version) FROM cimmich_schema_migration) || ':' ||
    (SELECT display_name FROM person WHERE person_id='person_preview18_final_seed') || ':' ||
    (SELECT count(*) FROM identity_claim WHERE identity_claim_id='claim_preview18_final_seed' AND state='accepted') || ':' ||
    (SELECT count(*) FROM cimmich_document WHERE document_id='document_11111111111111111111111111111111') || ':' ||
    (SELECT count(*) FROM asset_label WHERE label_id='label_11111111111111111111111111111111' AND label_kind='collection') || ':' ||
    (SELECT count(*) FROM immich_companion_owner WHERE principal_id='preview18-owner-principal') || ':' ||
    (SELECT count(*) FROM asset_source_binding WHERE external_asset_id='preview18-external-asset')")
test "$preview18_after" = "$CURRENT_SCHEMA_VERSION:Preview 18 Final Seed:1:1:1:1:1" || {
  echo "Preview 18 to current upgrade did not preserve the complete final seed" >&2
  exit 1
}
docker exec "$CONTAINER" dropdb --force -U cimmich_migration_test cimmich_preview18_upgrade_test
docker exec "$CONTAINER" createdb -U cimmich_migration_test cimmich_preview18_upgrade_test
docker exec -i "$CONTAINER" pg_restore -U cimmich_migration_test \
  -d cimmich_preview18_upgrade_test --no-owner --no-privileges \
  < "$TMP_ROOT/preview18-schema142.dump"
preview18_rollback=$(docker exec "$CONTAINER" psql -U cimmich_migration_test \
  -d cimmich_preview18_upgrade_test -Atc \
  "SELECT (SELECT max(version) FROM cimmich_schema_migration) || ':' ||
    (SELECT display_name FROM person WHERE person_id='person_preview18_final_seed') || ':' ||
    (SELECT count(*) FROM identity_claim WHERE identity_claim_id='claim_preview18_final_seed' AND state='accepted') || ':' ||
    (SELECT count(*) FROM cimmich_document WHERE document_id='document_11111111111111111111111111111111') || ':' ||
    (SELECT count(*) FROM asset_label WHERE label_id='label_11111111111111111111111111111111' AND label_kind='collection') || ':' ||
    (SELECT count(*) FROM immich_companion_owner WHERE principal_id='preview18-owner-principal') || ':' ||
    (SELECT count(*) FROM asset_source_binding WHERE external_asset_id='preview18-external-asset')")
test "$preview18_rollback" = "$PREVIEW18_SCHEMA_VERSION:Preview 18 Final Seed:1:1:1:1:1" || {
  echo "Preview 18 rollback did not restore the exact pre-upgrade seed" >&2
  exit 1
}

# Prove schemas 151-152 preserve real schema-150 Person facts while changing
# their temporal model. Custom labels become current/former automatically,
# timeless facts become current, legacy Ex becomes Partner (Former), and the
# historical fact gains the seeded Former modifier.
docker exec "$CONTAINER" createdb -U cimmich_migration_test cimmich_schema150_former_test
copy_migrations_through "$TMP_ROOT/through-150-migrations" 150
mkdir -p "$TMP_ROOT/through-150-migrations/patches"
cp "$ROOT/migrations/patches/0048_0001_inventory_two_strike_v1.sql" \
  "$TMP_ROOT/through-150-migrations/patches/"
SCHEMA150_DATABASE_URL="postgres://cimmich_migration_test:synthetic-migration-password@127.0.0.1:${PORT}/cimmich_schema150_former_test"
DATABASE_URL="$SCHEMA150_DATABASE_URL" \
  CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/through-150-migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/schema150-install.log"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_migration_test \
  -d cimmich_schema150_former_test <<'SQL'
INSERT INTO person (person_id, display_name, status, created_by_receipt_id)
VALUES
  ('person_schema150_former_source', 'Schema 150 Source', 'active',
    'receipt_cimmich_typed_connection_fact_v1'),
  ('person_schema150_former_target', 'Schema 150 Target', 'active',
    'receipt_cimmich_typed_connection_fact_v1');

INSERT INTO connection_type (
  type_id, slug, label, inverse_label, source_kind, target_kind, is_symmetric,
  temporal_mode, semantic_kind, is_system_seed, command_id, actor_id
) VALUES (
  'connectiontype_custom_housemate', 'housemate', 'Housemate', 'Housemate',
  'person', 'person', true, 'none', 'housemate', false,
  'schema150.housemate.create', 'migration-acceptance'
);

INSERT INTO connection_fact_event (
  event_id, fact_id, action, source_kind, source_id, target_kind, target_id,
  type_id, validity, date_start, date_end, note, command_id, actor_id
) VALUES
  ('connectionevent_15000000000000000000000000000001',
    'connectionfact_15000000000000000000000000000001', 'record', 'person',
    'person_schema150_former_source', 'person', 'person_schema150_former_target',
    'connectiontype_friend', 'timeless', NULL, NULL, 'Friend note',
    'schema150.fact.friend', 'migration-acceptance'),
  ('connectionevent_15000000000000000000000000000002',
    'connectionfact_15000000000000000000000000000002', 'record', 'person',
    'person_schema150_former_source', 'person', 'person_schema150_former_target',
    'connectiontype_custom_housemate', 'timeless', NULL, NULL, 'Housemate note',
    'schema150.fact.housemate', 'migration-acceptance'),
  ('connectionevent_15000000000000000000000000000003',
    'connectionfact_15000000000000000000000000000003', 'record', 'person',
    'person_schema150_former_source', 'person', 'person_schema150_former_target',
    'connectiontype_ex', 'timeless', '2018-01-01', '2020-12-31', 'Ex note',
    'schema150.fact.ex', 'migration-acceptance');
SQL
DATABASE_URL="$SCHEMA150_DATABASE_URL" npm --prefix "$ROOT/service" run migrate -- apply \
  >"$TMP_ROOT/schema150-former-upgrade.log"
former_upgrade=$(docker exec "$CONTAINER" psql -U cimmich_migration_test \
  -d cimmich_schema150_former_test -Atc \
  "SELECT
    (SELECT max(version) FROM cimmich_schema_migration) || ':' ||
    (SELECT count(*) FROM connection_fact_event) || ':' ||
    (SELECT count(*) FROM current_connection_fact) || ':' ||
    (SELECT count(*) FROM current_connection_fact WHERE validity='current') || ':' ||
    (SELECT count(*) FROM current_connection_fact WHERE validity='past') || ':' ||
    (SELECT count(*) FROM current_connection_fact WHERE type_id='connectiontype_partner' AND validity='past' AND date_start='2018-01-01' AND date_end='2020-12-31' AND note='Ex note') || ':' ||
    (SELECT count(*) FROM current_connection_fact WHERE type_id='connectiontype_custom_housemate' AND validity='current' AND note='Housemate note') || ':' ||
    (SELECT count(*) FROM current_connection_fact WHERE type_id='connectiontype_friend' AND validity='current' AND note='Friend note') || ':' ||
    (SELECT count(*) FROM connection_type WHERE target_kind='person' AND state='active' AND temporal_mode='current_or_past' AND past_label=label || ' (Former)' AND inverse_past_label=inverse_label || ' (Former)') || ':' ||
    (SELECT count(*) FROM connection_type WHERE target_kind='person' AND state='active') || ':' ||
    (SELECT count(*) FROM connection_type WHERE type_id='connectiontype_ex' AND state='retired') || ':' ||
    (SELECT count(*) FROM connection_fact_event WHERE supersedes_event_id IS NOT NULL) || ':' ||
    (SELECT count(*) FROM connection_fact_event_modifier event_modifier JOIN current_connection_fact fact USING (event_id) WHERE event_modifier.modifier_id='connectionmodifier_former' AND fact.validity='past')")
test "$former_upgrade" = "$CURRENT_SCHEMA_VERSION:6:3:2:1:1:1:1:9:9:1:3:1" || {
  echo "schema-150 Former relationship upgrade verification failed: $former_upgrade" >&2
  exit 1
}

# The schema-151 service is the immediate availability rollback. Prove its
# legacy past-event shape remains writable on schema 152 even though it cannot
# yet persist the explicit modifier association.
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_migration_test \
  -d cimmich_schema150_former_test <<'SQL'
BEGIN;
INSERT INTO connection_fact_event (
  event_id, fact_id, action, source_kind, source_id, target_kind, target_id,
  type_id, validity, command_id, actor_id
) VALUES (
  'connectionevent_15200000000000000000000000000001',
  'connectionfact_15200000000000000000000000000001', 'record', 'person',
  'person_schema150_former_source', 'person', 'person_schema150_former_target',
  'connectiontype_best_friend', 'past', 'schema152.rollback.past',
  'schema-151-rollback'
);
ROLLBACK;
SQL

# Schema 117 keeps recurring time on Activity Events and stop order on the
# existing Trip -> Place location relation. Exercise the real constraints and
# current projection on the fully migrated disposable database.
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_migration_test \
  -d cimmich_migration_test <<'SQL'
INSERT INTO context_entity (
  entity_id, entity_kind, event_kind, display_name, recurrence
) VALUES (
  'event_11700000000000000000000000000001', 'event', 'activity',
  'Schema 117 Activity', '{"frequency":"weekly","interval":1,"weekdays":[1,5]}'
), (
  'event_11700000000000000000000000000002', 'event', 'trip',
  'Schema 117 Trip', NULL
);
INSERT INTO context_entity (
  entity_id, entity_kind, place_kind, place_role, display_name
) VALUES (
  'place_11700000000000000000000000000001', 'place', 'unlocated', 'location',
  'Schema 117 Start'
), (
  'place_11700000000000000000000000000002', 'place', 'unlocated', 'location',
  'Schema 117 Finish'
);
INSERT INTO decision (
  decision_id, subject_type, subject_id, action, actor_kind, actor_id,
  reason_code, producer_receipt_id
) VALUES (
  'decision_schema_117_route', 'context_relation',
  'event_11700000000000000000000000000002', 'accept', 'user',
  'migration-acceptance', 'context_relation_attach',
  'receipt_cimmich_context_entity_v1'
);
INSERT INTO context_relation_link (
  link_id, entity_id, target_kind, target_id, relation_kind, state,
  sort_order, decision_id
) VALUES (
  'contextrel_11700000000000000000000000000001',
  'event_11700000000000000000000000000002', 'place',
  'place_11700000000000000000000000000001', 'location', 'accepted', 0,
  'decision_schema_117_route'
), (
  'contextrel_11700000000000000000000000000002',
  'event_11700000000000000000000000000002', 'place',
  'place_11700000000000000000000000000002', 'location', 'accepted', 1,
  'decision_schema_117_route'
);
DO $$
BEGIN
  BEGIN
    UPDATE context_entity
    SET recurrence = '{"frequency":"weekly","interval":"often","weekdays":["Monday"]}'
    WHERE entity_id = 'event_11700000000000000000000000000001';
    RAISE EXCEPTION 'Activity accepted a malformed recurrence rule';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE context_entity
    SET recurrence = '{"frequency":"daily","interval":1}'
    WHERE entity_id = 'event_11700000000000000000000000000002';
    RAISE EXCEPTION 'Trip accepted Activity recurrence';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE context_relation_link SET sort_order = 0
    WHERE link_id = 'contextrel_11700000000000000000000000000002';
    RAISE EXCEPTION 'Trip accepted a duplicate current stop position';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

-- Exercise the supported atomic-swap shape: retired ordered rows release
-- their live positions before replacements claim the swapped positions.
UPDATE context_relation_link
SET state = 'superseded', sort_order = NULL
WHERE link_id IN (
  'contextrel_11700000000000000000000000000001',
  'contextrel_11700000000000000000000000000002'
);
INSERT INTO context_relation_link (
  link_id, entity_id, target_kind, target_id, relation_kind, state,
  sort_order, decision_id, supersedes_link_id
) VALUES (
  'contextrel_11700000000000000000000000000003',
  'event_11700000000000000000000000000002', 'place',
  'place_11700000000000000000000000000001', 'location', 'accepted', 1,
  'decision_schema_117_route',
  'contextrel_11700000000000000000000000000001'
), (
  'contextrel_11700000000000000000000000000004',
  'event_11700000000000000000000000000002', 'place',
  'place_11700000000000000000000000000002', 'location', 'accepted', 0,
  'decision_schema_117_route',
  'contextrel_11700000000000000000000000000002'
);

-- Undo uses the same all-at-once release before restoring the prior order.
UPDATE context_relation_link
SET state = 'superseded', sort_order = NULL
WHERE link_id IN (
  'contextrel_11700000000000000000000000000003',
  'contextrel_11700000000000000000000000000004'
);
INSERT INTO context_relation_link (
  link_id, entity_id, target_kind, target_id, relation_kind, state,
  sort_order, decision_id, supersedes_link_id
) VALUES (
  'contextrel_11700000000000000000000000000005',
  'event_11700000000000000000000000000002', 'place',
  'place_11700000000000000000000000000001', 'location', 'accepted', 0,
  'decision_schema_117_route',
  'contextrel_11700000000000000000000000000003'
), (
  'contextrel_11700000000000000000000000000006',
  'event_11700000000000000000000000000002', 'place',
  'place_11700000000000000000000000000002', 'location', 'accepted', 1,
  'decision_schema_117_route',
  'contextrel_11700000000000000000000000000004'
);
SQL
read -r recurrence_frequency stop_orders retired_positions <<EOF
$(docker exec "$CONTAINER" psql -U cimmich_migration_test -d cimmich_migration_test -AtF ' ' -c \
  "SELECT (SELECT recurrence->>'frequency' FROM context_entity WHERE entity_id='event_11700000000000000000000000000001'), (SELECT string_agg(sort_order::text, ',' ORDER BY sort_order) FROM current_context_relation WHERE entity_id='event_11700000000000000000000000000002'), (SELECT count(sort_order) FROM context_relation_link WHERE state='superseded' AND entity_id='event_11700000000000000000000000000002')")
EOF
if [ "$recurrence_frequency" != "weekly" ] || [ "$stop_orders" != "0,1" ] || \
  [ "$retired_positions" != "0" ]; then
  echo "schema-117 Event time/route verification failed" >&2
  exit 1
fi

# Reproduce the supported semantic-restore boundary: an older export may
# contain a candidate row that predates the schema-19 source-reconciliation
# guard. Schema 72 must retain that historical row while enforcing the guard
# for every new write. This is deliberately a disposable database fixture;
# product migrations remain the only source of release schema truth.
docker exec "$CONTAINER" createdb -U cimmich_migration_test cimmich_legacy_restore_test
copy_migrations_through "$TMP_ROOT/through-71-migrations" 71
mkdir -p "$TMP_ROOT/through-71-migrations/patches"
cp "$ROOT/migrations/patches/0048_0001_inventory_two_strike_v1.sql" \
  "$TMP_ROOT/through-71-migrations/patches/"
LEGACY_DATABASE_URL="postgres://cimmich_migration_test:synthetic-migration-password@127.0.0.1:${PORT}/cimmich_legacy_restore_test"
DATABASE_URL="$LEGACY_DATABASE_URL" CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/through-71-migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/legacy-through-71.log"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_migration_test \
  -d cimmich_legacy_restore_test <<'SQL'
ALTER TABLE identity_claim
  DROP CONSTRAINT identity_claim_candidate_not_source_reconciliation;
INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, privacy_class
) VALUES (
  'receipt_legacy_compatibility_fixture', 'import', 'legacy-compatibility-fixture',
  'v1', now(), now(), 'private'
);
INSERT INTO source_snapshot (
  snapshot_id, input_schema_version, source_digest, locator_root_token,
  started_at, completed_at, declared_asset_count, observed_asset_count, state
) VALUES (
  'snapshot_legacy_compatibility_fixture', 'legacy-semantic-v1', repeat('a', 64),
  'legacy-fixture-token', now(), now(), 1, 1, 'complete'
);
INSERT INTO asset (
  asset_id, locator_token, media_kind, mime_type, source_snapshot_id, state
) VALUES (
  'asset_legacy_compatibility_fixture', 'legacy-fixture-asset', 'image', 'image/jpeg',
  'snapshot_legacy_compatibility_fixture', 'active'
);
INSERT INTO person (
  person_id, display_name, status, created_by_receipt_id
) VALUES (
  'person_legacy_compatibility_fixture', 'Legacy Fixture', 'active',
  'receipt_legacy_compatibility_fixture'
);
INSERT INTO face_observation (
  face_id, asset_id, box_x, box_y, box_w, box_h, detection_confidence,
  quality_measurements, state, producer_receipt_id
) VALUES (
  'face_legacy_compatibility_fixture', 'asset_legacy_compatibility_fixture',
  0.1, 0.1, 0.2, 0.2, 0.9, '{}'::jsonb, 'valid',
  'receipt_legacy_compatibility_fixture'
);
INSERT INTO identity_claim (
  identity_claim_id, face_id, person_id, origin, state, evidence_refs,
  producer_receipt_id
) VALUES (
  'claim_legacy_compatibility_fixture', 'face_legacy_compatibility_fixture',
  'person_legacy_compatibility_fixture', 'import', 'candidate',
  '{"assignment_decision":"accepted_matched_digikam_sidecar_face"}'::jsonb,
  'receipt_legacy_compatibility_fixture'
);
SQL
DATABASE_URL="$LEGACY_DATABASE_URL" npm --prefix "$ROOT/service" run migrate -- apply \
  >"$TMP_ROOT/legacy-current.log"
read -r legacy_version legacy_rows legacy_validated <<EOF
$(docker exec "$CONTAINER" psql -U cimmich_migration_test -d cimmich_legacy_restore_test -AtF ' ' -c \
  "SELECT (SELECT max(version) FROM cimmich_schema_migration), (SELECT count(*) FROM identity_claim WHERE identity_claim_id='claim_legacy_compatibility_fixture'), (SELECT convalidated FROM pg_constraint WHERE conname='identity_claim_candidate_not_source_reconciliation')")
EOF
if [ "$legacy_version" != "$CURRENT_SCHEMA_VERSION" ] || [ "$legacy_rows" != "1" ] || \
  [ "$legacy_validated" != "f" ]; then
  echo "legacy semantic restore compatibility verification failed" >&2
  exit 1
fi

docker exec "$CONTAINER" createdb -U cimmich_migration_test cimmich_schema73_upgrade_test
copy_migrations_through "$TMP_ROOT/through-73-migrations" 73
mkdir -p "$TMP_ROOT/through-73-migrations/patches"
cp "$ROOT/migrations/patches/0048_0001_inventory_two_strike_v1.sql" \
  "$TMP_ROOT/through-73-migrations/patches/"
SCHEMA73_DATABASE_URL="postgres://cimmich_migration_test:synthetic-migration-password@127.0.0.1:${PORT}/cimmich_schema73_upgrade_test"
DATABASE_URL="$SCHEMA73_DATABASE_URL" \
  CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/through-73-migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/schema73.log"
schema73_version=$(docker exec "$CONTAINER" psql -U cimmich_migration_test \
  -d cimmich_schema73_upgrade_test -Atc \
  "SELECT max(version) FROM cimmich_schema_migration")
if [ "$schema73_version" != "73" ]; then
  echo "schema-73 upgrade fixture did not stop at schema 73" >&2
  exit 1
fi
DATABASE_URL="$SCHEMA73_DATABASE_URL" npm --prefix "$ROOT/service" run migrate -- apply \
  >"$TMP_ROOT/schema74-upgrade.log"
read -r upgraded_schema_version entity_scope entity_create entity_update scoped_inventory resolution_decision presentation_media <<EOF
$(docker exec "$CONTAINER" psql -U cimmich_migration_test \
  -d cimmich_schema73_upgrade_test -AtF ' ' -c \
  "SELECT (SELECT max(version) FROM cimmich_schema_migration), position('entity' in pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='context_operation_operation_scope_check'))) > 0, position('create' in pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='context_operation_action_check'))) > 0, position('update' in pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='context_operation_action_check'))) > 0, to_regprocedure('begin_scoped_immich_inventory_run(text,text,text,text[])') IS NOT NULL, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='immich_face_projection' AND column_name='resolution_decision_id'), to_regclass('person_presentation_media') IS NOT NULL")
EOF
if [ "$upgraded_schema_version" != "$CURRENT_SCHEMA_VERSION" ] || \
  [ "$entity_scope" != "t" ] || [ "$entity_create" != "t" ] || \
  [ "$entity_update" != "t" ] || [ "$scoped_inventory" != "t" ] || \
  [ "$resolution_decision" != "t" ] || [ "$presentation_media" != "t" ]; then
  echo "schema 73 to ${CURRENT_SCHEMA_VERSION} upgrade verification failed" >&2
  exit 1
fi

# Private archive operators may have populated schema 81's imported spatial
# locator table even though the public service tree had no producer. Prove a
# schema-101 restore retains that provenance through the current migration
# boundary instead of accepting a broad-count-equivalent destructive drop.
docker exec "$CONTAINER" createdb -U cimmich_migration_test cimmich_schema101_locator_test
copy_migrations_through "$TMP_ROOT/through-101-migrations" 101
mkdir -p "$TMP_ROOT/through-101-migrations/patches"
cp "$ROOT/migrations/patches/0048_0001_inventory_two_strike_v1.sql" \
  "$TMP_ROOT/through-101-migrations/patches/"
SCHEMA101_LOCATOR_DATABASE_URL="postgres://cimmich_migration_test:synthetic-migration-password@127.0.0.1:${PORT}/cimmich_schema101_locator_test"
DATABASE_URL="$SCHEMA101_LOCATOR_DATABASE_URL" \
  CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/through-101-migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/schema101-locator.log"
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_migration_test \
  -d cimmich_schema101_locator_test <<'SQL'
INSERT INTO source_snapshot (
  snapshot_id, input_schema_version, source_digest, locator_root_token,
  started_at, completed_at, declared_asset_count, observed_asset_count, state
) VALUES (
  'snapshot_locator_preservation_fixture', 'locator-preservation-v1',
  repeat('b', 64), 'locator-preservation-root', now(), now(), 1, 1, 'complete'
);
INSERT INTO asset (
  asset_id, locator_token, media_kind, mime_type, source_snapshot_id, state
) VALUES (
  'asset_locator_preservation_fixture', 'locator-preservation-asset',
  'image', 'image/jpeg', 'snapshot_locator_preservation_fixture', 'active'
);
INSERT INTO person (
  person_id, display_name, status, created_by_receipt_id
) VALUES (
  'person_locator_preservation_fixture', 'Locator Preservation Fixture',
  'active', 'receipt_cimmich_imported_identity_locator_v1'
);
INSERT INTO imported_identity_locator (
  locator_id, person_id, asset_id, intended_tag_type, geometry_role,
  box_x, box_y, box_w, box_h, source_instance_suffix, source_kind, state,
  producer_receipt_id, privacy_class
) VALUES (
  'locator_preservation_fixture', 'person_locator_preservation_fixture',
  'asset_locator_preservation_fixture', 'body', 'head_locator',
  0.1, 0.1, 0.2, 0.2, '2', 'synthetic-private-import', 'unresolved',
  'receipt_cimmich_imported_identity_locator_v1', 'private'
);
SQL
DATABASE_URL="$SCHEMA101_LOCATOR_DATABASE_URL" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/schema101-locator-current.log"
read -r locator_schema locator_table locator_rows locator_unresolved <<EOF
$(docker exec "$CONTAINER" psql -U cimmich_migration_test \
  -d cimmich_schema101_locator_test -AtF ' ' -c \
  "SELECT (SELECT max(version) FROM cimmich_schema_migration), to_regclass('imported_identity_locator') IS NOT NULL, (SELECT count(*) FROM imported_identity_locator WHERE locator_id='locator_preservation_fixture'), (SELECT count(*) FROM imported_identity_locator WHERE locator_id='locator_preservation_fixture' AND state='unresolved')")
EOF
if [ "$locator_schema" != "$CURRENT_SCHEMA_VERSION" ] || \
  [ "$locator_table" != "t" ] || [ "$locator_rows" != "1" ] || \
  [ "$locator_unresolved" != "1" ]; then
  echo "schema-101 imported-locator provenance was not preserved" >&2
  exit 1
fi

if docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_migration_test \
  -d cimmich_legacy_restore_test -c \
  "INSERT INTO identity_claim (identity_claim_id,face_id,person_id,origin,state,evidence_refs,producer_receipt_id) VALUES ('claim_legacy_compatibility_forgery','face_legacy_compatibility_fixture','person_legacy_compatibility_fixture','import','candidate','{\"assignment_decision\":\"accepted_matched_digikam_sidecar_face\"}'::jsonb,'receipt_legacy_compatibility_fixture')" \
  >"$TMP_ROOT/legacy-new-write.log" 2>&1; then
  echo "schema ${CURRENT_SCHEMA_VERSION} accepted a newly forged legacy candidate" >&2
  exit 1
fi

cp -R "$ROOT/migrations" "$TMP_ROOT/drifted-migrations"
node -e "const fs=require('node:fs');const p=process.argv[1];const s=fs.readFileSync(p,'utf8');fs.writeFileSync(p,s.replace(/COMMIT;\\s*$/,'-- synthetic checksum drift\\nCOMMIT;\\n'))" \
  "$TMP_ROOT/drifted-migrations/0001_intelligence_v0.sql"
if CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/drifted-migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/drift.log" 2>&1; then
  echo "migration checksum drift was not rejected" >&2
  exit 1
fi
if ! rg -q "MIGRATION_CHECKSUM_MISMATCH" "$TMP_ROOT/drift.log"; then
  cat "$TMP_ROOT/drift.log" >&2
  echo "migration checksum drift returned the wrong failure" >&2
  exit 1
fi

docker exec "$CONTAINER" createdb -U cimmich_migration_test cimmich_resume_test
mkdir -p "$TMP_ROOT/resume-migrations"
printf 'BEGIN;\nCREATE TABLE resume_one (id integer PRIMARY KEY);\nCOMMIT;\n' \
  >"$TMP_ROOT/resume-migrations/0001_resume_one.sql"
printf 'BEGIN;\nCREATE TABLE resume_two (value definitely_missing_type);\nCOMMIT;\n' \
  >"$TMP_ROOT/resume-migrations/0002_resume_two.sql"
RESUME_DATABASE_URL="postgres://cimmich_migration_test:synthetic-migration-password@127.0.0.1:${PORT}/cimmich_resume_test"
if DATABASE_URL="$RESUME_DATABASE_URL" CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/resume-migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/resume-fail.log" 2>&1; then
  echo "interrupted migration fixture unexpectedly passed" >&2
  exit 1
fi
resume_count=$(docker exec "$CONTAINER" psql -U cimmich_migration_test -d cimmich_resume_test -Atc \
  "SELECT count(*) FROM cimmich_schema_migration")
if [ "$resume_count" != "1" ]; then
  echo "completed migration was not retained after a later failure" >&2
  exit 1
fi
printf 'BEGIN;\nCREATE TABLE resume_two (value text);\nCOMMIT;\n' \
  >"$TMP_ROOT/resume-migrations/0002_resume_two.sql"
DATABASE_URL="$RESUME_DATABASE_URL" CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/resume-migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >"$TMP_ROOT/resume-pass.log"
read -r resume_count resume_timing_count <<EOF
$(docker exec "$CONTAINER" psql -U cimmich_migration_test -d cimmich_resume_test -AtF ' ' -c \
  "SELECT count(*), count(*) FILTER (WHERE execution_ms IS NOT NULL) FROM cimmich_schema_migration")
EOF
if [ "$resume_count" != "2" ] || [ "$resume_timing_count" != "2" ]; then
  echo "migration runner did not resume after the failed pending version was repaired" >&2
  exit 1
fi

echo "Cimmich migration runner acceptance: PASS (schema=$CURRENT_SCHEMA_VERSION fresh/preview18-schema142-upgrade-rollback/schema75-upgrade/schema150-former-upgrade/concurrent/checksum/resume/legacy-restore/locator-preservation/new-write-enforcement)"
