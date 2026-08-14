#!/usr/bin/env node
import postgres from "postgres";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createIdentityAudit } from "../src/identity-audit.mjs";
import { createImmichCompanionManager } from "../src/immich-companion-manager.mjs";
import { createLocalDHashSimilarityProvider } from "../src/local-dhash-similarity-provider.mjs";
import { createSourcePackNumpyScorer } from "../src/source-pack-numpy-scorer.mjs";

const value = (name, fallback = "") => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((argument) => argument.startsWith(prefix))
      ?.slice(prefix.length) || fallback
  );
};
const integer = (name, fallback, maximum, minimum = 1) => {
  const parsed = Number(value(name, String(fallback)));
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Identity audit ${name} must be from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
};

const serviceDirectory = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const providerRoot = path.resolve(
  serviceDirectory,
  "../providers/perceptual-dhash",
);
const manifestPath = path.join(providerRoot, "provider-manifest.json");
const pythonPath = value("python", "/usr/bin/python3");
const scorer = createSourcePackNumpyScorer({
  pythonPath,
  scriptPath: path.resolve(
    serviceDirectory,
    "../providers/source-pack-numpy/score.py",
  ),
  timeoutMs: 600_000,
});
const sql = postgres(
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  { max: 2, prepare: true },
);

try {
  const companion = await createImmichCompanionManager({
    apiBaseUrl: process.env.IMMICH_API_URL || "",
    apiKey: process.env.IMMICH_API_KEY || "",
  });
  const derivativeProvider = createLocalDHashSimilarityProvider({
    manifest: JSON.parse(await readFile(manifestPath, "utf8")),
    manifestPath,
    pythonPath,
    scriptPath: path.join(providerRoot, "provider.py"),
  });
  const audit = createIdentityAudit(sql, {
    companion,
    derivativeProvider,
    independenceComparisonLimit: integer("independence-limit", 100, 10_000),
    localScorer: scorer,
    presentationRank: () => integer("presentation-rank", 0, 2, 0),
    queryFrontierLimit: integer("frontier-limit", 1_000_000, 1_000_000),
    sourceId: process.env.CIMMICH_IMMICH_SOURCE_ID || "immich-primary",
  });
  await audit.start();
  const result = await audit.wait();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result?.state !== "completed") process.exitCode = 1;
} finally {
  scorer.stop();
  await sql.end({ timeout: 5 });
}
