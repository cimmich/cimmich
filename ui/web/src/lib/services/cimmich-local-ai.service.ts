import { CimmichServiceError, cimmichRequestContext, request } from './cimmich.service';

export type CimmichLocalAiOperation = 'best' | 'bodies' | 'context' | 'faces' | 'poses' | 'quick' | 'scene-text';

export type CimmichLocalAiStatus = {
  capabilities: {
    best: boolean;
    bodies: boolean;
    context: boolean;
    faces: boolean;
    poses: boolean;
    quick: boolean;
    sceneText: boolean;
  };
  enabled: boolean;
  limits: {
    maxAssets: number;
    maxConcurrentJobs: number;
    maxQueuedJobs: number;
    maxRetainedRuns: number;
    maxStoreBytes: number;
  };
  originals: 'read-only';
  reviewRequired: true;
  schemaVersion: 'cimmich.local-ai-jobs.v1';
  state: 'disabled' | 'ready' | 'unavailable';
};

export type CimmichLocalAiJob = {
  artifactTokens: string[];
  completedAt: string | null;
  createdAt: string;
  error: { code: string; message: string } | null;
  jobId: string;
  operation: CimmichLocalAiOperation;
  progress: {
    completedAssets: number;
    model?: {
      completedTiles?: number;
      completedUnits: number;
      operation: 'best' | 'quick';
      stage: string;
      totalTiles?: number;
      totalUnits: number;
    };
    phase: string;
    totalAssets: number;
  };
  result: {
    assets: Array<{
      assetId: string;
      baselineComparison?: {
        bodies?: { added: unknown[]; removed: unknown[] } | null;
        faces?: { added: unknown[]; removed: unknown[] } | null;
      } | null;
      operations?: {
        bodies?: { bodies?: unknown[]; errorCode?: string; message?: string; state: string };
        faces?: { faces?: unknown[]; errorCode?: string; message?: string; state: string };
        poses?: {
          errorCode?: string;
          message?: string;
          poses?: Array<{
            association?: { state?: 'ambiguous' | 'supported' | 'unmatched' };
            reliableKeypointCount?: number;
          }>;
          state: string;
        };
      };
    }>;
    originalsUnchanged: boolean;
    state: string;
    summary?: { state: string; text: string };
  } | null;
  schemaVersion: 'cimmich.local-ai-jobs.v1';
  sourceAssetIds: string[];
  state: 'cancelled' | 'completed' | 'failed' | 'partial' | 'queued' | 'running';
};

export const getCimmichLocalAiStatus = () => request<CimmichLocalAiStatus>('/v1/local-ai');

export const startCimmichLocalAiJob = (operation: CimmichLocalAiOperation, sourceAssetIds: string[]) =>
  request<CimmichLocalAiJob>('/v1/local-ai/jobs', {
    body: JSON.stringify({ operation, sourceAssetIds }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichLocalAiJob = (jobId: string) =>
  request<CimmichLocalAiJob>(`/v1/local-ai/jobs/${encodeURIComponent(jobId)}`);

export const cancelCimmichLocalAiJob = (jobId: string) =>
  request<CimmichLocalAiJob>(`/v1/local-ai/jobs/${encodeURIComponent(jobId)}`, {
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'DELETE',
  });

export const getCimmichLocalAiArtifact = async (jobId: string, token: string, signal?: AbortSignal) => {
  const context = cimmichRequestContext();
  const response = await fetch(
    `${context.apiRoot}/v1/local-ai/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(token)}`,
    { headers: context.headers, signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]) },
  );
  if (!response.ok) {
    let body: { code?: string; error?: string } | undefined;
    try {
      body = (await response.json()) as { code?: string; error?: string };
    } catch {
      body = undefined;
    }
    throw new CimmichServiceError(body?.error || 'Local AI preview could not be loaded', {
      code: body?.code || 'LOCAL_AI_ARTIFACT_FAILED',
      status: response.status,
    });
  }
  return response.blob();
};
