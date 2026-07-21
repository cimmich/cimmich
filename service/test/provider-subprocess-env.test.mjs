import assert from "node:assert/strict";
import test from "node:test";
import { providerSubprocessEnvironment } from "../src/provider-subprocess-env.mjs";

test("provider subprocesses inherit only the bounded runtime allowlist", () => {
  const child = providerSubprocessEnvironment({
    DATABASE_URL: "secret-database-url",
    IMMICH_API_KEY: "secret-api-key",
    LANG: "en_AU.UTF-8",
    PATH: "/usr/local/bin:/usr/bin",
    TMPDIR: "/tmp/provider",
  });
  assert.deepEqual(child, {
    LANG: "en_AU.UTF-8",
    PATH: "/usr/local/bin:/usr/bin",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
    TMPDIR: "/tmp/provider",
  });
  assert.equal("DATABASE_URL" in child, false);
  assert.equal("IMMICH_API_KEY" in child, false);
});
