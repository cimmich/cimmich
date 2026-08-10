import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("CI enforces measured coverage on critical Cimmich browser paths", async () => {
  const [workflow, config] = await Promise.all([
    readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
    readFile(new URL("ui/web/vite.config.ts", root), "utf8"),
  ]);

  assert.match(workflow, /run: pnpm run test:cov -- --run/u);
  assert.doesNotMatch(
    workflow,
    /Run web tests[\s\S]{0,120}run: pnpm run test -- --run/u,
  );
  assert.match(
    config,
    /include: Object\.keys\(criticalCimmichCoverageThresholds\)/u,
  );
  assert.match(config, /cimmich-undo-receipt-context\.svelte\.ts/u);
  assert.match(config, /persisted-undo-receipt\.ts/u);
  assert.match(config, /cimmich-visibility-manager\.svelte\.ts/u);
  assert.match(config, /person-workspace-cache\.ts/u);
  assert.match(config, /photo-viewer-presentation\.ts/u);
  assert.doesNotMatch(config, /autoUpdate:\s*true/u);
});
