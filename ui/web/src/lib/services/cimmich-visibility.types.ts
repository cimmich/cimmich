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
