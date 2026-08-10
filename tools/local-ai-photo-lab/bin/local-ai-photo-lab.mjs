#!/usr/bin/env node

import { resolve } from "node:path";
import { runPhotoLabFromFiles } from "../src/runner.mjs";

const usage = () => `Usage:
  local-ai-photo-lab.mjs run --config PATH (--photo PATH | --set PATH) --output PATH [--operations LIST]

Operations: faces,bodies,context,scene-text,enhance or full`;

const parse = (argv) => {
  if (argv[0] !== "run")
    throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
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
      !["config", "operations", "output", "photo", "set"].includes(key) ||
      options[key] !== undefined
    ) {
      throw Object.assign(
        new Error(`unsupported or duplicate flag ${flag}\n${usage()}`),
        { code: "LOCAL_AI_USAGE" },
      );
    }
    options[key] = value;
  }
  if (
    !options.config ||
    !options.output ||
    Boolean(options.photo) === Boolean(options.set)
  ) {
    throw Object.assign(new Error(usage()), { code: "LOCAL_AI_USAGE" });
  }
  return {
    configPath: resolve(options.config),
    operations: options.operations ?? "full",
    outputRoot: resolve(options.output),
    photoPath: options.photo ? resolve(options.photo) : undefined,
    setPath: options.set ? resolve(options.set) : undefined,
  };
};

try {
  const output = await runPhotoLabFromFiles(parse(process.argv.slice(2)));
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
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: { code: error?.code ?? "LOCAL_AI_LAB_FAILED", message: error?.message ?? String(error) } })}\n`,
  );
  process.exitCode = 1;
}
