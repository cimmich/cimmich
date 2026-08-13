import { bridgeFields } from "./bridge-fields.mjs";

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

export const schemaVersion = "cimmich.person-projection-page.v1";

export const cleanPageSize = (value, fallback = 120, maximum = 250) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw typedError(
      `pageSize must be an integer from 1 to ${maximum}`,
      400,
      "PERSON_PAGE_SIZE_INVALID",
    );
  }
  return parsed || fallback;
};

export const encodeCursor = (payload) =>
  Buffer.from(JSON.stringify({ ...payload, v: 1 }), "utf8").toString(
    "base64url",
  );

export const decodeCursor = (value, { kind, personId, visibleRank }) => {
  if (!value) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8"),
    );
    if (
      payload?.v !== 1 ||
      payload?.kind !== kind ||
      payload?.personId !== personId ||
      payload?.visibleRank !== visibleRank
    ) {
      throw new Error("cursor scope mismatch");
    }
    const captureTimeValid =
      payload.captureTime === null ||
      (typeof payload.captureTime === "string" &&
        Number.isFinite(Date.parse(payload.captureTime)));
    const keyValid = kind.startsWith("assets")
      ? typeof payload.assetId === "string" && payload.assetId.length > 0
      : typeof payload.faceId === "string" &&
        payload.faceId.length > 0 &&
        (payload.quality === null || Number.isFinite(payload.quality));
    if (!captureTimeValid || !keyValid) {
      throw new Error("cursor key invalid");
    }
    return payload;
  } catch {
    throw typedError(
      "Person projection cursor is invalid for this Person or viewing mode",
      400,
      "PERSON_PAGE_CURSOR_INVALID",
    );
  }
};

export const projectPersonAssetRow = ({ bridge, row: input }) => {
  const {
    body_candidate_count: _bodyCandidateCount,
    confirmed_body_count: _confirmedBodyCount,
    head_count: _headCount,
    presence_count: _presenceCount,
    total_count: _totalCount,
    ...row
  } = input;
  return {
    ...row,
    association_types: [
      ...(row.has_face ? ["face"] : []),
      ...(row.has_head ? ["head"] : []),
      ...((row.has_body || row.has_body_hint_face) &&
      !row.has_face &&
      !row.has_head
        ? ["body"]
        : []),
      ...(row.has_body_candidate &&
      !row.has_face &&
      !row.has_head &&
      !row.has_body &&
      !row.has_body_hint_face
        ? ["body_candidate"]
        : []),
      ...(row.has_presence &&
      !row.has_face &&
      !row.has_head &&
      !row.has_body &&
      !row.has_body_candidate
        ? ["presence"]
        : []),
    ],
    contexts: Array.isArray(row.contexts) ? row.contexts : [],
    labels: Array.isArray(row.labels) ? row.labels : [],
    ...bridgeFields(bridge, row.asset_id),
  };
};

export const projectPersonAssetSummary = (row) => ({
  body: Number(row?.confirmed_body_count || 0),
  bodyCandidate: Number(row?.body_candidate_count || 0),
  head: Number(row?.head_count || 0),
  presence: Number(row?.presence_count || 0),
  total: Number(row?.total_count || 0),
});

export const projectIdentityFaceRow = ({ bridge, identityQcFields, row }) => {
  const mainBucket = row.buckets.find((bucket) =>
    ["head", "lq", "prime", "secondary"].includes(bucket.bucket_kind),
  );
  return {
    ...row,
    // A Face without a gallery bucket is still Supporting identity evidence;
    // matcher membership remains an independent nullable fact.
    main_evidence_tier: mainBucket?.bucket_kind || "secondary",
    matching_reference_tier: mainBucket?.bucket_kind || null,
    ...identityQcFields(row),
    ...bridgeFields(bridge, row.asset_id),
  };
};
