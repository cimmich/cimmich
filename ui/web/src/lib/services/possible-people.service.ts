import {
  request,
  type CimmichImmichPersonCluster,
  type CimmichImmichPersonResolutionAction,
  type CimmichImmichPersonResolutionResult,
} from './cimmich.service';

export type CimmichPossiblePeopleRun = {
  classificationState?: 'pending' | 'running' | 'completed' | 'failed';
  classifiedClusterCount?: number;
  clusterCount: number;
  completedAt: string | null;
  createdAt: string;
  edgeCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  processedSeeds: number;
  runId: string;
  startedAt: string | null;
  state: 'queued' | 'running' | 'completed' | 'failed';
  totalSeeds: number;
};

export type CimmichPossiblePeopleSnapshot = {
  activeRun: CimmichPossiblePeopleRun | null;
  clusters: CimmichImmichPersonCluster[];
  completedRun: CimmichPossiblePeopleRun | null;
  schemaVersion: 'cimmich.possible-people-snapshot.v1';
};

export type CimmichPossiblePersonPreview = {
  box: { h: number; w: number; x: number; y: number };
  faceId: string;
  height: number | null;
  membershipScore: number | null;
  sourceAssetId: string;
  width: number | null;
};

export type CimmichKnownPersonClusterSuggestion = {
  clusterId: string;
  evidence: CimmichImmichPersonCluster['evidence'];
  faceCount: number;
  match: {
    classificationVersion: string;
    leadScore: number;
    margin: number | null;
    referenceFaceId: string | null;
    runnerPersonId: string | null;
    runnerScore: number | null;
  };
  representative: {
    box: { h: number; w: number; x: number; y: number };
    faceId: string;
    height: number | null;
    sourceAssetId: string;
    width: number | null;
  };
  previews: CimmichPossiblePersonPreview[];
  snapshotDigest: string;
  sourceRevision: string;
};

type PossiblePersonResolutionResult = CimmichImmichPersonResolutionResult & {
  candidateCount?: number;
  collisionAssetCount?: number;
  collisionFaceCount?: number;
};

export const getCimmichPossiblePeople = () => request<CimmichPossiblePeopleSnapshot>('/v1/possible-people');

export const getCimmichPossiblePersonPreviews = (clusterIds: string[]) => {
  const search = new URLSearchParams();
  for (const clusterId of clusterIds) {
    search.append('clusterId', clusterId);
  }
  return request<{
    items: Array<{ clusterId: string; previews: CimmichPossiblePersonPreview[] }>;
    runId: string | null;
    schemaVersion: 'cimmich.possible-person-previews.v1';
  }>(`/v1/possible-people/previews?${search.toString()}`);
};

export const getCimmichKnownPersonClusterSuggestions = async (personId: string) => {
  const result = await request<{
    items: CimmichKnownPersonClusterSuggestion[];
    schemaVersion: 'cimmich.known-person-cluster-suggestions.v2';
  }>(`/v1/people/${encodeURIComponent(personId)}/possible-clusters`);
  return result.items;
};

export const refreshCimmichPossiblePeople = (commandId: string) =>
  request<{ changed: boolean; replayed: boolean; run: CimmichPossiblePeopleRun; schemaVersion: string }>(
    '/v1/possible-people/refresh',
    {
      body: JSON.stringify({ commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const classifyCimmichPossiblePeople = (commandId: string) =>
  request<{ changed: boolean; replayed: boolean; run: CimmichPossiblePeopleRun; schemaVersion: string }>(
    '/v1/possible-people/classify',
    {
      body: JSON.stringify({ commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const resolveCimmichPossiblePerson = (
  clusterId: string,
  input: {
    action:
      | Extract<CimmichImmichPersonResolutionAction, 'create_person' | 'existing_person' | 'later'>
      | 'not_suggested_person'
      | 'ungroup';
    commandId: string;
    newPersonName?: string;
    personId?: string;
    snapshotDigest: string;
  },
) =>
  request<PossiblePersonResolutionResult>(`/v1/possible-people/${encodeURIComponent(clusterId)}/resolve`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const undoCimmichPossiblePersonResolution = (decisionId: string, commandId: string) =>
  request<CimmichImmichPersonResolutionResult>(`/v1/possible-people/decisions/${encodeURIComponent(decisionId)}/undo`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });
