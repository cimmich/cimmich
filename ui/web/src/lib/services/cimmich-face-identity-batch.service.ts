import type { CimmichFaceIdentityResult } from './cimmich.service';

export type CimmichFaceIdentitySelector = { newPersonName: string } | { personId: string } | { personName: string };

export type CimmichFaceIdentityBatchResult = {
  assigned: CimmichFaceIdentityResult[];
  assignedCount: number;
  changed: boolean;
  failureCount: number;
  failures: Array<{ code: string | null; error: string; faceId: string; statusCode: number }>;
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
