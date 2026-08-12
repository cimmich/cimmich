import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("CI executes the six browser journeys against a disposable fictional demo", async () => {
  const [workflow, runner, browserSpec] = await Promise.all([
    readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
    readFile(new URL("tools/run_browser_acceptance.sh", root), "utf8"),
    readFile(
      new URL("ui/web/tests/browser/community-preview.spec.ts", root),
      "utf8",
    ),
  ]);

  assert.match(workflow, /browser-journeys:\n\s+name: Browser journeys/u);
  assert.match(workflow, /pnpm exec playwright install --with-deps chromium/u);
  assert.match(
    workflow,
    /937b5859635af6f1b775dcbab1e28411b2e6f4a6182b72e003e3ccdda455347f/u,
  );
  assert.match(
    workflow,
    /tools\/public_demo\.sh up\n\s+tools\/run_browser_acceptance\.sh/u,
  );
  assert.match(
    workflow,
    /if: always\(\)[\s\S]+tools\/public_demo\.sh destroy/u,
  );
  assert.doesNotMatch(workflow, /playwright test --list/u);
  assert.match(runner, /cd "\$ROOT\/ui"/u);
  assert.match(runner, /pnpm --dir web run test:browser/u);
  assert.equal(browserSpec.match(/^test\('/gmu)?.length, 6);
});
