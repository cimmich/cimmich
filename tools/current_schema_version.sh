#!/usr/bin/env sh
set -eu

MIGRATIONS_DIRECTORY=${1:?Pass the migrations directory}
latest=0
expected=1
for migration in "$MIGRATIONS_DIRECTORY"/[0-9][0-9][0-9][0-9]_*.sql; do
  test -f "$migration" || {
    printf 'schema-version: migration ledger is empty\n' >&2
    exit 1
  }
  version=$(basename "$migration" | cut -c1-4 | sed 's/^0*//')
  test -n "$version" || version=0
  test "$version" -eq "$expected" || {
    printf 'schema-version: migration ledger is not contiguous at %s\n' "$(basename "$migration")" >&2
    exit 1
  }
  latest=$version
  expected=$((expected + 1))
done
test "$latest" -gt 0 || {
  printf 'schema-version: migration ledger is empty\n' >&2
  exit 1
}
printf '%s\n' "$latest"
