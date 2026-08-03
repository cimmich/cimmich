#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

fail() {
  printf 'Cimmich publication scan: %s\n' "$*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git is required"
command -v rg >/dev/null 2>&1 || fail "ripgrep (rg) is required"

git -C "$ROOT" ls-files --error-unmatch tools/run_publication_scan.sh >/dev/null 2>&1 ||
  fail "the publication scanner must be tracked"

if git -C "$ROOT" ls-files | rg -n '\.(db|sqlite|sqlite3|dump|pem|p12|pfx|key|onnx|pt|pth|npy|npz)$'; then
  fail "a database, credential container, key or model artifact is tracked"
fi

# The migration comment is an immutable applied-ledger checksum and the brand
# notice is deliberate public authorship. Both are narrow, documented
# exceptions; all other private rehearsal names and infrastructure references
# fail the candidate.
if rg -n -P --hidden \
  --glob '!tools/run_publication_scan.sh' \
  --glob '!migrations/0102_context_entity_public_migration_receipt.sql' \
  --glob '!docs/BRAND_ASSETS.md' \
  --glob '!tools/run_synthetic_acceptance.sh' \
  --glob '!.git' \
  --glob '!**/.git/**' \
  --glob '!**/node_modules/**' \
  --glob '!**/.svelte-kit/**' \
  --glob '!**/build/**' \
  --glob '!**/coverage/**' \
  '(?:/Users/|/home/rui|10\.0\.0\.1|admin@cimmich\.local|RUI/Core|MBCX|cimmich-x1|Benji Hart|Pink Palace|Manila Trip|TTR Consulting|Quad Safari)' \
  "$ROOT"; then
  fail "private rehearsal or internal infrastructure text remains"
fi

if rg -n -P --hidden \
  --glob '!tools/run_publication_scan.sh' \
  --glob '!tools/run_synthetic_acceptance.sh' \
  --glob '!docs/PRIVACY_BOUNDARY.md' \
  --glob '!tests/sql/001_intelligence_acceptance.sql' \
  --glob '!.git' \
  --glob '!**/.git/**' \
  --glob '!**/node_modules/**' \
  --glob '!**/.svelte-kit/**' \
  --glob '!**/build/**' \
  --glob '!**/coverage/**' \
  "BEGIN [A-Z ]*PRIVATE KEY|(?i:(?:api[_-]?key|password)\\s*=\\s*['\"](?![<\${])(?!password['\"])(?!auth\\.)[^'\"]{8,}['\"])" \
  "$ROOT"; then
  fail "credential-shaped material remains"
fi

printf '{"candidate":"public","scan":"passed","trackedFiles":%s}\n' \
  "$(git -C "$ROOT" ls-files | wc -l | tr -d ' ')"
