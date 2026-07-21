import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("service Dockerfile build context is an explicit backend allowlist", async () => {
  const ignore = await readFile(
    new URL("../Dockerfile.dockerignore", import.meta.url),
    "utf8",
  );
  assert.match(ignore, /^\*\*$/m);
  for (const required of [
    "!migrations/**",
    "!service/package.json",
    "!service/package-lock.json",
    "!service/src/**",
    "!service/bin/**",
    "!service/enhanced/**",
    "!service/test/**",
    "!service/acceptance/**",
    "!providers/opencv-sface/*.py",
    "!providers/opencv-sface/*.json",
    "!providers/opencv-sface/requirements.txt",
    "!providers/opencv-sface/install-models.sh",
  ]) {
    assert.ok(ignore.split("\n").includes(required), required);
  }
  assert.doesNotMatch(ignore, /!ui\//);
  assert.doesNotMatch(ignore, /\.onnx/);
  assert.doesNotMatch(ignore, /!.*\.env/);
  assert.doesNotMatch(ignore, /!.*private/i);
});

test("public-demo API build context admits the reference adapter but no weights or private state", async () => {
  const [dockerfile, ignore] = await Promise.all([
    readFile(
      new URL("../../tools/public_demo_api.Dockerfile", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../tools/public_demo_api.Dockerfile.dockerignore",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    dockerfile,
    /opencv-python-headless|cimmich-opencv-requirements/,
  );
  assert.match(dockerfile, /COPY providers\/opencv-sface/);
  assert.match(dockerfile, /COPY service\/enhanced \.\/enhanced/);
  assert.match(ignore, /^\*\*$/m);
  assert.ok(ignore.split("\n").includes("!providers/opencv-sface/*.py"));
  assert.ok(ignore.split("\n").includes("!service/enhanced/**"));
  assert.ok(
    ignore.split("\n").includes("!providers/opencv-sface/install-models.sh"),
  );
  assert.doesNotMatch(ignore, /\.onnx/);
  assert.doesNotMatch(ignore, /!.*\.env/);
  assert.doesNotMatch(ignore, /!.*private/i);
});

test("public-demo UI clean builds its local SDK through an explicit allowlist", async () => {
  const [dockerfile, ignore] = await Promise.all([
    readFile(
      new URL("../../tools/public_demo_ui.Dockerfile", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../tools/public_demo_ui.Dockerfile.dockerignore",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    dockerfile,
    /pnpm --filter @immich\/sdk --filter immich-web install/,
  );
  assert.match(dockerfile, /pnpm --filter @immich\/sdk build/);
  assert.match(dockerfile, /node_modules\/@immich/);
  assert.match(ignore, /^\*\*$/m);
  assert.ok(ignore.split("\n").includes("!ui/packages/sdk/**"));
  assert.doesNotMatch(ignore, /!.*\.env/);
  assert.doesNotMatch(ignore, /!.*private/i);
});
