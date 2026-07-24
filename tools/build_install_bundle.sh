#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

fail() {
  printf 'Cimmich install bundle: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  else
    fail "sha256sum or shasum is required"
  fi
}

version=${1:-}
output_root=${2:-}
test -n "$version" && test -n "$output_root" ||
  fail "usage: ./tools/build_install_bundle.sh VERSION ABSOLUTE_OUTPUT_DIRECTORY"
case "$version" in
  v[0-9]*)
    case "$version" in *[!A-Za-z0-9._-]*) fail "VERSION contains unsupported characters" ;; esac
    ;;
  *) fail "VERSION must begin with v followed by a number" ;;
esac
case "$output_root" in
  /*) ;;
  *) fail "output directory must be absolute" ;;
esac

require_command git
require_command tar
require_command zip

git -C "$ROOT" ls-files --error-unmatch tools/build_install_bundle.sh >/dev/null 2>&1 ||
  fail "the bundle builder must be tracked by Git before it can produce a release artifact"
test -z "$(git -C "$ROOT" status --porcelain)" ||
  fail "the release working tree is not clean; commit the exact release contents before building artifacts"

bundle_name="cimmich-$version"
temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/cimmich-install-bundle.XXXXXX")
cleanup() {
  rm -rf "$temporary_root"
}
trap cleanup EXIT INT TERM

tracked_archive="$temporary_root/tracked.tar"
staging_root="$temporary_root/staging"
bundle_root="$staging_root/$bundle_name"
mkdir -p "$bundle_root" "$output_root"

# Package only the clean commit's tracked files. Refusing dirty or untracked
# state prevents a local proof from silently omitting a newly added runtime file
# or admitting an unreviewed edit.
(cd "$ROOT" && git ls-files -z | tar --null -T - -cf "$tracked_archive")
tar -xf "$tracked_archive" -C "$bundle_root"

for executable in \
  tools/install.sh \
  tools/companion.sh; do
  chmod 755 "$bundle_root/$executable"
done

chmod 755 "$bundle_root/tools/build_install_bundle.sh"

tar_path="$output_root/cimmich-$version.tar.gz"
zip_path="$output_root/cimmich-$version.zip"
checksum_path="$output_root/SHA256SUMS"

(cd "$staging_root" && tar -czf "$tar_path" "$bundle_name")
(cd "$staging_root" && zip -qr "$zip_path" "$bundle_name")

{
  sha256_file "$tar_path" | awk '{ print $1 "  " "'"$(basename "$tar_path")"'" }'
  sha256_file "$zip_path" | awk '{ print $1 "  " "'"$(basename "$zip_path")"'" }'
} > "$checksum_path"

printf '{"bundle":"%s","checksums":"%s","tar":"%s","zip":"%s"}\n' \
  "$bundle_name" "$checksum_path" "$tar_path" "$zip_path"
