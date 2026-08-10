import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  observeRequestTiming,
  safeRouteFamily,
} from "../src/request-diagnostics.mjs";

test("request diagnostics reduce paths to a bounded route family", () => {
  assert.equal(
    safeRouteFamily("/v1/people/person-1/assets?limit=120"),
    "v1.people",
  );
  assert.equal(safeRouteFamily("not a valid URL"), "not20a20valid20URL");
});

test("successful slow requests emit structured method, route and request identity", () => {
  const response = new EventEmitter();
  response.statusCode = 200;
  const messages = [];
  const originalInfo = console.info;
  console.info = (message) => messages.push(JSON.parse(message));
  try {
    observeRequestTiming({
      request: { method: "GET", url: "/v1/people/person-1" },
      requestId: "request-1",
      response,
      startedAt: performance.now() - 10,
      thresholdMs: 0,
    });
    response.emit("finish");
  } finally {
    console.info = originalInfo;
  }
  assert.equal(messages.length, 1);
  assert.deepEqual(
    {
      code: messages[0].code,
      method: messages[0].method,
      requestId: messages[0].requestId,
      routeFamily: messages[0].routeFamily,
      statusCode: messages[0].statusCode,
    },
    {
      code: "CIMMICH_REQUEST_SLOW",
      method: "GET",
      requestId: "request-1",
      routeFamily: "v1.people",
      statusCode: 200,
    },
  );
  assert.ok(messages[0].durationMs >= 0);
});
