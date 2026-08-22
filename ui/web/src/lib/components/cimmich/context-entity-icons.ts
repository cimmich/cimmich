import {
  mdiAccountGroupOutline,
  mdiCalendarBlankOutline,
  mdiCellphone,
  mdiDiamondStone,
  mdiDomain,
  mdiHomeOutline,
  mdiMapMarkerOutline,
  mdiMapOutline,
  mdiPackageVariantClosed,
  mdiRepeat,
  mdiRoadVariant,
  mdiToolboxOutline,
  mdiWalk,
} from '@mdi/js';
import type { CimmichContextTypeKind } from '$lib/services/cimmich.service';

const icons: Partial<Record<CimmichContextTypeKind, string>> = {
  activity: mdiRepeat,
  area: mdiMapOutline,
  collectible: mdiDiamondStone,
  device: mdiCellphone,
  equipment: mdiToolboxOutline,
  event: mdiCalendarBlankOutline,
  group: mdiAccountGroupOutline,
  life_period: mdiWalk,
  organisation: mdiDomain,
  point: mdiMapMarkerOutline,
  property: mdiHomeOutline,
  route: mdiRoadVariant,
  trip: mdiRoadVariant,
};

export const iconForContextType = (type: CimmichContextTypeKind) => icons[type] ?? mdiPackageVariantClosed;
