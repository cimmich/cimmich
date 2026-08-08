import {
  request,
  type CimmichImmichPersonCluster,
  type CimmichImmichPersonResolutionAction,
  type CimmichImmichPersonResolutionResult,
} from './cimmich.service';

export type CimmichPossiblePeopleRun = {
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

type PossiblePersonResolutionResult = CimmichImmichPersonResolutionResult & {
  candidateCount?: number;
};

export const getCimmichPossiblePeople = () => request<CimmichPossiblePeopleSnapshot>('/v1/possible-people');

export const refreshCimmichPossiblePeople = (commandId: string) =>
  request<{ changed: boolean; replayed: boolean; run: CimmichPossiblePeopleRun; schemaVersion: string }>(
    '/v1/possible-people/refresh',
    {
      body: JSON.stringify({ commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const resolveCimmichPossiblePerson = (
  clusterId: string,
  input: {
    action: Extract<CimmichImmichPersonResolutionAction, 'create_person' | 'existing_person' | 'later'>;
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
