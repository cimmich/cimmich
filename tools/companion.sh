#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE="$ROOT/tools/companion.compose.yml"
PROJECT=${CIMMICH_COMPANION_PROJECT:-cimmich-companion}
STATE_ROOT=${CIMMICH_COMPANION_STATE_ROOT:-}
ENV_FILE="${STATE_ROOT:+$STATE_ROOT/runtime.env}"
DATABASE_VOLUME="${PROJECT}-database"
DOCUMENT_VOLUME="${PROJECT}-documents"
CONFIG_VOLUME="${PROJECT}-config"
ZERO_DIGEST=0000000000000000000000000000000000000000000000000000000000000000
CURRENT_SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
ALPINE_IMAGE=alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce
PGVECTOR_IMAGE=pgvector/pgvector:0.8.2-pg17-trixie@sha256:5c97c57367a485a8e99389548db67d441ab1a878f5492c3df04989f34ecf3c75
NODE_IMAGE=node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

fail() {
  printf 'cimmich companion: %s\n' "$*" >&2
  exit 1
}

validate_project() {
  case "$PROJECT" in
    ''|*[!a-z0-9_-]*|[!a-z0-9]*) fail "project must be a lowercase Docker identifier" ;;
  esac
}

validate_state_root() {
  test -n "$STATE_ROOT" || fail "set CIMMICH_COMPANION_STATE_ROOT to a dedicated absolute directory"
  case "$STATE_ROOT" in
    /*) ;;
    *) fail "CIMMICH_COMPANION_STATE_ROOT must be absolute" ;;
  esac
  test "$STATE_ROOT" != / || fail "state root is unsafe"
  test "$STATE_ROOT" != "$HOME" || fail "state root is unsafe"
  test "$STATE_ROOT" != "$ROOT" || fail "state root is unsafe"
}

validate_origin() {
  value=$1
  case "$value" in
    http://*|https://*) ;;
    *) fail "Immich origins must use http:// or https://" ;;
  esac
  authority=${value#*://}
  test -n "$authority" || fail "Immich origin requires a host"
  case "$authority" in
    *[[:space:]]*|*@*|*/*|*\#*|*\?*) fail "use an exact credential-free Immich origin without path, query or fragment" ;;
    *[!A-Za-z0-9._:-]*) fail "Immich origin contains unsupported authority characters" ;;
  esac
}

validate_port() {
  value=$1
  label=$2
  case "$value" in
    ''|*[!0-9]*) fail "$label must be a numeric TCP port" ;;
  esac
  test "$value" -ge 1 && test "$value" -le 65535 ||
    fail "$label must be from 1 to 65535"
}

configured_value() {
  key=$1
  count=$(grep -c "^${key}=" "$ENV_FILE" || true)
  test "$count" -eq 1 || fail "runtime configuration has an invalid $key entry"
  sed -n "s/^${key}=//p" "$ENV_FILE"
}

require_configured() {
  validate_state_root
  test -f "$ENV_FILE" || fail "run configure first"
}

compose() {
  docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" --file "$COMPOSE_FILE" "$@"
}

configure() {
  validate_state_root
  test "$#" -ge 1 && test "$#" -le 2 || fail "usage: companion.sh configure IMMICH_ORIGIN [API_KEY_FILE]"
  origin=$1
  key_file=${2:-}
  validate_origin "$origin"
  api_port=${CIMMICH_COMPANION_API_PORT:-3411}
  ui_port=${CIMMICH_COMPANION_UI_PORT:-3413}
  private_lock_mode=${CIMMICH_COMPANION_PRIVATE_LOCK_MODE:-none}
  validate_port "$api_port" "Cimmich API port"
  validate_port "$ui_port" "Cimmich UI port"
  case "$private_lock_mode" in
    none|password) ;;
    *) fail "private lock mode must be none or password" ;;
  esac
  api_key=
  if test -n "$key_file"; then
    test -f "$key_file" || fail "API key file does not exist"
    api_key=$(tr -d '\r\n' < "$key_file")
    test -n "$api_key" || fail "API key file is empty"
    case "$api_key" in *[!A-Za-z0-9_-]*) fail "API key file contains unsupported characters" ;; esac
  fi
  test ! -e "$ENV_FILE" || fail "runtime configuration already exists"
  if test -e "$STATE_ROOT"; then
    test -d "$STATE_ROOT" || fail "state root is not a directory"
    test -z "$(find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -print)" ||
      fail "state root must be empty before configuration"
  else
    mkdir -p "$STATE_ROOT"
  fi
  chmod 700 "$STATE_ROOT"
  database_password=$(openssl rand -hex 32)
  umask 077
  {
    printf 'CIMMICH_COMPANION_PROJECT=%s\n' "$PROJECT"
    printf 'CIMMICH_COMPANION_API_PORT=%s\n' "$api_port"
    printf 'CIMMICH_COMPANION_UI_PORT=%s\n' "$ui_port"
    printf 'CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE=%s\n' "$private_lock_mode"
    printf 'CIMMICH_DB_PASSWORD=%s\n' "$database_password"
    printf 'CIMMICH_IMMICH_API_KEY=%s\n' "$api_key"
    printf 'CIMMICH_IMMICH_API_URL=%s/api\n' "$origin"
    printf 'CIMMICH_IMMICH_WEB_ORIGIN=%s\n' "$origin"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  printf '{"project":"%s","state":"configured"}\n' "$PROJECT"
}

private_password() {
  require_configured
  action=${1:-}
  case "$action" in
    status)
      test "$#" -eq 1 || fail "usage: companion.sh private-password status"
      compose exec -T cimmich-api npm run visibility-credential -- status
      ;;
    configure|rotate)
      test "$#" -eq 1 || fail "usage: companion.sh private-password $action"
      test "$(configured_value CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE)" = password ||
        fail "Private password requires CIMMICH_COMPANION_PRIVATE_LOCK_MODE=password during configure"
      test ! -t 0 || fail "pipe the Private password through standard input; do not pass it as an argument"
      compose exec -T cimmich-api npm run visibility-credential -- "$action" --password-stdin
      ;;
    remove)
      test "$#" -eq 2 && test "$2" = --confirm-remove ||
        fail "usage: companion.sh private-password remove --confirm-remove"
      compose exec -T cimmich-api npm run visibility-credential -- remove --confirm-remove
      ;;
    *) fail "usage: companion.sh private-password status|configure|rotate|remove" ;;
  esac
}

up() {
  require_configured
  # Build the two local product images serially. Concurrent Buildx work can
  # exhaust smaller container runtimes and makes it impossible to identify
  # which immutable product image failed.
  compose build cimmich-api
  # `docker compose build` builds only the named service unless
  # `--with-dependencies` is requested. Do not pass the `compose up`-only
  # `--no-deps` flag here: current stock Compose rejects it.
  compose build cimmich-ui
  compose up --detach --no-build --wait
  status
}

status() {
  require_configured
  api_port=$(configured_value CIMMICH_COMPANION_API_PORT)
  ui_port=$(configured_value CIMMICH_COMPANION_UI_PORT)
  validate_port "$api_port" "Configured Cimmich API port"
  validate_port "$ui_port" "Configured Cimmich UI port"
  health=$(curl --fail --silent --show-error "http://127.0.0.1:${api_port}/health")
  companion=$(curl --fail --silent --show-error "http://127.0.0.1:${api_port}/v1/companion/status")
  printf '{"companion":%s,"health":%s,"project":"%s","ui":"http://127.0.0.1:%s"}\n' \
    "$companion" "$health" "$PROJECT" "$ui_port"
}

sync_inventory() {
  require_configured
  max_pages=${1:-}
  case "$max_pages" in
    ''|*[!0-9]*) test -z "$max_pages" || fail "max pages must be a positive integer" ;;
    0) fail "max pages must be a positive integer" ;;
  esac
  args="--action=sync --source-id=immich-primary --operation=detect_and_recognize --tool-version=inventory-only-v1 --config-digest=$ZERO_DIGEST"
  if test -n "$max_pages"; then
    args="$args --max-pages=$max_pages"
  fi
  # Arguments are generated above from validated integers and fixed public IDs.
  # shellcheck disable=SC2086
  compose exec -T cimmich-api node bin/sync-immich-inventory.mjs $args
}

validate_backup_path() {
  backup_path=$1
  case "$backup_path" in /*) ;; *) fail "backup path must be absolute" ;; esac
  test "$backup_path" != / || fail "backup path is unsafe"
  test "$backup_path" != "$HOME" || fail "backup path is unsafe"
  test "$backup_path" != "$ROOT" || fail "backup path is unsafe"
  test "$backup_path" != "$STATE_ROOT" || fail "backup must be outside companion state"
  case "$backup_path" in "$STATE_ROOT"/*) fail "backup must be outside companion state" ;; esac
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
  ' >/dev/null 2>&1 || fail "backup semantic counts are unavailable or malformed"
}

validate_tar_archive() {
  backup_path=$1
  archive_name=$2
  members=$(docker run --rm -v "$backup_path:/backup:ro" "$ALPINE_IMAGE" \
    tar -tzf "/backup/$archive_name") || fail "backup archive is unreadable: $archive_name"
  if printf '%s\n' "$members" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    fail "backup archive contains unsafe traversal members: $archive_name"
  fi
  docker run --rm -v "$backup_path:/backup:ro" "$ALPINE_IMAGE" \
    tar -tvzf "/backup/$archive_name" | awk '
      {
        kind = substr($1, 1, 1)
        if (kind != "-" && kind != "d") exit 1
      }
    ' >/dev/null || fail "backup archive contains links or special files: $archive_name"
}

validate_config_archive() {
  backup_path=$1
  config_members=$(docker run --rm -v "$backup_path:/backup:ro" "$ALPINE_IMAGE" \
    tar -tzf /backup/config.tgz | sed 's#^\./##' | sort | tr '\n' ':')
  test "$config_members" = ":runtime.env:" || fail "backup config archive members are invalid"
  config_bytes=$(docker run --rm -v "$backup_path:/backup:ro" "$ALPINE_IMAGE" \
    tar -xOzf /backup/config.tgz ./runtime.env) || fail "backup runtime configuration is unreadable"
  printf '%s\n' "$config_bytes" | grep -qx "CIMMICH_COMPANION_PROJECT=$PROJECT" ||
    fail "backup runtime configuration project mismatch"
  test "$(printf '%s\n' "$config_bytes" | grep -c '^CIMMICH_COMPANION_PROJECT=')" -eq 1 ||
    fail "backup runtime configuration is malformed"
  test "$(printf '%s\n' "$config_bytes" | grep -c '^CIMMICH_DB_PASSWORD=[0-9a-f]\{64\}$')" -eq 1 ||
    fail "backup runtime database credential is malformed"
}

preflight_backup_database() {
  backup_path=$1
  preflight_id="cimmich-companion-restore-preflight-$$"
  preflight_network="$preflight_id-network"
  preflight_database="$preflight_id-database"
  preflight_password=$(openssl rand -hex 32)
  preflight_cleanup() {
    docker rm -f "$preflight_database" >/dev/null 2>&1 || true
    docker network rm "$preflight_network" >/dev/null 2>&1 || true
  }
  trap preflight_cleanup EXIT INT TERM
  docker image inspect "$PROJECT-api:current-source" >/dev/null 2>&1 ||
    fail "current Cimmich API image is unavailable for restore preflight"
  docker network create "$preflight_network" >/dev/null
  docker run -d --name "$preflight_database" --network "$preflight_network" \
    -e POSTGRES_DB=cimmich -e POSTGRES_USER=cimmich -e POSTGRES_PASSWORD="$preflight_password" \
    "$PGVECTOR_IMAGE" >/dev/null
  i=0
  until docker exec "$preflight_database" pg_isready -U cimmich -d cimmich >/dev/null 2>&1; do
    i=$((i + 1))
    test "$i" -lt 60 || fail "backup restore preflight database readiness timeout"
    sleep 1
  done
  docker exec -i "$preflight_database" pg_restore -U cimmich -d cimmich --no-owner --no-privileges \
    < "$backup_path/cimmich.dump" || fail "backup database restore preflight failed"
  restored_schema=$(docker exec "$preflight_database" psql -U cimmich -d cimmich -Atc \
    'SELECT COALESCE(max(version), 0) FROM cimmich_schema_migration;') ||
    fail "backup migration ledger is unreadable"
  test "$restored_schema" = "$BACKUP_SCHEMA_VERSION" ||
    fail "backup schema manifest does not match its database ledger"
  restored_counts=$(docker exec "$preflight_database" psql -U cimmich -d cimmich -Atc \
    "SELECT (SELECT count(*) FROM asset WHERE state='active') || ':' || (SELECT count(*) FROM person WHERE status='active') || ':' || (SELECT count(*) FROM context_entity WHERE status='active') || ':' || (SELECT count(*) FROM cimmich_document WHERE status='active') || ':' || (SELECT count(*) FROM manual_subject_tag_operation WHERE state='active') || ':' || (SELECT count(*) FROM source_pack WHERE state='active');") ||
    fail "backup semantic counts are unreadable"
  validate_semantic_counts "$restored_counts"
  test "$restored_counts" = "$BACKUP_SEMANTIC_COUNTS" ||
    fail "backup database semantic counts do not match its manifest"
  docker run --rm --network "$preflight_network" \
    -e DATABASE_URL="postgres://cimmich:$preflight_password@$preflight_database:5432/cimmich" \
    "$PROJECT-api:current-source" node bin/migrate.mjs apply >/dev/null ||
    fail "backup cannot migrate to the current Cimmich schema"
  migrated_schema=$(docker exec "$preflight_database" psql -U cimmich -d cimmich -Atc \
    'SELECT COALESCE(max(version), 0) FROM cimmich_schema_migration;') ||
    fail "migrated backup ledger is unreadable"
  test "$migrated_schema" = "$CURRENT_SCHEMA_VERSION" ||
    fail "backup did not migrate to the current Cimmich schema"
  migrated_counts=$(docker exec "$preflight_database" psql -U cimmich -d cimmich -Atc \
    "SELECT (SELECT count(*) FROM asset WHERE state='active') || ':' || (SELECT count(*) FROM person WHERE status='active') || ':' || (SELECT count(*) FROM context_entity WHERE status='active') || ':' || (SELECT count(*) FROM cimmich_document WHERE status='active') || ':' || (SELECT count(*) FROM manual_subject_tag_operation WHERE state='active') || ':' || (SELECT count(*) FROM source_pack WHERE state='active');") ||
    fail "migrated backup semantic counts are unreadable"
  test "$migrated_counts" = "$BACKUP_SEMANTIC_COUNTS" ||
    fail "backup migration changed semantic counts"
  trap - EXIT INT TERM
  preflight_cleanup
}

validate_backup() {
  backup_path=$1
  validate_backup_path "$backup_path"
  test -d "$backup_path" || fail "backup directory does not exist"
  for filename in cimmich.dump documents.tgz config.tgz manifest.json SHA256SUMS; do
    test -s "$backup_path/$filename" || fail "backup is incomplete: $filename"
  done
  checksum_names=$(awk 'NF == 2 && $1 ~ /^[0-9a-f]{64}$/ && $2 !~ /\// { print $2 }' \
    "$backup_path/SHA256SUMS" | sort | tr '\n' ':')
  test "$checksum_names" = "cimmich.dump:config.tgz:documents.tgz:manifest.json:" ||
    fail "backup checksum manifest is invalid"
  test "$(wc -l < "$backup_path/SHA256SUMS" | tr -d ' ')" -eq 4 ||
    fail "backup checksum manifest is invalid"
  (cd "$backup_path" && sha256sum -c SHA256SUMS >/dev/null) ||
    fail "backup checksum verification failed"
  manifest_fields=$(docker run --rm -v "$backup_path:/backup:ro" "$NODE_IMAGE" node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync("/backup/manifest.json", "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) process.exit(2);
    if (Object.keys(value).sort().join(",") !== "health,project,semanticCounts") process.exit(2);
    const schema = value.health?.schemaVersion;
    if (!Number.isSafeInteger(schema) || schema < 1) process.exit(2);
    if (typeof value.project !== "string" || !/^[a-z0-9_-]+$/.test(value.project)) process.exit(2);
    if (typeof value.semanticCounts !== "string" || !/^\d+(?::\d+){5}$/.test(value.semanticCounts)) process.exit(2);
    process.stdout.write(`${value.project}|${schema}|${value.semanticCounts}`);
  ') || fail "backup manifest is invalid"
  BACKUP_PROJECT=${manifest_fields%%|*}
  manifest_remainder=${manifest_fields#*|}
  BACKUP_SCHEMA_VERSION=${manifest_remainder%%|*}
  BACKUP_SEMANTIC_COUNTS=${manifest_remainder#*|}
  test "$BACKUP_PROJECT" = "$PROJECT" || fail "backup project mismatch"
  test "$BACKUP_SCHEMA_VERSION" -le "$CURRENT_SCHEMA_VERSION" ||
    fail "backup schema is newer than this Cimmich build"
  validate_semantic_counts "$BACKUP_SEMANTIC_COUNTS"
  validate_tar_archive "$backup_path" documents.tgz
  validate_tar_archive "$backup_path" config.tgz
  validate_config_archive "$backup_path"
  preflight_backup_database "$backup_path"
}

backup() {
  require_configured
  test "$#" -eq 1 || fail "usage: companion.sh backup ABSOLUTE_NEW_DIRECTORY"
  backup_path=$1
  validate_backup_path "$backup_path"
  test ! -e "$backup_path" || fail "backup target already exists"
  mkdir -p "$backup_path"
  chmod 700 "$backup_path"
  compose exec -T cimmich-database pg_dump -U cimmich -d cimmich -Fc > "$backup_path/cimmich.dump"
  docker run --rm -v "$DOCUMENT_VOLUME:/source:ro" -v "$backup_path:/backup" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce \
    tar -czf /backup/documents.tgz -C /source .
  docker run --rm -v "$CONFIG_VOLUME:/source:ro" -v "$backup_path:/backup" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce \
    tar -czf /backup/config.tgz -C /source .
  health=$(compose exec -T cimmich-api node -e "fetch('http://127.0.0.1:3101/health').then(r=>r.json()).then(v=>process.stdout.write(JSON.stringify(v)))")
  printf '{"health":%s,"project":"%s"}\n' "$health" "$PROJECT" > "$backup_path/manifest.json"
  (cd "$backup_path" && sha256sum cimmich.dump documents.tgz config.tgz manifest.json > SHA256SUMS)
  chmod 600 "$backup_path"/*
  backup_id=${backup_path##*/}
  printf '{"backupId":"%s","project":"%s","status":"READY"}\n' "$backup_id" "$PROJECT"
}

restore() {
  require_configured
  test "$#" -eq 2 || fail "usage: companion.sh restore ABSOLUTE_BACKUP --confirm=PROJECT"
  backup_path=$1
  confirmation=$2
  validate_backup_path "$backup_path"
  test "$confirmation" = "--confirm=$PROJECT" || fail "restore confirmation must exactly name $PROJECT"
  test -f "$backup_path/SHA256SUMS" || fail "backup is incomplete"
  (cd "$backup_path" && sha256sum -c SHA256SUMS >/dev/null) || fail "backup checksum verification failed"
  compose stop cimmich-gateway cimmich-ui cimmich-api >/dev/null 2>&1 || true
  compose up --detach --wait cimmich-database
  compose exec -T cimmich-database dropdb --if-exists --force -U cimmich cimmich
  compose exec -T cimmich-database createdb -U cimmich cimmich
  compose exec -T cimmich-database pg_restore -U cimmich -d cimmich --no-owner --no-privileges < "$backup_path/cimmich.dump"
  docker run --rm -v "$DOCUMENT_VOLUME:/target" -v "$backup_path:/backup:ro" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce \
    sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/documents.tgz -C /target'
  docker run --rm -v "$CONFIG_VOLUME:/target" -v "$backup_path:/backup:ro" \
    alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce \
    sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/config.tgz -C /target'
  compose up --detach --wait
  backup_id=${backup_path##*/}
  printf '{"backupId":"%s","project":"%s","status":"RESTORED"}\n' "$backup_id" "$PROJECT"
}

disable() {
  require_configured
  compose stop cimmich-gateway cimmich-ui cimmich-api
  printf '{"database":"preserved","project":"%s","status":"DISABLED"}\n' "$PROJECT"
}

remove_companion() {
  require_configured
  test "$#" -eq 1 || fail "usage: companion.sh remove --confirm=PROJECT"
  test "$1" = "--confirm=$PROJECT" || fail "remove confirmation must exactly name $PROJECT"
  compose down --volumes --remove-orphans
  known=$(find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -type f -print)
  test "$known" = "$ENV_FILE" || fail "state root contains unrecognized files; refusing removal"
  rm -f "$ENV_FILE"
  rmdir "$STATE_ROOT"
  printf '{"project":"%s","state":"removed","status":"REMOVED"}\n' "$PROJECT"
}

validate_project

command=${1:-}
test -n "$command" || fail "usage: companion.sh configure|up|status|sync|private-password|backup|restore|disable|remove"
shift
case "$command" in
  configure) configure "$@" ;;
  up) up "$@" ;;
  status) status "$@" ;;
  sync) sync_inventory "$@" ;;
  private-password) private_password "$@" ;;
  backup) backup "$@" ;;
  restore) restore "$@" ;;
  disable) disable "$@" ;;
  remove) remove_companion "$@" ;;
  *) fail "usage: companion.sh configure|up|status|sync|private-password|backup|restore|disable|remove" ;;
esac
