import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { integrationSettingsPack } from "./integration-settings.mjs";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const safeRouteFamily = (requestUrl) => {
  try {
    const parts = new URL(requestUrl || "/", "http://cimmich.local").pathname
      .split("/")
      .filter(Boolean);
    return parts[0] === "v1"
      ? `v1.${String(parts[1] || "root").replace(/[^a-z0-9_-]/gi, "")}`
      : String(parts[0] || "root").replace(/[^a-z0-9_-]/gi, "");
  } catch {
    return "invalid";
  }
};

const sendJson = (response, statusCode, body, origin = "") => {
  const projectedBody = response.cimmichVisibilityProject
    ? response.cimmichVisibilityProject(body)
    : body;
  response.writeHead(statusCode, {
    ...jsonHeaders,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'",
    "x-content-type-options": "nosniff",
    ...(origin
      ? { "access-control-allow-origin": origin, vary: "Origin" }
      : {}),
  });
  response.end(`${JSON.stringify(projectedBody)}\n`);
};

const encodedFilename = (value) =>
  encodeURIComponent(String(value || "document")).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const sendBinary = (
  response,
  { bytes, disposition, filename, mimeType },
  origin = "",
) => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-disposition": `${disposition}; filename*=UTF-8''${encodedFilename(filename)}`,
    "content-length": bytes.length,
    "content-security-policy": "sandbox; default-src 'none'",
    "content-type": mimeType,
    "x-content-type-options": "nosniff",
    ...(origin
      ? { "access-control-allow-origin": origin, vary: "Origin" }
      : {}),
  });
  response.end(bytes);
};

const readJsonBody = async (request) => {
  let body = "";
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    body += chunk;
    if (bytes > 32_768) {
      throw Object.assign(new Error("Request body too large"), {
        code: "REQUEST_BODY_TOO_LARGE",
        statusCode: 413,
      });
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), {
      code: "REQUEST_JSON_INVALID",
      statusCode: 400,
    });
  }
};

const exactFaceIdentitySelector = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(
      new Error("A typed Face identity selector is required"),
      {
        code: "FACE_IDENTITY_SELECTOR_INVALID",
        statusCode: 400,
      },
    );
  }
  const allowed = new Set(["newPersonName", "personId", "personName"]);
  const keys = Object.keys(value);
  if (keys.length !== 1 || !allowed.has(keys[0])) {
    throw Object.assign(
      new Error(
        "Choose exactly one existing Person selector or one new Person name",
      ),
      {
        code: "FACE_IDENTITY_SELECTOR_INVALID",
        statusCode: 400,
      },
    );
  }
  return { [keys[0]]: value[keys[0]] };
};

const readBinaryBody = async (request, maximum = 25 * 1024 * 1024) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximum) {
      throw Object.assign(new Error("Document content is too large"), {
        code: "DOCUMENT_TOO_LARGE",
        statusCode: 413,
      });
    }
    chunks.push(chunk);
  }
  if (!bytes) {
    throw Object.assign(new Error("Document content is required"), {
      code: "DOCUMENT_CONTENT_INVALID",
      statusCode: 400,
    });
  }
  return Buffer.concat(chunks, bytes);
};

const readDocumentMetadataHeader = (request) => {
  const encoded = String(request.headers["x-cimmich-document-metadata"] || "");
  if (
    !encoded ||
    encoded.length > 12_000 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    throw Object.assign(new Error("Document metadata header is invalid"), {
      code: "DOCUMENT_METADATA_INVALID",
      statusCode: 400,
    });
  }
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const value = JSON.parse(decoded);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error("Document metadata header is invalid"), {
      code: "DOCUMENT_METADATA_INVALID",
      statusCode: 400,
    });
  }
};

export const createCimmichServer = ({
  addressGeocoder,
  allowedOrigins,
  enhancedComponent,
  faceMatchingOperator,
  guidedAccess,
  immichCompanion,
  immichInventory,
  immichOnboarding,
  mediaOperator,
  memorySteward,
  repository,
  visibility,
}) => {
  const requireProjection = (surfaceKey) =>
    visibility?.requireProjection?.(surfaceKey);

  const handleRequest = async (request, response) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    response.setHeader("x-cimmich-request-id", requestId);
    const origin = String(request.headers.origin || "");
    const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : "";
    if (origin && !allowedOrigin) {
      sendJson(response, 403, { error: "Origin is not allowed" });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers":
          "authorization,content-type,x-cimmich-actor,x-cimmich-principal-id,x-cimmich-device-id,x-cimmich-private-session,x-cimmich-surface,x-cimmich-document-metadata",
        "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
        "access-control-allow-origin": allowedOrigin,
        vary: "Origin",
      });
      response.end();
      return;
    }

    try {
      const url = new URL(request.url || "/", "http://cimmich.local");
      const guidedSurface =
        String(request.headers["x-cimmich-surface"] || "")
          .trim()
          .toLowerCase() === "guided";
      const guidedBootstrap = url.pathname === "/v1/guided/v2/bootstrap";
      if (
        (guidedSurface || guidedBootstrap) &&
        (url.searchParams.has("token") ||
          url.searchParams.has("accessToken") ||
          url.searchParams.has("authorization"))
      ) {
        throw Object.assign(
          new Error("Guided token transport is header-only"),
          {
            code: "GUIDED_TOKEN_TRANSPORT_FORBIDDEN",
            statusCode: 400,
          },
        );
      }
      if (guidedBootstrap) {
        if (!guidedAccess) {
          throw Object.assign(new Error("Guided access is unconfigured"), {
            code: "GUIDED_UNCONFIGURED",
            statusCode: 503,
          });
        }
        if (request.method !== "GET") {
          throw Object.assign(new Error("Guided method is unsupported"), {
            code: "GUIDED_METHOD_UNSUPPORTED",
            statusCode: 405,
          });
        }
        guidedAccess.authorize(request.headers.authorization);
        sendJson(
          response,
          200,
          guidedAccess.bootstrap({
            visibility: visibility?.status?.() || null,
          }),
          allowedOrigin,
        );
        return;
      }
      if (guidedSurface) {
        if (!guidedAccess) {
          throw Object.assign(new Error("Guided access is unconfigured"), {
            code: "GUIDED_UNCONFIGURED",
            statusCode: 503,
          });
        }
        request.cimmichGuidedCredential = guidedAccess.authorizeCanonical({
          authorizationHeader: request.headers.authorization,
          method: request.method,
          pathname: url.pathname,
          surface: request.headers["x-cimmich-surface"],
        });
        request.headers["x-cimmich-actor"] =
          request.cimmichGuidedCredential.actorId;
        guidedAccess.assertVisibilityGrant(request.cimmichGuidedCredential, [
          visibility?.status?.().viewingMode || "standard",
        ]);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, await repository.health(), allowedOrigin);
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/decisions") {
        requireProjection("summary");
        sendJson(
          response,
          200,
          await repository.decisionHistory({
            limit: url.searchParams.get("limit"),
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/geocoding/addresses"
      ) {
        if (!addressGeocoder) {
          throw Object.assign(new Error("Address search is unavailable"), {
            code: "ADDRESS_GEOCODING_UNAVAILABLE",
            statusCode: 503,
          });
        }
        sendJson(
          response,
          200,
          await addressGeocoder.search({
            limit: url.searchParams.get("limit"),
            query: url.searchParams.get("q"),
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        url.pathname === "/v1/guided/v1/capabilities" ||
        url.pathname === "/v1/guided/v1/instructions" ||
        url.pathname === "/v1/guided/v1/access"
      ) {
        if (!guidedAccess) {
          throw Object.assign(new Error("Guided access is unconfigured"), {
            code: "GUIDED_UNCONFIGURED",
            statusCode: 503,
          });
        }
        if (!visibility?.runForcedStandard) {
          throw Object.assign(
            new Error("Guided Standard-only visibility is unavailable"),
            {
              code: "GUIDED_VISIBILITY_UNAVAILABLE",
              statusCode: 503,
            },
          );
        }
        if (
          url.searchParams.has("token") ||
          url.searchParams.has("accessToken") ||
          url.searchParams.has("authorization")
        ) {
          throw Object.assign(
            new Error("Guided token transport is header-only"),
            {
              code: "GUIDED_TOKEN_TRANSPORT_FORBIDDEN",
              statusCode: 400,
            },
          );
        }
        await visibility.runForcedStandard("guided_v1", async () => {
          guidedAccess.authorize(request.headers.authorization);
          if (
            request.method === "GET" &&
            url.pathname === "/v1/guided/v1/capabilities"
          ) {
            sendJson(response, 200, guidedAccess.capabilities(), allowedOrigin);
            return;
          }
          if (
            request.method === "GET" &&
            url.pathname === "/v1/guided/v1/instructions"
          ) {
            sendJson(response, 200, guidedAccess.instructions(), allowedOrigin);
            return;
          }
          if (
            request.method === "POST" &&
            url.pathname === "/v1/guided/v1/access"
          ) {
            const body = await readJsonBody(request);
            if (
              Object.hasOwn(body, "token") ||
              Object.hasOwn(body, "accessToken") ||
              Object.hasOwn(body, "authorization")
            ) {
              throw Object.assign(
                new Error("Guided token transport is header-only"),
                {
                  code: "GUIDED_TOKEN_TRANSPORT_FORBIDDEN",
                  statusCode: 400,
                },
              );
            }
            const bodyKeys = Object.keys(body);
            if (
              bodyKeys.some((key) => !["action", "input"].includes(key)) ||
              !Object.hasOwn(body, "action")
            ) {
              throw Object.assign(new Error("Guided access body is invalid"), {
                code: "GUIDED_INPUT_INVALID",
                statusCode: 400,
              });
            }
            sendJson(
              response,
              200,
              await guidedAccess.access(
                {
                  action: body.action,
                  ...(Object.hasOwn(body, "input")
                    ? { input: body.input }
                    : {}),
                },
                { requireProjection },
              ),
              allowedOrigin,
            );
            return;
          }
          throw Object.assign(new Error("Guided method is unsupported"), {
            code: "GUIDED_METHOD_UNSUPPORTED",
            statusCode: 405,
          });
        });
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/integrations/status"
      ) {
        requireProjection("summary");
        sendJson(
          response,
          200,
          {
            bodyDetection: await repository.integrationStatus(),
            enhanced: enhancedComponent
              ? await enhancedComponent.status()
              : null,
            faceMatching: await repository.faceMatchingStatus(),
            guided: guidedAccess?.setup?.() || {
              configured: false,
              enabled: false,
              schemaVersion: "cimmich.guided-setup.v1",
            },
            schemaVersion: "cimmich.integrations-status.v1",
          },
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/operator/enhanced"
      ) {
        if (!enhancedComponent) {
          throw Object.assign(new Error("Enhanced is unavailable"), {
            code: "ENHANCED_UNAVAILABLE",
            statusCode: 503,
          });
        }
        requireProjection("summary");
        sendJson(
          response,
          200,
          await enhancedComponent.status(),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/operator/enhanced"
      ) {
        if (!enhancedComponent) {
          throw Object.assign(new Error("Enhanced is unavailable"), {
            code: "ENHANCED_UNAVAILABLE",
            statusCode: 503,
          });
        }
        requireProjection("summary");
        const body = await readJsonBody(request);
        const allowed = new Set([
          "action",
          "commandId",
          "expectedRevision",
          "targetVersion",
        ]);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => !allowed.has(key))
        ) {
          throw Object.assign(new Error("Enhanced request is invalid"), {
            code: "ENHANCED_INPUT_INVALID",
            statusCode: 400,
          });
        }
        sendJson(
          response,
          200,
          await enhancedComponent.execute({
            action: body.action,
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            expectedRevision: body.expectedRevision,
            targetVersion: body.targetVersion,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/integrations/provider-settings-pack"
      ) {
        sendJson(response, 200, integrationSettingsPack(), allowedOrigin);
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/visibility/status"
      ) {
        sendJson(response, 200, visibility.status(), allowedOrigin);
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/visibility/projections"
      ) {
        if (!visibility?.projectionStatus) {
          throw Object.assign(
            new Error("Cimmich visibility projection registry is unavailable"),
            {
              code: "VISIBILITY_PROJECTION_UNREGISTERED",
              statusCode: 503,
            },
          );
        }
        sendJson(response, 200, visibility.projectionStatus(), allowedOrigin);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/visibility/mode") {
        const body = await readJsonBody(request);
        if (request.cimmichGuidedCredential) {
          guidedAccess.assertVisibilityGrant(request.cimmichGuidedCredential, [
            body.viewingMode,
          ]);
        }
        sendJson(
          response,
          200,
          await visibility.setMode({
            actorId: request.headers["x-cimmich-actor"],
            intentSequence: body.intentSequence,
            viewingMode: body.viewingMode,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/visibility/unlock"
      ) {
        const body = await readJsonBody(request);
        if (request.cimmichGuidedCredential) {
          guidedAccess.assertVisibilityGrant(request.cimmichGuidedCredential, [
            "private",
          ]);
        }
        sendJson(
          response,
          200,
          await visibility.unlock({
            actorId: request.headers["x-cimmich-actor"],
            password: body.password,
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/visibility/lock") {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await visibility.lock({
            actorId: request.headers["x-cimmich-actor"],
            reason: body.reason,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "PATCH" &&
        url.pathname === "/v1/visibility/objects"
      ) {
        const body = await readJsonBody(request);
        if (request.cimmichGuidedCredential) {
          guidedAccess.assertVisibilityGrant(
            request.cimmichGuidedCredential,
            Array.isArray(body.objects)
              ? body.objects.map((item) => item?.visibilityTier)
              : [],
          );
        }
        sendJson(
          response,
          200,
          await visibility.setObjects({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            objects: body.objects,
          }),
          allowedOrigin,
        );
        return;
      }
      const visibilityObjectMatch = url.pathname.match(
        /^\/v1\/visibility\/objects\/([^/]+)\/([^/]+)$/,
      );
      if (request.method === "GET" && visibilityObjectMatch) {
        sendJson(
          response,
          200,
          await visibility.getObject({
            objectId: decodeURIComponent(visibilityObjectMatch[2]),
            objectScope: decodeURIComponent(visibilityObjectMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "PATCH" && visibilityObjectMatch) {
        const body = await readJsonBody(request);
        if (request.cimmichGuidedCredential) {
          guidedAccess.assertVisibilityGrant(request.cimmichGuidedCredential, [
            body.visibilityTier,
          ]);
        }
        sendJson(
          response,
          200,
          await visibility.setObjects({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            objects: [
              {
                objectId: decodeURIComponent(visibilityObjectMatch[2]),
                objectScope: decodeURIComponent(visibilityObjectMatch[1]),
                visibilityTier: body.visibilityTier,
              },
            ],
          }),
          allowedOrigin,
        );
        return;
      }
      const visibilityUndoMatch = url.pathname.match(
        /^\/v1\/visibility\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && visibilityUndoMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await visibility.undo({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(visibilityUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/onboarding/immich"
      ) {
        if (!immichOnboarding) {
          throw Object.assign(new Error("Immich onboarding is unavailable"), {
            code: "IMMICH_ONBOARDING_UNAVAILABLE",
            statusCode: 503,
          });
        }
        requireProjection("immich_onboarding");
        sendJson(response, 200, await immichOnboarding.status(), allowedOrigin);
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/onboarding/immich/connect"
      ) {
        if (!immichOnboarding) {
          throw Object.assign(new Error("Immich onboarding is unavailable"), {
            code: "IMMICH_ONBOARDING_UNAVAILABLE",
            statusCode: 503,
          });
        }
        const body = await readJsonBody(request);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).sort().join(",") !==
            "apiBaseUrl,commandId,credential"
        ) {
          throw Object.assign(new Error("Immich connection input is invalid"), {
            code: "IMMICH_ONBOARDING_INPUT_INVALID",
            statusCode: 400,
          });
        }
        sendJson(
          response,
          200,
          await immichOnboarding.connect({
            actorId: request.headers["x-cimmich-actor"],
            apiBaseUrl: body.apiBaseUrl,
            apiKey: body.credential,
            commandId: body.commandId,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/onboarding/immich/preview"
      ) {
        if (!immichOnboarding) {
          throw Object.assign(new Error("Immich onboarding is unavailable"), {
            code: "IMMICH_ONBOARDING_UNAVAILABLE",
            statusCode: 503,
          });
        }
        requireProjection("immich_onboarding");
        const body = await readJsonBody(request);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => key !== "scope")
        ) {
          throw Object.assign(new Error("Immich preview input is invalid"), {
            code: "IMMICH_ONBOARDING_INPUT_INVALID",
            statusCode: 400,
          });
        }
        sendJson(
          response,
          200,
          await immichOnboarding.preview({
            scope: body.scope,
            viewingMode: visibility?.status?.().viewingMode || "Standard",
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/onboarding/immich/person-clusters:preview"
      ) {
        if (!immichOnboarding?.personClusters) {
          throw Object.assign(
            new Error("Immich Person resolution is unavailable"),
            {
              code: "IMMICH_PERSON_RESOLUTION_UNAVAILABLE",
              statusCode: 503,
            },
          );
        }
        requireProjection("immich_onboarding");
        const body = await readJsonBody(request);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => key !== "scope")
        ) {
          throw Object.assign(
            new Error("Immich Person cluster preview input is invalid"),
            {
              code: "IMMICH_PERSON_RESOLUTION_INPUT_INVALID",
              statusCode: 400,
            },
          );
        }
        sendJson(
          response,
          200,
          await immichOnboarding.personClusters({
            scope: body.scope,
            viewingMode: visibility?.status?.().viewingMode || "Standard",
          }),
          allowedOrigin,
        );
        return;
      }
      const immichPersonResolveMatch = url.pathname.match(
        /^\/v1\/onboarding\/immich\/person-clusters\/([^/]+)\/resolve$/,
      );
      if (request.method === "POST" && immichPersonResolveMatch) {
        if (!immichOnboarding?.resolvePersonCluster) {
          throw Object.assign(
            new Error("Immich Person resolution is unavailable"),
            {
              code: "IMMICH_PERSON_RESOLUTION_UNAVAILABLE",
              statusCode: 503,
            },
          );
        }
        requireProjection("immich_onboarding");
        const body = await readJsonBody(request);
        const keys = Object.keys(body || {}).sort();
        const allowed = new Set([
          "action",
          "commandId",
          "expectedSourceRevision",
          "newPersonName",
          "personId",
          "scope",
          "snapshotDigest",
        ]);
        const required = [
          "action",
          "commandId",
          "expectedSourceRevision",
          "scope",
          "snapshotDigest",
        ];
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          keys.some((key) => !allowed.has(key)) ||
          required.some((key) => !keys.includes(key))
        ) {
          throw Object.assign(
            new Error("Immich Person resolution input is invalid"),
            {
              code: "IMMICH_PERSON_RESOLUTION_INPUT_INVALID",
              statusCode: 400,
            },
          );
        }
        sendJson(
          response,
          200,
          await immichOnboarding.resolvePersonCluster({
            ...body,
            actorId: request.headers["x-cimmich-actor"],
            immichPersonId: decodeURIComponent(immichPersonResolveMatch[1]),
            viewingMode: visibility?.status?.().viewingMode || "Standard",
          }),
          allowedOrigin,
        );
        return;
      }
      const immichPersonResolutionUndoMatch = url.pathname.match(
        /^\/v1\/onboarding\/immich\/person-clusters\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && immichPersonResolutionUndoMatch) {
        if (!immichOnboarding?.undoPersonClusterResolution) {
          throw Object.assign(
            new Error("Immich Person resolution Undo is unavailable"),
            {
              code: "IMMICH_PERSON_RESOLUTION_UNAVAILABLE",
              statusCode: 503,
            },
          );
        }
        requireProjection("immich_onboarding");
        const body = await readJsonBody(request);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).sort().join(",") !== "commandId,scope"
        ) {
          throw Object.assign(
            new Error("Immich Person resolution Undo input is invalid"),
            {
              code: "IMMICH_PERSON_RESOLUTION_INPUT_INVALID",
              statusCode: 400,
            },
          );
        }
        sendJson(
          response,
          200,
          await immichOnboarding.undoPersonClusterResolution({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(immichPersonResolutionUndoMatch[1]),
            scope: body.scope,
            viewingMode: visibility?.status?.().viewingMode || "Standard",
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/onboarding/immich/import"
      ) {
        if (!immichOnboarding) {
          throw Object.assign(new Error("Immich onboarding is unavailable"), {
            code: "IMMICH_ONBOARDING_UNAVAILABLE",
            statusCode: 503,
          });
        }
        requireProjection("immich_onboarding");
        const body = await readJsonBody(request);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).sort().join(",") !== "commandId,previewDigest,scope"
        ) {
          throw Object.assign(new Error("Immich import input is invalid"), {
            code: "IMMICH_ONBOARDING_INPUT_INVALID",
            statusCode: 400,
          });
        }
        sendJson(
          response,
          200,
          await immichOnboarding.importCurrent({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            previewDigest: body.previewDigest,
            scope: body.scope,
            viewingMode: visibility?.status?.().viewingMode || "Standard",
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/companion/status") {
        if (!immichCompanion) {
          throw Object.assign(new Error("Immich companion is not configured"), {
            code: "IMMICH_COMPANION_NOT_CONFIGURED",
            statusCode: 503,
          });
        }
        sendJson(response, 200, await immichCompanion.status(), allowedOrigin);
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/map/visible-assets"
      ) {
        requireProjection("map_assets");
        const body = await readJsonBody(request);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).sort().join(",") !== "sourceAssetIds"
        ) {
          throw Object.assign(new Error("Map visibility input is invalid"), {
            code: "MAP_ASSET_IDS_INVALID",
            statusCode: 400,
          });
        }
        sendJson(
          response,
          200,
          await repository.filterVisibleMapAssetSourceIds({
            sourceAssetIds: body.sourceAssetIds,
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/companion/assets") {
        if (!immichCompanion) {
          throw Object.assign(new Error("Immich companion is not configured"), {
            code: "IMMICH_COMPANION_NOT_CONFIGURED",
            statusCode: 503,
          });
        }
        sendJson(
          response,
          200,
          await immichCompanion.listAssets({
            cursor: url.searchParams.get("cursor") || "",
            limit: url.searchParams.get("limit") || 100,
            updatedAfter: url.searchParams.get("updatedAfter") || "",
            visibility: url.searchParams.get("visibility") || "",
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/companion/inventory"
      ) {
        if (!immichInventory) {
          throw Object.assign(new Error("Immich inventory is unavailable"), {
            code: "IMMICH_INVENTORY_UNAVAILABLE",
            statusCode: 503,
          });
        }
        sendJson(response, 200, await immichInventory.status(), allowedOrigin);
        return;
      }
      const companionAssetMatch = url.pathname.match(
        /^\/v1\/companion\/assets\/([^/]+)$/,
      );
      if (request.method === "GET" && companionAssetMatch) {
        if (!immichCompanion) {
          throw Object.assign(new Error("Immich companion is not configured"), {
            code: "IMMICH_COMPANION_NOT_CONFIGURED",
            statusCode: 503,
          });
        }
        sendJson(
          response,
          200,
          await immichCompanion.getAsset({
            assetId: decodeURIComponent(companionAssetMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/summary") {
        requireProjection("summary");
        sendJson(response, 200, await repository.summary(), allowedOrigin);
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/media-jobs") {
        sendJson(
          response,
          200,
          await repository.mediaJobStatus(),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/operator/media-pipeline"
      ) {
        if (!mediaOperator) {
          throw Object.assign(new Error("Media operator is unavailable"), {
            code: "MEDIA_OPERATOR_UNAVAILABLE",
            statusCode: 503,
          });
        }
        sendJson(response, 200, await mediaOperator.status(), allowedOrigin);
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/operator/media-pipeline"
      ) {
        if (!mediaOperator) {
          throw Object.assign(new Error("Media operator is unavailable"), {
            code: "MEDIA_OPERATOR_UNAVAILABLE",
            statusCode: 503,
          });
        }
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await mediaOperator.execute({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            commandKind: body.commandKind,
            envelope: body.envelope,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/operator/face-matching"
      ) {
        if (!faceMatchingOperator) {
          throw Object.assign(
            new Error("Face matching operator is unavailable"),
            {
              code: "FACE_MATCHING_OPERATOR_UNAVAILABLE",
              statusCode: 503,
            },
          );
        }
        sendJson(
          response,
          200,
          await faceMatchingOperator.status(),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/operator/face-matching/recognition"
      ) {
        if (!faceMatchingOperator) {
          throw Object.assign(
            new Error("Face matching operator is unavailable"),
            {
              code: "FACE_MATCHING_OPERATOR_UNAVAILABLE",
              statusCode: 503,
            },
          );
        }
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await faceMatchingOperator.runRecognition({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            workLimit: body.workLimit,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/operator/face-matching/source-packs"
      ) {
        if (!faceMatchingOperator) {
          throw Object.assign(
            new Error("Face matching operator is unavailable"),
            {
              code: "FACE_MATCHING_OPERATOR_UNAVAILABLE",
              statusCode: 503,
            },
          );
        }
        sendJson(
          response,
          200,
          await faceMatchingOperator.compile(),
          allowedOrigin,
        );
        return;
      }
      const faceMatchingPackMatch = url.pathname.match(
        /^\/v1\/operator\/face-matching\/source-packs\/([^/]+)\/?$/,
      );
      if (request.method === "GET" && faceMatchingPackMatch) {
        if (!faceMatchingOperator) {
          throw Object.assign(
            new Error("Face matching operator is unavailable"),
            {
              code: "FACE_MATCHING_OPERATOR_UNAVAILABLE",
              statusCode: 503,
            },
          );
        }
        sendJson(
          response,
          200,
          await faceMatchingOperator.readPack({
            packId: decodeURIComponent(faceMatchingPackMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const faceMatchingPackActionMatch = url.pathname.match(
        /^\/v1\/operator\/face-matching\/source-packs\/([^/]+)\/(evaluate|review|activate|rollback)$/,
      );
      if (request.method === "POST" && faceMatchingPackActionMatch) {
        if (!faceMatchingOperator) {
          throw Object.assign(
            new Error("Face matching operator is unavailable"),
            {
              code: "FACE_MATCHING_OPERATOR_UNAVAILABLE",
              statusCode: 503,
            },
          );
        }
        const body = await readJsonBody(request);
        const packId = decodeURIComponent(faceMatchingPackActionMatch[1]);
        const action = faceMatchingPackActionMatch[2];
        const result =
          action === "evaluate"
            ? await faceMatchingOperator.evaluate({ packId })
            : action === "review"
              ? await faceMatchingOperator.recordReview({
                  gateReceipt: body.gateReceipt,
                  packId,
                })
              : action === "activate"
                ? await faceMatchingOperator.activate({
                    expectedCurrentPackId: body.expectedCurrentPackId,
                    expectedEvaluationId: body.expectedEvaluationId,
                    packId,
                  })
                : await faceMatchingOperator.rollback({
                    expectedPredecessorPackId: body.expectedPredecessorPackId,
                    packId,
                  });
        sendJson(response, 200, result, allowedOrigin);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/media-jobs") {
        const body = await readJsonBody(request);
        sendJson(
          response,
          202,
          await repository.mediaJobEnqueue({
            assetId: body.assetId,
            configDigest: body.configDigest,
            inputRevision: body.inputRevision,
            maxAttempts: body.maxAttempts,
            operation: body.operation,
            toolVersion: body.toolVersion,
          }),
          allowedOrigin,
        );
        return;
      }
      const mediaJobMatch = url.pathname.match(/^\/v1\/media-jobs\/([^/]+)$/);
      if (request.method === "GET" && mediaJobMatch) {
        const job = await repository.mediaJob({
          jobId: decodeURIComponent(mediaJobMatch[1]),
        });
        if (!job) {
          throw Object.assign(new Error("Media job not found"), {
            code: "MEDIA_JOB_NOT_FOUND",
            statusCode: 404,
          });
        }
        sendJson(response, 200, job, allowedOrigin);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/steward/plan") {
        if (!memorySteward) {
          throw Object.assign(new Error("Memory Steward is not configured"), {
            statusCode: 503,
          });
        }
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await memorySteward.plan({ goal: body.goal }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/capture-contexts"
      ) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.createCaptureContext({
            actorId: request.headers["x-cimmich-actor"],
            assetIds: body.assetIds,
            contextKind: body.contextKind,
            label: body.label,
          }),
          allowedOrigin,
        );
        return;
      }
      const contextPresenceMatch = url.pathname.match(
        /^\/v1\/capture-contexts\/([^/]+)\/presence-candidates$/,
      );
      if (request.method === "GET" && contextPresenceMatch) {
        sendJson(
          response,
          200,
          {
            items: await repository.captureContextPresenceCandidates({
              contextId: decodeURIComponent(contextPresenceMatch[1]),
            }),
          },
          allowedOrigin,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/people") {
        requireProjection("people");
        sendJson(
          response,
          200,
          {
            items: await repository.people({
              limit: url.searchParams.get("limit"),
              query: url.searchParams.get("q"),
            }),
          },
          allowedOrigin,
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/people") {
        requireProjection("people");
        const body = await readJsonBody(request);
        sendJson(
          response,
          201,
          await repository.createPerson({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            ...(Object.hasOwn(body, "immichPersonId")
              ? { immichPersonId: body.immichPersonId }
              : {}),
            ...(Object.hasOwn(body, "newPersonName")
              ? { newPersonName: body.newPersonName }
              : {}),
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/people/profile-display-defaults"
      ) {
        sendJson(
          response,
          200,
          await repository.getPersonProfileDisplayDefaults(),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/people/profile-details-display-defaults"
      ) {
        sendJson(
          response,
          200,
          await repository.getPersonDetailsDisplayDefaults(),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "PATCH" &&
        url.pathname === "/v1/people/profile-details-display-defaults"
      ) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.patchPersonDetailsDisplayDefaults({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            sections: body.sections,
          }),
          allowedOrigin,
        );
        return;
      }
      const personDetailsDisplayMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/profile-details-display$/,
      );
      if (request.method === "GET" && personDetailsDisplayMatch) {
        sendJson(
          response,
          200,
          await repository.getPersonDetailsDisplay({
            personId: decodeURIComponent(personDetailsDisplayMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "PATCH" && personDetailsDisplayMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.patchPersonDetailsDisplay({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            overrides: body.overrides,
            personId: decodeURIComponent(personDetailsDisplayMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "PATCH" &&
        url.pathname === "/v1/people/profile-display-defaults"
      ) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.patchPersonProfileDisplayDefaults({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            fields: body.fields,
          }),
          allowedOrigin,
        );
        return;
      }
      const personProfileDisplayMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/profile-display$/,
      );
      if (request.method === "GET" && personProfileDisplayMatch) {
        sendJson(
          response,
          200,
          await repository.getPersonProfileDisplay({
            personId: decodeURIComponent(personProfileDisplayMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "PATCH" && personProfileDisplayMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.patchPersonProfileDisplay({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            overrides: body.overrides,
            personId: decodeURIComponent(personProfileDisplayMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const personProfileMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/profile$/,
      );
      if (request.method === "GET" && personProfileMatch) {
        sendJson(
          response,
          200,
          await repository.getPersonProfile({
            personId: decodeURIComponent(personProfileMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "PATCH" && personProfileMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.patchPersonProfile({
            about: body.about,
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            genderIdentityKind: body.genderIdentityKind,
            genderIdentityLabel: body.genderIdentityLabel,
            itemCommands: body.itemCommands,
            personId: decodeURIComponent(personProfileMatch[1]),
            privateNotes: body.privateNotes,
            pronounsLabel: body.pronounsLabel,
            relationshipCategoryIds: body.relationshipCategoryIds,
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/pets") {
        requireProjection("pets");
        sendJson(
          response,
          200,
          {
            items: await repository.pets({
              includeHidden: url.searchParams.get("includeHidden") === "true",
              limit: url.searchParams.get("limit"),
              query: url.searchParams.get("q"),
            }),
            schemaVersion: "cimmich.pet-manual.v2",
          },
          allowedOrigin,
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/pets") {
        const body = await readJsonBody(request);
        sendJson(
          response,
          201,
          await repository.createPet({
            actorId: request.headers["x-cimmich-actor"],
            aliases: body.aliases,
            breedLabel: body.breedLabel,
            commandId: body.commandId,
            coverAssetId: body.coverAssetId,
            coverCrop: body.coverCrop,
            description: body.description,
            displayName: body.displayName,
            speciesKind: body.speciesKind,
            speciesLabel: body.speciesLabel,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/pets/merge-preview"
      ) {
        sendJson(
          response,
          200,
          await repository.previewPetMerge({
            sourcePetId: url.searchParams.get("sourcePetId"),
            targetPetId: url.searchParams.get("targetPetId"),
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/pets/merge") {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.mergePets({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            sourcePetId: body.sourcePetId,
            targetPetId: body.targetPetId,
          }),
          allowedOrigin,
        );
        return;
      }
      const petUnmergeMatch = url.pathname.match(
        /^\/v1\/pets\/merges\/([^/]+)\/unmerge$/,
      );
      if (request.method === "POST" && petUnmergeMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.unmergePets({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            mergeOperationId: decodeURIComponent(petUnmergeMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const petMediaCommandMatch = url.pathname.match(
        /^\/v1\/pets\/([^/]+)\/media:(attach|detach)$/,
      );
      if (request.method === "POST" && petMediaCommandMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.modifyPetMedia({
            actorId: request.headers["x-cimmich-actor"],
            assetIds: body.assetIds,
            commandId: body.commandId,
            petId: decodeURIComponent(petMediaCommandMatch[1]),
            selected: petMediaCommandMatch[2] === "attach",
          }),
          allowedOrigin,
        );
        return;
      }
      const petDocumentCommandMatch = url.pathname.match(
        /^\/v1\/pets\/([^/]+)\/documents:(attach|detach)$/,
      );
      if (request.method === "POST" && petDocumentCommandMatch) {
        const body = await readJsonBody(request);
        const input = {
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          petId: decodeURIComponent(petDocumentCommandMatch[1]),
        };
        sendJson(
          response,
          200,
          petDocumentCommandMatch[2] === "attach"
            ? await repository.attachPetDocuments({
                ...input,
                documents: body.documents,
              })
            : await repository.detachPetDocuments({
                ...input,
                assetIds: body.assetIds,
              }),
          allowedOrigin,
        );
        return;
      }
      const petDocumentReadMatch = url.pathname.match(
        /^\/v1\/pets\/([^/]+)\/documents$/,
      );
      if (request.method === "GET" && petDocumentReadMatch) {
        requireProjection("pet_media");
        sendJson(
          response,
          200,
          await repository.petDocuments({
            petId: decodeURIComponent(petDocumentReadMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const petDocumentUndoMatch = url.pathname.match(
        /^\/v1\/pet-documents\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && petDocumentUndoMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undoPetDocumentDecision({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(petDocumentUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const petMediaReadMatch = url.pathname.match(
        /^\/v1\/pets\/([^/]+)\/media$/,
      );
      if (request.method === "GET" && petMediaReadMatch) {
        requireProjection("pet_media");
        sendJson(
          response,
          200,
          {
            items: await repository.petMedia({
              limit: url.searchParams.get("limit"),
              petId: decodeURIComponent(petMediaReadMatch[1]),
            }),
            schemaVersion: "cimmich.pet-manual.v2",
          },
          allowedOrigin,
        );
        return;
      }
      const petReadMatch = url.pathname.match(/^\/v1\/pets\/([^/]+)$/);
      if (request.method === "GET" && petReadMatch) {
        requireProjection("pets");
        sendJson(
          response,
          200,
          await repository.pet({
            petId: decodeURIComponent(petReadMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "PATCH" && petReadMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.updatePet({
            actorId: request.headers["x-cimmich-actor"],
            aliases: body.aliases,
            breedLabel: body.breedLabel,
            commandId: body.commandId,
            coverAssetId: body.coverAssetId,
            coverCrop: body.coverCrop,
            description: body.description,
            displayName: body.displayName,
            petId: decodeURIComponent(petReadMatch[1]),
            speciesKind: body.speciesKind,
            speciesLabel: body.speciesLabel,
            status: body.status,
          }),
          allowedOrigin,
        );
        return;
      }
      const decisionUndoMatch = url.pathname.match(
        /^\/v1\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && decisionUndoMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undoPetDecision({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(decisionUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const manualPresenceMatch = url.pathname.match(
        /^\/v1\/assets\/([^/]+)\/manual-presences$/,
      );
      if (request.method === "GET" && manualPresenceMatch) {
        requireProjection("asset_detail");
        const assetId = decodeURIComponent(manualPresenceMatch[1]);
        if (visibility) await visibility.requireVisibleAsset(assetId);
        sendJson(
          response,
          200,
          await repository.manualSubjectPresences({ assetId }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "POST" && manualPresenceMatch) {
        requireProjection("asset_detail");
        const body = await readJsonBody(request);
        const assetId = decodeURIComponent(manualPresenceMatch[1]);
        if (visibility) await visibility.requireVisibleAsset(assetId);
        sendJson(
          response,
          200,
          await repository.modifyManualSubjectPresence({
            action: body.action,
            actorId: request.headers["x-cimmich-actor"],
            assetId,
            commandId: body.commandId,
            geometry: body.geometry,
            subjectId: body.subjectId,
            subjectKind: body.subjectKind,
          }),
          allowedOrigin,
        );
        return;
      }
      const manualPresenceUndoMatch = url.pathname.match(
        /^\/v1\/manual-presences\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && manualPresenceUndoMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undoManualSubjectPresence({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(manualPresenceUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const manualSubjectTagMatch = url.pathname.match(
        /^\/v1\/assets\/([^/]+)\/manual-subject-tags$/,
      );
      if (request.method === "GET" && manualSubjectTagMatch) {
        requireProjection("manual_subject_tags");
        const assetId = decodeURIComponent(manualSubjectTagMatch[1]);
        if (visibility) await visibility.requireVisibleAsset(assetId);
        sendJson(
          response,
          200,
          await repository.manualSubjectTags({ assetId }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "POST" && manualSubjectTagMatch) {
        requireProjection("manual_subject_tags");
        const body = await readJsonBody(request);
        const assetId = decodeURIComponent(manualSubjectTagMatch[1]);
        if (visibility) await visibility.requireVisibleAsset(assetId);
        sendJson(
          response,
          200,
          await repository.attachManualSubjectTag({
            ...body,
            actorId: request.headers["x-cimmich-actor"],
            assetId,
          }),
          allowedOrigin,
        );
        return;
      }
      const manualSubjectTagReplaceMatch = url.pathname.match(
        /^\/v1\/manual-subject-tags\/([^/]+)\/replace$/,
      );
      if (request.method === "POST" && manualSubjectTagReplaceMatch) {
        requireProjection("manual_subject_tags");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.replaceManualSubjectTag({
            ...body,
            actorId: request.headers["x-cimmich-actor"],
            tagId: decodeURIComponent(manualSubjectTagReplaceMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const manualSubjectTagUndoMatch = url.pathname.match(
        /^\/v1\/manual-subject-tags\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && manualSubjectTagUndoMatch) {
        requireProjection("manual_subject_tags");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undoManualSubjectTag({
            ...body,
            actorId: request.headers["x-cimmich-actor"],
            decisionId: decodeURIComponent(manualSubjectTagUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const assetSubjectsMatch = url.pathname.match(
        /^\/v1\/assets\/([^/]+)\/subjects$/,
      );
      if (request.method === "GET" && assetSubjectsMatch) {
        requireProjection("asset_detail");
        if (visibility) {
          await visibility.requireVisibleAsset(
            decodeURIComponent(assetSubjectsMatch[1]),
          );
        }
        sendJson(
          response,
          200,
          {
            items: await repository.assetSubjects({
              assetId: decodeURIComponent(assetSubjectsMatch[1]),
            }),
            schemaVersion: "cimmich.subject-projection.v1",
          },
          allowedOrigin,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/search/media") {
        requireProjection("basic_search");
        sendJson(
          response,
          200,
          {
            filters: { petId: url.searchParams.get("petId") },
            items: await repository.petMedia({
              limit: url.searchParams.get("limit"),
              petId: url.searchParams.get("petId"),
            }),
            schemaVersion: "cimmich.basic-search.v1",
          },
          allowedOrigin,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/search/smart") {
        requireProjection("smart_search");
        sendJson(
          response,
          200,
          await repository.smartSearch({
            limit: url.searchParams.get("limit"),
            query: url.searchParams.get("q"),
          }),
          allowedOrigin,
        );
        return;
      }
      if (url.pathname === "/v1/documents") {
        requireProjection("documents");
        if (request.method === "GET") {
          sendJson(
            response,
            200,
            await repository.documents({
              documentKind: url.searchParams.get("documentKind"),
              includeArchived:
                url.searchParams.get("includeArchived") === "true",
              limit: url.searchParams.get("limit"),
              query: url.searchParams.get("q"),
              subjectId: url.searchParams.get("subjectId"),
              subjectKind: url.searchParams.get("subjectKind"),
            }),
            allowedOrigin,
          );
          return;
        }
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/documents/legacy-pet-links"
      ) {
        requireProjection("documents");
        sendJson(
          response,
          200,
          await repository.legacyPetDocumentCandidates({
            includeAdopted: url.searchParams.get("includeAdopted") === "true",
            petId: url.searchParams.get("petId"),
          }),
          allowedOrigin,
        );
        return;
      }
      const legacyPetDocumentAdoptMatch = url.pathname.match(
        /^\/v1\/documents\/legacy-pet-links\/([^/]+):adopt$/,
      );
      if (request.method === "POST" && legacyPetDocumentAdoptMatch) {
        requireProjection("documents");
        const body = await readJsonBody(request);
        sendJson(
          response,
          201,
          await repository.adoptLegacyPetDocument({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            displayTitle: body.displayTitle,
            legacyAssociationId: decodeURIComponent(
              legacyPetDocumentAdoptMatch[1],
            ),
            sourceFilename: body.sourceFilename,
            visibilityTier: body.visibilityTier,
          }),
          allowedOrigin,
        );
        return;
      }
      const legacyPetDocumentUndoMatch = url.pathname.match(
        /^\/v1\/document-legacy-pet-decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && legacyPetDocumentUndoMatch) {
        requireProjection("documents");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undoLegacyPetDocumentAdoption({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(legacyPetDocumentUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/documents/reference"
      ) {
        requireProjection("documents");
        const body = await readJsonBody(request);
        sendJson(
          response,
          201,
          await repository.referenceDocument({
            actorId: request.headers["x-cimmich-actor"],
            assetId: body.assetId,
            commandId: body.commandId,
            displayTitle: body.displayTitle,
            documentKind: body.documentKind,
            documentLabel: body.documentLabel,
            expiresOn: body.expiresOn,
            issuedOn: body.issuedOn,
            sourceFilename: body.sourceFilename,
            supersedesDocumentId: body.supersedesDocumentId,
            visibilityTier: body.visibilityTier,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/documents/import"
      ) {
        requireProjection("documents");
        const metadata = readDocumentMetadataHeader(request);
        const bytes = await readBinaryBody(request);
        sendJson(
          response,
          201,
          await repository.importDocument({
            actorId: request.headers["x-cimmich-actor"],
            bytes,
            commandId: metadata.commandId,
            displayTitle: metadata.displayTitle,
            documentKind: metadata.documentKind,
            documentLabel: metadata.documentLabel,
            expiresOn: metadata.expiresOn,
            issuedOn: metadata.issuedOn,
            mimeType: request.headers["content-type"],
            sourceFilename: metadata.sourceFilename,
            supersedesDocumentId: metadata.supersedesDocumentId,
            visibilityTier: metadata.visibilityTier,
          }),
          allowedOrigin,
        );
        return;
      }
      const documentContentMatch = url.pathname.match(
        /^\/v1\/documents\/([^/]+)\/content$/,
      );
      if (request.method === "GET" && documentContentMatch) {
        requireProjection("documents");
        const content = await repository.documentContent({
          documentId: decodeURIComponent(documentContentMatch[1]),
        });
        sendBinary(
          response,
          {
            ...content,
            disposition:
              url.searchParams.get("download") === "true"
                ? "attachment"
                : content.previewDisposition,
          },
          allowedOrigin,
        );
        return;
      }
      const documentLinkMatch = url.pathname.match(
        /^\/v1\/documents\/([^/]+)\/links:(attach|detach)$/,
      );
      if (request.method === "POST" && documentLinkMatch) {
        requireProjection("documents");
        const body = await readJsonBody(request);
        const input = {
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          documentId: decodeURIComponent(documentLinkMatch[1]),
          links: body.links,
        };
        sendJson(
          response,
          200,
          documentLinkMatch[2] === "attach"
            ? await repository.attachDocumentLinks(input)
            : await repository.detachDocumentLinks(input),
          allowedOrigin,
        );
        return;
      }
      const documentUndoMatch = url.pathname.match(
        /^\/v1\/document-decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && documentUndoMatch) {
        requireProjection("documents");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undoDocumentDecision({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(documentUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const documentMatch = url.pathname.match(/^\/v1\/documents\/([^/]+)$/);
      if (documentMatch) {
        requireProjection("documents");
        const documentId = decodeURIComponent(documentMatch[1]);
        if (request.method === "GET") {
          sendJson(
            response,
            200,
            await repository.document({ documentId }),
            allowedOrigin,
          );
          return;
        }
        if (request.method === "PATCH") {
          const body = await readJsonBody(request);
          const { commandId, ...changes } = body;
          sendJson(
            response,
            200,
            await repository.updateDocument({
              actorId: request.headers["x-cimmich-actor"],
              commandId,
              documentId,
              ...changes,
            }),
            allowedOrigin,
          );
          return;
        }
      }
      const contextFamilies = {
        events: { entityKind: "event", surfaceKey: "events" },
        objects: { entityKind: "object", surfaceKey: "places" },
        places: { entityKind: "place", surfaceKey: "places" },
      };
      const contextCollectionMatch = url.pathname.match(
        /^\/v1\/(places|objects|events)$/,
      );
      if (contextCollectionMatch) {
        const family = contextFamilies[contextCollectionMatch[1]];
        requireProjection(family.surfaceKey);
        if (request.method === "GET") {
          sendJson(
            response,
            200,
            {
              items: await repository.contextEntities({
                entityKind: family.entityKind,
                includeArchived:
                  url.searchParams.get("includeArchived") === "true",
                includeHidden: url.searchParams.get("includeHidden") === "true",
                limit: url.searchParams.get("limit"),
                query: url.searchParams.get("q"),
              }),
              schemaVersion: "cimmich.context-entity.v1",
            },
            allowedOrigin,
          );
          return;
        }
        if (request.method === "POST") {
          const body = await readJsonBody(request);
          sendJson(
            response,
            201,
            await repository.createContextEntity({
              actorId: request.headers["x-cimmich-actor"],
              aliases: body.aliases,
              commandId: body.commandId,
              dateEnd: body.dateEnd,
              datePrecision: body.datePrecision,
              dateStart: body.dateStart,
              description: body.description,
              displayName: body.displayName,
              entityKind: family.entityKind,
              geometry: body.geometry,
              parentEntityId: body.parentEntityId,
              status: body.status,
              typeKind: body.typeKind,
            }),
            allowedOrigin,
          );
          return;
        }
      }
      const contextEntityMatch = url.pathname.match(
        /^\/v1\/(places|objects|events)\/([^/]+)$/,
      );
      if (contextEntityMatch) {
        const family = contextFamilies[contextEntityMatch[1]];
        requireProjection(family.surfaceKey);
        const entityId = decodeURIComponent(contextEntityMatch[2]);
        if (request.method === "GET") {
          sendJson(
            response,
            200,
            await repository.contextEntity({
              entityId,
              entityKind: family.entityKind,
              includeArchived:
                url.searchParams.get("includeArchived") === "true",
            }),
            allowedOrigin,
          );
          return;
        }
        if (request.method === "PATCH") {
          const body = await readJsonBody(request);
          sendJson(
            response,
            200,
            await repository.updateContextEntity({
              actorId: request.headers["x-cimmich-actor"],
              aliases: body.aliases,
              commandId: body.commandId,
              dateEnd: body.dateEnd,
              datePrecision: body.datePrecision,
              dateStart: body.dateStart,
              description: body.description,
              displayName: body.displayName,
              entityId,
              entityKind: family.entityKind,
              expectedRevision: body.expectedRevision,
              geometry: body.geometry,
              parentEntityId: body.parentEntityId,
              status: body.status,
              typeKind: body.typeKind,
            }),
            allowedOrigin,
          );
          return;
        }
      }
      const contextCoverMatch = url.pathname.match(
        /^\/v1\/(places|objects|events)\/([^/]+)\/cover$/,
      );
      if (request.method === "POST" && contextCoverMatch) {
        const family = contextFamilies[contextCoverMatch[1]];
        requireProjection(family.surfaceKey);
        const body = await readJsonBody(request);
        const keys = Object.keys(body);
        if (
          keys.length !== 3 ||
          !keys.every((key) =>
            ["commandId", "expectedRevision", "sourceAssetId"].includes(key),
          )
        ) {
          throw Object.assign(new Error("Context cover body is invalid"), {
            code: "CONTEXT_COVER_INPUT_INVALID",
            statusCode: 400,
          });
        }
        sendJson(
          response,
          200,
          await {
            event: repository.setEventCover,
            object: repository.setObjectCover,
            place: repository.setPlaceCover,
          }[family.entityKind]({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            entityId: decodeURIComponent(contextCoverMatch[2]),
            expectedRevision: body.expectedRevision,
            sourceAssetId: body.sourceAssetId,
          }),
          allowedOrigin,
        );
        return;
      }
      const contextDeleteMatch = url.pathname.match(
        /^\/v1\/(places|objects)\/([^/]+)\/delete$/,
      );
      if (request.method === "POST" && contextDeleteMatch) {
        const family = contextFamilies[contextDeleteMatch[1]];
        requireProjection(family.surfaceKey);
        const body = await readJsonBody(request);
        const keys = Object.keys(body);
        if (
          keys.length !== 3 ||
          !keys.every((key) =>
            ["commandId", "deleteTags", "expectedRevision"].includes(key),
          )
        ) {
          throw Object.assign(new Error("Context delete body is invalid"), {
            code: "CONTEXT_DELETE_INPUT_INVALID",
            statusCode: 400,
          });
        }
        sendJson(
          response,
          200,
          await (
            family.entityKind === "place"
              ? repository.deletePlace
              : repository.deleteObject
          )({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            deleteTags: body.deleteTags,
            entityId: decodeURIComponent(contextDeleteMatch[2]),
            expectedRevision: body.expectedRevision,
          }),
          allowedOrigin,
        );
        return;
      }
      const contextAssociationMatch = url.pathname.match(
        /^\/v1\/(places|objects|events)\/([^/]+)\/(assets|relations):(attach|detach)$/,
      );
      if (request.method === "POST" && contextAssociationMatch) {
        const family = contextFamilies[contextAssociationMatch[1]];
        requireProjection(family.surfaceKey);
        const entityId = decodeURIComponent(contextAssociationMatch[2]);
        const scope = contextAssociationMatch[3];
        const action = contextAssociationMatch[4];
        const body = await readJsonBody(request);
        const method =
          scope === "assets"
            ? action === "attach"
              ? "attachContextAssets"
              : "detachContextAssets"
            : action === "attach"
              ? "attachContextRelations"
              : "detachContextRelations";
        sendJson(
          response,
          200,
          await repository[method]({
            actorId: request.headers["x-cimmich-actor"],
            assetIds: body.assetIds,
            assets: body.assets,
            commandId: body.commandId,
            entityId,
            entityKind: family.entityKind,
            relationIds: body.relationIds,
            relations: body.relations,
          }),
          allowedOrigin,
        );
        return;
      }
      const contextUndoMatch = url.pathname.match(
        /^\/v1\/context\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && contextUndoMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undoContextDecision({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(contextUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/assets/evidence") {
        requireProjection("asset_evidence");
        sendJson(
          response,
          200,
          await repository.assetEvidence({
            sourceAssetId: url.searchParams.get("sourceAssetId"),
          }),
          allowedOrigin,
        );
        return;
      }
      const manualObjectAttachMatch = url.pathname.match(
        /^\/v1\/assets\/([^/]+)\/manual-context-tags$/,
      );
      if (request.method === "POST" && manualObjectAttachMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.attachManualObjectRegion({
            actorId: request.headers["x-cimmich-actor"],
            assetId: decodeURIComponent(manualObjectAttachMatch[1]),
            commandId: body.commandId,
            entityId: body.entityId,
            region: body.region,
          }),
          allowedOrigin,
        );
        return;
      }
      const manualObjectReplaceMatch = url.pathname.match(
        /^\/v1\/manual-context-tags\/([^/]+)\/replace$/,
      );
      if (request.method === "POST" && manualObjectReplaceMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.replaceManualObjectRegion({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            entityId: body.entityId,
            expectedDecisionId: body.expectedDecisionId,
            region: body.region,
            tagId: decodeURIComponent(manualObjectReplaceMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const manualObjectRejectMatch = url.pathname.match(
        /^\/v1\/manual-context-tags\/([^/]+)\/reject$/,
      );
      if (request.method === "POST" && manualObjectRejectMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.rejectManualObjectRegion({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            expectedDecisionId: body.expectedDecisionId,
            tagId: decodeURIComponent(manualObjectRejectMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const ownerSummaryMatch = url.pathname.match(
        /^\/v1\/assets\/([^/]+)\/owner-summary$/,
      );
      if (request.method === "POST" && ownerSummaryMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.setAssetOwnerSummary({
            actorId: request.headers["x-cimmich-actor"],
            assetId: decodeURIComponent(ownerSummaryMatch[1]),
            commandId: body.commandId,
            expectedRevision: body.expectedRevision,
            summaryText: Object.prototype.hasOwnProperty.call(
              body,
              "summaryText",
            )
              ? body.summaryText
              : undefined,
          }),
          allowedOrigin,
        );
        return;
      }
      const manualPhotoContextUndoMatch = url.pathname.match(
        /^\/v1\/manual-photo-context\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && manualPhotoContextUndoMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undoManualPhotoContextDecision({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(manualPhotoContextUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const personSetupMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/setup$/,
      );
      if (request.method === "GET" && personSetupMatch) {
        sendJson(
          response,
          200,
          await repository.personSetup({
            personId: decodeURIComponent(personSetupMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const personAliasesMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/aliases$/,
      );
      if (request.method === "POST" && personAliasesMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.addPersonAlias({
            actorId: request.headers["x-cimmich-actor"],
            aliasKind: body.aliasKind,
            label: body.label,
            personId: decodeURIComponent(personAliasesMatch[1]),
            sourceSubjectId: body.sourceSubjectId,
            sourceSystem: body.sourceSystem,
          }),
          allowedOrigin,
        );
        return;
      }
      const personAliasRemoveMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/aliases\/([^/]+)\/remove$/,
      );
      if (request.method === "POST" && personAliasRemoveMatch) {
        sendJson(
          response,
          200,
          await repository.removePersonAlias({
            actorId: request.headers["x-cimmich-actor"],
            aliasId: decodeURIComponent(personAliasRemoveMatch[2]),
            personId: decodeURIComponent(personAliasRemoveMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const personKindMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/subject-kind$/,
      );
      if (request.method === "POST" && personKindMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.setPersonSubjectKind({
            actorId: request.headers["x-cimmich-actor"],
            personId: decodeURIComponent(personKindMatch[1]),
            subjectKind: body.subjectKind,
          }),
          allowedOrigin,
        );
        return;
      }
      const personCategoryMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/categories\/([^/]+)$/,
      );
      if (request.method === "POST" && personCategoryMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.setPersonCategory({
            actorId: request.headers["x-cimmich-actor"],
            categoryId: decodeURIComponent(personCategoryMatch[2]),
            personId: decodeURIComponent(personCategoryMatch[1]),
            selected: body.selected,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/people/merge-preview"
      ) {
        sendJson(
          response,
          200,
          await repository.previewPersonMerge({
            sourcePersonId: url.searchParams.get("sourcePersonId"),
            targetPersonId: url.searchParams.get("targetPersonId"),
          }),
          allowedOrigin,
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/people/merge") {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.mergePeople({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            sourcePersonId: body.sourcePersonId,
            targetPersonId: body.targetPersonId,
          }),
          allowedOrigin,
        );
        return;
      }
      const personUnmergeMatch = url.pathname.match(
        /^\/v1\/people\/merges\/([^/]+)\/unmerge$/,
      );
      if (request.method === "POST" && personUnmergeMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.unmergePeople({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            mergeOperationId: decodeURIComponent(personUnmergeMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const personAssetsMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/assets$/,
      );
      if (request.method === "GET" && personAssetsMatch) {
        requireProjection("person_assets");
        const pageSize = url.searchParams.has("pageSize")
          ? url.searchParams.get("pageSize")
          : null;
        const cursor = url.searchParams.get("cursor") || "";
        const result = await repository.personAssets({
          cursor,
          limit: url.searchParams.get("limit"),
          pageSize,
          personId: decodeURIComponent(personAssetsMatch[1]),
        });
        sendJson(
          response,
          200,
          pageSize !== null || cursor ? result : { items: result },
          allowedOrigin,
        );
        return;
      }
      const personCandidatesMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/candidates$/,
      );
      if (request.method === "GET" && personCandidatesMatch) {
        requireProjection("person_review");
        sendJson(
          response,
          200,
          {
            items: await repository.personCandidates({
              limit: url.searchParams.get("limit"),
              personId: decodeURIComponent(personCandidatesMatch[1]),
            }),
          },
          allowedOrigin,
        );
        return;
      }
      const personCandidateAcceptMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/candidates\/bulk-accept$/,
      );
      if (request.method === "POST" && personCandidateAcceptMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.bulkAcceptPersonCandidates({
            actorId: request.headers["x-cimmich-actor"],
            claimIds: body.claimIds,
            personId: decodeURIComponent(personCandidateAcceptMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const personIdentityMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/identity$/,
      );
      if (request.method === "GET" && personIdentityMatch) {
        requireProjection("person_review");
        const pageSize = url.searchParams.has("pageSize")
          ? url.searchParams.get("pageSize")
          : null;
        const cursor = url.searchParams.get("cursor") || "";
        const result = await repository.identityFaces({
          cursor,
          limit: url.searchParams.get("limit"),
          pageSize,
          personId: decodeURIComponent(personIdentityMatch[1]),
        });
        sendJson(
          response,
          200,
          pageSize !== null || cursor ? result : { items: result },
          allowedOrigin,
        );
        return;
      }
      const personIdentityMatchBatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/identity\/matches:batch$/,
      );
      if (request.method === "POST" && personIdentityMatchBatch) {
        requireProjection("person_review");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.faceMatchesBatch({
            faceIds: body.faceIds,
            limitPerFace: body.limitPerFace,
            personId: decodeURIComponent(personIdentityMatchBatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const faceBucketMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/identity\/faces\/([^/]+)\/bucket$/,
      );
      if (request.method === "POST" && faceBucketMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.setFaceBucket({
            actorId: request.headers["x-cimmich-actor"],
            bucketKind: body.bucketKind ?? null,
            faceId: decodeURIComponent(faceBucketMatch[2]),
            personId: decodeURIComponent(faceBucketMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const faceMoveMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/identity\/faces\/([^/]+)\/move$/,
      );
      if (request.method === "POST" && faceMoveMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.movePersonFace({
            actorId: request.headers["x-cimmich-actor"],
            bodyId: body.bodyId,
            faceId: decodeURIComponent(faceMoveMatch[2]),
            moveBody: body.moveBody,
            newPersonName: body.newPersonName,
            sourcePersonId: decodeURIComponent(faceMoveMatch[1]),
            targetPersonId: body.targetPersonId,
          }),
          allowedOrigin,
        );
        return;
      }
      const faceSpecialtyMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/identity\/faces\/([^/]+)\/specialty$/,
      );
      if (request.method === "POST" && faceSpecialtyMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.setFaceModifier({
            actorId: request.headers["x-cimmich-actor"],
            faceId: decodeURIComponent(faceSpecialtyMatch[2]),
            modifierName: body.specialtyName,
            personId: decodeURIComponent(faceSpecialtyMatch[1]),
            selected: body.selected,
          }),
          allowedOrigin,
        );
        return;
      }
      const faceModifierMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/identity\/faces\/([^/]+)\/modifiers$/,
      );
      if (request.method === "POST" && faceModifierMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.setFaceModifier({
            actorId: request.headers["x-cimmich-actor"],
            faceId: decodeURIComponent(faceModifierMatch[2]),
            modifierName: body.modifierName,
            personId: decodeURIComponent(faceModifierMatch[1]),
            selected: body.selected,
          }),
          allowedOrigin,
        );
        return;
      }
      const modifierProposalDecisionMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/identity\/modifier-proposals\/([^/]+)\/decision$/,
      );
      if (request.method === "POST" && modifierProposalDecisionMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.decideFaceModifierProposal({
            action: body.action,
            actorId: request.headers["x-cimmich-actor"],
            personId: decodeURIComponent(modifierProposalDecisionMatch[1]),
            proposalId: decodeURIComponent(modifierProposalDecisionMatch[2]),
          }),
          allowedOrigin,
        );
        return;
      }
      const bodySelectionMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/identity\/bodies\/([^/]+)$/,
      );
      if (request.method === "POST" && bodySelectionMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.setBodySelection({
            actorId: request.headers["x-cimmich-actor"],
            bodyId: decodeURIComponent(bodySelectionMatch[2]),
            personId: decodeURIComponent(bodySelectionMatch[1]),
            selected: body.selected,
          }),
          allowedOrigin,
        );
        return;
      }
      const assetHeadMatch = url.pathname.match(
        /^\/v1\/people\/([^/]+)\/identity\/assets\/([^/]+)\/head$/,
      );
      if (request.method === "POST" && assetHeadMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.setAssetHeadEvidence({
            actorId: request.headers["x-cimmich-actor"],
            assetId: decodeURIComponent(assetHeadMatch[2]),
            personId: decodeURIComponent(assetHeadMatch[1]),
            selected: body.selected,
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/review/machine-suggestions"
      ) {
        requireProjection("machine_suggestions");
        sendJson(
          response,
          200,
          {
            items: await repository.machineSuggestions({
              limit: url.searchParams.get("limit"),
            }),
          },
          allowedOrigin,
        );
        return;
      }
      const machineSuggestionAcceptMatch = url.pathname.match(
        /^\/v1\/review\/machine-suggestions\/([^/]+)\/accept$/,
      );
      if (request.method === "POST" && machineSuggestionAcceptMatch) {
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.reassignFaceIdentity({
            actorId: request.headers["x-cimmich-actor"],
            faceId: decodeURIComponent(machineSuggestionAcceptMatch[1]),
            personId: body.personId,
          }),
          allowedOrigin,
        );
        return;
      }
      const machineSuggestionUnknownMatch = url.pathname.match(
        /^\/v1\/review\/machine-suggestions\/([^/]+)\/unknown$/,
      );
      if (request.method === "POST" && machineSuggestionUnknownMatch) {
        sendJson(
          response,
          200,
          await repository.dismissMachineSuggestion({
            actorId: request.headers["x-cimmich-actor"],
            faceId: decodeURIComponent(machineSuggestionUnknownMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const machineSuggestionRestoreMatch = url.pathname.match(
        /^\/v1\/review\/machine-suggestions\/([^/]+)\/restore$/,
      );
      if (request.method === "POST" && machineSuggestionRestoreMatch) {
        sendJson(
          response,
          200,
          await repository.restoreMachineSuggestion({
            actorId: request.headers["x-cimmich-actor"],
            faceId: decodeURIComponent(machineSuggestionRestoreMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/review/identity-claims"
      ) {
        sendJson(
          response,
          200,
          {
            items: await repository.identityCandidates({
              limit: url.searchParams.get("limit"),
              personId: url.searchParams.get("personId"),
            }),
          },
          allowedOrigin,
        );
        return;
      }

      const decisionMatch = url.pathname.match(
        /^\/v1\/review\/identity-claims\/([^/]+)\/decision$/,
      );
      if (request.method === "POST" && decisionMatch) {
        requireProjection("asset_evidence");
        const body = await readJsonBody(request);
        const result = await repository.decideIdentityClaim({
          action: body.action,
          actorId: request.headers["x-cimmich-actor"],
          claimId: decodeURIComponent(decisionMatch[1]),
          note: body.note,
        });
        sendJson(response, 200, result, allowedOrigin);
        return;
      }

      const faceReviewDispositionMatch = url.pathname.match(
        /^\/v1\/faces\/([^/]+)\/review-disposition$/,
      );
      if (request.method === "POST" && faceReviewDispositionMatch) {
        requireProjection("asset_evidence");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.setFaceReviewDisposition({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            disposition: body.disposition,
            faceId: decodeURIComponent(faceReviewDispositionMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }

      const correctionMatch = url.pathname.match(
        /^\/v1\/identity-claims\/([^/]+)\/not-this-person$/,
      );
      if (request.method === "POST" && correctionMatch) {
        requireProjection("asset_evidence");
        const body = await readJsonBody(request);
        const result = await repository.rejectAcceptedIdentity({
          actorId: request.headers["x-cimmich-actor"],
          claimId: decodeURIComponent(correctionMatch[1]),
          commandId: body.commandId,
          note: body.note,
        });
        sendJson(response, 200, result, allowedOrigin);
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/identity-corrections"
      ) {
        requireProjection("asset_evidence");
        sendJson(
          response,
          200,
          await repository.discoverIdentityCorrections({
            limit: url.searchParams.get("limit"),
            personId: url.searchParams.get("personId"),
            sourceAssetId: url.searchParams.get("sourceAssetId"),
            undoEligible: url.searchParams.get("undoEligible") === "true",
          }),
          allowedOrigin,
        );
        return;
      }
      const correctionHistoryMatch = url.pathname.match(
        /^\/v1\/identity-claims\/([^/]+)\/history$/,
      );
      if (request.method === "GET" && correctionHistoryMatch) {
        requireProjection("asset_evidence");
        sendJson(
          response,
          200,
          await repository.identityCorrectionHistory({
            claimId: decodeURIComponent(correctionHistoryMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }
      const correctionUndoMatch = url.pathname.match(
        /^\/v1\/identity-claims\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && correctionUndoMatch) {
        requireProjection("asset_evidence");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undoIdentityCorrection({
            actorId: request.headers["x-cimmich-actor"],
            commandId: body.commandId,
            decisionId: decodeURIComponent(correctionUndoMatch[1]),
          }),
          allowedOrigin,
        );
        return;
      }

      const faceMatchesMatch = url.pathname.match(
        /^\/v1\/faces\/([^/]+)\/matches$/,
      );
      if (request.method === "GET" && faceMatchesMatch) {
        requireProjection("asset_evidence");
        sendJson(
          response,
          200,
          await repository.faceReviewComparisons({
            faceId: decodeURIComponent(faceMatchesMatch[1]),
            limit: url.searchParams.get("limit"),
          }),
          allowedOrigin,
        );
        return;
      }

      const observationGeometryMatch = url.pathname.match(
        /^\/v1\/(faces|bodies)\/([^/]+)\/geometry$/,
      );
      if (request.method === "POST" && observationGeometryMatch) {
        requireProjection("asset_evidence");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.correctGeometry(
            {
              actorId: request.headers["x-cimmich-actor"],
              commandId: body.commandId,
              expectedDecisionId: body.expectedDecisionId ?? null,
              expectedRevision: body.expectedRevision,
              region: body.region,
            },
            observationGeometryMatch[1] === "faces" ? "face" : "body",
            decodeURIComponent(observationGeometryMatch[2]),
          ),
          allowedOrigin,
        );
        return;
      }

      const observationRejectMatch = url.pathname.match(
        /^\/v1\/(faces|bodies)\/([^/]+)\/(not-face|not-body)$/,
      );
      if (request.method === "POST" && observationRejectMatch) {
        const kind = observationRejectMatch[1] === "faces" ? "face" : "body";
        if (
          (kind === "face" && observationRejectMatch[3] !== "not-face") ||
          (kind === "body" && observationRejectMatch[3] !== "not-body")
        ) {
          throw Object.assign(
            new Error("Observation rejection route is invalid"),
            {
              code: "OBSERVATION_CORRECTION_INPUT_INVALID",
              statusCode: 400,
            },
          );
        }
        requireProjection("asset_evidence");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.rejectObservation(
            {
              actorId: request.headers["x-cimmich-actor"],
              commandId: body.commandId,
              expectedDecisionId: body.expectedDecisionId ?? null,
              expectedRevision: body.expectedRevision,
            },
            kind,
            decodeURIComponent(observationRejectMatch[2]),
          ),
          allowedOrigin,
        );
        return;
      }

      const observationUndoMatch = url.pathname.match(
        /^\/v1\/observation-corrections\/decisions\/([^/]+)\/undo$/,
      );
      if (request.method === "POST" && observationUndoMatch) {
        requireProjection("asset_evidence");
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          await repository.undo(
            {
              actorId: request.headers["x-cimmich-actor"],
              commandId: body.commandId,
            },
            decodeURIComponent(observationUndoMatch[1]),
          ),
          allowedOrigin,
        );
        return;
      }

      const faceIdentityMatch = url.pathname.match(
        /^\/v1\/faces\/([^/]+)\/identity$/,
      );
      if (request.method === "POST" && faceIdentityMatch) {
        requireProjection("asset_detail");
        const selector = exactFaceIdentitySelector(await readJsonBody(request));
        const result = await repository.reassignFaceIdentity({
          actorId: request.headers["x-cimmich-actor"],
          faceId: decodeURIComponent(faceIdentityMatch[1]),
          ...selector,
        });
        sendJson(response, 200, result, allowedOrigin);
        return;
      }

      // Keep this generic one-segment route after named People routes such as
      // /merge-preview so a command cannot be mistaken for a Person ID.
      const personReadMatch = url.pathname.match(/^\/v1\/people\/([^/]+)$/);
      if (request.method === "GET" && personReadMatch) {
        const person = await repository.person({
          personId: decodeURIComponent(personReadMatch[1]),
        });
        sendJson(response, 200, person, allowedOrigin);
        return;
      }

      sendJson(
        response,
        404,
        { error: "Cimmich endpoint not found" },
        allowedOrigin,
      );
    } catch (error) {
      const statusCode =
        Number(error?.statusCode) || (error instanceof SyntaxError ? 400 : 500);
      sendJson(
        response,
        statusCode,
        {
          error:
            statusCode === 500
              ? "Cimmich service request failed"
              : error.message,
          ...(error?.code ? { code: error.code } : {}),
          ...(error?.details ? { details: error.details } : {}),
        },
        allowedOrigin,
      );
      const diagnostic = JSON.stringify({
        code: error?.code || "CIMMICH_REQUEST_FAILED",
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        method: request.method || "UNKNOWN",
        requestId,
        routeFamily: safeRouteFamily(request.url),
        statusCode,
      });
      if (statusCode >= 500) console.error(diagnostic);
      else console.warn(diagnostic);
    }
  };
  const server = createServer((request, response) =>
    visibility
      ? visibility.runRequest(request, response, () =>
          handleRequest(request, response),
        )
      : handleRequest(request, response),
  );
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1_000;
  server.requestTimeout = 30_000;
  return server;
};
