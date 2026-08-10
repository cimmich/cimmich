import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { digest } from "./contract.mjs";
import { runPhotoLab } from "./runner.mjs";

const benchmarkSchema = "cimmich.local-ai-photo-lab-benchmark.v1";

const assertion = (assertionId, passed, expected, actual) => ({
  actual,
  assertionId,
  expected,
  passed,
});

const rangeAssertions = (label, value, range) =>
  range
    ? [
        assertion(`${label}.minimum`, value >= range.min, range.min, value),
        assertion(`${label}.maximum`, value <= range.max, range.max, value),
      ]
    : [];

export const evaluateBenchmarkCase = ({ expectations, result }) => {
  const assertions = [
    assertion(
      "run.completed",
      result.state === "completed",
      "completed",
      result.state,
    ),
    assertion(
      "originals.unchanged",
      result.originalsUnchanged === true,
      true,
      result.originalsUnchanged,
    ),
  ];
  const assets = new Map(result.assets.map((asset) => [asset.assetId, asset]));
  for (const [assetId, expected] of Object.entries(expectations.assets ?? {})) {
    const asset = assets.get(assetId);
    assertions.push(
      assertion(`${assetId}.present`, Boolean(asset), true, Boolean(asset)),
    );
    if (!asset) continue;
    const faces = asset.operations.faces?.faces ?? [];
    const bodies = asset.operations.bodies?.bodies ?? [];
    for (const [operation, mode] of Object.entries(
      expectations.executionModes ?? {},
    )) {
      assertions.push(
        assertion(
          `${assetId}.${operation}.executionMode`,
          asset.operations[operation]?.provider?.executionMode === mode,
          mode,
          asset.operations[operation]?.provider?.executionMode,
        ),
      );
    }
    for (const [operation, state] of Object.entries(
      expected.operationStates ?? {},
    )) {
      assertions.push(
        assertion(
          `${assetId}.${operation}.state`,
          asset.operations[operation]?.state === state,
          state,
          asset.operations[operation]?.state,
        ),
      );
    }
    if (expected.image) {
      assertions.push(
        assertion(
          `${assetId}.image.width`,
          asset.image?.width === expected.image.width,
          expected.image.width,
          asset.image?.width,
        ),
        assertion(
          `${assetId}.image.height`,
          asset.image?.height === expected.image.height,
          expected.image.height,
          asset.image?.height,
        ),
      );
    }
    assertions.push(
      ...rangeAssertions(`${assetId}.faces`, faces.length, expected.faces),
    );
    assertions.push(
      ...rangeAssertions(`${assetId}.bodies`, bodies.length, expected.bodies),
    );
    assertions.push(
      ...rangeAssertions(
        `${assetId}.peopleEstimate`,
        asset.operations.sceneText?.proposal?.peopleCountEstimate ?? 0,
        expected.peopleEstimate,
      ),
    );
    if (expected.maxFaceReview !== undefined) {
      const review = faces.filter(
        (face) => face.quality?.reviewReasons?.length,
      ).length;
      assertions.push(
        assertion(
          `${assetId}.maxFaceReview`,
          review <= expected.maxFaceReview,
          expected.maxFaceReview,
          review,
        ),
      );
    }
    if (expected.maximumUnreviewedFaces !== undefined) {
      const unreviewed = faces.filter(
        (face) => !face.quality?.reviewReasons?.length,
      ).length;
      assertions.push(
        assertion(
          `${assetId}.maximumUnreviewedFaces`,
          unreviewed <= expected.maximumUnreviewedFaces,
          expected.maximumUnreviewedFaces,
          unreviewed,
        ),
      );
    }
    if (expected.crossModelState) {
      assertions.push(
        assertion(
          `${assetId}.crossModelState`,
          asset.crossModelChecks?.state === expected.crossModelState,
          expected.crossModelState,
          asset.crossModelChecks?.state,
        ),
      );
    }
    for (const reason of expected.reasonCodesIncludes ?? []) {
      assertions.push(
        assertion(
          `${assetId}.reason.${reason}`,
          asset.crossModelChecks?.reasonCodes?.includes(reason) === true,
          true,
          asset.crossModelChecks?.reasonCodes?.includes(reason) === true,
        ),
      );
    }
    const visibleText = asset.operations.sceneText?.proposal?.visibleText ?? [];
    assertions.push(
      ...rangeAssertions(
        `${assetId}.visibleText`,
        visibleText.length,
        expected.visibleText,
      ),
    );
    for (const text of expected.visibleTextIncludes ?? []) {
      assertions.push(
        assertion(
          `${assetId}.text.${text}`,
          visibleText.includes(text),
          true,
          visibleText.includes(text),
        ),
      );
    }
    for (const text of expected.visibleTextExcludes ?? []) {
      assertions.push(
        assertion(
          `${assetId}.textExcludes.${text}`,
          visibleText.includes(text) === false,
          false,
          visibleText.includes(text),
        ),
      );
    }
    if (expected.enhance) {
      const enhance = asset.operations.enhance;
      assertions.push(
        assertion(
          `${assetId}.enhance.width`,
          enhance?.width === expected.enhance.width,
          expected.enhance.width,
          enhance?.width,
        ),
        assertion(
          `${assetId}.enhance.height`,
          enhance?.height === expected.enhance.height,
          expected.enhance.height,
          enhance?.height,
        ),
        assertion(
          `${assetId}.enhance.artifact`,
          Boolean(enhance?.artifact?.digest && enhance?.artifact?.path),
          true,
          Boolean(enhance?.artifact?.digest && enhance?.artifact?.path),
        ),
      );
      for (const [metric, range] of Object.entries(
        expected.enhance.quality ?? {},
      )) {
        assertions.push(
          ...rangeAssertions(
            `${assetId}.enhance.quality.${metric}`,
            enhance?.quality?.[metric],
            range,
          ),
        );
      }
    }
  }
  const supported = (result.context?.candidates ?? []).filter(
    (candidate) =>
      candidate.state === "supported" || candidate.state === "possible",
  );
  for (const expected of expectations.contextCandidates ?? []) {
    const matched = supported.some(
      (candidate) =>
        candidate.assetId === expected.assetId &&
        candidate.kind === expected.kind &&
        candidate.subject === expected.subject &&
        candidate.state === expected.state,
    );
    assertions.push(
      assertion(
        `context.${expected.assetId}.${expected.subject}.${expected.kind}`,
        matched,
        true,
        matched,
      ),
    );
  }
  if (expectations.maximumUnexpectedContextCandidates !== undefined) {
    const expectedKeys = new Set(
      (expectations.contextCandidates ?? []).map(
        (candidate) =>
          `${candidate.assetId}|${candidate.kind}|${candidate.subject}|${candidate.state}`,
      ),
    );
    const unexpected = supported.filter(
      (candidate) =>
        !expectedKeys.has(
          `${candidate.assetId}|${candidate.kind}|${candidate.subject}|${candidate.state}`,
        ),
    ).length;
    assertions.push(
      assertion(
        "context.maximumUnexpected",
        unexpected <= expectations.maximumUnexpectedContextCandidates,
        expectations.maximumUnexpectedContextCandidates,
        unexpected,
      ),
    );
  }
  const passed = assertions.filter((item) => item.passed).length;
  return {
    assertions,
    state: passed === assertions.length ? "passed" : "failed",
    summary: {
      failed: assertions.length - passed,
      passed,
      total: assertions.length,
    },
  };
};

const loadManifest = async (path) => {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (
    value?.schemaVersion !== benchmarkSchema ||
    typeof value.benchmarkId !== "string" ||
    !Array.isArray(value.cases) ||
    !value.cases.length
  ) {
    throw Object.assign(new Error("benchmark manifest is invalid"), {
      code: "LOCAL_AI_BENCHMARK_INVALID",
    });
  }
  return value;
};

const fixturePath = async (fixtureRoot, path) => {
  if (typeof path !== "string" || !path || path.includes("\0")) {
    throw Object.assign(new Error("benchmark fixture path is invalid"), {
      code: "LOCAL_AI_BENCHMARK_INVALID",
    });
  }
  const resolved = resolve(fixtureRoot, path);
  const child = relative(fixtureRoot, resolved);
  if (!child || child === ".." || child.startsWith(`..${sep}`)) {
    throw Object.assign(new Error("benchmark fixture escaped its root"), {
      code: "LOCAL_AI_BENCHMARK_FIXTURE_FORBIDDEN",
    });
  }
  try {
    const [realRoot, realCandidate] = await Promise.all([
      realpath(fixtureRoot),
      realpath(resolved),
    ]);
    const realChild = relative(realRoot, realCandidate);
    if (
      !realChild ||
      realChild === ".." ||
      realChild.startsWith(`..${sep}`) ||
      !(await stat(realCandidate)).isFile()
    ) {
      throw Object.assign(new Error("benchmark fixture escaped its root"), {
        code: "LOCAL_AI_BENCHMARK_FIXTURE_FORBIDDEN",
      });
    }
    return realCandidate;
  } catch (error) {
    if (error?.code === "LOCAL_AI_BENCHMARK_FIXTURE_FORBIDDEN") throw error;
    throw Object.assign(new Error("benchmark fixture is unavailable"), {
      code: "LOCAL_AI_BENCHMARK_FIXTURE_UNAVAILABLE",
    });
  }
};

const scorecard = (receipt) => {
  const lines = [
    `# Local AI benchmark — ${receipt.benchmarkId}`,
    "",
    `State: **${receipt.state}**`,
    "",
    `- Assertions: ${receipt.summary.passed}/${receipt.summary.total} passed`,
    `- Failed: ${receipt.summary.failed}`,
    "",
    "| Case | State | Passed | Failed | Result |",
    "|---|---:|---:|---:|---|",
  ];
  for (const item of receipt.cases) {
    lines.push(
      `| ${item.caseId} | ${item.state} | ${item.summary.passed} | ${item.summary.failed} | \`${item.resultPath}\` |`,
    );
  }
  const failures = receipt.cases.flatMap((item) =>
    item.assertions
      .filter((candidate) => !candidate.passed)
      .map(
        (candidate) =>
          `- ${item.caseId}/${candidate.assertionId}: expected ${JSON.stringify(candidate.expected)}, got ${JSON.stringify(candidate.actual)}`,
      ),
  );
  lines.push(
    "",
    "## Failures",
    "",
    failures.length ? failures.join("\n") : "None.",
    "",
  );
  return `${lines.join("\n")}\n`;
};

export const runBenchmark = async ({
  configInput,
  fixtureRoot,
  manifestInput,
  outputRoot,
  providerImplementations,
}) => {
  const benchmarkId = String(manifestInput.benchmarkId);
  const preparedCases = [];
  for (const item of manifestInput.cases) {
    preparedCases.push({
      item,
      setInput: {
        assets: await Promise.all(
          item.assets.map(async ({ fixturePath: path, ...asset }) => ({
            ...asset,
            path: await fixturePath(fixtureRoot, path),
          })),
        ),
        contextKind: item.contextKind,
        schemaVersion: "cimmich.local-ai-photo-set.v1",
        setId: `${benchmarkId}-${item.caseId}`,
      },
    });
  }
  const runKey = `${Date.now()}-${digest(manifestInput).slice(0, 12)}`;
  const runRoot = join(
    outputRoot,
    "benchmarks",
    benchmarkId.replaceAll(/[^a-zA-Z0-9._-]/g, "-"),
    runKey,
  );
  await mkdir(runRoot, { recursive: true });
  const cases = [];
  for (const { item, setInput } of preparedCases) {
    const output = await runPhotoLab({
      configInput,
      operationsInput: item.operations,
      outputRoot: join(runRoot, "case-runs"),
      providerImplementations,
      setInput,
    });
    const evaluation = evaluateBenchmarkCase({
      expectations: item.expectations,
      result: output.result,
    });
    cases.push({
      ...evaluation,
      caseId: item.caseId,
      resultPath: relative(runRoot, output.resultPath),
      runId: output.result.runId,
    });
  }
  const total = cases.reduce((value, item) => value + item.summary.total, 0);
  const passed = cases.reduce((value, item) => value + item.summary.passed, 0);
  const receipt = {
    benchmarkId,
    cases,
    createdAt: new Date().toISOString(),
    manifestDigest: digest(manifestInput),
    schemaVersion: "cimmich.local-ai-photo-lab-benchmark-result.v1",
    state: passed === total ? "passed" : "failed",
    summary: { failed: total - passed, passed, total },
  };
  const resultPath = join(runRoot, "benchmark-result.json");
  const scorecardPath = join(runRoot, "scorecard.md");
  await writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
  });
  await writeFile(scorecardPath, scorecard(receipt), { mode: 0o600 });
  return { receipt, resultPath, runRoot, scorecardPath };
};

export const runBenchmarkFromFiles = async ({
  configPath,
  fixtureRoot,
  manifestPath,
  outputRoot,
}) =>
  runBenchmark({
    configInput: JSON.parse(await readFile(configPath, "utf8")),
    fixtureRoot: resolve(fixtureRoot),
    manifestInput: await loadManifest(manifestPath),
    outputRoot,
  });

export { benchmarkSchema };
