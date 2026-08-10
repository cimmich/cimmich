import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildArchivePilot } from "../src/archive-pilot.mjs";

const tsv = (header, rows) =>
  `${header.join("\t")}\n${rows.map((row) => row.join("\t")).join("\n")}\n`;

test("archive pilot derives path-free receipts and champion-bound real-photo sets", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-archive-pilot-"));
  const importsRoot = join(root, "imports");
  const thumbRoot = join(root, "thumbs");
  const nestedThumbs = join(thumbRoot, "a", "b");
  const outputRoot = join(root, "pilot");
  await mkdir(importsRoot);
  await mkdir(nestedThumbs, { recursive: true });
  const assetIds = ["asset_left", "asset_middle", "asset_right"];
  const sourceIds = ["source-left", "source-middle", "source-right"];
  const times = ["2026-08-11 00:00:00+00", "2026-08-11 00:00:05+00", "2026-08-11 00:00:10+00"];
  await writeFile(
    join(importsRoot, "asset.tsv"),
    tsv(
      ["asset_id", "media_kind", "capture_time", "state"],
      assetIds.map((assetId, index) => [assetId, "image", times[index], "active"]),
    ),
  );
  await writeFile(
    join(importsRoot, "face_observation.tsv"),
    tsv(
      ["face_id", "asset_id", "box_x", "box_y", "box_w", "box_h", "state"],
      [
        ["face_left", assetIds[0], "0.2", "0.1", "0.1", "0.1", "valid"],
        ["face_right", assetIds[2], "0.2", "0.1", "0.1", "0.1", "valid"],
      ],
    ),
  );
  await writeFile(
    join(importsRoot, "identity_claim.tsv"),
    tsv(
      ["identity_claim_id", "face_id", "person_id", "state"],
      [
        ["claim_left", "face_left", "person_a", "accepted"],
        ["claim_right", "face_right", "person_a", "accepted"],
      ],
    ),
  );
  await writeFile(
    join(importsRoot, "body_observation.tsv"),
    tsv(
      ["body_id", "asset_id", "box_x", "box_y", "box_w", "box_h", "state"],
      assetIds.map((assetId, index) => [
        `body_${index}`,
        assetId,
        "0.1",
        "0.05",
        "0.4",
        "0.8",
        "valid",
      ]),
    ),
  );
  await writeFile(
    join(importsRoot, "display_bridge.json"),
    JSON.stringify({
      assets: assetIds.map((assetId, index) => ({
        assetId,
        filename: `private-${index}.jpg`,
        sourceAssetId: sourceIds[index],
      })),
      schemaVersion: "cimmich.display-bridge.v1",
    }),
  );
  for (const sourceId of sourceIds)
    await writeFile(join(nestedThumbs, `${sourceId}_preview.jpeg`), sourceId);

  const output = await buildArchivePilot({
    importsRoot,
    limit: 1,
    maximumGapSeconds: 60,
    outputRoot,
    thumbRoot,
  });
  assert.equal(output.receipt.state, "ready");
  assert.equal(output.receipt.selectedCount, 1);
  const indexText = await readFile(join(outputRoot, "index.json"), "utf8");
  assert.equal(indexText.includes(root), false);
  assert.equal(indexText.includes("private-"), false);
  const set = JSON.parse(await readFile(join(outputRoot, "context-001.json"), "utf8"));
  assert.equal(set.contextKind, "rapid_burst");
  assert.deepEqual(set.assets[0].acceptedSubjects, ["person_a"]);
  assert.equal(set.assets[0].baselineObservations.faces[0].subject, "person_a");
  assert.deepEqual(set.assets[1].acceptedSubjects, []);
  assert.equal(set.assets[1].baselineObservations.bodies.length, 1);
  assert.equal(set.assets[1].path.endsWith("source-middle_preview.jpeg"), true);
});
