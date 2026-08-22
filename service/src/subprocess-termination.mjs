export const createSubprocessTerminator = (
  child,
  { killGraceMs = 1000 } = {},
) => {
  let killTimer = null;
  const clearKillTimer = () => {
    if (killTimer) clearTimeout(killTimer);
    killTimer = null;
  };
  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    clearKillTimer();
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, killGraceMs);
    killTimer.unref?.();
  };
  return { clearKillTimer, terminate };
};
