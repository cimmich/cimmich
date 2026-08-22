#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
RUN_ID=${CIMMICH_DEMO_ACCEPTANCE_RUN_ID:-$$}
case "$RUN_ID" in
  ''|*[!a-z0-9-]*|[!a-z0-9]*|*-) printf 'public-demo bootstrap acceptance: invalid run ID\n' >&2; exit 2 ;;
esac
test "${#RUN_ID}" -le 32 || { printf 'public-demo bootstrap acceptance: run ID is too long\n' >&2; exit 2; }
CONTAINER="cimmich-public-demo-acceptance-${RUN_ID}"
CONTAINER_ID=
IMAGE=pgvector/pgvector:0.8.2-pg17-trixie
PORT=${CIMMICH_DEMO_ACCEPTANCE_DB_PORT:-55443}
ARCHIVE_ROOT=${CIMMICH_DEMO_ARCHIVE_ROOT:-"$ROOT/demo/cedar-house-v1"}
# Every assertion below is pinned to the cedar-house-v1 media set (51 assets,
# 9 people, exact source id), and that media is not distributed with the
# repository. Without this check a public checkout fails halfway through with
# an opaque database count mismatch instead of an actionable message.
if [ ! -d "$ARCHIVE_ROOT/media" ]; then
  echo "Demo archive media is missing: $ARCHIVE_ROOT/media" >&2
  echo "This acceptance requires the cedar-house-v1 media set, which is not distributed in the repository." >&2
  echo "Provide it locally or set CIMMICH_DEMO_ARCHIVE_ROOT to a complete cedar-house-v1 archive." >&2
  exit 2
fi
DEFAULT_TMP_ROOT=${TMPDIR:-/tmp}
ACCEPTANCE_TMP_ROOT=${CIMMICH_DEMO_ACCEPTANCE_TMP_ROOT:-$DEFAULT_TMP_ROOT}
case "$ACCEPTANCE_TMP_ROOT" in
  /*) ;;
  *) printf 'public-demo bootstrap acceptance: temporary root must be absolute\n' >&2; exit 2 ;;
esac
mkdir -p "$ACCEPTANCE_TMP_ROOT"
ACCEPTANCE_TMP_ROOT=$(CDPATH= cd -- "$ACCEPTANCE_TMP_ROOT" && pwd -P)
test "$ACCEPTANCE_TMP_ROOT" != "/" || { printf 'public-demo bootstrap acceptance: temporary root is unsafe\n' >&2; exit 2; }
STAGE=$(mktemp -d "$ACCEPTANCE_TMP_ROOT/cimmich-public-demo.XXXXXX")
DATABASE_URL="postgres://cimmich_demo:public-demo-only-password@127.0.0.1:${PORT}/cimmich_demo"
MAP_PATH="$STAGE/immich-map.json"
RECEIPT_A="$STAGE/seed-a.json"
RECEIPT_B="$STAGE/seed-b.json"
BRIDGE_A="$STAGE/display-a.json"
BRIDGE_B="$STAGE/display-b.json"

cleanup() {
  status=$?
  if test -n "$CONTAINER_ID"; then
    docker rm -f "$CONTAINER_ID" >/dev/null 2>&1 || true
  fi
  rm -rf "$STAGE"
  return "$status"
}
trap cleanup EXIT INT TERM
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  printf 'public-demo bootstrap acceptance: container already exists\n' >&2
  exit 2
fi

CONTAINER_ID=$(docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=cimmich_demo \
  -e POSTGRES_USER=cimmich_demo \
  -e POSTGRES_PASSWORD=public-demo-only-password \
  -p "127.0.0.1:${PORT}:5432" \
  --tmpfs /var/lib/postgresql/data \
  "$IMAGE")

i=0
until docker exec "$CONTAINER_ID" pg_isready -U cimmich_demo -d cimmich_demo >/dev/null 2>&1; do
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
  counts=$(docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d cimmich_demo -Atc \
    "SELECT concat_ws(':',
      (SELECT count(*) FROM asset WHERE state='active'),
      (SELECT count(*) FROM person WHERE status='active'),
      (SELECT count(*) FROM context_entity WHERE status='active'),
      (SELECT count(*) FROM cimmich_document WHERE status='active'),
      (SELECT count(*) FROM manual_subject_tag_operation WHERE state='active'),
      (SELECT count(*) FROM current_manual_face_matching_lifecycle WHERE state='pending_provider'),
      (SELECT count(*) FROM cimmich_visibility_object WHERE object_scope='asset'),
      (SELECT count(*) FROM source_pack WHERE state='active'))")
  if [ "$counts" != '51:9:12:5:4:1:16:0' ]; then
    printf 'Unexpected public demo counts: %s\n' "$counts" >&2
    return 1
  fi
  docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d cimmich_demo -Atc \
    "SELECT string_agg(tag_type || ':' || count, ',' ORDER BY tag_type)
     FROM (SELECT tag_type, count(*)::text AS count
           FROM manual_subject_tag_operation WHERE state='active'
           GROUP BY tag_type) typed" | grep -qx 'body:1,face:1,head:1,presence:1'
  docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d cimmich_demo -Atc \
    "SELECT count(*) FROM immich_asset_projection
     WHERE source_id='cimmich-public-demo-cedar-house-v1' AND state='active'" | grep -qx 51
  docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d cimmich_demo -Atc \
    "SELECT (SELECT count(*) FROM media_content_fingerprint WHERE verification='byte_verified') || ':' ||
            (SELECT count(*) FROM asset_content_link WHERE state='active') || ':' ||
            (SELECT count(*) FROM asset_source_binding
             WHERE source_kind='immich' AND source_id='cimmich-public-demo-cedar-house-v1'
               AND state='active')" | grep -qx '51:51:51'
}

seed_once "$RECEIPT_A" "$BRIDGE_A"

docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d postgres -c \
  "DROP DATABASE cimmich_demo WITH (FORCE)" >/dev/null
docker exec "$CONTAINER_ID" psql -v ON_ERROR_STOP=1 -U cimmich_demo -d postgres -c \
  "CREATE DATABASE cimmich_demo OWNER cimmich_demo" >/dev/null

seed_once "$RECEIPT_B" "$BRIDGE_B"

node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync(process.argv[1]));const b=JSON.parse(fs.readFileSync(process.argv[2]));if(JSON.stringify(a)!==JSON.stringify(b))process.exit(1);if(a.seedDigest.length!==64||a.authority.activeSourcePacks!=='none')process.exit(1)" "$RECEIPT_A" "$RECEIPT_B"
node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync(process.argv[1]));const b=JSON.parse(fs.readFileSync(process.argv[2]));if(JSON.stringify(a)!==JSON.stringify(b)||a.assets.length!==51)process.exit(1)" "$BRIDGE_A" "$BRIDGE_B"

printf '{"assetCount":51,"contextCount":12,"documentCount":5,"manualTagCount":4,"peopleCount":9,"resetReplay":"semantic-byte-identical","schemaVersion":%s,"status":"PASS","visibilityOverrides":16}\n' "$SCHEMA_VERSION"
