import { getBaseUrl, IntegrityReport, QueueName, type MetadataSearchDto, type SmartSearchDto } from '@immich/sdk';
import { omitBy } from 'lodash-es';
import { OpenQueryParam, type SharedLinkTab } from '$lib/constants';

const asQueueSlug = (name: QueueName) => {
  return name.replaceAll(/[A-Z]/g, (m) => '-' + m.toLowerCase());
};

export const fromQueueSlug = (slug: string): QueueName | undefined => {
  const name = slug.replaceAll(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (Object.values(QueueName).includes(name as QueueName)) {
    return name as QueueName;
  }
};

type QueryValue = number | string;
const asQueryString = (
  params?: Record<string, QueryValue | undefined>,
  options?: { skipEmptyStrings?: boolean; skipNullValues?: boolean },
) => {
  const { skipEmptyStrings = true, skipNullValues = true } = options ?? {};
  const items = Object.entries(params ?? {})
    .filter((item): item is [string, QueryValue] => {
      const value = item[1];

      if (value === undefined) {
        return false;
      }

      if (skipNullValues && value === null) {
        return false;
      }

      if (skipEmptyStrings && value === '') {
        return false;
      }

      return true;
    })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);

  return items.length === 0 ? '' : `?${items.join('&')}`;
};

const DOCS_BASE = 'https://docs.immich.app';

export const Docs = {
  duplicates: () => `${DOCS_BASE}/features/duplicates-utility`,
};

export const Route = {
  // auth
  login: (params?: { continue?: string; autoLaunch?: 0 | 1 }) => '/auth/login' + asQueryString(params),
  logout: (params?: { continue?: string }) => '/auth/logout' + asQueryString(params),
  register: () => '/auth/register',
  changePassword: () => '/auth/change-password',
  onboarding: (params?: { step?: string }) => '/auth/onboarding' + asQueryString(params),
  pinPrompt: (params?: { continue?: string }) => '/auth/pin-prompt' + asQueryString({ continue: params?.continue }),

  // albums
  albums: (params?: { organise?: 1 }) => '/albums' + asQueryString(params),
  viewAlbum: ({ id }: { id: string }) => `/albums/${id}`,
  viewAlbumAsset: ({ albumId, assetId }: { albumId: string; assetId: string }) =>
    `/albums/${albumId}/photos/${assetId}`,

  // buy
  buy: () => '/buy',

  // explore
  explore: () => '/explore',
  places: () => '/places',

  // folders
  folders: (params?: { path?: string; organise?: 1; cimmichContext?: 1 }) => '/folders' + asQueryString(params),
  viewFolderAsset: ({ id, path, cimmich }: { id: string; path: string; cimmich?: 1 }) =>
    `/folders/photos/${id}` + asQueryString({ cimmichContext: cimmich, path }),

  // libraries
  libraries: () => '/admin/library-management',
  newLibrary: () => '/admin/library-management/new',
  viewLibrary: ({ id }: { id: string }) => `/admin/library-management/${id}`,
  editLibrary: ({ id }: { id: string }) => `/admin/library-management/${id}/edit`,

  // maintenance
  maintenanceMode: (params?: { continue?: string }) => '/maintenance' + asQueryString(params),

  // map
  map: (point?: { zoom: number; lat: number; lng: number }) =>
    '/map' + (point ? `#${point.zoom}/${point.lat}/${point.lng}` : ''),

  // memories
  memories: (params?: { id?: string }) => '/memory' + asQueryString(params),

  // partners
  viewPartner: ({ id }: { id: string }) => `/partners/${id}`,

  // people
  people: () => '/people',
  viewPerson: ({ id }: { id: string }, params?: { previousRoute?: string; action?: 'merge' }) =>
    `/people/${id}` + asQueryString(params),

  // cimmich
  cimmich: () => '/cimmich',
  cimmichHome: () => '/cimmich',
  cimmichSteward: () => '/cimmich/steward',
  cimmichPhotoReview: () => '/cimmich/steward/photos',
  cimmichActivities: () => '/cimmich/activities',
  cimmichActivity: ({ id }: { id: string }) => `/cimmich/activities/${encodeURIComponent(id)}`,
  cimmichDocuments: () => '/cimmich/documents',
  cimmichDiscover: () => '/cimmich/discover',
  cimmichEvents: () => '/cimmich/events',
  cimmichArchiveIntegrity: (params?: {
    assetId?: string;
    folder?: string;
    mode?: 'exact' | 'variants' | 'plan' | 'folder' | 'rotation' | 'backup' | 'missing';
  }) => '/cimmich/archive-integrity' + asQueryString(params),
  cimmichLibrary: () => '/cimmich/library',
  cimmichLibraryBulk: () => '/cimmich/library/bulk',
  cimmichMaintenance: () => '/cimmich/maintenance',
  cimmichSetup: () => '/cimmich/setup',
  cimmichOrganise: () => '/cimmich/organise',
  cimmichOrganiseBulk: () => '/cimmich/organise/bulk',
  cimmichPets: () => '/cimmich/pets',
  cimmichPet: ({ name, petId }: { name: string; petId?: string }) =>
    `/cimmich/pets/${encodeURIComponent(name)}` + asQueryString(petId ? { petId } : undefined),
  cimmichPeople: () => '/cimmich/people',
  cimmichPerson: ({
    identityReviewCount,
    name,
    personId,
  }: {
    identityReviewCount?: number;
    name: string;
    personId?: string;
  }) =>
    `/cimmich/people/${encodeURIComponent(name)}` +
    asQueryString({
      identityReviewCount: identityReviewCount && identityReviewCount > 0 ? Math.floor(identityReviewCount) : undefined,
      personId,
    }),
  cimmichPlaces: () => '/cimmich/places',
  cimmichThings: () => '/cimmich/things',
  cimmichSmartSearch: (params?: { lens?: 'documents' | 'photos' | 'visual'; q?: string; queryAssetId?: string }) =>
    '/cimmich/smart-search' + asQueryString(params),
  cimmichSettings: () => '/cimmich/settings',

  // photos
  photos: (params?: { at?: string; organise?: 1 }) => '/photos' + asQueryString(params),
  viewAsset: ({ id }: { id: string }) => `/photos/${id}`,
  viewCimmichFaceAsset: ({ faceId, id }: { faceId: string; id: string }) =>
    `/photos/${id}` + asQueryString({ cimmichFaceId: faceId, cimmichOverlay: 'machinery' }),
  viewCimmichPersonAsset: ({
    faceId,
    id,
    personId,
    personName,
    overlay,
  }: {
    faceId?: string;
    id: string;
    personId: string;
    personName: string;
    overlay?: 'machinery' | 'people';
  }) =>
    `/photos/${id}` +
    asQueryString({
      cimmichFaceId: faceId,
      cimmichOverlay: overlay,
      cimmichPersonId: personId,
      cimmichPersonName: personName,
    }),
  viewCimmichPetAsset: ({ id, petId, petName }: { id: string; petId: string; petName: string }) =>
    `/photos/${id}` + asQueryString({ cimmichPetId: petId, cimmichPetName: petName }),
  archive: () => '/archive',
  favorites: (params?: { organise?: 1 }) => '/favorites' + asQueryString(params),
  locked: () => '/locked',
  trash: () => '/trash',
  viewTrashedAsset: ({ id }: { id: string }) => `/trash/photos/${id}`,
  recentlyAdded: (params?: { organise?: 1 }) => '/recently-added' + asQueryString(params),

  // search
  search: (dto?: MetadataSearchDto | SmartSearchDto) => {
    const metadata = omitBy(dto ?? {}, (value) => value === undefined);
    const query = Object.keys(metadata).length === 0 ? undefined : JSON.stringify(metadata);
    return `/search` + asQueryString({ query });
  },

  // sharing
  sharing: () => '/sharing',

  // shared links
  sharedLinks: (params?: { filter?: SharedLinkTab }) => '/shared-links' + asQueryString(params),
  editSharedLink: ({ id }: { id: string }) => `/shared-links/${id}/edit`,
  viewSharedLink: ({ slug, key }: { slug?: string | null; key: string }) => (slug ? `/s/${slug}` : `/share/${key}`),

  // settings
  userSettings: (params?: { isOpen?: OpenQueryParam }) => '/user-settings' + asQueryString(params),

  // system
  systemSettings: (params?: { isOpen?: OpenQueryParam }) => '/admin/system-settings' + asQueryString(params),
  systemStatistics: () => '/admin/server-status',
  systemMaintenance: (params?: { continue?: string }) => '/admin/maintenance' + asQueryString(params),
  systemMaintenanceIntegrityReport: ({ reportType }: { reportType: IntegrityReport }) =>
    `/admin/maintenance/integrity-report/${reportType}`,

  // tags
  tags: (params?: { path?: string; organise?: 1 }) => '/tags' + asQueryString(params),

  // users
  users: () => '/admin/users',
  newUser: () => `/admin/users/new`,
  viewUser: ({ id }: { id: string }) => `/admin/users/${id}`,
  editUser: ({ id }: { id: string }) => `/admin/users/${id}/edit`,

  // utilities
  utilities: () => '/utilities',
  duplicatesUtility: (params?: { index?: number }) => '/utilities/duplicates' + asQueryString(params),
  largeFileUtility: () => '/utilities/large-files',
  geolocationUtility: () => '/utilities/geolocation',

  // workflows
  workflows: () => '/workflows',
  viewWorkflow: ({ id }: { id: string }) => `/workflows/${id}`,

  // queues
  queues: () => '/admin/queues',
  viewQueue: ({ name }: { name: QueueName }) => `/admin/queues/${asQueueSlug(name)}`,

  // integrity checks
  integrityReportFile: (reportId: string) => `${getBaseUrl()}/admin/integrity/report/${reportId}/file`,
  integrityReportCsv: (reportType: IntegrityReport) => `${getBaseUrl()}/admin/integrity/report/${reportType}/csv`,

  // continue helper for ensuring same-origin URLs
  continue: (url: string | null, fallback: string): string | URL => {
    const resolved = new URL(url ?? fallback, document.baseURI);

    if (resolved.origin !== location.origin) {
      return fallback;
    }

    return resolved;
  },
};
