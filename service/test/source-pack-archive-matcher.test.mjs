import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("archive matcher types interpolated JSON and digest values explicitly", async () => {
  const source = await readFile(
    new URL("../bin/run-source-pack-archive-matcher.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /\$\{pack\.pack_id\}::text/);
  assert.match(source, /\$\{pack\.policy_version\}::text/);
  assert.match(
    source,
    /'policy_version', \$\{pack\.policy_version\}::text/,
  );
  assert.match(source, /'source_pack_id', \$\{pack\.pack_id\}::text/);
});
