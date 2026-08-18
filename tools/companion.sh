#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CHECKSUM="$ROOT/tools/sha256.sh"
COMPOSE_FILE="$ROOT/compose.yaml"
PROJECT=${CIMMICH_COMPANION_PROJECT:-cimmich-companion}
STATE_ROOT=${CIMMICH_COMPANION_STATE_ROOT:-}
ENV_FILE="${STATE_ROOT:+$STATE_ROOT/runtime.env}"
DATABASE_VOLUME="${PROJECT}-database"
DOCUMENT_VOLUME="${PROJECT}-documents"
CONFIG_VOLUME="${PROJECT}-config"
FACE_PROVIDER_VOLUME="${PROJECT}-face-provider"
ZERO_DIGEST=0000000000000000000000000000000000000000000000000000000000000000
CURRENT_SCHEMA_VERSION=$(sh "$ROOT/tools/current_schema_version.sh" "$ROOT/migrations")
ALPINE_IMAGE=alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce
PGVECTOR_IMAGE=pgvector/pgvector:0.8.2-pg17-trixie@sha256:5c97c57367a485a8e99389548db67d441ab1a878f5492c3df04989f34ecf3c75
NODE_IMAGE=node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
SUPPORTED_IMMICH_VERSION=3.1.0
API_IMAGE=${CIMMICH_API_IMAGE:-cimmich-api:v1.1.0-community-preview.12}
UI_IMAGE=${CIMMICH_UI_IMAGE:-cimmich-ui:v1.1.0-community-preview.12}

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

validate_source_id() {
  value=$1
  case "$value" in
    ''|*[!A-Za-z0-9._:-]*) fail "Immich source ID must use only letters, numbers, dot, underscore, colon or hyphen" ;;
  esac
  test "${#value}" -le 128 || fail "Immich source ID must be 128 characters or fewer"
}

configured_value() {
  key=$1
  count=$(grep -c "^${key}=" "$ENV_FILE" || true)
  test "$count" -eq 1 || fail "runtime configuration has an invalid $key entry"
  sed -n "s/^${key}=//p" "$ENV_FILE"
}

configured_value_or() {
  key=$1
  fallback=$2
  count=$(grep -c "^${key}=" "$ENV_FILE" || true)
  test "$count" -le 1 || fail "runtime configuration has an invalid $key entry"
  if test "$count" -eq 1; then
    sed -n "s/^${key}=//p" "$ENV_FILE"
  else
    printf '%s\n' "$fallback"
  fi
}

require_configured() {
  validate_state_root
  test -f "$ENV_FILE" || fail "run configure first"
}

compose() {
  docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" --file "$COMPOSE_FILE" "$@"
}

prepare_api_image() {
  if test "${CIMMICH_COMPANION_BUILD_LOCAL:-true}" = true; then
    compose build cimmich-api
  else
    compose pull cimmich-api
  fi
}

preflight_immich_version() {
  api_url=$(configured_value CIMMICH_IMMICH_API_URL)
  if ! version_response=$(docker run --rm \
    --add-host host.docker.internal:host-gateway \
    "$ALPINE_IMAGE" \
    wget -q -O - "$api_url/server/version"); then
    fail "Immich is unreachable at the configured address. No Cimmich migration or import was started."
  fi
  version_major=$(printf '%s' "$version_response" | sed -n 's/.*"major"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
  version_minor=$(printf '%s' "$version_response" | sed -n 's/.*"minor"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
  version_patch=$(printf '%s' "$version_response" | sed -n 's/.*"patch"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
  version_prerelease=$(printf '%s' "$version_response" | sed -n 's/.*"prerelease"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')
  test -n "$version_major" && test -n "$version_minor" && test -n "$version_patch" ||
    fail "Immich returned an unreadable version. No Cimmich migration or import was started."
  detected_version="$version_major.$version_minor.$version_patch"
  if test -n "$version_prerelease"; then
    detected_version="$detected_version-rc.$version_prerelease"
  fi
  test "$detected_version" = "$SUPPORTED_IMMICH_VERSION" ||
    fail "IMMICH_COMPANION_VERSION_UNSUPPORTED: found Immich $detected_version; this Cimmich release requires exact Immich $SUPPORTED_IMMICH_VERSION. No Cimmich migration or import was started."
  printf 'cimmich companion: Immich %s preflight passed before database startup\n' "$detected_version"
}

canonical_request() {
  canonical_method=$1
  canonical_path=$2
  canonical_body=${3:-}
  ui_port=$(configured_value CIMMICH_COMPANION_UI_PORT)
  compose exec -T cimmich-api node -e '
    const fs = require("node:fs");
    const [method, path, body, uiPort] = process.argv.slice(1);
    (async () => {
      let apiKey = process.env.IMMICH_API_KEY || "";
      const filename = process.env.CIMMICH_IMMICH_CREDENTIAL_FILE || "";
      if (filename && fs.existsSync(filename)) {
        const credential = JSON.parse(fs.readFileSync(filename, "utf8"));
        apiKey = credential.apiKey;
      }
      let principalId = "owner-operator-bootstrap";
      let bindingState = "bootstrap";
      if (apiKey) {
        const ownerSession = await fetch(
          "http://127.0.0.1:3101/_internal/owner-session",
          { headers: { "x-api-key": apiKey } },
        );
        if (!ownerSession.ok) throw new Error("owner session unavailable");
        principalId = String(
          ownerSession.headers.get("x-cimmich-authenticated-principal") || "",
        );
        bindingState = String(
          ownerSession.headers.get("x-cimmich-owner-binding-state") || "",
        );
        if (!principalId || bindingState !== "owner") {
          throw new Error("owner session unavailable");
        }
      }
      const response = await fetch(`http://127.0.0.1:3101${path}`, {
        body: body ? body : undefined,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          origin: `http://127.0.0.1:${uiPort}`,
          "x-cimmich-actor": "owner-operator",
          "x-cimmich-authenticated-principal": principalId,
          "x-cimmich-device-id": "owner-operator",
          "x-cimmich-owner-binding-state": bindingState,
          "x-cimmich-surface": "interactive",
        },
        method,
      });
      const responseBody = await response.text();
      process.stdout.write(responseBody);
      if (!response.ok) process.exitCode = 1;
    })().catch(() => process.exit(1));
  ' "$canonical_method" "$canonical_path" "$canonical_body" "$ui_port"
}

configure() {
  validate_state_root
  test "$#" -ge 1 && test "$#" -le 2 || fail "usage: companion.sh configure IMMICH_ORIGIN [API_KEY_FILE]"
  origin=$1
  key_file=${2:-}
  validate_origin "$origin"
  api_port=${CIMMICH_COMPANION_API_PORT:-3411}
  ui_port=${CIMMICH_COMPANION_UI_PORT:-3413}
  ui_bind_address=${CIMMICH_COMPANION_UI_BIND_ADDRESS:-127.0.0.1}
  source_id=${CIMMICH_IMMICH_SOURCE_ID:-immich-primary}
  private_lock_mode=${CIMMICH_COMPANION_PRIVATE_LOCK_MODE:-password}
  validate_port "$api_port" "Cimmich API port"
  validate_port "$ui_port" "Cimmich UI port"
  printf '%s\n' "$ui_bind_address" | awk -F. '
    NF != 4 { exit 1 }
    {
      for (i = 1; i <= 4; i += 1) {
        if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1
      }
    }
  ' || fail "Cimmich UI bind address must be an IPv4 address"
  test "$ui_bind_address" != "0.0.0.0" ||
    fail "Cimmich UI bind address must name one trusted interface"
  allowed_hosts=127.0.0.1,localhost,cimmich-api
  allowed_origins="http://127.0.0.1:$ui_port,http://localhost:$ui_port"
  if test "$ui_bind_address" != 127.0.0.1; then
    allowed_hosts="$allowed_hosts,$ui_bind_address"
    allowed_origins="$allowed_origins,http://$ui_bind_address:$ui_port"
  fi
  validate_source_id "$source_id"
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
    printf 'CIMMICH_COMPANION_UI_BIND_ADDRESS=%s\n' "$ui_bind_address"
    printf 'CIMMICH_ALLOWED_HOSTS=%s\n' "$allowed_hosts"
    printf 'CIMMICH_ALLOWED_ORIGINS=%s\n' "$allowed_origins"
    printf 'CIMMICH_IMMICH_SOURCE_ID=%s\n' "$source_id"
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
  preflight_immich_version
  if test "${CIMMICH_COMPANION_BUILD_LOCAL:-true}" = true; then
    # The public install is self-contained: build the exact checked-in sources
    # without depending on separate registry-package visibility.
    compose build cimmich-api
    compose build cimmich-ui
  else
    compose pull cimmich-api cimmich-ui
  fi
  compose up --detach --no-build --wait
  status
}

status() {
  require_configured
  api_port=$(configured_value CIMMICH_COMPANION_API_PORT)
  ui_port=$(configured_value CIMMICH_COMPANION_UI_PORT)
  ui_bind_address=$(configured_value_or CIMMICH_COMPANION_UI_BIND_ADDRESS 127.0.0.1)
  validate_port "$api_port" "Configured Cimmich API port"
  validate_port "$ui_port" "Configured Cimmich UI port"
  health=$(curl --fail --silent --show-error "http://127.0.0.1:${api_port}/health")
  companion=$(canonical_request GET /v1/companion/status)
  printf '{"companion":%s,"health":%s,"project":"%s","ui":"http://%s:%s"}\n' \
    "$companion" "$health" "$PROJECT" "$ui_bind_address" "$ui_port"
}

doctor() {
  test "$#" -eq 0 || fail "usage: companion.sh doctor"
  CIMMICH_COMPANION_PROJECT="$PROJECT" \
    CIMMICH_COMPANION_STATE_ROOT="$STATE_ROOT" \
    node "$ROOT/tools/doctor.mjs"
}

sync_inventory() {
  require_configured
  max_pages=${1:-}
  case "$max_pages" in
    ''|*[!0-9]*) test -z "$max_pages" || fail "max pages must be a positive integer" ;;
    0) fail "max pages must be a positive integer" ;;
  esac
  source_id=$(configured_value CIMMICH_IMMICH_SOURCE_ID)
  validate_source_id "$source_id"
  args="--action=sync --source-id=$source_id --operation=detect_and_recognize --tool-version=inventory-only-v1 --config-digest=$ZERO_DIGEST"
  if test -n "$max_pages"; then
    args="$args --max-pages=$max_pages"
  fi
  # Arguments are generated above from validated integers and fixed public IDs.
  # shellcheck disable=SC2086
  compose exec -T cimmich-api node bin/sync-immich-inventory.mjs $args
}

face_provider() {
  require_configured
  action=${1:-}
  case "$action" in
    install-recommended)
      test "$#" -eq 1 || fail "usage: companion.sh face-provider install-recommended"
      prepare_api_image
      compose --profile face-provider run --rm cimmich-face-provider-init
      if grep -q '^CIMMICH_LOCAL_MEDIA_PROVIDER=' "$ENV_FILE"; then
        sed -i.bak \
          's/^CIMMICH_LOCAL_MEDIA_PROVIDER=.*/CIMMICH_LOCAL_MEDIA_PROVIDER=opencv-yunet-sface-cpu/' \
          "$ENV_FILE"
        rm -f "$ENV_FILE.bak"
      else
        printf 'CIMMICH_LOCAL_MEDIA_PROVIDER=opencv-yunet-sface-cpu\n' >> "$ENV_FILE"
      fi
      chmod 600 "$ENV_FILE"
      compose up --detach --no-deps --force-recreate cimmich-api
      api_port=$(configured_value CIMMICH_COMPANION_API_PORT)
      i=0
      until curl --fail --silent "http://127.0.0.1:${api_port}/health" >/dev/null 2>&1; do
        i=$((i + 1))
        test "$i" -lt 60 || fail "recommended Face provider did not become ready"
        sleep 2
      done
      canonical_request GET /v1/operator/face-matching
      printf '\n'
      ;;
    configure)
      test "$#" -eq 4 ||
        fail "usage: companion.sh face-provider configure MANIFEST DETECTOR_MODEL RECOGNIZER_MODEL"
      manifest_path=$2
      detector_path=$3
      recognizer_path=$4
      for provider_path in "$manifest_path" "$detector_path" "$recognizer_path"; do
        case "$provider_path" in /*) ;; *) fail "Face provider paths must be absolute" ;; esac
        test -f "$provider_path" || fail "Face provider file is missing: $provider_path"
      done
      prepare_api_image
      compose stop cimmich-api >/dev/null 2>&1 || true
      docker volume create "$FACE_PROVIDER_VOLUME" >/dev/null
      docker run --rm --user 0:0 \
        --mount "type=bind,src=$manifest_path,dst=/input/provider-manifest.json,readonly" \
        --mount "type=bind,src=$detector_path,dst=/input/detector.onnx,readonly" \
        --mount "type=bind,src=$recognizer_path,dst=/input/recognizer.onnx,readonly" \
        --mount "type=volume,src=$FACE_PROVIDER_VOLUME,dst=/face-provider" \
        "$API_IMAGE" \
        node bin/configure-local-face-provider.mjs \
        --manifest=/input/provider-manifest.json \
        --detector=/input/detector.onnx \
        --recognizer=/input/recognizer.onnx \
        --target=/face-provider --execute
      if grep -q '^CIMMICH_LOCAL_MEDIA_PROVIDER=' "$ENV_FILE"; then
        sed -i.bak \
          's/^CIMMICH_LOCAL_MEDIA_PROVIDER=.*/CIMMICH_LOCAL_MEDIA_PROVIDER=insightface-user-supplied-cpu/' \
          "$ENV_FILE"
        rm -f "$ENV_FILE.bak"
      else
        printf 'CIMMICH_LOCAL_MEDIA_PROVIDER=insightface-user-supplied-cpu\n' >> "$ENV_FILE"
      fi
      chmod 600 "$ENV_FILE"
      compose up --detach --no-deps --force-recreate cimmich-api
      api_port=$(configured_value CIMMICH_COMPANION_API_PORT)
      i=0
      until curl --fail --silent "http://127.0.0.1:${api_port}/health" >/dev/null 2>&1; do
        i=$((i + 1))
        test "$i" -lt 60 || fail "configured Face provider did not become ready"
        sleep 2
      done
      canonical_request GET /v1/operator/face-matching
      printf '\n'
      ;;
    status)
      test "$#" -eq 1 || fail "usage: companion.sh face-provider status"
      canonical_request GET /v1/operator/face-matching
      printf '\n'
      ;;
    *) fail "usage: companion.sh face-provider install-recommended|configure|status" ;;
  esac
}

process_faces() {
  require_configured
  batches=${1:-10}
  work_limit=${2:-10}
  case "$batches:$work_limit" in
    *[!0-9:]*|0:*|*:0) fail "process-faces batches and work limit must be positive integers" ;;
  esac
  test "$batches" -le 100 || fail "process-faces batches must not exceed 100"
  test "$work_limit" -le 25 || fail "process-faces work limit must not exceed 25"
  batch=1
  while test "$batch" -le "$batches"; do
    command_id="owner-recognition-$(date +%s)-$$-$batch"
    result=$(canonical_request POST /v1/operator/face-matching/recognition \
      "{\"commandId\":\"$command_id\",\"workLimit\":$work_limit}")
    printf '%s\n' "$result"
    batch=$((batch + 1))
  done
  canonical_request GET /v1/operator/face-matching
  printf '\n'
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
  # BusyBox tar normalizes leading ../ segments before listing them, so its
  # human-readable output cannot be the authority for traversal validation.
  # Parse the decompressed USTAR headers as a stream, retaining at most one
  # chunk plus a header while rejecting links, devices and unsafe raw names.
  docker run --rm -v "$backup_path:/backup:ro" "$NODE_IMAGE" node -e '
    const { createReadStream } = require("node:fs");
    const { createGunzip } = require("node:zlib");
    const archive = process.argv[1];
    let buffer = Buffer.alloc(0);
    let remaining = 0;
    let entries = 0;
    let ended = false;
    const fail = () => process.exit(2);
    const text = (block, start, length) => {
      const bytes = block.subarray(start, start + length);
      const zero = bytes.indexOf(0);
      return bytes.subarray(0, zero < 0 ? bytes.length : zero).toString("utf8");
    };
    const input = createReadStream(archive).on("error", fail);
    const gunzip = createGunzip().on("error", fail);
    gunzip.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        if (remaining) {
          const consumed = Math.min(remaining, buffer.length);
          buffer = buffer.subarray(consumed);
          remaining -= consumed;
          continue;
        }
        if (buffer.length < 512) break;
        const block = buffer.subarray(0, 512);
        buffer = buffer.subarray(512);
        if (block.every((byte) => byte === 0)) {
          ended = true;
          continue;
        }
        if (ended || ++entries > 1000000) fail();
        const name = text(block, 0, 100);
        const prefix = text(block, 345, 155);
        const fullName = prefix ? `${prefix}/${name}` : name;
        const parts = fullName.split("/");
        if (!fullName || fullName.startsWith("/") || fullName.includes("\\") ||
            /[\u0000-\u001f\u007f]/u.test(fullName) || parts.includes("..")) fail();
        const type = block[156];
        if (![0, 48, 53].includes(type)) fail();
        const sizeText = text(block, 124, 12).trim();
        if (!/^[0-7]+$/.test(sizeText || "0")) fail();
        const size = Number.parseInt(sizeText || "0", 8);
        if (!Number.isSafeInteger(size) || size < 0 || (type === 53 && size !== 0)) fail();
        remaining = Math.ceil(size / 512) * 512;
      }
    });
    gunzip.on("end", () => {
      if (remaining || (buffer.length && !buffer.every((byte) => byte === 0))) fail();
    });
    input.pipe(gunzip);
  ' "/backup/$archive_name" || fail "backup archive contains unsafe members: $archive_name"
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
  case "$config_members" in
    :|\
    :immich-credential.json:|\
    :cimmich-matching-provider.json:|\
    :cimmich-matching-provider.json:immich-credential.json:) ;;
    *) fail "backup config archive members are invalid" ;;
  esac
  case "$config_members" in
    *:immich-credential.json:*)
    docker run --rm -v "$backup_path:/backup:ro" "$ALPINE_IMAGE" \
      tar -xOzf /backup/config.tgz ./immich-credential.json |
      docker run --rm -i "$NODE_IMAGE" node -e '
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { input += chunk; });
        process.stdin.on("end", () => {
          if (Buffer.byteLength(input) > 2048) process.exit(2);
          let value;
          try { value = JSON.parse(input); } catch { process.exit(2); }
          if (!value || typeof value !== "object" || Array.isArray(value)) process.exit(2);
          if (Object.keys(value).sort().join(",") !== "apiBaseUrl,apiKey") process.exit(2);
          if (typeof value.apiKey !== "string" || value.apiKey.length < 16 || value.apiKey.length > 512 || /[\u0000-\u001f\u007f]/u.test(value.apiKey)) process.exit(2);
          if (typeof value.apiBaseUrl !== "string" || value.apiBaseUrl.length > 2048) process.exit(2);
          let url;
          try { url = new URL(value.apiBaseUrl); } catch { process.exit(2); }
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.hostname || !url.pathname.endsWith("/api")) process.exit(2);
        });
      ' || fail "backup Immich credential is invalid"
      ;;
  esac
  case "$config_members" in
    *:cimmich-matching-provider.json:*)
      docker run --rm -v "$backup_path:/backup:ro" "$ALPINE_IMAGE" \
        tar -xOzf /backup/config.tgz ./cimmich-matching-provider.json |
        docker run --rm -i "$API_IMAGE" \
        node --input-type=module -e '
          import { validateRecognitionProviderManifest } from "./src/recognition-provider-contract.mjs";
          let input = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => {
            input += chunk;
            if (Buffer.byteLength(input) > 32768) process.exit(2);
          });
          process.stdin.on("end", () => {
            let value;
            try { value = JSON.parse(input); } catch { process.exit(2); }
            try { validateRecognitionProviderManifest(value); } catch { process.exit(2); }
          });
        ' || fail "backup matching-provider manifest is invalid"
      ;;
  esac
}

preflight_backup_database() (
  backup_path=$1
  preflight_id="cimmich-companion-restore-preflight-$$"
  preflight_network="$preflight_id-network"
  preflight_database="$preflight_id-database"
  preflight_password=$(openssl rand -hex 32)
  preflight_cleanup() {
    docker rm -fv "$preflight_database" >/dev/null 2>&1 || true
    docker network rm "$preflight_network" >/dev/null 2>&1 || true
  }
  trap preflight_cleanup EXIT INT TERM
  docker image inspect "$API_IMAGE" >/dev/null 2>&1 ||
    fail "current Cimmich API image is unavailable for restore preflight"
  docker network create "$preflight_network" >/dev/null
  docker run -d --name "$preflight_database" --network "$preflight_network" \
    -e POSTGRES_DB=cimmich -e POSTGRES_USER=cimmich -e POSTGRES_PASSWORD="$preflight_password" \
    "$PGVECTOR_IMAGE" >/dev/null
  i=0
  # pg_isready reports only server acceptance and can succeed before the
  # requested database has been created. Require one real query against the
  # exact restore target before feeding pg_restore.
  until docker exec "$preflight_database" psql -U cimmich -d cimmich -Atc \
    'SELECT 1' >/dev/null 2>&1; do
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
  restored_locator_table=$(docker exec "$preflight_database" psql -U cimmich -d cimmich -Atc \
    "SELECT to_regclass('imported_identity_locator') IS NOT NULL;") ||
    fail "backup imported-locator preservation state is unreadable"
  if test "$restored_locator_table" = t; then
    restored_locator_count=$(docker exec "$preflight_database" psql -U cimmich -d cimmich -Atc \
      "SELECT count(*) FROM imported_identity_locator;") ||
      fail "backup imported-locator count is unreadable"
  else
    restored_locator_count=0
  fi
  docker run --rm --network "$preflight_network" \
    -e DATABASE_URL="postgres://cimmich:$preflight_password@$preflight_database:5432/cimmich" \
    "$API_IMAGE" node bin/migrate.mjs apply >/dev/null ||
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
  migrated_locator_table=$(docker exec "$preflight_database" psql -U cimmich -d cimmich -Atc \
    "SELECT to_regclass('imported_identity_locator') IS NOT NULL;") ||
    fail "migrated backup imported-locator preservation state is unreadable"
  test "$migrated_locator_table" = t ||
    fail "backup migration removed imported-locator provenance"
  migrated_locator_count=$(docker exec "$preflight_database" psql -U cimmich -d cimmich -Atc \
    "SELECT count(*) FROM imported_identity_locator;") ||
    fail "migrated backup imported-locator count is unreadable"
  test "$migrated_locator_count" = "$restored_locator_count" ||
    fail "backup migration changed imported-locator provenance"
  trap - EXIT INT TERM
  preflight_cleanup
)

validate_backup() {
  backup_path=$1
  validate_backup_path "$backup_path"
  test -d "$backup_path" || fail "backup directory does not exist"
  for filename in cimmich.dump documents.tgz config.tgz face-provider.tgz manifest.json SHA256SUMS; do
    test -s "$backup_path/$filename" || fail "backup is incomplete: $filename"
  done
  checksum_names=$(awk 'NF == 2 && $1 ~ /^[0-9a-f]{64}$/ && $2 !~ /\// { print $2 }' \
    "$backup_path/SHA256SUMS" | sort | tr '\n' ':')
  test "$checksum_names" = "cimmich.dump:config.tgz:documents.tgz:face-provider.tgz:manifest.json:" ||
    fail "backup checksum manifest is invalid"
  test "$(wc -l < "$backup_path/SHA256SUMS" | tr -d ' ')" -eq 5 ||
    fail "backup checksum manifest is invalid"
  (cd "$backup_path" && "$CHECKSUM" verify SHA256SUMS >/dev/null) ||
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
  validate_tar_archive "$backup_path" face-provider.tgz
  validate_config_archive "$backup_path"
  preflight_backup_database "$backup_path"
}

validate_portable_export() {
  backup_path=$1
  validate_backup_path "$backup_path"
  test -d "$backup_path" || fail "portable export directory does not exist"
  for filename in cimmich.dump documents.tgz manifest.json SHA256SUMS; do
    test -s "$backup_path/$filename" || fail "portable export is incomplete: $filename"
  done
  checksum_names=$(awk 'NF == 2 && $1 ~ /^[0-9a-f]{64}$/ && $2 !~ /\// { print $2 }' \
    "$backup_path/SHA256SUMS" | sort | tr '\n' ':')
  test "$checksum_names" = "cimmich.dump:documents.tgz:manifest.json:" ||
    fail "portable export checksum manifest is invalid"
  test "$(wc -l < "$backup_path/SHA256SUMS" | tr -d ' ')" -eq 3 ||
    fail "portable export checksum manifest is invalid"
  (cd "$backup_path" && "$CHECKSUM" verify SHA256SUMS >/dev/null) ||
    fail "portable export checksum verification failed"
  manifest_fields=$(docker run --rm -v "$backup_path:/portable:ro" "$NODE_IMAGE" node -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync("/portable/manifest.json", "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) process.exit(2);
    if (Object.keys(value).sort().join(",") !== "excludes,format,health,project,semanticCounts") process.exit(2);
    if (value.format !== "cimmich.portable-export.v1") process.exit(2);
    if (JSON.stringify(value.excludes) !== JSON.stringify(["credentials","media","provider-artifacts"])) process.exit(2);
    const schema = value.health?.schemaVersion;
    if (!Number.isSafeInteger(schema) || schema < 1) process.exit(2);
    if (typeof value.project !== "string" || !/^[a-z0-9_-]+$/.test(value.project)) process.exit(2);
    if (typeof value.semanticCounts !== "string" || !/^\d+(?::\d+){5}$/.test(value.semanticCounts)) process.exit(2);
    process.stdout.write(`${value.project}|${schema}|${value.semanticCounts}`);
  ') || fail "portable export manifest is invalid"
  BACKUP_PROJECT=${manifest_fields%%|*}
  manifest_remainder=${manifest_fields#*|}
  BACKUP_SCHEMA_VERSION=${manifest_remainder%%|*}
  BACKUP_SEMANTIC_COUNTS=${manifest_remainder#*|}
  test "$BACKUP_SCHEMA_VERSION" -le "$CURRENT_SCHEMA_VERSION" ||
    fail "portable export schema is newer than this Cimmich build"
  validate_semantic_counts "$BACKUP_SEMANTIC_COUNTS"
  validate_tar_archive "$backup_path" documents.tgz
  preflight_backup_database "$backup_path"
}

backup() {
  require_configured
  test "$#" -eq 1 || fail "usage: companion.sh backup ABSOLUTE_NEW_DIRECTORY"
  # Keep the requested destination separate from the validation helpers'
  # scratch variables. POSIX shell functions share one variable namespace;
  # validate_backup() intentionally inspects the staging directory and must
  # never turn the final rename into a move of that directory into itself.
  backup_destination=$1
  validate_backup_path "$backup_destination"
  test ! -e "$backup_destination" || fail "backup target already exists"
  backup_counts_before=$(semantic_counts 2>/dev/null) || fail "unable to read companion semantic counts"
  validate_semantic_counts "$backup_counts_before"
  backup_staging="$backup_destination.incomplete.$$"
  test ! -e "$backup_staging" || fail "incomplete backup staging path already exists"
  backup_complete=0
  backup_cleanup() {
    if test "$backup_complete" -eq 0; then rm -rf "$backup_staging"; fi
  }
  trap backup_cleanup EXIT INT TERM
  umask 077
  mkdir -p "$backup_staging"
  chmod 700 "$backup_staging"
  backup_archive_uid=$(id -u)
  backup_archive_gid=$(id -g)
  compose exec -T cimmich-database pg_dump -U cimmich -d cimmich -Fc > "$backup_staging/cimmich.dump"
  docker run --rm \
    -e ARCHIVE_UID="$backup_archive_uid" -e ARCHIVE_GID="$backup_archive_gid" \
    -v "$DOCUMENT_VOLUME:/source:ro" -v "$backup_staging:/backup" \
    "$ALPINE_IMAGE" sh -c \
    'tar -czf /backup/documents.tgz -C /source . && chown "$ARCHIVE_UID:$ARCHIVE_GID" /backup/documents.tgz'
  docker run --rm \
    -e ARCHIVE_UID="$backup_archive_uid" -e ARCHIVE_GID="$backup_archive_gid" \
    -v "$CONFIG_VOLUME:/source:ro" -v "$backup_staging:/backup" \
    "$ALPINE_IMAGE" sh -c \
    'tar -czf /backup/config.tgz -C /source . && chown "$ARCHIVE_UID:$ARCHIVE_GID" /backup/config.tgz'
  docker run --rm \
    -e ARCHIVE_UID="$backup_archive_uid" -e ARCHIVE_GID="$backup_archive_gid" \
    -v "$FACE_PROVIDER_VOLUME:/source:ro" -v "$backup_staging:/backup" \
    "$ALPINE_IMAGE" sh -c \
    'tar -czf /backup/face-provider.tgz -C /source . && chown "$ARCHIVE_UID:$ARCHIVE_GID" /backup/face-provider.tgz'
  if test "${backup_health_mode:-api}" = database; then
    backup_schema=$(compose exec -T cimmich-database psql -U cimmich -d cimmich -Atc \
      'SELECT COALESCE(max(version), 0) FROM cimmich_schema_migration;') ||
      fail "unable to read companion schema during rollback capture"
    test "$backup_schema" = "$CURRENT_SCHEMA_VERSION" ||
      fail "companion schema is not current during rollback capture"
    health="{\"database\":\"ready\",\"schemaVersion\":$backup_schema,\"status\":\"ok\"}"
  else
    health=$(compose exec -T cimmich-api node -e "fetch('http://127.0.0.1:3101/health').then(r=>r.json()).then(v=>process.stdout.write(JSON.stringify(v)))")
  fi
  backup_counts_after=$(semantic_counts 2>/dev/null) || fail "unable to re-read companion semantic counts"
  test "$backup_counts_after" = "$backup_counts_before" ||
    fail "companion semantic counts changed during backup"
  printf '{"health":%s,"project":"%s","semanticCounts":"%s"}\n' \
    "$health" "$PROJECT" "$backup_counts_before" > "$backup_staging/manifest.json"
  (cd "$backup_staging" && "$CHECKSUM" generate cimmich.dump documents.tgz config.tgz face-provider.tgz manifest.json > SHA256SUMS)
  chmod 600 "$backup_staging"/*
  validate_backup "$backup_staging"
  mv "$backup_staging" "$backup_destination"
  backup_complete=1
  trap - EXIT INT TERM
  backup_id=${backup_destination##*/}
  printf '{"backupId":"%s","project":"%s","schemaVersion":%s,"semanticCounts":"%s","status":"READY"}\n' \
    "$backup_id" "$PROJECT" "$CURRENT_SCHEMA_VERSION" "$backup_counts_before"
}

portable_export() {
  require_configured
  test "$#" -eq 1 || fail "usage: companion.sh portable-export ABSOLUTE_NEW_DIRECTORY"
  portable_destination=$1
  validate_backup_path "$portable_destination"
  test ! -e "$portable_destination" || fail "portable export target already exists"
  portable_counts_before=$(semantic_counts 2>/dev/null) ||
    fail "unable to read companion semantic counts"
  validate_semantic_counts "$portable_counts_before"
  portable_staging="$portable_destination.incomplete.$$"
  test ! -e "$portable_staging" ||
    fail "incomplete portable export staging path already exists"
  portable_complete=0
  portable_cleanup() {
    if test "$portable_complete" -eq 0; then rm -rf "$portable_staging"; fi
  }
  trap portable_cleanup EXIT INT TERM
  umask 077
  mkdir -p "$portable_staging"
  chmod 700 "$portable_staging"
  portable_archive_uid=$(id -u)
  portable_archive_gid=$(id -g)
  compose exec -T cimmich-database pg_dump -U cimmich -d cimmich -Fc \
    > "$portable_staging/cimmich.dump"
  docker run --rm \
    -e ARCHIVE_UID="$portable_archive_uid" -e ARCHIVE_GID="$portable_archive_gid" \
    -v "$DOCUMENT_VOLUME:/source:ro" -v "$portable_staging:/portable" \
    "$ALPINE_IMAGE" sh -c \
    'tar -czf /portable/documents.tgz -C /source . && chown "$ARCHIVE_UID:$ARCHIVE_GID" /portable/documents.tgz'
  health=$(compose exec -T cimmich-api node -e "fetch('http://127.0.0.1:3101/health').then(r=>r.json()).then(v=>process.stdout.write(JSON.stringify(v)))")
  portable_counts_after=$(semantic_counts 2>/dev/null) ||
    fail "unable to re-read companion semantic counts"
  test "$portable_counts_after" = "$portable_counts_before" ||
    fail "companion semantic counts changed during portable export"
  printf '{"excludes":["credentials","media","provider-artifacts"],"format":"cimmich.portable-export.v1","health":%s,"project":"%s","semanticCounts":"%s"}\n' \
    "$health" "$PROJECT" "$portable_counts_before" > "$portable_staging/manifest.json"
  (cd "$portable_staging" && "$CHECKSUM" generate cimmich.dump documents.tgz manifest.json > SHA256SUMS)
  chmod 600 "$portable_staging"/*
  validate_portable_export "$portable_staging"
  mv "$portable_staging" "$portable_destination"
  portable_complete=1
  trap - EXIT INT TERM
  portable_id=${portable_destination##*/}
  printf '{"exportId":"%s","format":"cimmich.portable-export.v1","media":"excluded","project":"%s","schemaVersion":%s,"status":"READY"}\n' \
    "$portable_id" "$PROJECT" "$CURRENT_SCHEMA_VERSION"
}

replace_from_full_backup() {
  replacement_path=$1
  compose stop cimmich-gateway cimmich-ui cimmich-api >/dev/null 2>&1 || true
  compose up --detach --wait cimmich-database || return 1
  compose exec -T cimmich-database dropdb --if-exists --force -U cimmich cimmich || return 1
  compose exec -T cimmich-database createdb -U cimmich cimmich || return 1
  compose exec -T cimmich-database pg_restore -U cimmich -d cimmich --no-owner --no-privileges \
    < "$replacement_path/cimmich.dump" || return 1
  docker run --rm -v "$DOCUMENT_VOLUME:/target" -v "$replacement_path:/backup:ro" \
    "$ALPINE_IMAGE" \
    sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/documents.tgz -C /target' || return 1
  docker run --rm -v "$CONFIG_VOLUME:/target" -v "$replacement_path:/backup:ro" \
    "$ALPINE_IMAGE" \
    sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/config.tgz -C /target' || return 1
  docker run --rm -v "$FACE_PROVIDER_VOLUME:/target" -v "$replacement_path:/backup:ro" \
    "$ALPINE_IMAGE" \
    sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/face-provider.tgz -C /target' || return 1
  compose up --detach --wait || return 1
}

replace_from_portable_export() {
  replacement_path=$1
  compose stop cimmich-gateway cimmich-ui cimmich-api >/dev/null 2>&1 || true
  compose up --detach --wait cimmich-database || return 1
  compose exec -T cimmich-database dropdb --if-exists --force -U cimmich cimmich || return 1
  compose exec -T cimmich-database createdb -U cimmich cimmich || return 1
  compose exec -T cimmich-database pg_restore -U cimmich -d cimmich \
    --no-owner --no-privileges < "$replacement_path/cimmich.dump" || return 1
  docker run --rm -v "$DOCUMENT_VOLUME:/target" -v "$replacement_path:/portable:ro" \
    "$ALPINE_IMAGE" \
    sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /portable/documents.tgz -C /target' || return 1
  # Target credentials and provider artifacts are deliberately preserved.
  compose up --detach --wait || return 1
}

create_restore_rollback() {
  restore_rollback_root=$(mktemp -d "${TMPDIR:-/tmp}/cimmich-restore-rollback.XXXXXX") ||
    fail "unable to create restore rollback staging"
  chmod 700 "$restore_rollback_root"
  restore_rollback_path="$restore_rollback_root/owner-state"
  backup_health_mode=database
  if ! backup "$restore_rollback_path" >/dev/null; then
    unset backup_health_mode
    rm -rf "$restore_rollback_root"
    fail "unable to capture owner state before restore"
  fi
  unset backup_health_mode
  restore_cleanup_rollback=1
  restore_cleanup() {
    if test "$restore_cleanup_rollback" -eq 1; then
      rm -rf "$restore_rollback_root"
    fi
  }
  trap restore_cleanup EXIT INT TERM
}

recover_failed_restore() {
  expected_counts=$1
  if replace_from_full_backup "$restore_rollback_path"; then
    rollback_counts=$(semantic_counts 2>/dev/null || true)
    if test "$rollback_counts" = "$expected_counts"; then
      fail "restore failed; the previous owner state was recovered automatically"
    fi
  fi
  restore_cleanup_rollback=0
  fail "restore failed and automatic recovery did not complete; rollback backup preserved at $restore_rollback_path"
}

restore() {
  require_configured
  test "$#" -eq 2 || fail "usage: companion.sh restore ABSOLUTE_BACKUP --confirm=PROJECT"
  backup_path=$1
  confirmation=$2
  test "$confirmation" = "--confirm=$PROJECT" || fail "restore confirmation must exactly name $PROJECT"
  validate_backup "$backup_path"
  restore_source=$backup_path
  restore_schema_version=$BACKUP_SCHEMA_VERSION
  restore_expected_counts=$BACKUP_SEMANTIC_COUNTS
  restore_previous_counts=$(semantic_counts 2>/dev/null) ||
    fail "unable to read owner state before restore"
  validate_semantic_counts "$restore_previous_counts"
  create_restore_rollback
  if ! replace_from_full_backup "$restore_source"; then
    recover_failed_restore "$restore_previous_counts"
  fi
  restored_counts=$(semantic_counts 2>/dev/null || true)
  if test "$restored_counts" != "$restore_expected_counts"; then
    recover_failed_restore "$restore_previous_counts"
  fi
  restore_cleanup_rollback=1
  backup_id=${restore_source##*/}
  printf '{"backupId":"%s","backupSchemaVersion":%s,"project":"%s","restoredSchemaVersion":%s,"semanticCounts":"%s","status":"RESTORED"}\n' \
    "$backup_id" "$restore_schema_version" "$PROJECT" "$CURRENT_SCHEMA_VERSION" "$restored_counts"
}

portable_restore() {
  require_configured
  test "$#" -eq 2 ||
    fail "usage: companion.sh portable-restore ABSOLUTE_EXPORT --confirm=PROJECT"
  backup_path=$1
  confirmation=$2
  test "$confirmation" = "--confirm=$PROJECT" ||
    fail "portable restore confirmation must exactly name $PROJECT"
  validate_portable_export "$backup_path"
  restore_source=$backup_path
  restore_schema_version=$BACKUP_SCHEMA_VERSION
  restore_expected_counts=$BACKUP_SEMANTIC_COUNTS
  restore_previous_counts=$(semantic_counts 2>/dev/null) ||
    fail "unable to read owner state before portable restore"
  validate_semantic_counts "$restore_previous_counts"
  create_restore_rollback
  if ! replace_from_portable_export "$restore_source"; then
    recover_failed_restore "$restore_previous_counts"
  fi
  restored_counts=$(semantic_counts 2>/dev/null || true)
  if test "$restored_counts" != "$restore_expected_counts"; then
    recover_failed_restore "$restore_previous_counts"
  fi
  restore_cleanup_rollback=1
  portable_id=${restore_source##*/}
  printf '{"exportId":"%s","exportSchemaVersion":%s,"format":"cimmich.portable-export.v1","project":"%s","restoredSchemaVersion":%s,"semanticCounts":"%s","status":"RESTORED"}\n' \
    "$portable_id" "$restore_schema_version" "$PROJECT" "$CURRENT_SCHEMA_VERSION" "$restored_counts"
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
  known=$(find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -print)
  test "$known" = "$ENV_FILE" || fail "state root contains unrecognized entries; refusing removal"
  compose down --volumes --remove-orphans
  if test "${CIMMICH_COMPANION_BUILD_LOCAL:-true}" = true; then
    docker image rm "$API_IMAGE" "$UI_IMAGE" >/dev/null 2>&1 || true
  fi
  rm -f "$ENV_FILE"
  rmdir "$STATE_ROOT"
  printf '{"project":"%s","state":"removed","status":"REMOVED"}\n' "$PROJECT"
}

validate_project

command=${1:-}
test -n "$command" || fail "usage: companion.sh configure|up|status|doctor|sync|face-provider|process-faces|private-password|backup|restore|portable-export|portable-restore|disable|remove"
shift
case "$command" in
  configure) configure "$@" ;;
  up) up "$@" ;;
  status) status "$@" ;;
  doctor) doctor "$@" ;;
  sync) sync_inventory "$@" ;;
  face-provider) face_provider "$@" ;;
  process-faces) process_faces "$@" ;;
  private-password) private_password "$@" ;;
  backup) backup "$@" ;;
  restore) restore "$@" ;;
  portable-export) portable_export "$@" ;;
  portable-restore) portable_restore "$@" ;;
  disable) disable "$@" ;;
  remove) remove_companion "$@" ;;
  *) fail "usage: companion.sh configure|up|status|doctor|sync|face-provider|process-faces|private-password|backup|restore|portable-export|portable-restore|disable|remove" ;;
esac
