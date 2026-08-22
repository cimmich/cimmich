export type PersonPhotoFilter = 'all' | 'body' | 'face' | 'needs';
export type PersonArchiveTab = 'identity' | 'maintenance' | 'photos' | 'places' | 'signals' | 'story' | 'with';

export const personPhotoFilters: Array<{ id: PersonPhotoFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'face', label: 'Face' },
  { id: 'body', label: 'Body' },
  { id: 'needs', label: 'Needs check' },
];

export const personArchiveTabs: Array<{ id: PersonArchiveTab; label: string }> = [
  { id: 'photos', label: 'Photos' },
  { id: 'story', label: 'Story' },
  { id: 'identity', label: 'Identity' },
  { id: 'with', label: 'With' },
  { id: 'places', label: 'Places' },
  { id: 'signals', label: 'Signals' },
  { id: 'maintenance', label: 'Maintenance' },
];
