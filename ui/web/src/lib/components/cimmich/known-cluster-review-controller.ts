import type { CimmichIdentityCandidate } from '$lib/services/cimmich.service';
import { createCoalescedReload } from './coalesced-reload';

export type KnownClusterReviewChange = {
  candidateCount: number;
  clusterId: string;
  collisionAssetCount?: number;
  collisionFaceCount?: number;
  kind: 'review' | 'reject' | 'ungroup';
};

type ReviewContext = { generation: number; personId: string; personName: string };

type Options = {
  current: () => ReviewContext | undefined;
  loadCandidates: (personId: string) => Promise<CimmichIdentityCandidate[]>;
  removeCluster: (clusterId: string) => void;
  setCandidates: (candidates: CimmichIdentityCandidate[]) => void;
  setError: (message: string) => void;
  setMessage: (message: string) => void;
};

export const createKnownClusterReviewController = (options: Options) => {
  const isCurrent = (input: ReviewContext) => {
    const current = options.current();
    return current?.generation === input.generation && current.personId === input.personId;
  };
  const reload = createCoalescedReload<ReviewContext, CimmichIdentityCandidate[]>({
    load: ({ personId }) => options.loadCandidates(personId),
    onError: (error, input) => {
      if (isCurrent(input)) {
        options.setError(
          error instanceof Error ? error.message : 'The groups moved, but Cimmich could not reload the Checks queue.',
        );
      }
    },
    onResult: (candidates, input) => {
      if (isCurrent(input)) {
        options.setCandidates(candidates);
      }
    },
  });

  return {
    cancelPending: reload.cancelPending,
    dispose: reload.dispose,
    finish: (change: KnownClusterReviewChange) => {
      options.removeCluster(change.clusterId);
      if (change.kind === 'reject') {
        options.setMessage('This group is no longer suggested for this Person and is available in Possible people.');
        return;
      }
      if (change.kind === 'ungroup') {
        options.setMessage(
          'This exact recurring group was rejected. Its photos remain unassigned and no identity was changed.',
        );
        return;
      }
      const current = options.current();
      if (!current) {
        return;
      }
      options.setError('');
      const collisionAssetCount = change.collisionAssetCount ?? 0;
      const collisionFaceCount = change.collisionFaceCount ?? 0;
      options.setMessage(
        collisionAssetCount > 0
          ? `${change.candidateCount.toLocaleString()} grouped Faces were moved into ${current.personName}’s Checks. ${collisionFaceCount.toLocaleString()} appear in ${collisionAssetCount.toLocaleString()} ${collisionAssetCount === 1 ? 'photo that already contains' : 'photos that already contain'} ${current.personName}, so they are under Multiple in one photo. Nothing was confirmed.`
          : `${change.candidateCount.toLocaleString()} grouped Faces were moved into ${current.personName}’s New matches. Nothing was confirmed.`,
      );
      reload.schedule(current);
    },
  };
};
