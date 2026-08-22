#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CHECKSUM="$ROOT/tools/sha256.sh"
SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
COMPOSE_FILE="$ROOT/ops/stock-immich-v3.1.0.compose.yml"
RUN_ID=${CIMMICH_STOCK_RUN_ID:-$$}
case "$RUN_ID" in
  ''|*[!a-z0-9-]*|[!a-z0-9]*|*-) printf 'stock acceptance: invalid run ID\n' >&2; exit 2 ;;
esac
test "${#RUN_ID}" -le 32 || { printf 'stock acceptance: run ID is too long\n' >&2; exit 2; }
PROJECT="cimmich-stock-${RUN_ID}"
DEFAULT_TMP_ROOT=${TMPDIR:-/tmp}
ACCEPTANCE_TMP_ROOT=${CIMMICH_STOCK_TMP_ROOT:-$DEFAULT_TMP_ROOT}
case "$ACCEPTANCE_TMP_ROOT" in
  /*) ;;
  *) printf 'stock acceptance: temporary root must be absolute\n' >&2; exit 2 ;;
esac
mkdir -p "$ACCEPTANCE_TMP_ROOT"
ACCEPTANCE_TMP_ROOT=$(CDPATH= cd -- "$ACCEPTANCE_TMP_ROOT" && pwd -P)
test "$ACCEPTANCE_TMP_ROOT" != "/" || { printf 'stock acceptance: temporary root is unsafe\n' >&2; exit 2; }
STAGE="${ACCEPTANCE_TMP_ROOT}/${PROJECT}"
test ! -e "$STAGE" || { printf 'stock acceptance: stage already exists\n' >&2; exit 2; }
RESTORE_CONTAINER="${PROJECT}-restore"

: "${CIMMICH_LOCAL_PYTHON_PATH:?Set CIMMICH_LOCAL_PYTHON_PATH to isolated OpenCV 4.11 Python}"
: "${CIMMICH_OPENCV_DETECTOR_MODEL_PATH:?Set CIMMICH_OPENCV_DETECTOR_MODEL_PATH}"
: "${CIMMICH_OPENCV_RECOGNIZER_MODEL_PATH:?Set CIMMICH_OPENCV_RECOGNIZER_MODEL_PATH}"
: "${CIMMICH_PUBLIC_FIXTURE_IMAGE:?Set CIMMICH_PUBLIC_FIXTURE_IMAGE to an explicitly releasable image}"
: "${CIMMICH_PUBLIC_FIXTURE_SHA256:?Set CIMMICH_PUBLIC_FIXTURE_SHA256}"

export COMPOSE_PROJECT_NAME="$PROJECT"
export IMMICH_PORT=${IMMICH_PORT:-22839}
export CIMMICH_DB_PORT=${CIMMICH_DB_PORT:-55439}
export IMMICH_DB_PASSWORD=stockfixtureonlypassword
export CIMMICH_DB_PASSWORD=cimmichfixtureonlypassword
export IMMICH_UPLOAD_ROOT="$STAGE/immich-library"
export IMMICH_DB_ROOT="$STAGE/immich-database"
export IMMICH_MODEL_CACHE_ROOT="$STAGE/immich-model-cache"
export CIMMICH_DB_ROOT="$STAGE/cimmich-database"

RECEIPT="$STAGE/bootstrap-private.json"
BACKUP="$STAGE/cimmich-schema61.dump"
IMMICH_API_URL="http://127.0.0.1:${IMMICH_PORT}/api"
DATABASE_URL="postgres://cimmich:${CIMMICH_DB_PASSWORD}@127.0.0.1:${CIMMICH_DB_PORT}/cimmich"

cleanup() {
  status=$?
  docker rm -f "$RESTORE_CONTAINER" >/dev/null 2>&1 || true
  docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
  if test -f "$STAGE/.cimmich-stock-acceptance" &&
    test "$(cat "$STAGE/.cimmich-stock-acceptance")" = "$PROJECT"; then
    rm -rf "$STAGE"
  fi
  return "$status"
}

umask 077
if ! mkdir "$STAGE"; then
  printf 'stock acceptance: stage already exists\n' >&2
  exit 2
fi
printf '%s\n' "$PROJECT" > "$STAGE/.cimmich-stock-acceptance"
trap cleanup EXIT INT TERM
mkdir -p "$IMMICH_UPLOAD_ROOT" "$IMMICH_DB_ROOT" \
  "$IMMICH_MODEL_CACHE_ROOT" "$CIMMICH_DB_ROOT"

docker compose -f "$COMPOSE_FILE" up -d --wait

DATABASE_URL="$DATABASE_URL" npm --prefix "$ROOT/service" run migrate -- apply >/dev/null

curl -fsS "$IMMICH_API_URL/server/version" >/dev/null

IMMICH_API_URL="$IMMICH_API_URL" \
CIMMICH_STOCK_ADMIN_EMAIL="fixture-${RUN_ID}@example.invalid" \
CIMMICH_STOCK_ADMIN_PASSWORD="${RUN_ID}-fixture-only-password" \
CIMMICH_STOCK_BOOTSTRAP_RECEIPT="$RECEIPT" \
node "$ROOT/service/acceptance/bootstrap-stock-immich.mjs"

IMMICH_API_URL="$IMMICH_API_URL" \
CIMMICH_STOCK_BOOTSTRAP_RECEIPT="$RECEIPT" \
DATABASE_URL="$DATABASE_URL" \
CIMMICH_LOCAL_MEDIA_PROVIDER=opencv-yunet-sface-cpu \
CIMMICH_OPENCV_PROVIDER_ROOT="$ROOT/providers/opencv-sface" \
/usr/bin/time -p node \
  "$ROOT/service/acceptance/stock-immich-lifecycle-journey.mjs"

docker compose -f "$COMPOSE_FILE" exec -T cimmich-database \
  pg_dump -U cimmich -d cimmich -Fc > "$BACKUP"
BACKUP_SHA256=$("$CHECKSUM" generate "$BACKUP" | cut -d ' ' -f 1)

API_KEY=$(node -e \
  "const fs=require('fs');process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1])).apiKey)" \
  "$RECEIPT")
ASSET_ID=$(node -e \
  "const fs=require('fs');process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1])).assetId)" \
  "$RECEIPT")

docker compose -f "$COMPOSE_FILE" stop cimmich-database >/dev/null
curl -fsS "$IMMICH_API_URL/server/version" >/dev/null
OUTAGE_DIGEST=$(curl -fsS -H "x-api-key: $API_KEY" \
  "$IMMICH_API_URL/assets/$ASSET_ID/original" | "$CHECKSUM" generate - | cut -d ' ' -f 1)
test "$OUTAGE_DIGEST" = "$CIMMICH_PUBLIC_FIXTURE_SHA256"

docker compose -f "$COMPOSE_FILE" start cimmich-database >/dev/null
i=0
until docker compose -f "$COMPOSE_FILE" exec -T cimmich-database \
  pg_isready -U cimmich -d cimmich >/dev/null 2>&1; do
  i=$((i + 1))
  test "$i" -lt 60 || { echo "Cimmich database restart timeout" >&2; exit 1; }
  sleep 1
done
docker compose -f "$COMPOSE_FILE" exec -T cimmich-database psql \
  -v ON_ERROR_STOP=1 -U cimmich -d cimmich -Atc \
  "SELECT count(*) FROM face_embedding" | grep -qx 1

docker run -d --name "$RESTORE_CONTAINER" \
  -e POSTGRES_DB=cimmich \
  -e POSTGRES_USER=cimmich \
  -e POSTGRES_PASSWORD=restorefixtureonlypassword \
  --tmpfs /var/lib/postgresql/data \
  pgvector/pgvector:0.8.2-pg17-trixie >/dev/null
i=0
until docker exec "$RESTORE_CONTAINER" pg_isready -U cimmich -d cimmich >/dev/null 2>&1; do
  i=$((i + 1))
  test "$i" -lt 60 || { echo "Restore database readiness timeout" >&2; exit 1; }
  sleep 1
done
docker exec -i "$RESTORE_CONTAINER" pg_restore -U cimmich -d cimmich \
  --no-owner --no-privileges < "$BACKUP"
RESTORED_COUNTS=$(docker exec "$RESTORE_CONTAINER" psql -U cimmich -d cimmich -Atc \
  "SELECT count(*) || ':' || (SELECT count(*) FROM face_embedding) || ':' || (SELECT count(*) FROM identity_claim) FROM immich_asset_projection")
test "$RESTORED_COUNTS" = "1:1:0"
docker rm -f "$RESTORE_CONTAINER" >/dev/null

docker compose -f "$COMPOSE_FILE" stop cimmich-database >/dev/null
docker compose -f "$COMPOSE_FILE" rm -sf cimmich-database >/dev/null
curl -fsS "$IMMICH_API_URL/server/version" >/dev/null
REMOVAL_DIGEST=$(curl -fsS -H "x-api-key: $API_KEY" \
  "$IMMICH_API_URL/assets/$ASSET_ID/original" | "$CHECKSUM" generate - | cut -d ' ' -f 1)
test "$REMOVAL_DIGEST" = "$CIMMICH_PUBLIC_FIXTURE_SHA256"

printf '{"backupSha256":"%s","cimmichDatabase":"separate","cimmichDisableKeepsImmichReady":true,"cimmichRemoveKeepsImmichReady":true,"fixtureSha256":"%s","immichVersion":"3.1.0","independentRestore":{"identityClaims":0,"projectedAssets":1,"embeddings":1},"schemaPatchLevel":1,"schemaVersion":%s,"sourceMutation":"none-during-cimmich-run","status":"PASS"}\n' \
  "$BACKUP_SHA256" "$CIMMICH_PUBLIC_FIXTURE_SHA256" "$SCHEMA_VERSION"
