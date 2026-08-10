import { mkdir, opendir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { digest, fileDigest, setSchema } from "./contract.mjs";

const typedError = (message, code = "LOCAL_AI_ARCHIVE_PILOT_INVALID") =>
  Object.assign(new Error(message), { code });

const parseTsv = async (path) => {
  const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
  const fields = lines.shift()?.split("\t") ?? [];
  return lines.filter(Boolean).map((line) =>
    Object.fromEntries(
      line.split("\t").map((value, index) => [
        fields[index],
        value === "\\N" ? null : value,
      ]),
    ),
  );
};

const parseCaptureTime = (value) => {
  if (!value) return null;
  const normalized = value
    .replace(" ", "T")
    .replace(/([+-]\d\d)$/, "$1:00");
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? null : date;
};

const normalizedBox = (row) => ({
  h: Number(row.box_h),
  w: Number(row.box_w),
  x: Number(row.box_x),
  y: Number(row.box_y),
});

const addGrouped = (map, key, value) => {
  const rows = map.get(key) ?? [];
  rows.push(value);
  map.set(key, rows);
};

const indexPreviews = async (root) => {
  const previews = new Map();
  const visit = async (directory) => {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith("_preview.jpeg")) {
        previews.set(entry.name.slice(0, -"_preview.jpeg".length), path);
      }
    }
  };
  await visit(root);
  return previews;
};

const atomicPrivateJson = async (path, value) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

export const buildArchivePilot = async ({
  importsRoot,
  limit = 12,
  maximumGapSeconds = 600,
  outputRoot,
  thumbRoot,
}) => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw typedError("limit must be an integer from 1 to 100");
  if (
    !Number.isSafeInteger(maximumGapSeconds) ||
    maximumGapSeconds < 0 ||
    maximumGapSeconds > 86_400
  )
    throw typedError("maximum gap must be an integer from 0 to 86400 seconds");
  importsRoot = resolve(importsRoot);
  thumbRoot = resolve(thumbRoot);
  outputRoot = resolve(outputRoot);
  const paths = Object.fromEntries(
    [
      "asset.tsv",
      "body_observation.tsv",
      "display_bridge.json",
      "face_observation.tsv",
      "identity_claim.tsv",
    ].map((name) => [name, join(importsRoot, name)]),
  );
  const [assets, bodies, bridge, faces, claims, previews, sourceDigests] =
    await Promise.all([
      parseTsv(paths["asset.tsv"]),
      parseTsv(paths["body_observation.tsv"]),
      readFile(paths["display_bridge.json"], "utf8").then(JSON.parse),
      parseTsv(paths["face_observation.tsv"]),
      parseTsv(paths["identity_claim.tsv"]),
      indexPreviews(thumbRoot),
      Promise.all(
        Object.entries(paths).map(async ([name, path]) => [
          name,
          await fileDigest(path),
        ]),
      ).then(Object.fromEntries),
    ]);
  if (!Array.isArray(bridge.assets))
    throw typedError("display bridge is invalid");

  const sourceByAsset = new Map(
    bridge.assets.map(({ assetId, sourceAssetId }) => [assetId, sourceAssetId]),
  );
  const acceptedSubjectsByFace = new Map();
  for (const claim of claims) {
    if (claim.state !== "accepted") continue;
    const subjects = acceptedSubjectsByFace.get(claim.face_id) ?? new Set();
    subjects.add(claim.person_id);
    acceptedSubjectsByFace.set(claim.face_id, subjects);
  }
  const acceptedByFace = new Map(
    [...acceptedSubjectsByFace].flatMap(([faceId, subjects]) =>
      subjects.size === 1 ? [[faceId, [...subjects][0]]] : [],
    ),
  );
  const facesByAsset = new Map();
  for (const face of faces) {
    if (face.state !== "valid") continue;
    addGrouped(facesByAsset, face.asset_id, {
      box: normalizedBox(face),
      observationId: face.face_id,
      ...(acceptedByFace.get(face.face_id)
        ? { subject: acceptedByFace.get(face.face_id) }
        : {}),
    });
  }
  const bodiesByAsset = new Map();
  for (const body of bodies) {
    if (body.state !== "valid") continue;
    addGrouped(bodiesByAsset, body.asset_id, {
      box: normalizedBox(body),
      observationId: body.body_id,
    });
  }

  const ordered = assets
    .filter((asset) => asset.media_kind === "image" && asset.state === "active")
    .map((asset) => {
      const capture = parseCaptureTime(asset.capture_time);
      const sourceAssetId = sourceByAsset.get(asset.asset_id);
      const championFaces = facesByAsset.get(asset.asset_id) ?? [];
      return {
        assetId: asset.asset_id,
        bodies: bodiesByAsset.get(asset.asset_id) ?? [],
        capture,
        faces: championFaces,
        path: sourceAssetId ? previews.get(sourceAssetId) : null,
        subjects: [
          ...new Set(
            championFaces.map(({ subject }) => subject).filter(Boolean),
          ),
        ],
      };
    })
    .filter(({ capture }) => capture)
    .sort(
      (left, right) =>
        left.capture - right.capture ||
        left.assetId.localeCompare(right.assetId),
    );

  const candidates = [];
  for (let index = 1; index < ordered.length - 1; index += 1) {
    const left = ordered[index - 1];
    const middle = ordered[index];
    const right = ordered[index + 1];
    if (
      middle.subjects.length ||
      middle.bodies.length !== 1 ||
      !left.path ||
      !middle.path ||
      !right.path
    )
      continue;
    const shared = left.subjects.filter((subject) =>
      right.subjects.includes(subject),
    );
    if (shared.length !== 1) continue;
    const leftGapSeconds = (middle.capture - left.capture) / 1000;
    const rightGapSeconds = (right.capture - middle.capture) / 1000;
    if (
      leftGapSeconds < 0 ||
      rightGapSeconds < 0 ||
      leftGapSeconds > maximumGapSeconds ||
      rightGapSeconds > maximumGapSeconds
    )
      continue;
    candidates.push({
      left,
      leftGapSeconds,
      middle,
      right,
      rightGapSeconds,
      subject: shared[0],
    });
  }
  candidates.sort(
    (left, right) =>
      left.leftGapSeconds + left.rightGapSeconds -
        (right.leftGapSeconds + right.rightGapSeconds) ||
      left.middle.assetId.localeCompare(right.middle.assetId),
  );

  await mkdir(outputRoot, { mode: 0o700 });
  const selected = candidates.slice(0, limit);
  const receiptCases = [];
  for (const [index, candidate] of selected.entries()) {
    const caseNumber = String(index + 1).padStart(3, "0");
    const set = {
      assets: [candidate.left, candidate.middle, candidate.right].map(
        (asset) => ({
          acceptedSubjects: asset.subjects,
          assetId: asset.assetId,
          baselineObservations: { bodies: asset.bodies, faces: asset.faces },
          captureTime: asset.capture.toISOString(),
          path: asset.path,
        }),
      ),
      contextKind:
        candidate.leftGapSeconds === 0 && candidate.rightGapSeconds === 0
          ? "same_moment"
          : candidate.leftGapSeconds <= 60 && candidate.rightGapSeconds <= 60
            ? "rapid_burst"
            : "sequence",
      schemaVersion: setSchema,
      setId: `archive-context-pilot-${caseNumber}`,
    };
    const setPath = join(outputRoot, `context-${caseNumber}.json`);
    await atomicPrivateJson(setPath, set);
    receiptCases.push({
      assetIds: set.assets.map(({ assetId }) => assetId),
      contextKind: set.contextKind,
      expectedSubject: candidate.subject,
      leftGapSeconds: candidate.leftGapSeconds,
      rightGapSeconds: candidate.rightGapSeconds,
      setDigest: digest(set),
      setPath: relative(outputRoot, setPath),
    });
  }
  const receipt = {
    candidateCount: candidates.length,
    cases: receiptCases,
    generatedAt: new Date().toISOString(),
    maximumGapSeconds,
    schemaVersion: "cimmich.local-ai-archive-context-pilot.v1",
    selectedCount: selected.length,
    sourceProjectionDigests: sourceDigests,
    state: selected.length ? "ready" : "empty",
  };
  await atomicPrivateJson(join(outputRoot, "index.json"), receipt);
  return { outputRoot, receipt };
};

export const buildArchivePilotFromFiles = (input) => buildArchivePilot(input);
