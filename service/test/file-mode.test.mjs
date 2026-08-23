import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const helper = path.join(root, "tools/file_mode.sh");

test("reports an owner-only mode with the host stat implementation", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "cimmich-file-mode-"));
  try {
    const target = path.join(scratch, "secret");
    await writeFile(target, "secret\n", { mode: 0o600 });
    await chmod(target, 0o600);

    const { stdout } = await execFileAsync(helper, [target]);
    assert.equal(stdout, "600\n");
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
});

test("discards stdout from a failed stat dialect before using the fallback", async () => {
  const scratch = await mkdtemp(
    path.join(tmpdir(), "cimmich-file-mode-fallback-"),
  );
  try {
    const fakeBin = path.join(scratch, "bin");
    const fakeStat = path.join(fakeBin, "stat");
    const target = path.join(scratch, "secret");
    await mkdir(fakeBin);
    await writeFile(target, "secret\n", { mode: 0o600 });
    await writeFile(
      fakeStat,
      `#!/usr/bin/env sh
case "$1" in
  -c) printf 'filesystem status noise\\n'; exit 1 ;;
  -f) printf '600\\n'; exit 0 ;;
  *) exit 2 ;;
esac
`,
      { mode: 0o755 },
    );
    await chmod(fakeStat, 0o755);

    const { stdout } = await execFileAsync(helper, [target], {
      env: { ...process.env, PATH: `${fakeBin}:/usr/bin:/bin` },
    });
    assert.equal(stdout, "600\n");
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
});
