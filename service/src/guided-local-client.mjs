import { recognitionDigest } from "./recognition-provider-contract.mjs";
import {
  guidedAccessSchemaVersion,
  guidedInstructionsSchemaVersion,
} from "./guided-access.mjs";

export const guidedLocalClientConformanceSchemaVersion =
  "cimmich.guided-local-client-conformance.v1";

const maximumResponseBytes = 1024 * 1024;
const tokenPattern = /^[A-Za-z0-9._~-]{32,256}$/;
const forbiddenResultKeys = new Set([
  "accessToken",
  "crop",
  "displayName",
  "embedding",
  "embeddings",
  "filename",
  "image",
  "path",
  "privateNotes",
  "private_notes",
  "providerCredential",
  "sourceContentDigest",
]);

const typedError = (message, code = "GUIDED_LOCAL_CLIENT_INVALID") =>
  Object.assign(new Error(message), { code, statusCode: 400 });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const loopbackBaseUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw typedError("Guided local client base URL is invalid");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  ) {
    throw typedError(
      "Guided local client transport must be an uncredentialed loopback HTTP origin",
    );
  }
  return url.origin;
};

const requiredToken = (value) => {
  if (typeof value !== "string" || !tokenPattern.test(value)) {
    throw typedError("Guided local client token is missing or invalid");
  }
  return value;
};

const assertNoForbiddenKeys = (value, path = "result") => {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      assertNoForbiddenKeys(child, `${path}[${index}]`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenResultKeys.has(key)) {
      throw typedError(
        "Guided response exceeds the local-client privacy contract",
        "GUIDED_LOCAL_CLIENT_PRIVACY_VIOLATION",
      );
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
};

const requiredInteger = (value, label, maximum = 1_000_000_000) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw typedError(`${label} must be a bounded non-negative integer`);
  }
  return value;
};

const requiredOpaqueId = (value, label) => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 200 ||
    /[\\/\s]/.test(value)
  ) {
    throw typedError(`${label} must be a bounded anonymous identifier`);
  }
  return value;
};

const readResponse = async (response) => {
  if (
    response == null ||
    typeof response !== "object" ||
    typeof response.text !== "function" ||
    typeof response.status !== "number"
  ) {
    throw typedError(
      "Guided local client transport returned an invalid response",
      "GUIDED_LOCAL_CLIENT_TRANSPORT_INVALID",
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumResponseBytes) {
    throw typedError(
      "Guided local client response is oversized",
      "GUIDED_LOCAL_CLIENT_RESPONSE_OVERSIZED",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(
      new Error("Guided local endpoint rejected the request"),
      {
        code: "GUIDED_LOCAL_CLIENT_REMOTE_ERROR",
        statusCode: response.status,
      },
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw typedError(
      "Guided local client response is not valid JSON",
      "GUIDED_LOCAL_CLIENT_RESPONSE_INVALID",
    );
  }
};

const validateCapabilities = (capability) => {
  if (
    capability?.schemaVersion !== guidedAccessSchemaVersion ||
    capability?.transport !== "authenticated_local_http_json" ||
    capability?.visibility?.mode !== "forced_standard" ||
    capability.visibility.callerAuthorizationCanRaiseProjection !== false ||
    capability.visibility.personalOrPrivateAuthorizationAccepted !== false ||
    capability?.clientCompatibility?.mcpRequired !== false ||
    capability.clientCompatibility.providerSelectedByCimmich !== false ||
    capability.clientCompatibility.localModelOrScript !==
      "compatible_with_http_json" ||
    capability?.productBoundary?.providerBroker !== false ||
    capability.productBoundary.hostedInference !== false ||
    capability?.disclosure?.cimmichTransmitsDataOutward !== false ||
    capability.disclosure.connectedClientMayTransmitRetrievedData !== true ||
    capability.disclosure.operatorAndConnectedClientOwnDisclosure !== true ||
    capability?.authorityClasses?.approvedMutation?.available !== false ||
    capability.authorityClasses.propose?.writesState !== false ||
    capability.authorityClasses.read?.writesState !== false
  ) {
    throw typedError(
      "Guided capability contract is incompatible with the local client",
      "GUIDED_LOCAL_CLIENT_CAPABILITY_MISMATCH",
    );
  }
  return capability;
};

const validateInstructions = (instructions) => {
  const compatibleRecipe = instructions?.recipes?.some(
    (recipe) =>
      recipe?.providerNeutral === true &&
      recipe?.compatibleClients?.includes("local_model") &&
      recipe.compatibleClients.includes("script"),
  );
  if (
    instructions?.schemaVersion !== guidedInstructionsSchemaVersion ||
    instructions.accessSchemaVersion !== guidedAccessSchemaVersion ||
    compatibleRecipe !== true ||
    !instructions.invariants?.includes(
      "Guided is forced to Standard visibility; caller Personal or Private authorization cannot raise its projection.",
    )
  ) {
    throw typedError(
      "Guided instruction contract is incompatible with the local client",
      "GUIDED_LOCAL_CLIENT_INSTRUCTION_MISMATCH",
    );
  }
  return instructions;
};

const validateAccess = (value, action) => {
  if (
    value?.schemaVersion !== guidedAccessSchemaVersion ||
    value.action !== action
  ) {
    throw typedError(
      "Guided access response does not match the requested action",
      "GUIDED_LOCAL_CLIENT_ACCESS_MISMATCH",
    );
  }
  assertNoForbiddenKeys(value.result);
  return value.result;
};

export const runGuidedLocalClientConformance = async ({
  accessToken,
  baseUrl,
  transport = globalThis.fetch,
} = {}) => {
  const origin = loopbackBaseUrl(baseUrl);
  const token = requiredToken(accessToken);
  if (typeof transport !== "function") {
    throw typedError(
      "Guided local client transport is unavailable",
      "GUIDED_LOCAL_CLIENT_TRANSPORT_INVALID",
    );
  }
  const request = async (path, { action, input, method = "GET" } = {}) => {
    const body = action == null ? undefined : JSON.stringify({ action, input });
    return readResponse(
      await transport(`${origin}${path}`, {
        body,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        method,
      }),
    );
  };

  const capability = validateCapabilities(
    await request("/v1/guided/v1/capabilities"),
  );
  const instructions = validateInstructions(
    await request("/v1/guided/v1/instructions"),
  );
  const overview = validateAccess(
    await request("/v1/guided/v1/access", {
      action: "read.library_overview",
      input: {},
      method: "POST",
    }),
    "read.library_overview",
  );
  const backlog = validateAccess(
    await request("/v1/guided/v1/access", {
      action: "read.evidence_backlog",
      input: {},
      method: "POST",
    }),
    "read.evidence_backlog",
  );
  const localIntelligenceQueue = validateAccess(
    await request("/v1/guided/v1/access", {
      action: "read.local_intelligence_queue",
      input: { limit: 8 },
      method: "POST",
    }),
    "read.local_intelligence_queue",
  );
  const opportunities = validateAccess(
    await request("/v1/guided/v1/access", {
      action: "read.review_opportunities",
      input: { limit: 3 },
      method: "POST",
    }),
    "read.review_opportunities",
  );
  const proposal = validateAccess(
    await request("/v1/guided/v1/access", {
      action: "propose.review_plan",
      input: {},
      method: "POST",
    }),
    "propose.review_plan",
  );
  if (!Array.isArray(opportunities) || opportunities.length > 3) {
    throw typedError(
      "Guided review opportunities exceed the local-client bound",
      "GUIDED_LOCAL_CLIENT_ACCESS_MISMATCH",
    );
  }
  if (
    !Array.isArray(localIntelligenceQueue) ||
    localIntelligenceQueue.length > 8
  ) {
    throw typedError(
      "Guided local intelligence queue exceeds the local-client bound",
      "GUIDED_LOCAL_CLIENT_ACCESS_MISMATCH",
    );
  }
  const localQueueReasonCounts = {};
  for (const [index, item] of localIntelligenceQueue.entries()) {
    requiredOpaqueId(item?.assetId, `localQueue[${index}].assetId`);
    if (!Array.isArray(item.reasons) || item.reasons.length > 4) {
      throw typedError(
        "Guided local intelligence item has invalid reasons",
        "GUIDED_LOCAL_CLIENT_ACCESS_MISMATCH",
      );
    }
    for (const reason of item.reasons) {
      if (
        ![
          "asset_projection_missing",
          "body_analysis_missing",
          "manual_face_waiting_for_provider",
          "unlinked_bodies",
          "unresolved_faces",
        ].includes(reason)
      ) {
        throw typedError(
          "Guided local intelligence item has an unsupported reason",
          "GUIDED_LOCAL_CLIENT_ACCESS_MISMATCH",
        );
      }
      localQueueReasonCounts[reason] =
        (localQueueReasonCounts[reason] || 0) + 1;
    }
  }
  if (proposal?.authority !== "proposal_only") {
    throw typedError(
      "Guided review plan exceeds proposal authority",
      "GUIDED_LOCAL_CLIENT_AUTHORITY_MISMATCH",
    );
  }
  const overviewCounts = {
    acceptedPresence: requiredInteger(
      overview.acceptedPresence,
      "overview.acceptedPresence",
    ),
    assets: requiredInteger(overview.assets, "overview.assets"),
    candidateSignals: requiredInteger(
      overview.candidateSignals,
      "overview.candidateSignals",
    ),
    people: requiredInteger(overview.people, "overview.people"),
    suggestionsReady: requiredInteger(
      overview.suggestionsReady,
      "overview.suggestionsReady",
    ),
    userDecisions: requiredInteger(
      overview.userDecisions,
      "overview.userDecisions",
    ),
  };
  const backlogCounts = {
    assetsWithUnresolvedFaces: requiredInteger(
      backlog.assetsWithUnresolvedFaces,
      "backlog.assetsWithUnresolvedFaces",
    ),
    identifiedFaces: requiredInteger(
      backlog.identifiedFaces,
      "backlog.identifiedFaces",
    ),
    linkedBodies: requiredInteger(backlog.linkedBodies, "backlog.linkedBodies"),
    manualFaces: {
      abstained: requiredInteger(
        backlog.manualFaces?.abstained,
        "backlog.manualFaces.abstained",
      ),
      eligibleForReview: requiredInteger(
        backlog.manualFaces?.eligibleForReview,
        "backlog.manualFaces.eligibleForReview",
      ),
      processing: requiredInteger(
        backlog.manualFaces?.processing,
        "backlog.manualFaces.processing",
      ),
      waitingForProvider: requiredInteger(
        backlog.manualFaces?.waitingForProvider,
        "backlog.manualFaces.waitingForProvider",
      ),
    },
    unresolvedFaces: requiredInteger(
      backlog.unresolvedFaces,
      "backlog.unresolvedFaces",
    ),
    unlinkedBodies: requiredInteger(
      backlog.unlinkedBodies,
      "backlog.unlinkedBodies",
    ),
    validBodies: requiredInteger(backlog.validBodies, "backlog.validBodies"),
  };
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      mutation: "not_exposed",
      persistence: "none",
      training: "none",
    },
    boundary: {
      clientKind: "local_script",
      clientTransport: "loopback_http_json_only",
      cimmichRuntimeOutboundProviderNetwork: "none",
      connectedClientDisclosureOwner: "operator_and_client",
      modelInference: "none",
      providerCredential: "none",
      visibility: "forced_standard",
    },
    contract: {
      accessSchemaVersion: capability.schemaVersion,
      instructionSchemaVersion: instructions.schemaVersion,
      mcpRequired: false,
      providerNeutral: true,
    },
    evidence: {
      backlogCounts,
      localQueueCount: localIntelligenceQueue.length,
      localQueueReasonCounts,
      opportunityCount: opportunities.length,
      overviewCounts,
      proposalDigest: recognitionDigest(proposal),
    },
    schemaVersion: guidedLocalClientConformanceSchemaVersion,
    status: "conformant",
  };
  return deepFreeze({ ...core, receiptDigest: recognitionDigest(core) });
};

export const guidedLocalClientConformanceContractDigest = recognitionDigest({
  maximumResponseBytes,
  schemaVersion: guidedLocalClientConformanceSchemaVersion,
  transport: "loopback_http_json_only",
});
