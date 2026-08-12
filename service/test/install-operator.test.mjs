import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const installer = join(root, "tools/install.sh");
const companion = join(root, "tools/companion.sh");
const bundleBuilder = join(root, "tools/build_install_bundle.sh");
const checksum = join(root, "tools/sha256.sh");
const sourceShape = join(root, "tools/check_source_shape.mjs");

test("source-shape debt is explicit and cannot grow", () => {
  const result = spawnSync(process.execPath, [sourceShape], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.state, "passed");
  assert.equal(receipt.newFileLineLimit, 1000);
  assert.ok(receipt.legacyCeilings > 0);
});

test("repository presents a conventional install and excludes dependency output", async () => {
  const [readme, development, environment, sdkManifest] = await Promise.all([
    readFile(join(root, "README.md"), "utf8"),
    readFile(join(root, "DEVELOPMENT.md"), "utf8"),
    readFile(join(root, ".env.example"), "utf8"),
    readFile(join(root, "ui/packages/sdk/package.json"), "utf8"),
  ]);
  const tracked = spawnSync("git", ["-C", root, "ls-files"], {
    encoding: "utf8",
  });
  assert.equal(tracked.status, 0, tracked.stderr);
  assert.doesNotMatch(tracked.stdout, /(^|\/)node_modules\//m);
  assert.match(development, /two deliberate JavaScript workspaces/i);
  assert.match(
    development,
    /`ui\/packages\/sdk` is \*\*not `node_modules`\*\*/,
  );
  assert.equal(JSON.parse(sdkManifest).name, "@immich/sdk");
  assert.ok(
    readme.indexOf("## Install beside Immich") <
      readme.indexOf("## Develop and contribute"),
  );
  assert.match(environment, /^CIMMICH_DB_PASSWORD=$/m);
  assert.doesNotMatch(environment, /^IMMICH_API_KEY=/m);
  assert.match(environment, /docker compose up --detach --build --wait/);
  assert.doesNotMatch(environment, /ghcr\.io\/cimmich/);
});

test("guided installer has a non-mutating help surface and valid portable shell", () => {
  for (const path of [installer, companion, bundleBuilder, checksum]) {
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

test("checksum operator generates and verifies with shasum-only PATH", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "cimmich-shasum-test-"));
  try {
    const isolatedBin = join(temporaryRoot, "bin");
    const payloadRoot = join(temporaryRoot, "payload");
    await mkdir(isolatedBin);
    await mkdir(payloadRoot);
    const shasumPath = spawnSync("sh", ["-c", "command -v shasum"], {
      encoding: "utf8",
    }).stdout.trim();
    assert.ok(shasumPath, "shasum is required for the portability test");
    await symlink("/bin/sh", join(isolatedBin, "sh"));
    await symlink(shasumPath, join(isolatedBin, "shasum"));
    await writeFile(join(payloadRoot, "one.txt"), "portable checksum\n");

    const environment = { ...process.env, PATH: isolatedBin };
    const check = spawnSync(checksum, ["check"], {
      encoding: "utf8",
      env: environment,
    });
    assert.equal(check.status, 0, check.stderr);
    assert.equal(check.stdout.trim(), "shasum");

    const generated = spawnSync(checksum, ["generate", "one.txt"], {
      cwd: payloadRoot,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(generated.status, 0, generated.stderr);
    assert.match(generated.stdout, /^[0-9a-f]{64}  one\.txt\n$/u);
    await writeFile(join(payloadRoot, "SHA256SUMS"), generated.stdout);

    const verified = spawnSync(checksum, ["verify", "SHA256SUMS"], {
      cwd: payloadRoot,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /one\.txt: OK/u);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("advanced startup rejects an unsupported Immich before any Compose or migration path", async () => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "cimmich-version-preflight-"),
  );
  try {
    const stateRoot = join(temporaryRoot, "state");
    const dockerLog = join(temporaryRoot, "docker.log");
    const fakeDocker = join(temporaryRoot, "docker");
    await writeFile(
      fakeDocker,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CIMMICH_FAKE_DOCKER_LOG"
if test "$1" = run; then
  printf '{"major":3,"minor":2,"patch":0,"prerelease":null}\\n'
  exit 0
fi
exit 97
`,
      { mode: 0o755 },
    );
    await mkdir(stateRoot);
    const runtime =
      "CIMMICH_IMMICH_API_URL=http://host.docker.internal:2283/api\n";
    await writeFile(join(stateRoot, "runtime.env"), runtime, { mode: 0o600 });

    const result = spawnSync(companion, ["up"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CIMMICH_COMPANION_PROJECT: "cimmich-version-preflight-test",
        CIMMICH_COMPANION_STATE_ROOT: stateRoot,
        CIMMICH_FAKE_DOCKER_LOG: dockerLog,
        PATH: `${temporaryRoot}:${process.env.PATH}`,
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /IMMICH_COMPANION_VERSION_UNSUPPORTED/);
    assert.match(result.stderr, /No Cimmich migration or import was started/);
    assert.doesNotMatch(await readFile(dockerLog, "utf8"), /compose/);
    assert.equal(
      await readFile(join(stateRoot, "runtime.env"), "utf8"),
      runtime,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
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
    checksumScript,
    agentInstall,
    gateway,
    version,
  ] = await Promise.all([
    readFile(installer, "utf8"),
    readFile(companion, "utf8"),
    readFile(join(root, "compose.yaml"), "utf8"),
    readFile(join(root, "INSTALL.md"), "utf8"),
    readFile(join(root, "README.md"), "utf8"),
    readFile(join(root, "tools/public_demo.sh"), "utf8"),
    readFile(bundleBuilder, "utf8"),
    readFile(checksum, "utf8"),
    readFile(join(root, "AGENT_INSTALL.md"), "utf8"),
    readFile(join(root, "tools/cimmich_gateway.conf.template"), "utf8"),
    readFile(join(root, "CIMMICH_VERSION"), "utf8"),
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
  assert.match(
    compose,
    /CIMMICH_IMMICH_SOURCE_ID: \$\{CIMMICH_IMMICH_SOURCE_ID:-immich-primary\}/,
  );
  assert.match(
    companionScript,
    /source_id=\$\(configured_value CIMMICH_IMMICH_SOURCE_ID\)[\s\S]*--source-id=\$source_id/,
  );
  assert.match(companionScript, /compose build cimmich-api/);
  assert.match(companionScript, /compose build cimmich-ui/);
  assert.match(companionScript, /compose pull cimmich-api cimmich-ui/);
  assert.match(companionScript, /CIMMICH_COMPANION_BUILD_LOCAL:-true/);
  assert.match(companionScript, /docker image rm "\$API_IMAGE" "\$UI_IMAGE"/);
  assert.doesNotMatch(companionScript, /compose build --no-deps/);
  const providerInstall = publicDemoScript.match(
    /install_face_provider\(\) \{(?<body>[\s\S]*?)\n\}/,
  )?.groups?.body;
  assert.ok(providerInstall);
  assert.doesNotMatch(
    providerInstall,
    /immich-credential|refresh_immich_companion/,
  );

  assert.match(
    install,
    /checked-in installer is the supported end-to-end path/,
  );
  assert.doesNotMatch(install, /Five-minute Docker Compose install/);
  assert.match(install, /Download a \*\*named Cimmich release bundle\*\*/);
  assert.match(install, /Native Windows PowerShell is not supported/);
  assert.match(install, /dedicated read-only Immich API key/);
  assert.match(install, /## Updating/);
  assert.match(
    install,
    /companion\.sh backup \/absolute\/new\/backup-directory/,
  );
  assert.match(install, /Docker Desktop, OrbStack or Docker Engine/);
  assert.match(
    agentInstall,
    /never ask for an API key, password or token in chat/i,
  );
  assert.match(agentInstall, /never use `sudo`/);
  assert.match(install, /returns redacted JSON covering/);
  assert.match(install, /write-only field/);
  assert.match(readme, /\[Install Cimmich\]\(INSTALL\.md\)/);
  assert.match(readme, /## Install beside Immich/);
  assert.match(readme, /\.\/tools\/install\.sh --check/);
  assert.doesNotMatch(readme, /docker compose up --detach --build --wait/);
  assert.doesNotMatch(readme, /ghcr\.io\/cimmich/);
  assert.match(readme, /DEVELOPMENT\.md/);
  assert.match(readme, /Reversible archive organisation/);
  assert.match(readme, /People exploration with context/);
  assert.match(
    readme,
    /Native Immich manual face assignments do not train or damage Immich's\s+recognition model/,
  );
  assert.match(readme, /complete the guided\s+library preview/);
  assert.match(install, /Preview the exact library lanes/);
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
  assert.match(
    companionScript,
    /CIMMICH_COMPANION_UI_BIND_ADDRESS[\s\S]*must name one trusted interface/,
  );
  assert.match(
    companionScript,
    /allowed_hosts=127\.0\.0\.1,localhost,cimmich-api[\s\S]*CIMMICH_ALLOWED_HOSTS/,
  );
  assert.doesNotMatch(
    readme,
    /export CIMMICH_COMPANION_PRIVATE_LOCK_MODE=none/,
  );
  assert.match(script, /Checking the Immich version from Docker/);
  assert.match(script, /No Cimmich state was created/);
  assert.match(script, /SUPPORTED_IMMICH_VERSION=3\.1\.0/);
  assert.match(script, /IMMICH_COMPANION_VERSION_UNSUPPORTED/);
  assert.match(script, /No Cimmich migration or import was started/);
  assert.ok(
    script.lastIndexOf('verify_immich_reachable_from_docker "$immich_origin"') <
      script.indexOf('"$COMPANION" configure "$immich_origin"'),
    "guided install must reject an unsupported Immich before configuration",
  );
  assert.match(companionScript, /SUPPORTED_IMMICH_VERSION=3\.1\.0/);
  assert.match(
    companionScript,
    /up\(\) \{[\s\S]*require_configured[\s\S]*preflight_immich_version[\s\S]*CIMMICH_COMPANION_BUILD_LOCAL:-true[\s\S]*compose build cimmich-api[\s\S]*compose build cimmich-ui/,
  );
  assert.match(script, /command -v lsof/);
  assert.match(script, /command -v ss/);
  assert.match(script, /"installer":"blocked"[\s\S]*"portIssues"/);
  assert.match(script, /Docker storage may be elsewhere/);
  assert.match(script, /"\$CHECKSUM" check/);
  assert.match(checksumScript, /sha256sum/);
  assert.match(checksumScript, /shasum -a 256/);
  assert.match(compose, /cimmich-immich-preflight:/);
  assert.match(compose, /wget -q -T 10/);
  assert.match(compose, /actual="\$\$major\.\$\$minor\.\$\$patch"/);
  assert.match(compose, /test "\$\$actual" = 3\.1\.0/);
  assert.match(compose, /context: \./);
  assert.doesNotMatch(compose, /ghcr\.io\/cimmich/);
  assert.ok(compose.includes(`cimmich-api:${version.trim()}`));
  assert.ok(compose.includes(`cimmich-ui:${version.trim()}`));
  assert.match(
    compose,
    /\.\/tools\/cimmich_gateway\.conf\.template:\/template\/default\.conf\.template:ro/,
  );
  assert.doesNotMatch(compose, /context: \.\./);
  assert.match(compose, /environment:\s+PUBLIC_CIMMICH_API_URL: \/cimmich-api/);
  assert.match(compose, /CIMMICH_COMPANION_UI_BIND_ADDRESS:-127\.0\.0\.1/);
  assert.match(compose, /CIMMICH_ALLOWED_HOSTS:/);
  assert.match(
    gateway,
    /location \/cimmich-api\/[\s\S]*auth_request \/_cimmich_owner_session;[\s\S]*proxy_pass http:\/\/cimmich-api:3101\//,
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
  assert.match(
    companionScript,
    /CIMMICH_LOCAL_MEDIA_PROVIDER=opencv-yunet-sface-cpu/,
  );
  assert.match(install, /Optional local face provider/);
  assert.match(
    install,
    /installer verifies exact Immich 3\.1\.0 before it creates Cimmich state/i,
  );
  assert.match(install, /face-provider install-recommended/);
  assert.match(install, /checksum-pinned OpenCV YuNet\s+and SFace/);
  assert.match(
    script,
    /complete_private_password_after_resume[\s\S]*print_install_success/,
  );
  assert.match(script, /\*'"configured":true'\*\) return 0/);
  assert.match(bundleScript, /git ls-files -z/);
  assert.match(bundleScript, /cimmich-\$version\.tar\.gz/);
  assert.match(bundleScript, /cimmich-\$version\.zip/);
  assert.match(bundleScript, /SHA256SUMS/);
  assert.match(bundleScript, /COPYFILE_DISABLE=1/);
  assert.match(bundleScript, /zip -Xqr/);
  assert.match(bundleScript, /forbidden AppleDouble metadata/);
  assert.match(bundleScript, /unzip -Z1/);
  assert.doesNotMatch(bundleScript, /tar .*["']?\$ROOT["']? \./);
  assert.match(agentInstall, /approve that\s+exact scope/);
  assert.match(agentInstall, /Guided V2 starts after Cimmich is running/);
  assert.match(
    agentInstall,
    /no model, Enhanced component or SourcePack became active/,
  );
  assert.match(agentInstall, /IMMICH_COMPANION_VERSION_UNSUPPORTED/);
});
