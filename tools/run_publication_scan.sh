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
if (
  cd "$ROOT"
  rg -n -P --hidden \
    --glob '!tools/run_publication_scan.sh' \
    --glob '!tools/run_synthetic_acceptance.sh' \
    --glob '!.git' \
    --glob '!**/.git/**' \
    --glob '!**/node_modules/**' \
    --glob '!**/.svelte-kit/**' \
    --glob '!**/build/**' \
    --glob '!**/coverage/**' \
    '(?:/Users/[A-Za-z0-9._-]+/|/home/(?!example(?:/|$))[A-Za-z0-9._-]+/|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\|/Volumes/(?!Cedar-House(?:/|$))[A-Za-z0-9._ -]+/|10\.0\.0\.1|admin@cimmich\.local|RUI[\\/]Core|MBCX|\bKern\b|(?i:cimmich[-_ ]?x1|x1[-_ ]?(?:runtime|deploy|host)))' \
    .
); then
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
const neutralCanary = ["neutral", "private", "canary"];
const canaryForbidden = new Set([digest(neutralCanary.join(" "))]);
if (!canaryForbidden.has(digest(neutralCanary.join(" ")))) process.exit(2);
const pathCanaries = [
  ["macOS home", ["", "Users", "example", "Archive", "photo.jpg"].join("/")],
  ["Linux home", ["", "home", "private-user", "archive", "photo.jpg"].join("/")],
  ["internal root", ["RUI", "Core", "Projects"].join("/")],
  ["agent name", ["Ke", "rn"].join("")],
  ["deployment alias", ["cimmich", "x1"].join("-")],
];
const privateShape = /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/(?!example(?:\/|$))[A-Za-z0-9._-]+\/|RUI[\\/]Core|MBCX|\bKern\b|cimmich[-_ ]?x1|x1[-_ ]?(?:runtime|deploy|host))/i;
for (const [label, value] of pathCanaries) {
  if (!privateShape.test(value)) {
    console.error(`publication scanner self-test failed: ${label}`);
    process.exit(2);
  }
}
if (privateShape.test("Cedar House/example.invalid")) process.exit(2);

// Assemble regression terms so the scanner remains safe to publish and cannot
// accidentally report its own source when the file exclusion changes.
const joined = (...parts) => parts.join("");
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fixtureTerms = {
  firstA: joined("jas", "min"),
  firstB: joined("tra", "cey"),
  firstC: joined("dan", "iel"),
  firstD: joined("hol", "lie"),
  placeA: joined("gul", "marrad"),
  placeB: joined("sher", "wood"),
  parent: joined("par", "ents"),
  home: joined("ho", "me"),
  house: joined("hou", "se"),
  streetA: joined("riv", "er"),
  streetB: joined("str", "eet"),
  commonA: joined("ma", "rk"),
  commonB: joined("je", "ss"),
  commonC: joined("ste", "ven"),
  commonD: joined("ch", "loe"),
  commonE: joined("a", "my"),
  surname: joined("lle", "wellyn"),
  legacyA: joined("a", "ga"),
  legacyB: joined("pe", "te"),
  legacyC: joined("to", "ny"),
  legacyD: joined("vi", "to"),
  legacySurnameA: joined("ber", "anek"),
  legacySurnameB: joined("maz", "zarino"),
  legacySurnameC: joined("zej", "den"),
  legacySurnameD: joined("mar", "ques"),
  coordinateA: joined("29", ".491"),
  coordinateB: joined("153", ".231"),
  coordinateC: joined("153", ".12"),
  coordinateD: joined("29", ".47"),
  postcode: joined("24", "63"),
  attributionName: joined("ben", "ji"),
  hostAlias: joined("x", "1"),
};
const fixturePatterns = [
  ["private fixture token 1", new RegExp(`\\b${escaped(fixtureTerms.firstA)}\\b`, "i")],
  ["private fixture token 2", new RegExp(`\\b${escaped(fixtureTerms.firstB)}\\b`, "i")],
  ["private fixture token 3", new RegExp(`\\b${escaped(fixtureTerms.firstC)}\\b`, "i")],
  ["private fixture token 4", new RegExp(`\\b${escaped(fixtureTerms.firstD)}\\b`, "i")],
  ["private place token 1", new RegExp(`\\b${escaped(fixtureTerms.placeA)}\\b`, "i")],
  [
    "private place token 2",
    new RegExp(`\\b${escaped(fixtureTerms.placeB)}[\\s_-]*${escaped(fixtureTerms.house)}\\b`, "i"),
  ],
  [
    "private place identifier",
    new RegExp(`\\bplace[-_:]${escaped(fixtureTerms.placeB)}\\b`, "i"),
  ],
  [
    "private place token 3",
    new RegExp(`\\b${escaped(fixtureTerms.parent)}(?:['’]s)?[\\s_-]+(?:${escaped(fixtureTerms.home)}|${escaped(fixtureTerms.house)})\\b`, "i"),
  ],
  [
    "private address token",
    new RegExp(`\\b${escaped(fixtureTerms.streetA)}[\\s_-]+${escaped(fixtureTerms.streetB)}\\b`, "i"),
  ],
  [
    "private full-name token",
    new RegExp(`\\b${escaped(fixtureTerms.commonA)}[\\s_-]+${escaped(fixtureTerms.surname)}\\b`, "i"),
  ],
  [
    "private fixture identifier",
    new RegExp(
      `\\b(?:person|source)[-_:](?:${[fixtureTerms.commonA, fixtureTerms.commonB, fixtureTerms.commonC, fixtureTerms.commonD, fixtureTerms.commonE].map(escaped).join("|")})\\b`,
      "i",
    ),
  ],
  [
    "private fixture display name",
    new RegExp(
      `\\b(?:displayName|personName|targetName)\\s*:\\s*["'](?:${[fixtureTerms.commonA, fixtureTerms.commonB, fixtureTerms.commonC, fixtureTerms.commonD].map(escaped).join("|")})["']`,
      "i",
    ),
  ],
  [
    "private legacy fixture identifier",
    new RegExp(
      `\\b(?:person|source|face)[-_:](?:${[fixtureTerms.legacyA, fixtureTerms.legacyB, fixtureTerms.legacyC, fixtureTerms.legacyD].map(escaped).join("|")})\\b`,
      "i",
    ),
  ],
  [
    "private legacy fixture name",
    new RegExp(
      `\\b(?:${[fixtureTerms.legacySurnameA, fixtureTerms.legacySurnameB, fixtureTerms.legacySurnameC, fixtureTerms.legacySurnameD].map(escaped).join("|")})\\b`,
      "i",
    ),
  ],
  [
    "private legacy fixture display",
    new RegExp(
      `\\b(?:displayName|personName|targetName|display_name)\\s*:\\s*["'](?:${[fixtureTerms.legacyA, fixtureTerms.legacyB, fixtureTerms.legacyC, fixtureTerms.legacyD].map(escaped).join("|")})["']`,
      "i",
    ),
  ],
  [
    "private coordinate fixture",
    new RegExp(
      `(?:${[fixtureTerms.coordinateA, fixtureTerms.coordinateB, fixtureTerms.coordinateC, fixtureTerms.coordinateD].map(escaped).join("|")})`,
    ),
  ],
  [
    "private postcode fixture",
    new RegExp(`\\bpostcode\\s*:\\s*["']${escaped(fixtureTerms.postcode)}["']`, "i"),
  ],
  [
    "private person identifier",
    new RegExp(`\\b(?:person|face)[_-]${escaped(fixtureTerms.attributionName)}\\b`, "i"),
  ],
  [
    "private pipeline identifier",
    new RegExp(`\\bapple[-_.]vision[-_.]${escaped(fixtureTerms.attributionName)}\\b`, "i"),
  ],
  [
    "private host alias",
    new RegExp(
      `(?:\\b${escaped(fixtureTerms.hostAlias)}(?:['’]s)?\\b.{0,40}\\b(?:Radeon|archive|data|profile|container|integration|CPU|database)\\b|\\b(?:private|native|reference)\\s+${escaped(fixtureTerms.hostAlias)}\\b)`,
      "i",
    ),
  ],
];
const fixtureCanaries = [
  `${fixtureTerms.firstA} example`,
  `${fixtureTerms.firstB} example`,
  `${fixtureTerms.firstC} example`,
  `${fixtureTerms.firstD} example`,
  `${fixtureTerms.placeA} example`,
  `${fixtureTerms.placeB} ${fixtureTerms.house}`,
  `place-${fixtureTerms.placeB}`,
  `${fixtureTerms.parent}'s ${fixtureTerms.home}`,
  `${fixtureTerms.streetA} ${fixtureTerms.streetB}`,
  `${fixtureTerms.commonA} ${fixtureTerms.surname}`,
  `person-${fixtureTerms.commonB}`,
  `person-${fixtureTerms.commonC}`,
  `person-${fixtureTerms.commonE}`,
  `displayName: '${fixtureTerms.commonA}'`,
  `personName: '${fixtureTerms.commonD}'`,
  `person-${fixtureTerms.legacyA}`,
  fixtureTerms.legacySurnameB,
  `display_name: '${fixtureTerms.legacyB}'`,
  fixtureTerms.coordinateB,
  `postcode: '${fixtureTerms.postcode}'`,
  `person_${fixtureTerms.attributionName}`,
  `apple-vision-${fixtureTerms.attributionName}`,
  `${fixtureTerms.hostAlias}'s Radeon`,
];
for (const canary of fixtureCanaries) {
  if (!fixturePatterns.some(([, pattern]) => pattern.test(canary))) {
    console.error("publication scanner self-test failed: private fixture canary");
    process.exit(2);
  }
}
if (fixturePatterns.some(([, pattern]) => pattern.test("Maya and Alex at Cedar House in Willow"))) process.exit(2);
const files = execFileSync("git", ["-C", root, "ls-files", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
let found = false;
for (const relative of files) {
  const bytes = readFileSync(path.join(root, relative));
  const text = `${relative}\n${bytes.toString("utf8")}`;
  for (const [label, pattern] of fixturePatterns) {
    if (pattern.test(text)) {
      console.error(`${relative}: ${label}`);
      found = true;
    }
  }
  const words = text
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const width of [2, 3, 4]) {
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

if (
  cd "$ROOT"
  rg -n -P --hidden \
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
    .
); then
  fail "credential-shaped material remains"
fi

printf '{"candidate":"public","scan":"passed","trackedFiles":%s}\n' \
  "$(git -C "$ROOT" ls-files | wc -l | tr -d ' ')"
