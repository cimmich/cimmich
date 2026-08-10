import { getCimmichContextEntity, type CimmichPerson, type CimmichPersonAsset } from '$lib/services/cimmich.service';
import type { CimmichPersonConnection } from './person-page-types';

export const loadCimmichPeopleConnections = async (
  personId: string,
  assets: CimmichPersonAsset[],
  people: CimmichPerson[],
) => {
  const contextCounts = new Map<string, number>();
  for (const asset of assets) {
    for (const context of asset.contexts) {
      contextCounts.set(context.entityId, (contextCounts.get(context.entityId) ?? 0) + 1);
    }
  }
  // Uncapped, this fired one request per unique context tag across the
  // person's assets. Rank first so only the strongest 32 enter the lane.
  const contexts = [
    ...new Map(assets.flatMap((asset) => asset.contexts).map((context) => [context.entityId, context])).values(),
  ]
    .sort((left, right) => (contextCounts.get(right.entityId) ?? 0) - (contextCounts.get(left.entityId) ?? 0))
    .slice(0, 32);
  const details: (Awaited<ReturnType<typeof getCimmichContextEntity>> | null)[] = Array.from(
    { length: contexts.length },
    () => null,
  );
  let nextContextIndex = 0;
  const contextWorker = async () => {
    while (nextContextIndex < contexts.length) {
      const index = nextContextIndex++;
      const context = contexts[index];
      details[index] = await getCimmichContextEntity(
        context.entityKind === 'event' ? 'events' : context.entityKind === 'object' ? 'objects' : 'places',
        context.entityId,
      ).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, contexts.length) }, () => contextWorker()));
  const linked = new Map<string, CimmichPersonConnection & { contextIds: Set<string> }>();
  for (const detail of details) {
    if (!detail) {
      continue;
    }
    for (const relation of detail.relations) {
      if (relation.targetKind !== 'person' || relation.targetId === personId) {
        continue;
      }
      const person = people.find((row) => row.person_id === relation.targetId);
      if (!person?.sourceAssetId) {
        continue;
      }
      const existing = linked.get(person.person_id);
      if (existing) {
        existing.contextIds.add(detail.entity.entityId);
        existing.photoCount = existing.contextIds.size;
        continue;
      }
      linked.set(person.person_id, {
        contextIds: new Set([detail.entity.entityId]),
        displayName: person.display_name,
        entityId: person.person_id,
        entityKind: 'person',
        metaLabel:
          person.categories
            .filter((category) => category.category_kind === 'relationship')
            .sort((left, right) => left.sort_order - right.sort_order)
            .map((category) => category.name)
            .join(' · ') || 'Connected person',
        photoCount: 1,
        sourceAssetId: person.sourceAssetId,
        typeKind: relation.relationKind,
      });
    }
  }
  return [...linked.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
};
