import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const installer = join(root, "tools/install.sh");
const companion = join(root, "tools/companion.sh");

test("guided installer has a non-mutating help surface and valid portable shell", () => {
  for (const path of [installer, companion]) {
    const syntax = spawnSync("sh", ["-n", path], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
  }

  const help = spawnSync(installer, ["--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /does not ask for the Immich API key/i);
  assert.match(
    help.stdout,
    /never writes the Immich\s+database or source media/i,
  );
  assert.match(help.stdout, /--status Read the health/);
  assert.match(help.stdout, /--resume Build\/start/);

  const unsupported = spawnSync(installer, ["--secret=value"], {
    encoding: "utf8",
  });
  assert.notEqual(unsupported.status, 0);
  assert.doesNotMatch(unsupported.stderr, /secret=value/);
});

test("guided install stops at signed-in preview and documentation separates both audiences", async () => {
  const [script, companionScript, compose, install, readme, publicDemoScript] =
    await Promise.all([
      readFile(installer, "utf8"),
      readFile(companion, "utf8"),
      readFile(join(root, "tools/companion.compose.yml"), "utf8"),
      readFile(join(root, "INSTALL.md"), "utf8"),
      readFile(join(root, "README.md"), "utf8"),
      readFile(join(root, "tools/public_demo.sh"), "utf8"),
    ]);

  assert.doesNotMatch(script, /["']?\$COMPANION["']? sync/);
  assert.doesNotMatch(script, /API key.*read_secret/i);
  assert.match(script, /Preview the proposed scope before importing anything/);
  assert.match(script, /Cimmich Core works without a model/);
  assert.match(
    compose,
    /CIMMICH_MEDIA_JOB_CONFIG_DIGEST: "0{64}"/,
    "YAML must not coerce the canonical zero digest into a numeric zero",
  );
  assert.match(companionScript, /compose build cimmich-api/);
  assert.match(companionScript, /compose build cimmich-ui/);
  assert.doesNotMatch(companionScript, /compose build --no-deps/);
  const providerInstall = publicDemoScript.match(
    /install_face_provider\(\) \{(?<body>[\s\S]*?)\n\}/,
  )?.groups?.body;
  assert.ok(providerInstall);
  assert.doesNotMatch(
    providerInstall,
    /immich-credential|refresh_immich_companion/,
  );

  assert.match(install, /Option 1 — guided install/);
  assert.match(install, /Option 2 — advanced install/);
  assert.match(
    install,
    /Never ask me to paste an API key, password or token into/,
  );
  assert.match(install, /> chat; never put secrets/);
  assert.match(install, /never use `sudo`/);
  assert.match(
    install,
    /does not create containers, configuration or database state/,
  );
  assert.match(install, /write-only API-key field/);
  assert.match(readme, /\[Install Cimmich\]\(INSTALL\.md\)/);
  assert.match(
    readme,
    /does not ask for an API key or import anything before the\s+signed-in preview/,
  );
});
