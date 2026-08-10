import type { TagResponseDto } from '@immich/sdk';

export type CimmichTagFamily = 'events' | 'labels' | 'people' | 'pets' | 'places' | 'things';

export type TagBrowserOption = {
  aliases: string[];
  assetCount: number | null;
  coverAssetId: string | null;
  entityId: string;
  family: CimmichTagFamily | 'normal';
  id: string;
  label: string;
  normalTagId?: string;
};

export const familyLabel = (family: TagBrowserOption['family']) =>
  ({
    events: 'Events',
    labels: 'Labels',
    normal: 'Normal tag',
    people: 'People',
    pets: 'Pets',
    places: 'Places',
    things: 'Things',
  })[family];

export const normalTagOptions = (tags: TagResponseDto[]): TagBrowserOption[] =>
  tags
    .map((tag) => ({
      aliases: [],
      assetCount: null,
      coverAssetId: null,
      entityId: tag.id,
      family: 'normal' as const,
      id: `normal:${tag.id}`,
      label: tag.value,
      normalTagId: tag.id,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));

export const filterTagOptions = (
  options: TagBrowserOption[],
  query: string,
  family: CimmichTagFamily | 'all' = 'all',
) => {
  const needle = query.trim().toLocaleLowerCase();
  return options.filter(
    (option) =>
      (family === 'all' || option.family === family) &&
      (!needle || [option.label, ...option.aliases].some((value) => value.toLocaleLowerCase().includes(needle))),
  );
};

export const intersectAssetIds = (groups: string[][]) => {
  if (groups.length === 0) {
    return [];
  }
  const [smallest, ...rest] = [...groups].sort((left, right) => left.length - right.length);
  const remaining = rest.map((group) => new Set(group));
  return [...new Set(smallest)].filter((id) => remaining.every((group) => group.has(id)));
};
