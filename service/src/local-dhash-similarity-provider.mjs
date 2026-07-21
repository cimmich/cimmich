import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  assetSimilarityResultDigest,
  deriveAssetSimilarityManifest,
} from "./asset-similarity-contract.mjs";
import { providerSubprocessEnvironment } from "./provider-subprocess-env.mjs";

export const localDHashSimilarityProviderVersion =
  "cimmich.local-dhash-similarity-provider.v1";

const providerError = (code, message) =>
  Object.assign(new Error(message), { code });

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw providerError(
      "LOCAL_ASSET_SIMILARITY_CONFIG_INVALID",
      `Local similarity provider requires ${label}`,
    );
  }
  return normalized;
};

const fileDigest = async (filePath) =>
  createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");

const validateManifest = (value) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw providerError(
      "LOCAL_ASSET_SIMILARITY_CONFIG_INVALID",
      "Local similarity manifest is invalid",
    );
  }
  const core = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "featureSpaceId" && key !== "providerConfigDigest",
    ),
  );
  let expected;
  try {
    expected = deriveAssetSimilarityManifest(core);
  } catch {
    throw providerError(
      "LOCAL_ASSET_SIMILARITY_CONFIG_INVALID",
      "Local similarity manifest is invalid",
    );
  }
  if (
    expected.providerConfigDigest !== value.providerConfigDigest ||
    expected.featureSpaceId !== value.featureSpaceId
  ) {
    throw providerError(
      "LOCAL_ASSET_SIMILARITY_CONFIG_INVALID",
      "Local similarity manifest derived bindings do not match",
    );
  }
  return expected;
};

export const createLocalDHashSimilarityProvider = ({
  manifest: manifestInput,
  manifestPath,
  maxInputBytes = 128 * 1024 * 1024,
  maxOutputBytes = 1024,
  pythonPath,
  scriptPath,
  timeoutMs = 30_000,
} = {}) => {
  const manifest = validateManifest(manifestInput);
  const config = {
    manifestPath: requiredText(manifestPath, "manifestPath"),
    pythonPath: requiredText(pythonPath, "pythonPath"),
    scriptPath: requiredText(scriptPath, "scriptPath"),
  };
  if (
    !Number.isInteger(maxInputBytes) ||
    maxInputBytes < 1024 ||
    maxInputBytes > 512 * 1024 * 1024 ||
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 64 ||
    maxOutputBytes > 1024 * 1024 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 120_000
  ) {
    throw providerError(
      "LOCAL_ASSET_SIMILARITY_CONFIG_INVALID",
      "Local similarity provider resource bounds are invalid",
    );
  }

  return {
    manifest,
    schemaVersion: localDHashSimilarityProviderVersion,
    async compare({ assets, leftBytes, rightBytes, runId }) {
      if (
        !Buffer.isBuffer(leftBytes) ||
        !leftBytes.length ||
        leftBytes.length > maxInputBytes ||
        !Buffer.isBuffer(rightBytes) ||
        !rightBytes.length ||
        rightBytes.length > maxInputBytes
      ) {
        throw providerError(
          "LOCAL_ASSET_SIMILARITY_INPUT_INVALID",
          "Local similarity provider requires two bounded encoded images",
        );
      }
      const preflight = {
        assets,
        featureSpaceId: manifest.featureSpaceId,
        providerConfigDigest: manifest.providerConfigDigest,
        runId,
        schemaVersion: "cimmich.asset-similarity-result.v1",
        similarity: 0,
      };
      try {
        assetSimilarityResultDigest(preflight);
      } catch {
        throw providerError(
          "LOCAL_ASSET_SIMILARITY_INPUT_INVALID",
          "Local similarity result bindings are invalid",
        );
      }

      let fileManifest;
      try {
        fileManifest = JSON.parse(await readFile(config.manifestPath, "utf8"));
      } catch {
        throw providerError(
          "LOCAL_ASSET_SIMILARITY_CONFIG_INVALID",
          "Local similarity manifest could not be read",
        );
      }
      const currentManifest = validateManifest(fileManifest);
      if (
        currentManifest.providerConfigDigest !==
          manifest.providerConfigDigest ||
        currentManifest.similarity.artifactDigest !==
          (await fileDigest(config.scriptPath))
      ) {
        throw providerError(
          "LOCAL_ASSET_SIMILARITY_CONFIG_INVALID",
          "Local similarity provider changed after configuration",
        );
      }

      const header = Buffer.alloc(16);
      header.writeBigUInt64BE(BigInt(leftBytes.length), 0);
      header.writeBigUInt64BE(BigInt(rightBytes.length), 8);
      const similarity = await new Promise((resolve, reject) => {
        const child = spawn(
          config.pythonPath,
          [
            config.scriptPath,
            "--manifest",
            config.manifestPath,
            "--max-input-bytes",
            String(maxInputBytes),
          ],
          {
            env: providerSubprocessEnvironment(),
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let settled = false;
        let outputBytes = 0;
        const output = [];
        const finish = (callback) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          callback();
        };
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          finish(() =>
            reject(
              providerError(
                "LOCAL_ASSET_SIMILARITY_TIMEOUT",
                "Local similarity provider timed out",
              ),
            ),
          );
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > maxOutputBytes) {
            child.kill("SIGKILL");
            finish(() =>
              reject(
                providerError(
                  "LOCAL_ASSET_SIMILARITY_OUTPUT_INVALID",
                  "Local similarity output exceeded its bound",
                ),
              ),
            );
            return;
          }
          output.push(Buffer.from(chunk));
        });
        child.stderr.on("data", () => {});
        child.on("error", () =>
          finish(() =>
            reject(
              providerError(
                "LOCAL_ASSET_SIMILARITY_PROCESS_FAILED",
                "Local similarity provider could not start",
              ),
            ),
          ),
        );
        child.on("close", (code) => {
          if (settled) return;
          if (code !== 0) {
            finish(() =>
              reject(
                providerError(
                  "LOCAL_ASSET_SIMILARITY_PROCESS_FAILED",
                  "Local similarity provider failed",
                ),
              ),
            );
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(
              Buffer.concat(output, outputBytes).toString("utf8"),
            );
          } catch {
            finish(() =>
              reject(
                providerError(
                  "LOCAL_ASSET_SIMILARITY_OUTPUT_INVALID",
                  "Local similarity provider returned invalid output",
                ),
              ),
            );
            return;
          }
          if (
            parsed == null ||
            typeof parsed !== "object" ||
            Array.isArray(parsed) ||
            Object.keys(parsed).length !== 1 ||
            !Object.hasOwn(parsed, "similarity")
          ) {
            finish(() =>
              reject(
                providerError(
                  "LOCAL_ASSET_SIMILARITY_OUTPUT_INVALID",
                  "Local similarity provider returned unsupported fields",
                ),
              ),
            );
            return;
          }
          finish(() => resolve(parsed.similarity));
        });
        child.stdin.on("error", () => {});
        child.stdin.end(Buffer.concat([header, leftBytes, rightBytes]));
      });

      const core = { ...preflight, similarity };
      try {
        return Object.freeze({
          ...core,
          resultDigest: assetSimilarityResultDigest(core),
        });
      } catch {
        throw providerError(
          "LOCAL_ASSET_SIMILARITY_OUTPUT_INVALID",
          "Local similarity provider returned an invalid score",
        );
      }
    },
  };
};
