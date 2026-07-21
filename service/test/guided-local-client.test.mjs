import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { createGuidedAccess } from "../src/guided-access.mjs";
import {
  guidedLocalClientConformanceContractDigest,
  guidedLocalClientConformanceSchemaVersion,
  runGuidedLocalClientConformance,
} from "../src/guided-local-client.mjs";

const token = "guided-local-client-token-0123456789abcdef";
const repository = {
  guidedEvidenceBacklog: async () => ({
    assets_with_unresolved_faces: 2,
    identified_faces: 3,
    linked_bodies: 1,
    manual_abstained: 0,
    manual_eligible_for_review: 0,
    manual_processing: 0,
    manual_waiting_for_provider: 1,
    unresolved_faces: 2,
    unlinked_bodies: 1,
    valid_bodies: 2,
  }),
  guidedLocalIntelligenceQueue: async () => [
    {
      asset_id: "asset-anonymous-1",
      asset_projection_state: "ready",
      body_analysis_state: "missing",
      manual_faces_waiting_for_provider: 1,
      reasons: ["manual_face_waiting_for_provider", "body_analysis_missing"],
      unlinked_bodies: 0,
      unresolved_faces: 1,
    },
  ],
  machineSuggestions: async () => [
    {
      candidates: [
        {
          person_id: "person-anonymous-1",
          prime_score: 0.88,
          rank: 1,
          secondary_score: null,
        },
      ],
      detection_confidence: 0.91,
      face_id: "face-anonymous-1",
      filename: "must-not-leak.jpg",
      margin: 0.12,
      quality_score: 0.8,
      review_reason: "clear_leader",
    },
  ],
  person: async () => ({}),
  summary: async () => ({
    accepted_presence: 1,
    assets: 4,
    candidate_signals: 2,
    people: 3,
    suggestions_ready: 1,
    user_decisions: 5,
  }),
};

const response = (body, status = 200) => ({
  status,
  text: async () => JSON.stringify(body),
});

const createTransport = ({ mutate } = {}) => {
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ options, url });
    guided.authorize(options.headers.authorization);
    const path = new URL(url).pathname;
    if (path.endsWith("/capabilities")) {
      const value = structuredClone(guided.capabilities());
      mutate?.("capabilities", value);
      return response(value);
    }
    if (path.endsWith("/instructions")) {
      const value = structuredClone(guided.instructions());
      mutate?.("instructions", value);
      return response(value);
    }
    const request = JSON.parse(options.body);
    const value = await guided.access(request, { requireProjection: () => {} });
    mutate?.(request.action, value);
    return response(value);
  };
  return { calls, transport };
};

test("non-Codex local script follows the neutral Guided recipe without disclosing its token", async () => {
  const { calls, transport } = createTransport();
  const receipt = await runGuidedLocalClientConformance({
    accessToken: token,
    baseUrl: "http://127.0.0.1:3101",
    transport,
  });
  assert.equal(
    receipt.schemaVersion,
    guidedLocalClientConformanceSchemaVersion,
  );
  assert.equal(receipt.status, "conformant");
  assert.equal(receipt.boundary.clientKind, "local_script");
  assert.equal(receipt.boundary.modelInference, "none");
  assert.equal(receipt.boundary.providerCredential, "none");
  assert.equal(receipt.boundary.visibility, "forced_standard");
  assert.equal(receipt.authority.mutation, "not_exposed");
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.equal(receipt.evidence.opportunityCount, 1);
  assert.equal(receipt.evidence.backlogCounts.unresolvedFaces, 2);
  assert.equal(receipt.evidence.backlogCounts.unlinkedBodies, 1);
  assert.equal(receipt.evidence.localQueueCount, 1);
  assert.deepEqual(receipt.evidence.localQueueReasonCounts, {
    body_analysis_missing: 1,
    manual_face_waiting_for_provider: 1,
  });
  assert.match(receipt.receiptDigest, /^[0-9a-f]{64}$/);
  assert.match(guidedLocalClientConformanceContractDigest, /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 7);
  assert.deepEqual(
    calls
      .filter(({ options }) => options.body)
      .map(({ options }) => JSON.parse(options.body).action),
    [
      "read.library_overview",
      "read.evidence_backlog",
      "read.local_intelligence_queue",
      "read.review_opportunities",
      "propose.review_plan",
    ],
  );
  for (const call of calls) {
    assert.equal(call.url.includes(token), false);
    assert.equal(call.options.body?.includes(token) || false, false);
    assert.equal(call.options.headers.authorization, `Bearer ${token}`);
  }
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes("person-anonymous-1"), false);
  assert.equal(serialized.includes("face-anonymous-1"), false);
  assert.equal(serialized.includes("must-not-leak"), false);
});

test("local runner works over real loopback HTTP and uses the server proposal surface", async () => {
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  const projections = [];
  const server = createServer(async (request, responseStream) => {
    try {
      guided.authorize(request.headers.authorization);
      let value;
      if (request.url === "/v1/guided/v1/capabilities") {
        value = guided.capabilities();
      } else if (request.url === "/v1/guided/v1/instructions") {
        value = guided.instructions();
      } else {
        let body = "";
        for await (const chunk of request) body += chunk;
        value = await guided.access(JSON.parse(body), {
          requireProjection: (surface) => projections.push(surface),
        });
      }
      responseStream.writeHead(200, { "content-type": "application/json" });
      responseStream.end(JSON.stringify(value));
    } catch (error) {
      responseStream.writeHead(error.statusCode || 500, {
        "content-type": "application/json",
      });
      responseStream.end(JSON.stringify({ code: error.code || "FAILED" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const child = spawn(
      process.execPath,
      ["bin/guided-local-conformance.mjs"],
      {
        cwd: new URL("..", import.meta.url),
        env: {
          ...process.env,
          CIMMICH_GUIDED_ACCESS_TOKEN: token,
          CIMMICH_GUIDED_BASE_URL: `http://127.0.0.1:${address.port}`,
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(exitCode, 0, stderr);
    assert.equal(stderr, "");
    const receipt = JSON.parse(stdout);
    assert.equal(receipt.status, "conformant");
    assert.deepEqual(projections, [
      "summary",
      "summary",
      "asset_evidence",
      "machine_suggestions",
      "machine_suggestions",
      "summary",
    ]);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("local runner rejects external origins, remote failures and privacy expansion", async () => {
  let dispatches = 0;
  await assert.rejects(
    runGuidedLocalClientConformance({
      accessToken: token,
      baseUrl: "https://provider.example",
      transport: async () => {
        dispatches += 1;
      },
    }),
    (error) => error.code === "GUIDED_LOCAL_CLIENT_INVALID",
  );
  assert.equal(dispatches, 0);

  await assert.rejects(
    runGuidedLocalClientConformance({
      accessToken: token,
      baseUrl: "http://localhost:3101",
      transport: async () => response({ secret: "must-not-echo" }, 503),
    }),
    (error) =>
      error.code === "GUIDED_LOCAL_CLIENT_REMOTE_ERROR" &&
      error.message.includes("must-not-echo") === false,
  );

  const { transport } = createTransport({
    mutate: (stage, value) => {
      if (stage === "read.library_overview") {
        value.result.filename = "forbidden.jpg";
      }
    },
  });
  await assert.rejects(
    runGuidedLocalClientConformance({
      accessToken: token,
      baseUrl: "http://[::1]:3101",
      transport,
    }),
    (error) => error.code === "GUIDED_LOCAL_CLIENT_PRIVACY_VIOLATION",
  );
});

test("CLI failure is fixed and never echoes a token or caller URL", () => {
  const sentinel = "guided-local-secret-token-0123456789abcdef";
  const result = spawnSync(
    process.execPath,
    ["bin/guided-local-conformance.mjs"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        CIMMICH_GUIDED_ACCESS_TOKEN: sentinel,
        CIMMICH_GUIDED_BASE_URL: "https://private.example/secret",
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes(sentinel), false);
  assert.equal(result.stderr.includes(sentinel), false);
  assert.equal(result.stderr.includes("private.example"), false);
  assert.deepEqual(JSON.parse(result.stderr), {
    code: "GUIDED_LOCAL_CLIENT_INVALID",
    status: "failed",
  });
});
