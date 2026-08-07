#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const newFileLineLimit = 1_000;

// Temporary ceilings for oversized Community Preview files. A file may shrink
// below its ceiling but may not grow. Reduce the corresponding ceiling whenever
// a domain is extracted, and do not add new entries.
const legacyCeilings = new Map([
  ["service/src/repository.mjs", 10_318],
  ["ui/web/src/lib/components/cimmich/CimmichPhotoOverlay.svelte", 7_344],
  ["ui/web/src/lib/components/cimmich/CimmichContextBrowser.svelte", 6_511],
  ["ui/web/src/routes/(user)/cimmich/people/[personName]/+page.svelte", 5_898],
  ["service/src/context-entities.mjs", 4_484],
  ["ui/web/src/lib/services/cimmich.service.ts", 4_370],
  ["service/src/server.mjs", 3_935],
  ["ui/web/src/routes/(user)/cimmich/pets/+page.svelte", 3_066],
  ["ui/web/src/lib/services/cimmich-evidence.service.ts", 2_614],
  ["service/src/guided-route-catalog.mjs", 2_575],
  ["ui/web/src/lib/components/cimmich/CimmichPersonDetails.svelte", 2_513],
  ["service/src/immich-onboarding.mjs", 2_384],
  ["service/src/visual-candidate-set.mjs", 2_221],
  ["service/src/visibility.mjs", 1_680],
  ["ui/web/src/lib/components/cimmich/CimmichPlacePlan.svelte", 1_676],
  ["service/src/identity-audit.mjs", 1_644],
  ["service/src/manual-subject-tag.mjs", 1_610],
  ["ui/web/src/lib/components/cimmich/CimmichDocuments.svelte", 1_572],
  ["service/src/documents.mjs", 1_496],
  ["service/src/immich-inventory.mjs", 1_485],
  ["ui/web/src/lib/components/cimmich/CimmichContextCollection.svelte", 1_275],
  ["service/src/body-continuity-contract.mjs", 1_193],
  ["service/src/manual-photo-context.mjs", 1_178],
  ["service/src/face-matching-operator.mjs", 1_159],
  ["service/src/pet-matching.mjs", 1_122],
  ["service/src/immich-companion.mjs", 1_087],
  ["ui/web/src/lib/components/cimmich/CimmichBulkPhotoSorter.svelte", 1_084],
  ["service/src/matching-qc-cohort.mjs", 1_072],
  ["ui/web/src/lib/components/shared-components/map/Map.svelte", 1_033],
  ["ui/web/src/lib/components/cimmich/CimmichGpsPlaceDiscovery.svelte", 1_033],
  ["ui/web/src/lib/components/cimmich/CimmichEntityMediaActions.svelte", 1_028],
  ["service/src/person-profile.mjs", 1_027],
]);

const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const isProductionSource = (relative) => {
  if (!/\.(mjs|svelte|ts)$/.test(relative)) return false;
  if (!/^(service\/(src|bin)|ui\/web\/src)\//.test(relative)) return false;
  return !/(^|\/)(__mocks__|test-data)(\/|$)|\.(spec|test)\./.test(relative);
};

const failures = [];
let checked = 0;
for (const relative of tracked.filter(isProductionSource)) {
  const text = readFileSync(path.join(root, relative), "utf8");
  const lines = (text.match(/\n/g) ?? []).length;
  const limit = legacyCeilings.get(relative) ?? newFileLineLimit;
  checked += 1;
  if (lines > limit)
    failures.push(`${relative}: ${lines} lines exceeds ${limit}`);
}

if (failures.length > 0) {
  console.error("Cimmich source-shape check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    "Extract a coherent module and lower an existing ceiling; do not add a new exception.",
  );
  process.exit(1);
}

console.log(
  JSON.stringify({
    checkedFiles: checked,
    legacyCeilings: legacyCeilings.size,
    newFileLineLimit,
    state: "passed",
  }),
);
