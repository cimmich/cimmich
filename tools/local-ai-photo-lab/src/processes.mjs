import { spawn } from "node:child_process";

const active = new Set();

export const trackedSpawn = (command, args, options) => {
  const child = spawn(command, args, options);
  active.add(child);
  const release = () => active.delete(child);
  child.once("close", release);
  child.once("error", release);
  return child;
};

export const activeProcessCount = () => active.size;

export const terminateActiveProcesses = (signal = "SIGTERM") => {
  let terminated = 0;
  for (const child of active) {
    if (
      child.exitCode === null &&
      child.signalCode === null &&
      child.kill(signal)
    ) {
      terminated += 1;
    }
  }
  return terminated;
};
