export const CIMMICH_HOME_COVER_STORAGE_KEY = 'cimmich.home-covers.v1';

export type CimmichHomeCoverSlot = 'documents' | 'events' | 'hero' | 'objects' | 'people' | 'pets' | 'places';
export type CimmichHomeCoverMode = 'automatic' | 'group' | 'random' | 'single';
export type CimmichHomeCoverRandomScope = 'favorites' | 'library' | 'section';
export type CimmichHomeViewingMode = 'personal' | 'private' | 'standard';

export type CimmichHomeCoverPreference = {
  assetIds: string[];
  mode: CimmichHomeCoverMode;
  randomScope: CimmichHomeCoverRandomScope;
};

export type CimmichHomeCoverPreferences = Partial<Record<CimmichHomeCoverSlot, CimmichHomeCoverPreference>>;

type StoredCimmichHomeCoverPreferences = {
  modes: Partial<Record<CimmichHomeViewingMode, CimmichHomeCoverPreferences>>;
  schemaVersion: 'cimmich.home-covers.v1';
};

type CoverStorage = Pick<Storage, 'getItem' | 'setItem'>;

const slots = new Set<CimmichHomeCoverSlot>(['documents', 'events', 'hero', 'objects', 'people', 'pets', 'places']);
const modes = new Set<CimmichHomeCoverMode>(['automatic', 'group', 'random', 'single']);
const randomScopes = new Set<CimmichHomeCoverRandomScope>(['favorites', 'library', 'section']);
const assetIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const cleanAssetIds = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && assetIdPattern.test(id)))].slice(
    0,
    6,
  );
};

export const normalizeCimmichHomeCoverPreference = (value: unknown): CimmichHomeCoverPreference | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<CimmichHomeCoverPreference>;
  if (!candidate.mode || !modes.has(candidate.mode)) {
    return null;
  }
  const assetIds = cleanAssetIds(candidate.assetIds);
  const randomScope =
    candidate.randomScope && randomScopes.has(candidate.randomScope) ? candidate.randomScope : ('section' as const);

  if (candidate.mode === 'single' && assetIds.length !== 1) {
    return null;
  }
  if (candidate.mode === 'group' && assetIds.length < 2) {
    return null;
  }
  return {
    assetIds: candidate.mode === 'random' || candidate.mode === 'automatic' ? [] : assetIds,
    mode: candidate.mode,
    randomScope,
  };
};

const normalizeModePreferences = (value: unknown): CimmichHomeCoverPreferences => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const result: CimmichHomeCoverPreferences = {};
  for (const [slot, candidate] of Object.entries(value)) {
    if (!slots.has(slot as CimmichHomeCoverSlot)) {
      continue;
    }
    const preference = normalizeCimmichHomeCoverPreference(candidate);
    if (preference && preference.mode !== 'automatic') {
      result[slot as CimmichHomeCoverSlot] = preference;
    }
  }
  return result;
};

const readStoredPreferences = (storage: CoverStorage | null | undefined): StoredCimmichHomeCoverPreferences => {
  if (!storage) {
    return { modes: {}, schemaVersion: 'cimmich.home-covers.v1' };
  }
  try {
    const value = JSON.parse(storage.getItem(CIMMICH_HOME_COVER_STORAGE_KEY) ?? 'null') as unknown;
    if (!value || typeof value !== 'object') {
      throw new Error('missing cover preferences');
    }
    const candidate = value as Partial<StoredCimmichHomeCoverPreferences>;
    return {
      modes: {
        personal: normalizeModePreferences(candidate.modes?.personal),
        private: normalizeModePreferences(candidate.modes?.private),
        standard: normalizeModePreferences(candidate.modes?.standard),
      },
      schemaVersion: 'cimmich.home-covers.v1',
    };
  } catch {
    return { modes: {}, schemaVersion: 'cimmich.home-covers.v1' };
  }
};

export const loadCimmichHomeCoverPreferences = (
  storage: CoverStorage | null | undefined,
  viewingMode: CimmichHomeViewingMode,
) => readStoredPreferences(storage).modes[viewingMode] ?? {};

export const saveCimmichHomeCoverPreference = (
  storage: CoverStorage | null | undefined,
  viewingMode: CimmichHomeViewingMode,
  slot: CimmichHomeCoverSlot,
  value: CimmichHomeCoverPreference,
) => {
  const stored = readStoredPreferences(storage);
  const current = { ...stored.modes[viewingMode] };
  const preference = normalizeCimmichHomeCoverPreference(value);
  if (!preference || preference.mode === 'automatic') {
    delete current[slot];
  } else {
    current[slot] = preference;
  }
  const next: StoredCimmichHomeCoverPreferences = {
    modes: { ...stored.modes, [viewingMode]: current },
    schemaVersion: 'cimmich.home-covers.v1',
  };
  try {
    storage?.setItem(CIMMICH_HOME_COVER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The returned in-memory preference still applies for this page session.
  }
  return current;
};

export const resolveCimmichHomeCoverAssetIds = (
  automaticIds: string[],
  preference: CimmichHomeCoverPreference | undefined,
  randomAssetId: string | null | undefined,
) => {
  if (preference?.mode === 'single' || preference?.mode === 'group') {
    return preference.assetIds;
  }
  if (preference?.mode === 'random') {
    return randomAssetId ? [randomAssetId] : automaticIds;
  }
  return automaticIds;
};

export const chooseCimmichHomeRandomAssetId = (
  candidates: Array<string | null | undefined>,
  randomValue = Math.random(),
) => {
  const ids = [...new Set(candidates.filter(Boolean) as string[])];
  if (ids.length === 0) {
    return null;
  }
  const normalized = Number.isFinite(randomValue) ? Math.max(0, Math.min(0.999_999_999, randomValue)) : 0;
  return ids[Math.floor(normalized * ids.length)] ?? ids[0];
};

export const chooseCimmichHomeRotatingAssetId = (assetIds: string[], rotationIndex: number) => {
  if (assetIds.length === 0) {
    return null;
  }
  const integerIndex = Number.isFinite(rotationIndex) ? Math.trunc(rotationIndex) : 0;
  const wrappedIndex = ((integerIndex % assetIds.length) + assetIds.length) % assetIds.length;
  return assetIds[wrappedIndex] ?? assetIds[0];
};
