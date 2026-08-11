import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("CI measures the Cimmich Web surface and enforces higher critical-path floors", async () => {
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
    /src\/lib\/components\/cimmich\/\*\*\/\*\.\{ts,svelte\.ts\}/u,
  );
  assert.match(config, /src\/lib\/services\/cimmich\*\.ts/u);
  assert.match(config, /branches: 45/u);
  assert.match(config, /functions: 55/u);
  assert.match(config, /lines: 60/u);
  assert.match(config, /\.\.\.criticalCimmichCoverageThresholds/u);
  assert.match(config, /cimmich-undo-receipt-context\.svelte\.ts/u);
  assert.match(config, /persisted-undo-receipt\.ts/u);
  assert.match(config, /cimmich-visibility-manager\.svelte\.ts/u);
  assert.match(config, /person-workspace-cache\.ts/u);
  assert.match(config, /photo-viewer-presentation\.ts/u);
  assert.doesNotMatch(config, /autoUpdate:\s*true/u);
});
