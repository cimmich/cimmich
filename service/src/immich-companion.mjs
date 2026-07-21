import { createHash } from "node:crypto";

export const IMMICH_COMPANION_SCHEMA_VERSION = "cimmich.immich-companion.v1";
export const IMMICH_COMPANION_SUPPORTED_VERSION = "3.0.3";
export const IMMICH_COMPANION_SUPPORTED_RANGE = "=3.0.3";
export const IMMICH_COMPANION_DEFAULT_MAX_IMAGE_BYTES = 128 * 1024 * 1024;

const VISIBILITIES = new Set(["timeline", "archive", "hidden", "locked"]);
const ASSET_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "OTHER"]);
const JSON_ROUTE_ALLOWLIST = [
  { authenticated: false, method: "GET", path: /^\/server\/version$/ },
  { authenticated: true, method: "GET", path: /^\/users\/me$/ },
  { authenticated: true, method: "GET", path: /^\/assets\/[^/]+$/ },
  { authenticated: true, method: "GET", path: /^\/faces\?id=[^&]+$/ },
  {
    authenticated: true,
    method: "GET",
    path: /^\/people\?page=\d+&size=\d+&withHidden=(?:true|false)$/,
  },
  { authenticated: true, method: "GET", path: /^\/people\/[^/]+$/ },
  { authenticated: true, method: "POST", path: /^\/search\/metadata$/ },
];

const companionError = (code, message, statusCode = 503, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const requiredText = (value, name) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw companionError(
      "IMMICH_COMPANION_PROTOCOL_INVALID",
      `Immich response is missing ${name}`,
      502,
    );
  }
  return normalized;
};

const optionalText = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const finiteInteger = (value, name) => {
  if (!Number.isInteger(value) || value < 0) {
    throw companionError(
      "IMMICH_COMPANION_PROTOCOL_INVALID",
      `Immich response has invalid ${name}`,
      502,
    );
  }
  return value;
};

export const normalizeImmichApiBaseUrl = (value) => {
  const input = String(value || "").trim();
  if (!input) return "";

  let url;
  try {
    url = new URL(input);
  } catch {
    throw companionError(
      "IMMICH_COMPANION_CONFIG_INVALID",
      "Immich API URL is invalid",
      500,
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw companionError(
      "IMMICH_COMPANION_CONFIG_INVALID",
      "Immich API URL must be an HTTP(S) origin or /api root without credentials",
      500,
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== "/api") {
    throw companionError(
      "IMMICH_COMPANION_CONFIG_INVALID",
      "Immich API URL path must be empty or /api",
      500,
    );
  }
  url.pathname = "/api";
  return url.toString().replace(/\/$/, "");
};

const parseVersion = (value) => {
  if (!value || typeof value !== "object") {
    throw companionError(
      "IMMICH_COMPANION_PROTOCOL_INVALID",
      "Immich version response is invalid",
      502,
    );
  }
  const major = finiteInteger(value.major, "version.major");
  const minor = finiteInteger(value.minor, "version.minor");
  const patch = finiteInteger(value.patch, "version.patch");
  const prerelease =
    value.prerelease == null
      ? null
      : finiteInteger(value.prerelease, "version.prerelease");
  return {
    major,
    minor,
    patch,
    prerelease,
    semver: `${major}.${minor}.${patch}${prerelease == null ? "" : `-rc.${prerelease}`}`,
  };
};

const assetInputRevision = (asset) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        asset.id,
        asset.checksum,
        asset.updatedAt,
        asset.fileModifiedAt,
        asset.type,
      ]),
    )
    .digest("hex");

export const projectImmichAsset = (value) => {
  if (!value || typeof value !== "object") {
    throw companionError(
      "IMMICH_COMPANION_PROTOCOL_INVALID",
      "Immich asset response is invalid",
      502,
    );
  }
  const id = requiredText(value.id, "asset.id");
  const ownerId = requiredText(value.ownerId, "asset.ownerId");
  const type = requiredText(value.type, "asset.type");
  if (!ASSET_TYPES.has(type)) {
    throw companionError(
      "IMMICH_COMPANION_PROTOCOL_INVALID",
      "Immich asset type is unsupported",
      502,
    );
  }
  const visibility = requiredText(value.visibility, "asset.visibility");
  if (!VISIBILITIES.has(visibility)) {
    throw companionError(
      "IMMICH_COMPANION_PROTOCOL_INVALID",
      "Immich asset visibility is unsupported",
      502,
    );
  }
  const checksum = requiredText(value.checksum, "asset.checksum");
  const createdAt = requiredText(value.createdAt, "asset.createdAt");
  const fileCreatedAt = requiredText(
    value.fileCreatedAt,
    "asset.fileCreatedAt",
  );
  const fileModifiedAt = requiredText(
    value.fileModifiedAt,
    "asset.fileModifiedAt",
  );
  const updatedAt = requiredText(value.updatedAt, "asset.updatedAt");
  const typeName = type.toLowerCase();
  const projected = {
    immichAssetId: id,
    ownerId,
    assetType: typeName,
    visibility,
    checksum,
    createdAt,
    captureTime: fileCreatedAt,
    fileModifiedAt,
    updatedAt,
    localDateTime: optionalText(value.localDateTime),
    originalFileName: optionalText(value.originalFileName),
    originalMimeType: optionalText(value.originalMimeType),
    width:
      Number.isInteger(value.width) && value.width >= 0 ? value.width : null,
    height:
      Number.isInteger(value.height) && value.height >= 0 ? value.height : null,
    duration:
      Number.isInteger(value.duration) && value.duration >= 0
        ? value.duration
        : null,
    isArchived: Boolean(value.isArchived),
    isFavorite: Boolean(value.isFavorite),
    isOffline: Boolean(value.isOffline),
    isTrashed: Boolean(value.isTrashed),
  };
  return {
    ...projected,
    inputRevision: assetInputRevision({
      checksum,
      fileModifiedAt,
      id,
      type,
      updatedAt,
    }),
  };
};

export const projectImmichPerson = (value) => {
  if (!value || typeof value !== "object") {
    throw companionError(
      "IMMICH_COMPANION_PROTOCOL_INVALID",
      "Immich Person response is invalid",
      502,
    );
  }
  const id = requiredText(value.id, "person.id");
  // Immich may retain a stable Person/Face grouping before the owner gives the
  // Person a label. That is valid upstream topology, but it is not importable
  // identity truth until a label exists.
  const name = optionalText(value.name);
  const source = {
    birthDate: optionalText(value.birthDate),
    id,
    isFavorite: Boolean(value.isFavorite),
    isHidden: Boolean(value.isHidden),
    name,
    updatedAt: optionalText(value.updatedAt),
  };
  return {
    ...source,
    sourceRevision: createHash("sha256")
      .update(JSON.stringify(source))
      .digest("hex"),
  };
};

export const projectImmichFace = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw companionError(
      "IMMICH_COMPANION_PROTOCOL_INVALID",
      "Immich Face response is invalid",
      502,
    );
  }
  const id = requiredText(value.id, "face.id");
  const imageWidth = finiteInteger(value.imageWidth, "face.imageWidth");
  const imageHeight = finiteInteger(value.imageHeight, "face.imageHeight");
  const x1 = finiteInteger(value.boundingBoxX1, "face.boundingBoxX1");
  const y1 = finiteInteger(value.boundingBoxY1, "face.boundingBoxY1");
  const x2 = finiteInteger(value.boundingBoxX2, "face.boundingBoxX2");
  const y2 = finiteInteger(value.boundingBoxY2, "face.boundingBoxY2");
  if (
    imageWidth < 1 ||
    imageHeight < 1 ||
    x2 <= x1 ||
    y2 <= y1 ||
    x2 > imageWidth ||
    y2 > imageHeight
  ) {
    throw companionError(
      "IMMICH_COMPANION_PROTOCOL_INVALID",
      "Immich Face geometry is invalid",
      502,
    );
  }
  const person =
    value.person == null ? null : projectImmichPerson(value.person);
  const source = {
    box: {
      h: Number(((y2 - y1) / imageHeight).toFixed(9)),
      w: Number(((x2 - x1) / imageWidth).toFixed(9)),
      x: Number((x1 / imageWidth).toFixed(9)),
      y: Number((y1 / imageHeight).toFixed(9)),
    },
    id,
    imageHeight,
    imageWidth,
    personId: person?.id || null,
    sourceType: optionalText(value.sourceType),
  };
  return {
    ...source,
    person,
    sourceRevision: createHash("sha256")
      .update(JSON.stringify(source))
      .digest("hex"),
  };
};

const stateForError = (error) => {
  if (error?.code === "IMMICH_COMPANION_AUTH_FAILED") return "unauthorized";
  if (error?.code === "IMMICH_COMPANION_PROTOCOL_INVALID") {
    return "invalid_response";
  }
  return "unavailable";
};

const unverifiedCapabilities = () => ({
  assetRead: false,
  assetSearch: false,
  faceRead: false,
  mediaRead: false,
  personList: false,
  personRead: false,
});

export const createImmichCompanion = ({
  apiBaseUrl = "",
  apiKey = "",
  fetchImpl = globalThis.fetch,
  supportedVersion = IMMICH_COMPANION_SUPPORTED_VERSION,
  timeoutMs = 5_000,
  maxImageBytes = IMMICH_COMPANION_DEFAULT_MAX_IMAGE_BYTES,
} = {}) => {
  const normalizedApiBaseUrl = normalizeImmichApiBaseUrl(apiBaseUrl);
  const normalizedApiKey = String(apiKey || "").trim();
  const configured = Boolean(normalizedApiBaseUrl && normalizedApiKey);

  if (configured && typeof fetchImpl !== "function") {
    throw companionError(
      "IMMICH_COMPANION_CONFIG_INVALID",
      "Immich companion requires fetch support",
      500,
    );
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(supportedVersion || ""))) {
    throw companionError(
      "IMMICH_COMPANION_CONFIG_INVALID",
      "Immich supported version is invalid",
      500,
    );
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw companionError(
      "IMMICH_COMPANION_CONFIG_INVALID",
      "Immich companion timeout is invalid",
      500,
    );
  }
  if (
    !Number.isInteger(maxImageBytes) ||
    maxImageBytes < 1024 * 1024 ||
    maxImageBytes > 1024 * 1024 * 1024
  ) {
    throw companionError(
      "IMMICH_COMPANION_CONFIG_INVALID",
      "Immich image read limit must be between 1 MiB and 1 GiB",
      500,
    );
  }

  const requestJson = async (
    path,
    { authenticated = true, body, method = "GET", notFoundCode = "" } = {},
  ) => {
    const normalizedMethod = String(method || "GET").toUpperCase();
    const allowed = JSON_ROUTE_ALLOWLIST.some(
      (rule) =>
        rule.authenticated === authenticated &&
        rule.method === normalizedMethod &&
        rule.path.test(path),
    );
    if (!allowed) {
      throw companionError(
        "IMMICH_COMPANION_ROUTE_NOT_ALLOWED",
        "Immich companion route is not allowlisted",
        500,
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${normalizedApiBaseUrl}${path}`, {
        method: normalizedMethod,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(authenticated ? { "x-api-key": normalizedApiKey } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw companionError(
        "IMMICH_COMPANION_UNAVAILABLE",
        "Immich companion is unavailable",
        503,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      let upstreamCode = "";
      let upstreamMessage = "";
      try {
        const upstream = await response.json();
        upstreamCode = String(upstream?.error || "").trim();
        upstreamMessage = String(upstream?.message || "").trim();
      } catch {
        // Authentication failures stay redacted when Immich sends no JSON.
      }
      if (
        response.status === 401 &&
        path === "/search/metadata" &&
        (upstreamCode === "Unauthorized" || !upstreamCode) &&
        upstreamMessage === "Elevated permission is required"
      ) {
        throw companionError(
          "IMMICH_COMPANION_ELEVATED_REQUIRED",
          "Immich locked assets require an interactive elevated session and are excluded from API-key inventory",
          409,
        );
      }
      throw companionError(
        "IMMICH_COMPANION_AUTH_FAILED",
        "Immich API key was rejected or lacks required permission",
        503,
      );
    }
    if (response.status === 404 && notFoundCode) {
      throw companionError(
        notFoundCode,
        notFoundCode === "IMMICH_PERSON_NOT_FOUND"
          ? "Immich Person was not found"
          : "Immich asset was not found",
        404,
      );
    }
    if (!response.ok) {
      throw companionError(
        "IMMICH_COMPANION_UNAVAILABLE",
        "Immich companion request failed",
        503,
      );
    }
    try {
      return await response.json();
    } catch {
      throw companionError(
        "IMMICH_COMPANION_PROTOCOL_INVALID",
        "Immich companion returned invalid JSON",
        502,
      );
    }
  };

  const requestImageBytes = async (assetId) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(
        `${normalizedApiBaseUrl}/assets/${encodeURIComponent(assetId)}/original`,
        {
          signal: controller.signal,
          headers: {
            accept: "image/*,application/octet-stream;q=0.5",
            "x-api-key": normalizedApiKey,
          },
        },
      );
      if (response.status === 401 || response.status === 403) {
        throw companionError(
          "IMMICH_COMPANION_AUTH_FAILED",
          "Immich API key was rejected or lacks original-asset read permission",
          503,
        );
      }
      if (response.status === 404) {
        throw companionError(
          "IMMICH_ASSET_NOT_FOUND",
          "Immich asset was not found",
          404,
        );
      }
      if (!response.ok || !response.body) {
        throw companionError(
          "IMMICH_COMPANION_MEDIA_UNAVAILABLE",
          "Immich original image could not be read",
          503,
        );
      }
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxImageBytes) {
        throw companionError(
          "IMMICH_COMPANION_MEDIA_TOO_LARGE",
          "Immich original image exceeds the configured local read limit",
          413,
        );
      }
      const chunks = [];
      let byteLength = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        byteLength += bytes.length;
        if (byteLength > maxImageBytes) {
          controller.abort();
          throw companionError(
            "IMMICH_COMPANION_MEDIA_TOO_LARGE",
            "Immich original image exceeds the configured local read limit",
            413,
          );
        }
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks, byteLength);
      return {
        byteLength,
        bytes,
        contentDigest: createHash("sha256").update(bytes).digest("hex"),
        mimeType: optionalText(response.headers.get("content-type")),
      };
    } catch (error) {
      if (error?.code) throw error;
      throw companionError(
        "IMMICH_COMPANION_MEDIA_UNAVAILABLE",
        "Immich original image could not be read",
        503,
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  const status = async () => {
    const base = {
      schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
      supportedRange: IMMICH_COMPANION_SUPPORTED_RANGE,
      readOnly: true,
      databaseIsolation: "separate",
    };
    if (!configured) {
      return {
        ...base,
        state: "not_configured",
        capabilities: unverifiedCapabilities(),
        permissionVerification: "not_performed",
      };
    }

    let version;
    try {
      version = parseVersion(
        await requestJson("/server/version", { authenticated: false }),
      );
      if (version.semver !== supportedVersion) {
        return {
          ...base,
          state: "incompatible",
          immichVersion: version.semver,
          code: "IMMICH_COMPANION_VERSION_UNSUPPORTED",
          capabilities: unverifiedCapabilities(),
          permissionVerification: "not_performed",
        };
      }
      const principal = await requestJson("/users/me");
      const principalId = requiredText(principal?.id, "principal.id");
      return {
        ...base,
        state: "ready",
        immichVersion: version.semver,
        principal: {
          userId: principalId,
          isAdmin: Boolean(principal?.isAdmin),
        },
        capabilities: unverifiedCapabilities(),
        permissionVerification: "not_performed",
      };
    } catch (error) {
      return {
        ...base,
        state: stateForError(error),
        ...(version ? { immichVersion: version.semver } : {}),
        code: error?.code || "IMMICH_COMPANION_UNAVAILABLE",
        capabilities: unverifiedCapabilities(),
        permissionVerification: "not_performed",
      };
    }
  };

  const ensureReady = async () => {
    const receipt = await status();
    if (receipt.state === "ready") return receipt;
    const code = receipt.code || "IMMICH_COMPANION_NOT_CONFIGURED";
    const message =
      receipt.state === "incompatible"
        ? "Immich version is not supported by this Cimmich companion"
        : receipt.state === "not_configured"
          ? "Immich companion is not configured"
          : "Immich companion is not ready";
    throw companionError(
      code,
      message,
      receipt.state === "incompatible" ? 409 : 503,
      {
        state: receipt.state,
      },
    );
  };

  const getAsset = async ({ assetId }) => {
    const receipt = await ensureReady();
    const normalizedAssetId = requiredText(assetId, "assetId");
    const asset = projectImmichAsset(
      await requestJson(`/assets/${encodeURIComponent(normalizedAssetId)}`, {
        notFoundCode: "IMMICH_ASSET_NOT_FOUND",
      }),
    );
    return {
      schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
      immichVersion: receipt.immichVersion,
      asset,
    };
  };

  const getPerson = async ({ personId }) => {
    const receipt = await ensureReady();
    const normalizedPersonId = requiredText(personId, "personId");
    const person = projectImmichPerson(
      await requestJson(`/people/${encodeURIComponent(normalizedPersonId)}`, {
        notFoundCode: "IMMICH_PERSON_NOT_FOUND",
      }),
    );
    return {
      schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
      immichVersion: receipt.immichVersion,
      person,
    };
  };

  const listPeople = async ({
    cursor = "",
    includeHidden = false,
    limit = 100,
  } = {}) => {
    const receipt = await ensureReady();
    const page = cursor === "" ? 1 : Number(cursor);
    const normalizedLimit = Number(limit);
    if (!Number.isInteger(page) || page < 1) {
      throw companionError(
        "IMMICH_COMPANION_CURSOR_INVALID",
        "Immich People page cursor is invalid",
        400,
      );
    }
    if (
      !Number.isInteger(normalizedLimit) ||
      normalizedLimit < 1 ||
      normalizedLimit > 1000
    ) {
      throw companionError(
        "IMMICH_COMPANION_LIMIT_INVALID",
        "Immich People page limit must be between 1 and 1000",
        400,
      );
    }
    const result = await requestJson(
      `/people?page=${page}&size=${normalizedLimit}&withHidden=${includeHidden ? "true" : "false"}`,
    );
    if (!result || !Array.isArray(result.people)) {
      throw companionError(
        "IMMICH_COMPANION_PROTOCOL_INVALID",
        "Immich People response is invalid",
        502,
      );
    }
    const items = result.people.map(projectImmichPerson);
    return {
      schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
      immichVersion: receipt.immichVersion,
      items,
      nextCursor: result.hasNextPage === true ? String(page + 1) : null,
      total: finiteInteger(result.total ?? items.length, "people.total"),
      hiddenTotal: finiteInteger(result.hidden ?? 0, "people.hidden"),
    };
  };

  const listAssetFaces = async ({ assetId }) => {
    const receipt = await ensureReady();
    const normalizedAssetId = requiredText(assetId, "assetId");
    const result = await requestJson(
      `/faces?id=${encodeURIComponent(normalizedAssetId)}`,
    );
    if (!Array.isArray(result)) {
      throw companionError(
        "IMMICH_COMPANION_PROTOCOL_INVALID",
        "Immich Face response is invalid",
        502,
      );
    }
    const items = result
      .map(projectImmichFace)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      throw companionError(
        "IMMICH_COMPANION_PROTOCOL_INVALID",
        "Immich Face response contains duplicate IDs",
        502,
      );
    }
    return {
      schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
      immichVersion: receipt.immichVersion,
      assetId: normalizedAssetId,
      items,
    };
  };

  const verifyOnboardingPermissions = async () => {
    const statusReceipt = await ensureReady();
    await listPeople({ includeHidden: false, limit: 1 });
    const assets = await listAssets({ limit: 1, visibility: "timeline" });
    const image = assets.items.find((asset) => asset.assetType === "image");
    if (image) await listAssetFaces({ assetId: image.immichAssetId });
    return {
      capabilities: {
        assetRead: true,
        assetSearch: true,
        faceRead: image !== undefined,
        mediaRead: false,
        personList: true,
        personRead: true,
      },
      immichVersion: statusReceipt.immichVersion,
      principal: statusReceipt.principal,
      permissions: {
        assetSearch: "verified",
        faceRead: image ? "verified" : "not_tested_empty_image_library",
        mediaRead: "deferred_until_optional_provider_run",
        peopleRead: "verified",
        sourceWrite: "none",
      },
      permissionVerification: image ? "verified" : "verified_empty_library",
      state: "ready",
    };
  };

  const listAssets = async ({
    cursor = "",
    limit = 100,
    updatedAfter = "",
    visibility,
  } = {}) => {
    const receipt = await ensureReady();
    const normalizedVisibility = String(visibility || "").trim();
    if (!VISIBILITIES.has(normalizedVisibility)) {
      throw companionError(
        "IMMICH_COMPANION_VISIBILITY_REQUIRED",
        "An explicit Immich visibility lane is required",
        400,
      );
    }
    const normalizedLimit = Number(limit);
    if (
      !Number.isInteger(normalizedLimit) ||
      normalizedLimit < 1 ||
      normalizedLimit > 1000
    ) {
      throw companionError(
        "IMMICH_COMPANION_LIMIT_INVALID",
        "Immich asset page limit must be between 1 and 1000",
        400,
      );
    }
    const page = cursor === "" ? 1 : Number(cursor);
    if (!Number.isInteger(page) || page < 1) {
      throw companionError(
        "IMMICH_COMPANION_CURSOR_INVALID",
        "Immich asset page cursor is invalid",
        400,
      );
    }
    const normalizedUpdatedAfter = String(updatedAfter || "").trim();
    if (
      normalizedUpdatedAfter &&
      Number.isNaN(Date.parse(normalizedUpdatedAfter))
    ) {
      throw companionError(
        "IMMICH_COMPANION_UPDATED_AFTER_INVALID",
        "Immich updatedAfter value is invalid",
        400,
      );
    }

    let result;
    try {
      result = await requestJson("/search/metadata", {
        method: "POST",
        body: {
          order: "asc",
          page,
          size: normalizedLimit,
          visibility: normalizedVisibility,
          withDeleted: false,
          withExif: false,
          withPeople: false,
          withStacked: false,
          ...(normalizedUpdatedAfter
            ? { updatedAfter: new Date(normalizedUpdatedAfter).toISOString() }
            : {}),
        },
      });
    } catch (error) {
      if (
        normalizedVisibility === "locked" &&
        error?.code === "IMMICH_COMPANION_ELEVATED_REQUIRED"
      ) {
        return {
          schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
          immichVersion: receipt.immichVersion,
          visibility: normalizedVisibility,
          accessState: "elevated_session_required",
          items: [],
          nextCursor: null,
        };
      }
      throw error;
    }
    if (!result?.assets || !Array.isArray(result.assets.items)) {
      throw companionError(
        "IMMICH_COMPANION_PROTOCOL_INVALID",
        "Immich asset search response is invalid",
        502,
      );
    }
    return {
      schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
      immichVersion: receipt.immichVersion,
      visibility: normalizedVisibility,
      items: result.assets.items.map(projectImmichAsset),
      nextCursor:
        result.assets.nextPage == null
          ? null
          : requiredText(result.assets.nextPage, "assets.nextPage"),
    };
  };

  const readAssetImage = async ({ assetId }) => {
    const projection = await getAsset({ assetId });
    if (projection.asset.assetType !== "image") {
      throw companionError(
        "IMMICH_COMPANION_MEDIA_UNSUPPORTED",
        "Face detection currently accepts still images only",
        415,
      );
    }
    if (projection.asset.isOffline || projection.asset.isTrashed) {
      throw companionError(
        "IMMICH_COMPANION_MEDIA_UNAVAILABLE",
        "Immich original image is not currently available",
        409,
      );
    }
    const media = await requestImageBytes(projection.asset.immichAssetId);
    return {
      schemaVersion: IMMICH_COMPANION_SCHEMA_VERSION,
      asset: projection.asset,
      byteLength: media.byteLength,
      bytes: media.bytes,
      contentDigest: media.contentDigest,
      immichVersion: projection.immichVersion,
      mimeType: media.mimeType || projection.asset.originalMimeType,
      sourceAccess: "immich-api-read-only",
    };
  };

  return {
    getAsset,
    getPerson,
    listAssetFaces,
    listAssets,
    listPeople,
    readAssetImage,
    status,
    verifyOnboardingPermissions,
  };
};
