#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { requiredArgument } from "../src/bin-arguments.mjs";
import { createLocalYoloPoseProvider } from "../src/local-yolo-pose-provider.mjs";

try {
  const preparation = JSON.parse(
    await readFile(requiredArgument("preparation"), "utf8"),
  );
  const manifestPath = requiredArgument("manifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const provider = createLocalYoloPoseProvider({
    manifest,
    manifestPath,
    modelPath: requiredArgument("model"),
    pythonPath: requiredArgument("python"),
    scriptPath: requiredArgument("provider"),
  });
  const bytes = await readFile(requiredArgument("image"));
  const run = (runId) =>
    provider.detect({
      assetToken: preparation.assetToken,
      bytes,
      inputRevision: preparation.inputRevision,
      runId,
      sourceContentDigest: preparation.sourceContentDigest,
    });
  process.stdout.write(
    `${JSON.stringify({
      action: "poseCommit",
      detectorManifest: JSON.parse(
        await readFile(requiredArgument("detector-manifest"), "utf8"),
      ),
      first: await run("operator-pose-run-a"),
      policy: { alternativeMargin: 0.05, minimumIou: 0.5 },
      poseManifest: manifest,
      requestDigest: preparation.requestDigest,
      second: await run("operator-pose-run-b"),
      sourceAssetId: preparation.sourceAssetId,
    })}\n`,
  );
} catch (error) {
  const code = /^[A-Z][A-Z0-9_]{2,95}$/.test(String(error?.code || ""))
    ? String(error.code)
    : "BODY_POSE_PROVIDER_PROCESS_FAILED";
  process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
  process.exitCode = 1;
}
