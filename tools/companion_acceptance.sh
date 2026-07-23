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
UNRESOLVED_IMPORT="$STAGE/onboarding-unresolved.json"
SECURITY_PROOF="$STAGE/security-proof"
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

companion_compose() {
  docker compose --project-name "$COMPANION_PROJECT" \
    --env-file "$STATE_ROOT/runtime.env" \
    --file "$ROOT/tools/companion.compose.yml" "$@"
}

companion_counts() {
  companion_compose exec -T cimmich-database psql -U cimmich -d cimmich -Atc \
    "SELECT (SELECT count(*) FROM asset WHERE state='active') || ':' || (SELECT count(*) FROM person WHERE status='active') || ':' || (SELECT count(*) FROM context_entity WHERE status='active') || ':' || (SELECT count(*) FROM cimmich_document WHERE status='active') || ':' || (SELECT count(*) FROM manual_subject_tag_operation WHERE state='active') || ':' || (SELECT count(*) FROM source_pack WHERE state='active');"
}

rewrite_backup_checksums() {
  backup_root=$1
  (cd "$backup_root" && sha256sum cimmich.dump documents.tgz config.tgz face-provider.tgz manifest.json > SHA256SUMS)
}

assert_restore_rejected_preserves_state() {
  label=$1
  if "$ROOT/tools/companion.sh" restore "$BACKUP_ROOT" \
    "--confirm=$COMPANION_PROJECT" > "$SECURITY_PROOF/$label.txt" 2>&1; then
    printf '%s backup unexpectedly restored\n' "$label" >&2
    exit 1
  fi
  test "$(companion_compose ps -q cimmich-database)" = "$BASELINE_DATABASE_ID"
  test "$(companion_counts)" = "$BASELINE_COUNTS"
  "$ROOT/tools/companion.sh" status >/dev/null
}

mkdir -p "$STAGE" "$SECURITY_PROOF" "$STOCK_STAGE/immich-library" \
  "$STOCK_STAGE/immich-database" "$STOCK_STAGE/immich-model-cache" \
  "$STOCK_STAGE/cimmich-database"
chmod 700 "$STAGE" "$STOCK_STAGE"

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
CIMMICH_STOCK_ONBOARDING_PEOPLE_FIXTURE=1 \
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
  "const fs=require('fs');const v=JSON.parse(fs.readFileSync(process.argv[1]));if(v.counts.assets!==1||v.counts.people!==2||v.counts.labelledPeople!==1||v.counts.unlabelledPeople!==1||v.counts.assignedFaces!==2||v.connection.permissionVerification!=='verified'){process.stderr.write(JSON.stringify({counts:v.counts,permissionVerification:v.connection?.permissionVerification}));process.exit(2)}process.stdout.write(v.previewDigest)" \
  "$ONBOARDING_PREVIEW")
unresolved_status=$(curl --silent --show-error \
  -H 'content-type: application/json' \
  -H 'x-cimmich-actor: companion-acceptance-owner' \
  -H 'x-cimmich-device-id: companion-acceptance' \
  -H 'x-cimmich-surface: interactive' \
  -X POST \
  -d "{\"commandId\":\"companion-onboarding-import-unresolved\",\"previewDigest\":\"$PREVIEW_DIGEST\",\"scope\":{\"importPeople\":true,\"includeHiddenPeople\":false,\"mediaKinds\":[\"image\",\"video\"],\"providerMode\":\"deferred\",\"visibilities\":[\"timeline\"]}}" \
  -o "$UNRESOLVED_IMPORT" \
  -w '%{http_code}' \
  "http://127.0.0.1:${API_PORT}/v1/onboarding/immich/import")
test "$unresolved_status" = 409
grep -q 'IMMICH_ONBOARDING_PERSON_LABEL_REQUIRED' "$UNRESOLVED_IMPORT"
cluster_preview=$(curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H 'x-cimmich-device-id: companion-acceptance' \
  -H 'x-cimmich-surface: interactive' \
  -X POST \
  -d '{"scope":{"importPeople":true,"includeHiddenPeople":false,"mediaKinds":["image","video"],"providerMode":"deferred","visibilities":["timeline"]}}' \
  "http://127.0.0.1:${API_PORT}/v1/onboarding/immich/person-clusters:preview")
cluster_fields=$(printf '%s' "$cluster_preview" | node -e '
  let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{
    const value=JSON.parse(input);if(value.clusters?.length!==1)process.exit(2);
    const cluster=value.clusters[0];if(cluster.resolution?.state!=="unresolved")process.exit(2);
    process.stdout.write([cluster.immichPersonId,cluster.sourceRevision,cluster.snapshotDigest].join("|"));
  });
')
cluster_id=${cluster_fields%%|*}
cluster_rest=${cluster_fields#*|}
cluster_revision=${cluster_rest%%|*}
cluster_digest=${cluster_rest#*|}
cluster_resolution=$(curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H 'x-cimmich-actor: companion-acceptance-owner' \
  -H 'x-cimmich-device-id: companion-acceptance' \
  -H 'x-cimmich-surface: interactive' \
  -X POST \
  -d "{\"action\":\"unknown\",\"commandId\":\"companion-onboarding-cluster-unknown\",\"expectedSourceRevision\":\"$cluster_revision\",\"scope\":{\"importPeople\":true,\"includeHiddenPeople\":false,\"mediaKinds\":[\"image\",\"video\"],\"providerMode\":\"deferred\",\"visibilities\":[\"timeline\"]},\"snapshotDigest\":\"$cluster_digest\"}" \
  "http://127.0.0.1:${API_PORT}/v1/onboarding/immich/person-clusters/${cluster_id}/resolve")
printf '%s' "$cluster_resolution" | grep -q '"action":"unknown"'
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H 'x-cimmich-actor: companion-acceptance-owner' \
  -H 'x-cimmich-device-id: companion-acceptance' \
  -H 'x-cimmich-surface: interactive' \
  -X POST \
  -d "{\"commandId\":\"companion-onboarding-import-0001\",\"previewDigest\":\"$PREVIEW_DIGEST\",\"scope\":{\"importPeople\":true,\"includeHiddenPeople\":false,\"mediaKinds\":[\"image\",\"video\"],\"providerMode\":\"deferred\",\"visibilities\":[\"timeline\"]}}" \
  "http://127.0.0.1:${API_PORT}/v1/onboarding/immich/import" > "$ONBOARDING_IMPORT"
node -e \
  "const fs=require('fs');const v=JSON.parse(fs.readFileSync(process.argv[1]));if(!['completed','completed_with_review'].includes(v.state)||v.replayed!==false||v.import?.assignedFaces!==2||v.import?.projectedPeople!==1||v.import?.importedSourceFaces!==2||v.next.automaticIdentityAuthority!=='none'){process.stderr.write(JSON.stringify({state:v.state,import:v.import}));process.exit(2)}" \
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
BASELINE_DATABASE_ID=$(companion_compose ps -q cimmich-database)
BASELINE_COUNTS=$(companion_counts)
cp "$BACKUP_ROOT/manifest.json" "$SECURITY_PROOF/manifest.json"
cp "$BACKUP_ROOT/cimmich.dump" "$SECURITY_PROOF/cimmich.dump"
cp "$BACKUP_ROOT/documents.tgz" "$SECURITY_PROOF/documents.tgz"
cp "$BACKUP_ROOT/config.tgz" "$SECURITY_PROOF/config.tgz"
cp "$BACKUP_ROOT/face-provider.tgz" "$SECURITY_PROOF/face-provider.tgz"
cp "$BACKUP_ROOT/SHA256SUMS" "$SECURITY_PROOF/SHA256SUMS"

# A restore is hostile input until all archive, project, schema, checksum,
# database and semantic-count checks pass. Every rejection below happens
# before the running database container or owner state is touched.
node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const value = JSON.parse(fs.readFileSync(path, "utf8"));
  value.project = "another-project";
  fs.writeFileSync(path, `${JSON.stringify(value)}\n`);
' "$BACKUP_ROOT/manifest.json"
rewrite_backup_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state wrong-project
cp "$SECURITY_PROOF/manifest.json" "$BACKUP_ROOT/manifest.json"

node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const value = JSON.parse(fs.readFileSync(path, "utf8"));
  value.health.schemaVersion = 999;
  fs.writeFileSync(path, `${JSON.stringify(value)}\n`);
' "$BACKUP_ROOT/manifest.json"
rewrite_backup_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state newer-schema
cp "$SECURITY_PROOF/manifest.json" "$BACKUP_ROOT/manifest.json"

node -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const value = JSON.parse(fs.readFileSync(path, "utf8"));
  const counts = value.semanticCounts.split(":").map(Number);
  counts[0] += 1;
  value.semanticCounts = counts.join(":");
  fs.writeFileSync(path, `${JSON.stringify(value)}\n`);
' "$BACKUP_ROOT/manifest.json"
rewrite_backup_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state semantic-count-drift
cp "$SECURITY_PROOF/manifest.json" "$BACKUP_ROOT/manifest.json"

printf 'not a postgres dump\n' > "$BACKUP_ROOT/cimmich.dump"
rewrite_backup_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state corrupt-database
cp "$SECURITY_PROOF/cimmich.dump" "$BACKUP_ROOT/cimmich.dump"

node -e '
  const fs = require("node:fs");
  const zlib = require("node:zlib");
  const header = Buffer.alloc(512);
  header.write("../outside-companion", 0, "utf8");
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
' "$BACKUP_ROOT/documents.tgz"
rewrite_backup_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state traversal-archive
cp "$SECURITY_PROOF/documents.tgz" "$BACKUP_ROOT/documents.tgz"

mkdir -p "$SECURITY_PROOF/invalid-config"
printf '{"apiBaseUrl":"http://example.invalid/api","apiKey":"short"}\n' \
  > "$SECURITY_PROOF/invalid-config/immich-credential.json"
tar -czf "$BACKUP_ROOT/config.tgz" -C "$SECURITY_PROOF/invalid-config" .
rewrite_backup_checksums "$BACKUP_ROOT"
assert_restore_rejected_preserves_state invalid-credential
cp "$SECURITY_PROOF/config.tgz" "$BACKUP_ROOT/config.tgz"

rewrite_backup_checksums "$BACKUP_ROOT"
printf 'x' >> "$BACKUP_ROOT/cimmich.dump"
assert_restore_rejected_preserves_state checksum-mismatch
cp "$SECURITY_PROOF/cimmich.dump" "$BACKUP_ROOT/cimmich.dump"
cp "$SECURITY_PROOF/SHA256SUMS" "$BACKUP_ROOT/SHA256SUMS"

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

printf '{"backupRestore":true,"companionRemoved":true,"freshNamedPersonImport":true,"freshOnboardingImport":true,"freshOnboardingReplay":true,"freshUnnamedClusterHeldForOwner":true,"immichHealthyAfterDisable":true,"immichHealthyAfterRemove":true,"immichVersion":"3.0.3","project":"%s","restoreAdversarialCases":7,"schemaVersion":%s,"status":"PASS"}\n' \
  "$COMPANION_PROJECT" "$SCHEMA_VERSION"
