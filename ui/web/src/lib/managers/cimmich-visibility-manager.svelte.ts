import { shouldApplyViewingModeResponse } from './cimmich-visibility-intent';

class CimmichVisibilityManager {
  version = $state(0);
  undoDecisions = $state<Record<string, string>>({});
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

  notify() {
    this.version += 1;
  }
}

export const cimmichVisibilityManager = new CimmichVisibilityManager();
