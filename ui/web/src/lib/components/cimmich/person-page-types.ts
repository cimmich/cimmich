import type { CimmichConnectionFact } from '$lib/services/cimmich-connection-facts.service';
import type { CimmichPersonPresentationSlot, CimmichPersonProfileFieldKey } from '$lib/services/cimmich.service';

export type CimmichPersonConnection = {
  contextCount?: number;
  directRelations?: Array<{ relationId: string; relationType: string }>;
  displayName: string;
  entityId: string;
  entityKind: 'event' | 'object' | 'person' | 'place';
  metaLabel: string;
  photoCount: number;
  portraitStyle?: string;
  recordedFacts?: CimmichConnectionFact[];
  sourceAssetId: string | null;
  typeKind: string;
};

export type CimmichPersonConnectionView = 'list' | 'web';

export type CimmichPersonConnectionGroup = {
  id: CimmichPersonConnection['entityKind'];
  items: CimmichPersonConnection[];
  label: string;
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
