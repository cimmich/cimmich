#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { validateRecognitionProviderManifest } from "../src/recognition-provider-contract.mjs";

const argument = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return String(value?.slice(prefix.length) || "").trim();
};

const requiredPath = (name) => {
  const value = argument(name);
  if (!path.isAbsolute(value)) {
    throw new Error(`Face provider ${name} must be an absolute path`);
  }
  return path.normalize(value);
};

const fileDigest = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const manifestPath = requiredPath("manifest");
const detectorPath = requiredPath("detector");
const recognizerPath = requiredPath("recognizer");
const targetRoot = requiredPath("target");
const execute = process.argv.includes("--execute");
const manifest = validateRecognitionProviderManifest(
  JSON.parse(await readFile(manifestPath, "utf8")),
);

if (manifest.provider.name !== "insightface-user-supplied-cpu") {
  throw new Error("Face provider manifest targets an unsupported provider");
}
if (!manifest.recognitionSpaceExplicit) {
  throw new Error(
    "Face provider manifest must declare its exact recognition space",
  );
}
const [detectorDigest, recognizerDigest] = await Promise.all([
  fileDigest(detectorPath),
  fileDigest(recognizerPath),
]);
if (detectorDigest !== manifest.detector.artifactSha256) {
  throw new Error("Face provider detector digest does not match its manifest");
}
if (recognizerDigest !== manifest.recognizer.artifactSha256) {
  throw new Error(
    "Face provider recognizer digest does not match its manifest",
  );
}

if (execute) {
  await mkdir(targetRoot, { mode: 0o700, recursive: true });
  const nonce = randomUUID();
  const staged = {
    detector: path.join(targetRoot, `.detector.${nonce}.onnx`),
    manifest: path.join(targetRoot, `.manifest.${nonce}.json`),
    recognizer: path.join(targetRoot, `.recognizer.${nonce}.onnx`),
  };
  try {
    await Promise.all([
      copyFile(detectorPath, staged.detector),
      copyFile(manifestPath, staged.manifest),
      copyFile(recognizerPath, staged.recognizer),
    ]);
    await Promise.all(Object.values(staged).map((item) => chmod(item, 0o444)));
    await rename(staged.detector, path.join(targetRoot, "detector.onnx"));
    await rename(staged.recognizer, path.join(targetRoot, "recognizer.onnx"));
    // The manifest is the commit marker. Runtime validation fails closed if
    // files and manifest ever disagree.
    await rename(
      staged.manifest,
      path.join(targetRoot, "provider-manifest.json"),
    );
  } finally {
    await Promise.all(
      Object.values(staged).map((item) => rm(item, { force: true })),
    );
  }
}

console.log(
  JSON.stringify({
    execute,
    modelFamily: manifest.recognitionSpace.modelFamily,
    modelVersion: manifest.recognitionSpace.modelVersion,
    providerConfigDigest: manifest.recognitionSpaceConfigDigest,
    providerId: manifest.provider.name,
    state: execute ? "configured" : "validated",
    vectorSpaceId: manifest.vectorSpaceId,
  }),
);
