import { createHash } from "node:crypto";

const ASSET_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "OTHER"]);
const VISIBILITIES = new Set(["timeline", "archive", "hidden", "locked"]);

const protocolError = (message) =>
  Object.assign(new Error(message), {
    code: "IMMICH_COMPANION_PROTOCOL_INVALID",
    statusCode: 502,
  });

const requiredText = (value, name) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw protocolError(`Immich response is missing ${name}`);
  return normalized;
};

const optionalText = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const inputRevision = (asset) =>
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

export const projectImmichPerson = (value) => {
  if (!value || typeof value !== "object") {
    throw protocolError("Immich Person response is invalid");
  }
  const id = requiredText(value.id, "person.id");
  // Immich may retain a stable Person/Face grouping before the owner gives the
  // Person a label. That topology is not importable identity truth yet.
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

export const projectImmichAsset = (value, { includePeople = false } = {}) => {
  if (!value || typeof value !== "object") {
    throw protocolError("Immich asset response is invalid");
  }
  const id = requiredText(value.id, "asset.id");
  const ownerId = requiredText(value.ownerId, "asset.ownerId");
  const type = requiredText(value.type, "asset.type");
  if (!ASSET_TYPES.has(type)) {
    throw protocolError("Immich asset type is unsupported");
  }
  const visibility = requiredText(value.visibility, "asset.visibility");
  if (!VISIBILITIES.has(visibility)) {
    throw protocolError("Immich asset visibility is unsupported");
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
  if (includePeople && !Array.isArray(value.people)) {
    throw protocolError("Immich asset response is missing requested People");
  }
  return {
    immichAssetId: id,
    ownerId,
    assetType: type.toLowerCase(),
    visibility,
    checksum,
    createdAt,
    captureTime: fileCreatedAt,
    fileModifiedAt,
    updatedAt,
    localDateTime: optionalText(value.localDateTime),
    originalFileName: optionalText(value.originalFileName),
    originalMimeType: optionalText(value.originalMimeType),
    visualThumbhash: optionalText(value.thumbhash),
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
    inputRevision: inputRevision({
      checksum,
      fileModifiedAt,
      id,
      type,
      updatedAt,
    }),
    ...(includePeople ? { people: value.people.map(projectImmichPerson) } : {}),
  };
};
