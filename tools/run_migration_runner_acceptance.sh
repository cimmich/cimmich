#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CURRENT_SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
CONTAINER=cimmich-migration-acceptance
IMAGE=pgvector/pgvector:0.8.2-pg17-trixie
PORT=55433
TMP_ROOT=$(mktemp -d)

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

# Reproduce the supported semantic-restore boundary: an older export may
# contain a candidate row that predates the schema-19 source-reconciliation
# guard. Schema 72 must retain that historical row while enforcing the guard
# for every new write. This is deliberately a disposable database fixture;
# product migrations remain the only source of release schema truth.
docker exec "$CONTAINER" createdb -U cimmich_migration_test cimmich_legacy_restore_test
mkdir -p "$TMP_ROOT/through-71-migrations"
find "$ROOT/migrations" -maxdepth 1 -type f -name '*.sql' \
  ! -name '0072_*' ! -name '0073_*' ! -name '0074_*' ! -name '0075_*' ! -name '0076_*' \
  -exec cp {} "$TMP_ROOT/through-71-migrations/" \;
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
mkdir -p "$TMP_ROOT/through-73-migrations/patches"
find "$ROOT/migrations" -maxdepth 1 -type f -name '*.sql' \
  ! -name '0074_*' ! -name '0075_*' ! -name '0076_*' \
  -exec cp {} "$TMP_ROOT/through-73-migrations/" \;
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

echo "Cimmich migration runner acceptance: PASS (schema=$CURRENT_SCHEMA_VERSION fresh/concurrent/checksum/resume/legacy-restore/new-write-enforcement)"
