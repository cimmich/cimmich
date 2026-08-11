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
    "!providers/insightface-user-supplied/*.py",
    "!providers/insightface-user-supplied/*.json",
    "!providers/insightface-user-supplied/requirements.txt",
    "!providers/perceptual-dhash/*.py",
    "!providers/perceptual-dhash/*.json",
    "!providers/perceptual-dhash/requirements.txt",
    "!providers/ultralytics-yolo-body/*.py",
    "!tools/local-ai-photo-lab/bin/**",
    "!tools/local-ai-photo-lab/src/**",
    "!tools/local-ai-photo-lab/python/**",
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
  assert.match(dockerfile, /COPY providers\/perceptual-dhash/);
  assert.match(dockerfile, /COPY service\/enhanced \.\/enhanced/);
  assert.match(ignore, /^\*\*$/m);
  assert.ok(ignore.split("\n").includes("!providers/opencv-sface/*.py"));
  assert.ok(ignore.split("\n").includes("!providers/perceptual-dhash/*.py"));
  assert.ok(ignore.split("\n").includes("!service/enhanced/**"));
  assert.ok(
    ignore.split("\n").includes("!providers/ultralytics-yolo-body/*.py"),
  );
  assert.ok(ignore.split("\n").includes("!tools/local-ai-photo-lab/bin/**"));
  assert.ok(ignore.split("\n").includes("!tools/local-ai-photo-lab/src/**"));
  assert.ok(ignore.split("\n").includes("!tools/local-ai-photo-lab/python/**"));
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

test("companion UI dependency installation is cached ahead of ordinary source", async () => {
  const dockerfile = await readFile(
    new URL("../../tools/cimmich_ui.Dockerfile", import.meta.url),
    "utf8",
  );
  const metadata = dockerfile.indexOf("COPY ui/web/package.json");
  const install = dockerfile.indexOf(
    "pnpm --filter @immich/sdk --filter immich-web install",
  );
  const source = dockerfile.indexOf("COPY ui/web ./web");
  assert.ok(metadata >= 0);
  assert.ok(metadata < install);
  assert.ok(install < source);
});
