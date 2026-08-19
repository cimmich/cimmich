#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=$(tr -d '\r\n' < "$ROOT/CIMMICH_VERSION")

fail() {
  printf 'Cimmich install docs acceptance: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

require_command docker
require_command git
require_command rg

case "$VERSION" in
  v[0-9]*) ;;
  *) fail "CIMMICH_VERSION is invalid" ;;
esac

rg -F -- 'shasum -a 256 --ignore-missing -c SHA256SUMS' "$ROOT/INSTALL.md" >/dev/null ||
  fail "the macOS one-bundle checksum command is missing"
rg -F -- 'sha256sum --ignore-missing -c SHA256SUMS' "$ROOT/INSTALL.md" >/dev/null ||
  fail "the Linux one-bundle checksum command is missing"
rg -F -- '--project-name "$CIMMICH_COMPANION_PROJECT"' "$ROOT/INSTALL.md" >/dev/null ||
  fail "the database-backup command omits the guided Compose project"
rg -F -- '--env-file "$CIMMICH_COMPANION_STATE_ROOT/runtime.env"' "$ROOT/INSTALL.md" >/dev/null ||
  fail "the database-backup command omits the guided runtime environment"

proof_root=$(mktemp -d "${TMPDIR:-/tmp}/cimmich-install-docs.XXXXXX")
cleanup() {
  rm -rf "$proof_root"
}
trap cleanup EXIT INT TERM

release_root="$proof_root/release"
mkdir -p "$release_root"
"$ROOT/tools/build_install_bundle.sh" "$VERSION" "$release_root" >/dev/null

for suffix in tar.gz zip; do
  one_bundle_root="$proof_root/one-$suffix"
  mkdir -p "$one_bundle_root"
  cp "$release_root/SHA256SUMS" "$one_bundle_root/SHA256SUMS"
  cp "$release_root/cimmich-$VERSION.$suffix" "$one_bundle_root/cimmich-$VERSION.$suffix"
  if test "$(uname -s)" = Darwin; then
    (cd "$one_bundle_root" && shasum -a 256 --ignore-missing -c SHA256SUMS)
  else
    (cd "$one_bundle_root" && sha256sum --ignore-missing -c SHA256SUMS)
  fi
done

runtime_root="$proof_root/runtime"
backup_root="$proof_root/database-backup"
project=cimmich-install-docs-proof
mkdir -p "$runtime_root" "$backup_root"
umask 077
{
  printf 'CIMMICH_COMPANION_PROJECT=%s\n' "$project"
  printf 'CIMMICH_COMPANION_API_PORT=4511\n'
  printf 'CIMMICH_COMPANION_UI_PORT=4513\n'
  printf 'CIMMICH_COMPANION_UI_BIND_ADDRESS=127.0.0.1\n'
  printf 'CIMMICH_ALLOWED_HOSTS=127.0.0.1,localhost,cimmich-api\n'
  printf 'CIMMICH_ALLOWED_ORIGINS=http://127.0.0.1:4513,http://localhost:4513\n'
  printf 'CIMMICH_IMMICH_SOURCE_ID=immich-primary\n'
  printf 'CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE=password\n'
  printf 'CIMMICH_DB_PASSWORD=install-docs-proof-only\n'
  printf 'CIMMICH_IMMICH_API_KEY=\n'
  printf 'CIMMICH_IMMICH_API_URL=http://host.docker.internal:2283/api\n'
  printf 'CIMMICH_IMMICH_WEB_ORIGIN=http://host.docker.internal:2283\n'
} > "$runtime_root/runtime.env"

CIMMICH_DATABASE_BACKUP_PATH="$backup_root" \
CIMMICH_DATABASE_BACKUP_LABEL='Documentation proof' \
CIMMICH_DATABASE_BACKUP_DESCRIPTION='Disposable release acceptance target' \
CIMMICH_DATABASE_BACKUP_STORAGE_DOMAIN=install-docs-independent-disk \
CIMMICH_COMPANION_PROJECT="$project" \
CIMMICH_COMPANION_STATE_ROOT="$runtime_root" \
  docker compose \
    --project-name "$project" \
    --env-file "$runtime_root/runtime.env" \
    --file "$ROOT/compose.yaml" \
    --file "$ROOT/compose.database-backup.yaml" \
    config --quiet

printf '{"databaseBackupCompose":"passed","oneBundleChecksums":2,"version":"%s"}\n' "$VERSION"
