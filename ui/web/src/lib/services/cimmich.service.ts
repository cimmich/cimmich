import { env } from '$env/dynamic/public';

export type CimmichSummary = {
  accepted_presence: number;
  assets: number;
  body_observations: number;
  face_observations: number;
  candidate_signals: number;
  people: number;
  suggestions_ready: number;
  user_decisions: number;
};

export type CimmichViewingMode = 'personal' | 'private' | 'standard';
export type CimmichVisibilityTier = CimmichViewingMode;
export type CimmichVisibilityScope =
  | 'album'
  | 'asset'
  | 'collection'
  | 'context_entity'
  | 'document'
  | 'person'
  | 'pet';
export type CimmichVisibilitySurface =
  | 'ambient'
  | 'background'
  | 'casting'
  | 'export'
  | 'frame'
  | 'interactive'
  | 'notification'
  | 'share'
  | 'slideshow';

export type CimmichVisibilityStatus = {
  capabilities: {
    album: boolean;
    asset: boolean;
    collection: boolean;
    document: boolean;
    entityProfile: boolean;
  };
  forcedStandard: boolean;
  inactivitySeconds: number;
  maxPrivateSessionSeconds: number;
  principalBound: boolean;
  principalId: string;
  privateAuthorized: boolean;
  privateConfigured: boolean;
  schemaVersion: 'cimmich.visibility.v1';
  surface: CimmichVisibilitySurface;
  viewingMode: CimmichViewingMode;
};

export type CimmichViewingModeMutationResult = CimmichVisibilityStatus & {
  applied: boolean;
  intentSequence: number;
};

export type CimmichPrivateCredentialStatus = {
  algorithm: string | null;
  configured: boolean;
  principalId: string;
  privateLockMode: 'none' | 'password';
  /** Names what the password actually protects: what is shown, not who may sign in. */
  protectionKind: 'presentation_filter';
  schemaVersion: 'cimmich.visibility.v1';
  updatedAt: string | null;
};

export type CimmichVisibilityObject = {
  decisionId: string | null;
  explicit: boolean;
  objectId: string;
  objectScope: CimmichVisibilityScope;
  revision: number;
  schemaVersion?: 'cimmich.visibility.v1';
  visibilityTier: CimmichVisibilityTier;
};

export type CimmichVisibilityMutationResult = {
  decisionId: string;
  objects: CimmichVisibilityObject[];
  replayed: boolean;
  schemaVersion: 'cimmich.visibility.v1';
  supersedesDecisionId?: string;
};

export type CimmichVisibilityProjectionSurfaceKey =
  | 'asset_detail'
  | 'asset_evidence'
  | 'basic_search'
  | 'events'
  | 'machine_suggestions'
  | 'people'
  | 'person_assets'
  | 'person_review'
  | 'pet_media'
  | 'pets'
  | 'places'
  | 'smart_search'
  | 'summary';

export type CimmichVisibilityProjection = {
  assetDerived: boolean;
  coverageState: 'blocked' | 'enforced';
  reasonCode: string | null;
  routeFamily: string;
  surfaceKey: CimmichVisibilityProjectionSurfaceKey;
};

export type CimmichVisibilityProjectionRegistry = {
  items: CimmichVisibilityProjection[];
  allRegisteredSurfacesEnforced: boolean;
  schemaVersion: 'cimmich.visibility-projection.v1';
};

export type CimmichContextFamily = 'events' | 'objects' | 'places';
export type CimmichContextEntityKind = 'event' | 'object' | 'place';
export type CimmichContextTypeKind =
  | 'activity'
  | 'area'
  | 'collectible'
  | 'device'
  | 'equipment'
  | 'event'
  | 'life_period'
  | 'other'
  | 'point'
  | 'property'
  | 'route'
  | 'trip'
  | 'unlocated'
  | 'vehicle';
export type CimmichContextDatePrecision = 'approximate' | 'exact' | 'month' | 'unknown' | 'year';
export type CimmichContextGeometry =
  | { east: number; north: number; south: number; west: number }
  | { latitude: number; longitude: number }
  | { points: Array<{ latitude: number; longitude: number }> }
  | null;

export type CimmichContextEntity = {
  aliases: string[];
  assetCount: number;
  coverAssetId: string | null;
  coverMode?: 'automatic' | 'explicit';
  dateEnd: string | null;
  datePrecision: CimmichContextDatePrecision;
  dateStart: string | null;
  description: string | null;
  displayName: string;
  entityId: string;
  entityKind: CimmichContextEntityKind;
  geometry: CimmichContextGeometry;
  parentEntityId: string | null;
  /** Event collection rows only: up to four visible active Main-media source IDs, cover first when eligible. */
  previewAssetIds?: string[];
  revision: number;
  status: 'active' | 'archived' | 'hidden';
  typeKind: CimmichContextTypeKind;
  visibility?: CimmichVisibilityObject;
};

export type CimmichContextAsset = {
  assetId: string;
  associationId: string;
  associationKind: string;
  captureTime: string | null;
  filename: string;
  height: number;
  linkedAt: string;
  mediaKind: 'image' | 'video';
  mimeType: string;
  sourceAssetId: string;
  width: number;
};

export type CimmichContextRelation = {
  linkedAt: string;
  relationId: string;
  relationKind: 'companion' | 'location' | 'object' | 'parent' | 'participant' | 'related';
  targetId: string;
  targetKind: 'event' | 'object' | 'person' | 'pet' | 'place';
  targetName: string;
};

export type CimmichContextDetail = {
  assets: CimmichContextAsset[];
  entity: CimmichContextEntity;
  relations: CimmichContextRelation[];
  schemaVersion: 'cimmich.context-entity.v1';
};

export type CimmichContextEntityInput = {
  aliases?: string[];
  commandId: string;
  dateEnd?: string | null;
  datePrecision?: CimmichContextDatePrecision;
  dateStart?: string | null;
  description?: string | null;
  displayName: string;
  geometry?: CimmichContextGeometry;
  parentEntityId?: string | null;
  status?: 'active' | 'archived' | 'hidden';
  typeKind: CimmichContextTypeKind;
};

export type CimmichContextMutationResult = {
  changedAssetIds?: string[];
  commandId: string;
  decisionId: string | null;
  detail: CimmichContextDetail | null;
  projectionUnavailable?: boolean;
  replayed: boolean;
  schemaVersion: 'cimmich.context-entity.v1';
  status: 'applied' | 'no_change' | 'reverted';
  unchangedAssetIds?: string[];
  undo?: { eligible: boolean; token: string | null };
};

export type CimmichPlaceCoverResult = {
  changed: boolean;
  commandId: string;
  decisionId: string | null;
  detail: CimmichContextDetail;
  replayed: boolean;
  schemaVersion: 'cimmich.place-cover.v1';
  status: 'applied' | 'no_change';
  undo: { eligible: boolean; token: string | null };
};

export type CimmichObjectCoverResult = {
  changed: boolean;
  commandId: string;
  decisionId: string | null;
  detail: CimmichContextDetail;
  replayed: boolean;
  schemaVersion: 'cimmich.object-cover.v1';
  status: 'applied' | 'no_change';
  undo: { eligible: boolean; token: string | null };
};

export type CimmichEventCoverResult = {
  changed: boolean;
  commandId: string;
  decisionId: string | null;
  detail: CimmichContextDetail;
  replayed: boolean;
  schemaVersion: 'cimmich.event-cover.v1';
  status: 'applied' | 'no_change';
  undo: { eligible: boolean; token: string | null };
};

export type CimmichAddressGeocodingItem = {
  addressLine: string | null;
  admin1: string | null;
  country: string | null;
  label: string;
  latitude: number;
  locality: string | null;
  longitude: number;
  matchQuality: 'broad' | 'close' | 'exact';
  matchReason:
    | 'exact_address'
    | 'house_number_unavailable'
    | 'locality_match'
    | 'locality_not_confirmed'
    | 'provider_broad_match'
    | 'provider_match'
    | 'street_partial_match'
    | 'unit_not_verified';
  name: string;
  postcode: string | null;
  precision: 'address' | 'place' | 'street';
  resultId: string;
};

export type CimmichAddressGeocodingResult = {
  attribution: { label: string; url: string };
  items: CimmichAddressGeocodingItem[];
  provider: { id: 'photon'; name: string; queryDisclosure: 'typed_address_sent_to_provider' };
  schemaVersion: 'cimmich.address-geocoding.v1';
};

export type CimmichVisibleMapAssetsResult = {
  schemaVersion: 'cimmich.visible-map-assets.v1';
  sourceAssetIds: string[];
};

export type CimmichPlaceDeleteResult = {
  affectedChildren: number;
  affectedDocuments: number;
  affectedRelations: number;
  changed: boolean;
  commandId: string;
  deletedTagCount: number;
  displayName: string;
  entityId: string;
  immichDatabaseChanged: false;
  rawMediaChanged: false;
  replayed: boolean;
  retainedTagCount: number;
  schemaVersion: 'cimmich.place-delete.v1';
  status: 'deleted';
  undo: { eligible: false; reason: 'permanent_delete' };
};

export type CimmichObjectDeleteResult = Omit<CimmichPlaceDeleteResult, 'schemaVersion'> & {
  schemaVersion: 'cimmich.object-delete.v1';
};

export type CimmichContextEntityUpdateInput = Omit<Partial<CimmichContextEntityInput>, 'commandId'> & {
  commandId: string;
  expectedRevision: number;
};

export type CimmichSmartSearchSelector = {
  entityKind: CimmichContextEntityKind | 'document' | 'person' | 'pet';
  ids: string[];
  label: string;
  matchKind: 'description' | 'label';
  selectorKind: 'context' | 'document' | 'subject';
};

export type CimmichSmartSearchItem = {
  assetId: string;
  captureTime: string | null;
  filename: string;
  height: number;
  mediaKind: 'image' | 'video';
  mimeType: string;
  sourceAssetId: string;
  width: number;
};

export type CimmichSmartSearchDocument = {
  displayTitle: string;
  documentId: string;
  documentKind: CimmichDocumentKind;
  documentLabel: string | null;
  effectiveVisibilityTier: CimmichVisibilityTier;
  expiresOn: string | null;
  issuedOn: string | null;
  sourceFilename: string;
  sourceKind: 'cimmich_file' | 'immich_asset';
  subjectCount: number;
};

export type CimmichSmartSearchResult = {
  documentHasMore: boolean;
  documents: CimmichSmartSearchDocument[];
  hasMore: boolean;
  interpretation: {
    candidateSetTruncated: boolean;
    dateRange: null | {
      endExclusive: string;
      precision: 'day' | 'month' | 'year';
      sourceText: string;
      startInclusive: string;
    };
    mode: 'basic';
    selectors: CimmichSmartSearchSelector[];
    unresolvedTerms: string[];
  };
  items: CimmichSmartSearchItem[];
  query: string;
  schemaVersion: 'cimmich.smart-search-basic.v2';
};

export type CimmichDocumentKind =
  | 'adoption'
  | 'booking'
  | 'care'
  | 'certificate'
  | 'contract'
  | 'correspondence'
  | 'financial'
  | 'identity'
  | 'insurance'
  | 'lease'
  | 'manual'
  | 'other'
  | 'receipt'
  | 'registration'
  | 'vaccination'
  | 'veterinary';
export type CimmichDocumentSubjectKind = 'event' | 'object' | 'person' | 'pet' | 'place';
export type CimmichDocumentRelationKind = 'about' | 'applies_to' | 'belongs_to' | 'issued_to' | 'related';

export type CimmichDocumentLink = {
  displayName: string;
  relationKind: CimmichDocumentRelationKind;
  subjectId: string;
  subjectKind: CimmichDocumentSubjectKind;
};

export type CimmichDocument = {
  documentId: string;
  documentKind: CimmichDocumentKind;
  documentLabel: string | null;
  displayTitle: string;
  effectiveVisibilityTier: CimmichVisibilityTier;
  expiresOn: string | null;
  issuedOn: string | null;
  links?: CimmichDocumentLink[];
  preview: {
    available: boolean;
    disposition: 'download' | 'immich' | 'inline';
    mimeType: string;
  };
  revision: number;
  schemaVersion?: 'cimmich.document.v1';
  source: {
    assetId: string | null;
    byteSize: number | null;
    contentSha256: string | null;
    filename: string;
    kind: 'cimmich_file' | 'immich_asset';
    mimeType: string;
    sourceContentHash: string | null;
  };
  status: 'active' | 'archived';
  subjectCount: number;
  supersededByDocumentId: string | null;
  supersedesDocumentId: string | null;
  updatedAt: string;
  visibilityTier: CimmichVisibilityTier;
};

export type CimmichDocumentMetadataInput = {
  displayTitle: string;
  documentKind: CimmichDocumentKind;
  documentLabel?: string | null;
  expiresOn?: string | null;
  issuedOn?: string | null;
  supersedesDocumentId?: string | null;
  visibilityTier?: CimmichVisibilityTier;
};

export type CimmichDocumentMutationResult = {
  changed: boolean;
  decisionId: string | null;
  documentId: string;
  linkCount?: number;
  replayed: boolean;
  schemaVersion: 'cimmich.document.v1';
  undoneDecisionId?: string;
};

export type CimmichDocumentContent =
  | { assetId: string; kind: 'immich_asset' }
  | { blob: Blob; disposition: 'attachment' | 'inline'; filename: string; kind: 'cimmich_file'; mimeType: string };

export type CimmichLegacyPetDocumentLink = {
  adoptedDocumentId: string | null;
  adoptionId: string | null;
  assetId: string;
  documentKind: CimmichPetDocumentKind;
  documentLabel: string | null;
  legacyAssociationId: string;
  linkedAt: string;
  mediaKind: 'image' | 'video';
  mimeType: string;
  petId: string;
  petName: string;
  state: 'adopted' | 'available';
};

export type CimmichLegacyPetDocumentAdoptionResult = {
  adoptionId: string;
  changed: boolean;
  createdDocument: boolean;
  createdLink: boolean;
  decisionId: string;
  documentId: string;
  legacyAssociationId: string;
  reactivatedDocument: boolean;
  replayed: boolean;
  schemaVersion: 'cimmich.document-legacy-pet.v1';
  undoneDecisionId?: string;
};

export type CimmichIdentityCandidate = {
  asset_id: string;
  box_h: number;
  box_w: number;
  box_x: number;
  box_y: number;
  calibrated_confidence: number | null;
  capture_time: string | null;
  current_claim_id?: string | null;
  current_person_id?: string | null;
  current_person_name?: string | null;
  detection_confidence: number;
  display_name: string;
  face_id: string;
  filename: string;
  height: number;
  identity_claim_id: string;
  media_kind: 'image' | 'video';
  match_score?: number | null;
  person_id: string;
  quality_measurements: Record<string, number | string>;
  sourceAssetId: string;
  source_margin: number | null;
  source_score: number | null;
  width: number;
};

export type CimmichPerson = {
  accepted_faces: number;
  aliases: string[];
  asset_count: number;
  bodyPreview?: {
    bodyId: string;
    box_h: number;
    box_w: number;
    box_x: number;
    box_y: number;
    schemaVersion: 'cimmich.person-body-preview.v1';
    sourceAssetId: string;
  } | null;
  box_h: number | null;
  box_w: number | null;
  box_x: number | null;
  box_y: number | null;
  candidate_faces: number;
  categories: CimmichPersonCategory[];
  display_name: string;
  filename: string;
  head_faces: number;
  needs_sort: boolean;
  needs_holding: boolean;
  person_id: string;
  photo_history?: {
    futureCaptureDateCount: number;
    maxCaptureTime: string | null;
    minCaptureTime: string | null;
    schemaVersion: 'cimmich.person-photo-history.v1';
  };
  prime_faces: number;
  representative_asset_id: string | null;
  representative_face_id: string | null;
  secondary_faces: number;
  sourceAssetId: string;
  status: 'active' | 'hidden';
  subject_kind: 'person' | 'pet';
};

export type CimmichPersonPresentationSlot = 'body' | 'face' | 'hero';

export type CimmichPersonPresentationMedia = {
  assetId: string;
  crop: CimmichPetCoverCrop | null;
  filename: string;
  observationId: string | null;
  observationKind: 'body' | 'face' | 'presence';
  slotKind: CimmichPersonPresentationSlot;
  sourceAssetId: string;
  updatedAt: string;
};

export type CimmichPersonPresentation = {
  body: CimmichPersonPresentationMedia | null;
  face: CimmichPersonPresentationMedia | null;
  hero: CimmichPersonPresentationMedia | null;
  personId: string;
  schemaVersion: 'cimmich.person-presentation-media.v1';
};

export type CimmichPetCoverCrop = {
  h: number;
  w: number;
  x: number;
  y: number;
};

export type CimmichPetSpeciesKind = 'bird' | 'cat' | 'dog' | 'fish' | 'other' | 'rabbit' | 'reptile' | 'small_mammal';

export type CimmichPetConnection = {
  coverAssetId: string | null;
  direction: 'incoming';
  displayName: string;
  relationType: string;
  targetId: string;
  targetKind: 'event' | 'object' | 'place';
  typeKind: CimmichContextTypeKind | null;
};

export type CimmichPet = {
  aliases: string[];
  breedLabel: string | null;
  confirmedMediaCount: number;
  connections: CimmichPetConnection[];
  cover: {
    assetId: string;
    crop: CimmichPetCoverCrop | null;
    filename: string;
    sourceAssetId: string;
  } | null;
  description: string;
  displayName: string;
  documentCount: number;
  petId: string;
  projection: {
    revision: number;
    state: 'current';
  };
  speciesKind: CimmichPetSpeciesKind | null;
  speciesLabel: string | null;
  status: 'active' | 'hidden';
  visibility: CimmichVisibilityObject;
};

export type CimmichPetMedia = {
  asset_id: string;
  association_types: Array<'body' | 'face' | 'head' | 'presence'>;
  capture_time: string | null;
  filename: string;
  height: number;
  media_kind: 'image' | 'video';
  sourceAssetId: string;
  width: number;
};

export type CimmichPetDocumentKind =
  | 'adoption'
  | 'care'
  | 'insurance'
  | 'other'
  | 'receipt'
  | 'registration'
  | 'vaccination'
  | 'veterinary';

export type CimmichPetDocument = {
  assetId: string;
  associationId: string;
  captureTime: string | null;
  documentKind: CimmichPetDocumentKind;
  documentLabel: string | null;
  filename: string;
  height: number;
  linkedAt: string;
  mediaKind: 'image' | 'video';
  mimeType: string;
  sourceAssetId: string;
  width: number;
};

export type CimmichPetDocumentMutationResult = {
  changedAssetIds?: string[];
  decisionId: string;
  documents: CimmichPetDocument[];
  replayed: boolean;
  restoredAssetIds?: string[];
  schemaVersion: 'cimmich.pet-document.v1';
  status: 'applied' | 'no_change' | 'reverted';
  supersedesDecisionId?: string;
  unchangedAssetIds?: string[];
  undo?: { eligible: boolean; token: string | null };
};

export type CimmichPetMutationResult = {
  changedAssetIds?: string[];
  decisionId: string;
  pet: CimmichPet;
  replayed: boolean;
  restoredAssetIds?: string[];
  schemaVersion: 'cimmich.pet-manual.v2';
  status: 'applied' | 'no_change' | 'reverted';
  supersedesDecisionId?: string;
  unchangedAssetIds?: string[];
  undo?: {
    eligible: boolean;
    token: string | null;
  };
};

export type CimmichPetCreateInput = {
  aliases?: string[];
  breedLabel?: string | null;
  commandId: string;
  coverAssetId?: string | null;
  coverCrop?: CimmichPetCoverCrop | null;
  description?: string;
  displayName: string;
  speciesKind?: CimmichPetSpeciesKind | null;
  speciesLabel?: string | null;
};

export type CimmichPetUpdateInput = Omit<Partial<CimmichPetCreateInput>, 'commandId' | 'displayName'> & {
  commandId: string;
  displayName?: string;
  status?: 'active' | 'hidden';
};

export type CimmichPersonCategory = {
  category_id: string;
  category_kind: 'relationship' | 'workflow';
  name: string;
  slug: 'close-friends' | 'co-workers' | 'family' | 'friends' | 'me' | 'sort' | string;
  sort_order: number;
};

export type CimmichPersonAlias = {
  alias_id: string;
  alias_kind: 'former_name' | 'imported' | 'nickname';
  created_at: string;
  label: string;
  source_subject_id: string | null;
  source_system: string | null;
};

export type CimmichPersonSetup = {
  alias_items: CimmichPersonAlias[];
  aliases: string[];
  categories: CimmichPersonCategory[];
  category_catalog: CimmichPersonCategory[];
  current_revision: number;
  display_name: string;
  merges: Array<{
    created_at: string;
    merge_operation_id: string;
    source_display_name: string;
    source_person_id: string;
  }>;
  person_id: string;
  status: 'active' | 'hidden';
  subject_kind: 'person' | 'pet';
};

export type CimmichPersonMergeResult = {
  changed: boolean;
  commandId: string;
  mergeOperationId: string;
  replayed: boolean;
  schemaVersion: 'cimmich.person-merge.v2';
  sourcePersonId: string;
  targetPersonId: string;
};

export type CimmichPersonCreateResult = {
  changed: boolean;
  commandId: string;
  createdPerson: boolean;
  decisionId?: string;
  personId: string;
  personName: string;
  replayed: boolean;
  schemaVersion: 'cimmich.person-create.v1';
  source: {
    kind: 'cimmich_native' | 'immich_person';
    sourcePersonId: string | null;
  };
  status: 'applied' | 'no_change';
  subjectKind: 'person';
};

export type CimmichPersonCreateSelector = { immichPersonId: string } | { newPersonName: string };

export type CimmichPersonProfileItemKind =
  | 'address'
  | 'custom'
  | 'email'
  | 'important_date'
  | 'phone'
  | 'social'
  | 'web'
  | 'work';

export type CimmichPersonProfileItem = {
  dateValue: string | null;
  itemId: string;
  kind: CimmichPersonProfileItemKind;
  label: string;
  revision: number;
  secondaryValue: string | null;
  value: string | null;
};

export type CimmichPersonProfileProjection = {
  items: CimmichPersonProfileItem[];
  person: {
    displayName: string;
    personId: string;
    status: 'active' | 'hidden';
  };
  profile: {
    about: string | null;
    genderIdentityKind: 'man' | 'non_binary' | 'self_described' | 'woman' | null;
    genderIdentityLabel: string | null;
    privateNotes: string | null;
    pronounsLabel: string | null;
    revision: number;
  };
  relationshipCatalog: Array<{
    categoryId: string;
    name: string;
    slug: string;
    sortOrder: number;
  }>;
  relationships: Array<{
    categoryId: string;
    name: string;
    slug: string;
    sortOrder: number;
  }>;
  schemaVersion: 'cimmich.person-profile.v1';
};

export type CimmichPersonProfileFieldKey =
  | 'about'
  | 'aliases'
  | 'gender_identity'
  | 'important_dates'
  | 'photo_history'
  | 'pronouns'
  | 'relationships'
  | 'work';

export type CimmichPersonProfileDisplayDefaults = {
  fields: Array<{
    fieldKey: CimmichPersonProfileFieldKey;
    order: number;
    visible: boolean;
  }>;
  owner: { ownerId: 'local-primary'; ownerKind: 'local_library' };
  schemaVersion: 'cimmich.person-profile.v1';
};

export type CimmichPersonProfileDisplay = {
  fields: Array<{
    defaultVisible: boolean;
    effectiveVisible: boolean;
    fieldKey: CimmichPersonProfileFieldKey;
    order: number;
    visibility: 'hide' | 'inherit' | 'show';
  }>;
  owner: { ownerId: 'local-primary'; ownerKind: 'local_library' };
  personId: string;
  schemaVersion: 'cimmich.person-profile.v1';
};

export type CimmichPersonDetailsSectionKey =
  | 'about'
  | 'address'
  | 'at_a_glance'
  | 'contact_details'
  | 'identity_summary'
  | 'important_dates'
  | 'private_notes'
  | 'social'
  | 'work';

export type CimmichPersonDetailsDisplayDefaults = {
  owner: { ownerId: 'local-primary'; ownerKind: 'local_library' };
  schemaVersion: 'cimmich.person-details-display.v1';
  sections: Array<{
    order: number;
    sectionKey: CimmichPersonDetailsSectionKey;
    visible: boolean;
  }>;
};

export type CimmichPersonDetailsDisplay = {
  owner: { ownerId: 'local-primary'; ownerKind: 'local_library' };
  personId: string;
  schemaVersion: 'cimmich.person-details-display.v1';
  sections: Array<{
    defaultVisible: boolean;
    effectiveVisible: boolean;
    order: number;
    sectionKey: CimmichPersonDetailsSectionKey;
    visibility: 'hide' | 'inherit' | 'show';
  }>;
};

export type CimmichPersonProfileItemCommand =
  | {
      action: 'add';
      item: Omit<CimmichPersonProfileItem, 'revision'>;
    }
  | {
      action: 'remove';
      itemId: string;
    }
  | {
      action: 'update';
      itemId: string;
      patch: Partial<Pick<CimmichPersonProfileItem, 'dateValue' | 'label' | 'secondaryValue' | 'value'>>;
    };

export type CimmichPersonProfilePatch = {
  about?: string | null;
  commandId: string;
  genderIdentityKind?: CimmichPersonProfileProjection['profile']['genderIdentityKind'];
  genderIdentityLabel?: string | null;
  itemCommands?: CimmichPersonProfileItemCommand[];
  privateNotes?: string | null;
  pronounsLabel?: string | null;
  relationshipCategoryIds?: string[];
};

export type CimmichPersonProfileMutationResult = {
  commandId: string;
  profile: CimmichPersonProfileProjection;
  replayed: boolean;
  schemaVersion: 'cimmich.person-profile.v1';
  status: 'applied';
};

export type CimmichPersonProjectionPage<T> = {
  items: T[];
  nextCursor: string | null;
  pageSize: number;
  schemaVersion: 'cimmich.person-projection-page.v1';
};

export type CimmichMergePreview = {
  conflicts: { duplicate_presence: number; shared_assets: number };
  source: {
    accepted_faces: number;
    aliases: number;
    assets: number;
    display_name: string;
    person_id: string;
    status: string;
    subject_kind: 'person' | 'pet';
  };
  target: {
    accepted_faces: number;
    aliases: number;
    assets: number;
    display_name: string;
    person_id: string;
    status: string;
    subject_kind: 'person' | 'pet';
  };
};

export type CimmichPersonAsset = {
  asset_id: string;
  asset_head_evidence: boolean;
  association_types: Array<'body' | 'face' | 'head' | 'presence'>;
  capture_time: string | null;
  contexts: Array<{
    displayName: string;
    entityId: string;
    entityKind: 'event' | 'object' | 'place';
    typeKind: CimmichContextTypeKind;
  }>;
  filename: string;
  height: number;
  has_linked_body: boolean;
  media_kind: 'image' | 'video';
  mime_type: string;
  presence_evidence: boolean;
  sourceAssetId: string;
  width: number;
};

export type CimmichFaceBucket = {
  bucket_id: string;
  bucket_kind: 'head' | 'lq' | 'prime' | 'secondary' | 'specialty';
  bucket_name: string | null;
  latest_action: string;
};

export type CimmichFaceModifier = {
  actorKind: 'import' | 'model' | 'policy' | 'user';
  confidence: number | null;
  metadata: Record<string, unknown>;
  modifierClass: 'condition' | 'presentation' | 'quality';
  modifierKey: string;
  modifierLabel: string;
};

export type CimmichFaceModifierProposal = {
  confidence: number;
  evidence: Record<string, unknown>;
  modelName: string;
  modelVersion: string;
  modifierClass: 'accessory_obstruction' | 'illumination' | 'pose' | 'visibility';
  modifierKey: string;
  modifierLabel: string;
  proposalId: string;
  proposedAt: string;
  providerName: string;
  state: 'candidate';
  vocabularyVersion: string;
};

export type CimmichCaptureContext = {
  confidence: number | null;
  contextId: string;
  contextKind: 'rapid_burst' | 'same_moment' | 'sequence';
  groupingFeatures: Record<string, unknown>;
  label: string;
  memberCount: number;
  memberIndex: number | null;
};

export type CimmichIdentityFace = {
  asset_id: string;
  body_assigned_person_id: string | null;
  body_box_h: number | null;
  body_box_w: number | null;
  body_box_x: number | null;
  body_box_y: number | null;
  body_id: string | null;
  body_link_origin: string | null;
  body_linked: boolean;
  body_quality_measurements: Record<string, number | string> | null;
  body_selected: boolean;
  body_supporting_face_id: string | null;
  box_h: number;
  box_w: number;
  box_x: number;
  box_y: number;
  buckets: CimmichFaceBucket[];
  capture_contexts: CimmichCaptureContext[];
  capture_time: string | null;
  detection_confidence: number;
  face_id: string;
  face_pixel_height: number;
  face_pixel_width: number;
  filename: string;
  height: number;
  identity_claim_id: string;
  main_evidence_tier: 'face_only' | 'head' | 'lq' | 'prime' | 'secondary';
  media_kind: 'image' | 'video';
  modifiers: CimmichFaceModifier[];
  modifier_proposals: CimmichFaceModifierProposal[];
  nearby_face_count: number;
  qc_flags: Array<'ambiguous_import_suffix' | 'low_detection_confidence' | 'low_quality' | 'nearby_face' | 'tiny_face'>;
  quality_measurements: Record<string, number | string>;
  sourceAssetId: string;
  source_instance_suffix: string;
  width: number;
};

export type CimmichIdentitySelectionResult = {
  bodyId?: string;
  bucketKind?: 'head' | 'lq' | 'prime' | 'secondary' | null;
  changed: boolean;
  decisionId?: string;
  faceId?: string;
  personId: string;
  selected?: boolean;
  modifierName?: string;
  proposalId?: string;
  state?: 'accept' | 'reject';
  specialtyName?: string;
};

export type CimmichDecisionResult = {
  changed: boolean;
  claimId: string;
  decisionId: string | null;
  state: 'accepted' | 'candidate' | 'rejected';
};

export type CimmichFaceReviewDispositionResult = {
  changed: boolean;
  decisionId: string | null;
  disposition: 'active' | 'later' | 'unknown';
  faceId: string;
  replayed: boolean;
  schemaVersion: 'cimmich.face-review-disposition.v1';
};

export type CimmichIdentityCorrectionResult = CimmichDecisionResult & {
  commandId: string;
  faceId: string;
  personId: string;
  replayed: boolean;
  undoneDecisionId?: string;
  undo?: { decisionId: string | null; eligible: boolean };
};

export type CimmichIdentityCorrectionHistory = {
  claimId: string;
  faceId: string;
  items: Array<{
    action: string | null;
    claimId: string;
    createdAt: string;
    decidedAt: string | null;
    decisionId: string | null;
    reasonCode: string | null;
    state: string;
    supersedesClaimId: string | null;
    supersedesDecisionId: string | null;
    undo: { decisionId: string | null; eligible: boolean };
  }>;
  personId: string;
  schemaVersion: 'cimmich.identity-correction-history.v1';
};

export type CimmichIdentityCorrectionDiscovery = {
  items: Array<{
    action: 'reject';
    claimId: string;
    createdAt: string;
    decidedAt: string;
    decisionId: string;
    faceId: string;
    personId: string;
    personName: string;
    reasonCode: 'not_this_person';
    sourceAssetId: string | null;
    state: string;
    supersedesClaimId: string | null;
    supersedesDecisionId: string | null;
    undo: { decisionId: string; eligible: boolean };
  }>;
  schemaVersion: 'cimmich.identity-correction-history.v1';
  scope: { kind: 'asset'; sourceAssetId: string } | { kind: 'person'; personId: string };
};

export type CimmichBodyPose =
  | {
      coordinateSpace: 'normalized_image';
      jointSchema: 'coco17';
      keypoints: Array<{
        confidence: number;
        index: number;
        joint: string;
        position: { x: number; y: number } | null;
      }>;
      provenance: {
        modelDigest: string;
        modelFamily: string;
        modelName: string;
        modelVersion: string;
        provider: string;
        sourceSchemaVersion: string;
      };
      schemaVersion: 'cimmich.body-pose.v1';
      skeleton: Array<[number, number]>;
      state: 'available';
      topologyId: 'coco17.v1';
    }
  | {
      reasonCode: 'POSE_INVALIDATED' | 'POSE_NOT_RETAINED' | 'POSE_PROJECTION_INVALID';
      schemaVersion: 'cimmich.body-pose.v1';
      state: 'unavailable';
    };

export type CimmichFaceCandidateMatch = {
  displayEligible: true;
  personId: string;
  personName: string;
  rank: number;
  rawScore: number;
  scoreKind: 'cosine_similarity';
  scoreMeaning: string;
};

export type CimmichObservationRegion = { h: number; w: number; x: number; y: number };

export type CimmichManualObjectRegionTag = {
  decisionId: string;
  displayName: string;
  entityId: string;
  entityKind: 'object';
  observationId: string;
  provenance: 'manual_user';
  region: CimmichObservationRegion;
  state: 'accepted';
  tagId: string;
};

export type CimmichAssetOwnerSummary = {
  decisionId: string | null;
  provenance: 'manual_user' | 'none';
  revision: number;
  summaryText: string | null;
};

export type CimmichManualObjectRegionMutationResult = {
  changed: boolean;
  decisionId: string | null;
  replayed: boolean;
  schemaVersion: 'cimmich.manual-object-region.v1';
  status: 'attached' | 'no_change' | 'rejected' | 'replaced';
  tag: CimmichManualObjectRegionTag | null;
};

export type CimmichAssetOwnerSummaryMutationResult = {
  changed: boolean;
  decisionId: string | null;
  replayed: boolean;
  schemaVersion: 'cimmich.asset-owner-summary.v1';
  status: 'cleared' | 'no_change' | 'updated';
  summary: CimmichAssetOwnerSummary;
};

export type CimmichManualPhotoContextUndoResult = {
  changed: true;
  decisionId: string;
  ownerSummary: CimmichAssetOwnerSummary;
  replayed: boolean;
  schemaVersion: 'cimmich.manual-photo-context-undo.v1';
  status: 'undone';
  thingRegions: CimmichManualObjectRegionTag[];
  undoneDecisionId: string;
};

export type CimmichDetailedObservationCorrectionResult = {
  changed: boolean;
  decisionId: string | null;
  observation: {
    assetId: string;
    decisionId: string | null;
    observationId: string;
    observationKind: 'body' | 'face';
    region: CimmichObservationRegion;
    revision: number;
    state: 'rejected' | 'valid';
  };
  replayed: boolean;
  schemaVersion: 'cimmich.detailed-observation-correction.v1';
};

export type CimmichAssetEvidence = {
  asset_id: string;
  bodies: Array<{
    body_id: string;
    box_h: number;
    box_w: number;
    box_x: number;
    box_y: number;
    display_name: string | null;
    current_decision_id: string | null;
    current_revision: number;
    face_link_confidence: number | null;
    face_link_decision_id: string | null;
    face_link_id: string | null;
    face_link_source: 'face_body_linkage' | 'geometry_policy' | 'model' | 'trusted_import' | 'user' | null;
    face_link_state: 'accepted_identity' | 'geometry' | null;
    person_id: string | null;
    pose?: CimmichBodyPose;
    quality_measurements: Record<string, number | string> | null;
    supporting_face_id: string | null;
  }>;
  capture_time: string | null;
  contexts?: Array<{
    association_kind: string;
    display_name: string;
    entity_id: string;
    entity_kind: CimmichContextEntityKind;
    type_kind: CimmichContextTypeKind;
  }>;
  faces: Array<{
    box_h: number;
    box_w: number;
    box_x: number;
    box_y: number;
    buckets: string[];
    calibrated_confidence: number | null;
    candidate_abstain_reason: 'accepted_identity' | 'no_active_embedding' | 'no_same_space_candidate' | null;
    candidate_confidence: number | null;
    candidate_display_name: string | null;
    candidate_identity_claim_id: string | null;
    candidate_person_id: string | null;
    candidate_matches: CimmichFaceCandidateMatch[];
    current_decision_id: string | null;
    current_revision: number;
    detection_confidence: number;
    display_name: string | null;
    face_id: string;
    identity_claim_id: string | null;
    person_id: string | null;
    quality_measurements: Record<string, number | string>;
    rejected_display_name: string | null;
    rejected_identity_claim_id: string | null;
    rejected_person_id: string | null;
    review_decision_id: string | null;
    review_disposition: 'active' | 'later' | 'unknown';
  }>;
  filename: string;
  height: number;
  known_people: Array<{ display_name: string; needs_holding: boolean; person_id: string }>;
  media_kind: 'image' | 'video';
  mime_type: string;
  ownerSummary?: CimmichAssetOwnerSummary;
  presence: Array<{ display_name: string; person_id: string; reason_code: string }>;
  sourceAssetId: string;
  schemaVersion: 'cimmich.asset-detailed-evidence.v2' | 'cimmich.asset-detailed-evidence.v3';
  thingRegions?: CimmichManualObjectRegionTag[];
  width: number;
};

export type CimmichManualPresenceGeometry =
  | { kind: 'point'; x: number; y: number }
  | { h: number; kind: 'region'; w: number; x: number; y: number };

export type CimmichManualPresenceAssociation = {
  associationId: string;
  assetId: string;
  decisionId: string | null;
  displayName: string;
  geometry: CimmichManualPresenceGeometry | null;
  origin: string;
  reasonCode: string;
  state: 'accepted';
  subjectId: string;
  subjectKind: 'person' | 'pet';
};

export type CimmichManualPresenceMutationResult = {
  action: 'attach' | 'detach' | 'undo';
  association: CimmichManualPresenceAssociation | null;
  assetId: string;
  changed: boolean;
  decisionId: string | null;
  replayed: boolean;
  schemaVersion: 'cimmich.manual-subject-presence.v1';
  status: 'applied' | 'no_change' | 'reverted';
  subject: {
    displayName: string;
    subjectId: string;
    subjectKind: 'person' | 'pet';
  };
  supersedesDecisionId?: string;
  undo: { decisionId: string | null; eligible: boolean };
};

export type CimmichManualSubjectTagType = 'body' | 'face' | 'head' | 'presence';

export type CimmichManualSubjectTagMatchingStatus = 'abstained' | 'inactive' | 'processing' | 'waiting_for_provider';

export type CimmichManualSubjectTag = {
  decision: { decisionId: string; state: 'active' | 'reverted' };
  geometry: { h: number; w: number; x: number; y: number };
  identityStatus?: 'accepted' | 'inactive';
  matchingReason?: string;
  matchingStatus?: CimmichManualSubjectTagMatchingStatus;
  observationId: string | null;
  provenance: 'manual_user';
  subject: {
    displayName: string;
    subjectId: string;
    subjectKind: 'person' | 'pet';
  };
  tagId: string;
  tagType: CimmichManualSubjectTagType;
  undo: { decisionId: string | null; eligible: boolean };
};

export type CimmichManualSubjectTagResult = {
  assetId: string;
  changed: boolean;
  replayed: boolean;
  schemaVersion: 'cimmich.typed-manual-subject-tag.v1' | 'cimmich.typed-manual-subject-tag.v2';
  status: 'applied' | 'no_change' | 'replaced' | 'restored' | 'reverted';
  supersedesDecisionId?: string;
  tag: CimmichManualSubjectTag;
};

export type CimmichFaceIdentityResult = {
  changed: boolean;
  claimId: string;
  createdPerson?: boolean;
  decisionId?: string;
  faceId: string;
  movedBody?: boolean;
  personId: string;
  personName: string;
  previousPersonId: string | null;
  state: 'accepted';
};

export type CimmichFaceIdentitySelector = { newPersonName: string } | { personId: string } | { personName: string };

export type CimmichFaceMatch = {
  display_name: string;
  person_id: string;
  prime_score: number;
  rank: number;
  reference_face_id?: string;
  secondary_score?: number | null;
};

export type CimmichFaceOwnerReviewMatch = Omit<CimmichFaceMatch, 'prime_score'> & {
  accepted_example_count: number;
  current_identity: boolean;
  prime_score: number | null;
  score_kind: 'cosine_similarity' | null;
  similarity: number | null;
  unavailable_reason: 'no_independent_compatible_reference_face' | null;
};

export type CimmichHoldingMatchBatch = {
  items: { faceId: string; matches: CimmichFaceMatch[] }[];
  limitPerFace: number;
  personId: string;
  requestedCount: number;
  schemaVersion: 'cimmich.person-holding-match-batch.v1';
};

export type CimmichMachineSuggestion = {
  asset_id: string;
  box_h: number;
  box_w: number;
  box_x: number;
  box_y: number;
  candidates: CimmichFaceMatch[];
  capture_time: string | null;
  detection_confidence: number;
  face_id: string;
  filename: string;
  height: number;
  margin: number | null;
  media_kind: 'image' | 'video';
  quality_measurements: Record<string, number | string>;
  quality_score: number;
  review_reason: 'close_alternatives' | 'strong_lead' | 'weak_face';
  sourceAssetId: string;
  width: number;
};

export type CimmichStewardPlan = {
  caution: string;
  focusFaceIds: string[];
  focusPersonIds: string[];
  headline: string;
  mode: 'local';
  model: string | null;
  nextAction: string;
  notice: string;
  privacy: string;
  reasons: string[];
  summary: string;
};

export type CimmichMachineSuggestionDecision = {
  changed: boolean;
  decisionId?: string;
  faceId: string;
  maintenancePending?: boolean;
  modelVersion?: string;
  personId?: string;
  personName?: string;
  state: 'accepted' | 'ignored';
};

export type CimmichEnhancedComponentStatus = {
  active: null | {
    artifactDigest: string;
    interfaceVersion: string;
    version: string;
  };
  authority: {
    automaticIdentity: 'none';
    sourcePackActivation: 'governed_operator_review_only';
    training: 'none';
  };
  available: null | { artifactDigest: string; version: string };
  coreAvailable: true;
  currentRevision: number;
  enabled: boolean;
  rollbackAvailable: boolean;
  schemaVersion: 'cimmich.enhanced-component.v1';
  state: 'disabled' | 'incompatible' | 'ready';
  updateAvailable: boolean;
};

export type CimmichEnhancedComponentMutationResult = CimmichEnhancedComponentStatus & {
  changed: boolean;
  commandId: string;
  replayed: boolean;
  shadowReplay: {
    compatible: true;
    identityTruthChanged: false;
    sourcePackActivationPerformed: false;
    sourcePacksChecked: number;
  };
};

export type CimmichIntegrationStatus = {
  bodyDetection: {
    activeConfigurations: number;
    analyzedAssets: number;
    assets: number;
    bodyObservations: number;
    detectedAssets: number;
    linkedBodies: number;
    noBodyAssets: number;
    state: 'complete' | 'not_started' | 'partial';
  };
  enhanced: CimmichEnhancedComponentStatus | null;
  faceMatching: {
    automaticIdentityAuthority: 'none';
    basicIdentityTruthRetainedWhenDisabled: boolean;
    provider:
      | { configured: false }
      | {
          configured: true;
          modelFamily: string;
          modelVersion: string;
          providerId: string;
        };
    review: {
      enabled: boolean;
      humanAcceptanceRequired: true;
      marginFloor: number | null;
      policyVersion: string;
      scoreFloor: number | null;
    };
    schemaVersion: 'cimmich.face-matching-status.v1';
    sourcePack: {
      activePassed: number;
      awaitingReview: number;
    };
    state: 'needs_operator_review' | 'needs_review_policy' | 'needs_source_pack' | 'provider_disabled' | 'ready';
  };
  guided: {
    accessEndpoint?: string;
    authentication?: string;
    bootstrapEndpoint?: string;
    canonicalAuthority?: 'operate' | 'read';
    capabilitiesEndpoint?: string;
    configured: boolean;
    enabled: boolean;
    instructionsEndpoint?: string;
    providerCredentialAccepted?: boolean;
    providerNeutral?: boolean;
    schemaVersion: string;
    visibility?: string;
    visibilityCeiling?: 'personal' | 'private' | 'standard';
  };
  schemaVersion: 'cimmich.integrations-status.v1';
};

export type CimmichImmichOnboardingScope = {
  importPeople: boolean;
  includeHiddenPeople: boolean;
  mediaKinds: Array<'image' | 'video'>;
  providerMode: 'configured' | 'deferred';
  visibilities: Array<'archive' | 'hidden' | 'locked' | 'timeline'>;
};

export type CimmichImmichConnectionStatus = {
  capabilities: {
    assetRead: boolean;
    assetSearch: boolean;
    faceRead: boolean;
    mediaRead: boolean;
    personList: boolean;
    personRead: boolean;
  };
  code?: string;
  databaseIsolation: 'separate';
  immichVersion?: string;
  principal?: { isAdmin: boolean; userId: string };
  readOnly: true;
  schemaVersion: 'cimmich.immich-companion.v1';
  state: 'auth_failed' | 'incompatible' | 'not_configured' | 'ready' | 'unavailable';
  supportedRange: string;
};

export type CimmichImmichOnboardingStatus = {
  connection: CimmichImmichConnectionStatus;
  latestRun: null | {
    commandId: string;
    completedAt: string | null;
    previewDigest: string;
    progress: Record<string, unknown>;
    result: CimmichImmichOnboardingImportResult | null;
    runId: string;
    scope: CimmichImmichOnboardingScope;
    startedAt: string;
    state: 'completed' | 'conflict' | 'importing' | 'interrupted';
    updatedAt: string;
  };
  next: 'connect' | 'preview' | 'resume_import' | 'review_summary';
  schemaVersion: 'cimmich.immich-onboarding.v1';
};

export type CimmichImmichOnboardingPreview = {
  connection: {
    immichVersion: string;
    permissionVerification: 'verified' | 'verified_empty_library';
    permissions: {
      assets: true;
      faces: true;
      locked: 'interactive_elevated_session_required';
      media: boolean;
      people: true;
    };
    principalId: string;
    readOnly: true;
  };
  counts: {
    assignedFaces: number;
    assets: number;
    hiddenPeople: number;
    images: number;
    labelledPeople: number;
    people: number;
    unassignedFaces: number;
    unlabelledPeople: number;
    videos: number;
    visibilityLanes: Partial<Record<'archive' | 'hidden' | 'timeline', number>>;
  };
  coverage: {
    visibilityLanes: Partial<Record<'archive' | 'hidden' | 'timeline', { accessState: string; itemCount: number }>>;
  };
  previewDigest: string;
  schemaVersion: 'cimmich.immich-onboarding.v1';
  scope: CimmichImmichOnboardingScope;
  unsupported: {
    albums: string;
    exif: string;
    genericTags: string;
    locked: string;
  };
};

export type CimmichImmichOnboardingImportResult = {
  changed: boolean;
  commandId: string;
  import: {
    ambiguous?: number;
    assignedFaces: number;
    exactProviderBinds?: number;
    importedSourceFaces?: number;
    personConflicts?: number;
    projectedPeople?: number;
    reviewItems?: number;
    unassignedFaces?: number;
  };
  inventory?: { activeAssets: number; runId: string | null };
  next: {
    action: 'configure_provider_or_build_when_ready' | 'resume_provider_analysis';
    automaticIdentityAuthority: 'none';
    sourcePackActivation: 'not_performed';
  };
  replayed: boolean;
  runId: string;
  schemaVersion: 'cimmich.immich-onboarding.v1';
  state: 'completed' | 'completed_with_review' | 'no_change';
};

export type CimmichImmichPersonResolutionAction = 'create_person' | 'existing_person' | 'later' | 'noise' | 'unknown';

export type CimmichImmichPersonCluster = {
  faceCount: number;
  immichPersonId: string;
  representative: {
    assetInputRevision: string;
    box: { h: number; w: number; x: number; y: number };
    faceId: string;
    sourceAssetId: string;
  };
  resolution:
    | { state: 'stale' | 'unresolved' }
    | {
        action: CimmichImmichPersonResolutionAction;
        decisionId: string;
        personId: string | null;
        resolutionId: string;
        state: 'later' | 'resolved';
      };
  snapshotDigest: string;
  sourceRevision: string;
};

export type CimmichImmichPersonClusterPreview = {
  clusters: CimmichImmichPersonCluster[];
  schemaVersion: 'cimmich.immich-person-resolution.v1';
  scope: CimmichImmichOnboardingScope;
};

export type CimmichImmichPersonResolutionResult = {
  changed: boolean;
  cluster?: {
    faceCount: number;
    immichPersonId: string;
    snapshotDigest: string;
    sourceRevision: string;
  };
  createdPerson?: boolean;
  decisionId?: string;
  immichPersonId?: string;
  replayed: boolean;
  resolution: null | {
    action: CimmichImmichPersonResolutionAction;
    decisionId: string;
    personId: string | null;
    resolutionId: string;
    state: 'later' | 'resolved';
  };
  schemaVersion: 'cimmich.immich-person-resolution.v1';
  state?: 'reverted';
  undo?: { available: true; decisionId: string };
};

export type CimmichSourcePackProjection = {
  evaluation: {
    evaluationId: string | null;
    reason: string | null;
    status: 'failed' | 'incomplete' | 'passed' | 'untested';
  };
  evidence: {
    people: number;
    primeFaces: number;
    prototypes: number;
    references: number;
    secondaryFaces: number;
  };
  packId: string;
  predecessorPackId: string | null;
  rollbackAvailable: boolean;
  state: 'active' | 'proposed' | 'rejected' | 'retired' | 'shadow';
};

export type CimmichSourcePackGateReceipt = {
  authorityScope: 'human-review';
  cohortDigest: string;
  leakage: { passed: true; queryReferenceOverlap: 0 } & Record<string, unknown>;
  matcherPolicy: null | {
    marginFloor: number;
    policyVersion: 'cimmich-best-prime-v1';
    scoreFloor: number;
    scorer: 'best_individual_prime';
  };
  metrics: {
    decisionPrecisionPercent: number;
    knownCorrectCoveragePercent: number;
    unknownFalseAcceptRatePercent: number;
    verifiedUnknowns: number;
  };
  packId: string;
  schemaVersion: 'cimmich.source-pack-gate-evaluation.v1';
  status: 'failed' | 'passed';
  thresholds: {
    maximumUnknownFalseAcceptRatePercent: number;
    minimumDecisionPrecisionPercent: number;
    minimumVerifiedUnknowns: number;
  };
};

export type CimmichSourcePackReviewGateNullReason =
  | 'CALIBRATION_KNOWN_COHORT_MISSING'
  | 'CALIBRATION_UNKNOWN_COHORT_MISSING'
  | 'EVALUATION_ARTIFACT_INVALID'
  | 'EVALUATION_REQUIRED'
  | 'HOLDOUT_KNOWN_COHORT_MISSING'
  | 'INSUFFICIENT_VERIFIED_UNKNOWNS'
  | 'LEAKAGE_OR_PROVENANCE_CHECK_FAILED'
  | 'NO_USEFUL_REVIEW_COVERAGE'
  | 'REVIEW_GATE_NOT_DERIVED';

export type CimmichFaceMatchingOperatorStatus = CimmichIntegrationStatus['faceMatching'] & {
  evidence: {
    acceptedFaces: number;
    providerEmbeddings: number;
  };
  latestPack: CimmichSourcePackProjection | null;
  next: {
    action:
      | 'compile_source_pack'
      | 'configure_provider'
      | 'enable_enhanced'
      | 'evaluate_source_pack'
      | 'activate_source_pack'
      | 'record_operator_review'
      | 'review_suggestions'
      | 'run_recognition';
    reason: string;
    settings?: string;
  };
  providerValidation:
    | { state: 'disabled' }
    | {
        modelFamily: string;
        modelVersion: string;
        providerId: string;
        state: 'ready';
        vectorSpaceId: string;
      };
  reviewGateReceipt: CimmichSourcePackGateReceipt | null;
  reviewGateReceiptNullReason: CimmichSourcePackReviewGateNullReason | null;
};

export type CimmichFaceMatchingOperatorResult = {
  automaticIdentityAuthority: 'none';
  changed?: boolean;
  evaluation?: {
    evaluationId: string | null;
    gateContract: string;
    leakage: { passed: boolean; queryReferenceOverlap: number };
    metrics: Array<{
      accuracy: number;
      correct: number;
      lane: string;
      macroAccuracy: number;
      people: number;
      queries: number;
      routedQueries: number;
      split: string;
    }>;
    reason: string;
    reviewArtifact: null | {
      cohortDigest: string;
      split: Record<string, unknown>;
      verifiedUnknowns: number;
    };
    status: 'failed' | 'incomplete' | 'passed' | 'untested';
  };
  pack?: CimmichSourcePackProjection;
  plan?: {
    calibrationQueries: number;
    completePeople: number;
    holdoutQueries: number;
    reason: string | null;
    referenceEvidence: number;
    referencePeople: number;
    reviewability: 'operator_hold_required' | 'temporal_holdout_ready';
    schemaVersion: 'cimmich.owner-source-pack-plan.v1';
    strategy: 'all_current_evidence_proposed_only' | 'deterministic_three_window';
  };
  replayed: boolean;
  reviewGateReceipt?: CimmichSourcePackGateReceipt | null;
  reviewGateReceiptNullReason?: CimmichSourcePackReviewGateNullReason | null;
  schemaVersion: 'cimmich.face-matching-operator.v1';
};

export type CimmichFaceRecognitionRun = {
  automaticIdentityAuthority: 'none';
  commandId: string;
  inventory: { admittedAssetCount: number; state: string | null } | null;
  queue: { failed: number; paused: number; pending: number; processing: number };
  replayed: boolean;
  schemaVersion: 'cimmich.face-matching-operator.v1';
  state: 'backpressure' | 'budget_exhausted' | 'completed' | 'paused';
  work: { detections: number; inventoryPages: number; recognitions: number };
};

export type CimmichFaceMatchingActivationResult = {
  activated: boolean;
  automaticIdentityAuthority: 'none';
  changed: boolean;
  pack: CimmichSourcePackProjection;
  replayed: boolean;
  retiredPackIds: string[];
  schemaVersion: 'cimmich.face-matching-operator.v1';
};

export type CimmichSourcePackReadResult = {
  automaticIdentityAuthority: 'none';
  pack: CimmichSourcePackProjection;
  reviewGateReceipt: CimmichSourcePackGateReceipt | null;
  reviewGateReceiptNullReason: CimmichSourcePackReviewGateNullReason | null;
  schemaVersion: 'cimmich.face-matching-operator.v1';
};

export type CimmichSourcePackReviewResult = {
  automaticIdentityAuthority: 'none';
  changed: boolean;
  disposition: 'failed' | 'passed';
  pack: CimmichSourcePackProjection;
  replayed: boolean;
  schemaVersion: 'cimmich.face-matching-operator.v1';
};

export type CimmichSourcePackRollbackResult = {
  automaticIdentityAuthority: 'none';
  changed: boolean;
  replayed: boolean;
  restoredPackId: string;
  rolledBack: boolean;
  schemaVersion: 'cimmich.face-matching-operator.v1';
};

export type CimmichIntegrationSettingsPack = {
  bodyDetection: {
    accepts: string;
    adapterContract: string;
    automaticIdentityAuthority: 'none';
    bundledModels: false;
    conformance: string;
    evidenceIntake: {
      commitContract: string;
      operatorEntrypoint: string;
      providerOutputIsIdentityTruth: false;
      replayRunsRequired: number;
    };
    examples: Array<{
      adapter: string;
      licence: string;
      modelSource: string | null;
      providerSource: string | null;
      role: string;
      testedSettings?: {
        device: string;
        imageSize: number;
        maximumRuntimeMs: number;
        modelId: string;
        threshold: number;
      } | null;
    }>;
    modelAcquisition: string;
    sourceMedia: string;
  };
  faceRecognition: {
    accepts: string;
    adapterContract: string;
    automaticIdentityAuthority: 'none';
    bundledModels: false;
    enablement: {
      basicIdentityTruthRetainedWhenDisabled: true;
      environment: {
        provider: string;
        python: string;
        sfaceModel: string;
        yunetModel: string;
      };
      providerValue: string;
      stateEndpoint: string;
    };
    evidenceLifecycle: {
      activation: string;
      compileEntrypoint: string;
      evaluateEntrypoint: string;
      lifecycleEntrypoint: string;
      matcher: string;
      reviewPolicyThresholds: string;
      suggestionAuthority: string;
    };
    modelAcquisition: string;
    examples: Array<{
      adapter: string;
      installEntrypoint?: string;
      licenceNotes?: string;
      models?: Array<{
        id: string;
        licence: string;
        sha256: string;
        source: string;
      }>;
      modelSource: string | null;
      providerSource: string | null;
      role: string;
      testedSettings?: {
        detectorInput: [number, number];
        detectorThreshold: number;
        device: string;
        embeddingDimension: number;
        metric: string;
        normalized: boolean;
        opencv: string;
        threads: number;
      };
    }>;
  };
  policy: {
    cimmichDownloadsModelsAutomatically: false;
    cimmichSelectsProvider: false;
    modelArtifactsInRepository: false;
    operatorOwnsLicenceAndDisclosureDecision: true;
    statement: string;
  };
  schemaVersion: 'cimmich.integration-settings.v1';
};

export class CimmichServiceError extends Error {
  code: string;
  details?: Record<string, unknown>;
  status: number;

  constructor(message: string, options: { code: string; details?: Record<string, unknown>; status: number }) {
    super(message);
    this.name = 'CimmichServiceError';
    this.code = options.code;
    this.details = options.details;
    this.status = options.status;
  }
}

const apiRoot = (env.PUBLIC_CIMMICH_API_URL || 'http://127.0.0.1:3101').replace(/\/$/, '');

let cimmichVisibilityDeviceId: string | undefined;
let cimmichVisibilityIntentSequence: number | undefined;
let cimmichVisibilityPrincipalId: string | undefined;
let cimmichVisibilityPrivateToken: string | undefined;

const visibilityDeviceStorageKey = 'cimmich.visibility.device-id.v1';
const visibilityIntentSequenceStorageKey = 'cimmich.visibility.intent-sequence.v1';
const visibilityPrincipalStorageKey = 'cimmich.visibility.principal-id.v1';
const visibilityDeviceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const visibilityPrincipalIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

const visibilityDeviceId = () => {
  if (cimmichVisibilityDeviceId) {
    return cimmichVisibilityDeviceId;
  }
  try {
    const stored = globalThis.localStorage?.getItem(visibilityDeviceStorageKey) || '';
    if (visibilityDeviceIdPattern.test(stored)) {
      cimmichVisibilityDeviceId = stored;
      return stored;
    }
  } catch {
    // Storage may be unavailable in SSR or privacy-restricted browsers.
  }
  cimmichVisibilityDeviceId = crypto.randomUUID();
  try {
    globalThis.localStorage?.setItem(visibilityDeviceStorageKey, cimmichVisibilityDeviceId);
  } catch {
    // The in-memory device remains valid for this page session.
  }
  return cimmichVisibilityDeviceId;
};

const visibilityPrincipalId = () => {
  if (cimmichVisibilityPrincipalId) {
    return cimmichVisibilityPrincipalId;
  }
  try {
    const stored = globalThis.localStorage?.getItem(visibilityPrincipalStorageKey) || '';
    if (visibilityPrincipalIdPattern.test(stored)) {
      cimmichVisibilityPrincipalId = stored;
      return stored;
    }
  } catch {
    // Storage may be unavailable in SSR or privacy-restricted browsers.
  }
  return undefined;
};

const bindVisibilityPrincipalId = (value: string) => {
  if (!visibilityPrincipalIdPattern.test(value)) {
    return;
  }
  cimmichVisibilityPrincipalId = value;
  try {
    globalThis.localStorage?.setItem(visibilityPrincipalStorageKey, value);
  } catch {
    // The in-memory principal remains valid for this page session.
  }
};

export const createCimmichViewingModeIntentSequence = () => {
  if (cimmichVisibilityIntentSequence === undefined) {
    let storedSequenceText: string | null = null;
    try {
      storedSequenceText = globalThis.localStorage?.getItem(visibilityIntentSequenceStorageKey) ?? null;
    } catch {
      // Storage may be unavailable in SSR or privacy-restricted browsers.
    }
    const storedSequence = storedSequenceText === null ? Number.NaN : Number(storedSequenceText);
    cimmichVisibilityIntentSequence =
      Number.isSafeInteger(storedSequence) && storedSequence >= 0 ? storedSequence : Date.now();
  }
  if (cimmichVisibilityIntentSequence >= Number.MAX_SAFE_INTEGER) {
    throw new CimmichServiceError('Viewing mode intent sequence is exhausted for this session', {
      code: 'VISIBILITY_INTENT_SEQUENCE_EXHAUSTED',
      status: 0,
    });
  }
  cimmichVisibilityIntentSequence += 1;
  try {
    globalThis.localStorage?.setItem(visibilityIntentSequenceStorageKey, String(cimmichVisibilityIntentSequence));
  } catch {
    // The in-memory sequence remains valid for this page session.
  }
  return cimmichVisibilityIntentSequence;
};

const visibilityHeaders = (surface: CimmichVisibilitySurface = 'interactive') => ({
  ...(visibilityPrincipalId() ? { 'x-cimmich-principal-id': cimmichVisibilityPrincipalId } : {}),
  ...(cimmichVisibilityPrivateToken ? { 'x-cimmich-private-session': cimmichVisibilityPrivateToken } : {}),
  'x-cimmich-device-id': visibilityDeviceId(),
  'x-cimmich-surface': surface,
});

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort('timeout'), 12_000);
  const abortFromCaller = () => controller.abort(init?.signal?.reason);
  init?.signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetch(`${apiRoot}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...visibilityHeaders(), ...init?.headers },
      signal: controller.signal,
    });
    const text = await response.text();
    let body: (T & { code?: string; details?: Record<string, unknown>; error?: string }) | undefined;
    if (text) {
      try {
        body = JSON.parse(text) as T & { error?: string };
      } catch {
        body = undefined;
      }
    }
    if (!response.ok) {
      const proxyMessage = text
        .replaceAll(/<[^>]*>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
      throw new CimmichServiceError(
        body?.error || proxyMessage || `Cimmich service request failed (${response.status})`,
        {
          code: body?.code || 'CIMMICH_REQUEST_FAILED',
          details: body?.details,
          status: response.status,
        },
      );
    }
    if (!body) {
      throw new Error('Cimmich service returned an empty or invalid response');
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted && !init?.signal?.aborted) {
      throw new CimmichServiceError('Cimmich service did not respond in time', {
        code: 'CIMMICH_TIMEOUT',
        status: 0,
      });
    }
    if (error instanceof TypeError) {
      throw new CimmichServiceError('Cimmich service is unavailable', {
        code: 'CIMMICH_UNAVAILABLE',
        status: 0,
      });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    init?.signal?.removeEventListener('abort', abortFromCaller);
  }
};

export const getCimmichSummary = () => request<CimmichSummary>('/v1/summary');

export const getCimmichIntegrationStatus = () => request<CimmichIntegrationStatus>('/v1/integrations/status');

export const getCimmichEnhancedComponentStatus = () => request<CimmichEnhancedComponentStatus>('/v1/operator/enhanced');

export const createCimmichEnhancedCommandId = (action: 'disable' | 'enable' | 'rollback' | 'update') =>
  `enhanced.${action}.${crypto.randomUUID()}`;

export const updateCimmichEnhancedComponent = (input: {
  action: 'disable' | 'enable' | 'rollback' | 'update';
  commandId: string;
  expectedRevision: number;
  targetVersion?: string;
}) =>
  request<CimmichEnhancedComponentMutationResult>('/v1/operator/enhanced', {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichIntegrationSettingsPack = () =>
  request<CimmichIntegrationSettingsPack>('/v1/integrations/provider-settings-pack');

export const getCimmichImmichOnboardingStatus = () => request<CimmichImmichOnboardingStatus>('/v1/onboarding/immich');

export const connectCimmichImmich = (input: { apiBaseUrl: string; commandId: string; credential: string }) =>
  request<{
    changed: boolean;
    connection: CimmichImmichConnectionStatus;
    replayed: boolean;
    schemaVersion: 'cimmich.immich-onboarding.v1';
    state: 'connected';
  }>('/v1/onboarding/immich/connect', {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const previewCimmichImmichOnboarding = (scope: CimmichImmichOnboardingScope) =>
  request<CimmichImmichOnboardingPreview>('/v1/onboarding/immich/preview', {
    body: JSON.stringify({ scope }),
    method: 'POST',
  });

export const importCimmichImmichOnboarding = (input: {
  commandId: string;
  previewDigest: string;
  scope: CimmichImmichOnboardingScope;
}) =>
  request<CimmichImmichOnboardingImportResult>('/v1/onboarding/immich/import', {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const previewCimmichImmichPersonClusters = (scope: CimmichImmichOnboardingScope) =>
  request<CimmichImmichPersonClusterPreview>('/v1/onboarding/immich/person-clusters:preview', {
    body: JSON.stringify({ scope }),
    method: 'POST',
  });

export const resolveCimmichImmichPersonCluster = (
  immichPersonId: string,
  input: {
    action: CimmichImmichPersonResolutionAction;
    commandId: string;
    expectedSourceRevision: string;
    newPersonName?: string;
    personId?: string;
    scope: CimmichImmichOnboardingScope;
    snapshotDigest: string;
  },
) =>
  request<CimmichImmichPersonResolutionResult>(
    `/v1/onboarding/immich/person-clusters/${encodeURIComponent(immichPersonId)}/resolve`,
    {
      body: JSON.stringify(input),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const undoCimmichImmichPersonClusterResolution = (
  decisionId: string,
  input: { commandId: string; scope: CimmichImmichOnboardingScope },
) =>
  request<CimmichImmichPersonResolutionResult>(
    `/v1/onboarding/immich/person-clusters/decisions/${encodeURIComponent(decisionId)}/undo`,
    {
      body: JSON.stringify(input),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const getCimmichFaceMatchingOperatorStatus = () =>
  request<CimmichFaceMatchingOperatorStatus>('/v1/operator/face-matching');

export const runCimmichFaceRecognition = (workLimit = 10) =>
  request<CimmichFaceRecognitionRun>('/v1/operator/face-matching/recognition', {
    body: JSON.stringify({ commandId: `face-matching.recognition.${crypto.randomUUID()}`, workLimit }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const compileCimmichSourcePack = () =>
  request<CimmichFaceMatchingOperatorResult>('/v1/operator/face-matching/source-packs', {
    body: '{}',
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const evaluateCimmichSourcePack = (packId: string) =>
  request<CimmichFaceMatchingOperatorResult>(
    `/v1/operator/face-matching/source-packs/${encodeURIComponent(packId)}/evaluate`,
    {
      body: '{}',
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const getCimmichSourcePack = (packId: string) =>
  request<CimmichSourcePackReadResult>(`/v1/operator/face-matching/source-packs/${encodeURIComponent(packId)}`);

export const reviewCimmichSourcePack = (packId: string, gateReceipt: CimmichSourcePackGateReceipt) =>
  request<CimmichSourcePackReviewResult>(
    `/v1/operator/face-matching/source-packs/${encodeURIComponent(packId)}/review`,
    {
      body: JSON.stringify({ gateReceipt }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const activateCimmichSourcePack = ({
  expectedCurrentPackId,
  expectedEvaluationId,
  packId,
}: {
  expectedCurrentPackId: string | null;
  expectedEvaluationId: string;
  packId: string;
}) =>
  request<CimmichFaceMatchingActivationResult>(
    `/v1/operator/face-matching/source-packs/${encodeURIComponent(packId)}/activate`,
    {
      body: JSON.stringify({ expectedCurrentPackId, expectedEvaluationId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const rollbackCimmichSourcePack = (packId: string, expectedPredecessorPackId: string) =>
  request<CimmichSourcePackRollbackResult>(
    `/v1/operator/face-matching/source-packs/${encodeURIComponent(packId)}/rollback`,
    {
      body: JSON.stringify({ expectedPredecessorPackId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const getCimmichIdentityCandidates = async (limit = 5) => {
  const result = await request<{ items: CimmichIdentityCandidate[] }>(`/v1/review/identity-claims?limit=${limit}`);
  return result.items;
};

export const getCimmichMachineSuggestions = async (limit = 24) => {
  const result = await request<{ items: CimmichMachineSuggestion[] }>(
    `/v1/review/machine-suggestions?limit=${Math.max(1, Math.min(80, limit))}`,
  );
  return result.items;
};

export const getCimmichStewardPlan = (goal = 'Find the few identity decisions with the highest value.') =>
  request<CimmichStewardPlan>('/v1/steward/plan', {
    body: JSON.stringify({ goal }),
    method: 'POST',
  });

export const acceptCimmichMachineSuggestion = (faceId: string, personId: string) =>
  request<CimmichMachineSuggestionDecision>(`/v1/review/machine-suggestions/${encodeURIComponent(faceId)}/accept`, {
    body: JSON.stringify({ personId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const markCimmichMachineSuggestionUnknown = (faceId: string) =>
  request<CimmichMachineSuggestionDecision>(`/v1/review/machine-suggestions/${encodeURIComponent(faceId)}/unknown`, {
    body: '{}',
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichPeople = async (limit = 500, query = '') => {
  const search = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) {
    search.set('q', query.trim());
  }
  const result = await request<{ items: CimmichPerson[] }>(`/v1/people?${search.toString()}`);
  return result.items;
};

export const createCimmichCommandId = (kind: string) =>
  `pet.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 32)}.${crypto.randomUUID()}`;

export const createCimmichPersonProfileCommandId = (kind: string) =>
  `profile.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 28)}.${crypto.randomUUID()}`;

export const createCimmichPersonProfileItemId = () => `profile-item.${crypto.randomUUID()}`;

export const createCimmichVisibilityCommandId = (kind: string) =>
  `visibility.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 24)}.${crypto.randomUUID()}`;

export const createCimmichManualPresenceCommandId = (kind: string) =>
  `presence.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 26)}.${crypto.randomUUID()}`;

export const createCimmichManualSubjectTagCommandId = (kind: string) =>
  `manual-tag.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 24)}.${crypto.randomUUID()}`;

export const createCimmichObservationCorrectionCommandId = (kind: string) =>
  `observation.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 22)}.${crypto.randomUUID()}`;

export const createCimmichIdentityCorrectionCommandId = (kind: string) =>
  `identity.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 25)}.${crypto.randomUUID()}`;

export const createCimmichContextCommandId = (kind: string) =>
  `context.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 26)}.${crypto.randomUUID()}`;

export const createCimmichDocumentCommandId = (kind: string) =>
  `document.${kind.replaceAll(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, 24)}.${crypto.randomUUID()}`;

export const createCimmichPersonMergeCommandId = (kind: 'merge' | 'unmerge') =>
  `person-merge.${kind}.${crypto.randomUUID()}`;

export const createCimmichPersonMergeIntentTracker = (
  createCommandId: (kind: 'merge' | 'unmerge') => string = createCimmichPersonMergeCommandId,
) => {
  let mergeIntent: { commandId: string; key: string } | undefined;
  let unmergeIntent: { commandId: string; key: string } | undefined;
  const mergeKey = (sourcePersonId: string, targetPersonId: string) => `${sourcePersonId}\u0000${targetPersonId}`;

  return {
    clearMerge() {
      mergeIntent = undefined;
    },
    completeMerge(sourcePersonId: string, targetPersonId: string) {
      if (mergeIntent?.key === mergeKey(sourcePersonId, targetPersonId)) {
        mergeIntent = undefined;
      }
    },
    completeUnmerge(mergeOperationId: string) {
      if (unmergeIntent?.key === mergeOperationId) {
        unmergeIntent = undefined;
      }
    },
    mergeCommandId(sourcePersonId: string, targetPersonId: string) {
      const key = mergeKey(sourcePersonId, targetPersonId);
      if (mergeIntent?.key !== key) {
        mergeIntent = { commandId: createCommandId('merge'), key };
      }
      return mergeIntent.commandId;
    },
    unmergeCommandId(mergeOperationId: string) {
      if (unmergeIntent?.key !== mergeOperationId) {
        unmergeIntent = { commandId: createCommandId('unmerge'), key: mergeOperationId };
      }
      return unmergeIntent.commandId;
    },
  };
};

export const createCimmichPersonCommandId = (kind: 'create' | 'reconcile') =>
  `person-create.${kind}.${crypto.randomUUID()}`;

export const createCimmichPerson = (commandId: string, selector: CimmichPersonCreateSelector) =>
  request<CimmichPersonCreateResult>('/v1/people', {
    body: JSON.stringify({ commandId, ...selector }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

const visibilityRequest = async <T>(
  path: string,
  init?: RequestInit,
  surface: CimmichVisibilitySurface = 'interactive',
) => {
  try {
    return await request<T>(path, {
      ...init,
      headers: { ...visibilityHeaders(surface), ...init?.headers },
    });
  } catch (error) {
    if (
      error instanceof CimmichServiceError &&
      (error.code === 'VISIBILITY_PRIVATE_SESSION_EXPIRED' || error.code === 'VISIBILITY_PRIVATE_SESSION_REQUIRED')
    ) {
      cimmichVisibilityPrivateToken = undefined;
    }
    throw error;
  }
};

export const getCimmichVisibilityStatus = async (surface: CimmichVisibilitySurface = 'interactive') => {
  const presentedPrincipalId = visibilityPrincipalId();
  let status = await visibilityRequest<CimmichVisibilityStatus>('/v1/visibility/status', undefined, surface);
  if (!presentedPrincipalId || status.principalId !== presentedPrincipalId) {
    bindVisibilityPrincipalId(status.principalId);
    status = await visibilityRequest<CimmichVisibilityStatus>('/v1/visibility/status', undefined, surface);
  }
  return status;
};

export const getCimmichVisibilityProjections = () =>
  request<CimmichVisibilityProjectionRegistry>('/v1/visibility/projections');

export const getCimmichContextEntities = async (
  family: CimmichContextFamily,
  options: { includeArchived?: boolean; includeHidden?: boolean; limit?: number; query?: string } = {},
) => {
  const search = new URLSearchParams({ limit: String(Math.max(1, Math.min(500, options.limit ?? 200))) });
  if (options.query?.trim()) {
    search.set('q', options.query.trim());
  }
  if (options.includeArchived) {
    search.set('includeArchived', 'true');
  }
  if (options.includeHidden) {
    search.set('includeHidden', 'true');
  }
  const result = await request<{ items: CimmichContextEntity[]; schemaVersion: 'cimmich.context-entity.v1' }>(
    `/v1/${family}?${search.toString()}`,
  );
  return result.items;
};

export const getCimmichContextEntity = (
  family: CimmichContextFamily,
  entityId: string,
  options: { includeArchived?: boolean } = {},
) => {
  const search = options.includeArchived ? '?includeArchived=true' : '';
  return request<CimmichContextDetail>(`/v1/${family}/${encodeURIComponent(entityId)}${search}`);
};

export const createCimmichContextEntity = (family: CimmichContextFamily, input: CimmichContextEntityInput) =>
  request<CimmichContextMutationResult>(`/v1/${family}`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const updateCimmichContextEntity = (
  family: CimmichContextFamily,
  entityId: string,
  input: CimmichContextEntityUpdateInput,
) =>
  request<CimmichContextMutationResult>(`/v1/${family}/${encodeURIComponent(entityId)}`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'PATCH',
  });

export const searchCimmichAddresses = (query: string, limit = 5) => {
  const search = new URLSearchParams({ limit: String(Math.max(1, Math.min(5, limit))), q: query.trim() });
  return request<CimmichAddressGeocodingResult>(`/v1/geocoding/addresses?${search.toString()}`);
};

export const getCimmichVisibleMapAssetIds = async (sourceAssetIds: string[]) => {
  const visible = new Set<string>();
  for (let offset = 0; offset < sourceAssetIds.length; offset += 500) {
    const result = await request<CimmichVisibleMapAssetsResult>('/v1/map/visible-assets', {
      body: JSON.stringify({ sourceAssetIds: sourceAssetIds.slice(offset, offset + 500) }),
      method: 'POST',
    });
    for (const sourceAssetId of result.sourceAssetIds) {
      visible.add(sourceAssetId);
    }
  }
  return visible;
};

export const deleteCimmichPlace = (
  entityId: string,
  input: { commandId: string; deleteTags: boolean; expectedRevision: number },
) =>
  request<CimmichPlaceDeleteResult>(`/v1/places/${encodeURIComponent(entityId)}/delete`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const deleteCimmichObject = (
  entityId: string,
  input: { commandId: string; deleteTags: boolean; expectedRevision: number },
) =>
  request<CimmichObjectDeleteResult>(`/v1/objects/${encodeURIComponent(entityId)}/delete`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const setCimmichPlaceCover = (
  placeId: string,
  input: { commandId: string; expectedRevision: number; sourceAssetId: string | null },
) =>
  request<CimmichPlaceCoverResult>(`/v1/places/${encodeURIComponent(placeId)}/cover`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const setCimmichObjectCover = (
  objectId: string,
  input: { commandId: string; expectedRevision: number; sourceAssetId: string | null },
) =>
  request<CimmichObjectCoverResult>(`/v1/objects/${encodeURIComponent(objectId)}/cover`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const setCimmichEventCover = (
  eventId: string,
  input: { commandId: string; expectedRevision: number; sourceAssetId: string | null },
) =>
  request<CimmichEventCoverResult>(`/v1/events/${encodeURIComponent(eventId)}/cover`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const attachCimmichContextAssets = (
  family: CimmichContextFamily,
  entityId: string,
  commandId: string,
  assets: Array<{ assetId: string; associationKind: string }>,
) =>
  request<CimmichContextMutationResult>(`/v1/${family}/${encodeURIComponent(entityId)}/assets:attach`, {
    body: JSON.stringify({ assets, commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const detachCimmichContextAssets = (
  family: CimmichContextFamily,
  entityId: string,
  commandId: string,
  assetIds: string[],
) =>
  request<CimmichContextMutationResult>(`/v1/${family}/${encodeURIComponent(entityId)}/assets:detach`, {
    body: JSON.stringify({ assetIds, commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const attachCimmichContextRelations = (
  family: CimmichContextFamily,
  entityId: string,
  commandId: string,
  relations: Array<{ relationKind: string; targetId: string; targetKind: string }>,
) =>
  request<CimmichContextMutationResult>(`/v1/${family}/${encodeURIComponent(entityId)}/relations:attach`, {
    body: JSON.stringify({ commandId, relations }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const detachCimmichContextRelations = (
  family: CimmichContextFamily,
  entityId: string,
  commandId: string,
  relationIds: string[],
) =>
  request<CimmichContextMutationResult>(`/v1/${family}/${encodeURIComponent(entityId)}/relations:detach`, {
    body: JSON.stringify({ commandId, relationIds }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const undoCimmichContextDecision = (decisionId: string, commandId: string) =>
  request<CimmichContextMutationResult>(`/v1/context/decisions/${encodeURIComponent(decisionId)}/undo`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const searchCimmichSmart = (query: string, limit = 120) => {
  const search = new URLSearchParams({ q: query.trim(), limit: String(Math.max(1, Math.min(200, limit))) });
  return request<CimmichSmartSearchResult>(`/v1/search/smart?${search.toString()}`);
};

export const getCimmichDocuments = (
  options: {
    documentKind?: CimmichDocumentKind | '';
    includeArchived?: boolean;
    limit?: number;
    query?: string;
    subjectId?: string;
    subjectKind?: CimmichDocumentSubjectKind;
  } = {},
) => {
  const search = new URLSearchParams({ limit: String(Math.max(1, Math.min(200, options.limit ?? 200))) });
  if (options.query?.trim()) {
    search.set('q', options.query.trim());
  }
  if (options.documentKind) {
    search.set('documentKind', options.documentKind);
  }
  if (options.includeArchived) {
    search.set('includeArchived', 'true');
  }
  if (options.subjectKind && options.subjectId) {
    search.set('subjectKind', options.subjectKind);
    search.set('subjectId', options.subjectId);
  }
  return request<{ items: CimmichDocument[]; schemaVersion: 'cimmich.document.v1' }>(
    `/v1/documents?${search.toString()}`,
  );
};

export const getCimmichLegacyPetDocumentLinks = (options: { includeAdopted?: boolean; petId?: string } = {}) => {
  const search = new URLSearchParams();
  if (options.petId) {
    search.set('petId', options.petId);
  }
  if (options.includeAdopted) {
    search.set('includeAdopted', 'true');
  }
  return request<{
    items: CimmichLegacyPetDocumentLink[];
    schemaVersion: 'cimmich.document-legacy-pet.v1';
  }>(`/v1/documents/legacy-pet-links${search.toString() ? `?${search.toString()}` : ''}`);
};

export const adoptCimmichLegacyPetDocument = (
  legacyAssociationId: string,
  input: {
    commandId: string;
    displayTitle: string;
    sourceFilename?: string;
    visibilityTier: CimmichVisibilityTier;
  },
) =>
  request<CimmichLegacyPetDocumentAdoptionResult>(
    `/v1/documents/legacy-pet-links/${encodeURIComponent(legacyAssociationId)}:adopt`,
    {
      body: JSON.stringify(input),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const undoCimmichLegacyPetDocumentAdoption = (decisionId: string, commandId: string) =>
  request<CimmichLegacyPetDocumentAdoptionResult>(
    `/v1/document-legacy-pet-decisions/${encodeURIComponent(decisionId)}/undo`,
    {
      body: JSON.stringify({ commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const getCimmichDocument = (documentId: string) =>
  request<CimmichDocument>(`/v1/documents/${encodeURIComponent(documentId)}`);

export const referenceCimmichDocument = (
  input: CimmichDocumentMetadataInput & {
    assetId: string;
    commandId: string;
    sourceFilename: string;
  },
) =>
  request<CimmichDocumentMutationResult>('/v1/documents/reference', {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

const encodeDocumentMetadata = (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll(/=+$/g, '');
};

export const importCimmichDocument = async (
  file: File,
  input: CimmichDocumentMetadataInput & { commandId: string },
) => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort('timeout'), 60_000);
  try {
    const response = await fetch(`${apiRoot}/v1/documents/import`, {
      body: file,
      headers: {
        ...visibilityHeaders(),
        'content-type': file.type || 'application/octet-stream',
        'x-cimmich-actor': 'local-operator',
        'x-cimmich-document-metadata': encodeDocumentMetadata({ ...input, sourceFilename: file.name }),
      },
      method: 'POST',
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => undefined)) as
      | (CimmichDocumentMutationResult & { code?: string; details?: Record<string, unknown>; error?: string })
      | undefined;
    if (!response.ok) {
      throw new CimmichServiceError(body?.error || `Cimmich Document import failed (${response.status})`, {
        code: body?.code || 'CIMMICH_REQUEST_FAILED',
        details: body?.details,
        status: response.status,
      });
    }
    if (!body) {
      throw new Error('Cimmich service returned an empty or invalid response');
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CimmichServiceError('Cimmich Document import did not complete in time', {
        code: 'CIMMICH_TIMEOUT',
        status: 0,
      });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

export const updateCimmichDocument = (
  documentId: string,
  input: {
    commandId: string;
    displayTitle?: string;
    documentKind?: CimmichDocumentKind;
    documentLabel?: string | null;
    expiresOn?: string | null;
    issuedOn?: string | null;
    status?: 'active' | 'archived';
  },
) =>
  request<CimmichDocumentMutationResult>(`/v1/documents/${encodeURIComponent(documentId)}`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'PATCH',
  });

export const attachCimmichDocumentLinks = (
  documentId: string,
  commandId: string,
  links: Array<Pick<CimmichDocumentLink, 'relationKind' | 'subjectId' | 'subjectKind'>>,
) =>
  request<CimmichDocumentMutationResult>(`/v1/documents/${encodeURIComponent(documentId)}/links:attach`, {
    body: JSON.stringify({ commandId, links }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const detachCimmichDocumentLinks = (
  documentId: string,
  commandId: string,
  links: Array<Pick<CimmichDocumentLink, 'relationKind' | 'subjectId' | 'subjectKind'>>,
) =>
  request<CimmichDocumentMutationResult>(`/v1/documents/${encodeURIComponent(documentId)}/links:detach`, {
    body: JSON.stringify({ commandId, links }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const undoCimmichDocumentDecision = (decisionId: string, commandId: string) =>
  request<CimmichDocumentMutationResult>(`/v1/document-decisions/${encodeURIComponent(decisionId)}/undo`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichDocumentContent = async (
  documentId: string,
  options: { download?: boolean } = {},
): Promise<CimmichDocumentContent> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort('timeout'), 30_000);
  try {
    const response = await fetch(
      `${apiRoot}/v1/documents/${encodeURIComponent(documentId)}/content${options.download ? '?download=true' : ''}`,
      { cache: 'no-store', headers: visibilityHeaders(), signal: controller.signal },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        | { code?: string; details?: { assetId?: string }; error?: string }
        | undefined;
      if (body?.code === 'DOCUMENT_CONTENT_IMMICH_OWNED' && body.details?.assetId) {
        return { assetId: body.details.assetId, kind: 'immich_asset' };
      }
      throw new CimmichServiceError(body?.error || `Cimmich Document content failed (${response.status})`, {
        code: body?.code || 'CIMMICH_REQUEST_FAILED',
        details: body?.details,
        status: response.status,
      });
    }
    const contentDisposition = response.headers.get('content-disposition') || '';
    const encodedFilename = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
    const plainFilename = /filename="?([^";]+)"?/i.exec(contentDisposition)?.[1];
    const filename = encodedFilename ? decodeURIComponent(encodedFilename) : plainFilename || 'document';
    const blob = await response.blob();
    return {
      blob,
      disposition: contentDisposition.toLowerCase().startsWith('attachment') ? 'attachment' : 'inline',
      filename,
      kind: 'cimmich_file',
      mimeType: response.headers.get('content-type') || 'application/octet-stream',
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CimmichServiceError('Cimmich Document content did not respond in time', {
        code: 'CIMMICH_TIMEOUT',
        status: 0,
      });
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

export const setCimmichViewingMode = (
  viewingMode: CimmichViewingMode,
  intentSequence = createCimmichViewingModeIntentSequence(),
) =>
  visibilityRequest<CimmichViewingModeMutationResult>('/v1/visibility/mode', {
    body: JSON.stringify({ intentSequence, viewingMode }),
    method: 'POST',
  });

export const unlockCimmichPrivateMode = async (password: string) => {
  const result = await visibilityRequest<{
    expiresAt: string;
    privateSessionToken: string;
    schemaVersion: 'cimmich.visibility.v1';
    viewingMode: 'private';
  }>('/v1/visibility/unlock', {
    body: JSON.stringify({ password }),
    method: 'POST',
  });
  cimmichVisibilityPrivateToken = result.privateSessionToken;
  return { expiresAt: result.expiresAt, schemaVersion: result.schemaVersion, viewingMode: result.viewingMode };
};

/**
 * The Private password is a presentation filter, not account security: Immich
 * owns access. Setting or clearing it therefore needs no previous password, and
 * either action ends any live Private session.
 */
export const getCimmichPrivateCredentialStatus = () =>
  visibilityRequest<CimmichPrivateCredentialStatus>('/v1/visibility/credential');

export const setCimmichPrivateCredential = async (password: string) => {
  const result = await visibilityRequest<CimmichPrivateCredentialStatus>('/v1/visibility/credential', {
    body: JSON.stringify({ password }),
    method: 'POST',
  });
  cimmichVisibilityPrivateToken = undefined;
  return result;
};

export const clearCimmichPrivateCredential = async () => {
  const result = await visibilityRequest<CimmichPrivateCredentialStatus>('/v1/visibility/credential', {
    method: 'DELETE',
  });
  cimmichVisibilityPrivateToken = undefined;
  return result;
};

export const lockCimmichPrivateMode = async (
  reason: 'account_lock' | 'background' | 'device_lock' | 'explicit' = 'explicit',
) => {
  try {
    return await visibilityRequest<CimmichVisibilityStatus>('/v1/visibility/lock', {
      body: JSON.stringify({ reason }),
      method: 'POST',
    });
  } finally {
    cimmichVisibilityPrivateToken = undefined;
  }
};

export const getCimmichVisibilityObject = (
  objectScope: CimmichVisibilityScope,
  objectId: string,
  surface: CimmichVisibilitySurface = 'interactive',
) =>
  visibilityRequest<CimmichVisibilityObject>(
    `/v1/visibility/objects/${encodeURIComponent(objectScope)}/${encodeURIComponent(objectId)}`,
    undefined,
    surface,
  );

export const setCimmichVisibilityObject = (
  objectScope: CimmichVisibilityScope,
  objectId: string,
  visibilityTier: CimmichVisibilityTier,
  commandId = createCimmichVisibilityCommandId('set-object'),
) =>
  visibilityRequest<CimmichVisibilityMutationResult>(
    `/v1/visibility/objects/${encodeURIComponent(objectScope)}/${encodeURIComponent(objectId)}`,
    {
      body: JSON.stringify({ commandId, visibilityTier }),
      method: 'PATCH',
    },
  );

export const setCimmichVisibilityObjects = (
  objects: Array<{
    objectId: string;
    objectScope: CimmichVisibilityScope;
    visibilityTier: CimmichVisibilityTier;
  }>,
  commandId = createCimmichVisibilityCommandId('set-objects'),
) =>
  visibilityRequest<CimmichVisibilityMutationResult>('/v1/visibility/objects', {
    body: JSON.stringify({ commandId, objects }),
    method: 'PATCH',
  });

export const undoCimmichVisibilityDecision = (
  decisionId: string,
  commandId = createCimmichVisibilityCommandId('undo'),
) =>
  visibilityRequest<CimmichVisibilityMutationResult>(
    `/v1/visibility/decisions/${encodeURIComponent(decisionId)}/undo`,
    {
      body: JSON.stringify({ commandId }),
      method: 'POST',
    },
  );

export const getCimmichPets = async (options: { includeHidden?: boolean; limit?: number; query?: string } = {}) => {
  const search = new URLSearchParams({ limit: String(Math.max(1, Math.min(500, options.limit ?? 100))) });
  if (options.query?.trim()) {
    search.set('q', options.query.trim());
  }
  if (options.includeHidden) {
    search.set('includeHidden', 'true');
  }
  const result = await request<{ items: CimmichPet[]; schemaVersion: 'cimmich.pet-manual.v2' }>(
    `/v1/pets?${search.toString()}`,
  );
  return result.items;
};

export const getCimmichPet = (petId: string) => request<CimmichPet>(`/v1/pets/${encodeURIComponent(petId)}`);

export const createCimmichPet = (input: CimmichPetCreateInput) =>
  request<CimmichPetMutationResult>('/v1/pets', {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const updateCimmichPet = (petId: string, input: CimmichPetUpdateInput) =>
  request<CimmichPetMutationResult>(`/v1/pets/${encodeURIComponent(petId)}`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'PATCH',
  });

export const getCimmichPetMedia = async (petId: string, limit = 500) => {
  const result = await request<{ items: CimmichPetMedia[]; schemaVersion: 'cimmich.pet-manual.v1' }>(
    `/v1/pets/${encodeURIComponent(petId)}/media?limit=${Math.max(1, Math.min(500, limit))}`,
  );
  return result.items;
};

export const getCimmichPetDocuments = (petId: string) =>
  request<{ items: CimmichPetDocument[]; petId: string; schemaVersion: 'cimmich.pet-document.v1' }>(
    `/v1/pets/${encodeURIComponent(petId)}/documents`,
  );

export const attachCimmichPetDocuments = (
  petId: string,
  input: {
    commandId: string;
    documents: Array<{ assetId: string; documentKind: CimmichPetDocumentKind; documentLabel?: string | null }>;
  },
) =>
  request<CimmichPetDocumentMutationResult>(`/v1/pets/${encodeURIComponent(petId)}/documents:attach`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const detachCimmichPetDocuments = (petId: string, commandId: string, assetIds: string[]) =>
  request<CimmichPetDocumentMutationResult>(`/v1/pets/${encodeURIComponent(petId)}/documents:detach`, {
    body: JSON.stringify({ assetIds, commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const undoCimmichPetDocumentDecision = (decisionId: string, commandId: string) =>
  request<CimmichPetDocumentMutationResult>(`/v1/pet-documents/decisions/${encodeURIComponent(decisionId)}/undo`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const setCimmichPetMedia = (
  petId: string,
  input: { assetIds: string[]; commandId: string; selected: boolean },
) =>
  request<CimmichPetMutationResult>(
    `/v1/pets/${encodeURIComponent(petId)}/media:${input.selected ? 'attach' : 'detach'}`,
    {
      body: JSON.stringify({ assetIds: input.assetIds, commandId: input.commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const undoCimmichPetDecision = (decisionId: string, commandId: string) =>
  request<CimmichPetMutationResult>(`/v1/decisions/${encodeURIComponent(decisionId)}/undo`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichPersonByName = async (name: string, personId = '') => {
  if (personId) {
    return request<CimmichPerson>(`/v1/people/${encodeURIComponent(personId)}`);
  }
  const people = await getCimmichPeople(500, name);
  return people.find((person) => person.display_name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
};

export const getCimmichPersonAssets = async (personId: string, limit = 5000) => {
  const result = await request<{ items: CimmichPersonAsset[] }>(
    `/v1/people/${encodeURIComponent(personId)}/assets?limit=${Math.max(1, Math.min(5000, limit))}`,
  );
  return result.items;
};

export const getCimmichPersonAssetsPage = (personId: string, pageSize = 120, cursor?: string) =>
  request<CimmichPersonProjectionPage<CimmichPersonAsset>>(
    `/v1/people/${encodeURIComponent(personId)}/assets?pageSize=${Math.max(1, Math.min(250, pageSize))}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

export const getCimmichPersonCandidates = async (personId: string, limit = 5000) => {
  const result = await request<{ items: CimmichIdentityCandidate[] }>(
    `/v1/people/${encodeURIComponent(personId)}/candidates?limit=${Math.max(1, Math.min(5000, limit))}`,
  );
  return result.items;
};

export const bulkAcceptCimmichPersonCandidates = (personId: string, claimIds: string[]) =>
  request<{
    accepted: Array<{ claimId: string; decisionId: string; faceId: string; previousPersonId: string | null }>;
    acceptedCount: number;
    changed: boolean;
    personId: string;
  }>(`/v1/people/${encodeURIComponent(personId)}/candidates/bulk-accept`, {
    body: JSON.stringify({ claimIds }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichPersonSetup = (personId: string) =>
  request<CimmichPersonSetup>(`/v1/people/${encodeURIComponent(personId)}/setup`);

export const getCimmichPersonProfile = (personId: string) =>
  request<CimmichPersonProfileProjection>(`/v1/people/${encodeURIComponent(personId)}/profile`);

export const getCimmichPersonPresentation = (personId: string) =>
  request<CimmichPersonPresentation>(`/v1/people/${encodeURIComponent(personId)}/presentation`);

export const setCimmichPersonPresentation = (
  personId: string,
  slotKind: CimmichPersonPresentationSlot,
  input: {
    assetId: string | null;
    crop?: CimmichPetCoverCrop | null;
    observationId?: string | null;
    observationKind?: 'body' | 'face' | 'presence';
  },
) =>
  request<CimmichPersonPresentation>(`/v1/people/${encodeURIComponent(personId)}/presentation/${slotKind}`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const patchCimmichPersonProfile = (personId: string, input: CimmichPersonProfilePatch) =>
  request<CimmichPersonProfileMutationResult>(`/v1/people/${encodeURIComponent(personId)}/profile`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'PATCH',
  });

export const getCimmichPersonProfileDisplayDefaults = () =>
  request<CimmichPersonProfileDisplayDefaults>('/v1/people/profile-display-defaults');

export const patchCimmichPersonProfileDisplayDefaults = (
  commandId: string,
  fields: CimmichPersonProfileDisplayDefaults['fields'],
) =>
  request<{
    commandId: string;
    defaults: CimmichPersonProfileDisplayDefaults;
    replayed: boolean;
    schemaVersion: 'cimmich.person-profile.v1';
    status: 'applied';
  }>('/v1/people/profile-display-defaults', {
    body: JSON.stringify({ commandId, fields }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'PATCH',
  });

export const getCimmichPersonProfileDisplay = (personId: string) =>
  request<CimmichPersonProfileDisplay>(`/v1/people/${encodeURIComponent(personId)}/profile-display`);

export const patchCimmichPersonProfileDisplay = (
  personId: string,
  commandId: string,
  overrides: Array<{
    fieldKey: CimmichPersonProfileFieldKey;
    visibility: 'hide' | 'inherit' | 'show';
  }>,
) =>
  request<{
    commandId: string;
    display: CimmichPersonProfileDisplay;
    replayed: boolean;
    schemaVersion: 'cimmich.person-profile.v1';
    status: 'applied';
  }>(`/v1/people/${encodeURIComponent(personId)}/profile-display`, {
    body: JSON.stringify({ commandId, overrides }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'PATCH',
  });

export const getCimmichPersonDetailsDisplayDefaults = () =>
  request<CimmichPersonDetailsDisplayDefaults>('/v1/people/profile-details-display-defaults');

export const patchCimmichPersonDetailsDisplayDefaults = (
  commandId: string,
  sections: CimmichPersonDetailsDisplayDefaults['sections'],
) =>
  request<{
    commandId: string;
    defaults: CimmichPersonDetailsDisplayDefaults;
    replayed: boolean;
    schemaVersion: 'cimmich.person-details-display.v1';
    status: 'applied';
  }>('/v1/people/profile-details-display-defaults', {
    body: JSON.stringify({ commandId, sections }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'PATCH',
  });

export const getCimmichPersonDetailsDisplay = (personId: string) =>
  request<CimmichPersonDetailsDisplay>(`/v1/people/${encodeURIComponent(personId)}/profile-details-display`);

export const patchCimmichPersonDetailsDisplay = (
  personId: string,
  commandId: string,
  overrides: Array<{
    sectionKey: CimmichPersonDetailsSectionKey;
    visibility: 'hide' | 'inherit' | 'show';
  }>,
) =>
  request<{
    commandId: string;
    display: CimmichPersonDetailsDisplay;
    replayed: boolean;
    schemaVersion: 'cimmich.person-details-display.v1';
    status: 'applied';
  }>(`/v1/people/${encodeURIComponent(personId)}/profile-details-display`, {
    body: JSON.stringify({ commandId, overrides }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'PATCH',
  });

export const addCimmichPersonAlias = (
  personId: string,
  label: string,
  aliasKind: 'former_name' | 'imported' | 'nickname',
) =>
  request<{ alias: CimmichPersonAlias; changed: boolean; personId: string }>(
    `/v1/people/${encodeURIComponent(personId)}/aliases`,
    {
      body: JSON.stringify({ aliasKind, label }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const removeCimmichPersonAlias = (personId: string, aliasId: string) =>
  request<{ aliasId: string; changed: boolean; personId: string }>(
    `/v1/people/${encodeURIComponent(personId)}/aliases/${encodeURIComponent(aliasId)}/remove`,
    {
      body: '{}',
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const setCimmichPersonSubjectKind = (personId: string, subjectKind: 'person' | 'pet') =>
  request<{ changed: boolean; personId: string; subjectKind: 'person' | 'pet' }>(
    `/v1/people/${encodeURIComponent(personId)}/subject-kind`,
    {
      body: JSON.stringify({ subjectKind }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const setCimmichPersonCategory = (personId: string, categoryId: string, selected: boolean) =>
  request<{ category: CimmichPersonCategory; changed: boolean; personId: string; selected: boolean }>(
    `/v1/people/${encodeURIComponent(personId)}/categories/${encodeURIComponent(categoryId)}`,
    {
      body: JSON.stringify({ selected }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const getCimmichMergePreview = (sourcePersonId: string, targetPersonId: string) => {
  const search = new URLSearchParams({ sourcePersonId, targetPersonId });
  return request<CimmichMergePreview>(`/v1/people/merge-preview?${search.toString()}`);
};

export const mergeCimmichPeople = (sourcePersonId: string, targetPersonId: string, commandId: string) =>
  request<CimmichPersonMergeResult>('/v1/people/merge', {
    body: JSON.stringify({ commandId, sourcePersonId, targetPersonId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const unmergeCimmichPeople = (mergeOperationId: string, commandId: string) =>
  request<CimmichPersonMergeResult>(`/v1/people/merges/${encodeURIComponent(mergeOperationId)}/unmerge`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichIdentityFaces = async (personId: string, limit = 5000) => {
  const result = await request<{ items: CimmichIdentityFace[] }>(
    `/v1/people/${encodeURIComponent(personId)}/identity?limit=${Math.max(1, Math.min(5000, limit))}`,
  );
  return result.items;
};

export const getCimmichIdentityFacesPage = (personId: string, pageSize = 24, cursor?: string) =>
  request<CimmichPersonProjectionPage<CimmichIdentityFace>>(
    `/v1/people/${encodeURIComponent(personId)}/identity?pageSize=${Math.max(1, Math.min(120, pageSize))}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

export const getCimmichAssetEvidence = (sourceAssetId: string) =>
  request<CimmichAssetEvidence>(`/v1/assets/evidence?sourceAssetId=${encodeURIComponent(sourceAssetId)}`);

export const createCimmichManualPhotoContextCommandId = (kind: string) =>
  `manual-photo-context-${kind}-${crypto.randomUUID()}`;

export const attachCimmichManualObjectRegion = (
  assetId: string,
  input: { commandId: string; entityId: string; region: CimmichObservationRegion },
) =>
  request<CimmichManualObjectRegionMutationResult>(`/v1/assets/${encodeURIComponent(assetId)}/manual-context-tags`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const replaceCimmichManualObjectRegion = (
  tagId: string,
  input: {
    commandId: string;
    entityId: string;
    expectedDecisionId: string;
    region: CimmichObservationRegion;
  },
) =>
  request<CimmichManualObjectRegionMutationResult>(`/v1/manual-context-tags/${encodeURIComponent(tagId)}/replace`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const rejectCimmichManualObjectRegion = (
  tagId: string,
  input: { commandId: string; expectedDecisionId: string },
) =>
  request<CimmichManualObjectRegionMutationResult>(`/v1/manual-context-tags/${encodeURIComponent(tagId)}/reject`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const setCimmichAssetOwnerSummary = (
  assetId: string,
  input: { commandId: string; expectedRevision: number; summaryText: string | null },
) =>
  request<CimmichAssetOwnerSummaryMutationResult>(`/v1/assets/${encodeURIComponent(assetId)}/owner-summary`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const undoCimmichManualPhotoContextDecision = (decisionId: string, commandId: string) =>
  request<CimmichManualPhotoContextUndoResult>(
    `/v1/manual-photo-context/decisions/${encodeURIComponent(decisionId)}/undo`,
    {
      body: JSON.stringify({ commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

const correctCimmichObservation = (
  observationKind: 'bodies' | 'faces',
  observationId: string,
  action: 'geometry' | 'not-body' | 'not-face',
  input: {
    commandId: string;
    expectedDecisionId: string | null;
    expectedRevision: number;
    region?: CimmichObservationRegion;
  },
) =>
  request<CimmichDetailedObservationCorrectionResult>(
    `/v1/${observationKind}/${encodeURIComponent(observationId)}/${action}`,
    {
      body: JSON.stringify(input),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const correctCimmichFaceGeometry = (
  faceId: string,
  input: {
    commandId: string;
    expectedDecisionId: string | null;
    expectedRevision: number;
    region: CimmichObservationRegion;
  },
) => correctCimmichObservation('faces', faceId, 'geometry', input);

export const correctCimmichBodyGeometry = (
  bodyId: string,
  input: {
    commandId: string;
    expectedDecisionId: string | null;
    expectedRevision: number;
    region: CimmichObservationRegion;
  },
) => correctCimmichObservation('bodies', bodyId, 'geometry', input);

export const markCimmichFaceNotFace = (
  faceId: string,
  input: { commandId: string; expectedDecisionId: string | null; expectedRevision: number },
) => correctCimmichObservation('faces', faceId, 'not-face', input);

export const markCimmichBodyNotBody = (
  bodyId: string,
  input: { commandId: string; expectedDecisionId: string | null; expectedRevision: number },
) => correctCimmichObservation('bodies', bodyId, 'not-body', input);

export const undoCimmichObservationCorrection = (decisionId: string, commandId: string) =>
  request<CimmichDetailedObservationCorrectionResult>(
    `/v1/observation-corrections/decisions/${encodeURIComponent(decisionId)}/undo`,
    {
      body: JSON.stringify({ commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const getCimmichManualPresences = (assetId: string) =>
  request<{
    assetId: string;
    items: CimmichManualPresenceAssociation[];
    schemaVersion: 'cimmich.manual-subject-presence.v1';
  }>(`/v1/assets/${encodeURIComponent(assetId)}/manual-presences`);

export const setCimmichManualPresence = (
  assetId: string,
  input: {
    action: 'attach' | 'detach';
    commandId: string;
    geometry?: CimmichManualPresenceGeometry | null;
    subjectId: string;
    subjectKind: 'person' | 'pet';
  },
) =>
  request<CimmichManualPresenceMutationResult>(`/v1/assets/${encodeURIComponent(assetId)}/manual-presences`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const undoCimmichManualPresence = (decisionId: string, commandId: string) =>
  request<CimmichManualPresenceMutationResult>(
    `/v1/manual-presences/decisions/${encodeURIComponent(decisionId)}/undo`,
    {
      body: JSON.stringify({ commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const getCimmichManualSubjectTags = (assetId: string) =>
  request<{
    assetId: string;
    items: CimmichManualSubjectTag[];
    schemaVersion: 'cimmich.typed-manual-subject-tag.v1' | 'cimmich.typed-manual-subject-tag.v2';
  }>(`/v1/assets/${encodeURIComponent(assetId)}/manual-subject-tags`);

export const attachCimmichManualSubjectTag = (
  assetId: string,
  input: {
    commandId: string;
    region: { h: number; w: number; x: number; y: number };
    subjectId: string;
    subjectKind: 'person' | 'pet';
    tagType: CimmichManualSubjectTagType;
  },
) =>
  request<CimmichManualSubjectTagResult>(`/v1/assets/${encodeURIComponent(assetId)}/manual-subject-tags`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const replaceCimmichManualSubjectTag = (
  tagId: string,
  input: {
    commandId: string;
    expectedDecisionId: string;
    region: { h: number; w: number; x: number; y: number };
    subjectId: string;
    subjectKind: 'person' | 'pet';
    tagType: CimmichManualSubjectTagType;
  },
) =>
  request<CimmichManualSubjectTagResult>(`/v1/manual-subject-tags/${encodeURIComponent(tagId)}/replace`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const undoCimmichManualSubjectTag = (decisionId: string, commandId: string) =>
  request<CimmichManualSubjectTagResult>(`/v1/manual-subject-tags/decisions/${encodeURIComponent(decisionId)}/undo`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichFaceMatches = async (faceId: string, limit = 5) => {
  const result = await request<{ items: CimmichFaceOwnerReviewMatch[] }>(
    `/v1/faces/${encodeURIComponent(faceId)}/matches?limit=${Math.max(1, Math.min(12, limit))}`,
  );
  return result.items;
};

export const getCimmichHoldingMatchesBatch = (personId: string, faceIds: string[], limitPerFace = 1) =>
  request<CimmichHoldingMatchBatch>(`/v1/people/${encodeURIComponent(personId)}/identity/matches:batch`, {
    body: JSON.stringify({ faceIds, limitPerFace }),
    method: 'POST',
  });

export const setCimmichFaceBucket = (
  personId: string,
  faceId: string,
  bucketKind: 'head' | 'lq' | 'prime' | 'secondary' | null,
) =>
  request<CimmichIdentitySelectionResult>(
    `/v1/people/${encodeURIComponent(personId)}/identity/faces/${encodeURIComponent(faceId)}/bucket`,
    {
      body: JSON.stringify({ bucketKind }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const setCimmichFaceModifier = (personId: string, faceId: string, modifierName: string, selected: boolean) =>
  request<CimmichIdentitySelectionResult>(
    `/v1/people/${encodeURIComponent(personId)}/identity/faces/${encodeURIComponent(faceId)}/modifiers`,
    {
      body: JSON.stringify({ modifierName, selected }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const decideCimmichFaceModifierProposal = (personId: string, proposalId: string, action: 'accept' | 'reject') =>
  request<CimmichIdentitySelectionResult>(
    `/v1/people/${encodeURIComponent(personId)}/identity/modifier-proposals/${encodeURIComponent(proposalId)}/decision`,
    {
      body: JSON.stringify({ action }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const setCimmichBodySelection = (personId: string, bodyId: string, selected: boolean) =>
  request<CimmichIdentitySelectionResult>(
    `/v1/people/${encodeURIComponent(personId)}/identity/bodies/${encodeURIComponent(bodyId)}`,
    {
      body: JSON.stringify({ selected }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const setCimmichAssetHeadEvidence = (personId: string, assetId: string, selected: boolean) =>
  request<CimmichIdentitySelectionResult>(
    `/v1/people/${encodeURIComponent(personId)}/identity/assets/${encodeURIComponent(assetId)}/head`,
    {
      body: JSON.stringify({ selected }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const rejectCimmichAcceptedIdentity = (claimId: string, commandId: string) =>
  request<CimmichIdentityCorrectionResult>(`/v1/identity-claims/${encodeURIComponent(claimId)}/not-this-person`, {
    body: JSON.stringify({ commandId, note: 'Removed from Person in the Identity workspace' }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichIdentityCorrectionHistory = (claimId: string) =>
  request<CimmichIdentityCorrectionHistory>(`/v1/identity-claims/${encodeURIComponent(claimId)}/history`);

export const getCimmichIdentityCorrectionDiscovery = (
  scope: { personId: string; sourceAssetId?: never } | { personId?: never; sourceAssetId: string },
  options: { limit?: number; undoEligible?: boolean } = {},
) => {
  const search = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, options.limit ?? 24))) });
  if (scope.personId) {
    search.set('personId', scope.personId);
  }
  if (scope.sourceAssetId) {
    search.set('sourceAssetId', scope.sourceAssetId);
  }
  if (options.undoEligible) {
    search.set('undoEligible', 'true');
  }
  return request<CimmichIdentityCorrectionDiscovery>(`/v1/identity-corrections?${search.toString()}`);
};

export const undoCimmichIdentityCorrection = (decisionId: string, commandId: string) =>
  request<CimmichIdentityCorrectionResult>(`/v1/identity-claims/decisions/${encodeURIComponent(decisionId)}/undo`, {
    body: JSON.stringify({ commandId }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const setCimmichFaceIdentity = (faceId: string, selector: CimmichFaceIdentitySelector) =>
  request<CimmichFaceIdentityResult>(`/v1/faces/${encodeURIComponent(faceId)}/identity`, {
    body: JSON.stringify(selector),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const moveCimmichIdentityFace = (
  sourcePersonId: string,
  faceId: string,
  input: { bodyId?: string; moveBody?: boolean; newPersonName?: string; targetPersonId?: string },
) =>
  request<CimmichFaceIdentityResult>(
    `/v1/people/${encodeURIComponent(sourcePersonId)}/identity/faces/${encodeURIComponent(faceId)}/move`,
    {
      body: JSON.stringify(input),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const decideCimmichIdentityCandidate = (claimId: string, action: 'accept' | 'reject' | 'restore') =>
  request<CimmichDecisionResult>(`/v1/review/identity-claims/${encodeURIComponent(claimId)}/decision`, {
    body: JSON.stringify({ action }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const setCimmichFaceReviewDisposition = (
  faceId: string,
  disposition: 'active' | 'later' | 'unknown',
  commandId: string,
) =>
  request<CimmichFaceReviewDispositionResult>(`/v1/faces/${encodeURIComponent(faceId)}/review-disposition`, {
    body: JSON.stringify({ commandId, disposition }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });
