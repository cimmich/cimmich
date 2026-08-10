#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ORIGINAL_PATH=$PATH
SHASUM_BIN=$(command -v shasum || true)
test -n "$SHASUM_BIN" || {
  printf 'Cimmich shasum acceptance: shasum is required\n' >&2
  exit 1
}

ISOLATED_BIN=$(mktemp -d "${TMPDIR:-/tmp}/cimmich-shasum-path.XXXXXX")
cleanup() {
  status=$?
  PATH=$ORIGINAL_PATH
  rm -rf "$ISOLATED_BIN"
  exit "$status"
}
trap cleanup EXIT INT TERM

old_ifs=$IFS
IFS=:
for command_dir in $ORIGINAL_PATH; do
  test -d "$command_dir" || continue
  for candidate in "$command_dir"/*; do
    test -x "$candidate" || continue
    command_name=${candidate##*/}
    test "$command_name" != sha256sum || continue
    test ! -e "$ISOLATED_BIN/$command_name" || continue
    ln -s "$candidate" "$ISOLATED_BIN/$command_name"
  done
done
IFS=$old_ifs

PATH=$ISOLATED_BIN
export PATH
test -z "$(command -v sha256sum || true)"
test "$(command -v shasum)" = "$ISOLATED_BIN/shasum"
test "$("$ROOT/tools/sha256.sh" check)" = shasum

"$ROOT/tools/companion_acceptance.sh"
