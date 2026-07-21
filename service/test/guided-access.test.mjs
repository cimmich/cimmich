import assert from "node:assert/strict";
import test from "node:test";
import {
  createGuidedAccess,
  guidedAccessSchemaVersion,
  guidedInstructionsSchemaVersion,
} from "../src/guided-access.mjs";

const token = "guided-access-token-0123456789abcdef";

const repository = {
  integrationStatus: async () => ({
    analyzedAssets: 50,
    assets: 50,
    bodyObservations: 81,
    linkedBodies: 9,
    state: "complete",
  }),
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
  guidedLocalIntelligenceQueue: async ({ limit }) =>
    limit > 0
      ? [
          {
            asset_id: "asset-anonymous-1",
            asset_projection_state: "ready",
            body_analysis_state: "missing",
            manual_faces_waiting_for_provider: 1,
            reasons: [
              "manual_face_waiting_for_provider",
              "body_analysis_missing",
            ],
            unlinked_bodies: 0,
            unresolved_faces: 1,
          },
        ]
      : [],
  machineSuggestions: async ({ limit }) =>
    limit > 0
      ? [
          {
            candidates: [
              {
                person_id: "person-1",
                prime_score: 0.88,
                rank: 1,
                secondary_score: null,
              },
            ],
            detection_confidence: 0.91,
            face_id: "face-1",
            filename: "must-not-leak.jpg",
            margin: 0.12,
            quality_score: 0.8,
            review_reason: "clear_leader",
            sourceAssetId: "must-not-leak",
          },
        ]
      : [],
  person: async ({ personId }) => ({
    accepted_faces: 3,
    asset_count: 4,
    candidate_faces: 1,
    display_name: "Must Not Leak",
    head_faces: 0,
    needs_holding: false,
    needs_sort: false,
    person_id: personId,
    prime_faces: 2,
    private_notes: "Must Not Leak",
    secondary_faces: 1,
  }),
  summary: async () => ({
    accepted_presence: 1,
    assets: 4,
    candidate_signals: 2,
    people: 3,
    suggestions_ready: 1,
    user_decisions: 5,
  }),
};

test("Guided access is disabled and unconfigured independently", () => {
  assert.throws(
    () => createGuidedAccess({ repository }).authorize(`Bearer ${token}`),
    (error) => error.code === "GUIDED_DISABLED" && error.statusCode === 503,
  );
  assert.throws(
    () =>
      createGuidedAccess({ enabled: true, repository }).authorize(
        `Bearer ${token}`,
      ),
    (error) => error.code === "GUIDED_UNCONFIGURED" && error.statusCode === 503,
  );
});

test("Guided access authenticates a dedicated local token", () => {
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  assert.doesNotThrow(() => guided.authorize(`Bearer ${token}`));
  assert.throws(
    () => guided.authorize("Bearer wrong-token"),
    (error) => error.code === "GUIDED_UNAUTHORIZED" && error.statusCode === 401,
  );
});

test("Guided capability and instruction contracts are provider-neutral and disclosure-exact", () => {
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  const capability = guided.capabilities();
  const instruction = guided.instructions();
  assert.equal(capability.schemaVersion, guidedAccessSchemaVersion);
  assert.equal(capability.clientCompatibility.mcpRequired, false);
  assert.equal(capability.clientCompatibility.providerSelectedByCimmich, false);
  assert.equal(capability.disclosure.cimmichTransmitsDataOutward, false);
  assert.equal(
    capability.disclosure.connectedClientMayTransmitRetrievedData,
    true,
  );
  assert.equal(capability.authorityClasses.approvedMutation.available, false);
  assert.equal(
    capability.authorityClasses.read.operations.includes(
      "read.integration_status",
    ),
    true,
  );
  assert.equal(
    capability.authorityClasses.read.operations.includes(
      "read.provider_settings",
    ),
    true,
  );
  assert.equal(
    instruction.providerPartnership.settingsEndpoint,
    "/v1/integrations/provider-settings-pack",
  );
  assert.deepEqual(capability.visibility, {
    callerAuthorizationCanRaiseProjection: false,
    mode: "forced_standard",
    personalOrPrivateAuthorizationAccepted: false,
  });
  assert.equal(instruction.schemaVersion, guidedInstructionsSchemaVersion);
  assert.equal(instruction.recipes[0].providerNeutral, true);
  assert.deepEqual(instruction.recipes[0].compatibleClients, [
    "codex",
    "hosted_http_client",
    "local_model",
    "script",
  ]);
});

test("Guided exposes model-neutral integration status and settings without mutation authority", async () => {
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  const projections = [];
  const status = await guided.access(
    { action: "read.integration_status", input: {} },
    { requireProjection: (surface) => projections.push(surface) },
  );
  const settings = await guided.access({
    action: "read.provider_settings",
    input: {},
  });
  assert.equal(status.result.state, "complete");
  assert.deepEqual(projections, ["summary"]);
  assert.equal(settings.result.policy.modelArtifactsInRepository, false);
  assert.equal(settings.result.bodyDetection.bundledModels, false);
  assert.equal(
    settings.result.bodyDetection.automaticIdentityAuthority,
    "none",
  );
});

test("Guided Codex recipe reads minimized evidence and produces a local proposal", async () => {
  const projections = [];
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  const review = await guided.access(
    { action: "read.review_opportunities", input: { limit: 3 } },
    { requireProjection: (surface) => projections.push(surface) },
  );
  const person = await guided.access(
    { action: "read.person_evidence", input: { personId: "person-1" } },
    { requireProjection: (surface) => projections.push(surface) },
  );
  const proposal = await guided.access(
    { action: "propose.review_plan" },
    { requireProjection: (surface) => projections.push(surface) },
  );
  assert.deepEqual(projections, [
    "machine_suggestions",
    "people",
    "machine_suggestions",
    "summary",
  ]);
  assert.equal(JSON.stringify(review).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(person).includes("Must Not Leak"), false);
  assert.equal(proposal.result.authority, "proposal_only");
  assert.deepEqual(proposal.result.focusFaceIds, ["face-1"]);
  assert.deepEqual(
    proposal,
    await guided.access(
      { action: "propose.review_plan" },
      { requireProjection: () => {} },
    ),
  );
  assert.deepEqual(proposal.result.queues, [
    {
      count: 1,
      kind: "machine_suggestions_ready",
      nextAction: "Inspect the bounded suggestions and ask the user to decide.",
    },
    {
      count: 1,
      kind: "manual_faces_waiting_for_provider",
      nextAction:
        "Configure or run a compatible local recognition provider; the accepted user identity remains unchanged while waiting.",
    },
    {
      count: 2,
      kind: "unresolved_faces_need_local_evidence",
      nextAction:
        "Run or inspect local recognition evidence before asking the user for identity decisions.",
    },
    {
      count: 1,
      kind: "unlinked_bodies_need_review",
      nextAction:
        "Review local Face-to-Body association evidence without using Body evidence as identity authority.",
    },
  ]);
});

test("Guided backlog turns real unresolved evidence into a bounded proposal without identity content", async () => {
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository: {
      ...repository,
      machineSuggestions: async () => [],
    },
  });
  const backlog = await guided.access(
    { action: "read.evidence_backlog", input: {} },
    { requireProjection: () => {} },
  );
  const proposal = await guided.access(
    { action: "propose.review_plan", input: {} },
    { requireProjection: () => {} },
  );
  assert.deepEqual(backlog.result, {
    assetsWithUnresolvedFaces: 2,
    identifiedFaces: 3,
    linkedBodies: 1,
    manualFaces: {
      abstained: 0,
      eligibleForReview: 0,
      processing: 0,
      waitingForProvider: 1,
    },
    unresolvedFaces: 2,
    unlinkedBodies: 1,
    validBodies: 2,
  });
  assert.equal(proposal.result.headline, "3 local evidence queues");
  assert.equal(proposal.result.focusFaceIds.length, 0);
  assert.equal(proposal.result.focusPersonIds.length, 0);
  assert.equal(JSON.stringify(proposal).includes("person-1"), false);
});

test("Guided exposes a bounded anonymous local-intelligence work queue", async () => {
  const projections = [];
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  const queue = await guided.access(
    { action: "read.local_intelligence_queue", input: { limit: 8 } },
    { requireProjection: (surface) => projections.push(surface) },
  );
  assert.deepEqual(projections, ["asset_evidence"]);
  assert.deepEqual(queue.result, [
    {
      assetId: "asset-anonymous-1",
      assetProjectionState: "ready",
      bodyAnalysisState: "missing",
      manualFacesWaitingForProvider: 1,
      reasons: ["manual_face_waiting_for_provider", "body_analysis_missing"],
      unlinkedBodies: 0,
      unresolvedFaces: 1,
    },
  ]);
  assert.equal(JSON.stringify(queue).includes("displayName"), false);
});

test("Guided access is a closed action enum with strict per-action input", async () => {
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  await assert.rejects(
    guided.access({
      action: "read.review_opportunities",
      input: { limit: 3, route: "/v1/people" },
    }),
    (error) => error.code === "GUIDED_INPUT_INVALID",
  );
  await assert.rejects(
    guided.access({ action: "read.person_evidence", input: {} }),
    (error) => error.code === "GUIDED_INPUT_INVALID",
  );
  await assert.rejects(
    guided.access({ action: "read./v1/people", input: {} }),
    (error) => error.code === "GUIDED_INPUT_INVALID",
  );
});

test("Guided preserves explicit invalid input and rejects it before repository dispatch", async () => {
  let repositoryDispatches = 0;
  const guardedRepository = {
    guidedEvidenceBacklog: async () => {
      repositoryDispatches += 1;
      return {};
    },
    machineSuggestions: async () => {
      repositoryDispatches += 1;
      return [];
    },
    person: async () => {
      repositoryDispatches += 1;
      return {};
    },
    summary: async () => {
      repositoryDispatches += 1;
      return {};
    },
  };
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository: guardedRepository,
  });

  for (const invalidInput of [null, false, "", 0, []]) {
    await assert.rejects(
      guided.access({
        action: "read.library_overview",
        input: invalidInput,
      }),
      (error) => error.code === "GUIDED_INPUT_INVALID",
    );
  }
  assert.equal(repositoryDispatches, 0);

  await guided.access({ action: "read.library_overview" });
  assert.equal(repositoryDispatches, 1);
});

test("Guided bounds actions and classifies every clear mutation shape before dispatch", async () => {
  let repositoryDispatches = 0;
  const guardedRepository = {
    guidedEvidenceBacklog: async () => {
      repositoryDispatches += 1;
      return {};
    },
    machineSuggestions: async () => {
      repositoryDispatches += 1;
      return [];
    },
    person: async () => {
      repositoryDispatches += 1;
      return {};
    },
    summary: async () => {
      repositoryDispatches += 1;
      return {};
    },
  };
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository: guardedRepository,
  });

  for (const invalidAction of [
    `read.${"x".repeat(65)}`,
    "read./v1/people",
    " read.library_overview",
  ]) {
    await assert.rejects(
      guided.access({ action: invalidAction }),
      (error) =>
        error.code === "GUIDED_INPUT_INVALID" && error.details === undefined,
    );
  }

  for (const prefix of [
    "mutate",
    "approved_mutation",
    "write",
    "create",
    "update",
    "patch",
    "delete",
    "commit",
  ]) {
    await assert.rejects(
      guided.access({ action: `${prefix}.identity`, input: {} }),
      (error) =>
        error.code === "GUIDED_MUTATION_APPROVAL_REQUIRED" &&
        error.statusCode === 403 &&
        error.details === undefined,
    );
  }

  await assert.rejects(
    guided.access({ action: "read.unknown", input: {} }),
    (error) => error.code === "GUIDED_OPERATION_UNSUPPORTED",
  );
  assert.equal(repositoryDispatches, 0);
});

test("Guided V1 refuses mutation before repository dispatch", async () => {
  const guided = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  await assert.rejects(
    guided.access({ action: "mutate.identity.accept", input: {} }),
    (error) =>
      error.code === "GUIDED_MUTATION_APPROVAL_REQUIRED" &&
      error.statusCode === 403,
  );
});

test("Guided V2 bootstraps the complete canonical Space Trip graph without exposing credentials", () => {
  const guided = createGuidedAccess({
    accessToken: token,
    authority: "operate",
    enabled: true,
    immichPublicBaseUrl: "http://127.0.0.1:2283/api",
    publicBaseUrl: "http://127.0.0.1:3301",
    repository,
    uiPublicBaseUrl: "http://127.0.0.1:3303",
    visibilityCeiling: "private",
  });
  const bootstrap = guided.bootstrap({
    visibility: { viewingMode: "personal" },
  });
  assert.deepEqual(guided.setup(), {
    accessEndpoint: "/v1/guided/v1/access",
    authentication: "dedicated_bearer_token",
    bootstrapEndpoint: "/v1/guided/v2/bootstrap",
    canonicalAuthority: "operate",
    capabilitiesEndpoint: "/v1/guided/v1/capabilities",
    configured: true,
    enabled: true,
    instructionsEndpoint: "/v1/guided/v1/instructions",
    providerCredentialAccepted: false,
    providerNeutral: true,
    schemaVersion: "cimmich.guided-setup.v1",
    visibility: "credential_and_session_scoped",
    visibilityCeiling: "private",
  });
  const routeIds = new Set(bootstrap.routes.items.map((item) => item.id));
  for (const id of [
    "immich.sync",
    "immich.inventory_status",
    "people.create",
    "assets.evidence",
    "assets.smart_search",
    "manual_subject_tags.attach",
    "manual_subject_tags.replace",
    "faces.geometry_correct",
    "bodies.geometry_correct",
    "events.create",
    "events.assets_attach",
    "events.relations_attach",
    "events.cover",
    "places.create",
    "objects.create",
    "visibility.object_set",
    "context.undo",
  ]) {
    assert.equal(routeIds.has(id), true, id);
  }
  assert.equal(bootstrap.authentication.credentialAuthority, "operate");
  assert.equal(bootstrap.authentication.credentialVisibilityCeiling, "private");
  assert.equal(bootstrap.connections.immich.upload.path, "/assets");
  assert.equal(
    bootstrap.connections.immich.baseUrl,
    "http://127.0.0.1:2283/api",
  );
  assert.equal(bootstrap.visibility.viewingMode, "personal");
  const inventorySync = bootstrap.routes.items.find(
    (operation) => operation.id === "immich.sync",
  );
  assert.equal(inventorySync.requestSchema.properties.envelope.type, "object");
  assert.equal(inventorySync.requestExample.envelope.maxDetectionJobs, 0);
  assert.equal(inventorySync.requestExample.envelope.maxRecognitionJobs, 0);
  assert.equal(JSON.stringify(bootstrap).includes(token), false);
  assert.equal(JSON.stringify(bootstrap).includes('apiKey":'), false);
  for (const operation of bootstrap.routes.items) {
    assert.equal(typeof operation.link, "string");
    assert.equal(typeof operation.responseSchema, "object");
    assert.equal(typeof operation.uiVerificationLink, "string");
    assert.equal(operation.authentication.surface, "guided");
    if (operation.commandId) {
      assert.equal(operation.requestSchema.properties.commandId.type, "string");
      assert.equal(typeof operation.replay, "object");
    }
  }
});

test("Guided V2 delegates only catalogued routes within authority and visibility grants", () => {
  const read = createGuidedAccess({
    accessToken: token,
    enabled: true,
    repository,
  });
  assert.equal(
    read.authorizeCanonical({
      authorizationHeader: `Bearer ${token}`,
      method: "GET",
      pathname: "/v1/events",
      surface: "guided",
    }).routeId,
    "events.collection",
  );
  assert.throws(
    () =>
      read.authorizeCanonical({
        authorizationHeader: `Bearer ${token}`,
        method: "POST",
        pathname: "/v1/events",
        surface: "guided",
      }),
    (error) => error.code === "GUIDED_AUTHORITY_INSUFFICIENT",
  );
  assert.throws(
    () =>
      read.authorizeCanonical({
        authorizationHeader: `Bearer ${token}`,
        method: "GET",
        pathname: "/v1/media-jobs",
        surface: "guided",
      }),
    (error) => error.code === "GUIDED_ROUTE_NOT_EXPOSED",
  );
  assert.throws(
    () =>
      read.authorizeCanonical({
        authorizationHeader: `Bearer ${token}`,
        method: "DELETE",
        pathname: "/v1/events",
        surface: "guided",
      }),
    (error) =>
      error.code === "GUIDED_METHOD_UNSUPPORTED" && error.statusCode === 405,
  );
  const credential = read.authorizeCanonical({
    authorizationHeader: `Bearer ${token}`,
    method: "GET",
    pathname: "/v1/summary",
    surface: "guided",
  });
  assert.throws(
    () => read.assertVisibilityGrant(credential, ["personal"]),
    (error) => error.code === "GUIDED_VISIBILITY_CEILING_EXCEEDED",
  );
});
