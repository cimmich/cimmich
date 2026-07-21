#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import {
  projectValidatedBodyResultForRepository,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import {
  bodyMaskDigest,
  validateBodyMaskManifest,
} from "../src/body-mask-provider-contract.mjs";
import {
  createLocalBodyMaskWorkerReceipt,
  executeLocalBodyMaskJob,
  prepareLocalBodyMaskJob,
  projectLocalBodyMasks,
} from "../src/local-body-mask-worker.mjs";
import { createLocalSam2BodyMaskProvider } from "../src/local-sam2-body-mask-provider.mjs";

const schemaVersion = "cimmich.body-mask-development-evaluation.v1";
const privateSchemaVersion =
  "cimmich.body-mask-development-evaluation-private.v1";
const maximumBodyOutputBytes = 16 * 1024 * 1024;
const maximumBodyRuntimeMs = 300_000;
let evaluationStage = "CONFIG";

const fail = (code) => {
  process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
  process.exitCode = 1;
};

const evaluationError = (code) => Object.assign(new Error(), { code });

const digest = (value) =>
  createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest("hex");

const requiredArgument = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error();
  return process.argv[index + 1];
};

const runBodyProvider = ({
  assetToken,
  imagePath,
  inputRevision,
  manifestPath,
  modelPath,
  pythonPath,
  scriptPath,
  sourceContentDigest,
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [scriptPath], {
      env: {
        HOME: "/tmp/cimmich-yolo-home",
        PATH: process.env.PATH || "",
        PYTHONNOUSERSITE: "1",
        YOLO_CONFIG_DIR: "/tmp/cimmich-yolo-config",
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(evaluationError("BODY_PROVIDER_TIMEOUT")));
    }, maximumBodyRuntimeMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maximumBodyOutputBytes) {
        child.kill("SIGKILL");
        finish(() => reject(evaluationError("BODY_PROVIDER_OUTPUT_INVALID")));
        return;
      }
      output.push(Buffer.from(chunk));
    });
    child.stderr.on("data", () => {});
    child.on("error", () =>
      finish(() => reject(evaluationError("BODY_PROVIDER_PROCESS_FAILED"))),
    );
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0)
        return finish(() =>
          reject(evaluationError("BODY_PROVIDER_PROCESS_FAILED")),
        );
      try {
        finish(() =>
          resolve(JSON.parse(Buffer.concat(output).toString("utf8"))),
        );
      } catch {
        finish(() => reject(evaluationError("BODY_PROVIDER_OUTPUT_INVALID")));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(
      JSON.stringify({
        assetToken,
        imagePath,
        inputRevision,
        manifestPath,
        modelPath,
        schemaVersion: "cimmich.ultralytics-yolo-body-request.v1",
        sourceContentDigest,
      }),
    );
  });

const loadCohorts = async (paths) => {
  const rows = [];
  for (const path of paths) {
    const cohort = JSON.parse(await readFile(path, "utf8"));
    if (
      cohort?.schemaVersion !==
        "cimmich.body-pet-geometry-development-cohort.v1" ||
      cohort.reviewStatus !== "frozen_before_provider_execution" ||
      cohort.thresholdChangesOnFrozenHoldout !== "forbidden" ||
      !Array.isArray(cohort.cases)
    )
      throw new Error();
    rows.push(...cohort.cases);
  }
  if (
    rows.length < 1 ||
    rows.length > 100 ||
    new Set(rows.map(({ caseId }) => caseId)).size !== rows.length
  )
    throw new Error();
  return rows;
};

const main = async () => {
  const cohortPaths = requiredArgument("--cohorts").split(",");
  const bodyManifestPath = requiredArgument("--body-manifest");
  const bodyModelPath = requiredArgument("--body-model");
  const bodyPythonPath = requiredArgument("--body-python");
  const bodyScriptPath = requiredArgument("--body-script");
  const maskManifestPath = requiredArgument("--mask-manifest");
  const maskCheckpointPath = requiredArgument("--mask-checkpoint");
  const maskPythonPath = requiredArgument("--mask-python");
  const maskScriptPath = requiredArgument("--mask-script");
  const sam2DepsPath = requiredArgument("--sam2-deps");
  const sam2SourcePath = requiredArgument("--sam2-source");
  const privateOutputPath = requiredArgument("--private-output");
  const cases = await loadCohorts(cohortPaths);
  evaluationStage = "MANIFEST";
  const bodyManifest = JSON.parse(await readFile(bodyManifestPath, "utf8"));
  const maskManifest = validateBodyMaskManifest(
    JSON.parse(await readFile(maskManifestPath, "utf8")),
  );
  const maskProvider = createLocalSam2BodyMaskProvider({
    checkpointPath: maskCheckpointPath,
    manifest: maskManifest,
    manifestPath: maskManifestPath,
    pythonPath: maskPythonPath,
    sam2DepsPath,
    sam2SourcePath,
    scriptPath: maskScriptPath,
  });
  const rows = [];
  const privateRows = [];
  for (const item of cases) {
    evaluationStage = "SOURCE_READ";
    const bytes = await readFile(item.imagePath);
    const sourceContentDigest = digest(bytes);
    const caseToken = digest({
      caseId: item.caseId,
      sourceContentDigest,
      stratum: item.stratum,
    });
    const assetToken = digest({ caseToken, kind: "development-asset" });
    const inputRevision = digest({
      assetToken,
      revision: "body-mask-development-v1",
      sourceContentDigest,
    });
    evaluationStage = "BODY_PROVIDER";
    const bodyResult = await runBodyProvider({
      assetToken,
      imagePath: item.imagePath,
      inputRevision,
      manifestPath: bodyManifestPath,
      modelPath: bodyModelPath,
      pythonPath: bodyPythonPath,
      scriptPath: bodyScriptPath,
      sourceContentDigest,
    });
    evaluationStage = "BODY_VALIDATION";
    const bodyValidation = validateBodyDetectionResult(
      bodyResult,
      bodyManifest,
    );
    const bodyProjection =
      projectValidatedBodyResultForRepository(bodyValidation);
    if (!bodyProjection.bodies.length) {
      rows.push({
        geometryValid: 0,
        abstained: 0,
        bodyCount: 0,
        caseToken,
        replayEvidence: "not_run_no_body",
        review: 0,
        stratum: item.stratum,
      });
      privateRows.push({
        bodyProjection,
        caseId: item.caseId,
        imagePath: item.imagePath,
        maskProjection: null,
        stratum: item.stratum,
        workerReceipt: null,
      });
      continue;
    }
    const assetId = `dev_${caseToken.slice(0, 48)}`;
    evaluationStage = "MASK_PREPARE";
    const prepared = prepareLocalBodyMaskJob({
      assetId,
      bodyValidation,
      manifest: maskManifest,
      projection: { assetId, inputRevision },
    });
    const companion = {
      async getAsset() {
        return { asset: { immichAssetId: assetId, inputRevision } };
      },
      async readAssetImage() {
        return {
          asset: { immichAssetId: assetId, inputRevision },
          bytes,
          contentDigest: sourceContentDigest,
          sourceAccess: "operator-local-read-only",
        };
      },
    };
    evaluationStage = "MASK_EXECUTION";
    const execution = await executeLocalBodyMaskJob({
      companion,
      prepared,
      provider: maskProvider,
    });
    evaluationStage = "MASK_PROJECTION";
    const workerReceipt = createLocalBodyMaskWorkerReceipt(execution);
    const maskProjection = projectLocalBodyMasks(execution);
    const counts = {
      abstained: maskProjection.items.filter(
        (entry) => entry.state === "abstained",
      ).length,
      geometryValid: maskProjection.items.filter(
        (entry) => entry.state === "geometry_valid",
      ).length,
      review: maskProjection.items.filter((entry) => entry.state === "review")
        .length,
    };
    rows.push({
      ...counts,
      bodyCount: bodyProjection.bodies.length,
      caseToken,
      replayEvidence: workerReceipt.replayEvidence,
      stratum: item.stratum,
    });
    privateRows.push({
      bodyProjection,
      caseId: item.caseId,
      imagePath: item.imagePath,
      maskProjection,
      stratum: item.stratum,
      workerReceipt,
    });
  }
  const counts = rows.reduce(
    (sum, row) => ({
      geometryValid: sum.geometryValid + row.geometryValid,
      abstained: sum.abstained + row.abstained,
      bodies: sum.bodies + row.bodyCount,
      review: sum.review + row.review,
    }),
    { abstained: 0, bodies: 0, geometryValid: 0, review: 0 },
  );
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      countAuthority: "none",
      persistence: "none",
      recommendation: "none",
      training: "none",
    },
    boundary: {
      databaseWrites: "none",
      externalUpload: "none",
      frozenResolverHoldoutExecution: "not_performed",
      sourceMediaRead: "operator_local_read_only",
      sourceMediaWrite: "none",
    },
    cohortDigest: bodyMaskDigest(
      rows.map(({ caseToken, stratum }) => ({ caseToken, stratum })),
    ),
    counts,
    manifests: {
      bodyConfigDigest: bodyManifest.detectorConfigDigest,
      maskConfigDigest: maskManifest.maskConfigDigest,
    },
    rows,
    schemaVersion,
  };
  const receipt = { ...core, receiptDigest: bodyMaskDigest(core) };
  evaluationStage = "PRIVATE_WRITE";
  await writeFile(
    privateOutputPath,
    `${JSON.stringify(
      {
        cohortDigest: receipt.cohortDigest,
        rows: privateRows,
        schemaVersion: privateSchemaVersion,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
};

try {
  await main();
} catch (error) {
  if (process.env.CIMMICH_EVALUATION_DEBUG === "1") {
    const message = String(error?.message || "")
      .replace(/[^A-Za-z0-9 ._\[\]-]/g, "")
      .slice(0, 160);
    process.stderr.write(
      `${JSON.stringify({ diagnostic: { message, stage: evaluationStage } })}\n`,
    );
  }
  const closedCode =
    typeof error?.code === "string" &&
    /^(?:BODY_MASK_PROVIDER_INPUT_INVALID|LOCAL_BODY_MASK_[A-Z_]+)$/.test(
      error.code,
    )
      ? error.code
      : null;
  fail(
    [
      "BODY_PROVIDER_OUTPUT_INVALID",
      "BODY_PROVIDER_PROCESS_FAILED",
      "BODY_PROVIDER_TIMEOUT",
      "LOCAL_BODY_MASK_OUTPUT_INVALID",
      "LOCAL_BODY_MASK_PROCESS_FAILED",
      "LOCAL_BODY_MASK_TIMEOUT",
    ].includes(error?.code)
      ? error.code
      : closedCode || `BODY_MASK_DEVELOPMENT_${evaluationStage}_FAILED`,
  );
}
