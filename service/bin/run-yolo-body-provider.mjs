#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";

const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) throw new Error(`Missing --${name}`);
  return value;
};
const preparation = JSON.parse(await readFile(argument("preparation"), "utf8"));
const manifest = JSON.parse(await readFile(argument("manifest"), "utf8"));
const imagePath = argument("image");
const manifestPath = argument("manifest");
const modelPath = argument("model");
const providerPath = argument("provider");
const pythonPath = argument("python");

const run = (runId) =>
  new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [providerPath], {
      env: {
        HOME: "/tmp/cimmich-body-home",
        MPLCONFIGDIR: "/tmp/cimmich-body-matplotlib",
        PATH: process.env.PATH || "",
        PYTHONNOUSERSITE: "1",
        XDG_CACHE_HOME: "/tmp/cimmich-body-cache",
        YOLO_AUTOINSTALL: "false",
        YOLO_CONFIG_DIR: "/tmp/cimmich-ultralytics-body",
        YOLO_OFFLINE: "true",
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    const errorChunks = [];
    let size = 0;
    let errorSize = 0;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) child.kill("SIGKILL");
      else chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      errorSize += chunk.length;
      if (errorSize <= 64 * 1024) errorChunks.push(Buffer.from(chunk));
    });
    child.on("error", () => reject(new Error("BODY_PROVIDER_PROCESS_FAILED")));
    child.on("close", (code) => {
      if (code !== 0) {
        try {
          const failure = JSON.parse(
            Buffer.concat(errorChunks, Math.min(errorSize, 64 * 1024)).toString(
              "utf8",
            ),
          );
          const providerCode = String(failure?.error?.code || "");
          if (/^[A-Z][A-Z0-9_]{2,95}$/.test(providerCode)) {
            return reject(new Error(providerCode));
          }
        } catch {}
        return reject(new Error("BODY_PROVIDER_PROCESS_FAILED"));
      }
      try {
        resolve({ result: JSON.parse(Buffer.concat(chunks, size)), runId });
      } catch {
        reject(new Error("BODY_PROVIDER_OUTPUT_INVALID"));
      }
    });
    child.stdin.end(
      JSON.stringify({
        assetToken: preparation.assetToken,
        imagePath,
        inputRevision: preparation.inputRevision,
        manifestPath,
        modelPath,
        schemaVersion: "cimmich.ultralytics-yolo-body-request.v1",
        sourceContentDigest: preparation.sourceContentDigest,
      }),
    );
  });

try {
  process.stdout.write(
    `${JSON.stringify({
      action: "commit",
      first: await run("operator-run-a"),
      manifest,
      requestDigest: preparation.requestDigest,
      second: await run("operator-run-b"),
      sourceAssetId: preparation.sourceAssetId,
    })}\n`,
  );
} catch (error) {
  const code = /^[A-Z][A-Z0-9_]{2,95}$/.test(String(error?.message || ""))
    ? String(error.message)
    : "BODY_PROVIDER_PROCESS_FAILED";
  process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
  process.exitCode = 1;
}
