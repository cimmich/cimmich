import { shouldInitializeGCast } from './gcast-policy';

describe('Google Cast initialization policy', () => {
  it('initializes only for an authenticated user who enabled Google Cast', () => {
    expect(shouldInitializeGCast(true, true)).toBe(true);
    expect(shouldInitializeGCast(true, false)).toBe(false);
    expect(shouldInitializeGCast(false, true)).toBe(false);
    expect(shouldInitializeGCast(false, false)).toBe(false);
  });
});
