import { describe, expect, it } from 'vitest';
import { cimmichPlaceAssetSectionNames } from './place-media-section';

const children = [
  { displayName: 'Garage', entityId: 'garage' },
  { displayName: 'Office', entityId: 'office' },
  { displayName: 'Yard', entityId: 'yard' },
];

describe('Place media section presentation', () => {
  it('names the immediate subsection instead of generic descendant provenance', () => {
    expect(cimmichPlaceAssetSectionNames({ branchEntityIds: ['office'] }, children)).toEqual(['Office']);
  });

  it('keeps every immediate subsection when a photo belongs to more than one branch', () => {
    expect(cimmichPlaceAssetSectionNames({ branchEntityIds: ['yard', 'garage'] }, children)).toEqual([
      'Garage',
      'Yard',
    ]);
  });

  it('returns no redundant label for a photo directly at the parent', () => {
    expect(cimmichPlaceAssetSectionNames({ branchEntityIds: [] }, children)).toEqual([]);
  });
});
