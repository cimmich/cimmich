#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const safeInteger = (value) => (Number.isInteger(value) ? value : null);
const responseCodes = new Set([
  "IMMICH_OWNER_BINDING_CONFLICT",
  "IMMICH_OWNER_ORIGIN_REQUIRED",
  "IMMICH_OWNER_SESSION_FORBIDDEN",
  "IMMICH_OWNER_SESSION_INVALID",
  "IMMICH_OWNER_SESSION_REQUIRED",
  "IMMICH_OWNER_SESSION_ROUTE_UNAVAILABLE",
  "IMMICH_OWNER_SESSION_UNAVAILABLE",
]);
const transportCodes = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const safeCode = (value, allowed, fallback = null) =>
  typeof value === "string" && allowed.has(value) ? value : fallback;

export class OwnerGatewaySummaryProbeError extends Error {
  constructor(message, diagnostic) {
    super(message);
    this.name = "OwnerGatewaySummaryProbeError";
    this.diagnostic = Object.freeze({
      ...diagnostic,
      message,
      phase: "owner-gateway-summary",
      result: "FAIL",
    });
  }
}

export const probeOwnerGatewaySummary = async ({
  credentialPath,
  expectedPeople = 7,
  fetchImpl = fetch,
  outputPath,
  url,
}) => {
  let credential;
  try {
    credential = JSON.parse(await readFile(credentialPath, "utf8"));
  } catch {
    throw new OwnerGatewaySummaryProbeError("credential could not be read", {
      category: "credential",
    });
  }
  if (
    typeof credential?.apiKey !== "string" ||
    credential.apiKey.length === 0
  ) {
    throw new OwnerGatewaySummaryProbeError("credential has no API key", {
      category: "credential",
    });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { "x-api-key": credential.apiKey },
    });
  } catch (error) {
    throw new OwnerGatewaySummaryProbeError("gateway request failed", {
      category: "transport",
      errorCode: safeCode(
        error?.cause?.code || error?.code,
        transportCodes,
        "UNKNOWN",
      ),
    });
  }

  const body = await response.text();
  await writeFile(outputPath, body, { mode: 0o600 });
  let summary;
  try {
    summary = JSON.parse(body);
  } catch {
    throw new OwnerGatewaySummaryProbeError("gateway response was not JSON", {
      category: "response",
      status: response.status,
    });
  }

  const diagnostic = {
    assets: safeInteger(summary.assets),
    category: "response",
    code: safeCode(summary.code, responseCodes),
    people: safeInteger(summary.people),
    status: response.status,
  };
  if (response.status !== 200) {
    throw new OwnerGatewaySummaryProbeError(
      "gateway returned an unexpected HTTP status",
      diagnostic,
    );
  }
  if (!Number.isInteger(summary.assets) || summary.assets < 1) {
    throw new OwnerGatewaySummaryProbeError(
      "gateway returned an invalid asset count",
      diagnostic,
    );
  }
  if (summary.people !== expectedPeople) {
    throw new OwnerGatewaySummaryProbeError(
      "gateway returned an unexpected people projection",
      diagnostic,
    );
  }
  return Object.freeze({
    ...diagnostic,
    phase: "owner-gateway-summary",
    result: "PASS",
  });
};

const run = async () => {
  const [credentialPath, url, outputPath] = process.argv.slice(2);
  if (!credentialPath || !url || !outputPath) {
    process.stderr.write(
      "usage: owner_gateway_summary_probe.mjs <credential.json> <url> <response.json>\n",
    );
    process.exitCode = 2;
    return;
  }
  try {
    const result = await probeOwnerGatewaySummary({
      credentialPath,
      outputPath,
      url,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const diagnostic =
      error instanceof OwnerGatewaySummaryProbeError
        ? error.diagnostic
        : {
            category: "internal",
            message: "owner gateway summary probe failed internally",
            phase: "owner-gateway-summary",
            result: "FAIL",
          };
    process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await run();
