export type CimmichFaceMatch = {
  display_name: string;
  person_id: string;
  prime_score: number;
  rank: number;
  reference_face_id?: string;
  secondary_score?: number | null;
};

export type CimmichFaceOwnerReviewMatch = Omit<CimmichFaceMatch, 'prime_score'> & {
  accepted_example_count: number;
  current_identity: boolean;
  prime_score: number | null;
  score_kind: 'cosine_similarity' | null;
  similarity: number | null;
  unavailable_reason: 'no_independent_compatible_reference_face' | null;
};

export type CimmichFaceOwnerReviewMatchBatch = {
  automaticIdentityAuthority: 'none';
  bulkAutomationAuthority: 'none';
  items: { faceId: string; matches: CimmichFaceOwnerReviewMatch[] }[];
  limitPerFace: number;
  recommendationAuthority: 'none';
  requestedCount: number;
  reviewOnly: true;
  schemaVersion: 'cimmich.face-owner-review-comparisons-batch.v1';
};

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

export const createFaceReviewComparisonClient = (request: Request) => ({
  async getFaceMatches(faceId: string, limit = 5) {
    const boundedLimit = Math.max(1, Math.min(12, limit));
    const result = await request<{ items: CimmichFaceOwnerReviewMatch[] }>(
      `/v1/faces/${encodeURIComponent(faceId)}/matches?limit=${boundedLimit}`,
    );
    return result.items.slice(0, boundedLimit);
  },
  getFaceMatchesBatch(faceIds: string[], limitPerFace = 5) {
    return request<CimmichFaceOwnerReviewMatchBatch>('/v1/faces/matches:batch', {
      body: JSON.stringify({ faceIds, limitPerFace }),
      method: 'POST',
    });
  },
});
