import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { providerSubprocessEnvironment } from "./provider-subprocess-env.mjs";

const scorerError = (message) =>
  Object.assign(new Error(message), {
    code: "SOURCE_PACK_LOCAL_SCORER_FAILED",
  });

const requiredPath = (value, label) => {
  const normalized = String(value || "").trim();
  if (
    !normalized ||
    normalized.length > 1_000 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw scorerError(`SourcePack local scorer ${label} is invalid`);
  }
  return normalized;
};

export const createSourcePackNumpyScorer = ({
  pythonPath,
  scriptPath,
  timeoutMs = 120_000,
} = {}) => {
  const config = {
    pythonPath: requiredPath(pythonPath, "Python path"),
    scriptPath: requiredPath(scriptPath, "provider path"),
  };
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 600_000
  ) {
    throw scorerError("SourcePack local scorer timeout is invalid");
  }
  const child = spawn(config.pythonPath, [config.scriptPath], {
    env: providerSubprocessEnvironment(),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = [];
  let stopped = false;
  let stderrBytes = 0;
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 64 * 1024) child.kill("SIGKILL");
  });
  lines.on("line", (line) => {
    const request = pending.shift();
    if (!request) {
      child.kill("SIGKILL");
      return;
    }
    clearTimeout(request.timer);
    try {
      const response = JSON.parse(line);
      if (response?.error) {
        const reason = String(response.error.reason || "").trim();
        throw scorerError(
          reason
            ? `SourcePack local scorer rejected a batch: ${reason}`
            : "SourcePack local scorer rejected a batch",
        );
      }
      request.resolve(response);
    } catch (error) {
      request.reject(
        error?.code
          ? error
          : scorerError("SourcePack local scorer returned invalid output"),
      );
    }
  });
  const failPending = () => {
    stopped = true;
    for (const request of pending.splice(0)) {
      clearTimeout(request.timer);
      request.reject(scorerError("SourcePack local scorer stopped"));
    }
  };
  child.on("close", failPending);
  child.on("error", failPending);
  child.stdin.on("error", failPending);

  const request = (payload) =>
    new Promise((resolve, reject) => {
      if (stopped || child.killed) {
        reject(scorerError("SourcePack local scorer is unavailable"));
        return;
      }
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(scorerError("SourcePack local scorer timed out"));
      }, timeoutMs);
      pending.push({ reject, resolve, timer });
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    });

  return {
    async initialize(gallery) {
      const response = await request({ gallery, kind: "initialize" });
      if (response?.kind !== "ready")
        throw scorerError("SourcePack local scorer did not initialize");
    },
    async score({ marginFloor, queries, scoreFloor }) {
      const response = await request({
        kind: "score",
        marginFloor,
        queries,
        scoreFloor,
      });
      if (response?.kind !== "scores" || !Array.isArray(response.results)) {
        throw scorerError(
          "SourcePack local scorer returned an invalid score batch",
        );
      }
      return response.results;
    },
    async audit({ kind, queries }) {
      const response = await request({
        kind: "audit",
        auditKind: kind,
        queries,
      });
      if (
        response?.kind !== "audit_scores" ||
        !Array.isArray(response.results)
      ) {
        throw scorerError(
          "SourcePack local scorer returned an invalid identity-audit batch",
        );
      }
      return {
        comparableQueries: Number(response.comparableQueries || 0),
        results: response.results,
      };
    },
    stop() {
      stopped = true;
      lines.close();
      if (!child.killed) child.kill("SIGTERM");
      failPending();
    },
  };
};
