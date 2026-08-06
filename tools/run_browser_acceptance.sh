#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STATE_ROOT=${CIMMICH_E2E_STATE_ROOT:-${XDG_STATE_HOME:-$HOME/.local/state}/cimmich-public-demo}
BASE_URL=${CIMMICH_E2E_BASE_URL:-http://127.0.0.1:3303}

test -s "$STATE_ROOT/operator.env" || {
  printf 'browser acceptance requires an isolated fictional demo operator.env\n' >&2
  exit 1
}

CIMMICH_E2E_BASE_URL="$BASE_URL" \
  CIMMICH_E2E_STATE_ROOT="$STATE_ROOT" \
  pnpm --dir "$ROOT/ui/web" run test:browser
