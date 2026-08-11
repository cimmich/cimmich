import {
  CIMMICH_VIEWING_MODE_PREFERENCE_KEY,
  loadCimmichViewingModePreference,
  saveCimmichViewingModePreference,
} from './cimmich-viewing-mode-preference';

describe('Cimmich viewing-mode preference', () => {
  it('defaults to Private when no valid preference exists', () => {
    expect(loadCimmichViewingModePreference({ getItem: () => null })).toBe('private');
    expect(loadCimmichViewingModePreference({ getItem: () => 'unexpected' })).toBe('private');
    expect(loadCimmichViewingModePreference({ getItem: () => 'standard' })).toBe('standard');
  });

  it('saves an explicit mode without persisting any credential', () => {
    const setItem = vi.fn();
    saveCimmichViewingModePreference('personal', { setItem });
    expect(setItem).toHaveBeenCalledWith(CIMMICH_VIEWING_MODE_PREFERENCE_KEY, 'personal');
  });

  it('falls back safely when browser storage is unavailable', () => {
    expect(
      loadCimmichViewingModePreference({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe('private');
    expect(() =>
      saveCimmichViewingModePreference('private', {
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
  });
});
