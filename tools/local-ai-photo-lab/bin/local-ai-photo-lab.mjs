#!/usr/bin/env node

import { resolve } from "node:path";
import { runBenchmarkFromFiles } from "../src/benchmark.mjs";
import { runDoctorFromFile } from "../src/doctor.mjs";
import { terminateActiveProcesses } from "../src/processes.mjs";
import { runPhotoLabFromFiles } from "../src/runner.mjs";

const usage = () => `Usage:
  local-ai-photo-lab.mjs benchmark --config PATH --manifest PATH --fixture-root PATH --output PATH
  local-ai-photo-lab.mjs doctor --config PATH
  local-ai-photo-lab.mjs run --config PATH (--photo PATH | --set PATH) --output PATH [--operations LIST]

Operations: faces,bodies,context,scene-text,enhance or full`;

const parse = (argv) => {
  const command = argv[0];
  if (!["benchmark", "doctor", "run"].includes(command)) {
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
        "fixture-root",
        "manifest",
        "operations",
        "output",
        "photo",
        "set",
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
  if (command === "doctor") {
    if (
      !options.config ||
      Object.keys(options).some((key) => key !== "config")
    ) {
      throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
    }
    return { command, configPath: resolve(options.config) };
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
  process.once(signal, () => {
    const terminatedProviders = terminateActiveProcesses("SIGTERM");
    process.stderr.write(
      `${JSON.stringify({ cancelled: true, signal, terminatedProviders })}\n`,
    );
    process.exit(exitCode);
  });
}

try {
  const input = parse(process.argv.slice(2));
  if (input.command === "benchmark") {
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
