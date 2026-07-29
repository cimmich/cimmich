import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("optional derivative provider cannot make the service boot fatal", async () => {
  const source = await readFile(
    new URL("../src/index.mjs", import.meta.url),
    "utf8",
  );
  const creation = source.slice(
    source.indexOf("const derivativeProvider"),
    source.indexOf("const hashLinkedAssetResolver"),
  );
  // A missing or malformed provider manifest logs and degrades the identity
  // audit's independence checks; it never refuses the whole service boot.
  assert.match(creation, /try \{/);
  assert.match(creation, /\} catch \(error\) \{/);
  assert.match(creation, /console\.warn/);
  assert.match(creation, /return null;/);
  assert.match(creation, /JSON\.parse/);
});
