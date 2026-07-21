import { createHash } from "node:crypto";

export const publicDemoArchiveSchemaVersion = "cimmich.public-demo-archive.v1";
export const publicDemoImmichMapSchemaVersion =
  "cimmich.public-demo-immich-map.v1";
export const publicDemoSeedSchemaVersion = "cimmich.public-demo-seed.v1";

const typedError = (message, code = "PUBLIC_DEMO_INPUT_INVALID") =>
  Object.assign(new Error(message), { code });

export const digest = (value) =>
  createHash("sha256").update(String(value)).digest("hex");

const requiredText = (value, label, maximum = 4000) => {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum) {
    throw typedError(`${label} is required`);
  }
  return normalized;
};

const requiredDigest = (value, label) => {
  const normalized = requiredText(value, label, 64);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw typedError(`${label} must be a lowercase SHA-256`);
  }
  return normalized;
};

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\u001f") !== wanted.join("\u001f")) {
    throw typedError(`${label} has unsupported fields`);
  }
};

export const parseCsv = (source) => {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const text = String(source).replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      if (row.some((field) => field.length > 0)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw typedError("CSV contains an unterminated quote");
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ""));
    if (row.some((field) => field.length > 0)) rows.push(row);
  }
  if (rows.length < 2) throw typedError("CSV must contain a header and rows");
  const header = rows[0];
  if (new Set(header).size !== header.length || header.some((key) => !key)) {
    throw typedError("CSV header is invalid");
  }
  return rows.slice(1).map((fields, index) => {
    if (fields.length !== header.length) {
      throw typedError(`CSV row ${index + 2} has the wrong field count`);
    }
    return Object.fromEntries(header.map((key, field) => [key, fields[field]]));
  });
};

const splitList = (value) =>
  String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

const assetSequence = (assetId) => {
  const match = /^CHA-(\d{3})$/.exec(String(assetId));
  if (!match) throw typedError(`Unsupported public demo asset ID: ${assetId}`);
  return Number.parseInt(match[1], 10);
};

const stableId = (prefix, value) => `${prefix}_${digest(value).slice(0, 32)}`;
const stableAssetId = (publicAssetId) =>
  `demo_asset_${publicAssetId.toLowerCase().replaceAll("-", "_")}`;

export const captureTimeFor = (sequence) => {
  const chapterStarts = [
    [1, "2020-03-14"],
    [9, "2020-04-18"],
    [21, "2022-07-15"],
    [31, "2024-07-25"],
    [39, "2025-10-04"],
    [46, "2025-10-11"],
  ];
  let selected = chapterStarts[0];
  for (const candidate of chapterStarts) {
    if (sequence >= candidate[0]) selected = candidate;
  }
  const offset = sequence - selected[0];
  const date = new Date(`${selected[1]}T10:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString();
};

export const publicDemoGpsForAsset = (publicAssetId) => {
  const sequence = assetSequence(publicAssetId);
  let center = null;
  if (sequence === 4) center = { latitude: -33.839, longitude: 151.227 };
  else if (sequence <= 20 || (sequence >= 31 && sequence <= 38))
    center = { latitude: -33.86, longitude: 151.2 };
  else if ((sequence >= 21 && sequence <= 30) || sequence === 51)
    center = { latitude: -33.55, longitude: 151.314 };
  else if (sequence >= 39 && sequence <= 45)
    center = { latitude: -33.846, longitude: 151.218 };
  if (!center) return null;
  const latitudeOffset = (((sequence * 17) % 9) - 4) * 0.00022;
  const longitudeOffset = (((sequence * 29) % 9) - 4) * 0.00025;
  return {
    latitude: Number((center.latitude + latitudeOffset).toFixed(6)),
    longitude: Number((center.longitude + longitudeOffset).toFixed(6)),
  };
};

const contextCatalog = [
  ["Cedar House", "place", "point", null, "CHA-020"],
  ["Bluewater Beach", "place", "area", null, "CHA-023"],
  ["Willow Community Garden", "place", "point", null, "CHA-039"],
  ["Northside Workshop", "place", "point", null, "CHA-004"],
  ["Ruby", "object", null, "vehicle", "CHA-021"],
  ["Moss", "object", null, "equipment", "CHA-019"],
  ["Sunbeam", "object", null, "equipment", "CHA-024"],
  ["Star Quilt", "object", null, "collectible", "CHA-015"],
  ["Cedar House Years", "event", null, "life_period", "CHA-020"],
  ["Bluewater Weekend", "event", null, "trip", "CHA-023"],
  ["Nora's 70th Birthday", "event", null, "event", "CHA-032"],
  ["Saturday Garden Crew", "event", null, "activity", "CHA-039"],
];

const personCatalog = [
  ["Maya", "Maya Chen", "person", "CHA-001"],
  ["Alex", "Alex Okafor", "person", "CHA-002"],
  ["Nora", "Nora Chen", "person", "CHA-003"],
  ["Theo", "Theo Chen", "person", "CHA-004"],
  ["Samira", "Samira Patel", "person", "CHA-005"],
  ["Eli", "Eli Okafor-Chen", "person", "CHA-006"],
  ["Pixel", "Pixel", "pet", "CHA-007"],
  ["Juniper", "Juniper", "pet", "CHA-008"],
];

const geometryCatalog = [
  ["face", "CHA-035", "Samira", { x: 0.05, y: 0.17, w: 0.24, h: 0.45 }],
  ["head", "CHA-025", "Samira", { x: 0.16, y: 0.02, w: 0.61, h: 0.43 }],
  ["body", "CHA-034", "Maya", { x: 0.19, y: 0.05, w: 0.55, h: 0.9 }],
  ["presence", "CHA-018", "Juniper", { x: 0.55, y: 0.35, w: 0.39, h: 0.6 }],
];

const documentCatalog = [
  ["CHA-046", "Bluewater Weekend itinerary", "booking", "standard"],
  ["CHA-047", "Juniper vaccination record", "vaccination", "private"],
  ["CHA-048", "Ruby repair receipt", "receipt", "personal"],
  ["CHA-049", "Nora's citrus cake recipe", "other", "personal"],
  ["CHA-050", "Nora's 70th birthday invitation", "correspondence", "standard"],
];

const contextGeometry = (name, placeKind) => {
  if (placeKind === "area") {
    return { east: 151.327, north: -33.541, south: -33.559, west: 151.301 };
  }
  if (placeKind === "point") {
    const index = contextCatalog.findIndex(([label]) => label === name);
    return {
      latitude: -33.86 + index * 0.007,
      longitude: 151.2 + index * 0.009,
    };
  }
  return null;
};

export const buildPublicDemoPlan = ({
  manifestCsv,
  shotLedgerCsv,
  immichMap,
}) => {
  exactKeys(
    immichMap,
    [
      "archiveDigest",
      "assets",
      "generatedAt",
      "immichVersion",
      "principalDigest",
      "schemaVersion",
      "source",
    ],
    "immichMap",
  );
  if (immichMap.schemaVersion !== publicDemoImmichMapSchemaVersion) {
    throw typedError("Immich map schema is unsupported");
  }
  if (immichMap.source !== "immich_api_upload") {
    throw typedError("Public demo requires an explicit Immich API upload map");
  }
  const principalDigest = requiredDigest(
    immichMap.principalDigest,
    "principalDigest",
  );
  const archiveDigest = requiredDigest(
    immichMap.archiveDigest,
    "archiveDigest",
  );
  const immichVersion = requiredText(
    immichMap.immichVersion,
    "immichVersion",
    40,
  );
  if (!/^3\./.test(immichVersion)) {
    throw typedError("Public demo currently requires supported Immich 3.x");
  }
  const manifestRows = parseCsv(manifestCsv);
  const shotRows = parseCsv(shotLedgerCsv);
  if (manifestRows.length !== 51 || shotRows.length !== 51) {
    throw typedError("The Cedar House V1 archive must contain exactly 51 rows");
  }
  const manifestById = new Map(manifestRows.map((row) => [row.asset_id, row]));
  const shotById = new Map(shotRows.map((row) => [row.asset_id, row]));
  const mapById = new Map(
    immichMap.assets.map((row) => {
      exactKeys(
        row,
        [
          "assetId",
          "checksum",
          "height",
          "immichAssetId",
          "inputRevision",
          "sourceUpdatedAt",
          "width",
        ],
        "immichMap.assets[]",
      );
      return [row.assetId, row];
    }),
  );
  if (mapById.size !== 51)
    throw typedError("Immich map must contain 51 unique assets");

  const assets = [];
  for (let sequence = 1; sequence <= 51; sequence += 1) {
    const publicAssetId = `CHA-${String(sequence).padStart(3, "0")}`;
    const manifest = manifestById.get(publicAssetId);
    const shot = shotById.get(publicAssetId);
    const upstream = mapById.get(publicAssetId);
    if (!manifest || !shot || !upstream) {
      throw typedError(`Public demo mapping is incomplete at ${publicAssetId}`);
    }
    if (
      manifest.synthetic !== "true" ||
      manifest.visual_qa !== "accepted by human visual inspection"
    ) {
      throw typedError(`${publicAssetId} is not accepted synthetic media`);
    }
    const sha256 = requiredDigest(manifest.sha256, `${publicAssetId}.sha256`);
    if (
      requiredDigest(upstream.checksum, `${publicAssetId}.checksum`) !== sha256
    ) {
      throw typedError(`${publicAssetId} checksum does not match the archive`);
    }
    const width = Number.parseInt(manifest.width, 10);
    const height = Number.parseInt(manifest.height, 10);
    if (
      upstream.width !== width ||
      upstream.height !== height ||
      width < 1 ||
      height < 1
    ) {
      throw typedError(`${publicAssetId} dimensions do not match the archive`);
    }
    assets.push({
      assetId: stableAssetId(publicAssetId),
      captureTime: captureTimeFor(assetSequence(publicAssetId)),
      chapter: manifest.chapter,
      contexts: splitList(manifest.contexts),
      filename: requiredText(
        manifest.filename,
        `${publicAssetId}.filename`,
        255,
      ),
      height,
      immichAssetId: requiredText(
        upstream.immichAssetId,
        `${publicAssetId}.immichAssetId`,
        200,
      ),
      inputRevision: requiredDigest(
        upstream.inputRevision,
        `${publicAssetId}.inputRevision`,
      ),
      publicAssetId,
      sha256,
      sourceUpdatedAt: requiredText(
        upstream.sourceUpdatedAt,
        `${publicAssetId}.sourceUpdatedAt`,
        80,
      ),
      subjects: splitList(manifest.subjects),
      title: requiredText(shot.title, `${publicAssetId}.title`, 240),
      visibility: requiredText(
        shot.visibility,
        `${publicAssetId}.visibility`,
        20,
      ),
      width,
    });
  }
  if (
    assets.some(
      (asset) =>
        !["standard", "personal", "private"].includes(asset.visibility),
    )
  ) {
    throw typedError("Shot visibility must be standard, personal or private");
  }

  const assetByPublicId = new Map(
    assets.map((asset) => [asset.publicAssetId, asset]),
  );
  const people = personCatalog.map(
    ([shortName, displayName, subjectKind, cover]) => ({
      coverAssetId: assetByPublicId.get(cover).assetId,
      displayName,
      personId: stableId("person", `cedar-house:${shortName}`),
      shortName,
      subjectKind,
    }),
  );
  const personByShortName = new Map(
    people.map((person) => [person.shortName, person]),
  );
  for (const asset of assets) {
    for (const subject of asset.subjects) {
      if (!personByShortName.has(subject)) {
        throw typedError(`${asset.publicAssetId} names an unknown subject`);
      }
    }
  }

  const contexts = contextCatalog.map(
    ([displayName, entityKind, placeKind, subtype, coverPublicAssetId]) => ({
      coverAssetId: assetByPublicId.get(coverPublicAssetId).assetId,
      displayName,
      entityId: stableId(
        entityKind,
        `cedar-house:${entityKind}:${displayName}`,
      ),
      entityKind,
      eventKind: entityKind === "event" ? subtype : null,
      geometry: contextGeometry(displayName, placeKind),
      objectKind: entityKind === "object" ? subtype : null,
      placeKind: entityKind === "place" ? placeKind : null,
    }),
  );
  const contextByName = new Map(
    contexts.map((context) => [context.displayName, context]),
  );
  for (const asset of assets) {
    for (const context of asset.contexts) {
      if (!contextByName.has(context)) {
        throw typedError(
          `${asset.publicAssetId} names an unknown context: ${context}`,
        );
      }
    }
  }

  const manualTags = geometryCatalog.map(
    ([tagType, publicAssetId, shortName, geometry]) => {
      const asset = assetByPublicId.get(publicAssetId);
      const subject = personByShortName.get(shortName);
      return {
        assetId: asset.assetId,
        decisionId: stableId("decision", `cedar-house:manual:${tagType}`),
        geometry,
        observationId: stableId(
          tagType === "head" ? "head" : tagType,
          `cedar-house:manual:${tagType}`,
        ),
        operationId: stableId(
          "manual_operation",
          `cedar-house:manual:${tagType}`,
        ),
        publicAssetId,
        subjectId: subject.personId,
        subjectKind: subject.subjectKind,
        tagId: stableId("manual_tag", `cedar-house:manual:${tagType}`),
        tagType,
      };
    },
  );

  const documents = documentCatalog.map(
    ([publicAssetId, title, documentKind, visibility]) => {
      const asset = assetByPublicId.get(publicAssetId);
      return {
        assetId: asset.assetId,
        documentId: stableId("document", `cedar-house:${publicAssetId}`),
        documentKind,
        filename: asset.filename,
        publicAssetId,
        sha256: asset.sha256,
        title,
        visibility,
      };
    },
  );

  const seedProjection = {
    archiveDigest,
    assets: assets.map(
      ({ assetId, immichAssetId, publicAssetId, sha256, visibility }) => ({
        assetId,
        immichAssetId,
        publicAssetId,
        sha256,
        visibility,
      }),
    ),
    contexts: contexts.map(({ displayName, entityId, entityKind }) => ({
      displayName,
      entityId,
      entityKind,
    })),
    documents: documents.map(({ documentId, publicAssetId, visibility }) => ({
      documentId,
      publicAssetId,
      visibility,
    })),
    manualTags: manualTags.map(({ publicAssetId, subjectId, tagType }) => ({
      publicAssetId,
      subjectId,
      tagType,
    })),
    people: people.map(({ displayName, personId, subjectKind }) => ({
      displayName,
      personId,
      subjectKind,
    })),
  };
  return {
    archiveDigest,
    assets,
    contexts,
    documents,
    immichVersion,
    manualTags,
    people,
    principalDigest,
    schemaVersion: publicDemoSeedSchemaVersion,
    seedDigest: digest(JSON.stringify(seedProjection)),
  };
};
