#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
STOCK_COMPOSE="$ROOT/ops/stock-immich-v3.0.3.compose.yml"
RUN_ID=${CIMMICH_COMPANION_ACCEPTANCE_RUN_ID:-$$}
STOCK_PROJECT="cimmich-companion-stock-${RUN_ID}"
COMPANION_PROJECT="cimmich-companion-acceptance-${RUN_ID}"
STAGE="/private/tmp/${COMPANION_PROJECT}"
STOCK_STAGE="/private/tmp/${STOCK_PROJECT}"
STATE_ROOT="$STAGE/state"
BACKUP_ROOT="$STAGE/${COMPANION_PROJECT}-backup"
RECEIPT="$STAGE/immich-bootstrap.json"
API_KEY_FILE="$STAGE/immich-api-key"
ONBOARDING_PREVIEW="$STAGE/onboarding-preview.json"
ONBOARDING_IMPORT="$STAGE/onboarding-import.json"
IMMICH_PORT=${CIMMICH_COMPANION_ACCEPTANCE_IMMICH_PORT:-22849}
API_PORT=${CIMMICH_COMPANION_ACCEPTANCE_API_PORT:-3421}
UI_PORT=${CIMMICH_COMPANION_ACCEPTANCE_UI_PORT:-3423}

: "${CIMMICH_PUBLIC_FIXTURE_IMAGE:?Set CIMMICH_PUBLIC_FIXTURE_IMAGE}"
: "${CIMMICH_PUBLIC_FIXTURE_SHA256:?Set CIMMICH_PUBLIC_FIXTURE_SHA256}"

cleanup() {
  status=$?
  CIMMICH_COMPANION_STATE_ROOT="$STATE_ROOT" \
    CIMMICH_COMPANION_PROJECT="$COMPANION_PROJECT" \
    "$ROOT/tools/companion.sh" remove "--confirm=$COMPANION_PROJECT" >/dev/null 2>&1 || true
  docker compose --project-name "$STOCK_PROJECT" --file "$STOCK_COMPOSE" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$STAGE" "$STOCK_STAGE"
  return "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$STAGE" "$STOCK_STAGE/immich-library" \
  "$STOCK_STAGE/immich-database" "$STOCK_STAGE/immich-model-cache" \
  "$STOCK_STAGE/cimmich-database"
chmod 700 "$STAGE" "$STOCK_STAGE"

export IMMICH_VERSION=v3.0.3
export IMMICH_DB_PASSWORD=companionacceptanceimmichpassword
export CIMMICH_DB_PASSWORD=companionacceptanceunusedpassword
export IMMICH_UPLOAD_ROOT="$STOCK_STAGE/immich-library"
export IMMICH_DB_ROOT="$STOCK_STAGE/immich-database"
export IMMICH_MODEL_CACHE_ROOT="$STOCK_STAGE/immich-model-cache"
export CIMMICH_DB_ROOT="$STOCK_STAGE/cimmich-database"
export CIMMICH_DB_PORT=55449
export IMMICH_PORT

docker compose --project-name "$STOCK_PROJECT" --file "$STOCK_COMPOSE" \
  up --detach --wait immich-server immich-machine-learning

IMMICH_API_URL="http://127.0.0.1:${IMMICH_PORT}/api" \
CIMMICH_STOCK_ADMIN_EMAIL="fixture-${RUN_ID}@example.invalid" \
CIMMICH_STOCK_ADMIN_PASSWORD="${RUN_ID}-fixture-only-password" \
CIMMICH_STOCK_BOOTSTRAP_RECEIPT="$RECEIPT" \
node "$ROOT/service/acceptance/bootstrap-stock-immich.mjs" >/dev/null

node -e \
  "const fs=require('fs');const v=JSON.parse(fs.readFileSync(process.argv[1]));fs.writeFileSync(process.argv[2],v.apiKey+'\n',{mode:0o600})" \
  "$RECEIPT" "$API_KEY_FILE"

export CIMMICH_COMPANION_STATE_ROOT="$STATE_ROOT"
export CIMMICH_COMPANION_PROJECT="$COMPANION_PROJECT"
export CIMMICH_COMPANION_API_PORT="$API_PORT"
export CIMMICH_COMPANION_UI_PORT="$UI_PORT"

"$ROOT/tools/companion.sh" configure \
  "http://host.docker.internal:${IMMICH_PORT}" "$API_KEY_FILE" >/dev/null
"$ROOT/tools/companion.sh" up >/dev/null
onboarding_status=$(curl --fail --silent --show-error \
  -H 'x-cimmich-device-id: companion-acceptance' \
  -H 'x-cimmich-surface: interactive' \
  "http://127.0.0.1:${API_PORT}/v1/onboarding/immich")
printf '%s' "$onboarding_status" | grep -q '"permissionVerification":"verified"'
printf '%s' "$onboarding_status" | grep -q '"next":"preview"'
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H 'x-cimmich-device-id: companion-acceptance' \
  -H 'x-cimmich-surface: interactive' \
  -X POST \
  -d '{"scope":{"importPeople":true,"includeHiddenPeople":false,"mediaKinds":["image","video"],"providerMode":"deferred","visibilities":["timeline"]}}' \
  "http://127.0.0.1:${API_PORT}/v1/onboarding/immich/preview" > "$ONBOARDING_PREVIEW"
PREVIEW_DIGEST=$(node -e \
  "const fs=require('fs');const v=JSON.parse(fs.readFileSync(process.argv[1]));if(v.counts.assets!==1||v.connection.permissionVerification!=='verified')process.exit(2);process.stdout.write(v.previewDigest)" \
  "$ONBOARDING_PREVIEW")
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H 'x-cimmich-actor: companion-acceptance-owner' \
  -H 'x-cimmich-device-id: companion-acceptance' \
  -H 'x-cimmich-surface: interactive' \
  -X POST \
  -d "{\"commandId\":\"companion-onboarding-import-0001\",\"previewDigest\":\"$PREVIEW_DIGEST\",\"scope\":{\"importPeople\":true,\"includeHiddenPeople\":false,\"mediaKinds\":[\"image\",\"video\"],\"providerMode\":\"deferred\",\"visibilities\":[\"timeline\"]}}" \
  "http://127.0.0.1:${API_PORT}/v1/onboarding/immich/import" > "$ONBOARDING_IMPORT"
node -e \
  "const fs=require('fs');const v=JSON.parse(fs.readFileSync(process.argv[1]));if(v.state!=='completed'||v.replayed!==false||v.next.automaticIdentityAuthority!=='none')process.exit(2)" \
  "$ONBOARDING_IMPORT"
onboarding_replay=$(curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H 'x-cimmich-actor: companion-acceptance-owner' \
  -H 'x-cimmich-device-id: companion-acceptance' \
  -H 'x-cimmich-surface: interactive' \
  -X POST \
  -d "{\"commandId\":\"companion-onboarding-import-0001\",\"previewDigest\":\"$PREVIEW_DIGEST\",\"scope\":{\"importPeople\":true,\"includeHiddenPeople\":false,\"mediaKinds\":[\"image\",\"video\"],\"providerMode\":\"deferred\",\"visibilities\":[\"timeline\"]}}" \
  "http://127.0.0.1:${API_PORT}/v1/onboarding/immich/import")
printf '%s' "$onboarding_replay" | grep -q '"replayed":true'
"$ROOT/tools/companion.sh" sync 1 >/dev/null

health=$(curl --fail --silent --show-error "http://127.0.0.1:${API_PORT}/health")
printf '%s' "$health" | grep -q '"schemaVersion":'"$SCHEMA_VERSION"
curl --fail --silent --show-error "http://127.0.0.1:${UI_PORT}/api/server/version" |
  grep -q '"patch":3'

"$ROOT/tools/companion.sh" backup "$BACKUP_ROOT" >/dev/null
"$ROOT/tools/companion.sh" disable >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${IMMICH_PORT}/api/server/version" |
  grep -q '"patch":3'

"$ROOT/tools/companion.sh" restore "$BACKUP_ROOT" \
  "--confirm=$COMPANION_PROJECT" >/dev/null
"$ROOT/tools/companion.sh" status >/dev/null
"$ROOT/tools/companion.sh" remove "--confirm=$COMPANION_PROJECT" >/dev/null

curl --fail --silent --show-error "http://127.0.0.1:${IMMICH_PORT}/api/server/version" |
  grep -q '"patch":3'
test ! -e "$STATE_ROOT"
test -z "$(docker volume ls --quiet --filter "name=^${COMPANION_PROJECT}-")"

printf '{"backupRestore":true,"companionRemoved":true,"freshOnboardingImport":true,"freshOnboardingReplay":true,"immichHealthyAfterDisable":true,"immichHealthyAfterRemove":true,"immichVersion":"3.0.3","project":"%s","schemaVersion":%s,"status":"PASS"}\n' \
  "$COMPANION_PROJECT" "$SCHEMA_VERSION"
