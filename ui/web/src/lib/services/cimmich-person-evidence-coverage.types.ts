export type CimmichPersonEvidenceCoverage = {
  assets: {
    body: number;
    bodyOnly: number;
    dated: number;
    face: number;
    head: number;
    presence: number;
    total: number;
  };
  authority: {
    automaticIdentityAuthority: 'none';
    inference: 'none';
    repositoryWrites: 'none';
    sourceMutation: 'none';
  };
  context: {
    events: CimmichPersonEvidenceCoverageContext[];
    places: CimmichPersonEvidenceCoverageContext[];
    things: CimmichPersonEvidenceCoverageContext[];
  };
  observations: {
    body: number;
    face: number;
    head: number;
    pose: number;
    presence: number;
  };
  person: { displayName: string; personId: string };
  references: {
    head: number;
    lowQuality: number;
    prime: number;
    secondary: number;
  };
  review: {
    bodyWithoutPose: number;
    candidateFaces: number;
    futureDates: number;
  };
  schemaVersion: 'cimmich.person-evidence-coverage.v1';
  sourceSuggestions: Array<{
    box: { h: number; w: number; x: number; y: number };
    bucketKind: 'head' | 'lq' | 'prime' | 'secondary' | null;
    captureTime: string | null;
    faceId: string;
    filename: string;
    height: number;
    qualityScore: number | null;
    sourceAssetId: string;
    width: number;
  }>;
  time: {
    firstCaptureTime: string | null;
    lastCaptureTime: string | null;
    years: Array<{ assetCount: number; year: number }>;
  };
};

export type CimmichPersonEvidenceCoverageContext = {
  assetCount: number;
  displayName: string;
  entityId: string;
};
