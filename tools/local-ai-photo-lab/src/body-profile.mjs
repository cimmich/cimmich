import { readFile, writeFile } from "node:fs/promises";
import { digest } from "./contract.mjs";

const supportedDevices = new Set(["cpu", "gpu"]);

export const deriveBodyExecutionProfile = (source, device) => {
  if (
    source?.schemaVersion !== "cimmich.body-detector.v1" ||
    !source.execution ||
    !source.detector ||
    !source.privacy
  ) {
    throw Object.assign(new Error("source body manifest is invalid"), {
      code: "LOCAL_AI_BODY_MANIFEST_INVALID",
    });
  }
  if (!supportedDevices.has(device)) {
    throw Object.assign(new Error("body execution device is unsupported"), {
      code: "LOCAL_AI_BODY_DEVICE_INVALID",
    });
  }
  const { detectorConfigDigest: _discarded, ...core } = source;
  const profiled = {
    ...core,
    execution: { ...core.execution, device },
  };
  return { ...profiled, detectorConfigDigest: digest(profiled) };
};

export const writeBodyExecutionProfile = async ({
  device,
  outputPath,
  sourceManifestPath,
}) => {
  const source = JSON.parse(await readFile(sourceManifestPath, "utf8"));
  const profile = deriveBodyExecutionProfile(source, device);
  await writeFile(outputPath, `${JSON.stringify(profile, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return {
    detectorConfigDigest: profile.detectorConfigDigest,
    device,
    outputPath,
    schemaVersion: "cimmich.local-ai-photo-lab-body-profile.v1",
  };
};
