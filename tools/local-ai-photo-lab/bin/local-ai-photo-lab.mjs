#!/usr/bin/env node

import { resolve } from "node:path";
import { buildArchivePilotFromFiles } from "../src/archive-pilot.mjs";
import { runBenchmarkFromFiles } from "../src/benchmark.mjs";
import { writeBodyExecutionProfile } from "../src/body-profile.mjs";
import { runDoctorFromFile } from "../src/doctor.mjs";
import {
  notifyCancellation,
  terminateActiveProcesses,
} from "../src/processes.mjs";
import { runPhotoLabFromFiles } from "../src/runner.mjs";

const usage = () => `Usage:
  local-ai-photo-lab.mjs benchmark --config PATH --manifest PATH --fixture-root PATH --output PATH
  local-ai-photo-lab.mjs archive-pilot --imports-root PATH --thumb-root PATH --output PATH [--limit N] [--maximum-gap-seconds N]
  local-ai-photo-lab.mjs body-profile --source-manifest PATH --device cpu|gpu --output PATH
  local-ai-photo-lab.mjs doctor --config PATH
  local-ai-photo-lab.mjs run --config PATH (--photo PATH | --set PATH) --output PATH [--operations LIST]

Operations: faces,bodies,context,scene-text,enhance-preview,enhance or full`;

const parse = (argv) => {
  const command = argv[0];
  if (
    !["archive-pilot", "benchmark", "body-profile", "doctor", "run"].includes(
      command,
    )
  ) {
    throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
  }
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !flag?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
    }
    const key = flag.slice(2);
    if (
      ![
        "config",
        "device",
        "fixture-root",
        "imports-root",
        "limit",
        "manifest",
        "maximum-gap-seconds",
        "operations",
        "output",
        "photo",
        "set",
        "source-manifest",
        "thumb-root",
      ].includes(key) ||
      options[key] !== undefined
    ) {
      throw Object.assign(
        new Error(`unsupported or duplicate flag ${flag}\n${usage()}`),
        { code: "LOCAL_AI_USAGE" },
      );
    }
    options[key] = value;
  }
  if (command === "archive-pilot") {
    const required = ["imports-root", "output", "thumb-root"];
    const allowed = [...required, "limit", "maximum-gap-seconds"];
    if (
      required.some((key) => !options[key]) ||
      Object.keys(options).some((key) => !allowed.includes(key))
    ) {
      throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
    }
    return {
      command,
      importsRoot: resolve(options["imports-root"]),
      limit: options.limit === undefined ? 12 : Number(options.limit),
      maximumGapSeconds:
        options["maximum-gap-seconds"] === undefined
          ? 600
          : Number(options["maximum-gap-seconds"]),
      outputRoot: resolve(options.output),
      thumbRoot: resolve(options["thumb-root"]),
    };
  }
  if (command === "doctor") {
    if (
      !options.config ||
      Object.keys(options).some((key) => key !== "config")
    ) {
      throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
    }
    return { command, configPath: resolve(options.config) };
  }
  if (command === "body-profile") {
    const expected = ["device", "output", "source-manifest"];
    if (
      expected.some((key) => !options[key]) ||
      Object.keys(options).some((key) => !expected.includes(key))
    ) {
      throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
    }
    return {
      command,
      device: options.device,
      outputPath: resolve(options.output),
      sourceManifestPath: resolve(options["source-manifest"]),
    };
  }
  if (command === "benchmark") {
    const expected = ["config", "fixture-root", "manifest", "output"];
    if (
      expected.some((key) => !options[key]) ||
      Object.keys(options).some((key) => !expected.includes(key))
    ) {
      throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
    }
    return {
      command,
      configPath: resolve(options.config),
      fixtureRoot: resolve(options["fixture-root"]),
      manifestPath: resolve(options.manifest),
      outputRoot: resolve(options.output),
    };
  }
  if (
    !options.config ||
    !options.output ||
    Boolean(options.photo) === Boolean(options.set)
  ) {
    throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
  }
  return {
    command,
    configPath: resolve(options.config),
    operations: options.operations ?? "full",
    outputRoot: resolve(options.output),
    photoPath: options.photo ? resolve(options.photo) : undefined,
    setPath: options.set ? resolve(options.set) : undefined,
  };
};

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, async () => {
    const terminatedProviders = terminateActiveProcesses("SIGTERM");
    const recordedRuns = await notifyCancellation({ signal });
    process.stderr.write(
      `${JSON.stringify({ cancelled: true, recordedRuns, signal, terminatedProviders })}\n`,
    );
    process.exit(exitCode);
  });
}

try {
  const input = parse(process.argv.slice(2));
  if (input.command === "archive-pilot") {
    const output = await buildArchivePilotFromFiles(input);
    process.stdout.write(
      `${JSON.stringify(
        {
          candidateCount: output.receipt.candidateCount,
          outputRoot: output.outputRoot,
          selectedCount: output.receipt.selectedCount,
          state: output.receipt.state,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = output.receipt.state === "empty" ? 1 : 0;
  } else if (input.command === "benchmark") {
    const output = await runBenchmarkFromFiles(input);
    process.stdout.write(
      `${JSON.stringify(
        {
          resultPath: output.resultPath,
          scorecardPath: output.scorecardPath,
          state: output.receipt.state,
          summary: output.receipt.summary,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = output.receipt.state === "failed" ? 1 : 0;
  } else if (input.command === "body-profile") {
    const result = await writeBodyExecutionProfile(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (input.command === "doctor") {
    const result = await runDoctorFromFile(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.state === "failed" ? 1 : 0;
  } else {
    const output = await runPhotoLabFromFiles(input);
    process.stdout.write(
      `${JSON.stringify(
        {
          diffPath: output.diffPath,
          reportPath: output.reportPath,
          resultPath: output.resultPath,
          runId: output.result.runId,
          state: output.result.state,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = output.result.state === "failed" ? 1 : 0;
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: { code: error?.code ?? "LOCAL_AI_LAB_FAILED", message: error?.message ?? String(error) } })}\n`,
  );
  process.exitCode = 1;
}
