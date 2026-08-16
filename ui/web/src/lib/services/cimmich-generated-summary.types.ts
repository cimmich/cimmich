export type CimmichGeneratedVisualFacts = {
  activities: string[];
  objects: string[];
  peopleCountEstimate: number;
  qualityFlags: string[];
  scene: string;
  summary: string;
  visibleText: string[];
};

export type CimmichGeneratedSummaryAnalysis = {
  analysisId: string;
  configDigest: string;
  createdAt: string;
  current: boolean;
  model: { digest: string; name: string; providerId: string };
  proposalDigest: string;
  sourceContentDigest: string;
  tier: 'enhanced' | 'smart';
  visualFacts: CimmichGeneratedVisualFacts;
};

export type CimmichGeneratedAssetSummaries = {
  enhanced: CimmichGeneratedSummaryAnalysis | null;
  schemaVersion: 'cimmich.generated-asset-summary.v1';
  smart: CimmichGeneratedSummaryAnalysis | null;
};
