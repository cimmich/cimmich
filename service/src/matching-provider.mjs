const sha256Pattern = /^[0-9a-f]{64}$/;

export const normalizeMatchingProvider = (value) => {
  if (value == null) return null;
  const boundedId = (input, label, maximum = 160) => {
    const normalized = String(input || "").trim();
    if (
      !normalized ||
      normalized.length > maximum ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)
    ) {
      throw new Error(`Matching provider ${label} is invalid`);
    }
    return normalized;
  };
  const configDigest = String(value.configDigest || "").trim();
  if (!sha256Pattern.test(configDigest)) {
    throw new Error("Matching provider configDigest is invalid");
  }
  return Object.freeze({
    configDigest,
    modelFamily: boundedId(value.modelFamily, "modelFamily"),
    modelVersion: boundedId(value.modelVersion, "modelVersion"),
    providerId: boundedId(value.providerId, "providerId"),
    vectorSpaceId: boundedId(value.vectorSpaceId, "vectorSpaceId", 192),
  });
};
