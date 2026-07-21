import { describe, expect, it } from 'vitest';
import {
  projectBodyIdentityStatus,
  projectBodyLinkStatus,
  projectPrimaryMachineCandidateNames,
} from '$lib/services/cimmich-identity-projection';

describe('full archive identity-slate candidate projection', () => {
  it('preserves the machinery primary review candidate', () => {
    expect(projectPrimaryMachineCandidateNames({ reviewCandidateName: 'Tony Beranek' })).toEqual({
      candidateName: undefined,
      reviewCandidateName: 'Tony Beranek',
    });
  });

  it('keeps a low-similarity non-assignment unnamed', () => {
    expect(projectPrimaryMachineCandidateNames(undefined)).toEqual({
      candidateName: undefined,
      reviewCandidateName: undefined,
    });
  });

  it('restores a primary review candidate from the bounded machinery projection', () => {
    expect(projectPrimaryMachineCandidateNames(undefined, 'Tony Beranek')).toEqual({
      candidateName: undefined,
      reviewCandidateName: 'Tony Beranek',
    });
  });
});

describe('Body identity projection', () => {
  it('treats a direct accepted Body tag as linked without inventing a Face link', () => {
    expect(projectBodyIdentityStatus({ displayName: 'Maya Chen', linkedFaceId: '' })).toBe('linked');
  });

  it('keeps geometry-only and empty Bodies distinct', () => {
    expect(projectBodyIdentityStatus({ displayName: '', linkedFaceId: 'face_1' })).toBe('linked');
    expect(projectBodyIdentityStatus({ displayName: '', linkedFaceId: '' })).toBe('unlinked');
  });

  it('keeps a direct Body tag distinct from a Face-derived link', () => {
    expect(projectBodyLinkStatus({ displayName: 'Maya Chen', geometryLinked: false, linkedFaceId: '' })).toBe(
      'linked_to_person',
    );
    expect(projectBodyLinkStatus({ displayName: 'Maya Chen', geometryLinked: false, linkedFaceId: 'face_1' })).toBe(
      'linked_to_named_face',
    );
  });
});
