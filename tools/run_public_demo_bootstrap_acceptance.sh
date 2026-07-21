#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
CONTAINER=cimmich-public-demo-acceptance
IMAGE=pgvector/pgvector:0.8.2-pg17-trixie
PORT=${CIMMICH_DEMO_ACCEPTANCE_DB_PORT:-55443}
ARCHIVE_ROOT=${CIMMICH_DEMO_ARCHIVE_ROOT:-"$ROOT/demo/cedar-house-v1"}
STAGE=$(mktemp -d /private/tmp/cimmich-public-demo.XXXXXX)
DATABASE_URL="postgres://cimmich_demo:public-demo-only-password@127.0.0.1:${PORT}/cimmich_demo"
MAP_PATH="$STAGE/immich-map.json"
RECEIPT_A="$STAGE/seed-a.json"
RECEIPT_B="$STAGE/seed-b.json"
BRIDGE_A="$STAGE/display-a.json"
BRIDGE_B="$STAGE/display-b.json"

cleanup() {
  status=$?
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$STAGE"
  return "$status"
}
trap cleanup EXIT INT TERM
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=cimmich_demo \
  -e POSTGRES_USER=cimmich_demo \
  -e POSTGRES_PASSWORD=public-demo-only-password \
  -p "127.0.0.1:${PORT}:5432" \
  --tmpfs /var/lib/postgresql/data \
  "$IMAGE" >/dev/null

i=0
until docker exec "$CONTAINER" pg_isready -U cimmich_demo -d cimmich_demo >/dev/null 2>&1; do
  i=$((i + 1))
  test "$i" -lt 60 || { echo "public demo database readiness timeout" >&2; exit 1; }
  sleep 1
done

CIMMICH_DEMO_ARCHIVE_ROOT="$ARCHIVE_ROOT" \
CIMMICH_DEMO_IMMICH_MAP_PATH="$MAP_PATH" \
  node "$ROOT/service/acceptance/public-demo-map-fixture.mjs"

seed_once() {
  receipt=$1
  bridge=$2
  DATABASE_URL="$DATABASE_URL" npm --prefix "$ROOT/service" run migrate -- apply >/dev/null
  DATABASE_URL="$DATABASE_URL" \
  CIMMICH_DEMO_ARCHIVE_ROOT="$ARCHIVE_ROOT" \
  CIMMICH_DEMO_IMMICH_MAP_PATH="$MAP_PATH" \
  CIMMICH_DEMO_SEED_RECEIPT_PATH="$receipt" \
  CIMMICH_DEMO_DISPLAY_BRIDGE_PATH="$bridge" \
    node "$ROOT/service/bin/bootstrap-public-demo.mjs" >/dev/null
  docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d cimmich_demo -Atc \
    "SELECT concat_ws(':',
      (SELECT count(*) FROM asset WHERE state='active'),
      (SELECT count(*) FROM person WHERE status='active'),
      (SELECT count(*) FROM context_entity WHERE status='active'),
      (SELECT count(*) FROM cimmich_document WHERE status='active'),
      (SELECT count(*) FROM manual_subject_tag_operation WHERE state='active'),
      (SELECT count(*) FROM current_manual_face_matching_lifecycle WHERE state='pending_provider'),
      (SELECT count(*) FROM cimmich_visibility_object WHERE object_scope='asset'),
      (SELECT count(*) FROM source_pack WHERE state='active'))" | grep -qx '51:9:12:5:4:1:17:0'
  docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d cimmich_demo -Atc \
    "SELECT string_agg(tag_type || ':' || count, ',' ORDER BY tag_type)
     FROM (SELECT tag_type, count(*)::text AS count
           FROM manual_subject_tag_operation WHERE state='active'
           GROUP BY tag_type) typed" | grep -qx 'body:1,face:1,head:1,presence:1'
  docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d cimmich_demo -Atc \
    "SELECT count(*) FROM immich_asset_projection
     WHERE source_id='cimmich-public-demo-cedar-house-v1' AND state='active'" | grep -qx 51
}

seed_once "$RECEIPT_A" "$BRIDGE_A"

docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d postgres -c \
  "DROP DATABASE cimmich_demo WITH (FORCE)" >/dev/null
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d postgres -c \
  "CREATE DATABASE cimmich_demo OWNER cimmich_demo" >/dev/null

seed_once "$RECEIPT_B" "$BRIDGE_B"

node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync(process.argv[1]));const b=JSON.parse(fs.readFileSync(process.argv[2]));if(JSON.stringify(a)!==JSON.stringify(b))process.exit(1);if(a.seedDigest.length!==64||a.authority.activeSourcePacks!=='none')process.exit(1)" "$RECEIPT_A" "$RECEIPT_B"
node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync(process.argv[1]));const b=JSON.parse(fs.readFileSync(process.argv[2]));if(JSON.stringify(a)!==JSON.stringify(b)||a.assets.length!==51)process.exit(1)" "$BRIDGE_A" "$BRIDGE_B"

printf '{"assetCount":51,"contextCount":12,"documentCount":5,"manualTagCount":4,"peopleCount":9,"resetReplay":"semantic-byte-identical","schemaVersion":%s,"status":"PASS"}\n' "$SCHEMA_VERSION"
