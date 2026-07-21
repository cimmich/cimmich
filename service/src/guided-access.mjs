import { createHash, timingSafeEqual } from "node:crypto";
import { integrationSettingsPack } from "./integration-settings.mjs";
import {
  guidedBootstrapSchemaVersion,
  guidedRouteCatalog,
  matchGuidedCanonicalPath,
  matchGuidedCanonicalRoute,
} from "./guided-route-catalog.mjs";

export const guidedAccessSchemaVersion = "cimmich.guided-access.v1";
export const guidedInstructionsSchemaVersion = "cimmich.guided-instructions.v1";
export { guidedBootstrapSchemaVersion };

const typedError = (message, code, statusCode, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const tokenDigest = (value) =>
  createHash("sha256")
    .update(String(value || ""))
    .digest();

const actionPattern = /^[a-z][a-z0-9_]{0,31}(?:\.[a-z][a-z0-9_]{0,31})+$/;
const mutationActionPattern =
  /^(?:mutate|approved_mutation|write|create|update|patch|delete|commit)\./;

const requiredAction = (value) => {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !actionPattern.test(value)
  ) {
    throw typedError(
      "Guided action must be a bounded public action identifier",
      "GUIDED_INPUT_INVALID",
      400,
    );
  }
  return value;
};

const compactSuggestion = (suggestion) => ({
  candidatePeople: (suggestion.candidates || [])
    .slice(0, 3)
    .map((candidate) => ({
      personId: candidate.person_id,
      primeScore:
        candidate.prime_score == null
          ? null
          : Number(Number(candidate.prime_score).toFixed(4)),
      rank: candidate.rank,
      secondaryScore:
        candidate.secondary_score == null
          ? null
          : Number(Number(candidate.secondary_score).toFixed(4)),
    })),
  detectionConfidence:
    suggestion.detection_confidence == null
      ? null
      : Number(Number(suggestion.detection_confidence).toFixed(4)),
  faceId: suggestion.face_id,
  margin:
    suggestion.margin == null
      ? null
      : Number(Number(suggestion.margin).toFixed(4)),
  qualityScore:
    suggestion.quality_score == null
      ? null
      : Number(Number(suggestion.quality_score).toFixed(4)),
  reviewReason: suggestion.review_reason,
});

const boundedLimit = (value, maximum = 24) => {
  const number = Number(value ?? maximum);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw typedError(
      `Guided limit must be between 1 and ${maximum}`,
      "GUIDED_INPUT_INVALID",
      400,
    );
  }
  return number;
};

const requiredPersonId = (value) => {
  const personId = String(value || "").trim();
  if (!personId || personId.length > 200) {
    throw typedError(
      "Guided Person ID is invalid",
      "GUIDED_INPUT_INVALID",
      400,
    );
  }
  return personId;
};

const strictInput = (input, allowedKeys, requiredKeys = []) => {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw typedError(
      "Guided operation input must be an object",
      "GUIDED_INPUT_INVALID",
      400,
    );
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw typedError(
      "Guided operation input contains unsupported fields",
      "GUIDED_INPUT_INVALID",
      400,
    );
  }
  if (requiredKeys.some((key) => !Object.hasOwn(input, key))) {
    throw typedError(
      "Guided operation input is missing required fields",
      "GUIDED_INPUT_INVALID",
      400,
    );
  }
  return input;
};

const compactEvidenceBacklog = (row) => ({
  assetsWithUnresolvedFaces: row.assets_with_unresolved_faces,
  identifiedFaces: row.identified_faces,
  linkedBodies: row.linked_bodies,
  manualFaces: {
    abstained: row.manual_abstained,
    eligibleForReview: row.manual_eligible_for_review,
    processing: row.manual_processing,
    waitingForProvider: row.manual_waiting_for_provider,
  },
  unresolvedFaces: row.unresolved_faces,
  unlinkedBodies: row.unlinked_bodies,
  validBodies: row.valid_bodies,
});

const compactLocalIntelligenceItem = (row) => ({
  assetId: row.asset_id,
  assetProjectionState: row.asset_projection_state,
  bodyAnalysisState: row.body_analysis_state,
  manualFacesWaitingForProvider: row.manual_faces_waiting_for_provider,
  reasons: row.reasons,
  unlinkedBodies: row.unlinked_bodies,
  unresolvedFaces: row.unresolved_faces,
});

const localReviewPlan = (suggestions, backlog) => {
  const close = suggestions.filter(
    (item) => item.review_reason === "close_alternatives",
  );
  const focus = (close.length > 0 ? close : suggestions).slice(0, 3);
  const queues = [];
  if (focus.length > 0) {
    queues.push({
      count: focus.length,
      kind: "machine_suggestions_ready",
      nextAction: "Inspect the bounded suggestions and ask the user to decide.",
    });
  }
  if (backlog.manualFaces.waitingForProvider > 0) {
    queues.push({
      count: backlog.manualFaces.waitingForProvider,
      kind: "manual_faces_waiting_for_provider",
      nextAction:
        "Configure or run a compatible local recognition provider; the accepted user identity remains unchanged while waiting.",
    });
  }
  if (backlog.unresolvedFaces > focus.length) {
    queues.push({
      count: backlog.unresolvedFaces,
      kind: "unresolved_faces_need_local_evidence",
      nextAction:
        "Run or inspect local recognition evidence before asking the user for identity decisions.",
    });
  }
  if (backlog.unlinkedBodies > 0) {
    queues.push({
      count: backlog.unlinkedBodies,
      kind: "unlinked_bodies_need_review",
      nextAction:
        "Review local Face-to-Body association evidence without using Body evidence as identity authority.",
    });
  }
  return {
    authority: "proposal_only",
    caution:
      "The connected client may propose a review order; only the user establishes identity truth.",
    focusFaceIds: focus.map((item) => item.face_id),
    focusPersonIds: [
      ...new Set(
        focus.flatMap((item) =>
          (item.candidates || [])
            .slice(0, 2)
            .map((candidate) => candidate.person_id),
        ),
      ),
    ],
    headline:
      queues.length === 0
        ? "No evidence backlog is ready"
        : focus.length === 0
          ? `${queues.length} local evidence ${queues.length === 1 ? "queue" : "queues"}`
          : `${focus.length} bounded review ${focus.length === 1 ? "check" : "checks"}`,
    nextAction:
      queues.length === 0
        ? "Leave identity state unchanged and try again after new local evidence exists."
        : queues[0].nextAction,
    queues: queues.slice(0, 4),
    reasons: focus.map((item) => item.review_reason),
    schemaVersion: "cimmich.guided-review-proposal.v1",
  };
};

const capabilities = () => ({
  authorityClasses: {
    approvedMutation: {
      available: false,
      rule: "Guided V1 exposes no mutation operation. A later accepted contract must bind explicit user approval, actor, stable command ID, replay, conflict and Undo.",
    },
    propose: {
      available: true,
      operations: ["propose.review_plan"],
      writesState: false,
    },
    read: {
      available: true,
      operations: [
        "read.evidence_backlog",
        "read.integration_status",
        "read.library_overview",
        "read.local_intelligence_queue",
        "read.person_evidence",
        "read.provider_settings",
        "read.review_opportunities",
      ],
      visibilityBeforeProjection: true,
      writesState: false,
    },
  },
  clientCompatibility: {
    codex: "tested_recipe",
    hostedHttpClient: "compatible_with_operator_disclosure",
    localModelOrScript: "compatible_with_http_json",
    mcpRequired: false,
    providerSelectedByCimmich: false,
  },
  disclosure: {
    cimmichTransmitsDataOutward: false,
    connectedClientMayTransmitRetrievedData: true,
    operatorAndConnectedClientOwnDisclosure: true,
    statement:
      "Cimmich does not proxy data to a model provider. Connected software may transmit anything it retrieves; its operator is responsible for that disclosure.",
  },
  endpoints: {
    access: "/v1/guided/v1/access",
    capabilities: "/v1/guided/v1/capabilities",
    instructions: "/v1/guided/v1/instructions",
  },
  productBoundary: {
    basicAndStandardRemainAvailableWhenDisabled: true,
    cimmichCloud: false,
    hostedInference: false,
    providerBroker: false,
  },
  schemaVersion: guidedAccessSchemaVersion,
  transport: "authenticated_local_http_json",
  visibility: {
    callerAuthorizationCanRaiseProjection: false,
    mode: "forced_standard",
    personalOrPrivateAuthorizationAccepted: false,
  },
});

const instructions = () => ({
  accessSchemaVersion: guidedAccessSchemaVersion,
  clientResponsibilities: [
    "Tell the operator whether the connected client is local or hosted before retrieving data.",
    "Preview and minimize any data the connected client may transmit outside Cimmich.",
    "Treat every identity result as evidence or a proposal until the user explicitly decides.",
    "Do not call Cimmich, Immich or source-media mutation routes from this V1 recipe.",
  ],
  invariants: [
    "Authenticate with a dedicated Cimmich Guided access token, never a third-party provider credential.",
    "Discover capabilities before requesting an operation.",
    "Guided is forced to Standard visibility; caller Personal or Private authorization cannot raise its projection.",
    "Respect every visibility-before-projection result inside that Standard boundary.",
    "Keep read, propose and approved mutation authority separate.",
    "Identity acceptance is non-training and automatic identity authority is zero.",
    "Cimmich does not write the Immich database or source media.",
    "Cimmich publishes provider-neutral evidence contracts and settings; it does not bundle or silently download model artifacts.",
  ],
  recipes: [
    {
      compatibleClients: [
        "codex",
        "hosted_http_client",
        "local_model",
        "script",
      ],
      id: "cimmich-guided-review-plan-v1",
      providerNeutral: true,
      steps: [
        "GET capabilities and confirm only read/propose operations are available.",
        "POST read.integration_status to inspect which local evidence pipelines are configured and complete.",
        "POST read.provider_settings to discover accepted contracts, tested settings and official provider/model sources.",
        "POST read.library_overview to understand bounded local review state.",
        "POST read.evidence_backlog to distinguish ready suggestions from local evidence work that is still waiting.",
        "POST read.local_intelligence_queue with a bounded limit to obtain anonymous visible assets whose local evidence is incomplete.",
        "POST read.review_opportunities with limit at most 24.",
        "POST propose.review_plan and present the proposal to the user.",
        "Stop before mutation; Guided V1 exposes no commit operation.",
      ],
      usefulOutcome:
        "A small privacy-minimized People review plan that leaves identity and source state unchanged.",
    },
  ],
  providerPartnership: {
    artifactPolicy:
      "The operator or connected client obtains model artifacts from an official source after an explicit operator choice.",
    contract:
      "Convert provider output into the exact Cimmich evidence contract. Model output is never accepted as identity truth by itself.",
    settingsEndpoint: "/v1/integrations/provider-settings-pack",
    statusEndpoint: "/v1/integrations/status",
  },
  schemaVersion: guidedInstructionsSchemaVersion,
});

export const createGuidedAccess = ({
  accessToken = "",
  authority = "read",
  enabled = false,
  immichPublicBaseUrl = "",
  publicBaseUrl = "",
  repository,
  uiPublicBaseUrl = "",
  visibilityCeiling = "standard",
} = {}) => {
  const configuredToken = String(accessToken || "");
  const configuredDigest = tokenDigest(configuredToken);
  const authorityClass = String(authority || "read").trim();
  if (!["read", "operate"].includes(authorityClass)) {
    throw typedError(
      "Guided authority must be read or operate",
      "GUIDED_CONFIG_INVALID",
      500,
    );
  }
  const publicImmichUrl = String(immichPublicBaseUrl || "").trim();
  const publicCimmichUrl = String(publicBaseUrl || "").trim();
  const publicUiUrl = String(uiPublicBaseUrl || "").trim();
  const ceiling = String(visibilityCeiling || "standard").trim();
  const visibilityRank = { private: 2, personal: 1, standard: 0 };
  if (!Object.hasOwn(visibilityRank, ceiling)) {
    throw typedError(
      "Guided visibility ceiling is invalid",
      "GUIDED_CONFIG_INVALID",
      500,
    );
  }
  const actorId = `guided_${configuredDigest.toString("hex").slice(0, 24)}`;

  const authorize = (authorizationHeader) => {
    if (!enabled) {
      throw typedError("Guided access is disabled", "GUIDED_DISABLED", 503);
    }
    if (!configuredToken) {
      throw typedError(
        "Guided access is unconfigured",
        "GUIDED_UNCONFIGURED",
        503,
      );
    }
    const match = String(authorizationHeader || "").match(/^Bearer ([^\s]+)$/);
    if (!match || !timingSafeEqual(tokenDigest(match[1]), configuredDigest)) {
      throw typedError(
        "Guided access authentication failed",
        "GUIDED_UNAUTHORIZED",
        401,
      );
    }
    return Object.freeze({
      actorId,
      authority: authorityClass,
      visibilityCeiling: ceiling,
    });
  };

  const authorizeCanonical = ({
    authorizationHeader,
    method,
    pathname,
    surface,
  }) => {
    if (
      String(surface || "")
        .trim()
        .toLowerCase() !== "guided"
    ) {
      throw typedError(
        "Guided canonical access requires the guided surface",
        "GUIDED_SURFACE_REQUIRED",
        400,
      );
    }
    const credential = authorize(authorizationHeader);
    const route = matchGuidedCanonicalRoute({ method, pathname });
    if (!route) {
      if (matchGuidedCanonicalPath(pathname)) {
        throw typedError(
          "The canonical route does not support this HTTP method",
          "GUIDED_METHOD_UNSUPPORTED",
          405,
        );
      }
      throw typedError(
        "The canonical route is not exposed through Guided",
        "GUIDED_ROUTE_NOT_EXPOSED",
        403,
      );
    }
    if (route.authority === "operate" && credential.authority !== "operate") {
      throw typedError(
        "The Guided credential does not grant operation authority",
        "GUIDED_AUTHORITY_INSUFFICIENT",
        403,
      );
    }
    return Object.freeze({ ...credential, routeId: route.id });
  };

  const assertVisibilityGrant = (credential, requestedTiers = []) => {
    for (const value of requestedTiers) {
      const tier = String(value || "")
        .trim()
        .toLowerCase();
      if (
        !Object.hasOwn(visibilityRank, tier) ||
        visibilityRank[tier] > visibilityRank[credential.visibilityCeiling]
      ) {
        throw typedError(
          "The Guided credential visibility ceiling does not grant the requested tier",
          "GUIDED_VISIBILITY_CEILING_EXCEEDED",
          403,
        );
      }
    }
  };

  const bootstrap = ({ visibility } = {}) => ({
    authentication: {
      canonicalHeader: "Authorization: Bearer <guided-token>",
      canonicalSurfaceHeader: "x-cimmich-surface: guided",
      credentialAuthority: authorityClass,
      credentialVisibilityCeiling: ceiling,
      privateSessionHeader:
        "x-cimmich-private-session: <session returned by canonical visibility unlock>",
      queryOrBodyTokenTransportAccepted: false,
      credentialLifecycle: {
        acquisition:
          "The Cimmich operator issues the dedicated Guided token out of band with an explicit authority and visibility ceiling.",
        refreshEndpoint: null,
        rotation:
          "The operator rotates the configured token; Cimmich never returns its value through discovery or logs.",
      },
      viewingScope:
        "Canonical calls use the principal/device viewing mode and any current Private session supplied by the user.",
    },
    authority: {
      automaticIdentityAcceptance: "none",
      sourcePackActivation: "none",
      training: "none",
      userGrantedCanonicalAuthority: authorityClass,
      userGrantedVisibilityCeiling: ceiling,
    },
    connections: {
      cimmich: {
        authentication: "guided_bearer_plus_visibility_session",
        baseUrl: publicCimmichUrl || null,
        routeCatalog: "embedded",
        transport: "canonical_http_json",
      },
      immich: {
        authentication:
          "separate user-supplied Immich credential; never the Guided token",
        credentialAcquisition: {
          apiKeyHeader: "x-api-key: <user-issued-immich-api-key>",
          loginEndpoint: "/auth/login",
          rule: "The user supplies or obtains the Immich credential directly from Immich; Cimmich never returns or refreshes it.",
        },
        baseUrl: publicImmichUrl || null,
        inventoryAdmissionRoute: "/v1/operator/media-pipeline",
        upload: {
          method: "POST",
          path: "/assets",
          contentType: "multipart/form-data",
          duplicateSafety:
            "Supply a stable deviceAssetId and deviceId; retain Immich's duplicate/asset receipt and returned asset ID.",
          requiredFields: [
            "assetData",
            "deviceAssetId",
            "deviceId",
            "fileCreatedAt",
            "fileModifiedAt",
          ],
          responseSchema: {
            additionalProperties: true,
            properties: {
              duplicate: { type: "boolean" },
              id: { maxLength: 240, minLength: 1, type: "string" },
            },
            required: ["id"],
            type: "object",
          },
          transport: "direct_client_to_immich",
        },
      },
      productUi: {
        baseUrl: publicUiUrl || null,
        authentication:
          "The connected client opens links in the user's existing Immich/Cimmich browser session.",
      },
    },
    disclosure: {
      cimmichTransmitsToModelProviders: false,
      connectedClientMayDiscloseAnythingItRetrieves: true,
      operatorAcceptsConnectedClientDisclosureRisk: true,
      statement:
        "Cimmich does not send library data to a model provider. A connected client may transmit anything it retrieves; the user/operator owns and accepts that disclosure.",
    },
    instructions: {
      invariants: [
        "Discover this bootstrap before operating.",
        "Use only catalogued canonical routes; Guided does not duplicate domain mutations.",
        "Supply a stable commandId for every catalogued replay-safe mutation and retain decisionId values for Undo.",
        "Read the current entity revision before revision-safe update, cover, privacy or replacement commands.",
        "Upload media directly to the connected Immich with a separately supplied Immich credential, then run bounded Cimmich inventory admission.",
        "Treat Face/Head/Body/Presence as distinct human evidence types; no machine suggestion is accepted automatically.",
        "Verify the resulting Event, Place, Thing, Person, media associations, covers, privacy and typed evidence through canonical reads.",
      ],
      spaceTripWorkflow: [
        "Verify Immich and Cimmich connection status.",
        "Upload six assets directly to Immich and retain their returned Immich asset IDs.",
        "Run a bounded inventory-only media-operator command and poll inventory/operator state until admitted.",
        "For each returned Immich asset ID, call assets.evidence with sourceAssetId after sync; the visibility-safe response binds that sourceAssetId to its Cimmich assetId.",
        "Find or create the Person, Event, Place and Thing using stable command IDs.",
        "Attach media and typed relationships to Event/Place/Thing; attach Face/Head/Body/Presence only where visually truthful.",
        "Set covers and entity visibility from current revisions.",
        "Search and re-read every entity and asset projection; Undo and retry any incorrect decision rather than issuing a hidden repair.",
      ],
    },
    routes: guidedRouteCatalog(),
    schemaVersion: guidedBootstrapSchemaVersion,
    visibility: visibility || null,
  });

  const access = async (request = {}, { requireProjection } = {}) => {
    if (
      request == null ||
      typeof request !== "object" ||
      Array.isArray(request)
    ) {
      throw typedError(
        "Guided access request must be an object",
        "GUIDED_INPUT_INVALID",
        400,
      );
    }
    const operation = requiredAction(request.action);
    const input = Object.hasOwn(request, "input") ? request.input : {};
    if (mutationActionPattern.test(operation)) {
      throw typedError(
        "Guided V1 exposes no mutation operation",
        "GUIDED_MUTATION_APPROVAL_REQUIRED",
        403,
      );
    }
    if (operation === "read.library_overview") {
      strictInput(input, []);
      requireProjection?.("summary");
      const summary = await repository.summary();
      return {
        action: operation,
        result: {
          acceptedPresence: summary.accepted_presence,
          assets: summary.assets,
          candidateSignals: summary.candidate_signals,
          people: summary.people,
          suggestionsReady: summary.suggestions_ready,
          userDecisions: summary.user_decisions,
        },
        schemaVersion: guidedAccessSchemaVersion,
      };
    }
    if (operation === "read.review_opportunities") {
      strictInput(input, ["limit"], ["limit"]);
      requireProjection?.("machine_suggestions");
      const limit = boundedLimit(input.limit);
      return {
        action: operation,
        result: (await repository.machineSuggestions({ limit })).map(
          compactSuggestion,
        ),
        schemaVersion: guidedAccessSchemaVersion,
      };
    }
    if (operation === "read.evidence_backlog") {
      strictInput(input, []);
      requireProjection?.("summary");
      return {
        action: operation,
        result: compactEvidenceBacklog(
          await repository.guidedEvidenceBacklog(),
        ),
        schemaVersion: guidedAccessSchemaVersion,
      };
    }
    if (operation === "read.integration_status") {
      strictInput(input, []);
      requireProjection?.("summary");
      return {
        action: operation,
        result: await repository.integrationStatus(),
        schemaVersion: guidedAccessSchemaVersion,
      };
    }
    if (operation === "read.provider_settings") {
      strictInput(input, []);
      return {
        action: operation,
        result: integrationSettingsPack(),
        schemaVersion: guidedAccessSchemaVersion,
      };
    }
    if (operation === "read.local_intelligence_queue") {
      strictInput(input, ["limit"], ["limit"]);
      requireProjection?.("asset_evidence");
      const limit = boundedLimit(input.limit);
      return {
        action: operation,
        result: (await repository.guidedLocalIntelligenceQueue({ limit })).map(
          compactLocalIntelligenceItem,
        ),
        schemaVersion: guidedAccessSchemaVersion,
      };
    }
    if (operation === "read.person_evidence") {
      strictInput(input, ["personId"], ["personId"]);
      requireProjection?.("people");
      const person = await repository.person({
        personId: requiredPersonId(input.personId),
      });
      return {
        action: operation,
        result: {
          acceptedFaces: person.accepted_faces,
          assetCount: person.asset_count,
          candidateFaces: person.candidate_faces,
          headFaces: person.head_faces,
          needsHolding: person.needs_holding,
          needsSort: person.needs_sort,
          personId: person.person_id,
          primeFaces: person.prime_faces,
          secondaryFaces: person.secondary_faces,
        },
        schemaVersion: guidedAccessSchemaVersion,
      };
    }
    if (operation === "propose.review_plan") {
      strictInput(input, []);
      requireProjection?.("machine_suggestions");
      const suggestions = await repository.machineSuggestions({ limit: 24 });
      requireProjection?.("summary");
      const backlog = compactEvidenceBacklog(
        await repository.guidedEvidenceBacklog(),
      );
      return {
        action: operation,
        result: localReviewPlan(suggestions, backlog),
        schemaVersion: guidedAccessSchemaVersion,
      };
    }
    throw typedError(
      "Guided operation is unsupported",
      "GUIDED_OPERATION_UNSUPPORTED",
      400,
    );
  };

  return {
    access,
    assertVisibilityGrant,
    authorize,
    authorizeCanonical,
    bootstrap,
    capabilities,
    instructions,
    setup: () => ({
      accessEndpoint: "/v1/guided/v1/access",
      authentication: "dedicated_bearer_token",
      capabilitiesEndpoint: "/v1/guided/v1/capabilities",
      configured: configuredToken.length > 0,
      enabled: Boolean(enabled),
      instructionsEndpoint: "/v1/guided/v1/instructions",
      bootstrapEndpoint: "/v1/guided/v2/bootstrap",
      canonicalAuthority: authorityClass,
      providerCredentialAccepted: false,
      providerNeutral: true,
      schemaVersion: "cimmich.guided-setup.v1",
      visibility: "credential_and_session_scoped",
      visibilityCeiling: ceiling,
    }),
  };
};
