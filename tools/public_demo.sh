#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE="$ROOT/tools/public_demo.compose.yml"
PROJECT=${CIMMICH_PUBLIC_DEMO_PROJECT:-cimmich-public-demo}
STATE_ROOT=${CIMMICH_PUBLIC_DEMO_STATE_ROOT:-"${XDG_STATE_HOME:-$HOME/.local/state}/$PROJECT"}
ARCHIVE_ROOT=${CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT:-}
IMMICH_PORT=${CIMMICH_PUBLIC_DEMO_IMMICH_PORT:-22859}
API_PORT=${CIMMICH_PUBLIC_DEMO_API_PORT:-3301}
UI_PORT=${CIMMICH_PUBLIC_DEMO_UI_PORT:-3303}

CURRENT_SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
ARGUMENT_COUNT=$#
COMMAND=${1:-status}
ARGUMENT=${2:-}
CONFIRM=${3:-}
SENTINEL="$STATE_ROOT/.cimmich-public-demo"
OPERATOR_ENV="$STATE_ROOT/operator.env"
BOOTSTRAP_ENV="$STATE_ROOT/bootstrap.env"
PRIVATE_PASSWORD_FILE="$STATE_ROOT/private-password"
GUIDED_TOKEN_FILE="$STATE_ROOT/guided-token"

fail() {
  printf 'public-demo: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

random_hex() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

validate_project() {
  case "$PROJECT" in
    cimmich-public-demo | cimmich-public-demo-[a-z0-9-]*) ;;
    *) fail "project must be cimmich-public-demo or cimmich-public-demo-<safe-suffix>" ;;
  esac
}

validate_state_root() {
  case "$STATE_ROOT" in
    /*) ;;
    *) fail "state root must be absolute" ;;
  esac
  test "$(basename "$STATE_ROOT")" = "$PROJECT" ||
    fail "state root basename must exactly match project $PROJECT"
  test "$STATE_ROOT" != "/" || fail "state root is unsafe"
  test "$STATE_ROOT" != "$HOME" || fail "state root is unsafe"
  test "$STATE_ROOT" != "$ROOT" || fail "state root is unsafe"
}

validate_port() {
  case "$1" in
    '' | *[!0-9]*) fail "$2 port must be an integer" ;;
  esac
  test "$1" -ge 1024 && test "$1" -le 65535 ||
    fail "$2 port must be between 1024 and 65535"
}

operator_environment_is_valid() {
  environment_file=$1
  test -f "$environment_file" || return 1
  environment_lines=$(wc -l < "$environment_file" | tr -d ' ')
  test "$environment_lines" = 4 || test "$environment_lines" = 5 || return 1
  grep -Eq "^IMMICH_DB_PASS""WORD='[0-9a-f]{64}'$" "$environment_file" || return 1
  grep -Eq "^CIMMICH_DB_PASS""WORD='[0-9a-f]{64}'$" "$environment_file" || return 1
  grep -qx "CIMMICH_DEMO_ADMIN_EMAIL='cedar-house-demo@example.invalid'" "$environment_file" || return 1
  grep -Eq "^CIMMICH_DEMO_ADMIN_PASS""WORD='[0-9a-f]{64}'$" "$environment_file" || return 1
  if test "$environment_lines" = 5; then
    grep -qx "CIMMICH_PUBLIC_DEMO_FACE_PROVIDER='opencv-yunet-sface-cpu'" "$environment_file" || return 1
  fi
}

load_environment() {
  operator_environment_is_valid "$OPERATOR_ENV" ||
    fail "operator state is incomplete; run reset with exact confirmation"
  # shellcheck disable=SC1090
  . "$OPERATOR_ENV"
  CIMMICH_PUBLIC_DEMO_FACE_PROVIDER=${CIMMICH_PUBLIC_DEMO_FACE_PROVIDER:-}
  export IMMICH_DB_PASSWORD CIMMICH_DB_PASSWORD CIMMICH_PUBLIC_DEMO_FACE_PROVIDER
}

load_removal_environment() {
  if operator_environment_is_valid "$OPERATOR_ENV"; then
    load_environment
    return
  fi
  # Compose requires database placeholders even when it is only resolving the
  # exact project for removal. These values are never used to start a service.
  IMMICH_DB_PASSWORD=$(printf '%064d' 0)
  CIMMICH_DB_PASSWORD=$(printf '%064d' 0)
  CIMMICH_PUBLIC_DEMO_FACE_PROVIDER=
  export IMMICH_DB_PASSWORD CIMMICH_DB_PASSWORD CIMMICH_PUBLIC_DEMO_FACE_PROVIDER
}

compose() {
  CIMMICH_PUBLIC_DEMO_PROJECT="$PROJECT" \
    CIMMICH_PUBLIC_DEMO_STATE_ROOT="$STATE_ROOT" \
    CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT="${ARCHIVE_ROOT:-$ROOT/demo/cedar-house-v1}" \
    CIMMICH_PUBLIC_DEMO_IMMICH_PORT="$IMMICH_PORT" \
    CIMMICH_PUBLIC_DEMO_API_PORT="$API_PORT" \
    CIMMICH_PUBLIC_DEMO_UI_PORT="$UI_PORT" \
    docker compose --project-name "$PROJECT" --file "$COMPOSE_FILE" "$@"
}

exact_container_ids() {
  docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"
}

validate_prerequisites() {
  validate_project
  validate_state_root
  validate_port "$IMMICH_PORT" Immich
  validate_port "$API_PORT" Cimmich-API
  validate_port "$UI_PORT" Cimmich-UI
  test "$IMMICH_PORT" != "$API_PORT" && test "$IMMICH_PORT" != "$UI_PORT" && test "$API_PORT" != "$UI_PORT" ||
    fail "Immich, API and UI ports must be distinct"
  require_command docker
  require_command curl
  require_command awk
  require_command find
  require_command nc
  require_command sha256sum
  require_command tar
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
}

validate_archive() {
  test -n "$ARCHIVE_ROOT" || fail "set CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT to the complete Cedar House V1 bundle"
  case "$ARCHIVE_ROOT" in
    /*) ;;
    *) fail "archive root must be absolute" ;;
  esac
  for path in \
    "$ARCHIVE_ROOT/LICENSE.md" \
    "$ARCHIVE_ROOT/NOTICE.md" \
    "$ARCHIVE_ROOT/ATTRIBUTION.md" \
    "$ARCHIVE_ROOT/shot-ledger.csv" \
    "$ARCHIVE_ROOT/provenance/manifest.csv" \
    "$ARCHIVE_ROOT/provenance/checksums.sha256"; do
    test -s "$path" || fail "archive rights/provenance input is missing: $path"
  done
  count=$(find "$ARCHIVE_ROOT/media" -type f -name '*.png' | wc -l | tr -d ' ')
  test "$count" = 51 || fail "archive must contain exactly 51 PNG assets"
}

check_port_free() {
  if nc -z 127.0.0.1 "$1" >/dev/null 2>&1; then
    fail "port $1 is already in use; choose a free CIMMICH_PUBLIC_DEMO_*_PORT"
  fi
}

write_operator_state() {
  umask 077
  mkdir -p "$STATE_ROOT"
  test ! -e "$SENTINEL" || fail "state already exists; use up, status, restart, reset or destroy"
  IMMICH_DB_PASSWORD=$(random_hex)
  CIMMICH_DB_PASSWORD=$(random_hex)
  CIMMICH_DEMO_ADMIN_PASSWORD=$(random_hex)
  CIMMICH_DEMO_ADMIN_EMAIL=cedar-house-demo@example.invalid
  printf 'project=%s\nstate_root=%s\n' "$PROJECT" "$STATE_ROOT" > "$SENTINEL"
  printf "IMMICH_DB_PASSWORD='%s'\nCIMMICH_DB_PASSWORD='%s'\nCIMMICH_DEMO_ADMIN_EMAIL='%s'\nCIMMICH_DEMO_ADMIN_PASSWORD='%s'\n" \
    "$IMMICH_DB_PASSWORD" "$CIMMICH_DB_PASSWORD" \
    "$CIMMICH_DEMO_ADMIN_EMAIL" "$CIMMICH_DEMO_ADMIN_PASSWORD" > "$OPERATOR_ENV"
  {
    random_hex
    printf '\n'
  } > "$PRIVATE_PASSWORD_FILE"
  {
    random_hex
    printf '\n'
  } > "$GUIDED_TOKEN_FILE"
  chmod 600 "$SENTINEL" "$OPERATOR_ENV" "$PRIVATE_PASSWORD_FILE" "$GUIDED_TOKEN_FILE"
  export IMMICH_DB_PASSWORD CIMMICH_DB_PASSWORD
}

ensure_guided_token() {
  if test ! -s "$GUIDED_TOKEN_FILE"; then
    umask 077
    {
      random_hex
      printf '\n'
    } > "$GUIDED_TOKEN_FILE"
  fi
  chmod 600 "$GUIDED_TOKEN_FILE"
}

write_bootstrap_environment() {
  umask 077
  printf "CIMMICH_DEMO_ADMIN_EMAIL='%s'\nCIMMICH_DEMO_ADMIN_PASSWORD='%s'\n" \
    "$CIMMICH_DEMO_ADMIN_EMAIL" "$CIMMICH_DEMO_ADMIN_PASSWORD" > "$BOOTSTRAP_ENV"
  chmod 600 "$BOOTSTRAP_ENV"
}

verify_sentinel() {
  test -f "$SENTINEL" || fail "resolved demo target is absent"
  grep -qx "project=$PROJECT" "$SENTINEL" || fail "demo sentinel project mismatch"
  grep -qx "state_root=$STATE_ROOT" "$SENTINEL" || fail "demo sentinel root mismatch"
}

wait_http() {
  label=$1
  url=$2
  attempts=$3
  i=0
  until curl -fsS "$url" >/dev/null 2>&1; do
    i=$((i + 1))
    test "$i" -lt "$attempts" || fail "$label readiness timeout"
    sleep 2
  done
}

semantic_counts() {
  compose exec -T cimmich-database psql -U cimmich -d cimmich -Atc \
    "SELECT (SELECT count(*) FROM asset WHERE state='active') || ':' || (SELECT count(*) FROM person WHERE status='active') || ':' || (SELECT count(*) FROM context_entity WHERE status='active') || ':' || (SELECT count(*) FROM cimmich_document WHERE status='active') || ':' || (SELECT count(*) FROM manual_subject_tag_operation WHERE state='active') || ':' || (SELECT count(*) FROM source_pack WHERE state='active');"
}

validate_semantic_counts() {
  printf '%s\n' "$1" | awk -F: '
    NF != 6 { exit 1 }
    {
      for (field = 1; field <= NF; field += 1) {
        if ($field !~ /^[0-9]+$/) exit 1
      }
    }
  ' >/dev/null 2>&1 || fail "demo semantic counts are unavailable or malformed"
}

validate_current_runtime() {
  immich_version=$(curl -fsS "http://127.0.0.1:$IMMICH_PORT/api/server/version" 2>/dev/null) ||
    fail "Immich is not healthy"
  case "$immich_version" in
    *'"major":3'*'"minor":0'*'"patch":3'*) ;;
    *) fail "Immich runtime is not exact supported version 3.0.3" ;;
  esac

  cimmich_health=$(curl -fsS "http://127.0.0.1:$API_PORT/health" 2>/dev/null) ||
    fail "Cimmich is not healthy"
  case "$cimmich_health" in
    *'"status":"ok"'*) ;;
    *) fail "Cimmich is not healthy" ;;
  esac
  case "$cimmich_health" in
    *'"database":"ready"'*) ;;
    *) fail "Cimmich database is not ready" ;;
  esac
  case "$cimmich_health" in
    *'"schemaVersion":'"$CURRENT_SCHEMA_VERSION"*) ;;
    *) fail "Cimmich is not at schema $CURRENT_SCHEMA_VERSION" ;;
  esac
  curl -fsS "http://127.0.0.1:$UI_PORT/" >/dev/null 2>&1 || fail "Cimmich UI is not healthy"
}

validate_backup_path() {
  backup_path=$1
  case "$backup_path" in
    /*) ;;
    *) fail "backup path must be absolute" ;;
  esac
  test "$backup_path" != "/" || fail "backup path is unsafe"
  test "$backup_path" != "$HOME" || fail "backup path is unsafe"
  test "$backup_path" != "$ROOT" || fail "backup path is unsafe"
  test "$backup_path" != "$STATE_ROOT" || fail "backup path must be outside demo state"
  case "$backup_path" in
    "$STATE_ROOT"/*) fail "backup path must be outside demo state" ;;
  esac
  test "$(basename "$backup_path")" = "$PROJECT-backup" ||
    fail "backup directory basename must exactly equal $PROJECT-backup"
}

validate_tar_members() {
  archive=$1
  if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    fail "backup archive contains unsafe traversal members"
  fi
}

validate_operator_state_archive() {
  backup_path=$1
  operator_validation_root=${TMPDIR:-/tmp}/$PROJECT-operator-validate-$$
  test ! -e "$operator_validation_root" || fail "operator-state validation path already exists"
  umask 077
  mkdir -p "$operator_validation_root"
  tar -xzf "$backup_path/operator-state.tgz" -C "$operator_validation_root"
  operator_validation_cleanup() {
    rm -rf "$operator_validation_root"
  }
  trap operator_validation_cleanup EXIT INT TERM
  grep -qx "project=$PROJECT" "$operator_validation_root/.cimmich-public-demo" ||
    fail "backup operator sentinel project mismatch"
  grep -qx "state_root=$STATE_ROOT" "$operator_validation_root/.cimmich-public-demo" ||
    fail "backup operator sentinel root mismatch"
  operator_environment_is_valid "$operator_validation_root/operator.env" ||
    fail "backup operator environment is invalid"
  chmod 600 "$operator_validation_root/operator.env"
  # shellcheck disable=SC1090
  . "$operator_validation_root/operator.env"
  export IMMICH_DB_PASSWORD CIMMICH_DB_PASSWORD
  trap - EXIT INT TERM
  operator_validation_cleanup
}

preflight_backup_databases() {
  backup_path=$1
  # Keep service DNS labels under 63 bytes even for a long exact project name.
  preflight_id="cimmich-restore-preflight-$$"
  preflight_network="$preflight_id-network"
  preflight_cimmich="$preflight_id-cimmich"
  preflight_immich="$preflight_id-immich"
  preflight_password=$(random_hex)
  compose build cimmich-api >/dev/null
  preflight_cleanup() {
    docker rm -f "$preflight_cimmich" "$preflight_immich" >/dev/null 2>&1 || true
    docker network rm "$preflight_network" >/dev/null 2>&1 || true
  }
  trap preflight_cleanup EXIT INT TERM
  docker network create "$preflight_network" >/dev/null
  docker run -d --name "$preflight_cimmich" --network "$preflight_network" \
    -e POSTGRES_DB=cimmich -e POSTGRES_USER=cimmich -e POSTGRES_PASSWORD="$preflight_password" \
    pgvector/pgvector:0.8.2-pg17-trixie@sha256:5c97c57367a485a8e99389548db67d441ab1a878f5492c3df04989f34ecf3c75 >/dev/null
  docker run -d --name "$preflight_immich" --network "$preflight_network" \
    -e POSTGRES_DB=immich -e POSTGRES_USER=immich -e POSTGRES_PASSWORD="$preflight_password" \
    ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23 >/dev/null
  i=0
  until docker exec "$preflight_cimmich" pg_isready -U cimmich -d cimmich >/dev/null 2>&1 &&
    docker exec "$preflight_immich" pg_isready -U immich -d immich >/dev/null 2>&1; do
    i=$((i + 1))
    test "$i" -lt 60 || fail "backup preflight database readiness timeout"
    sleep 1
  done
  docker exec -i "$preflight_cimmich" pg_restore -U cimmich -d cimmich --no-owner --no-privileges < "$backup_path/cimmich.dump" ||
    fail "backup Cimmich database restore preflight failed"
  docker exec -i "$preflight_immich" pg_restore -U immich -d immich --no-owner --no-privileges < "$backup_path/immich.dump" ||
    fail "backup Immich database restore preflight failed"
  restored_backup_schema=$(docker exec "$preflight_cimmich" psql -U cimmich -d cimmich -Atc \
    'SELECT COALESCE(max(version), 0) FROM cimmich_schema_migration;') ||
    fail "backup migration ledger is unreadable"
  test "$restored_backup_schema" = "$BACKUP_SCHEMA_VERSION" ||
    fail "backup schema manifest does not match its database ledger"
  docker run --rm --network "$preflight_network" \
    -e DATABASE_URL="postgres://cimmich:$preflight_password@$preflight_cimmich:5432/cimmich" \
    "$PROJECT-api:current-source" node bin/migrate.mjs apply >/dev/null ||
    fail "backup cannot migrate to the current Cimmich schema"
  migrated_schema=$(docker exec "$preflight_cimmich" psql -U cimmich -d cimmich -Atc \
    'SELECT COALESCE(max(version), 0) FROM cimmich_schema_migration;') ||
    fail "migrated backup ledger is unreadable"
  test "$migrated_schema" = "$CURRENT_SCHEMA_VERSION" ||
    fail "backup did not migrate to the current Cimmich schema"
  preflight_counts=$(docker exec "$preflight_cimmich" psql -U cimmich -d cimmich -Atc \
    "SELECT (SELECT count(*) FROM asset WHERE state='active') || ':' || (SELECT count(*) FROM person WHERE status='active') || ':' || (SELECT count(*) FROM context_entity WHERE status='active') || ':' || (SELECT count(*) FROM cimmich_document WHERE status='active') || ':' || (SELECT count(*) FROM manual_subject_tag_operation WHERE state='active') || ':' || (SELECT count(*) FROM source_pack WHERE state='active');") ||
    fail "backup semantic counts are unreadable"
  validate_semantic_counts "$preflight_counts"
  test "$preflight_counts" = "$BACKUP_SEMANTIC_COUNTS" ||
    fail "backup database semantic counts do not match its manifest"
  trap - EXIT INT TERM
  preflight_cleanup
}

backup() {
  validate_prerequisites
  verify_sentinel
  load_environment
  backup_path=$ARGUMENT
  test -n "$backup_path" || fail "backup requires an absolute $PROJECT-backup directory"
  validate_backup_path "$backup_path"
  test ! -e "$backup_path" || fail "backup target already exists"
  validate_current_runtime
  backup_counts_before=$(semantic_counts 2>/dev/null) || fail "unable to read demo semantic counts"
  validate_semantic_counts "$backup_counts_before"
  backup_staging="$backup_path.incomplete.$$"
  test ! -e "$backup_staging" || fail "incomplete backup staging path already exists"

  umask 077
  mkdir -p "$backup_staging"
  backup_complete=0
  backup_cleanup() {
    compose up -d >/dev/null 2>&1 || true
    if test "$backup_complete" = 0; then
      rm -rf "$backup_staging"
    fi
  }
  trap backup_cleanup EXIT INT TERM
  compose stop public-demo-ui cimmich-api immich-server immich-machine-learning >/dev/null
  compose exec -T cimmich-database pg_dump -U cimmich -d cimmich -Fc > "$backup_staging/cimmich.dump"
  compose exec -T immich-database pg_dump -U immich -d immich -Fc > "$backup_staging/immich.dump"
  compose stop cimmich-database immich-database immich-redis >/dev/null

  docker run --rm \
    -v "${PROJECT}_immich-library:/source:ro" \
    -v "$backup_staging:/backup" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce tar -czf /backup/immich-library.tgz -C /source .
  docker run --rm \
    -v "${PROJECT}_cimmich-documents:/source:ro" \
    -v "$backup_staging:/backup" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce tar -czf /backup/cimmich-documents.tgz -C /source .
  docker run --rm \
    -v "${PROJECT}_cimmich-face-models:/source:ro" \
    -v "$backup_staging:/backup" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce tar -czf /backup/cimmich-face-models.tgz -C /source .
  operator_state_members=".cimmich-public-demo operator.env private-password guided-token immich-map.json immich-credential.json seed-receipt.json display-bridge.json"
  if test -s "$STATE_ROOT/immich-guided-credential.json"; then
    operator_state_members="$operator_state_members immich-guided-credential.json"
  fi
  # Every expanded member is a fixed operator-owned basename selected above.
  tar -czf "$backup_staging/operator-state.tgz" -C "$STATE_ROOT" $operator_state_members
  validate_tar_members "$backup_staging/immich-library.tgz"
  validate_tar_members "$backup_staging/cimmich-documents.tgz"
  validate_tar_members "$backup_staging/operator-state.tgz"

  compose up -d
  wait_http Immich "http://127.0.0.1:$IMMICH_PORT/api/server/version" 180
  wait_http Cimmich "http://127.0.0.1:$API_PORT/health" 120
  wait_http UI "http://127.0.0.1:$UI_PORT/" 120
  validate_current_runtime
  backup_counts_after=$(semantic_counts 2>/dev/null) || fail "unable to re-read demo semantic counts"
  validate_semantic_counts "$backup_counts_after"
  test "$backup_counts_after" = "$backup_counts_before" || fail "demo semantic counts changed during backup"
  printf 'project=%s\nschema_version=%s\nsemantic_counts_before=%s\nsemantic_counts_after=%s\n' \
    "$PROJECT" "$CURRENT_SCHEMA_VERSION" "$backup_counts_before" "$backup_counts_after" > "$backup_staging/manifest.txt"
  (cd "$backup_staging" && sha256sum cimmich.dump immich.dump immich-library.tgz cimmich-documents.tgz cimmich-face-models.tgz operator-state.tgz manifest.txt > SHA256SUMS)
  chmod 600 "$backup_staging"/*
  mv "$backup_staging" "$backup_path"
  backup_complete=1
  trap - EXIT INT TERM
  printf '{"backup":"%s","backupSchemaVersion":%s,"currentSchemaVersion":%s,"project":"%s","semanticCounts":"%s","status":"READY"}\n' \
    "$backup_path" "$CURRENT_SCHEMA_VERSION" "$CURRENT_SCHEMA_VERSION" "$PROJECT" "$backup_counts_after"
}

validate_backup() {
  backup_path=$1
  validate_backup_path "$backup_path"
  test -d "$backup_path" || fail "backup directory does not exist"
  for filename in cimmich.dump immich.dump immich-library.tgz cimmich-documents.tgz cimmich-face-models.tgz operator-state.tgz manifest.txt SHA256SUMS; do
    test -s "$backup_path/$filename" || fail "backup is incomplete: $filename"
  done
  test "$(wc -l < "$backup_path/manifest.txt" | tr -d ' ')" = 4 || fail "backup manifest is invalid"
  grep -qx "project=$PROJECT" "$backup_path/manifest.txt" || fail "backup project mismatch"
  test "$(grep -c '^schema_version=' "$backup_path/manifest.txt")" = 1 || fail "backup schema manifest is invalid"
  BACKUP_SCHEMA_VERSION=$(sed -n 's/^schema_version=//p' "$backup_path/manifest.txt")
  case "$BACKUP_SCHEMA_VERSION" in
    ''|*[!0-9]*) fail "backup schema version is invalid" ;;
  esac
  test "$BACKUP_SCHEMA_VERSION" -gt 0 || fail "backup schema version is invalid"
  test "$BACKUP_SCHEMA_VERSION" -le "$CURRENT_SCHEMA_VERSION" || fail "backup schema is newer than this Cimmich build"
  test "$(grep -c '^semantic_counts_before=' "$backup_path/manifest.txt")" = 1 || fail "backup pre-count manifest is invalid"
  test "$(grep -c '^semantic_counts_after=' "$backup_path/manifest.txt")" = 1 || fail "backup post-count manifest is invalid"
  BACKUP_SEMANTIC_COUNTS=$(sed -n 's/^semantic_counts_before=//p' "$backup_path/manifest.txt")
  backup_counts_after=$(sed -n 's/^semantic_counts_after=//p' "$backup_path/manifest.txt")
  validate_semantic_counts "$BACKUP_SEMANTIC_COUNTS"
  validate_semantic_counts "$backup_counts_after"
  test "$BACKUP_SEMANTIC_COUNTS" = "$backup_counts_after" || fail "backup semantic counts changed during capture"
  checksum_names=$(awk 'NF == 2 && $1 ~ /^[0-9a-f]{64}$/ && $2 !~ /\// { print $2 }' "$backup_path/SHA256SUMS" | sort | tr '\n' ':')
  test "$checksum_names" = "cimmich-documents.tgz:cimmich-face-models.tgz:cimmich.dump:immich-library.tgz:immich.dump:manifest.txt:operator-state.tgz:" ||
    fail "backup checksum manifest is invalid"
  test "$(wc -l < "$backup_path/SHA256SUMS" | tr -d ' ')" = 7 || fail "backup checksum manifest is invalid"
  (cd "$backup_path" && sha256sum -c SHA256SUMS >/dev/null) || fail "backup checksum verification failed"
  validate_tar_members "$backup_path/immich-library.tgz"
  validate_tar_members "$backup_path/cimmich-documents.tgz"
  validate_tar_members "$backup_path/cimmich-face-models.tgz"
  validate_tar_members "$backup_path/operator-state.tgz"
  backup_members=$(tar -tzf "$backup_path/operator-state.tgz" | sort | tr '\n' ':')
  case "$backup_members" in
    ".cimmich-public-demo:display-bridge.json:guided-token:immich-credential.json:immich-guided-credential.json:immich-map.json:operator.env:private-password:seed-receipt.json:"|\
    ".cimmich-public-demo:display-bridge.json:immich-credential.json:immich-guided-credential.json:immich-map.json:operator.env:private-password:seed-receipt.json:"|\
    ".cimmich-public-demo:display-bridge.json:guided-token:immich-credential.json:immich-map.json:operator.env:private-password:seed-receipt.json:"|\
    ".cimmich-public-demo:display-bridge.json:immich-credential.json:immich-map.json:operator.env:private-password:seed-receipt.json:") ;;
    *) fail "operator-state backup members are invalid" ;;
  esac
  validate_operator_state_archive "$backup_path"
  preflight_backup_databases "$backup_path"
}

restore() {
  validate_prerequisites
  backup_path=$ARGUMENT
  test -n "$backup_path" || fail "restore requires an absolute $PROJECT-backup directory"
  test "$CONFIRM" = "--confirm=$PROJECT" ||
    fail "restore requires --confirm=$PROJECT"
  validate_backup "$backup_path"

  if test -f "$SENTINEL"; then
    destroy_exact
  else
    test -z "$(exact_container_ids)" || fail "exact project resources exist without a sentinel"
  fi

  umask 077
  mkdir -p "$STATE_ROOT"
  tar -xzf "$backup_path/operator-state.tgz" -C "$STATE_ROOT"
  ensure_guided_token
  verify_sentinel
  load_environment
  compose up -d --wait immich-database cimmich-database
  compose stop immich-database cimmich-database >/dev/null
  docker volume create \
    --label "com.docker.compose.project=$PROJECT" \
    --label com.docker.compose.volume=immich-library \
    "${PROJECT}_immich-library" >/dev/null
  docker volume create \
    --label "com.docker.compose.project=$PROJECT" \
    --label com.docker.compose.volume=cimmich-documents \
    "${PROJECT}_cimmich-documents" >/dev/null
  docker volume create \
    --label "com.docker.compose.project=$PROJECT" \
    --label com.docker.compose.volume=cimmich-face-models \
    "${PROJECT}_cimmich-face-models" >/dev/null
  docker run --rm \
    -v "${PROJECT}_immich-library:/target" \
    -v "$backup_path:/backup:ro" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce tar -xzf /backup/immich-library.tgz -C /target
  docker run --rm \
    -v "${PROJECT}_cimmich-documents:/target" \
    -v "$backup_path:/backup:ro" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce tar -xzf /backup/cimmich-documents.tgz -C /target
  docker run --rm \
    -v "${PROJECT}_cimmich-face-models:/target" \
    -v "$backup_path:/backup:ro" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce tar -xzf /backup/cimmich-face-models.tgz -C /target
  compose start immich-database cimmich-database >/dev/null
  i=0
  until compose exec -T immich-database pg_isready -U immich -d immich >/dev/null 2>&1 &&
    compose exec -T cimmich-database pg_isready -U cimmich -d cimmich >/dev/null 2>&1; do
    i=$((i + 1))
    test "$i" -lt 60 || fail "restored database readiness timeout"
    sleep 1
  done
  compose exec -T immich-database dropdb -U immich --if-exists immich
  compose exec -T immich-database createdb -U immich immich
  compose exec -T cimmich-database dropdb -U cimmich --if-exists cimmich
  compose exec -T cimmich-database createdb -U cimmich cimmich
  compose exec -T immich-database pg_restore -U immich -d immich --no-owner --no-privileges < "$backup_path/immich.dump"
  compose exec -T cimmich-database pg_restore -U cimmich -d cimmich --no-owner --no-privileges < "$backup_path/cimmich.dump"
  compose build cimmich-api public-demo-ui
  compose run --rm --no-deps cimmich-bootstrap node bin/migrate.mjs apply >/dev/null
  compose up -d
  wait_http Immich "http://127.0.0.1:$IMMICH_PORT/api/server/version" 180
  wait_http Cimmich "http://127.0.0.1:$API_PORT/health" 120
  wait_http UI "http://127.0.0.1:$UI_PORT/" 120
  validate_current_runtime
  restored_counts=$(semantic_counts 2>/dev/null) || fail "unable to read restored semantic counts"
  validate_semantic_counts "$restored_counts"
  test "$restored_counts" = "$BACKUP_SEMANTIC_COUNTS" || fail "restored semantic counts do not match the backup"
  printf '{"backup":"%s","backupSchemaVersion":%s,"project":"%s","restoredSchemaVersion":%s,"semanticCounts":"%s","status":"RESTORED"}\n' \
    "$backup_path" "$BACKUP_SCHEMA_VERSION" "$PROJECT" "$CURRENT_SCHEMA_VERSION" "$restored_counts"
}

status() {
  validate_prerequisites
  if test ! -f "$SENTINEL"; then
    printf '{"project":"%s","state":"absent"}\n' "$PROJECT"
    return 3
  fi
  verify_sentinel
  load_environment
  immich_version=$(curl -fsS "http://127.0.0.1:$IMMICH_PORT/api/server/version" 2>/dev/null || true)
  cimmich_health=$(curl -fsS "http://127.0.0.1:$API_PORT/health" 2>/dev/null || true)
  ui_status=down
  curl -fsS "http://127.0.0.1:$UI_PORT/" >/dev/null 2>&1 && ui_status=ready
  counts=$(semantic_counts 2>/dev/null || printf unavailable)
  case "$immich_version" in
    *'"major":3'*'"minor":0'*'"patch":3'*) immich_status=ready ;;
    *) immich_status=down ;;
  esac
  cimmich_status=down
  case "$cimmich_health" in
    *'"status":"ok"'*)
      case "$cimmich_health" in
        *'"schemaVersion":'"$CURRENT_SCHEMA_VERSION"*) cimmich_status=ready ;;
      esac
      ;;
  esac
  printf '{"cimmich":"%s","counts":"%s","credentials":"%s","immich":"%s","project":"%s","state":"configured","ui":"%s","urls":{"api":"http://127.0.0.1:%s","immich":"http://127.0.0.1:%s","product":"http://127.0.0.1:%s"}}\n' \
    "$cimmich_status" "$counts" "$OPERATOR_ENV" "$immich_status" "$PROJECT" "$ui_status" \
    "$API_PORT" "$IMMICH_PORT" "$UI_PORT"
  test "$cimmich_status" = ready && test "$immich_status" = ready && test "$ui_status" = ready
}

private_password_file() {
  validate_prerequisites
  verify_sentinel
  load_environment
  test -s "$PRIVATE_PASSWORD_FILE" || fail "Private view-lock state is incomplete; run reset with exact confirmation"
  # Deliberately return only the local mode-0600 file location. The secret is
  # never copied into argv, environment, Compose configuration or command output.
  printf '%s\n' "$PRIVATE_PASSWORD_FILE"
}

guided_token_file() {
  validate_prerequisites
  verify_sentinel
  load_environment
  ensure_guided_token
  # Return only the mode-0600 local file path. A client reads the token locally
  # and chooses what it may disclose; Cimmich never echoes it through HTTP/UI.
  printf '%s\n' "$GUIDED_TOKEN_FILE"
}

refresh_immich_companion() {
  validate_prerequisites
  verify_sentinel
  load_environment
  test -s "$STATE_ROOT/immich-credential.json" || fail "public demo Immich credential is missing"
  compose build cimmich-api >/dev/null
  compose --profile bootstrap run --rm --no-deps \
    --env-from-file "$OPERATOR_ENV" \
    -e IMMICH_API_URL=http://immich-server:2283/api \
    -e CIMMICH_DEMO_IMMICH_CREDENTIAL_PATH=/demo-state/immich-credential.json \
    -v "$STATE_ROOT:/demo-state" \
    cimmich-bootstrap node bin/refresh-public-demo-immich-companion.mjs
  chmod 600 "$STATE_ROOT/immich-credential.json"
  compose up -d --no-deps --force-recreate cimmich-api
  wait_http Cimmich "http://127.0.0.1:$API_PORT/health" 120
  curl -fsS \
    -H 'x-cimmich-device-id: public-demo-operator' \
    -H 'x-cimmich-surface: interactive' \
    "http://127.0.0.1:$API_PORT/v1/onboarding/immich"
  printf '\n'
}

install_face_provider() {
  validate_prerequisites
  verify_sentinel
  load_environment
  compose build cimmich-api >/dev/null
  compose --profile face-provider run --rm cimmich-face-provider-init
  if ! grep -q '^CIMMICH_PUBLIC_DEMO_FACE_PROVIDER=' "$OPERATOR_ENV"; then
    printf "CIMMICH_PUBLIC_DEMO_FACE_PROVIDER='opencv-yunet-sface-cpu'\n" >> "$OPERATOR_ENV"
  fi
  chmod 600 "$OPERATOR_ENV"
  CIMMICH_PUBLIC_DEMO_FACE_PROVIDER=opencv-yunet-sface-cpu
  export CIMMICH_PUBLIC_DEMO_FACE_PROVIDER
  compose up -d --no-deps --force-recreate cimmich-api
  wait_http Cimmich "http://127.0.0.1:$API_PORT/health" 120
  curl -fsS "http://127.0.0.1:$API_PORT/v1/integrations/status"
  printf '\n'
}

rotate_private_password() {
  validate_prerequisites
  verify_sentinel
  load_environment
  test -s "$PRIVATE_PASSWORD_FILE" || fail "Private view-lock state is incomplete; run reset with exact confirmation"
  umask 077
  next_password_file="$STATE_ROOT/.private-password.next"
  test ! -e "$next_password_file" || fail "Private view-lock rotation state already exists"
  {
    random_hex
    printf '\n'
  } > "$next_password_file"
  chmod 600 "$next_password_file"
  trap 'rm -f "$next_password_file"' EXIT INT TERM
  compose run --rm --no-deps \
    cimmich-bootstrap node bin/visibility-credential.mjs rotate --password-stdin \
    < "$next_password_file" >/dev/null
  mv "$next_password_file" "$PRIVATE_PASSWORD_FILE"
  chmod 600 "$PRIVATE_PASSWORD_FILE"
  trap - EXIT INT TERM
  printf '{"privatePasswordFile":"%s","status":"ROTATED"}\n' "$PRIVATE_PASSWORD_FILE"
}

configure_map() {
  validate_prerequisites
  verify_sentinel
  load_environment
  test -s "$STATE_ROOT/immich-map.json" || fail "public demo Immich map is missing"
  compose run --rm --no-deps \
    --env-from-file "$OPERATOR_ENV" \
    -e IMMICH_API_URL=http://immich-server:2283/api \
    -e CIMMICH_DEMO_IMMICH_MAP_PATH=/demo-state/immich-map.json \
    -v "$STATE_ROOT:/demo-state" \
    cimmich-bootstrap node bin/configure-public-demo-map.mjs
}

up() {
  validate_prerequisites
  if test -f "$SENTINEL"; then
    verify_sentinel
    load_environment
    ensure_guided_token
    test -s "$STATE_ROOT/seed-receipt.json" && test -s "$STATE_ROOT/display-bridge.json" && test -s "$STATE_ROOT/immich-credential.json" && test -s "$PRIVATE_PASSWORD_FILE" && test -s "$GUIDED_TOKEN_FILE" ||
      fail "partial demo state found; recover with: tools/public_demo.sh reset --confirm=$PROJECT"
    compose up -d
    wait_http Cimmich "http://127.0.0.1:$API_PORT/health" 120
    wait_http UI "http://127.0.0.1:$UI_PORT/" 120
    status
    return 0
  fi
  validate_archive
  test -z "$(exact_container_ids)" || fail "exact project resources already exist without a sentinel"
  check_port_free "$IMMICH_PORT"
  check_port_free "$API_PORT"
  check_port_free "$UI_PORT"
  write_operator_state
  write_bootstrap_environment
  # A fresh Compose project has no project-scoped API image yet. Build it
  # before the first one-shot bootstrap container so Compose never attempts to
  # pull the local current-source tag from a registry.
  compose build cimmich-api
  compose up -d --wait immich-database immich-redis immich-machine-learning immich-server cimmich-database
  wait_http Immich "http://127.0.0.1:$IMMICH_PORT/api/server/version" 180
  version=$(curl -fsS "http://127.0.0.1:$IMMICH_PORT/api/server/version")
  case "$version" in
    *'"major":3'*'"minor":0'*'"patch":3'*) ;;
    *) fail "Immich runtime is not exact supported version 3.0.3" ;;
  esac
  compose run --rm --no-deps \
    -v "$STATE_ROOT:/demo-state" \
    cimmich-bootstrap node bin/migrate.mjs apply >/dev/null
  compose run --rm --no-deps \
    cimmich-bootstrap node bin/visibility-credential.mjs configure --password-stdin \
    < "$PRIVATE_PASSWORD_FILE" >/dev/null
  compose run --rm --no-deps \
    --env-from-file "$BOOTSTRAP_ENV" \
    -e IMMICH_API_URL=http://immich-server:2283/api \
    -e CIMMICH_DEMO_ARCHIVE_ROOT=/demo-archive \
    -e CIMMICH_DEMO_IMMICH_MAP_PATH=/demo-state/immich-map.json \
    -e CIMMICH_DEMO_IMMICH_CREDENTIAL_PATH=/demo-state/immich-credential.json \
    -v "$STATE_ROOT:/demo-state" \
    -v "$ARCHIVE_ROOT:/demo-archive:ro" \
    cimmich-bootstrap node bin/bootstrap-public-demo-immich.mjs >/dev/null
  rm -f "$BOOTSTRAP_ENV"
  compose run --rm --no-deps \
    -e CIMMICH_DEMO_ARCHIVE_ROOT=/demo-archive \
    -e CIMMICH_DEMO_IMMICH_MAP_PATH=/demo-state/immich-map.json \
    -e CIMMICH_DEMO_SEED_RECEIPT_PATH=/demo-state/seed-receipt.json \
    -e CIMMICH_DEMO_DISPLAY_BRIDGE_PATH=/demo-state/display-bridge.json \
    -v "$STATE_ROOT:/demo-state" \
    -v "$ARCHIVE_ROOT:/demo-archive:ro" \
    cimmich-bootstrap node bin/bootstrap-public-demo.mjs >/dev/null
  chmod 600 "$STATE_ROOT/immich-map.json" "$STATE_ROOT/immich-credential.json"
  chmod 644 "$STATE_ROOT/seed-receipt.json" "$STATE_ROOT/display-bridge.json"
  compose up -d --build cimmich-api public-demo-ui
  wait_http Cimmich "http://127.0.0.1:$API_PORT/health" 120
  wait_http UI "http://127.0.0.1:$UI_PORT/" 120
  test "$(semantic_counts)" = "51:9:12:5:4:0" || fail "seeded semantic counts are invalid"
  status
}

destroy_exact() {
  if test -f "$SENTINEL"; then
    verify_sentinel
  fi
  load_removal_environment
  compose down --volumes --remove-orphans
  docker image rm "$PROJECT-api:current-source" "$PROJECT-ui:current-source" >/dev/null 2>&1 || true
  project_volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")
  if test -n "$project_volumes"; then
    # Every ID is selected by the exact Compose project label after confirmation.
    docker volume rm $project_volumes >/dev/null
  fi
  project_networks=$(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT")
  if test -n "$project_networks"; then
    # This also removes an obsolete exact-project network from an older compose shape.
    docker network rm $project_networks >/dev/null
  fi
  test -z "$(exact_container_ids)" || fail "exact project containers remain"
  test -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")" ||
    fail "exact project volumes remain"
  test -z "$(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT")" ||
    fail "exact project networks remain"
  if test -d "$STATE_ROOT"; then
    rm -f "$STATE_ROOT/immich-map.json" "$STATE_ROOT/immich-credential.json" \
      "$STATE_ROOT/immich-guided-credential.json" \
      "$STATE_ROOT/seed-receipt.json" "$STATE_ROOT/display-bridge.json" \
      "$BOOTSTRAP_ENV" "$OPERATOR_ENV" "$PRIVATE_PASSWORD_FILE" "$GUIDED_TOKEN_FILE" "$SENTINEL"
    if test -n "$(find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -print -quit)"; then
      fail "state root contains unrecognized files; refusing to remove it"
    fi
    if test "${PRESERVE_STATE_ROOT:-0}" = 1; then
      chmod 700 "$STATE_ROOT"
    else
      rmdir "$STATE_ROOT" 2>/dev/null || fail "unable to remove exact state root"
    fi
  fi
}

stop_exact() {
  verify_sentinel
  load_environment
  compose stop
  printf '{"project":"%s","state":"stopped","dataPreserved":true}\n' "$PROJECT"
}

down_exact() {
  verify_sentinel
  load_environment
  compose down --remove-orphans
  printf '{"project":"%s","state":"down","dataPreserved":true}\n' "$PROJECT"
}

destroy() {
  validate_prerequisites
  test "$ARGUMENT" = "--confirm=$PROJECT" ||
    fail "destructive command requires --confirm=$PROJECT"
  if test ! -f "$SENTINEL"; then
    test -d "$STATE_ROOT" || test -n "$(exact_container_ids)" ||
      fail "resolved demo target is absent"
  fi
  destroy_exact
}

case "$COMMAND" in
  status) test "$ARGUMENT_COUNT" -eq 0 || test "$ARGUMENT_COUNT" -eq 1 || fail "status does not accept an argument" ;;
  up|private-password-file|guided-token-file|refresh-immich-companion|install-face-provider|rotate-private-password|configure-map|stop|restart|down)
    test "$ARGUMENT_COUNT" -eq 1 || fail "$COMMAND does not accept an argument" ;;
  backup) test "$ARGUMENT_COUNT" -eq 2 || fail "backup requires exactly one path" ;;
  restore) test "$ARGUMENT_COUNT" -eq 3 || fail "restore requires exactly one path and exact confirmation" ;;
  reset|destroy) test "$ARGUMENT_COUNT" -eq 2 || fail "$COMMAND requires exact confirmation" ;;
  *) ;;
esac

case "$COMMAND" in
  up) up ;;
  status) status ;;
  private-password-file) private_password_file ;;
  guided-token-file) guided_token_file ;;
  refresh-immich-companion) refresh_immich_companion ;;
  install-face-provider) install_face_provider ;;
  rotate-private-password) rotate_private_password ;;
  configure-map) configure_map ;;
  backup) backup ;;
  restore) restore ;;
  reset)
    # Preserve the exact verified-empty directory inode across a same-process
    # reset so Docker Desktop cannot retain a bind mount to a removed inode.
    PRESERVE_STATE_ROOT=1
    destroy
    ARGUMENT=
    up
    ;;
  stop)
    test -z "$ARGUMENT" || fail "stop does not accept an argument"
    stop_exact
    ;;
  restart)
    # A dependency-ordered stop/start is deliberate: `compose restart` starts
    # the API concurrently with PostgreSQL and can strand it before readiness.
    stop_exact >/dev/null
    up
    ;;
  down)
    down_exact
    ;;
  destroy)
    destroy
    printf '{"project":"%s","state":"absent"}\n' "$PROJECT"
    ;;
  *) fail "usage: tools/public_demo.sh up|stop|restart|down|status|private-password-file|guided-token-file|refresh-immich-companion|install-face-provider|rotate-private-password|configure-map|backup ABS_PATH|restore ABS_PATH --confirm=$PROJECT|reset --confirm=$PROJECT|destroy --confirm=$PROJECT" ;;
esac
