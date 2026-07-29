#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  dockerImageRetentionPlanDigest,
  planCimmichImageRetention,
} from "../service/src/docker-image-retention.mjs";

const CONFIRMATION = "DELETE-PLANNED-UNUSED-CIMMICH-IMAGES";

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const lines = (value) =>
  String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const optionValue = (name) => {
  const prefix = `${name}=`;
  const value = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
};

const execute = process.argv.includes("--execute");
const confirmation = optionValue("--confirm");
const expectedPlanDigest = optionValue("--expected-plan-digest");
const outputPath = optionValue("--output");
const rollbackValue = optionValue("--rollback-images-per-repository") || "2";
if (!/^\d+$/.test(rollbackValue)) {
  fail("--rollback-images-per-repository must be an integer");
}
if (execute && confirmation !== CONFIRMATION) {
  fail(`execution requires --confirm=${CONFIRMATION}`);
}
if (!execute && confirmation) {
  fail("--confirm is valid only with --execute");
}
if (execute && !/^[a-f0-9]{64}$/.test(expectedPlanDigest || "")) {
  fail("execution requires --expected-plan-digest from the reviewed dry run");
}
if (!execute && expectedPlanDigest) {
  fail("--expected-plan-digest is valid only with --execute");
}
if (outputPath && !path.isAbsolute(outputPath)) {
  fail("--output must be an absolute new file path");
}

const imageRows = lines(
  docker(["image", "ls", "--no-trunc", "--format", "{{json .}}"]),
)
  .map((line) => JSON.parse(line))
  .filter(({ Repository }) => Repository.startsWith("cimmich"));
const imageIds = [...new Set(imageRows.map(({ ID }) => ID))];
const imageMetadata = new Map(
  imageIds.length === 0
    ? []
    : lines(
        docker([
          "image",
          "inspect",
          "--format",
          "{{.Id}}\t{{.Size}}\t{{.Created}}",
          ...imageIds,
        ]),
      ).map((line) => {
        const [id, size, createdAt] = line.split("\t");
        return [id, { createdAt, sizeBytes: Number(size) }];
      }),
);
const allContainerIds = lines(docker(["container", "ls", "-aq"]));
const runningContainerIds = lines(docker(["container", "ls", "-q"]));
const inspectContainerImages = (containerIds) =>
  containerIds.length === 0
    ? []
    : lines(
        docker([
          "container",
          "inspect",
          "--format",
          "{{.Image}}",
          ...containerIds,
        ]),
      );

const plan = planCimmichImageRetention({
  activeImageIds: inspectContainerImages(runningContainerIds),
  containerImageIds: inspectContainerImages(allContainerIds),
  images: imageRows.map((row) => ({
    createdAt: imageMetadata.get(row.ID)?.createdAt,
    id: row.ID,
    repository: row.Repository,
    sizeBytes: imageMetadata.get(row.ID)?.sizeBytes || 0,
    tag: row.Tag,
  })),
  rollbackImagesPerRepository: Number(rollbackValue),
});
const planDigest = dockerImageRetentionPlanDigest(plan);
if (execute && planDigest !== expectedPlanDigest) {
  fail("live Docker state no longer matches the reviewed retention plan");
}
const manifest = {
  ...plan,
  generatedAt: new Date().toISOString(),
  mode: execute ? "execute" : "dry_run",
  planDigest,
};

if (execute) {
  for (const candidate of plan.candidates) {
    execFileSync("docker", ["image", "rm", candidate.reference], {
      stdio: "inherit",
    });
  }
}

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, serialized, { flag: "wx", mode: 0o600 });
}
process.stdout.write(serialized);
