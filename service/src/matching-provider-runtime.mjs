import { readFile } from "node:fs/promises";
import { validateRecognitionProviderManifest } from "./recognition-provider-contract.mjs";

export const matchingProviderRuntimeVersion =
  "cimmich.matching-provider-runtime.v1";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const sameRecognitionSpace = (left, right) =>
  Boolean(left && right) &&
  left.configDigest === right.configDigest &&
  left.modelFamily === right.modelFamily &&
  left.modelVersion === right.modelVersion &&
  left.providerConfigDigest === right.providerConfigDigest &&
  left.vectorSpaceId === right.vectorSpaceId;

export const loadMatchingProviderRuntime = async ({
  env = process.env,
  fallbackProvider = null,
  fallbackReceipt = null,
  readManifest = readJson,
} = {}) => {
  const manifestPath = String(
    env.CIMMICH_MATCHING_PROVIDER_MANIFEST_PATH || "",
  ).trim();
  if (!manifestPath) {
    return {
      matchingProvider: fallbackProvider,
      providerReceipt: fallbackReceipt,
      recognitionCompatible: Boolean(fallbackProvider),
      source: fallbackProvider ? "local_media_provider" : "disabled",
    };
  }

  const manifest = validateRecognitionProviderManifest(
    await readManifest(manifestPath),
  );
  const matchingProvider = Object.freeze({
    configDigest: manifest.recognitionSpaceConfigDigest,
    modelFamily: manifest.recognitionSpace.modelFamily,
    modelVersion: manifest.recognitionSpace.modelVersion,
    providerConfigDigest: manifest.providerConfigDigest,
    providerId: manifest.provider.name,
    vectorSpaceId: manifest.vectorSpaceId,
  });
  const recognitionCompatible = sameRecognitionSpace(
    matchingProvider,
    fallbackProvider,
  );
  return {
    matchingProvider,
    providerReceipt: Object.freeze({
      activationAuthority: "none",
      configDigest: matchingProvider.configDigest,
      providerConfigDigest: matchingProvider.providerConfigDigest,
      providerId: matchingProvider.providerId,
      recognitionExecution:
        recognitionCompatible ? "local_media_provider" : "unavailable",
      schemaVersion: matchingProviderRuntimeVersion,
      source: "validated_recognition_manifest",
      state: "ready",
      vectorSpaceId: matchingProvider.vectorSpaceId,
    }),
    recognitionCompatible,
    source: "validated_recognition_manifest",
  };
};
