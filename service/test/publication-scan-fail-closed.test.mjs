import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scanner = new URL("../../tools/run_publication_scan.sh", import.meta.url);

test("publication scan fails closed when ripgrep cannot scan", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cimmich-rg-failure-"));
  const rg = path.join(directory, "rg");
  await writeFile(rg, "#!/bin/sh\nexit 2\n", "utf8");
  await chmod(rg, 0o755);

  try {
    const result = spawnSync("sh", [scanner.pathname], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ripgrep exited with status 2/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
