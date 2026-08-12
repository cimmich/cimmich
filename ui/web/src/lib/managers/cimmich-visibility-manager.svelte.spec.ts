import { beforeEach, describe, expect, it } from 'vitest';
import { cimmichVisibilityManager } from './cimmich-visibility-manager.svelte';

describe('Cimmich visibility manager', () => {
  beforeEach(() => {
    cimmichVisibilityManager.latestViewingModeIntentSequence = 0;
    cimmichVisibilityManager.undoDecisions = {};
    cimmichVisibilityManager.version = 0;
    cimmichVisibilityManager.viewingMode = 'standard';
    cimmichVisibilityManager.visibilityStatusKnown = false;
  });

  it('accepts only the latest viewing-mode response', () => {
    cimmichVisibilityManager.beginViewingModeIntent(4);
    cimmichVisibilityManager.beginViewingModeIntent(2);

    expect(cimmichVisibilityManager.isCurrentViewingModeIntent(4)).toBe(true);
    expect(cimmichVisibilityManager.isCurrentViewingModeIntent(2)).toBe(false);
  });

  it('records and clears scoped Undo decisions without disturbing other objects', () => {
    cimmichVisibilityManager.rememberUndo('asset', 'asset-1', 'decision-1');
    cimmichVisibilityManager.rememberUndo('person', 'person-1', 'decision-2');
    cimmichVisibilityManager.clearUndo('asset', 'asset-1');

    expect(cimmichVisibilityManager.undoDecisions).toEqual({ 'person:person-1': 'decision-2' });
  });

  it('records known visibility status and emits projection revisions', () => {
    cimmichVisibilityManager.recordVisibilityStatus({ viewingMode: 'personal' });
    cimmichVisibilityManager.notify();
    cimmichVisibilityManager.notify();

    expect(cimmichVisibilityManager.viewingMode).toBe('personal');
    expect(cimmichVisibilityManager.visibilityStatusKnown).toBe(true);
    expect(cimmichVisibilityManager.version).toBe(2);
  });
});
