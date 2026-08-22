import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const acceptance = new URL(
  "../../tools/run_synthetic_acceptance.sh",
  import.meta.url,
);

test("full synthetic acceptance isolates concurrent disposable runs", async () => {
  const source = await readFile(acceptance, "utf8");

  assert.match(source, /RUN_ID=\$\$/);
  assert.match(source, /cimmich-pg-acceptance-\$RUN_ID/);
  assert.match(source, /cimmich-service-acceptance-\$RUN_ID/);
  assert.match(source, /-p 127\.0\.0\.1::5432/);
  assert.match(source, /docker port "\$CONTAINER" 5432\/tcp/);
  assert.match(source, /127\.0\.0\.1:\$HOST_PORT\/cimmich_test/);
  assert.match(source, /-e CIMMICH_RUNTIME_MODE=acceptance/);
  assert.match(source, /-e CIMMICH_OWNER_GATEWAY_REQUIRED=false/);
  assert.match(source, /docker rm -fv "\$CONTAINER"/);
  assert.match(source, /docker image rm "\$SERVICE_IMAGE"/);
  assert.doesNotMatch(source, /127\.0\.0\.1:55432/);
});

test("full synthetic acceptance applies relative privacy-scan exclusions", async () => {
  const source = await readFile(acceptance, "utf8");
  const scanStart = source.indexOf('(\n  cd "$ROOT"\n  reject_rg_matches');
  const scanEnd = source.indexOf("\n)\n", scanStart);

  assert.notEqual(scanStart, -1);
  assert.notEqual(scanEnd, -1);
  const scan = source.slice(scanStart, scanEnd);
  assert.match(scan, /reject_rg_matches "privacy leakage scan failed"/);
  assert.match(scan, /--glob '!tools\/run_synthetic_acceptance\.sh'/);
  assert.match(scan, /--glob '!tools\/run_publication_scan\.sh'/);
  assert.match(scan, /\n    \.$/);
  assert.doesNotMatch(scan, /\\\n    "\$ROOT"$/);
});

test("full synthetic acceptance treats ripgrep errors as failures", async () => {
  const source = await readFile(acceptance, "utf8");

  assert.match(source, /reject_rg_matches\(\)/);
  assert.match(source, /"\$@" \|\| scan_status=\$\?/);
  assert.match(source, /1\) ;;/);
  assert.match(source, /ripgrep exited with status \$scan_status/);
});
