import {
  inventoryOnlyMediaOperatorEnvelope,
  mediaOperatorEnvelopeJsonSchema,
} from "./media-operator-contract.mjs";
import { contextEntityContract } from "./context-entities.mjs";

export const guidedBootstrapSchemaVersion = "cimmich.guided-bootstrap.v2";
export const guidedRouteCatalogSchemaVersion =
  "cimmich.guided-route-catalog.v1";

const boundedString = (maximum = 200) => ({
  maxLength: maximum,
  minLength: 1,
  type: "string",
});
const nullableString = (maximum = 200) => ({
  anyOf: [boundedString(maximum), { type: "null" }],
});
const pointSchema = {
  additionalProperties: false,
  properties: {
    latitude: { maximum: 90, minimum: -90, type: "number" },
    longitude: { maximum: 180, minimum: -180, type: "number" },
  },
  required: ["latitude", "longitude"],
  type: "object",
};
const placeGeometrySchema = {
  oneOf: [
    pointSchema,
    {
      additionalProperties: false,
      properties: Object.fromEntries(
        ["east", "north", "south", "west"].map((field) => [
          field,
          {
            maximum: field === "north" || field === "south" ? 90 : 180,
            minimum: field === "north" || field === "south" ? -90 : -180,
            type: "number",
          },
        ]),
      ),
      required: ["north", "south", "east", "west"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        points: {
          items: pointSchema,
          maxItems: 500,
          minItems: 2,
          type: "array",
        },
      },
      required: ["points"],
      type: "object",
    },
    { type: "null" },
  ],
};
const immichOnboardingScopeSchema = {
  additionalProperties: false,
  properties: {
    importPeople: { type: "boolean" },
    includeHiddenPeople: { type: "boolean" },
    mediaKinds: {
      items: { enum: ["image", "video"], type: "string" },
      maxItems: 2,
      minItems: 1,
      uniqueItems: true,
      type: "array",
    },
    providerMode: { enum: ["deferred", "configured"], type: "string" },
    visibilities: {
      items: {
        enum: ["timeline", "archive", "hidden", "locked"],
        type: "string",
      },
      maxItems: 4,
      minItems: 1,
      uniqueItems: true,
      type: "array",
    },
  },
  type: "object",
};
const relationKindsByFamily = {
  events: contextEntityContract.relationKinds,
  objects: ["related"],
  places: ["parent", "related"],
};
const relationTargetByKind = {
  companion: "pet",
  location: "place",
  object: "object",
  participant: "person",
};
const relationItemSchema = (family) => ({
  additionalProperties: false,
  allOf: [
    ...Object.entries(relationTargetByKind).map(([relationKind, targetKind]) =>
      relationKindsByFamily[family].includes(relationKind)
        ? {
            if: {
              properties: { relationKind: { const: relationKind } },
              required: ["relationKind"],
            },
            then: { properties: { targetKind: { const: targetKind } } },
          }
        : null,
    ),
    ...(relationKindsByFamily[family].includes("parent")
      ? [
          {
            if: {
              properties: { relationKind: { const: "parent" } },
              required: ["relationKind"],
            },
            then: {
              properties: {
                targetKind: { const: family.slice(0, -1) },
              },
            },
          },
        ]
      : []),
  ].filter(Boolean),
  properties: {
    direction: { const: "outgoing", type: "string" },
    relationKind: {
      enum: relationKindsByFamily[family],
      type: "string",
    },
    targetId: boundedString(200),
    targetKind: {
      enum: contextEntityContract.targetKinds,
      type: "string",
    },
  },
  required: ["targetKind", "targetId", "direction", "relationKind"],
  type: "object",
});
const contextMutationResponse = {
  additionalProperties: true,
  properties: {
    changedAssetIds: { items: boundedString(), type: "array" },
    changedRelationIds: { items: boundedString(), type: "array" },
    commandId: boundedString(120),
    decisionId: nullableString(200),
    detail: {
      additionalProperties: true,
      properties: {
        entity: {
          additionalProperties: true,
          properties: {
            entityId: boundedString(200),
            revision: { minimum: 0, type: "integer" },
          },
          required: ["entityId", "revision"],
          type: "object",
        },
      },
      required: ["entity"],
      type: "object",
    },
    replayed: { type: "boolean" },
    schemaVersion: { const: "cimmich.context-entity.v1" },
    status: { enum: ["applied", "no_change"], type: "string" },
    undo: {
      additionalProperties: false,
      properties: {
        eligible: { type: "boolean" },
        token: { type: ["string", "null"] },
      },
      required: ["eligible", "token"],
      type: "object",
    },
    unchangedAssetIds: { items: boundedString(), type: "array" },
    unchangedRelationIds: { items: boundedString(), type: "array" },
  },
  required: [
    "commandId",
    "decisionId",
    "detail",
    "replayed",
    "schemaVersion",
    "status",
    "undo",
  ],
  type: "object",
};

const sourcePackGateReceiptSchema = {
  additionalProperties: false,
  properties: {
    authorityScope: { const: "human-review", type: "string" },
    cohortDigest: { pattern: "^[0-9a-f]{64}$", type: "string" },
    leakage: {
      additionalProperties: true,
      properties: {
        passed: { const: true, type: "boolean" },
        queryReferenceOverlap: { const: 0, type: "integer" },
      },
      required: ["passed", "queryReferenceOverlap"],
      type: "object",
    },
    matcherPolicy: {
      oneOf: [
        {
          additionalProperties: false,
          properties: {
            marginFloor: { maximum: 1, minimum: 0, type: "number" },
            policyVersion: {
              const: "cimmich-best-prime-v1",
              type: "string",
            },
            scoreFloor: { maximum: 1, minimum: 0, type: "number" },
            scorer: { const: "best_individual_prime", type: "string" },
          },
          required: ["marginFloor", "policyVersion", "scoreFloor", "scorer"],
          type: "object",
        },
        { type: "null" },
      ],
    },
    metrics: {
      additionalProperties: false,
      properties: {
        decisionPrecisionPercent: { maximum: 100, minimum: 0, type: "number" },
        knownCorrectCoveragePercent: {
          maximum: 100,
          minimum: 0,
          type: "number",
        },
        unknownFalseAcceptRatePercent: {
          maximum: 100,
          minimum: 0,
          type: "number",
        },
        verifiedUnknowns: { minimum: 0, type: "integer" },
      },
      required: [
        "decisionPrecisionPercent",
        "knownCorrectCoveragePercent",
        "unknownFalseAcceptRatePercent",
        "verifiedUnknowns",
      ],
      type: "object",
    },
    packId: boundedString(200),
    schemaVersion: {
      const: "cimmich.source-pack-gate-evaluation.v1",
      type: "string",
    },
    split: { additionalProperties: true, type: "object" },
    status: { enum: ["passed", "failed"], type: "string" },
    thresholds: {
      additionalProperties: false,
      properties: {
        maximumUnknownFalseAcceptRatePercent: {
          maximum: 100,
          minimum: 0,
          type: "number",
        },
        minimumDecisionPrecisionPercent: {
          maximum: 100,
          minimum: 0,
          type: "number",
        },
        minimumVerifiedUnknowns: { minimum: 1, type: "integer" },
      },
      required: [
        "maximumUnknownFalseAcceptRatePercent",
        "minimumDecisionPrecisionPercent",
        "minimumVerifiedUnknowns",
      ],
      type: "object",
    },
  },
  required: [
    "authorityScope",
    "cohortDigest",
    "leakage",
    "metrics",
    "packId",
    "schemaVersion",
    "status",
    "thresholds",
  ],
  type: "object",
};

const sourcePackReviewGateNullReasonSchema = {
  enum: [
    "CALIBRATION_KNOWN_COHORT_MISSING",
    "CALIBRATION_UNKNOWN_COHORT_MISSING",
    "EVALUATION_ARTIFACT_INVALID",
    "EVALUATION_REQUIRED",
    "HOLDOUT_KNOWN_COHORT_MISSING",
    "INSUFFICIENT_VERIFIED_UNKNOWNS",
    "LEAKAGE_OR_PROVENANCE_CHECK_FAILED",
    "NO_USEFUL_REVIEW_COVERAGE",
    "REVIEW_GATE_NOT_DERIVED",
    null,
  ],
  type: ["string", "null"],
};

const sourcePackProjectionSchema = {
  additionalProperties: false,
  properties: {
    evaluation: {
      additionalProperties: false,
      properties: {
        evaluationId: nullableString(200),
        reason: nullableString(120),
        status: {
          enum: ["untested", "incomplete", "passed", "failed"],
          type: "string",
        },
      },
      required: ["evaluationId", "reason", "status"],
      type: "object",
    },
    evidence: {
      additionalProperties: false,
      properties: Object.fromEntries(
        [
          "people",
          "primeFaces",
          "prototypes",
          "references",
          "secondaryFaces",
        ].map((field) => [field, { minimum: 0, type: "integer" }]),
      ),
      required: [
        "people",
        "primeFaces",
        "prototypes",
        "references",
        "secondaryFaces",
      ],
      type: "object",
    },
    packId: boundedString(200),
    predecessorPackId: nullableString(200),
    reviewGateReceipt: {
      anyOf: [sourcePackGateReceiptSchema, { type: "null" }],
    },
    reviewGateReceiptNullReason: sourcePackReviewGateNullReasonSchema,
    rollbackAvailable: { type: "boolean" },
    state: {
      enum: ["proposed", "shadow", "active", "retired", "rejected"],
      type: "string",
    },
  },
  required: [
    "evaluation",
    "evidence",
    "packId",
    "predecessorPackId",
    "reviewGateReceipt",
    "reviewGateReceiptNullReason",
    "rollbackAvailable",
    "state",
  ],
  type: "object",
};

const sourcePackEvaluationProjectionSchema = {
  additionalProperties: false,
  properties: {
    evaluationId: nullableString(200),
    gateContract: {
      const: "cimmich.source-pack-gate-evaluation.v1",
      type: "string",
    },
    leakage: {
      additionalProperties: false,
      properties: {
        passed: { type: "boolean" },
        queryReferenceOverlap: { minimum: 0, type: "integer" },
      },
      required: ["passed", "queryReferenceOverlap"],
      type: "object",
    },
    metrics: {
      items: {
        additionalProperties: false,
        properties: {
          accuracy: { maximum: 1, minimum: 0, type: "number" },
          correct: { minimum: 0, type: "integer" },
          lane: boundedString(80),
          macroAccuracy: { maximum: 1, minimum: 0, type: "number" },
          people: { minimum: 0, type: "integer" },
          queries: { minimum: 0, type: "integer" },
          routedQueries: { minimum: 0, type: "integer" },
          split: { enum: ["calibration", "holdout"], type: "string" },
        },
        required: [
          "accuracy",
          "correct",
          "lane",
          "macroAccuracy",
          "people",
          "queries",
          "routedQueries",
          "split",
        ],
        type: "object",
      },
      maxItems: 12,
      type: "array",
    },
    reason: boundedString(120),
    reviewGateReceipt: {
      anyOf: [sourcePackGateReceiptSchema, { type: "null" }],
    },
    reviewGateReceiptNullReason: sourcePackReviewGateNullReasonSchema,
    reviewArtifact: {
      anyOf: [
        {
          additionalProperties: false,
          properties: {
            cohortDigest: { pattern: "^[0-9a-f]{64}$", type: "string" },
            split: { additionalProperties: true, type: "object" },
            verifiedUnknowns: { minimum: 0, type: "integer" },
          },
          required: ["cohortDigest", "split", "verifiedUnknowns"],
          type: "object",
        },
        { type: "null" },
      ],
    },
    status: {
      enum: ["untested", "incomplete", "passed", "failed"],
      type: "string",
    },
  },
  required: [
    "evaluationId",
    "gateContract",
    "leakage",
    "metrics",
    "reason",
    "reviewGateReceipt",
    "reviewGateReceiptNullReason",
    "reviewArtifact",
    "status",
  ],
  type: "object",
};

const sourcePackMutationResponseSchema = (properties, required) => ({
  additionalProperties: false,
  properties: {
    automaticIdentityAuthority: { const: "none" },
    changed: { type: "boolean" },
    replayed: { type: "boolean" },
    schemaVersion: {
      const: "cimmich.face-matching-operator.v1",
      type: "string",
    },
    ...properties,
  },
  required: [
    "automaticIdentityAuthority",
    "changed",
    "replayed",
    "schemaVersion",
    ...required,
  ],
  type: "object",
});

const definitions = [
  {
    authority: "read",
    domain: "system",
    id: "system.health",
    methods: ["GET"],
    pathTemplate: "/health",
    purpose: "Verify Cimmich schema, patch and service readiness.",
  },
  {
    authority: "read",
    domain: "system",
    id: "decisions.history",
    methods: ["GET"],
    pathTemplate: "/v1/decisions",
    purpose:
      "Read a bounded visibility-filtered history of reversible owner decisions and their exact canonical Undo links.",
    query: { optional: ["limit"] },
  },
  {
    authority: "read",
    domain: "visibility",
    id: "visibility.status",
    methods: ["GET"],
    pathTemplate: "/v1/visibility/status",
    purpose: "Read the credential/session viewing scope.",
  },
  {
    authority: "operate",
    commandId: false,
    domain: "visibility",
    id: "visibility.mode",
    methods: ["POST"],
    pathTemplate: "/v1/visibility/mode",
    purpose: "Select Standard, Personal or Private for the bound device.",
    request: {
      required: ["intentSequence", "viewingMode"],
      viewingMode: ["standard", "personal", "private"],
    },
  },
  {
    authority: "read",
    domain: "documents",
    id: "documents.detail",
    methods: ["GET"],
    pathTemplate: "/v1/documents/{documentId}",
    purpose: "Read one current visibility-filtered Document and its links.",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "documents",
    id: "documents.update",
    methods: ["PATCH"],
    pathTemplate: "/v1/documents/{documentId}",
    purpose: "Revision-safely update one Cimmich Document.",
    request: {
      optional: [
        "displayTitle",
        "documentKind",
        "documentLabel",
        "expiresOn",
        "issuedOn",
        "status",
        "visibilityTier",
      ],
      required: ["commandId", "expectedRevision"],
    },
    undo: "/v1/document-decisions/{decisionId}/undo",
  },
  ...["attach", "detach"].map((action) => ({
    authority: "operate",
    commandId: true,
    domain: "documents",
    id: `documents.links_${action}`,
    methods: ["POST"],
    pathTemplate: `/v1/documents/{documentId}/links:${action}`,
    purpose: `${action === "attach" ? "Attach" : "Detach"} explicit typed links on one visible Document.`,
    request: {
      properties: {
        links: {
          items: {
            additionalProperties: false,
            properties: {
              linkKind: boundedString(80),
              subjectId: boundedString(200),
              subjectKind: {
                enum: ["person", "pet", "place", "object", "event", "asset"],
                type: "string",
              },
            },
            required: ["subjectKind", "subjectId", "linkKind"],
            type: "object",
          },
          maxItems: 100,
          minItems: 1,
          type: "array",
        },
      },
      required: ["commandId", "links"],
    },
    undo: "/v1/document-decisions/{decisionId}/undo",
  })),
  {
    authority: "operate",
    commandId: true,
    domain: "documents",
    id: "documents.undo",
    methods: ["POST"],
    pathTemplate: "/v1/document-decisions/{decisionId}/undo",
    purpose: "Undo exactly one current dependency-safe Document decision.",
    request: { required: ["commandId"] },
  },
  {
    authority: "operate",
    commandId: false,
    domain: "visibility",
    id: "visibility.unlock",
    methods: ["POST"],
    pathTemplate: "/v1/visibility/unlock",
    purpose: "Create a bounded Private session using the user's credential.",
    request: { required: ["password"] },
  },
  {
    authority: "operate",
    commandId: false,
    domain: "visibility",
    id: "visibility.lock",
    methods: ["POST"],
    pathTemplate: "/v1/visibility/lock",
    purpose: "End the current Private session.",
    request: {
      example: { reason: "explicit" },
      properties: {
        reason: {
          enum: ["explicit", "background", "device_lock", "account_lock"],
          type: "string",
        },
      },
      required: ["reason"],
    },
  },
  {
    authority: "read",
    domain: "library",
    id: "library.summary",
    methods: ["GET"],
    pathTemplate: "/v1/summary",
    purpose: "Read current visible library counts and review state.",
  },
  {
    authority: "read",
    domain: "integration",
    id: "immich.status",
    methods: ["GET"],
    pathTemplate: "/v1/companion/status",
    purpose: "Verify the configured read-only Cimmich↔Immich companion.",
  },
  {
    authority: "read",
    domain: "integration",
    id: "immich.onboarding_status",
    methods: ["GET"],
    pathTemplate: "/v1/onboarding/immich",
    purpose:
      "Discover resumable connection/import state and the exact next setup action.",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "integration",
    id: "immich.connect",
    methods: ["POST"],
    pathTemplate: "/v1/onboarding/immich/connect",
    purpose:
      "Validate and privately store one least-privilege Immich API credential; the secret is write-only and never returned.",
    request: {
      example: {
        apiBaseUrl: "http://immich.example:2283",
        credential: "user-supplied-write-only-secret",
        commandId: "guided-immich-connect-0001",
      },
      properties: {
        apiBaseUrl: {
          format: "uri",
          maxLength: 500,
          minLength: 8,
          type: "string",
        },
        credential: {
          maxLength: 512,
          minLength: 16,
          type: "string",
          writeOnly: true,
        },
      },
      required: ["commandId", "apiBaseUrl", "credential"],
    },
  },
  {
    authority: "read",
    domain: "integration",
    id: "immich.onboarding_preview",
    methods: ["POST"],
    pathTemplate: "/v1/onboarding/immich/preview",
    purpose:
      "Read exact visibility-bounded asset, People and assigned/unassigned Face counts before import.",
    request: {
      example: {
        scope: {
          importPeople: true,
          includeHiddenPeople: false,
          mediaKinds: ["image", "video"],
          providerMode: "deferred",
          visibilities: ["timeline"],
        },
      },
      optional: ["scope"],
      properties: { scope: immichOnboardingScopeSchema },
    },
  },
  {
    authority: "operate",
    commandId: true,
    domain: "integration",
    id: "immich.onboarding_import",
    methods: ["POST"],
    pathTemplate: "/v1/onboarding/immich/import",
    purpose:
      "Admit the previewed scope and import current Immich Person/Face labels as source-proven human truth with zero automatic identity authority.",
    request: {
      example: {
        commandId: "guided-immich-import-0001",
        previewDigest: "0".repeat(64),
        scope: {
          importPeople: true,
          includeHiddenPeople: false,
          mediaKinds: ["image", "video"],
          providerMode: "deferred",
          visibilities: ["timeline"],
        },
      },
      properties: {
        previewDigest: { pattern: "^[0-9a-f]{64}$", type: "string" },
        scope: immichOnboardingScopeSchema,
      },
      required: ["commandId", "previewDigest", "scope"],
    },
    continuation: { statusOperation: "immich.onboarding_status" },
  },
  {
    authority: "read",
    domain: "integration",
    id: "immich.person_clusters_preview",
    methods: ["POST"],
    pathTemplate: "/v1/onboarding/immich/person-clusters:preview",
    purpose:
      "Preview visible unnamed Immich Person clusters, one representative Face crop binding and current explicit owner resolution.",
    request: {
      example: {
        scope: {
          importPeople: true,
          includeHiddenPeople: false,
          mediaKinds: ["image", "video"],
          providerMode: "deferred",
          visibilities: ["timeline"],
        },
      },
      properties: { scope: immichOnboardingScopeSchema },
      required: ["scope"],
    },
  },
  {
    authority: "operate",
    commandId: true,
    domain: "integration",
    id: "immich.person_cluster_resolve",
    methods: ["POST"],
    pathTemplate:
      "/v1/onboarding/immich/person-clusters/{immichPersonId}/resolve",
    purpose:
      "Record one explicit human mapping, new Person, Later, Unknown or noise decision for the exact current unnamed cluster.",
    request: {
      example: {
        action: "existing_person",
        commandId: "guided-immich-person-resolve-0001",
        expectedSourceRevision: "0".repeat(64),
        personId: "person_example",
        scope: {
          importPeople: true,
          includeHiddenPeople: false,
          mediaKinds: ["image", "video"],
          providerMode: "deferred",
          visibilities: ["timeline"],
        },
        snapshotDigest: "0".repeat(64),
      },
      optional: ["newPersonName", "personId"],
      properties: {
        action: {
          enum: [
            "create_person",
            "existing_person",
            "later",
            "noise",
            "unknown",
          ],
          type: "string",
        },
        expectedSourceRevision: {
          pattern: "^[0-9a-f]{64}$",
          type: "string",
        },
        newPersonName: boundedString(160),
        personId: boundedString(120),
        scope: immichOnboardingScopeSchema,
        snapshotDigest: { pattern: "^[0-9a-f]{64}$", type: "string" },
      },
      required: [
        "action",
        "commandId",
        "expectedSourceRevision",
        "scope",
        "snapshotDigest",
      ],
    },
    undo: "/v1/onboarding/immich/person-clusters/decisions/{decisionId}/undo",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "integration",
    id: "immich.person_cluster_resolution_undo",
    methods: ["POST"],
    pathTemplate:
      "/v1/onboarding/immich/person-clusters/decisions/{decisionId}/undo",
    purpose:
      "Undo the exact current dependency-free unnamed-cluster decision after revalidating its visible upstream snapshot.",
    request: {
      example: {
        commandId: "guided-immich-person-undo-0001",
        scope: {
          importPeople: true,
          includeHiddenPeople: false,
          mediaKinds: ["image", "video"],
          providerMode: "deferred",
          visibilities: ["timeline"],
        },
      },
      properties: { scope: immichOnboardingScopeSchema },
      required: ["commandId", "scope"],
    },
  },
  {
    authority: "read",
    domain: "integration",
    id: "immich.inventory_status",
    methods: ["GET"],
    pathTemplate: "/v1/companion/inventory",
    purpose: "Read Cimmich inventory synchronization status.",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "integration",
    id: "immich.sync",
    methods: ["POST"],
    pathTemplate: "/v1/operator/media-pipeline",
    purpose: "Run bounded inventory/detection/recognition stages after upload.",
    request: {
      required: ["commandId", "commandKind", "envelope"],
      commandKind: ["run"],
      example: {
        commandId: "guided-inventory-sync-0001",
        commandKind: "run",
        envelope: inventoryOnlyMediaOperatorEnvelope,
      },
      envelopeSchema: mediaOperatorEnvelopeJsonSchema,
      note: "Use maxInventoryPages>0 for admission; detection/recognition remain separately bounded and configured.",
    },
    responseExample: {
      activationAuthority: "none",
      commandId: "guided-inventory-sync-0001",
      inventory: {
        admittedAssetCount: 1,
        admittedAssets: [
          {
            assetId: "asset_immich_example",
            sourceAssetId: "immich_source_asset_example",
          },
        ],
        admittedAssetsTruncated: false,
        runId: "immich_inventory_run_example",
        state: "processing",
      },
      schemaVersion: "cimmich.media-operator.v1",
      state: "completed",
      work: {
        candidates: 0,
        detections: 0,
        inventoryPages: 1,
        recognitions: 0,
      },
    },
    responseSchema: {
      additionalProperties: true,
      properties: {
        activationAuthority: { const: "none" },
        commandId: boundedString(128),
        inventory: {
          additionalProperties: false,
          properties: {
            admittedAssetCount: { minimum: 0, type: "integer" },
            admittedAssets: {
              items: {
                additionalProperties: false,
                properties: {
                  assetId: boundedString(200),
                  sourceAssetId: boundedString(200),
                },
                required: ["assetId", "sourceAssetId"],
                type: "object",
              },
              maxItems: 1_000,
              type: "array",
            },
            admittedAssetsTruncated: { type: "boolean" },
            runId: { type: ["string", "null"] },
            state: { enum: ["processing", "completed"], type: "string" },
          },
          required: [
            "admittedAssetCount",
            "admittedAssets",
            "admittedAssetsTruncated",
            "runId",
            "state",
          ],
          type: "object",
        },
        schemaVersion: { const: "cimmich.media-operator.v1" },
        state: {
          enum: ["completed", "budget_exhausted", "backpressure", "paused"],
          type: "string",
        },
        work: {
          additionalProperties: false,
          properties: Object.fromEntries(
            ["candidates", "detections", "inventoryPages", "recognitions"].map(
              (field) => [field, { minimum: 0, type: "integer" }],
            ),
          ),
          required: [
            "candidates",
            "detections",
            "inventoryPages",
            "recognitions",
          ],
          type: "object",
        },
      },
      required: [
        "activationAuthority",
        "commandId",
        "inventory",
        "schemaVersion",
        "state",
        "work",
      ],
      type: "object",
    },
  },
  {
    authority: "read",
    domain: "integration",
    id: "media_operator.status",
    methods: ["GET"],
    pathTemplate: "/v1/operator/media-pipeline",
    purpose: "Read bounded media-operator and queue state.",
  },
  {
    authority: "read",
    domain: "matching",
    id: "enhanced.status",
    methods: ["GET"],
    pathTemplate: "/v1/operator/enhanced",
    purpose:
      "Read owner-controlled Enhanced availability, installed version, update and rollback state while Core remains independent.",
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "matching",
    id: "enhanced.control",
    methods: ["POST"],
    pathTemplate: "/v1/operator/enhanced",
    purpose:
      "Enable, disable, update or roll back the independently versioned Enhanced matcher after compatibility shadow replay.",
    request: {
      example: {
        action: "enable",
        commandId: "guided-enhanced-enable-0001",
        expectedRevision: 1,
        targetVersion: null,
      },
      properties: {
        action: {
          enum: ["enable", "disable", "update", "rollback"],
          type: "string",
        },
        targetVersion: {
          anyOf: [
            { pattern: "^\\d+\\.\\d+\\.\\d+$", type: "string" },
            { type: "null" },
          ],
        },
      },
      required: ["action", "commandId", "expectedRevision", "targetVersion"],
    },
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "read",
    domain: "matching",
    id: "face_matching.status",
    methods: ["GET"],
    pathTemplate: "/v1/operator/face-matching",
    purpose:
      "Read validated provider, recognition evidence, SourcePack and exact next-action state.",
    responseSchema: {
      additionalProperties: false,
      properties: {
        automaticIdentityAuthority: { const: "none" },
        basicIdentityTruthRetainedWhenDisabled: { const: true },
        evidence: {
          additionalProperties: false,
          properties: {
            acceptedFaces: { minimum: 0, type: "integer" },
            analysedFaces: { minimum: 0, type: "integer" },
            eligibleFaces: { minimum: 0, type: "integer" },
            providerEmbeddings: { minimum: 0, type: "integer" },
          },
          required: ["acceptedFaces", "analysedFaces", "eligibleFaces", "providerEmbeddings"],
          type: "object",
        },
        latestPack: {
          anyOf: [sourcePackProjectionSchema, { type: "null" }],
        },
        next: {
          additionalProperties: false,
          properties: {
            action: {
              enum: [
                "await_more_evidence",
                "configure_provider",
                "enable_enhanced",
                "run_recognition",
                "compile_source_pack",
                "evaluate_source_pack",
                "record_operator_review",
                "activate_source_pack",
                "review_suggestions",
              ],
              type: "string",
            },
            reason: boundedString(120),
            settings: boundedString(240),
          },
          required: ["action", "reason"],
          type: "object",
        },
        provider: {
          additionalProperties: false,
          properties: {
            configured: { type: "boolean" },
            modelFamily: boundedString(160),
            modelVersion: boundedString(160),
            providerId: boundedString(160),
          },
          required: ["configured"],
          type: "object",
        },
        providerValidation: {
          additionalProperties: false,
          properties: {
            modelFamily: boundedString(160),
            modelVersion: boundedString(160),
            providerId: boundedString(160),
            state: { enum: ["disabled", "ready"], type: "string" },
            vectorSpaceId: boundedString(192),
          },
          required: ["state"],
          type: "object",
        },
        review: {
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            humanAcceptanceRequired: { const: true },
            marginFloor: { type: ["number", "null"] },
            policyVersion: { const: "cimmich-best-prime-v1" },
            scoreFloor: { type: ["number", "null"] },
          },
          required: [
            "enabled",
            "humanAcceptanceRequired",
            "marginFloor",
            "policyVersion",
            "scoreFloor",
          ],
          type: "object",
        },
        schemaVersion: { const: "cimmich.face-matching-status.v1" },
        sourcePack: {
          additionalProperties: false,
          properties: {
            activePassed: { minimum: 0, type: "integer" },
            awaitingReview: { minimum: 0, type: "integer" },
          },
          required: ["activePassed", "awaitingReview"],
          type: "object",
        },
        state: {
          enum: [
            "provider_disabled",
            "needs_source_pack",
            "needs_operator_review",
            "needs_review_policy",
            "ready",
          ],
          type: "string",
        },
      },
      required: [
        "automaticIdentityAuthority",
        "basicIdentityTruthRetainedWhenDisabled",
        "evidence",
        "latestPack",
        "next",
        "provider",
        "providerValidation",
        "review",
        "schemaVersion",
        "sourcePack",
        "state",
      ],
      type: "object",
    },
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "matching",
    id: "face_matching.recognition_run",
    methods: ["POST"],
    pathTemplate: "/v1/operator/face-matching/recognition",
    purpose:
      "Start or resume one bounded configured-provider inventory/detection/recognition pass.",
    request: {
      example: {
        commandId: "guided-face-recognition-0001",
        workLimit: 10,
      },
      properties: {
        workLimit: { maximum: 25, minimum: 1, type: "integer" },
      },
      required: ["commandId", "workLimit"],
    },
    responseSchema: {
      additionalProperties: false,
      properties: {
        automaticIdentityAuthority: { const: "none" },
        commandId: boundedString(128),
        inventory: {
          anyOf: [
            {
              additionalProperties: false,
              properties: {
                admittedAssetCount: { minimum: 0, type: "integer" },
                state: { type: ["string", "null"] },
              },
              required: ["admittedAssetCount", "state"],
              type: "object",
            },
            { type: "null" },
          ],
        },
        queue: {
          additionalProperties: false,
          properties: Object.fromEntries(
            ["failed", "paused", "pending", "processing"].map((field) => [
              field,
              { minimum: 0, type: "integer" },
            ]),
          ),
          required: ["failed", "paused", "pending", "processing"],
          type: "object",
        },
        replayed: { type: "boolean" },
        schemaVersion: {
          const: "cimmich.face-matching-operator.v1",
          type: "string",
        },
        state: {
          enum: ["completed", "budget_exhausted", "backpressure", "paused"],
          type: "string",
        },
        work: {
          additionalProperties: false,
          properties: Object.fromEntries(
            ["detections", "inventoryPages", "recognitions"].map((field) => [
              field,
              { minimum: 0, type: "integer" },
            ]),
          ),
          required: ["detections", "inventoryPages", "recognitions"],
          type: "object",
        },
      },
      required: [
        "automaticIdentityAuthority",
        "commandId",
        "inventory",
        "queue",
        "replayed",
        "schemaVersion",
        "state",
        "work",
      ],
      type: "object",
    },
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "operate",
    commandId: false,
    continuation: {
      retry:
        "Compilation is content-addressed. Repeating against unchanged accepted evidence returns the same pack with replayed=true; changed evidence produces a new proposed pack.",
      statusOperation: "face_matching.status",
    },
    domain: "matching",
    id: "face_matching.source_pack_compile",
    methods: ["POST"],
    pathTemplate: "/v1/operator/face-matching/source-packs",
    purpose:
      "Compile one proposed provider-specific SourcePack from current accepted owner evidence using a server-derived temporal plan.",
    replay: {
      kind: "content_addressed",
      payloadConflict:
        "Provider, configuration, vector space and temporal split are server-derived; callers supply no competing policy fields.",
    },
    request: { required: [] },
    responseSchema: {
      additionalProperties: false,
      properties: {
        automaticIdentityAuthority: { const: "none" },
        changed: { type: "boolean" },
        pack: sourcePackProjectionSchema,
        plan: {
          additionalProperties: false,
          properties: {
            calibrationQueries: { minimum: 0, type: "integer" },
            completePeople: { minimum: 0, type: "integer" },
            holdoutQueries: { minimum: 0, type: "integer" },
            reason: nullableString(120),
            referenceEvidence: { minimum: 1, type: "integer" },
            referencePeople: { minimum: 1, type: "integer" },
            reviewability: {
              enum: [
                "balanced_open_set_holdout_ready",
                "operator_hold_required",
              ],
              type: "string",
            },
            schemaVersion: {
              const: "cimmich.owner-source-pack-plan.v1",
              type: "string",
            },
            strategy: {
              enum: [
                "deterministic_three_window",
                "all_current_evidence_proposed_only",
              ],
              type: "string",
            },
          },
          required: [
            "calibrationQueries",
            "completePeople",
            "holdoutQueries",
            "reason",
            "referenceEvidence",
            "referencePeople",
            "reviewability",
            "schemaVersion",
            "strategy",
          ],
          type: "object",
        },
        replayed: { type: "boolean" },
        schemaVersion: {
          const: "cimmich.face-matching-operator.v1",
          type: "string",
        },
      },
      required: [
        "automaticIdentityAuthority",
        "changed",
        "pack",
        "plan",
        "replayed",
        "schemaVersion",
      ],
      type: "object",
    },
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "read",
    domain: "matching",
    id: "face_matching.source_pack_read",
    methods: ["GET"],
    pathTemplate: "/v1/operator/face-matching/source-packs/{packId}",
    purpose:
      "Read one minimized SourcePack state without embeddings, names or private lineage.",
    responseSchema: {
      additionalProperties: false,
      properties: {
        automaticIdentityAuthority: { const: "none" },
        pack: sourcePackProjectionSchema,
        schemaVersion: {
          const: "cimmich.face-matching-operator.v1",
          type: "string",
        },
      },
      required: ["automaticIdentityAuthority", "pack", "schemaVersion"],
      type: "object",
    },
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "operate",
    commandId: false,
    continuation: {
      retry:
        "The first evaluator artifact for an immutable pack is reused byte-for-byte; new evidence requires a new pack.",
      statusOperation: "face_matching.source_pack_read",
    },
    domain: "matching",
    id: "face_matching.source_pack_evaluate",
    methods: ["POST"],
    pathTemplate: "/v1/operator/face-matching/source-packs/{packId}/evaluate",
    purpose:
      "Produce or replay the minimized frozen calibration/holdout artifact; it grants no activation authority.",
    replay: { kind: "immutable_pack_first_evaluation" },
    request: { required: [] },
    responseSchema: sourcePackMutationResponseSchema(
      {
        evaluation: sourcePackEvaluationProjectionSchema,
        pack: sourcePackProjectionSchema,
      },
      ["evaluation", "pack"],
    ),
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "operate",
    commandId: false,
    continuation: {
      retry:
        "The identical validated gate receipt replays; a different receipt for an already-reviewed pack fails with FACE_MATCHING_REVIEW_CONFLICT.",
      statusOperation: "face_matching.source_pack_read",
    },
    domain: "matching",
    id: "face_matching.source_pack_review",
    methods: ["POST"],
    pathTemplate: "/v1/operator/face-matching/source-packs/{packId}/review",
    purpose:
      "Record exactly one existing governed human-review gate receipt bound to the current evaluator cohort.",
    replay: { kind: "single_exact_gate_receipt" },
    request: {
      properties: { gateReceipt: sourcePackGateReceiptSchema },
      required: ["gateReceipt"],
    },
    responseSchema: sourcePackMutationResponseSchema(
      {
        disposition: { enum: ["passed", "failed"], type: "string" },
        pack: sourcePackProjectionSchema,
      },
      ["disposition", "pack"],
    ),
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "operate",
    commandId: false,
    continuation: {
      retry:
        "Exact evaluation and active-pack heads are required. An immediate identical retry is no-change; a changed head fails stale.",
      statusOperation: "face_matching.status",
    },
    domain: "matching",
    id: "face_matching.source_pack_activate",
    methods: ["POST"],
    pathTemplate: "/v1/operator/face-matching/source-packs/{packId}/activate",
    purpose:
      "Activate only a passed, operator-reviewed SourcePack through the existing guarded lifecycle.",
    replay: { kind: "expected_lifecycle_head" },
    request: {
      properties: {
        expectedCurrentPackId: nullableString(200),
        expectedEvaluationId: boundedString(200),
      },
      required: ["expectedCurrentPackId", "expectedEvaluationId"],
    },
    responseSchema: sourcePackMutationResponseSchema(
      {
        activated: { type: "boolean" },
        pack: sourcePackProjectionSchema,
        retiredPackIds: {
          items: boundedString(200),
          maxItems: 1,
          type: "array",
        },
      },
      ["activated", "pack", "retiredPackIds"],
    ),
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "operate",
    commandId: false,
    continuation: {
      retry:
        "Rollback requires the exact predecessor head. Immediate replay is no-change; unrelated lifecycle movement fails stale.",
      statusOperation: "face_matching.status",
    },
    domain: "matching",
    id: "face_matching.source_pack_rollback",
    methods: ["POST"],
    pathTemplate: "/v1/operator/face-matching/source-packs/{packId}/rollback",
    purpose:
      "Rollback an active successor only to its still-passed exact predecessor.",
    replay: { kind: "expected_predecessor_head" },
    request: {
      required: ["expectedPredecessorPackId"],
    },
    responseSchema: sourcePackMutationResponseSchema(
      {
        restoredPackId: boundedString(200),
        rolledBack: { type: "boolean" },
      },
      ["restoredPackId", "rolledBack"],
    ),
    uiVerificationLink: "/cimmich/maintenance",
  },
  {
    authority: "read",
    domain: "people",
    id: "people.collection",
    methods: ["GET"],
    pathTemplate: "/v1/people",
    purpose: "Find an existing visible Person before creating or tagging.",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "people",
    id: "people.create",
    methods: ["POST"],
    pathTemplate: "/v1/people",
    purpose: "Create one Person when exact name/alias collision checks pass.",
    request: { required: ["commandId", "newPersonName"] },
  },
  {
    authority: "read",
    domain: "people",
    id: "people.detail",
    methods: ["GET"],
    pathTemplate: "/v1/people/{personId}",
    purpose: "Read one visibility-filtered Person projection.",
  },
  {
    authority: "read",
    domain: "people",
    id: "people.merge_preview",
    methods: ["GET"],
    pathTemplate: "/v1/people/merge-preview",
    purpose:
      "Preview one exact reversible Person merge without changing identity truth.",
    query: { required: ["sourcePersonId", "targetPersonId"] },
  },
  {
    authority: "operate",
    commandId: true,
    domain: "people",
    id: "people.merge",
    methods: ["POST"],
    pathTemplate: "/v1/people/merge",
    purpose:
      "Merge one reviewed duplicate Person into another through the canonical reversible ledger.",
    request: {
      required: ["commandId", "sourcePersonId", "targetPersonId"],
    },
    undo: "/v1/people/merges/{mergeOperationId}/unmerge",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "people",
    id: "people.unmerge",
    methods: ["POST"],
    pathTemplate: "/v1/people/merges/{mergeOperationId}/unmerge",
    purpose:
      "Reverse exactly one still-current Person merge without rewriting unrelated identity truth.",
    request: { required: ["commandId"] },
  },
  {
    authority: "read",
    domain: "pets",
    id: "pets.collection",
    methods: ["GET"],
    pathTemplate: "/v1/pets",
    purpose: "List current visibility-filtered Pets.",
    query: { optional: ["q", "limit", "includeHidden"] },
  },
  {
    authority: "operate",
    commandId: true,
    domain: "pets",
    id: "pets.create",
    methods: ["POST"],
    pathTemplate: "/v1/pets",
    purpose: "Create one Pet through the canonical conflict-safe ledger.",
    request: {
      optional: [
        "aliases",
        "breedLabel",
        "coverAssetId",
        "coverCrop",
        "description",
        "speciesLabel",
      ],
      properties: {
        aliases: { items: boundedString(160), maxItems: 30, type: "array" },
        breedLabel: nullableString(160),
        coverAssetId: nullableString(200),
        description: nullableString(4_000),
        displayName: boundedString(160),
        speciesKind: {
          enum: ["dog", "cat", "bird", "horse", "rabbit", "other", "unknown"],
          type: "string",
        },
        speciesLabel: nullableString(160),
      },
      required: ["commandId", "displayName", "speciesKind"],
    },
  },
  {
    authority: "read",
    domain: "pets",
    id: "pets.merge_preview",
    methods: ["GET"],
    pathTemplate: "/v1/pets/merge-preview",
    purpose: "Preview one exact reversible Pet merge.",
    query: { required: ["sourcePetId", "targetPetId"] },
  },
  {
    authority: "operate",
    commandId: true,
    domain: "pets",
    id: "pets.merge",
    methods: ["POST"],
    pathTemplate: "/v1/pets/merge",
    purpose: "Merge one reviewed duplicate Pet through the canonical ledger.",
    request: { required: ["commandId", "sourcePetId", "targetPetId"] },
    undo: "/v1/pets/merges/{mergeOperationId}/unmerge",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "pets",
    id: "pets.unmerge",
    methods: ["POST"],
    pathTemplate: "/v1/pets/merges/{mergeOperationId}/unmerge",
    purpose: "Reverse exactly one still-current Pet merge.",
    request: { required: ["commandId"] },
  },
  {
    authority: "read",
    domain: "assets",
    id: "assets.search",
    methods: ["GET"],
    pathTemplate: "/v1/search/media",
    purpose: "Find visible admitted assets by current Cimmich search truth.",
  },
  {
    authority: "read",
    domain: "assets",
    id: "assets.smart_search",
    methods: ["GET"],
    pathTemplate: "/v1/search/smart",
    purpose:
      "Search visible admitted media through the canonical smart-search projection.",
    query: { optional: ["q", "limit"] },
  },
  {
    authority: "read",
    domain: "assets",
    id: "assets.evidence",
    methods: ["GET"],
    pathTemplate: "/v1/assets/evidence",
    purpose: "Read Detailed Face/Head/Body evidence and current links.",
    query: { required: ["sourceAssetId"] },
  },
  {
    authority: "read",
    domain: "documents",
    id: "documents.collection",
    methods: ["GET"],
    pathTemplate: "/v1/documents",
    purpose: "List current visibility-filtered Cimmich Documents.",
    query: {
      optional: [
        "documentKind",
        "includeArchived",
        "limit",
        "q",
        "subjectId",
        "subjectKind",
      ],
    },
  },
  {
    authority: "operate",
    commandId: true,
    domain: "documents",
    id: "documents.reference",
    methods: ["POST"],
    pathTemplate: "/v1/documents/reference",
    purpose:
      "Create one metadata-only Document reference to an already admitted visible asset.",
    request: {
      optional: [
        "documentLabel",
        "expiresOn",
        "issuedOn",
        "sourceFilename",
        "supersedesDocumentId",
      ],
      properties: {
        assetId: boundedString(200),
        displayTitle: boundedString(240),
        documentKind: boundedString(80),
        documentLabel: nullableString(160),
        expiresOn: nullableString(32),
        issuedOn: nullableString(32),
        sourceFilename: nullableString(240),
        supersedesDocumentId: nullableString(200),
        visibilityTier: {
          enum: ["standard", "personal", "private"],
          type: "string",
        },
      },
      required: [
        "assetId",
        "commandId",
        "displayTitle",
        "documentKind",
        "visibilityTier",
      ],
    },
  },
  {
    authority: "read",
    domain: "assets",
    id: "assets.subjects",
    methods: ["GET"],
    pathTemplate: "/v1/assets/{assetId}/subjects",
    purpose:
      "Read current visibility-filtered subjects for one admitted asset.",
  },
  {
    authority: "read",
    domain: "subjects",
    id: "face.matches",
    methods: ["GET"],
    pathTemplate: "/v1/faces/{faceId}/matches",
    purpose:
      "Read bounded review-only candidate matches for an unresolved Face.",
    query: { optional: ["limit"] },
  },
  {
    authority: "read",
    domain: "subjects",
    id: "manual_subject_tags.read",
    methods: ["GET"],
    pathTemplate: "/v1/assets/{assetId}/manual-subject-tags",
    purpose: "Read active typed human Face/Head/Body/Presence truth.",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "subjects",
    id: "manual_subject_tags.attach",
    methods: ["POST"],
    pathTemplate: "/v1/assets/{assetId}/manual-subject-tags",
    purpose: "Attach truthful human Face, Head, Body or Presence evidence.",
    request: {
      required: ["commandId", "tagType", "subjectId", "subjectKind", "region"],
      subjectKind: ["person", "pet"],
      tagType: ["face", "head", "body", "presence"],
    },
    undo: "/v1/manual-subject-tags/decisions/{decisionId}/undo",
  },
  {
    authority: "read",
    domain: "subjects",
    id: "manual_presences.read",
    methods: ["GET"],
    pathTemplate: "/v1/assets/{assetId}/manual-presences",
    purpose:
      "Read current manual Presence truth, including truthful regionless Presence.",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "subjects",
    id: "manual_presences.modify",
    methods: ["POST"],
    pathTemplate: "/v1/assets/{assetId}/manual-presences",
    purpose:
      "Attach or detach Presence with null geometry, a point or a normalized region; null never fabricates spatial evidence.",
    request: {
      example: {
        action: "attach",
        commandId: "guided-presence-attach-0001",
        geometry: null,
        subjectId: "person_example",
        subjectKind: "person",
      },
      properties: {
        action: { enum: ["attach", "detach"], type: "string" },
        geometry: {
          anyOf: [
            { type: "null" },
            {
              additionalProperties: false,
              properties: {
                kind: { const: "point", type: "string" },
                x: { maximum: 1, minimum: 0, type: "number" },
                y: { maximum: 1, minimum: 0, type: "number" },
              },
              required: ["kind", "x", "y"],
              type: "object",
            },
            {
              additionalProperties: false,
              properties: {
                h: { exclusiveMinimum: 0, maximum: 1, type: "number" },
                kind: { const: "region", type: "string" },
                w: { exclusiveMinimum: 0, maximum: 1, type: "number" },
                x: { maximum: 1, minimum: 0, type: "number" },
                y: { maximum: 1, minimum: 0, type: "number" },
              },
              required: ["kind", "x", "y", "w", "h"],
              type: "object",
            },
          ],
        },
        subjectId: boundedString(200),
        subjectKind: { enum: ["person", "pet"], type: "string" },
      },
      required: ["action", "commandId", "geometry", "subjectId", "subjectKind"],
    },
    undo: "/v1/manual-presences/decisions/{decisionId}/undo",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "subjects",
    id: "manual_presences.undo",
    methods: ["POST"],
    pathTemplate: "/v1/manual-presences/decisions/{decisionId}/undo",
    purpose: "Undo exactly one manual Presence decision.",
    request: { required: ["commandId"] },
  },
  ...["faces", "bodies"].flatMap((family) => [
    {
      authority: "operate",
      commandId: true,
      domain: "subjects",
      id: `${family}.geometry_correct`,
      methods: ["POST"],
      pathTemplate: `/v1/${family}/{observationId}/geometry`,
      purpose: `Revision-safely correct one ${family.slice(0, -1)} region.`,
      request: {
        optional: ["expectedDecisionId"],
        required: ["commandId", "expectedRevision", "region"],
      },
      undo: "/v1/observation-corrections/decisions/{decisionId}/undo",
    },
    {
      authority: "operate",
      commandId: true,
      domain: "subjects",
      id: `${family}.reject_detection`,
      methods: ["POST"],
      pathTemplate: `/v1/${family}/{observationId}/${family === "faces" ? "not-face" : "not-body"}`,
      purpose: `Reject one false ${family.slice(0, -1)} detection without deleting media.`,
      request: {
        optional: ["expectedDecisionId"],
        required: ["commandId", "expectedRevision"],
      },
      undo: "/v1/observation-corrections/decisions/{decisionId}/undo",
    },
  ]),
  {
    authority: "operate",
    commandId: true,
    domain: "subjects",
    id: "observation_corrections.undo",
    methods: ["POST"],
    pathTemplate: "/v1/observation-corrections/decisions/{decisionId}/undo",
    purpose: "Undo exactly one Face/Body geometry or rejection decision.",
    request: { required: ["commandId"] },
  },
  {
    authority: "operate",
    commandId: true,
    domain: "subjects",
    id: "manual_subject_tags.replace",
    methods: ["POST"],
    pathTemplate: "/v1/manual-subject-tags/{tagId}/replace",
    purpose: "Atomically replace a saved tag with revision-safe truth.",
    request: {
      required: [
        "commandId",
        "expectedDecisionId",
        "tagType",
        "subjectId",
        "subjectKind",
        "region",
      ],
      subjectKind: ["person", "pet"],
      tagType: ["face", "head", "body", "presence"],
    },
    undo: "/v1/manual-subject-tags/decisions/{decisionId}/undo",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "subjects",
    id: "manual_subject_tags.undo",
    methods: ["POST"],
    pathTemplate: "/v1/manual-subject-tags/decisions/{decisionId}/undo",
    purpose: "Undo exactly one typed manual-tag decision.",
    request: { required: ["commandId"] },
  },
  ...["places", "objects", "events"].flatMap((family) => [
    {
      authority: "read",
      domain: family,
      id: `${family}.collection`,
      methods: ["GET"],
      pathTemplate: `/v1/${family}`,
      purpose: `Search and list visible ${family}.`,
    },
    {
      authority: "operate",
      commandId: true,
      domain: family,
      id: `${family}.create`,
      methods: ["POST"],
      pathTemplate: `/v1/${family}`,
      purpose: `Create one ${family.slice(0, -1)} through the canonical ledger.`,
      request: {
        example: {
          commandId: `guided-${family}-create-0001`,
          displayName: `${family.slice(0, -1)} example`,
          geometry:
            family === "places"
              ? { latitude: -33.8568, longitude: 151.2153 }
              : null,
          typeKind: contextEntityContract.typedKinds[family.slice(0, -1)][0],
        },
        optional: [
          "aliases",
          "dateEnd",
          "datePrecision",
          "dateStart",
          "description",
          "geometry",
          "parentEntityId",
          "status",
        ],
        properties: {
          aliases: {
            items: boundedString(160),
            maxItems: 30,
            type: "array",
          },
          dateEnd: {
            anyOf: [
              { pattern: "^\\d{4}-\\d{2}-\\d{2}$", type: "string" },
              { type: "null" },
            ],
          },
          datePrecision: {
            enum: contextEntityContract.datePrecisions,
            type: "string",
          },
          dateStart: {
            anyOf: [
              { pattern: "^\\d{4}-\\d{2}-\\d{2}$", type: "string" },
              { type: "null" },
            ],
          },
          description: nullableString(4_000),
          displayName: boundedString(160),
          geometry:
            family === "places" ? placeGeometrySchema : { type: "null" },
          parentEntityId: nullableString(200),
          status: {
            enum: ["active", "hidden", "archived"],
            type: "string",
          },
          typeKind: {
            enum: contextEntityContract.typedKinds[family.slice(0, -1)],
            type: "string",
          },
        },
        required: [
          "commandId",
          "displayName",
          "typeKind",
          ...(family === "places" ? ["geometry"] : []),
        ],
      },
      responseExample: {
        changed: true,
        commandId: `guided-${family}-create-0001`,
        decisionId: "context_decision_example",
        detail: {
          entity: { entityId: `${family.slice(0, -1)}_example`, revision: 1 },
        },
        replayed: false,
        schemaVersion: "cimmich.context-entity.v1",
        status: "applied",
        undo: { eligible: true, token: "context_decision_example" },
      },
      responseSchema: contextMutationResponse,
      undo: "/v1/context/decisions/{decisionId}/undo",
    },
    {
      authority: "read",
      domain: family,
      id: `${family}.detail`,
      methods: ["GET"],
      pathTemplate: `/v1/${family}/{entityId}`,
      purpose: `Read one visible ${family.slice(0, -1)} and its current revision.`,
    },
    {
      authority: "operate",
      commandId: true,
      domain: family,
      id: `${family}.update`,
      methods: ["PATCH"],
      pathTemplate: `/v1/${family}/{entityId}`,
      purpose: `Revision-safely update one ${family.slice(0, -1)}.`,
      request: {
        example: {
          commandId: `guided-${family}-update-0001`,
          description: "Updated through the canonical Cimmich API.",
          expectedRevision: 1,
        },
        optional: [
          "aliases",
          "dateEnd",
          "datePrecision",
          "dateStart",
          "description",
          "displayName",
          "geometry",
          "parentEntityId",
          "status",
          "typeKind",
        ],
        properties: {
          aliases: {
            items: boundedString(160),
            maxItems: 30,
            type: "array",
          },
          dateEnd: {
            anyOf: [
              { pattern: "^\\d{4}-\\d{2}-\\d{2}$", type: "string" },
              { type: "null" },
            ],
          },
          datePrecision: {
            enum: contextEntityContract.datePrecisions,
            type: "string",
          },
          dateStart: {
            anyOf: [
              { pattern: "^\\d{4}-\\d{2}-\\d{2}$", type: "string" },
              { type: "null" },
            ],
          },
          description: nullableString(4_000),
          displayName: boundedString(160),
          geometry:
            family === "places" ? placeGeometrySchema : { type: "null" },
          parentEntityId: nullableString(200),
          status: {
            enum: ["active", "hidden", "archived"],
            type: "string",
          },
          typeKind: {
            enum: contextEntityContract.typedKinds[family.slice(0, -1)],
            type: "string",
          },
        },
        required: ["commandId", "expectedRevision"],
      },
      responseExample: {
        changed: true,
        commandId: `guided-${family}-update-0001`,
        decisionId: "context_decision_example",
        detail: {
          entity: { entityId: `${family.slice(0, -1)}_example`, revision: 2 },
        },
        replayed: false,
        schemaVersion: "cimmich.context-entity.v1",
        status: "applied",
        undo: { eligible: true, token: "context_decision_example" },
      },
      responseSchema: contextMutationResponse,
      undo: "/v1/context/decisions/{decisionId}/undo",
    },
    {
      authority: "operate",
      commandId: true,
      domain: family,
      id: `${family}.assets_attach`,
      methods: ["POST"],
      pathTemplate: `/v1/${family}/{entityId}/assets:attach`,
      purpose:
        "Attach explicitly selected admitted media with a typed association.",
      request: {
        example: {
          assets: [
            {
              assetId: "asset_immich_example",
              associationKind:
                contextEntityContract.associationKinds[family.slice(0, -1)][0],
            },
          ],
          commandId: `guided-${family}-assets-0001`,
        },
        properties: {
          assets: {
            items: {
              additionalProperties: false,
              properties: {
                assetId: boundedString(200),
                associationKind: {
                  enum: contextEntityContract.associationKinds[
                    family.slice(0, -1)
                  ],
                  type: "string",
                },
              },
              required: ["assetId", "associationKind"],
              type: "object",
            },
            maxItems: 100,
            minItems: 1,
            type: "array",
          },
        },
        required: ["commandId", "assets"],
      },
      responseExample: {
        changedAssetIds: ["asset_immich_example"],
        commandId: `guided-${family}-assets-0001`,
        decisionId: "context_decision_example",
        detail: {
          entity: { entityId: `${family.slice(0, -1)}_example`, revision: 2 },
        },
        replayed: false,
        schemaVersion: "cimmich.context-entity.v1",
        status: "applied",
        undo: { eligible: true, token: "context_decision_example" },
      },
      responseSchema: contextMutationResponse,
      undo: "/v1/context/decisions/{decisionId}/undo",
    },
    {
      authority: "operate",
      commandId: true,
      domain: family,
      id: `${family}.assets_detach`,
      methods: ["POST"],
      pathTemplate: `/v1/${family}/{entityId}/assets:detach`,
      purpose:
        "Detach explicitly selected media associations through the canonical ledger.",
      request: { required: ["commandId", "assetIds"] },
      undo: "/v1/context/decisions/{decisionId}/undo",
    },
    {
      authority: "operate",
      commandId: true,
      domain: family,
      id: `${family}.relations_attach`,
      methods: ["POST"],
      pathTemplate: `/v1/${family}/{entityId}/relations:attach`,
      purpose: "Attach explicit typed relationships to another context entity.",
      request: {
        example: {
          commandId: `guided-${family}-relations-0001`,
          relations: [
            {
              direction: "outgoing",
              relationKind: "related",
              targetId: "event_example",
              targetKind: "event",
            },
          ],
        },
        properties: {
          relations: {
            items: relationItemSchema(family),
            maxItems: 100,
            minItems: 1,
            type: "array",
          },
        },
        required: ["commandId", "relations"],
      },
      responseExample: {
        changedRelationIds: ["contextrel_example"],
        commandId: `guided-${family}-relations-0001`,
        decisionId: "context_decision_example",
        detail: {
          entity: { entityId: `${family.slice(0, -1)}_example`, revision: 3 },
        },
        replayed: false,
        schemaVersion: "cimmich.context-entity.v1",
        status: "applied",
        undo: { eligible: true, token: "context_decision_example" },
      },
      responseSchema: contextMutationResponse,
      undo: "/v1/context/decisions/{decisionId}/undo",
    },
    {
      authority: "operate",
      commandId: true,
      domain: family,
      id: `${family}.relations_detach`,
      methods: ["POST"],
      pathTemplate: `/v1/${family}/{entityId}/relations:detach`,
      purpose:
        "Detach explicitly selected context relations through the canonical ledger.",
      request: { required: ["commandId", "relationIds"] },
      undo: "/v1/context/decisions/{decisionId}/undo",
    },
    {
      authority: "operate",
      commandId: true,
      domain: family,
      id: `${family}.cover`,
      methods: ["POST"],
      pathTemplate: `/v1/${family}/{entityId}/cover`,
      purpose:
        "Select an already-linked visible asset as cover, or restore fallback.",
      request: {
        required: ["commandId", "expectedRevision", "sourceAssetId"],
      },
      undo: "/v1/context/decisions/{decisionId}/undo",
    },
  ]),
  {
    authority: "read",
    domain: "visibility",
    id: "visibility.object_read",
    methods: ["GET"],
    pathTemplate: "/v1/visibility/objects/{scope}/{objectId}",
    purpose: "Read one current entity visibility tier and revision.",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "context",
    id: "context.undo",
    methods: ["POST"],
    pathTemplate: "/v1/context/decisions/{decisionId}/undo",
    purpose: "Undo exactly one context create/update/link/cover decision.",
    request: { required: ["commandId"] },
  },
  {
    authority: "operate",
    commandId: true,
    domain: "visibility",
    id: "visibility.objects_batch_set",
    methods: ["PATCH"],
    pathTemplate: "/v1/visibility/objects",
    purpose: "Atomically set bounded visibility tiers on supported objects.",
    request: {
      example: {
        commandId: "guided-visibility-batch-0001",
        objects: [
          {
            objectId: "event_example",
            objectScope: "context_entity",
            visibilityTier: "private",
          },
        ],
      },
      properties: {
        objects: {
          items: {
            additionalProperties: false,
            properties: {
              objectId: boundedString(200),
              objectScope: {
                enum: ["asset", "context_entity", "document", "person", "pet"],
                type: "string",
              },
              visibilityTier: {
                enum: ["standard", "personal", "private"],
                type: "string",
              },
            },
            required: ["objectScope", "objectId", "visibilityTier"],
            type: "object",
          },
          maxItems: 100,
          minItems: 1,
          type: "array",
        },
      },
      required: ["commandId", "objects"],
    },
    responseExample: {
      decisionId: "visibility_decision_example",
      objects: [
        {
          explicit: true,
          objectId: "event_example",
          objectScope: "context_entity",
          revision: 1,
          visibilityTier: "private",
        },
      ],
      replayed: false,
      schemaVersion: "cimmich.visibility.v1",
    },
    responseSchema: {
      additionalProperties: false,
      properties: {
        decisionId: boundedString(200),
        objects: {
          items: {
            additionalProperties: false,
            properties: {
              explicit: { type: "boolean" },
              objectId: boundedString(200),
              objectScope: {
                enum: ["asset", "context_entity", "document", "person", "pet"],
                type: "string",
              },
              revision: { minimum: 0, type: "integer" },
              visibilityTier: {
                enum: ["standard", "personal", "private"],
                type: "string",
              },
            },
            required: [
              "explicit",
              "objectId",
              "objectScope",
              "revision",
              "visibilityTier",
            ],
            type: "object",
          },
          type: "array",
        },
        replayed: { type: "boolean" },
        schemaVersion: { const: "cimmich.visibility.v1" },
      },
      required: ["decisionId", "objects", "replayed", "schemaVersion"],
      type: "object",
    },
    undo: "/v1/visibility/decisions/{decisionId}/undo",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "visibility",
    id: "visibility.object_set",
    methods: ["PATCH"],
    pathTemplate: "/v1/visibility/objects/{scope}/{objectId}",
    purpose: "Set Standard, Personal or Private on one supported entity.",
    request: {
      properties: {
        visibilityTier: {
          enum: ["standard", "personal", "private"],
          type: "string",
        },
      },
      required: ["commandId", "visibilityTier"],
    },
    undo: "/v1/visibility/decisions/{decisionId}/undo",
  },
  {
    authority: "operate",
    commandId: true,
    domain: "visibility",
    id: "visibility.undo",
    methods: ["POST"],
    pathTemplate: "/v1/visibility/decisions/{decisionId}/undo",
    purpose: "Undo exactly one visibility decision.",
    request: { required: ["commandId"] },
  },
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compiled = definitions.map((definition) => ({
  ...definition,
  matcher: new RegExp(
    `^${escapeRegex(definition.pathTemplate).replace(/\\\{[a-zA-Z][a-zA-Z0-9]*\\\}/g, "[^/?#]{1,240}")}$`,
  ),
}));

const stringField = (name) => {
  if (name === "commandId") {
    return {
      maxLength: 200,
      minLength: 1,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$",
      type: "string",
    };
  }
  if (name === "expectedRevision" || name === "intentSequence") {
    return { minimum: 0, type: "integer" };
  }
  if (["assetIds", "relationIds"].includes(name)) {
    return {
      items: { maxLength: 240, minLength: 1, type: "string" },
      maxItems: 500,
      minItems: 1,
      type: "array",
    };
  }
  if (["assets", "objects", "relations"].includes(name)) {
    return {
      items: { type: "object" },
      maxItems: 500,
      minItems: 1,
      type: "array",
    };
  }
  if (name === "region") {
    return {
      additionalProperties: false,
      properties: Object.fromEntries(
        ["h", "w", "x", "y"].map((key) => [
          key,
          {
            maximum: 1,
            ...(key === "h" || key === "w"
              ? { exclusiveMinimum: 0 }
              : { minimum: 0 }),
            type: "number",
          },
        ]),
      ),
      required: ["x", "y", "w", "h"],
      type: "object",
    };
  }
  if (name === "sourceAssetId") {
    return {
      anyOf: [
        { maxLength: 240, minLength: 1, type: "string" },
        { type: "null" },
      ],
    };
  }
  return { maxLength: 4_096, minLength: 1, type: "string" };
};

const requestSchema = (definition) => {
  if (
    !["POST", "PATCH"].some((method) => definition.methods.includes(method))
  ) {
    return null;
  }
  const request = definition.request || {};
  const alternatives = request.oneOf || [];
  const fields = [
    ...(request.required || []),
    ...(request.optional || []),
    ...alternatives.flat(),
  ];
  const base = {
    additionalProperties: false,
    properties: Object.fromEntries(
      [...new Set(fields)].map((field) => [field, stringField(field)]),
    ),
    type: "object",
  };
  if (alternatives.length > 0) {
    base.oneOf = alternatives.map((required) => ({ required }));
  } else {
    base.required = request.required || [];
  }
  if (request.tagType) {
    base.properties.tagType = { enum: request.tagType, type: "string" };
  }
  if (request.commandKind) {
    base.properties.commandKind = { enum: request.commandKind, type: "string" };
  }
  if (request.envelopeSchema) {
    base.properties.envelope = request.envelopeSchema;
  }
  if (request.subjectKind) {
    base.properties.subjectKind = {
      enum: request.subjectKind,
      type: "string",
    };
  }
  if (request.viewingMode) {
    base.properties.viewingMode = {
      enum: request.viewingMode,
      type: "string",
    };
  }
  if (request.properties) {
    Object.assign(base.properties, request.properties);
  }
  return base;
};

const querySchema = (definition) => {
  if (!definition.query) return null;
  const fields = [
    ...(definition.query.required || []),
    ...(definition.query.optional || []),
  ];
  return {
    additionalProperties: false,
    properties: Object.fromEntries(
      [...new Set(fields)].map((field) => [field, stringField(field)]),
    ),
    required: definition.query.required || [],
    type: "object",
  };
};

const genericResponseSchema = (definition) => ({
  additionalProperties: true,
  properties: {
    changed: { type: "boolean" },
    decisionId: { maxLength: 240, minLength: 1, type: ["string", "null"] },
    items: { type: "array" },
    replayed: { type: "boolean" },
    schemaVersion: { maxLength: 200, minLength: 1, type: "string" },
  },
  type: "object",
  ...(definition.commandId
    ? {
        description:
          "The canonical response is authoritative. Mutation responses expose changed/replayed and decisionId wherever the underlying canonical decision contract supports Undo.",
      }
    : {}),
});

const responseSchema = (definition) =>
  definition.responseSchema || genericResponseSchema(definition);

const uiVerificationLink = (definition) => {
  if (definition.id === "assets.smart_search") return "/cimmich/smart-search";
  if (definition.domain === "people") return "/cimmich/people";
  if (definition.domain === "places")
    return "/cimmich/places?entityId={entityId}";
  if (definition.domain === "objects")
    return "/cimmich/places?family=objects&entityId={entityId}";
  if (definition.domain === "events")
    return "/cimmich/events?entityId={entityId}";
  if (definition.domain === "assets" || definition.domain === "subjects") {
    return "/photos/{sourceAssetId}";
  }
  return "/cimmich";
};

const publicDefinition = (definition) => ({
  ...definition,
  authentication: {
    actor:
      "server-derived from the Guided credential; caller x-cimmich-actor is ignored",
    bearer: "required",
    principalAndDevice: "required for a stable visibility session",
    privateSession: "required only when reading or writing Private-tier truth",
    surface: "guided",
  },
  continuation: {
    statusOperation:
      definition.id === "immich.sync" ? "media_operator.status" : null,
    retry:
      definition.commandId === true
        ? "Retry the identical commandId and payload; the canonical ledger returns replayed=true without duplicating the decision."
        : "Repeat the visibility-safe read when needed.",
    ...(definition.continuation || {}),
  },
  errors: [
    "GUIDED_UNAUTHORIZED",
    "GUIDED_AUTHORITY_INSUFFICIENT",
    "GUIDED_VISIBILITY_CEILING_EXCEEDED",
    "not_found_or_not_visible",
    "command_payload_conflict",
    "stale_revision_or_decision",
    "dependency_conflict",
  ],
  link: definition.pathTemplate,
  replay:
    definition.replay ||
    (definition.commandId === true
      ? {
          commandIdFormat: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$",
          duplicate:
            "same commandId + same canonical payload is byte-stable replay",
          noChange:
            "a new command targeting the exact current state returns changed=false and writes no new decision",
          payloadConflict:
            "same commandId + different canonical payload fails closed",
          stale: "expected revision/decision mismatch fails before mutation",
        }
      : null),
  requestSchema: requestSchema(definition),
  requestExample: definition.request?.example || null,
  querySchema: querySchema(definition),
  responseExample: definition.responseExample || null,
  responseSchema: responseSchema(definition),
  scope: {
    authority: definition.authority,
    visibility: "current session, bounded by credential visibility ceiling",
  },
  uiVerificationLink:
    definition.uiVerificationLink || uiVerificationLink(definition),
  undoContract: definition.undo
    ? {
        dependencyLaw:
          "Undo succeeds only while the exact decision remains current and dependency-safe; stale/dependent state fails closed.",
        link: definition.undo,
        requestSchema: {
          additionalProperties: false,
          properties: { commandId: stringField("commandId") },
          required: ["commandId"],
          type: "object",
        },
      }
    : null,
});

export const guidedRouteCatalog = () => ({
  items: definitions.map(publicDefinition),
  schemaVersion: guidedRouteCatalogSchemaVersion,
});

export const matchGuidedCanonicalRoute = ({ method, pathname }) => {
  const normalizedMethod = String(method || "").toUpperCase();
  const normalizedPath = String(pathname || "");
  return (
    compiled.find(
      (definition) =>
        definition.methods.includes(normalizedMethod) &&
        definition.matcher.test(normalizedPath),
    ) || null
  );
};

export const matchGuidedCanonicalPath = (pathname) => {
  const normalizedPath = String(pathname || "");
  return (
    compiled.find((definition) => definition.matcher.test(normalizedPath)) ||
    null
  );
};
