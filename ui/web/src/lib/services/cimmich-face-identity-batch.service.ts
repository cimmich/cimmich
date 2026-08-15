import type { CimmichIdentityCandidate } from './cimmich-identity-review-types';
import type { CimmichFaceIdentityResult } from './cimmich.service';

export type CimmichFaceIdentitySelector = { newPersonName: string } | { personId: string } | { personName: string };

export type CimmichFaceIdentityBatchResult = {
  assigned: CimmichFaceIdentityResult[];
  assignedCount: number;
  changed: boolean;
  failureCount: number;
  failures: Array<{ code: string | null; error: string; faceId: string; statusCode: number }>;
  matcherRefreshes: CimmichPersonMatchRefreshResult[];
  matcherRefreshFailures: Array<{ code: string | null; error: string; personId: string }>;
};

export type CimmichPersonMatchRefreshResult = {
  acceptedIdentityDelta: 0;
  automaticIdentityWrites: 0;
  candidateCount: number;
  matcherPhotoCount: number;
  matchedHeadCount: number;
  matchedMistagCount: number;
  personId: string;
  personName: string;
  referenceSetDigest: string;
  reviewedHeadCount: number;
  reviewedMistagCount: number;
  runId: string;
  schemaVersion: 'cimmich.person-match-refresh.v1';
  state: 'complete';
};

type Request = <T>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;

export const createCimmichFaceIdentityBatchClient =
  (request: Request) => (items: Array<{ faceId: string } & CimmichFaceIdentitySelector>) =>
    request<CimmichFaceIdentityBatchResult>(
      '/v1/faces/identity:batch',
      {
        body: JSON.stringify({ items }),
        headers: { 'x-cimmich-actor': 'local-operator' },
        method: 'POST',
      },
      60_000,
    );

export const createCimmichPersonCandidatesClient =
  (request: Request) =>
  async (personId: string, limit = 5000) => {
    const result = await request<{ items: CimmichIdentityCandidate[] }>(
      `/v1/people/${encodeURIComponent(personId)}/candidates?limit=${Math.max(1, Math.min(5000, limit))}`,
    );
    return result.items;
  };

export const createCimmichPersonMatchRefreshClient = (request: Request) => (personId: string) =>
  request<CimmichPersonMatchRefreshResult>(
    `/v1/people/${encodeURIComponent(personId)}/matching/refresh`,
    {
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
    60_000,
  );
