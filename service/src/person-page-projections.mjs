import { bridgeFields } from "./bridge-fields.mjs";

export const projectPersonAssetRow = ({ bridge, row: input }) => {
  const {
    body_candidate_count: _bodyCandidateCount,
    confirmed_body_count: _confirmedBodyCount,
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
