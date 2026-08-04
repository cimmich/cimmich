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

# Private names are checked below through token-window digests so the scanner
# can reject them without publishing the values it is meant to keep private.
# Internal paths and infrastructure identifiers remain safe to express as
# generic patterns here.
if rg -n -P --hidden \
  --glob '!tools/run_publication_scan.sh' \
  --glob '!tools/run_synthetic_acceptance.sh' \
  --glob '!.git' \
  --glob '!**/.git/**' \
  --glob '!**/node_modules/**' \
  --glob '!**/.svelte-kit/**' \
  --glob '!**/build/**' \
  --glob '!**/coverage/**' \
  '(?:/Users/|/home/rui|10\.0\.0\.1|admin@cimmich\.local|RUI/Core|MBCX|cimmich-x1)' \
  "$ROOT"; then
  fail "private rehearsal or internal infrastructure text remains"
fi

if ! node --input-type=module - "$ROOT" <<'NODE'
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
const forbidden = new Set([
  "89449ad30a2f64501559b4350d6728906f86fb75a547fdd4f7beeec1da32a81d",
  "4a16f21536385469a2d4cdbf27057a22aaeb4590a8231054ba346e9247e120f8",
  "58046757effbdf74d0df0f6402cbc8d14464c6b83be49806ee934999b92f0a33",
  "22b9a5cca40079fd9b94bcc5a3f8befc000bd2b1fe10e6f3d4b38d0b201de0b9",
  "85cccaa17e07692c70a555697c4c521a2d60db8cf1d0bbf2a6d94b5641319e02",
]);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const files = execFileSync("git", ["-C", root, "ls-files", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
let found = false;
for (const relative of files) {
  const bytes = readFileSync(path.join(root, relative));
  if (bytes.includes(0)) continue;
  const words = bytes
    .toString("utf8")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const width of [2, 3]) {
    for (let index = 0; index + width <= words.length; index += 1) {
      if (forbidden.has(digest(words.slice(index, index + width).join(" ")))) {
        console.error(`${relative}: private publication term`);
        found = true;
      }
    }
  }
}
if (found) process.exit(1);
NODE
then
  fail "private rehearsal text remains"
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
