import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { closeResidentProcess } from "../src/resident-process-shutdown.mjs";

const fakeChild = ({ closeOnEnd }) => {
  const child = new EventEmitter();
  child.killed = false;
  child.killSignals = [];
  child.kill = (signal) => {
    child.killed = true;
    child.killSignals.push(signal);
  };
  child.stdin = {
    end() {
      if (closeOnEnd) queueMicrotask(() => child.emit("close"));
    },
  };
  return child;
};

test("provider shutdown accepts a cooperative resident process", async () => {
  const child = fakeChild({ closeOnEnd: true });
  assert.deepEqual(await closeResidentProcess(child, { timeoutMs: 50 }), {
    forced: false,
  });
  assert.deepEqual(child.killSignals, []);
});

test("provider shutdown kills a resident process that ignores EOF", async () => {
  const child = fakeChild({ closeOnEnd: false });
  assert.deepEqual(await closeResidentProcess(child, { timeoutMs: 50 }), {
    forced: true,
  });
  assert.deepEqual(child.killSignals, ["SIGKILL"]);
});

test("provider shutdown rejects an unbounded timeout", async () => {
  await assert.rejects(
    closeResidentProcess(fakeChild({ closeOnEnd: true }), { timeoutMs: 0 }),
    { code: "PROVIDER_SHUTDOWN_INVALID" },
  );
});
