import type { CimmichViewingMode } from '$lib/services/cimmich.service';

export const CIMMICH_VIEWING_MODE_PREFERENCE_KEY = 'cimmich.visibility.preferred-mode.v1';

const isViewingMode = (value: unknown): value is CimmichViewingMode =>
  value === 'standard' || value === 'personal' || value === 'private';

export const loadCimmichViewingModePreference = (
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): CimmichViewingMode => {
  try {
    const stored = storage?.getItem(CIMMICH_VIEWING_MODE_PREFERENCE_KEY);
    return isViewingMode(stored) ? stored : 'private';
  } catch {
    return 'private';
  }
};

export const saveCimmichViewingModePreference = (
  mode: CimmichViewingMode,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
) => {
  try {
    storage?.setItem(CIMMICH_VIEWING_MODE_PREFERENCE_KEY, mode);
  } catch {
    // The live viewing mode still applies when browser storage is unavailable.
  }
};
