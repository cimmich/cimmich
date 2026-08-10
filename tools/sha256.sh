#!/usr/bin/env sh
set -eu

fail() {
  printf 'Cimmich checksum: %s\n' "$*" >&2
  exit 1
}

checksum_tool() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf 'sha256sum\n'
  elif command -v shasum >/dev/null 2>&1; then
    printf 'shasum\n'
  else
    fail "sha256sum or shasum is required"
  fi
}

action=${1:-}
case "$action" in
  check)
    test "$#" -eq 1 || fail "usage: sha256.sh check"
    checksum_tool
    ;;
  generate)
    shift
    test "$#" -gt 0 || fail "usage: sha256.sh generate FILE..."
    case "$(checksum_tool)" in
      sha256sum) sha256sum "$@" ;;
      shasum) shasum -a 256 "$@" ;;
    esac
    ;;
  verify)
    test "$#" -eq 2 || fail "usage: sha256.sh verify MANIFEST"
    manifest=$2
    case "$manifest" in
      */*) fail "checksum manifest must be in the current directory" ;;
    esac
    test -f "$manifest" || fail "checksum manifest is missing"
    case "$(checksum_tool)" in
      sha256sum) sha256sum -c "$manifest" ;;
      shasum) shasum -a 256 -c "$manifest" ;;
    esac
    ;;
  *)
    fail "usage: sha256.sh check|generate FILE...|verify MANIFEST"
    ;;
esac
