const nonNegativeBigInt = (value, label) => {
  let normalized;
  try {
    normalized = BigInt(value);
  } catch {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  if (normalized < 0n) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return normalized;
};

export const evaluateStorageBudget = ({
  availableBytes,
  requiredWorkingBytes,
  reserveBytes,
}) => {
  const available = nonNegativeBigInt(availableBytes, "availableBytes");
  const required = nonNegativeBigInt(
    requiredWorkingBytes,
    "requiredWorkingBytes",
  );
  const reserve = nonNegativeBigInt(reserveBytes, "reserveBytes");
  const threshold = required + reserve;
  const ready = available >= threshold;

  return {
    availableBytes: available.toString(),
    contractVersion: "cimmich.storage-budget-preflight.v1",
    deficitBytes: ready ? "0" : (threshold - available).toString(),
    ready,
    requiredWorkingBytes: required.toString(),
    reserveBytes: reserve.toString(),
    status: ready ? "READY" : "BLOCKED",
    thresholdBytes: threshold.toString(),
  };
};
