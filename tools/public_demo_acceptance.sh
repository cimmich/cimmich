#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CHECKSUM="$ROOT/tools/sha256.sh"
SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
RUN_ID=${CIMMICH_PUBLIC_DEMO_ACCEPTANCE_RUN_ID:-$$}
case "$RUN_ID" in
  ''|*[!a-z0-9-]*|[!a-z0-9]*|*-) printf 'public-demo acceptance: invalid run ID\n' >&2; exit 2 ;;
esac
test "${#RUN_ID}" -le 32 || { printf 'public-demo acceptance: run ID is too long\n' >&2; exit 2; }
PROJECT="cimmich-public-demo-acceptance-$RUN_ID"
DEFAULT_TMP_ROOT=${TMPDIR:-/tmp}
ACCEPTANCE_TMP_ROOT=${CIMMICH_PUBLIC_DEMO_ACCEPTANCE_TMP_ROOT:-$DEFAULT_TMP_ROOT}
case "$ACCEPTANCE_TMP_ROOT" in
  /*) ;;
  *) printf 'public-demo acceptance: temporary root must be absolute\n' >&2; exit 2 ;;
esac
mkdir -p "$ACCEPTANCE_TMP_ROOT"
ACCEPTANCE_TMP_ROOT=$(CDPATH= cd -- "$ACCEPTANCE_TMP_ROOT" && pwd -P)
test "$ACCEPTANCE_TMP_ROOT" != "/" || { printf 'public-demo acceptance: temporary root is unsafe\n' >&2; exit 2; }
HARNESS_ROOT="$ACCEPTANCE_TMP_ROOT/$PROJECT-harness"
test ! -e "$HARNESS_ROOT" || { printf 'public-demo acceptance: harness root already exists\n' >&2; exit 2; }
STATE_ROOT="$HARNESS_ROOT/$PROJECT"
ARCHIVE_ROOT=${CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT:?Set CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT to the complete Cedar House V1 bundle}
IMMICH_PORT=${CIMMICH_PUBLIC_DEMO_ACCEPTANCE_IMMICH_PORT:-22959}
API_PORT=${CIMMICH_PUBLIC_DEMO_ACCEPTANCE_API_PORT:-3401}
OWNER_API_PORT=${CIMMICH_PUBLIC_DEMO_ACCEPTANCE_OWNER_API_PORT:-3402}
UI_PORT=${CIMMICH_PUBLIC_DEMO_ACCEPTANCE_UI_PORT:-3403}
COMPOSE_OVERRIDE="$ROOT/tools/public_demo.acceptance.override.yml"
BACKUP_ROOT="$HARNESS_ROOT/$PROJECT-backup"
PORTABLE_BACKUP_PARENT="$HARNESS_ROOT/portable"
PORTABLE_BACKUP_ROOT="$PORTABLE_BACKUP_PARENT/$PROJECT-backup"
UNHEALTHY_BACKUP_PARENT="$HARNESS_ROOT/unhealthy"
UNHEALTHY_BACKUP_ROOT="$UNHEALTHY_BACKUP_PARENT/$PROJECT-backup"
PRIVACY_PROOF_ROOT="$HARNESS_ROOT/privacy-proof"

run_demo() {
  CIMMICH_PUBLIC_DEMO_PROJECT="$PROJECT" \
    CIMMICH_PUBLIC_DEMO_STATE_ROOT="$STATE_ROOT" \
    CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT="$ARCHIVE_ROOT" \
    CIMMICH_PUBLIC_DEMO_IMMICH_PORT="$IMMICH_PORT" \
    CIMMICH_PUBLIC_DEMO_API_PORT="$API_PORT" \
    CIMMICH_PUBLIC_DEMO_ACCEPTANCE_OWNER_API_PORT="$OWNER_API_PORT" \
    CIMMICH_PUBLIC_DEMO_COMPOSE_OVERRIDE="$COMPOSE_OVERRIDE" \
    CIMMICH_PUBLIC_DEMO_UI_PORT="$UI_PORT" \
    "$ROOT/tools/public_demo.sh" "$@"
}

cleanup() {
  status=$?
  if test -f "$STATE_ROOT/.cimmich-public-demo"; then
    run_demo destroy "--confirm=$PROJECT" >/dev/null 2>&1 || true
  fi
  if test -f "$HARNESS_ROOT/.cimmich-public-demo-acceptance" &&
    test "$(cat "$HARNESS_ROOT/.cimmich-public-demo-acceptance")" = "$PROJECT"; then
    rm -rf "$HARNESS_ROOT"
  fi
  return "$status"
}

assert_lifecycle_marker() {
  expected=$1
  actual=$(run_demo status | sed -n 's/.*"counts":"\([^"]*\)".*/\1/p')
  test "$actual" = '51:9:12:5:4:0'
  marker=$(CIMMICH_PUBLIC_DEMO_PROJECT="$PROJECT" \
    CIMMICH_PUBLIC_DEMO_STATE_ROOT="$STATE_ROOT" \
    CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT="$ARCHIVE_ROOT" \
    CIMMICH_PUBLIC_DEMO_IMMICH_PORT="$IMMICH_PORT" \
    CIMMICH_PUBLIC_DEMO_API_PORT="$API_PORT" \
    CIMMICH_PUBLIC_DEMO_UI_PORT="$UI_PORT" \
    docker compose --project-name "$PROJECT" --file "$ROOT/tools/public_demo.compose.yml" \
    exec -T cimmich-database psql -U cimmich -d cimmich -Atc \
    "SELECT marker FROM operator_lifecycle_marker WHERE marker='owner-state-preserved';")
  test "$marker" = "$expected"
  docker run --rm -v "${PROJECT}_cimmich-documents:/documents:ro" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce \
    grep -qx "$expected" /documents/operator-lifecycle-marker
}

assert_restore_rejected_preserves_state() {
  label=$1
  if run_demo restore "$BACKUP_ROOT" "--confirm=$PROJECT" > "$PRIVACY_PROOF_ROOT/$label.txt" 2>&1; then
    printf '%s restore unexpectedly succeeded\n' "$label" >&2
    exit 1
  fi
  assert_lifecycle_marker owner-state-preserved
}

rewrite_checksums() {
  backup_root=$1
  (cd "$backup_root" && "$CHECKSUM" generate cimmich.dump immich.dump immich-library.tgz cimmich-documents.tgz cimmich-face-models.tgz external-library.tgz operator-state.tgz manifest.txt > SHA256SUMS)
}

build_portable_backup_copy() {
  mkdir -p "$PORTABLE_BACKUP_PARENT"
  cp -R "$BACKUP_ROOT" "$PORTABLE_BACKUP_ROOT"
}
umask 077
mkdir "$HARNESS_ROOT"
printf '%s\n' "$PROJECT" > "$HARNESS_ROOT/.cimmich-public-demo-acceptance"
trap cleanup EXIT INT TERM

assert_code() {
  actual=$1
  expected=$2
  test "$actual" = "$expected" || {
    printf 'expected HTTP %s, received %s\n' "$expected" "$actual" >&2
    return 1
  }
}

assert_typed_error() {
  response_file=$1
  code=$2
  grep -q "\"code\":\"$code\"" "$response_file"
}

assert_ui_chunk_revalidation() {
  ui_html=$(curl -fsS "http://127.0.0.1:$UI_PORT/cimmich/documents")
  ui_chunk=$(printf '%s\n' "$ui_html" | sed -n 's/.*href="\(\/_app\/immutable\/[^"?]*\.js\)".*/\1/p' | head -n 1)
  test -n "$ui_chunk" || {
    printf 'Public UI did not expose a production chunk URL\n' >&2
    return 1
  }
  ui_headers=$(curl -fsSI "http://127.0.0.1:$UI_PORT$ui_chunk" | tr -d '\r')
  printf '%s\n' "$ui_headers" | grep -qi '^Cache-Control: no-cache$'
  ui_etag=$(printf '%s\n' "$ui_headers" | sed -n 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*//p' | head -n 1)
  test -n "$ui_etag" || {
    printf 'Public UI production chunk did not expose an ETag\n' >&2
    return 1
  }
  ui_revalidation_code=$(curl -sS -o /dev/null -w '%{http_code}' -H "If-None-Match: $ui_etag" \
    "http://127.0.0.1:$UI_PORT$ui_chunk")
  assert_code "$ui_revalidation_code" 304
}

post_visibility() {
  path=$1
  device=$2
  body_file=$3
  token_header_file=$4
  response_file=$5
  if test -n "$token_header_file"; then
    curl -sS -o "$response_file" -w '%{http_code}' \
      -X POST "http://127.0.0.1:$OWNER_API_PORT$path" \
      -H 'content-type: application/json' \
      -H 'x-cimmich-principal-id: local-primary' \
      -H "x-cimmich-device-id: $device" \
      -H "@$token_header_file" \
      --data-binary "@$body_file"
  else
    curl -sS -o "$response_file" -w '%{http_code}' \
      -X POST "http://127.0.0.1:$OWNER_API_PORT$path" \
      -H 'content-type: application/json' \
      -H 'x-cimmich-principal-id: local-primary' \
      -H "x-cimmich-device-id: $device" \
      --data-binary "@$body_file"
  fi
}

unlock_with_password_file() {
  password_file=$1
  device=$2
  response_file=$3
  {
    printf '{"password":"'
    tr -d '\r\n' < "$password_file"
    printf '"}\n'
  } | curl -sS -o "$response_file" -w '%{http_code}' \
    -X POST "http://127.0.0.1:$OWNER_API_PORT/v1/visibility/unlock" \
    -H 'content-type: application/json' \
    -H 'x-cimmich-principal-id: local-primary' \
    -H "x-cimmich-device-id: $device" \
    --data-binary @-
}

assert_secret_absent() {
  secret_file=$1
  inspected_file=$2
  if grep -F -f "$secret_file" "$inspected_file" >/dev/null 2>&1; then
    printf 'Private demo password leaked into %s\n' "$inspected_file" >&2
    return 1
  fi
}

prove_runtime_secret_boundary() {
  secret_file=$1
  prefix=$2
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
  test -n "$ids"
  api_id=$(docker ps -q \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter 'label=com.docker.compose.service=cimmich-api')
  test -n "$api_id"
  docker exec "$api_id" /bin/sh -c '
    test -r /demo-state/display-bridge.json &&
    test -r /demo-state/immich-credential.json &&
    test -r /demo-state/guided-token &&
    test ! -e /demo-state/immich-guided-credential.json &&
    test ! -e /demo-state/private-password &&
    test ! -e /demo-state/operator.env &&
    test ! -e /demo-state/immich-map.json &&
    test ! -e /demo-state/seed-receipt.json &&
    test ! -e /demo-state/.cimmich-public-demo
  '
  docker inspect $ids > "$PRIVACY_PROOF_ROOT/$prefix-container-inspect.json"
  : > "$PRIVACY_PROOF_ROOT/$prefix-container-logs.txt"
  for id in $ids; do
    docker logs "$id" >> "$PRIVACY_PROOF_ROOT/$prefix-container-logs.txt" 2>&1 || true
  done
  ps -Ao command > "$PRIVACY_PROOF_ROOT/$prefix-process-argv.txt"
  assert_secret_absent "$secret_file" "$PRIVACY_PROOF_ROOT/$prefix-container-inspect.json"
  assert_secret_absent "$secret_file" "$PRIVACY_PROOF_ROOT/$prefix-container-logs.txt"
  assert_secret_absent "$secret_file" "$PRIVACY_PROOF_ROOT/$prefix-process-argv.txt"
}

mkdir -p "$PRIVACY_PROOF_ROOT"
grep -q 'CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE: password' "$ROOT/tools/public_demo.compose.yml"
grep -q -- '--password-stdin' "$ROOT/tools/public_demo.sh"
grep -Fq '}/display-bridge.json:/demo-state/display-bridge.json:ro' "$ROOT/tools/public_demo.compose.yml"
grep -Fq '}/immich-credential.json:/demo-state/immich-credential.json:ro' "$ROOT/tools/public_demo.compose.yml"
grep -Fq '}/guided-token:/demo-state/guided-token:ro' "$ROOT/tools/public_demo.compose.yml"
if grep -Fq '}:/demo-state:ro' "$ROOT/tools/public_demo.compose.yml"; then
  printf 'Long-lived demo services must not mount the full operator-state directory\n' >&2
  exit 1
fi
if grep -q 'CIMMICH_VISIBILITY_TEST_PASSWORD' "$ROOT/tools/public_demo.compose.yml"; then
  printf 'Public demo must not inject an acceptance password\n' >&2
  exit 1
fi

# Reproduce an interrupted first configure before any container exists. The
# exact confirmation-gated reset command must recover this partial operator
# state and continue into the same pristine cold start.
mkdir -p "$STATE_ROOT"
printf 'project=%s\nstate_root=%s\n' "$PROJECT" "$STATE_ROOT" > "$STATE_ROOT/.cimmich-public-demo"
printf "IMMICH_DB_PASSWORD='bad'\n" > "$STATE_ROOT/operator.env"
first=$(run_demo reset "--confirm=$PROJECT" | tail -n 1)
printf '%s\n' "$first" | grep -q '"counts":"51:9:12:5:4:0"'
printf '%s\n' "$first" | grep -q '"immich":"ready"'
printf '%s\n' "$first" | grep -q '"cimmich":"ready"'
printf '%s\n' "$first" | grep -q '"ui":"ready"'

state=$(run_demo status)
test "$state" = "$first"
assert_ui_chunk_revalidation

CIMMICH_E2E_BASE_URL="http://127.0.0.1:$UI_PORT" \
  CIMMICH_E2E_STATE_ROOT="$STATE_ROOT" \
  "$ROOT/tools/run_browser_acceptance.sh"

owner_gateway_unauthenticated=$(curl -sS -o "$PRIVACY_PROOF_ROOT/owner-gateway-unauthenticated.txt" -w '%{http_code}' \
  "http://127.0.0.1:$UI_PORT/cimmich-api/v1/summary")
assert_code "$owner_gateway_unauthenticated" 401
node -e '
  const fs = require("fs");
  const credential = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  fetch(process.argv[2], { headers: { "x-api-key": credential.apiKey } })
    .then(async (response) => {
      fs.writeFileSync(process.argv[3], await response.text(), { mode: 0o600 });
      if (response.status !== 200) process.exitCode = 1;
    })
    .catch(() => process.exit(1));
' "$STATE_ROOT/immich-credential.json" \
  "http://127.0.0.1:$UI_PORT/cimmich-api/v1/summary" \
  "$PRIVACY_PROOF_ROOT/owner-gateway-summary.json"
node -e '
  const fs = require("fs");
  const summary = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Number.isInteger(summary.assets) || summary.assets < 1) process.exit(1);
  if (summary.people !== 7) process.exit(1);
' "$PRIVACY_PROOF_ROOT/owner-gateway-summary.json"

private_password_file=$(run_demo private-password-file)
test "$private_password_file" = "$STATE_ROOT/private-password"
test -s "$private_password_file"
private_mode=$(stat -f '%Lp' "$private_password_file" 2>/dev/null || stat -c '%a' "$private_password_file")
test "$private_mode" = 600
printf '%s\n' "$state" > "$PRIVACY_PROOF_ROOT/ordinary-status.txt"
assert_secret_absent "$private_password_file" "$PRIVACY_PROOF_ROOT/ordinary-status.txt"
guided_token_file=$(run_demo guided-token-file)
test "$guided_token_file" = "$STATE_ROOT/guided-token"
test -s "$guided_token_file"
guided_mode=$(stat -f '%Lp' "$guided_token_file" 2>/dev/null || stat -c '%a' "$guided_token_file")
test "$guided_mode" = 600
assert_secret_absent "$guided_token_file" "$PRIVACY_PROOF_ROOT/ordinary-status.txt"
guided_header_file="$PRIVACY_PROOF_ROOT/guided-header.txt"
{
  printf 'Authorization: Bearer '
  tr -d '\r\n' < "$guided_token_file"
  printf '\n'
} > "$guided_header_file"
chmod 600 "$guided_header_file"
guided_code=$(curl -sS -o "$PRIVACY_PROOF_ROOT/guided-capabilities.json" -w '%{http_code}' \
  -H "@$guided_header_file" \
  "http://127.0.0.1:$API_PORT/v1/guided/v1/capabilities")
assert_code "$guided_code" 200
grep -q '"schemaVersion":"cimmich.guided-access.v1"' "$PRIVACY_PROOF_ROOT/guided-capabilities.json"
assert_secret_absent "$guided_token_file" "$PRIVACY_PROOF_ROOT/guided-capabilities.json"
guided_v2_code=$(curl -sS -o "$PRIVACY_PROOF_ROOT/guided-bootstrap-v2.json" -w '%{http_code}' \
  -H "@$guided_header_file" \
  -H 'x-cimmich-surface: guided' \
  -H 'x-cimmich-principal-id: public-demo-guided-acceptance' \
  -H 'x-cimmich-device-id: public-demo-guided-acceptance' \
  "http://127.0.0.1:$API_PORT/v1/guided/v2/bootstrap")
assert_code "$guided_v2_code" 200
node -e '
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (value.schemaVersion !== "cimmich.guided-bootstrap.v2") process.exit(1);
if (value.authentication.credentialAuthority !== "operate") process.exit(1);
if (value.authentication.credentialVisibilityCeiling !== "private") process.exit(1);
const ids = new Set(value.routes.items.map((item) => item.id));
for (const id of ["immich.sync", "assets.evidence", "manual_subject_tags.attach", "events.create", "places.create", "objects.create", "visibility.object_set", "context.undo"]) {
  if (!ids.has(id)) process.exit(1);
}
if (value.routes.items.some((item) => !item.requestSchema && ["POST", "PATCH"].some((method) => item.methods.includes(method)))) process.exit(1);
' "$PRIVACY_PROOF_ROOT/guided-bootstrap-v2.json"
assert_secret_absent "$guided_token_file" "$PRIVACY_PROOF_ROOT/guided-bootstrap-v2.json"
guided_summary_code=$(curl -sS -o "$PRIVACY_PROOF_ROOT/guided-summary-v2.json" -w '%{http_code}' \
  -H "@$guided_header_file" \
  -H 'x-cimmich-surface: guided' \
  -H 'x-cimmich-principal-id: public-demo-guided-acceptance' \
  -H 'x-cimmich-device-id: public-demo-guided-acceptance' \
  "http://127.0.0.1:$API_PORT/v1/summary")
assert_code "$guided_summary_code" 200
assert_secret_absent "$guided_token_file" "$PRIVACY_PROOF_ROOT/guided-summary-v2.json"
guided_escape_code=$(curl -sS -o "$PRIVACY_PROOF_ROOT/guided-header-omission.json" -w '%{http_code}' \
  "http://127.0.0.1:$API_PORT/v1/summary")
assert_code "$guided_escape_code" 403
assert_typed_error "$PRIVACY_PROOF_ROOT/guided-header-omission.json" GUIDED_SURFACE_REQUIRED
curl -sS "http://127.0.0.1:$OWNER_API_PORT/v1/visibility/status" \
  -H 'x-cimmich-principal-id: local-primary' \
  -H 'x-cimmich-device-id: privacy-tab-one' \
  > "$PRIVACY_PROOF_ROOT/initial-status.json"
grep -q '"privateConfigured":true' "$PRIVACY_PROOF_ROOT/initial-status.json"
grep -q '"privateLockMode":"password"' "$PRIVACY_PROOF_ROOT/initial-status.json"
grep -q '"viewingMode":"standard"' "$PRIVACY_PROOF_ROOT/initial-status.json"

printf '{}\n' > "$PRIVACY_PROOF_ROOT/missing-password.json"
printf '{"password":"definitely-wrong"}\n' > "$PRIVACY_PROOF_ROOT/wrong-password.json"
printf '{"viewingMode":"private"}\n' > "$PRIVACY_PROOF_ROOT/private-mode.json"
printf '{"reason":"explicit"}\n' > "$PRIVACY_PROOF_ROOT/lock.json"

code=$(post_visibility /v1/visibility/unlock privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/missing-password.json" '' "$PRIVACY_PROOF_ROOT/missing-password-response.json")
assert_code "$code" 401
assert_typed_error "$PRIVACY_PROOF_ROOT/missing-password-response.json" VISIBILITY_PRIVATE_PASSWORD_INVALID
code=$(post_visibility /v1/visibility/unlock privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/wrong-password.json" '' "$PRIVACY_PROOF_ROOT/wrong-password-response.json")
assert_code "$code" 401
assert_typed_error "$PRIVACY_PROOF_ROOT/wrong-password-response.json" VISIBILITY_PRIVATE_PASSWORD_INVALID

code=$(unlock_with_password_file "$private_password_file" privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/unlock-response.json")
assert_code "$code" 200
private_token=$(sed -n 's/.*"privateSessionToken":"\([^"]*\)".*/\1/p' "$PRIVACY_PROOF_ROOT/unlock-response.json")
test -n "$private_token"
printf 'x-cimmich-private-session: %s\n' "$private_token" > "$PRIVACY_PROOF_ROOT/private-token.header"
printf 'x-cimmich-private-session: invalid-session-token\n' > "$PRIVACY_PROOF_ROOT/invalid-token.header"

# Reload-equivalent and a second tab carry no module-memory token and remain Standard.
curl -sS "http://127.0.0.1:$OWNER_API_PORT/v1/visibility/status" \
  -H 'x-cimmich-principal-id: local-primary' \
  -H 'x-cimmich-device-id: privacy-tab-one' \
  > "$PRIVACY_PROOF_ROOT/reload-status.json"
grep -q '"viewingMode":"standard"' "$PRIVACY_PROOF_ROOT/reload-status.json"
curl -sS "http://127.0.0.1:$OWNER_API_PORT/v1/visibility/status" \
  -H 'x-cimmich-principal-id: local-primary' \
  -H 'x-cimmich-device-id: privacy-tab-two' \
  > "$PRIVACY_PROOF_ROOT/second-tab-status.json"
grep -q '"viewingMode":"standard"' "$PRIVACY_PROOF_ROOT/second-tab-status.json"

code=$(post_visibility /v1/visibility/mode privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/private-mode.json" '' "$PRIVACY_PROOF_ROOT/missing-token-response.json")
assert_code "$code" 401
assert_typed_error "$PRIVACY_PROOF_ROOT/missing-token-response.json" VISIBILITY_PRIVATE_SESSION_REQUIRED
code=$(post_visibility /v1/visibility/mode privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/private-mode.json" "$PRIVACY_PROOF_ROOT/invalid-token.header" \
  "$PRIVACY_PROOF_ROOT/invalid-token-response.json")
assert_code "$code" 401
assert_typed_error "$PRIVACY_PROOF_ROOT/invalid-token-response.json" VISIBILITY_PRIVATE_SESSION_REQUIRED
code=$(post_visibility /v1/visibility/mode privacy-tab-two \
  "$PRIVACY_PROOF_ROOT/private-mode.json" "$PRIVACY_PROOF_ROOT/private-token.header" \
  "$PRIVACY_PROOF_ROOT/wrong-device-response.json")
assert_code "$code" 401
assert_typed_error "$PRIVACY_PROOF_ROOT/wrong-device-response.json" VISIBILITY_PRIVATE_SESSION_REQUIRED
code=$(post_visibility /v1/visibility/mode privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/private-mode.json" "$PRIVACY_PROOF_ROOT/private-token.header" \
  "$PRIVACY_PROOF_ROOT/valid-token-response.json")
assert_code "$code" 200
grep -q '"viewingMode":"private"' "$PRIVACY_PROOF_ROOT/valid-token-response.json"

rotation=$(run_demo rotate-private-password)
printf '%s\n' "$rotation" > "$PRIVACY_PROOF_ROOT/rotation-receipt.json"
grep -q '"status":"ROTATED"' "$PRIVACY_PROOF_ROOT/rotation-receipt.json"
assert_secret_absent "$private_password_file" "$PRIVACY_PROOF_ROOT/rotation-receipt.json"
code=$(post_visibility /v1/visibility/mode privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/private-mode.json" "$PRIVACY_PROOF_ROOT/private-token.header" \
  "$PRIVACY_PROOF_ROOT/expired-token-response.json")
assert_code "$code" 401
assert_typed_error "$PRIVACY_PROOF_ROOT/expired-token-response.json" VISIBILITY_PRIVATE_SESSION_EXPIRED

code=$(unlock_with_password_file "$private_password_file" privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/second-unlock-response.json")
assert_code "$code" 200
private_token=$(sed -n 's/.*"privateSessionToken":"\([^"]*\)".*/\1/p' "$PRIVACY_PROOF_ROOT/second-unlock-response.json")
test -n "$private_token"
printf 'x-cimmich-private-session: %s\n' "$private_token" > "$PRIVACY_PROOF_ROOT/private-token.header"
code=$(post_visibility /v1/visibility/lock privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/lock.json" "$PRIVACY_PROOF_ROOT/private-token.header" \
  "$PRIVACY_PROOF_ROOT/lock-response.json")
assert_code "$code" 200
code=$(post_visibility /v1/visibility/mode privacy-tab-one \
  "$PRIVACY_PROOF_ROOT/private-mode.json" "$PRIVACY_PROOF_ROOT/private-token.header" \
  "$PRIVACY_PROOF_ROOT/post-lock-token-response.json")
assert_code "$code" 401
assert_typed_error "$PRIVACY_PROOF_ROOT/post-lock-token-response.json" VISIBILITY_PRIVATE_SESSION_REQUIRED

prove_runtime_secret_boundary "$private_password_file" fresh
prove_runtime_secret_boundary "$guided_token_file" fresh-guided
first_private_password=$("$CHECKSUM" generate "$private_password_file" | cut -d ' ' -f 1)

# An unhealthy runtime must fail before any backup directory is created.
api_id=$(docker ps -q \
  --filter "label=com.docker.compose.project=$PROJECT" \
  --filter 'label=com.docker.compose.service=cimmich-api')
test -n "$api_id"
docker stop "$api_id" >/dev/null
if run_demo backup "$UNHEALTHY_BACKUP_ROOT" > "$PRIVACY_PROOF_ROOT/unhealthy-backup.txt" 2>&1; then
  printf 'Unhealthy demo backup unexpectedly succeeded\n' >&2
  exit 1
fi
test ! -e "$UNHEALTHY_BACKUP_ROOT"
docker start "$api_id" >/dev/null
i=0
until curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; do
  i=$((i + 1))
  test "$i" -lt 120 || { printf 'Cimmich restart timeout after unhealthy backup proof\n' >&2; exit 1; }
  sleep 1
done

printf '{"apiKey":"synthetic-upload-only-guided-key"}\n' > "$STATE_ROOT/immich-guided-credential.json"
chmod 600 "$STATE_ROOT/immich-guided-credential.json"
first_guided_upload_credential=$("$CHECKSUM" generate "$STATE_ROOT/immich-guided-credential.json" | cut -d ' ' -f 1)

# A deliberately owner-like database marker and a document-volume marker prove
# that lifecycle commands preserve more than the public semantic count tuple.
CIMMICH_PUBLIC_DEMO_PROJECT="$PROJECT" \
  CIMMICH_PUBLIC_DEMO_STATE_ROOT="$STATE_ROOT" \
  CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT="$ARCHIVE_ROOT" \
  CIMMICH_PUBLIC_DEMO_IMMICH_PORT="$IMMICH_PORT" \
  CIMMICH_PUBLIC_DEMO_API_PORT="$API_PORT" \
  CIMMICH_PUBLIC_DEMO_UI_PORT="$UI_PORT" \
  docker compose --project-name "$PROJECT" --file "$ROOT/tools/public_demo.compose.yml" \
  exec -T cimmich-database psql -U cimmich -d cimmich -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE operator_lifecycle_marker (marker text PRIMARY KEY); INSERT INTO operator_lifecycle_marker VALUES ('owner-state-preserved');" >/dev/null
docker run --rm -v "${PROJECT}_cimmich-documents:/documents" \
  alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce \
  /bin/sh -c "printf '%s\\n' owner-state-preserved > /documents/operator-lifecycle-marker"
assert_lifecycle_marker owner-state-preserved

backup=$(run_demo backup "$BACKUP_ROOT" | tail -n 1)
printf '%s\n' "$backup" | grep -q '"status":"READY"'
printf '%s\n' "$backup" | grep -q '"semanticCounts":"51:9:12:5:4:0"'
test -s "$BACKUP_ROOT/SHA256SUMS"
grep -qx 'semantic_counts_before=51:9:12:5:4:0' "$BACKUP_ROOT/manifest.txt"
grep -qx 'semantic_counts_after=51:9:12:5:4:0' "$BACKUP_ROOT/manifest.txt"
build_portable_backup_copy
grep -qx "schema_version=$SCHEMA_VERSION" "$PORTABLE_BACKUP_ROOT/manifest.txt"

# A manifest whose before/after counts disagree must fail before restore destroys state.
cp "$BACKUP_ROOT/manifest.txt" "$PRIVACY_PROOF_ROOT/valid-manifest.txt"
cp "$BACKUP_ROOT/SHA256SUMS" "$PRIVACY_PROOF_ROOT/valid-sha256sums.txt"
sed 's/^semantic_counts_after=.*/semantic_counts_after=51:8:12:5:8:0/' \
  "$PRIVACY_PROOF_ROOT/valid-manifest.txt" > "$BACKUP_ROOT/manifest.txt"
if run_demo restore "$BACKUP_ROOT" "--confirm=$PROJECT" > "$PRIVACY_PROOF_ROOT/mismatched-restore.txt" 2>&1; then
  printf 'Mismatched backup manifest unexpectedly restored\n' >&2
  exit 1
fi
test "$(run_demo status | sed -n 's/.*"counts":"\([^"]*\)".*/\1/p')" = '51:9:12:5:4:0'
cp "$PRIVACY_PROOF_ROOT/valid-manifest.txt" "$BACKUP_ROOT/manifest.txt"
cp "$PRIVACY_PROOF_ROOT/valid-sha256sums.txt" "$BACKUP_ROOT/SHA256SUMS"

# Every invalid backup fails before the exact running project is replaced.
cp "$BACKUP_ROOT/manifest.txt" "$PRIVACY_PROOF_ROOT/valid-manifest.txt"
sed 's/^project=.*/project=another-project/' "$PRIVACY_PROOF_ROOT/valid-manifest.txt" > "$BACKUP_ROOT/manifest.txt"
rewrite_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state wrong-project
cp "$PRIVACY_PROOF_ROOT/valid-manifest.txt" "$BACKUP_ROOT/manifest.txt"
sed 's/^schema_version=.*/schema_version=999/' "$PRIVACY_PROOF_ROOT/valid-manifest.txt" > "$BACKUP_ROOT/manifest.txt"
rewrite_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state newer-schema
cp "$PRIVACY_PROOF_ROOT/valid-manifest.txt" "$BACKUP_ROOT/manifest.txt"
sed -e 's/^semantic_counts_before=.*/semantic_counts_before=50:9:12:5:4:0/' \
  -e 's/^semantic_counts_after=.*/semantic_counts_after=50:9:12:5:4:0/' \
  "$PRIVACY_PROOF_ROOT/valid-manifest.txt" > "$BACKUP_ROOT/manifest.txt"
rewrite_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state semantic-count-drift
cp "$PRIVACY_PROOF_ROOT/valid-manifest.txt" "$BACKUP_ROOT/manifest.txt"
cp "$PRIVACY_PROOF_ROOT/valid-sha256sums.txt" "$BACKUP_ROOT/SHA256SUMS"
cp "$BACKUP_ROOT/cimmich.dump" "$PRIVACY_PROOF_ROOT/valid-cimmich.dump"
printf 'not a postgres dump\n' > "$BACKUP_ROOT/cimmich.dump"
rewrite_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state corrupt-database
cp "$PRIVACY_PROOF_ROOT/valid-cimmich.dump" "$BACKUP_ROOT/cimmich.dump"
cp "$PRIVACY_PROOF_ROOT/valid-sha256sums.txt" "$BACKUP_ROOT/SHA256SUMS"
cp "$BACKUP_ROOT/operator-state.tgz" "$PRIVACY_PROOF_ROOT/valid-operator-state.tgz"
node -e '
  const fs = require("fs");
  const zlib = require("zlib");
  const header = Buffer.alloc(512);
  header.write("../outside-demo", 0, "utf8");
  header.write("0000644\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write("00000000001\0", 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const checksum = [...header].reduce((sum, value) => sum + value, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  fs.writeFileSync(process.argv[1], zlib.gzipSync(Buffer.concat([
    header, Buffer.from("x"), Buffer.alloc(511), Buffer.alloc(1024),
  ])));
' "$BACKUP_ROOT/operator-state.tgz"
rewrite_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state traversal-archive
cp "$PRIVACY_PROOF_ROOT/valid-operator-state.tgz" "$BACKUP_ROOT/operator-state.tgz"
cp "$PRIVACY_PROOF_ROOT/valid-sha256sums.txt" "$BACKUP_ROOT/SHA256SUMS"

# A checksum mismatch is rejected before archive or database parsing.
printf 'x' >> "$BACKUP_ROOT/cimmich-face-models.tgz"
assert_restore_rejected_preserves_state checksum-mismatch
# Restore the complete valid backup by copying from the portable backup copy,
# whose payloads are byte-identical to the current capture.
cp "$PORTABLE_BACKUP_ROOT/cimmich-face-models.tgz" "$BACKUP_ROOT/cimmich-face-models.tgz"
cp "$PRIVACY_PROOF_ROOT/valid-sha256sums.txt" "$BACKUP_ROOT/SHA256SUMS"

# Command grammar is exact. Extra arguments and the former destructive-looking
# down confirmation are rejected without touching the running state.
if run_demo down "--confirm=$PROJECT" > "$PRIVACY_PROOF_ROOT/down-ambiguous.txt" 2>&1; then
  printf 'down accepted an ambiguous legacy confirmation\n' >&2
  exit 1
fi
if run_demo stop unexpected > "$PRIVACY_PROOF_ROOT/stop-ambiguous.txt" 2>&1; then
  printf 'stop accepted an unexpected argument\n' >&2
  exit 1
fi
assert_lifecycle_marker owner-state-preserved

first_receipt=$("$CHECKSUM" generate "$STATE_ROOT/seed-receipt.json" | cut -d ' ' -f 1)
stopped=$(run_demo stop | tail -n 1)
printf '%s\n' "$stopped" | grep -q '"state":"stopped"'
run_demo up >/dev/null
assert_lifecycle_marker owner-state-preserved
run_demo restart >/dev/null
assert_lifecycle_marker owner-state-preserved
downed=$(run_demo down | tail -n 1)
printf '%s\n' "$downed" | grep -q '"state":"down"'
printf '%s\n' "$downed" | grep -q '"dataPreserved":true'
test -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")"
test -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")"
run_demo up >/dev/null
assert_lifecycle_marker owner-state-preserved

reset=$(run_demo reset "--confirm=$PROJECT" | tail -n 1)
printf '%s\n' "$reset" | grep -q '"counts":"51:9:12:5:4:0"'
second_receipt=$("$CHECKSUM" generate "$STATE_ROOT/seed-receipt.json" | cut -d ' ' -f 1)
test "$first_receipt" != "$second_receipt"
second_private_password=$("$CHECKSUM" generate "$STATE_ROOT/private-password" | cut -d ' ' -f 1)
test "$first_private_password" != "$second_private_password"
if CIMMICH_PUBLIC_DEMO_PROJECT="$PROJECT" CIMMICH_PUBLIC_DEMO_STATE_ROOT="$STATE_ROOT" \
  CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT="$ARCHIVE_ROOT" CIMMICH_PUBLIC_DEMO_IMMICH_PORT="$IMMICH_PORT" \
  CIMMICH_PUBLIC_DEMO_API_PORT="$API_PORT" CIMMICH_PUBLIC_DEMO_UI_PORT="$UI_PORT" \
  docker compose --project-name "$PROJECT" --file "$ROOT/tools/public_demo.compose.yml" \
  exec -T cimmich-database psql -U cimmich -d cimmich -Atc \
  "SELECT marker FROM operator_lifecycle_marker" >/dev/null 2>&1; then
  printf 'reset retained the lifecycle database marker\n' >&2
  exit 1
fi
if docker run --rm -v "${PROJECT}_cimmich-documents:/documents:ro" \
  alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce \
  test -e /documents/operator-lifecycle-marker; then
  printf 'reset retained the lifecycle volume marker\n' >&2
  exit 1
fi

restore=$(run_demo restore "$PORTABLE_BACKUP_ROOT" "--confirm=$PROJECT" | tail -n 1)
printf '%s\n' "$restore" | grep -q '"status":"RESTORED"'
printf '%s\n' "$restore" | grep -q "\"backupSchemaVersion\":$SCHEMA_VERSION"
printf '%s\n' "$restore" | grep -q "\"restoredSchemaVersion\":$SCHEMA_VERSION"
assert_lifecycle_marker owner-state-preserved
restored_receipt=$("$CHECKSUM" generate "$STATE_ROOT/seed-receipt.json" | cut -d ' ' -f 1)
test "$restored_receipt" = "$first_receipt"
restored_private_password=$("$CHECKSUM" generate "$STATE_ROOT/private-password" | cut -d ' ' -f 1)
test "$restored_private_password" = "$first_private_password"
restored_guided_upload_credential=$("$CHECKSUM" generate "$STATE_ROOT/immich-guided-credential.json" | cut -d ' ' -f 1)
test "$restored_guided_upload_credential" = "$first_guided_upload_credential"
restored_guided_upload_mode=$(stat -f '%Lp' "$STATE_ROOT/immich-guided-credential.json" 2>/dev/null || stat -c '%a' "$STATE_ROOT/immich-guided-credential.json")
test "$restored_guided_upload_mode" = 600
restored_state=$(run_demo status)
printf '%s\n' "$restored_state" > "$PRIVACY_PROOF_ROOT/restored-status.json"
assert_secret_absent "$STATE_ROOT/private-password" "$PRIVACY_PROOF_ROOT/restored-status.json"
prove_runtime_secret_boundary "$STATE_ROOT/private-password" restored
prove_runtime_secret_boundary "$STATE_ROOT/guided-token" restored-guided

stopped=$(run_demo stop | tail -n 1)
printf '%s\n' "$stopped" | grep -q '"state":"stopped"'
printf '%s\n' "$stopped" | grep -q '"dataPreserved":true'
test -s "$STATE_ROOT/.cimmich-public-demo"
run_demo up >/dev/null
resumed_state=$(run_demo status)
printf '%s\n' "$resumed_state" | grep -q '"counts":"51:9:12:5:4:0"'
test "$("$CHECKSUM" generate "$STATE_ROOT/seed-receipt.json" | cut -d ' ' -f 1)" = "$first_receipt"

run_demo destroy "--confirm=$PROJECT" >/dev/null
set +e
absent=$(run_demo status)
absent_status=$?
set -e
test "$absent_status" = 3
printf '%s\n' "$absent" | grep -q '"state":"absent"'
test ! -e "$STATE_ROOT"

printf '{"backupPreflight":"malformed-newer-wrong-project-corrupt-count-drift-rejected","downPreservesState":true,"fresh":"PASS","partialStateRecovery":true,"portableRestore":"%s-to-%s","privatePassword":"password-gated","privateTokenFailures":"typed","resetCounts":"51:9:12:5:4:0","resetRuntimeIds":"changed","restartPreservesState":true,"stopStartPreservesState":true,"volumeContinuity":true,"secretBoundary":"argv-env-logs-output-clean","status":"PASS","teardown":"no-residue"}\n' "$SCHEMA_VERSION" "$SCHEMA_VERSION"
