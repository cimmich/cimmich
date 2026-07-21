import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const source = (path) => readFile(resolve(root, path), "utf8");

test("release dependency policy is fail-closed and CI actions are immutable", async () => {
  const [workflow, workspace, perceptualRequirements] = await Promise.all([
    source(".github/workflows/ci.yml"),
    source("ui/pnpm-workspace.yaml"),
    source("providers/perceptual-dhash/requirements.txt"),
  ]);

  assert.match(workflow, /npm audit --audit-level=low/);
  assert.match(workflow, /pnpm audit --audit-level=low/);
  assert.match(workflow, /pip-audit --no-deps --disable-pip/);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+/);
  for (const action of [
    "actions/checkout",
    "actions/setup-node",
    "actions/cache",
  ]) {
    assert.match(
      workflow,
      new RegExp(`${action.replace("/", "\\/")}@[0-9a-f]{40}`),
    );
  }
  for (const patchedDependency of [
    "brace-expansion",
    "cookie",
    "esbuild",
    "tar",
    "undici",
    "ws",
  ]) {
    assert.match(workspace, new RegExp(`${patchedDependency}@`));
  }
  assert.match(perceptualRequirements, /^Pillow==12\.3\.0$/m);
});

test("local runtime secrets, images and browser response headers are hardened", async () => {
  const [
    lab,
    gateway,
    publicDemoGateway,
    stockImmich,
    companionUi,
    companionCompose,
    publicDemoCompose,
  ] = await Promise.all([
    source("tools/background-lab.compose.yml"),
    source("tools/cimmich_gateway.conf.template"),
    source("tools/public_demo_nginx.conf"),
    source("ops/stock-immich-v3.0.3.compose.yml"),
    source("tools/cimmich_ui.Dockerfile"),
    source("tools/companion.compose.yml"),
    source("tools/public_demo.compose.yml"),
  ]);

  assert.match(lab, /chmod 600 \/secrets\/guided-token/);
  assert.doesNotMatch(lab, /chmod 644 \/secrets\/guided-token/);
  assert.match(lab, /alpine:3\.22@sha256:[0-9a-f]{64}/);
  assert.match(lab, /pgvector:[^\s]+@sha256:[0-9a-f]{64}/);
  for (const nginx of [gateway, publicDemoGateway]) {
    assert.match(nginx, /server_tokens off/);
    assert.match(nginx, /X-Content-Type-Options "nosniff" always/);
    assert.match(nginx, /Referrer-Policy "no-referrer" always/);
    assert.match(nginx, /X-Frame-Options "SAMEORIGIN" always/);
  }
  for (const image of [
    "ghcr.io/immich-app/immich-server:v3.0.3",
    "ghcr.io/immich-app/immich-machine-learning:v3.0.3",
    "pgvector/pgvector:0.8.2-pg17-trixie",
  ]) {
    assert.match(
      stockImmich,
      new RegExp(
        `${image.replaceAll("/", "\\/").replaceAll(".", "\\.")}@sha256:[0-9a-f]{64}`,
      ),
    );
  }
  assert.match(companionUi, /USER node\s+CMD \["node", "build"\]/);
  assert.ok(
    (companionCompose.match(/no-new-privileges:true/g) || []).length >= 2,
  );
  assert.ok((companionCompose.match(/cap_drop: \[ALL\]/g) || []).length >= 2);
  assert.match(lab, /no-new-privileges:true/);
  assert.match(lab, /cap_drop: \[ALL\]/);
  const publicDemoApi = publicDemoCompose.match(
    /  cimmich-api:\n(?<body>[\s\S]*?)\n  public-demo-ui:/,
  )?.groups?.body;
  assert.ok(publicDemoApi);
  assert.match(publicDemoApi, /no-new-privileges:true/);
  assert.match(publicDemoApi, /cap_drop: \[ALL\]/);
});

test("backup restore validates hostile input before replacing owner state", async () => {
  const [companion, companionAcceptance, publicDemo] = await Promise.all([
    source("tools/companion.sh"),
    source("tools/companion_acceptance.sh"),
    source("tools/public_demo.sh"),
  ]);

  const restore = companion.match(/restore\(\) \{(?<body>[\s\S]*?)\n\}/)?.groups
    ?.body;
  assert.ok(restore);
  assert.ok(restore.indexOf('validate_backup "$backup_path"') >= 0);
  assert.ok(
    restore.indexOf('validate_backup "$backup_path"') <
      restore.indexOf("compose stop"),
  );
  assert.match(companion, /preflight_backup_database/);
  assert.match(companion, /createGunzip/);
  assert.match(companion, /parts\.includes\("\.\."\)/);
  assert.match(
    companion,
    /until docker exec "\$preflight_database" psql -U cimmich -d cimmich/,
  );
  assert.match(companion, /backup_destination=\$1/);
  assert.match(companion, /mv "\$backup_staging" "\$backup_destination"/);
  assert.match(companion, /backup schema is newer than this Cimmich build/);
  assert.match(companion, /backup project mismatch/);
  assert.match(companion, /backup migration changed semantic counts/);
  assert.match(companion, /backup archive contains links or special files/);
  assert.match(companion, /backup Immich credential is invalid/);
  assert.match(companionAcceptance, /restoreAdversarialCases":7/);
  for (const adversarialCase of [
    "wrong-project",
    "newer-schema",
    "semantic-count-drift",
    "corrupt-database",
    "traversal-archive",
    "invalid-credential",
    "checksum-mismatch",
  ]) {
    assert.match(companionAcceptance, new RegExp(adversarialCase));
  }
  assert.match(publicDemo, /backup archive contains links or special files/);
});

test("Document lifecycle rejects database credentials in process arguments", () => {
  const tool = resolve(root, "service/bin/document-lifecycle.mjs");
  const secret = "postgres://owner:do-not-echo@example.invalid/cimmich";
  const result = spawnSync(
    process.execPath,
    [tool, "backup", `--database-url=${secret}`, "--output=/tmp/rejected"],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /never a command argument/);
  assert.doesNotMatch(result.stderr, /do-not-echo/);
});
