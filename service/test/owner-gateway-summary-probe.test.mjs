import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  OwnerGatewaySummaryProbeError,
  probeOwnerGatewaySummary,
} from "../../tools/owner_gateway_summary_probe.mjs";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "cimmich-owner-gateway-probe-"));
  const credentialPath = join(root, "credential.json");
  const outputPath = join(root, "response.json");
  await writeFile(credentialPath, '{"apiKey":"fixture-owner-key"}\n', {
    mode: 0o600,
  });
  return { credentialPath, outputPath };
};

test("owner gateway summary probe proves the strict projected response", async () => {
  const paths = await fixture();
  const result = await probeOwnerGatewaySummary({
    ...paths,
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers["x-api-key"], "fixture-owner-key");
      return new Response(JSON.stringify({ assets: 35, people: 7 }), {
        status: 200,
      });
    },
    url: "http://127.0.0.1:3303/cimmich-api/v1/summary",
  });
  assert.deepEqual(result, {
    assets: 35,
    category: "response",
    code: null,
    people: 7,
    phase: "owner-gateway-summary",
    result: "PASS",
    status: 200,
  });
  assert.deepEqual(JSON.parse(await readFile(paths.outputPath, "utf8")), {
    assets: 35,
    people: 7,
  });
});

test("owner gateway summary probe reports safe HTTP and projection failures", async () => {
  const paths = await fixture();
  await assert.rejects(
    probeOwnerGatewaySummary({
      ...paths,
      fetchImpl: async () =>
        new Response(JSON.stringify({ code: "OWNER_AUTH_REQUIRED" }), {
          status: 401,
        }),
      url: "http://127.0.0.1:3303/cimmich-api/v1/summary",
    }),
    (error) => {
      assert.equal(error instanceof OwnerGatewaySummaryProbeError, true);
      assert.deepEqual(error.diagnostic, {
        assets: null,
        category: "response",
        code: "OWNER_AUTH_REQUIRED",
        message: "gateway returned an unexpected HTTP status",
        people: null,
        phase: "owner-gateway-summary",
        result: "FAIL",
        status: 401,
      });
      return true;
    },
  );

  await assert.rejects(
    probeOwnerGatewaySummary({
      ...paths,
      fetchImpl: async () =>
        new Response(JSON.stringify({ assets: 35, people: 9 }), {
          status: 200,
        }),
      url: "http://127.0.0.1:3303/cimmich-api/v1/summary",
    }),
    (error) => {
      assert.equal(
        error.diagnostic.message,
        "gateway returned an unexpected people projection",
      );
      assert.equal(error.diagnostic.people, 9);
      assert.equal(error.diagnostic.status, 200);
      return true;
    },
  );
});

test("owner gateway summary probe reports transport failures without credentials", async () => {
  const paths = await fixture();
  await assert.rejects(
    probeOwnerGatewaySummary({
      ...paths,
      fetchImpl: async () => {
        throw Object.assign(new Error("private transport detail"), {
          cause: { code: "ECONNRESET" },
        });
      },
      url: "http://127.0.0.1:3303/cimmich-api/v1/summary",
    }),
    (error) => {
      assert.deepEqual(error.diagnostic, {
        category: "transport",
        errorCode: "ECONNRESET",
        message: "gateway request failed",
        phase: "owner-gateway-summary",
        result: "FAIL",
      });
      assert.doesNotMatch(
        JSON.stringify(error.diagnostic),
        /fixture-owner-key/u,
      );
      assert.doesNotMatch(
        JSON.stringify(error.diagnostic),
        /private transport detail/u,
      );
      return true;
    },
  );
});

test("public demo acceptance uses the diagnostic probe instead of silent assertions", async () => {
  const acceptance = await readFile(
    new URL("../../tools/public_demo_acceptance.sh", import.meta.url),
    "utf8",
  );
  assert.match(
    acceptance,
    /node "\$ROOT\/tools\/owner_gateway_summary_probe\.mjs"/u,
  );
  assert.doesNotMatch(acceptance, /\.catch\(\(\) => process\.exit\(1\)\)/u);
});
