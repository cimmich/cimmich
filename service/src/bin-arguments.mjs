// Shared `--name value` argument helpers for service bins. One definition of
// the spaced-argument idiom that most operator bins previously re-declared.

export const argumentValue = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : null;
  return value && !value.startsWith("--") ? value : fallback;
};

export const optionalArgument = (name) => argumentValue(name, null);

export const requiredArgument = (name) => {
  const value = optionalArgument(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};

export const booleanFlag = (name) => process.argv.includes(`--${name}`);

export const requiredText = (value, label, context) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${context} requires ${label}`);
  return normalized;
};

export const boundedInteger = (value, label, minimum, maximum, fallback) => {
  if (value === null && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
};
