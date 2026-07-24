import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const installer = join(root, "tools/install.sh");
const companion = join(root, "tools/companion.sh");
const bundleBuilder = join(root, "tools/build_install_bundle.sh");

test("guided installer has a non-mutating help surface and valid portable shell", () => {
  for (const path of [installer, companion, bundleBuilder]) {
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
  assert.match(help.stdout, /agent-assisted installation.*AGENT_INSTALL\.md/i);

  const unsupported = spawnSync(installer, ["--secret=value"], {
    encoding: "utf8",
  });
  assert.notEqual(unsupported.status, 0);
  assert.doesNotMatch(unsupported.stderr, /secret=value/);
});

test("guided install stops at signed-in preview and documentation separates both audiences", async () => {
  const [
    script,
    companionScript,
    compose,
    install,
    readme,
    publicDemoScript,
    bundleScript,
    agentInstall,
  ] =
    await Promise.all([
      readFile(installer, "utf8"),
      readFile(companion, "utf8"),
      readFile(join(root, "tools/companion.compose.yml"), "utf8"),
      readFile(join(root, "INSTALL.md"), "utf8"),
      readFile(join(root, "README.md"), "utf8"),
      readFile(join(root, "tools/public_demo.sh"), "utf8"),
      readFile(bundleBuilder, "utf8"),
      readFile(join(root, "AGENT_INSTALL.md"), "utf8"),
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

  assert.match(install, /Guided install \(recommended\)/);
  assert.match(install, /agent installation contract/);
  assert.match(install, /Advanced install/);
  assert.match(install, /Download Cimmich/);
  assert.match(install, /named `cimmich-<version>\.tar\.gz` install bundle/);
  assert.match(install, /currently supports \*\*macOS and Linux\*\*/);
  assert.match(install, /Create a dedicated Immich API key/);
  assert.match(install, /Do not import if the account, server or preview is unexpected/);
  assert.match(install, /Updating Cimmich/);
  assert.match(
    install,
    /companion\.sh backup \/safe\/new\/cimmich-backup[\s\S]*install\.sh --check/,
  );
  assert.match(install, /Docker Desktop or another remote Docker engine may store images elsewhere/);
  assert.match(agentInstall, /never ask for an API key, password or token in chat/i);
  assert.match(agentInstall, /never use `sudo`/);
  assert.match(
    install,
    /does not create containers, configuration or database state/,
  );
  assert.match(install, /write-only API-key field/);
  assert.match(readme, /\[Install Cimmich\]\(INSTALL\.md\)/);
  assert.match(readme, /## Start here/);
  assert.match(readme, /Ask an AI assistant to install and set up Cimmich/);
  assert.match(readme, /Add Cimmich beside my existing Immich library/);
  assert.match(
    readme,
    /does not ask for an API key or import anything before the\s+signed-in preview/,
  );
  assert.match(script, /Cimmich install check/);
  assert.match(script, /This computer is ready for the guided install/);
  assert.match(script, /Continue\? Enter y or n/);
  assert.match(script, /API, database and web interface are healthy/);
  assert.match(script, /cimmich\.agent-install-handoff\.v1/);
  assert.match(script, /"nextAction":"signed_in_setup"/);
  assert.match(
    script,
    /installation_ui_port[\s\S]*CIMMICH_COMPANION_UI_PORT[\s\S]*runtime\.env/,
  );
  assert.match(script, /Checking that Docker can reach Immich/);
  assert.match(script, /No Cimmich state was created/);
  assert.match(script, /command -v lsof/);
  assert.match(script, /command -v ss/);
  assert.match(script, /"installer":"blocked"[\s\S]*"portIssues"/);
  assert.match(script, /Docker storage may be elsewhere/);
  assert.match(
    compose,
    /environment:\s+PUBLIC_CIMMICH_API_URL: http:\/\/127\.0\.0\.1:\$\{CIMMICH_COMPANION_API_PORT:-3411\}/,
  );
  assert.match(
    compose,
    /cimmich-storage-init:[\s\S]*chown -R 1000:1000 \/config \/documents[\s\S]*network_mode: none/,
  );
  assert.match(
    compose,
    /cimmich-storage-init:\s+condition: service_completed_successfully/,
  );
  assert.match(
    compose,
    /cimmich-face-provider-init:[\s\S]*install-models\.sh[\s\S]*cimmich-face-provider:\/face-provider/,
  );
  assert.match(companionScript, /face-provider install-recommended/);
  assert.match(companionScript, /CIMMICH_LOCAL_MEDIA_PROVIDER=opencv-yunet-sface-cpu/);
  assert.match(install, /Optional local Face recognition/);
  assert.match(install, /face-provider install-recommended/);
  assert.match(install, /checksum-pinned OpenCV YuNet and SFace/);
  assert.match(
    script,
    /complete_private_password_after_resume[\s\S]*print_install_success/,
  );
  assert.match(script, /\*'"configured":true'\*\) return 0/);
  assert.match(bundleScript, /git ls-files -z/);
  assert.match(bundleScript, /cimmich-\$version\.tar\.gz/);
  assert.match(bundleScript, /cimmich-\$version\.zip/);
  assert.match(bundleScript, /SHA256SUMS/);
  assert.doesNotMatch(bundleScript, /tar .*["']?\$ROOT["']? \./);
  assert.match(agentInstall, /approve that\s+exact scope/);
  assert.match(agentInstall, /Guided V2 starts after Cimmich is running/);
  assert.match(
    agentInstall,
    /no model, Enhanced component or SourcePack became active/,
  );
});
