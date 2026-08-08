import type { CimmichPersonPresentationSlot, CimmichPersonProfileFieldKey } from '$lib/services/cimmich.service';

export type CimmichPersonConnection = {
  directRelations?: Array<{ relationId: string; relationType: string }>;
  displayName: string;
  entityId: string;
  entityKind: 'event' | 'object' | 'person' | 'place';
  metaLabel: string;
  photoCount: number;
  sourceAssetId: string | null;
  typeKind: string;
};

export type CimmichHeroField = {
  fieldKey: CimmichPersonProfileFieldKey;
  label: string;
  value: string;
};

export type CimmichPresentationFrame = { centerX: number; centerY: number; zoom: number };

export type CimmichPresentationDrag = {
  pointerId: number;
  slotKind: CimmichPersonPresentationSlot;
  x: number;
  y: number;
};
