const nonNegativeBigInt = (value, label) => {
  // BigInt() alone coerces booleans and the empty string to 0n/1n; only
  // accept a bigint, an integral number, or an all-digit string.
  const acceptable =
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isInteger(value)) ||
    (typeof value === "string" && /^\d+$/.test(value));
  if (!acceptable) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  const normalized = BigInt(value);
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
