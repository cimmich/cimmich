import type { CimmichContextEntity, CimmichPerson } from '$lib/services/cimmich.service';

export type CimmichHomeFaceFocus = {
  backgroundPosition: string;
  backgroundSize: string;
  sourceAssetId: string;
};

export const cimmichHomeEntityHref = (family: 'events' | 'objects' | 'places', entityId: string) =>
  `/cimmich/${family}?entityId=${encodeURIComponent(entityId)}`;

const orderHomeFeatures = (left: CimmichContextEntity, right: CimmichContextEntity) =>
  Number(right.coverMode === 'explicit') - Number(left.coverMode === 'explicit') ||
  right.revision - left.revision ||
  left.displayName.localeCompare(right.displayName) ||
  left.entityId.localeCompare(right.entityId);

export const chooseCimmichHomeFeature = (events: CimmichContextEntity[]) => {
  const withMedia = events.filter((event) => event.previewAssetIds?.length || event.coverAssetId);
  const described = withMedia.filter((event) => event.description);
  return (
    [...(described.length > 0 ? described : withMedia.length > 0 ? withMedia : events)].sort(orderHomeFeatures)[0] ??
    null
  );
};

export const cimmichHomeContextPreviewId = (entity: CimmichContextEntity | null | undefined) =>
  entity?.coverAssetId ?? entity?.previewAssetIds?.[0] ?? null;

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export const cimmichHomeFaceFocus = (person: CimmichPerson | null | undefined): CimmichHomeFaceFocus | null => {
  if (
    !person?.sourceAssetId ||
    person.box_x === null ||
    person.box_y === null ||
    person.box_w === null ||
    person.box_h === null
  ) {
    return null;
  }

  const positionX = clampPercent((person.box_x + person.box_w / 2) * 100);
  const positionY = clampPercent((person.box_y + person.box_h / 2) * 100);

  return {
    backgroundPosition: `${positionX}% ${positionY}%`,
    backgroundSize: 'cover',
    sourceAssetId: person.sourceAssetId,
  };
};

export const collectCimmichHomeHeroAssets = (
  events: CimmichContextEntity[],
  places: CimmichContextEntity[],
  objects: CimmichContextEntity[],
  people: CimmichPerson[],
  limit = 5,
) => {
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !ids.includes(id) && ids.length < limit) {
      ids.push(id);
    }
  };

  for (const event of events) {
    add(cimmichHomeContextPreviewId(event));
    for (const id of event.previewAssetIds ?? []) {
      add(id);
    }
    add(event.coverAssetId);
  }
  for (const place of places) {
    add(place.coverAssetId);
  }
  for (const object of objects) {
    add(object.coverAssetId);
  }
  for (const subject of people) {
    add(subject.sourceAssetId);
  }

  return ids;
};

export const chooseCimmichHomeDistinctMedia = (
  candidateGroups: Array<Array<string | null | undefined>>,
  excluded: Array<string | null | undefined> = [],
) => {
  const used = new Set(excluded.filter(Boolean) as string[]);

  return candidateGroups.map((group) => {
    const candidates = [...new Set(group.filter(Boolean) as string[])];
    const selected = candidates.find((id) => !used.has(id)) ?? candidates[0] ?? null;
    if (selected) {
      used.add(selected);
    }
    return selected;
  });
};

export const cimmichHomePreviewNames = (names: Array<string | null | undefined>, limit = 3) => {
  const visible = names.map((name) => name?.trim()).filter(Boolean) as string[];
  if (visible.length === 0) {
    return 'Ready to explore';
  }
  const preview = visible.slice(0, limit).join(' · ');
  return visible.length > limit ? `${preview} +${visible.length - limit}` : preview;
};

export const cimmichHomeReviewLabel = (count: number | undefined) => {
  if (count === undefined) {
    return 'Checking review queue…';
  }
  if (count === 0) {
    return 'Nothing waiting';
  }
  return `${count.toLocaleString()} ${count === 1 ? 'suggestion' : 'suggestions'} ready`;
};
