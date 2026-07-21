import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { createEnhancedComponent } from "../src/enhanced-component.mjs";

const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: true });
const directory = await mkdtemp(join(tmpdir(), "cimmich-enhanced-acceptance-"));
const actorId = "enhanced-owner-acceptance";

try {
  const release100 = JSON.parse(
    await readFile(
      new URL("../enhanced/cimmich-enhanced-1.0.0.json", import.meta.url),
      "utf8",
    ),
  );
  await writeFile(
    join(directory, "cimmich-enhanced-1.0.0.json"),
    `${JSON.stringify(release100, null, 2)}\n`,
  );
  await writeFile(
    join(directory, "cimmich-enhanced-1.1.0.json"),
    `${JSON.stringify({ ...release100, version: "1.1.0" }, null, 2)}\n`,
  );
  const component = createEnhancedComponent({
    artifactDirectory: directory,
    sql,
  });
  const [{ claims: beforeClaims, packs: beforePacks }] = await sql`
    SELECT
      (SELECT count(*)::int FROM identity_claim) AS claims,
      (SELECT count(*)::int FROM source_pack) AS packs
  `;
  const initial = await component.status();
  assert.equal(initial.coreAvailable, true);
  assert.equal(initial.enabled, false);
  assert.equal(initial.state, "disabled");
  assert.equal(initial.available.version, "1.1.0");
  assert.deepEqual(initial.authority, {
    automaticIdentity: "none",
    sourcePackActivation: "governed_operator_review_only",
    training: "none",
  });

  const enabled = await component.execute({
    action: "enable",
    actorId,
    commandId: "enhanced-acceptance-enable-0001",
    expectedRevision: initial.currentRevision,
    targetVersion: "1.0.0",
  });
  assert.equal(enabled.changed, true);
  assert.equal(enabled.active.version, "1.0.0");
  assert.equal(enabled.shadowReplay.compatible, true);
  assert.equal(enabled.shadowReplay.identityTruthChanged, false);
  assert.equal(enabled.shadowReplay.sourcePackActivationPerformed, false);
  const enableReplay = await component.execute({
    action: "enable",
    actorId,
    commandId: "enhanced-acceptance-enable-0001",
    expectedRevision: initial.currentRevision,
    targetVersion: "1.0.0",
  });
  assert.equal(enableReplay.replayed, true);
  assert.equal(enableReplay.currentRevision, enabled.currentRevision);
  await assert.rejects(
    component.execute({
      action: "disable",
      actorId,
      commandId: "enhanced-acceptance-enable-0001",
      expectedRevision: enabled.currentRevision,
    }),
    (error) => error.code === "ENHANCED_COMMAND_CONFLICT",
  );

  const updated = await component.execute({
    action: "update",
    actorId,
    commandId: "enhanced-acceptance-update-0001",
    expectedRevision: enabled.currentRevision,
    targetVersion: "1.1.0",
  });
  assert.equal(updated.active.version, "1.1.0");
  assert.equal(updated.rollbackAvailable, true);
  await assert.rejects(
    component.execute({
      action: "disable",
      actorId,
      commandId: "enhanced-acceptance-stale-0001",
      expectedRevision: enabled.currentRevision,
    }),
    (error) => error.code === "ENHANCED_REVISION_STALE",
  );

  const rolledBack = await component.execute({
    action: "rollback",
    actorId,
    commandId: "enhanced-acceptance-rollback-0001",
    expectedRevision: updated.currentRevision,
  });
  assert.equal(rolledBack.active.version, "1.0.0");
  assert.equal(rolledBack.enabled, true);
  const disabled = await component.execute({
    action: "disable",
    actorId,
    commandId: "enhanced-acceptance-disable-0001",
    expectedRevision: rolledBack.currentRevision,
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.state, "disabled");
  assert.equal(await component.isEnabled(), false);

  const [{ claims: afterClaims, packs: afterPacks }] = await sql`
    SELECT
      (SELECT count(*)::int FROM identity_claim) AS claims,
      (SELECT count(*)::int FROM source_pack) AS packs
  `;
  assert.deepEqual(
    { claims: afterClaims, packs: afterPacks },
    { claims: beforeClaims, packs: beforePacks },
  );
  process.stdout.write(
    `${JSON.stringify({
      automaticIdentityAuthority: "none",
      baseTruthRetained: true,
      finalState: disabled.state,
      sourcePackActivationAuthority: "governed_operator_review_only",
      status: "PASS",
      trainingAuthority: "none",
      update: `${enabled.active.version}->${updated.active.version}`,
      rollback: rolledBack.active.version,
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
  await rm(directory, { force: true, recursive: true });
}
