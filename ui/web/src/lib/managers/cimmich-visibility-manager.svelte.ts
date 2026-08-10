import { shouldApplyViewingModeResponse } from './cimmich-visibility-intent';

class CimmichVisibilityManager {
  version = $state(0);
  undoDecisions = $state<Record<string, string>>({});
  viewingMode = $state<'personal' | 'private' | 'standard'>('standard');
  visibilityStatusKnown = $state(false);
  latestViewingModeIntentSequence = 0;

  beginViewingModeIntent(intentSequence: number) {
    this.latestViewingModeIntentSequence = Math.max(this.latestViewingModeIntentSequence, intentSequence);
  }

  isCurrentViewingModeIntent(intentSequence: number) {
    return shouldApplyViewingModeResponse(intentSequence, this.latestViewingModeIntentSequence);
  }

  clearUndo(objectScope: string, objectId: string) {
    const key = `${objectScope}:${objectId}`;
    const { [key]: _, ...remaining } = this.undoDecisions;
    this.undoDecisions = remaining;
  }

  rememberUndo(objectScope: string, objectId: string, decisionId: string) {
    this.undoDecisions = {
      ...this.undoDecisions,
      [`${objectScope}:${objectId}`]: decisionId,
    };
  }

  recordVisibilityStatus(status: { viewingMode: 'personal' | 'private' | 'standard' }) {
    this.viewingMode = status.viewingMode;
    this.visibilityStatusKnown = true;
  }

  notify() {
    this.version += 1;
  }
}

export const cimmichVisibilityManager = new CimmichVisibilityManager();
