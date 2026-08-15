export type CimmichSmartSplitGroup = {
  cohesionFloor: number | null;
  cohesionMedian: number | null;
  faceIds: string[];
  groupId: string;
  kind: 'clear' | 'unclear';
  label: string;
  nearestOtherSimilarity: number | null;
  physicalFaceCount: number;
  reason: 'conservative_abstention' | 'embedding_separation' | 'same_photo_separation';
  representativeFaceId: string | null;
  samePhotoSeparations: number;
  separationMargin: number | null;
};

export type CimmichSmartSplitRecommendations = {
  automaticIdentityAuthority: 'none';
  available: boolean;
  embeddingLineage?: {
    configDigest: string;
    dimension: 512;
    modelFamily: string;
    modelVersion: string;
  };
  groups: CimmichSmartSplitGroup[];
  personId: string;
  policy: {
    clearDistanceCeiling: number;
    clearDistanceMargin: number;
    edgeEvidenceFloor: number;
    minimumGroupSize: number;
    minimumSamePhotoSeparations: number;
    pairGroupCohesionFloor: number;
    samePhotoSeparationRatio: number;
    strongInternalMedianFloor: number;
    strongLinkFloor: number;
  };
  schemaVersion: 'cimmich.smart-split-recommendations.v1';
  summary: {
    clearGroupCount: number;
    embeddedPhysicalFaceCount: number;
    physicalFaceCount: number;
    unclearFaceCount: number;
  };
  unavailableReason: 'matching_provider_unavailable' | 'safe_size_limit' | null;
};
