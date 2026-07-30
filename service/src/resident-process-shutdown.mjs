const shutdownError = (message) =>
  Object.assign(new Error(message), { code: "PROVIDER_SHUTDOWN_INVALID" });

export const closeResidentProcess = async (
  child,
  { timeoutMs = 5_000 } = {},
) => {
  if (!child || child.killed) return { forced: false };
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 50 ||
    timeoutMs > 30_000
  ) {
    throw shutdownError("Provider shutdown timeout is invalid");
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (forced) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ forced });
    };
    child.once("close", () => finish(false));
    timer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
      finish(true);
    }, timeoutMs);
    try {
      child.stdin.end();
    } catch {
      if (!child.killed) child.kill("SIGKILL");
      finish(true);
    }
  });
};
