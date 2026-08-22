import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const source = (path) => readFile(resolve(root, path), "utf8");

test("release dependency policy is fail-closed and CI actions are immutable", async () => {
  const [workflow, containerWorkflow, workspace, perceptualRequirements] =
    await Promise.all([
      source(".github/workflows/ci.yml"),
      source(".github/workflows/container-images.yml"),
      source("ui/pnpm-workspace.yaml"),
      source("providers/perceptual-dhash/requirements.txt"),
    ]);

  assert.match(workflow, /npm audit --audit-level=low/);
  assert.match(workflow, /pnpm audit --audit-level=low/);
  assert.match(workflow, /pip-audit --cache-dir[^\n]+--requirement/);
  assert.doesNotMatch(workflow, /pip-audit --no-deps --disable-pip/);
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
  assert.match(containerWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(containerWorkflow, /workflow_run:/);
  assert.match(
    containerWorkflow,
    /resolve-release:[\s\S]*permissions:\s*actions: read\s*contents: read/,
  );
  assert.match(
    containerWorkflow,
    /publish:[\s\S]*permissions:\s*attestations: write\s*contents: read\s*id-token: write\s*packages: write/,
  );
  assert.equal(
    (containerWorkflow.match(/persist-credentials: false/g) ?? []).length,
    2,
  );
  assert.match(containerWorkflow, /ref: \$\{\{ inputs\.release_tag \}\}/);
  assert.match(
    containerWorkflow,
    /run\.name === "Cimmich CI"[\s\S]*run\.conclusion === "success"[\s\S]*run\.head_sha === sha[\s\S]*run\.head_branch === tag/,
  );
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
    publicDemoUi,
    nginxRuntime,
    companionCompose,
    publicDemoCompose,
  ] = await Promise.all([
    source("tools/background-lab.compose.yml"),
    source("tools/cimmich_gateway.conf.template"),
    source("tools/public_demo_nginx.conf"),
    source("ops/stock-immich-v3.1.0.compose.yml"),
    source("tools/cimmich_ui.Dockerfile"),
    source("tools/public_demo_ui.Dockerfile"),
    source("tools/cimmich_nginx_runtime.conf"),
    source("compose.yaml"),
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
  for (const nginx of [gateway, publicDemoGateway]) {
    assert.match(
      nginx,
      /location = \/_cimmich_owner_session \{[\s\S]*internal;[\s\S]*proxy_pass http:\/\/cimmich-api:3101\/_internal\/owner-session;[\s\S]*proxy_set_header Cookie \$http_cookie;[\s\S]*proxy_set_header Authorization \$http_authorization;[\s\S]*proxy_set_header X-Api-Key \$http_x_api_key;/,
    );
    assert.match(
      nginx,
      /location \/cimmich-api\/ \{[\s\S]*auth_request \/_cimmich_owner_session;[\s\S]*auth_request_set \$cimmich_authenticated_principal[\s\S]*proxy_set_header Origin \$http_origin;[\s\S]*proxy_set_header X-Cimmich-Authenticated-Principal \$cimmich_authenticated_principal;/,
    );
    assert.match(
      nginx,
      /location \/cimmich-api\/ \{[\s\S]*proxy_buffering off;/,
      "owner API responses must stream rather than filling the gateway tmpfs",
    );
    assert.match(
      nginx,
      /location \^~ \/cimmich-api\/_internal\/ \{[\s\S]*return 404;/,
    );
    assert.match(
      nginx,
      /location = \/cimmich-api\/health \{[\s\S]*proxy_pass http:\/\/cimmich-api:3101\/health;/,
    );
  }
  assert.match(
    publicDemoGateway,
    /location \^~ \/_app\/immutable\/ \{[\s\S]*expires epoch;[\s\S]*try_files \$uri =404;/,
    "public release chunks must revalidate across same-origin candidate rebuilds",
  );
  assert.match(publicDemoCompose, /PUBLIC_CIMMICH_API_URL: \/cimmich-api/);
  for (const compose of [companionCompose, publicDemoCompose]) {
    assert.match(
      compose,
      /CIMMICH_OPTIONAL_EGRESS_ENABLED: \$\{CIMMICH_OPTIONAL_EGRESS_ENABLED:-false\}/,
    );
  }
  for (const image of [
    "ghcr.io/immich-app/immich-server:v3.1.0",
    "ghcr.io/immich-app/immich-machine-learning:v3.1.0",
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
  assert.match(
    publicDemoUi,
    /COPY tools\/cimmich_nginx_runtime\.conf \/etc\/nginx\/nginx\.conf/,
  );
  assert.match(publicDemoUi, /USER nginx/);
  assert.match(publicDemoUi, /ENTRYPOINT \[\]/);
  assert.match(publicDemoUi, /EXPOSE 8080/);
  assert.match(nginxRuntime, /pid \/tmp\/nginx\.pid/);
  for (const temporaryPath of [
    "client_body_temp_path /tmp/client-body",
    "proxy_temp_path /tmp/proxy",
    "fastcgi_temp_path /tmp/fastcgi",
    "uwsgi_temp_path /tmp/uwsgi",
    "scgi_temp_path /tmp/scgi",
  ]) {
    assert.match(nginxRuntime, new RegExp(temporaryPath));
  }
  assert.match(companionCompose, /CIMMICH_OWNER_GATEWAY_REQUIRED: "true"/);
  assert.match(companionCompose, /CIMMICH_IMMICH_WEB_ORIGIN:/);
  for (const compose of [companionCompose, publicDemoCompose]) {
    const gateway = compose.match(
      /  (?:cimmich-gateway|public-demo-ui):\n(?<body>[\s\S]*?)(?:\n  [a-z]|\nnetworks:)/,
    )?.groups?.body;
    assert.ok(gateway);
    assert.match(gateway, /read_only: true/);
    assert.match(gateway, /\/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777/);
    assert.match(gateway, /no-new-privileges:true/);
    assert.match(gateway, /cap_drop: \[ALL\]/);
    assert.match(gateway, /:8080/);
  }
  const companionGateway = companionCompose.match(
    /  cimmich-gateway:\n(?<body>[\s\S]*?)\nnetworks:/,
  )?.groups?.body;
  assert.ok(companionGateway);
  assert.match(companionGateway, /entrypoint: \[\]/);
  assert.match(companionGateway, /user: 101:101/);
  assert.match(
    companionGateway,
    /cimmich_nginx_runtime\.conf:\/etc\/nginx\/nginx\.conf:ro/,
  );
  assert.match(lab, /no-new-privileges:true/);
  assert.match(lab, /cap_drop: \[ALL\]/);
  const publicDemoApi = publicDemoCompose.match(
    /  cimmich-api:\n(?<body>[\s\S]*?)\n  public-demo-ui:/,
  )?.groups?.body;
  assert.ok(publicDemoApi);
  assert.match(publicDemoApi, /no-new-privileges:true/);
  assert.match(publicDemoApi, /cap_drop: \[ALL\]/);
});

test("Vulkan deployment grants only read/write access to the render node", async () => {
  const compose = await source("compose.local-ai-vulkan.yaml");
  assert.match(compose, /source: \$\{CIMMICH_LOCAL_AI_RENDER_DEVICE/);
  assert.match(compose, /target: \/dev\/dri\/renderD128/);
  assert.match(compose, /permissions: rw/);
  assert.doesNotMatch(compose, /permissions: rwm/);
});

test("backup restore validates hostile input before replacing owner state", async () => {
  const [companion, companionAcceptance, publicDemo] = await Promise.all([
    source("tools/companion.sh"),
    source("tools/companion_acceptance.sh"),
    source("tools/public_demo.sh"),
  ]);

  const restore = companion.match(/^restore\(\) \{(?<body>[\s\S]*?)\n\}/m)
    ?.groups?.body;
  assert.ok(restore);
  assert.ok(restore.indexOf('validate_backup "$backup_path"') >= 0);
  assert.ok(
    restore.indexOf('validate_backup "$backup_path"') <
      restore.indexOf("create_restore_rollback"),
  );
  assert.match(restore, /replace_from_full_backup "\$restore_source"/);
  assert.match(restore, /recover_failed_restore "\$restore_previous_counts"/);
  assert.match(companion, /backup "\$restore_rollback_path" >\/dev\/null/);
  assert.match(
    companion,
    /restore failed; the previous owner state was recovered automatically/,
  );
  assert.match(companion, /preflight_backup_database/);
  assert.match(
    companion,
    /docker rm -fv "\$preflight_database"/,
    "restore preflight must remove the anonymous PostgreSQL data volume",
  );
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

test("companion removal refuses unknown state before destructive teardown", async () => {
  const companion = await source("tools/companion.sh");
  const remove = companion.match(/remove_companion\(\) \{(?<body>[\s\S]*?)\n\}/)
    ?.groups?.body;
  assert.ok(remove);
  assert.match(remove, /find "\$STATE_ROOT" -mindepth 1 -maxdepth 1 -print/);
  assert.ok(
    remove.indexOf("state root contains unrecognized entries") <
      remove.indexOf("compose down --volumes --remove-orphans"),
  );
  assert.doesNotMatch(remove, /-type f/);
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
