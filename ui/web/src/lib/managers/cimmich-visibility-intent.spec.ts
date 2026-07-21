import { describe, expect, it } from 'vitest';
import { isViewingModeStatus, shouldApplyViewingModeResponse } from './cimmich-visibility-intent';

describe('viewing mode intent response ordering', () => {
  it('keeps only the response for the latest invoked user intent', () => {
    const personalSequence = 41;
    const laterStandardSequence = 42;

    expect(shouldApplyViewingModeResponse(personalSequence, laterStandardSequence)).toBe(false);
    expect(shouldApplyViewingModeResponse(laterStandardSequence, laterStandardSequence)).toBe(true);
  });

  it('distinguishes viewing-mode status from object-visibility mutation receipts', () => {
    expect(
      isViewingModeStatus({
        privateAuthorized: false,
        privateConfigured: true,
        viewingMode: 'standard',
      }),
    ).toBe(true);

    expect(
      isViewingModeStatus({
        decisionId: 'visibility-decision-1',
        objects: [{ objectId: 'person-1', objectScope: 'person', visibilityTier: 'personal' }],
        replayed: false,
        schemaVersion: 'cimmich.visibility.v1',
      }),
    ).toBe(false);
  });
});
