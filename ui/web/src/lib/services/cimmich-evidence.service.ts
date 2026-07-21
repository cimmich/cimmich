import { AssetMediaSize, searchAssets, type AssetResponseDto } from '@immich/sdk';
import { projectCimmichBodyPose } from '$lib/components/cimmich/body-pose-presentation';
import {
  projectBodyIdentityStatus,
  projectBodyLinkStatus,
  projectPrimaryMachineCandidateNames,
} from '$lib/services/cimmich-identity-projection';
import {
  CimmichServiceError,
  getCimmichAssetEvidence,
  type CimmichAssetEvidence,
  type CimmichAssetOwnerSummary,
  type CimmichManualObjectRegionTag,
} from '$lib/services/cimmich.service';
import { getAssetMediaUrl } from '$lib/utils';

type CountMap = Record<string, number>;
const isNonEmptyString = (value: null | string | undefined): value is string =>
  typeof value === 'string' && value.length > 0;

export type CimmichTypedEntity = {
  confidence?: number;
  description?: string;
  entity_type: 'person' | 'pet' | 'object' | 'unknown';
  label?: string;
  name: string;
  species?: string;
  visible?: boolean;
};

export type CimmichPacketItem = {
  allowedDecisions: string[];
  contactSheetUrl: string;
  decisionState: string;
  packetId: string;
  personName: string;
  priority: string;
  queueFamily: string;
  receiptId: string;
  recommendedAction: string;
  sourceMediaId: string;
  visualUrl: string;
};

export type CimmichStateRow = {
  bucket: string;
  confidence: string;
  family: string;
  kind: string;
  machineValue: string;
  mediaId: string;
  personName: string;
  priority: string;
  reason: string;
  stateId: string;
  userAction: string;
  visualUrl: string;
};

export type CimmichPhotoSummary = {
  bodyContextPeople: string[];
  bodyStateCounts: CountMap;
  candidatePeople: string[];
  evidenceCaption?: string;
  evidenceCaptionSource?: string;
  evidenceDetailedCaption?: string;
  evidenceDetailedCaptionSource?: string;
  enhancedCaption?: string;
  enhancedCaptionSource?: string;
  eventAliases: string[];
  entities?: CimmichTypedEntity[];
  eventContext: string;
  exifDate: string;
  exifStatus: string;
  faceBucketCounts: CountMap;
  localDescription: string;
  mediaId: string;
  normalCaption?: string;
  normalCaptionSource?: string;
  queryText: string;
  searchRowId: string;
  sourcePath: string;
  sourcePeople: string[];
  strongCandidatePeople: string[];
  sourcePriorIdentityKeys?: Record<string, string>;
  sourceTagIdentityWarnings?: Array<Record<string, unknown>>;
  sourceTagResolver?: Record<string, unknown>;
  summaryEvidence?: string[];
  trustedSourcePeople?: string[];
  unlocalizedSourcePeople?: string[];
  visualCaption?: string;
  visualCaptionConfidence?: number | string;
  visualCaptionGeneratedAt?: string;
  visualCaptionModel?: string;
  visualCaptionSource?: string;
  visualDetailedCaption?: string;
  visualShortCaption?: string;
  visibleActions?: string[];
  visiblePeopleCountEstimate?: number | string;
  visualScene?: string;
  visualSetting?: string;
  visionRoute: string;
  visionRouteReason: string;
  wave1FinalSummaryGeneratedAt?: string;
};

export type CimmichFaceOverlay = {
  bbox: {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
  };
  bucket: string;
  bucketConfidence: string;
  candidateAbstainReason?: 'accepted_identity' | 'no_active_embedding' | 'no_same_space_candidate';
  candidateIdentityKey?: string;
  candidateClaimId?: string;
  candidateMatches?: Array<{
    displayEligible: true;
    personId: string;
    personName: string;
    rank: number;
    rawScore: number;
    scoreKind: 'cosine_similarity';
    scoreMeaning: string;
  }>;
  candidateName?: string;
  currentDecisionId?: string;
  currentRevision?: number;
  cropUrl?: string;
  detScore: string;
  id: string;
  image?: {
    height: number;
    width: number;
  } | null;
  identityClaimId?: string;
  label: string;
  lastFaceOnlyMatchScope?: string;
  lastFaceOnlyMatchTriggeredAt?: string;
  rejectedClaimId?: string;
  rejectedName?: string;
  rejectedPersonIdentityKey?: string;
  reviewDecisionId?: string;
  reviewDisposition?: 'active' | 'later' | 'unknown';
  marginOverNextIdentity?: string;
  name: string;
  nextIdentityName?: string;
  personIdentityKey?: string;
  personIdentitySource?: string;
  prototypeScore?: string;
  prototypeThreshold?: string;
  reviewCandidateIdentityKey?: string;
  reviewCandidateName?: string;
  cimmichIdentityWarnings?: Array<Record<string, unknown>>;
  source: string;
  status: 'named' | 'rejected' | 'sidecar_only' | 'untagged';
};

export type CimmichBodyOverlay = {
  bbox: {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
  };
  bodyId: string;
  bodyOutfitReid?: {
    bestName?: string;
    bucket?: string;
    cropUrl?: string;
    currentLinkStatus?: string;
    identityTruthState?: string;
    secondName?: string;
    [key: string]: unknown;
  };
  confidence: string;
  currentDecisionId?: string;
  currentRevision?: number;
  headProxy?: [number, number] | null;
  id: string;
  image?: {
    height: number;
    width: number;
  } | null;
  keypoints?: Array<[number, number] | null>;
  keypointScores?: number[];
  keypointSkeleton?: Array<[number, number]>;
  keypointSource?: string;
  label: string;
  linkedFaceId: string;
  linkedName: string;
  linkReason: string;
  linkSource?: 'face_body_linkage' | 'geometry_policy' | 'model' | 'trusted_import' | 'user';
  linkStatus: 'linked_to_face' | 'linked_to_named_face' | 'linked_to_person' | 'unlinked';
  maskStatus: string;
  maskUse: string;
  overlayUrl?: string;
  poseQuality: string;
  poseReasonCode?: string;
  poseState?: 'available' | 'unavailable';
  source: string;
  status: 'linked' | 'unlinked';
};

export type CimmichSourcePresenceOverlay = {
  bbox: {
    x1: number;
    x2: number;
    y1: number;
    y2: number;
  };
  id: string;
  image?: {
    height: number;
    width: number;
  } | null;
  label: string;
  name: string;
  rawName?: string;
  reason: string;
  source: string;
  status: 'source_presence';
};

export type CimmichFaceEvent = {
  action:
    | 'add_face'
    | 'clear_identity'
    | 'confirm_not_face'
    | 'delete_face'
    | 'mark_not_face'
    | 'reject_name_candidate'
    | 'rename'
    | 'restore_face'
    | 'retrigger'
    | 'update_box';
  at: string;
  createdPerson?: boolean;
  faceId: string;
  name?: string;
  nextName?: string;
  personId?: string;
  previousName?: string;
  relatedFaceCount?: number;
  relatedPhotoCount?: number;
  scope: string;
  status?: string;
};

export type CimmichPhotoEvidence = {
  bodyOverlays?: CimmichBodyOverlay[];
  contexts?: CimmichPhotoContext[];
  faceEditLog?: CimmichFaceEvent[];
  faceMatchRuns?: CimmichFaceEvent[];
  faceOverlays?: CimmichFaceOverlay[];
  filename: string;
  holdingPeople?: string[];
  mediaId: string;
  ownerSummary?: CimmichAssetOwnerSummary;
  knownPeople?: string[];
  packetItems: CimmichPacketItem[];
  provider?: 'cimmich' | 'cimmich';
  sourcePresenceOverlays?: CimmichSourcePresenceOverlay[];
  stateRows: CimmichStateRow[];
  summary: CimmichPhotoSummary | null;
  thingRegions?: CimmichManualObjectRegionTag[];
};

export type CimmichPhotoContext = {
  associationKind: string;
  displayName: string;
  entityId: string;
  entityKind: 'event' | 'object' | 'place';
  family: 'events' | 'objects' | 'places';
  typeKind: string;
};

export type CimmichEvidenceBundle = {
  globalSummary: {
    actionRowCount: number;
    allowedDecisions: string[];
    blanketReapprovalRows: number;
    bodyContextRows: number;
    knownPersonCandidateRows: number;
    markerSupportRows: number;
    searchFrontierCandidateRows: number;
    stateRowCount: number;
    visualCaptionWave?: {
      failedPhotoCount: number;
      model: string;
      schemaVersion: string;
      skippedPhotoCount: number;
      updatedPhotoCount: number;
    };
  };
  photos: Record<string, CimmichPhotoEvidence>;
  schemaVersion: string;
};

export type CimmichArchiveGraphEntity = {
  aliases: string[];
  description: string;
  documentCandidateCount: number;
  entityType: string;
  filenames: string[];
  graphId: string;
  heroFilename?: string;
  heroDescription: string;
  id: string;
  keywords: string[];
  kind?: 'object' | 'pet';
  label: string;
  locationHints: string[];
  matchCues: string[];
  matchPolicy: Record<string, string>;
  matchSignals: CountMap;
  peopleRoles: Array<{ name: string; role: string }>;
  people: CountMap;
  photoMatches?: Record<
    string,
    {
      confidence: number;
      label: string;
      lane: 'adjacent_context' | 'core' | 'needs_check' | 'route_stop';
      reasons: string[];
      signals: string[];
    }
  >;
  photoCount: number;
  places: CountMap;
  relatedConcepts: string[];
  routeHints: string[];
  status: string;
  trips: CountMap;
};

export type CimmichArchiveGraphTrip = {
  activities: CountMap;
  documentCandidateCount: number;
  filenames: string[];
  gpsCount: number;
  label: string;
  people: CountMap;
  photoCount: number;
  places: CountMap;
  visualCaptionCount: number;
  years: string[];
};

export type CimmichArchiveGraphDocument = {
  filename: string;
  mediaId: string;
  people: string[];
  score: number;
  signals: string[];
  summaryText: string;
  trip: string;
  visualScene?: string;
  visualSetting?: string;
};

export type CimmichSmartSearchRow = {
  entityId: string;
  facets: Record<string, unknown>;
  filenames: string[];
  kind: 'activity' | 'backend_signal' | 'document' | 'event' | 'pet_object' | 'person' | 'photo' | 'trip';
  label: string;
  people: string[];
  priority: number;
  rowId: string;
  searchText: string;
  tokens: string[];
  writesToImmich: boolean;
};

export type CimmichArchiveGraph = {
  activities: CimmichArchiveGraphEntity[];
  backendSignals: CimmichArchiveGraphEntity[];
  definitionSource: {
    durabilityTarget: string;
    kind: string;
    matchPolicyVersion: string;
    webFallbackAllowed: boolean;
  };
  documents: CimmichArchiveGraphDocument[];
  events: Array<Record<string, unknown>>;
  generatedAtUtc: string;
  health: {
    status: string;
    summary: Record<string, number>;
  };
  people: Array<Record<string, unknown>>;
  petsObjects: CimmichArchiveGraphEntity[];
  schemaVersion: string;
  smartSearch: {
    rowCount: number;
    rows: CimmichSmartSearchRow[];
    schemaVersion: string;
  };
  source: {
    kind: string;
    placeTagsPath: string;
    schemaVersion: string;
    sourcePath: string;
  };
  trips: CimmichArchiveGraphTrip[];
};

export type CimmichEvidenceResult = {
  bundle: CimmichEvidenceBundle;
  evidence?: CimmichPhotoEvidence;
  matchedFilename?: string;
  rffProjection?: CimmichRffProjectionItem;
  step2Readback?: CimmichStep2Readback;
};

export type CimmichStep2IdentityClause = {
  evidence_class: string;
  name: string;
  negative_scopes: string[];
  subject_scopes: string[];
};

export type CimmichStep2Face = {
  bbox_norm_xyxy_top_left: [number, number, number, number];
  disposition: string;
  face_id: string;
  observation_id: string;
  quality_bucket: string;
  sequence_identity_candidate?: {
    authority: string;
    name: string;
    status: string;
    support_class: string;
  } | null;
};

export type CimmichStep2NamedRegion = {
  authority: string;
  claim_id: string;
  disposition: string;
  geometry_iou: number | null;
  matched_local_face_observation_id: string | null;
  name_clean: string;
  name_status: string;
  named_region_bbox_norm_xyxy_top_left: [number, number, number, number];
  negative_scope: string | null;
  source: string;
  subject_scope: string;
};

export type CimmichStep2Readback = {
  boundary: {
    canonicalIdentityPromotion: 'closed';
    enhancedVisualQc: 'accepted_read_only' | 'held_not_projected' | 'ready_not_started';
    immichDatabaseWrite: 'none';
    sourceOrSidecarWrite: 'none';
  };
  decisionDigestSha256: string;
  item: {
    attentionTier: string;
    authority: string;
    captureContext: {
      captureTime: string;
      collectionLabel: string;
      sequenceGroupId: string;
      temporalClashIds: string[];
    };
    contextResolutionRequests: Array<Record<string, unknown>>;
    eventContext: { label: string; status: string; value: string };
    enhancedVisualQc?: {
      additionalUncertainties: string[];
      confidence: number | null;
      modelDigest: string;
      summary: string;
      terminalOutcome: 'done' | 'done_with_safe_unknowns';
      unresolvedTemporalContext: string[];
      visibleEntities: string[];
      visiblePeopleCountEstimate: number | null;
    };
    filename: string;
    identity: {
      authority: string;
      clauses: CimmichStep2IdentityClause[];
      localFaces: CimmichStep2Face[];
      namedRegionClaims: CimmichStep2NamedRegion[];
    };
    mediaId: string;
    sourceDecisionSha256: string;
    sourcePath: string;
    sourceSha256: string;
    summaryInput: {
      event_clause: string;
      identity_clauses: CimmichStep2IdentityClause[];
      mode: string;
      reconciled_scene_correction: string | null;
      scene_clause: string;
      unresolved_context_request_count: number;
    };
    visibleText: { legibility: string; present: boolean; visible_text_clues: string[] };
    visualQcStatus: string;
  };
  rowCount: number;
  schemaVersion: 'cimmich.step2_v3_readback.v1';
  status: 'EXACT_V3_LOADED';
};

export type CimmichPersonPhoto = {
  bodyLinks: CimmichBodyOverlay[];
  enhancedCaption?: string;
  eventAliases: string[];
  eventContext: string;
  evidence: CimmichPhotoEvidence;
  faceOverlays: CimmichFaceOverlay[];
  filename: string;
  mediaId: string;
  normalCaption?: string;
  packId?: string;
  packLabel?: string;
  qcStatus?: CimmichPackQcPhoto['status'];
  sourcePath?: string;
  visibleActions: string[];
  visualScene?: string;
  visualSetting?: string;
};

export type CimmichPersonFeatureFace = {
  bbox: CimmichFaceOverlay['bbox'];
  cropUrl?: string;
  filename: string;
  image?: CimmichFaceOverlay['image'];
  score?: number;
};

export type CimmichPersonFeatureBody = {
  bbox: CimmichBodyOverlay['bbox'];
  filename: string;
  image?: CimmichBodyOverlay['image'];
  score?: number;
};

export type CimmichPersonProfile = {
  aliases: string[];
  bodyLinks: number;
  buckets: CountMap;
  candidatePhotos: number;
  eventCounts: CountMap;
  faceCount: number;
  featureBody?: CimmichPersonFeatureBody;
  featureFace?: CimmichPersonFeatureFace;
  identityKey?: string;
  knownActions: CountMap;
  knownObjects: CountMap;
  knownPlaces: CountMap;
  name: string;
  packCounts: CountMap;
  photos: CimmichPersonPhoto[];
  sourcePhotos: number;
  sourceSupervisedPhotos: number;
  unresolvedFaces: number;
};

export type CimmichResolvedAsset = {
  asset: AssetResponseDto;
  city?: string | null;
  country?: string | null;
  hasCoordinates: boolean;
  latitude?: number | null;
  longitude?: number | null;
  previewUrl: string;
  state?: string | null;
  thumbnailUrl: string;
};

export type CimmichFaceActionResult = {
  bundle: CimmichEvidenceBundle;
  delta?: Record<string, unknown>;
  event: CimmichFaceEvent;
  evidence: CimmichPhotoEvidence;
};

export type CimmichPackQcPhoto = {
  bodyOverlays?: CimmichBodyOverlay[];
  counts: {
    acceptedAssignments: number;
    machineFaces: number;
    reviewAssignments: number;
    sidecarDeltas: number;
    sourceAnchors: number;
    unresolvedAssignments: number;
  };
  filename: string;
  faceOverlays?: CimmichFaceOverlay[];
  mediaId: string;
  sourcePath: string;
  sourcePresenceOverlays?: CimmichSourcePresenceOverlay[];
  status:
    | 'missing_visual_caption'
    | 'missing_enhanced_summary'
    | 'no_machine_faces'
    | 'ready_for_cimmich'
    | 'source_only_or_unaccepted_faces'
    | 'manifest_only_no_source_image';
  summary: {
    enhancedCaption: string;
    entities?: CimmichTypedEntity[];
    evidenceLines?: string[];
    namedPeople: string[];
    normalCaption: string;
    placeContext: string;
    tripContext: string;
  };
};

export type CimmichPackQcIndex = {
  archiveId?: string;
  boundary: Record<string, string>;
  generatedAtUtc: string;
  packId: string;
  photos: CimmichPackQcPhoto[];
  schemaVersion: string;
  stats: {
    captionCount: number;
    enhancedSummaryCount: number;
    machineFaceCount: number;
    namedPhotoCount: number;
    photoCount: number;
    sidecarDeltaCount: number;
    sourceAnchorCount: number;
    statusCounts: CountMap;
  };
};

export type CimmichRffProjectionItem = {
  backlog_reason: string;
  caption_short: string;
  correction_delta_ids?: string[];
  correction_family?: string;
  correction_status?: 'durable_record_applied' | 'production_source_sidecar_applied';
  evidence_paths: string[];
  keyframe_count: number;
  lane: 'photo_image' | 'video_clip';
  original_caption_short?: string;
  projection_id: string;
  projection_kind:
    | 'accepted_stage1_image_evidence'
    | 'image_stage1_candidate_evidence'
    | 'video_keyframe_candidate_evidence';
  projection_status: 'candidate_evidence_ready' | 'candidate_keyframes_ready' | 'explicit_backlog';
  sidecar_safe_write_policy?: string;
  source_path: string;
  source_record_paths?: string[];
  source_record_status?: string;
};

export type CimmichRffPhotosVideosReadModel = {
  archive_id: string;
  correction_summary?: {
    applied_delta_count: number;
    conflict_count?: number;
    correction_families: string[];
    durability_target: string;
    immich_metadata_writes: number;
    ledger_fallback_delta_count?: number;
    source_media_writes: number;
    source_sidecar_delta_count?: number;
    source_sidecar_writes: number;
  };
  generated_at: string;
  items: CimmichRffProjectionItem[];
  schema_version: string;
  source_root_scope: 'provenance_only';
  source_record_overlay_status?: string;
  truth_status: 'candidate_read_model_not_source_of_record';
};

export type CimmichRffSourceRootRefreshState = {
  generatedAtUtc: string;
  mode: 'read_only_known_sources';
  roots: Array<{
    itemCount: number;
    missingSourceCount: number;
    refreshRecommended: boolean;
    rootId: string;
    rootLabel: string;
    rootPath: string;
    severity: 'info' | 'warning';
    sourceNewerThanProjectionCount: number;
    status: string;
  }>;
  schemaVersion: string;
  status: 'fresh' | 'warning';
  summary: {
    knownSourceCount: number;
    missingSourceCount: number;
    refreshRecommendedRootCount: number;
    sourceNewerThanProjectionCount: number;
    sourceRootCount: number;
    warningRootCount: number;
  };
};

export type CimmichRffCorrectionConflictState = {
  generatedAtUtc: string;
  mode: 'read_only_conflict_review';
  rows: Array<{
    candidateValueAtCorrection: string;
    currentCandidateValue: string;
    projectionId: string;
    resolvedDisplayValue: string;
    reviewStatus: 'review_recommended';
    sourcePath: string;
  }>;
  schemaVersion: string;
  status: 'clear' | 'review_needed';
  summary: {
    appliedDeltaCount: number;
    conflictCount: number;
    reviewRecommendedCount: number;
  };
};

export type CimmichRffWave15ConsolidationPlan = {
  generatedAtUtc: string;
  mode: 'dry_run_no_execution';
  schemaVersion: string;
  status: 'ready_dry_run';
  steps: Array<{
    itemCount: number;
    label: string;
    plannedWrites: number;
    status: string;
    stepId: string;
  }>;
  summary: {
    contextLinkRefreshCount: number;
    enhancedSummaryRefreshCount: number;
    plannedStepCount: number;
    uncertaintyReviewCount: number;
    workerExecution: number;
  };
};

export type CimmichRffWave15RunnerOutputContract = {
  generatedAtUtc: string;
  mode: 'dry_run_contract_no_execution';
  outputRoots: {
    projectionStoreRoot: string;
    proofRunRoot: string;
    cimmichReviewSurface: string;
  };
  plannedScope: {
    contextLinkRefreshCount: number;
    enhancedSummaryRefreshCount: number;
    plannedStepCount: number;
    readModelItemCount: number;
    uncertaintyReviewCount: number;
  };
  runnerPhases: Array<{
    allowedWriteClass: string;
    phaseId: string;
    requiredOutput: string;
  }>;
  schemaVersion: string;
  status: 'ready_for_runner_implementation';
};

export type CimmichRffProjectionStoreContract = {
  currentScope: {
    photoCount: number;
    readModelItemCount: number;
    sourceRootScope: string;
    truthStatus: string;
    videoCount: number;
  };
  entitySets: Array<{
    currentCount: number;
    entitySetId: string;
    key: string;
  }>;
  generatedAtUtc: string;
  mode: 'contract_only_no_store_mutation';
  schemaVersion: string;
  status: 'ready_for_store_implementation';
  storeId: string;
  truthBoundary: 'rebuildable_projection_cache_not_source_of_record';
};

export type CimmichRffCorrectionFamilyContracts = {
  existingOpenFamily: {
    familyId: string;
    field: string;
    status: string;
  };
  families: Array<{
    allowedFields: string[];
    durabilityTarget: string;
    familyId: string;
    status: 'contract_defined_not_open_for_ui_edits';
  }>;
  generatedAtUtc: string;
  mode: 'contracts_only_no_correction_writes';
  schemaVersion: string;
  status: 'ready_for_family_specific_spikes';
  summary: {
    contractFamilyCount: number;
    immichStandardMetadataWrites: number;
    openForUiEditCount: number;
    cimmichDatabaseWrites: number;
    sourceMediaWrites: number;
    sourceSidecarWrites: number;
  };
};

export type CimmichRffWave15RunnerState = {
  generatedAtUtc: string;
  schemaVersion: string;
  status: 'complete_review_ready';
  summary: {
    contextLinkCandidateCount: number;
    enhancedSummaryCandidateCount: number;
    mediaItemCount: number;
    proofMediaCount: number;
    reviewQueueCount: number;
    uncertaintyReviewCount: number;
    workerExecution: number;
  };
  truthBoundary: 'rebuildable_projection_cache_not_source_of_record';
};

export type CimmichRffCorrectionFamilySpikeState = {
  generatedAtUtc: string;
  mode: 'proof_local_no_ui_edit_controls';
  openForUiEdit: boolean;
  proofLocalUiEditEnabled?: boolean;
  rows: Array<{
    correctedValue: string;
    eventId: string;
    familyId: string;
    field: string;
    projectionId: string;
    recordPath?: string;
    reviewStatus: 'proof_review_ready';
    sourcePath: string;
  }>;
  schemaVersion: string;
  selectedFamily: 'face_name_correction';
  status: 'proof_spike_complete_review_ready';
  summary: {
    contractFamilyCount: number;
    openForUiEditCount: number;
    proofLocalUiEditCount?: number;
    proofLocalRecordCount: number;
    spikedFamilyCount: number;
  };
};

export type CimmichRffFaceNameProductionTargetPolicy = {
  generatedAtUtc: string;
  mode: 'dry_run_no_production_write';
  schemaVersion: string;
  status: 'ready_for_target_policy_review_no_write' | 'blocked';
  summary: {
    collectionSidecarWrites: number;
    openForProductionControlCount: number;
    policyRowCount: number;
    proofLocalUiEditCount: number;
    sourceSidecarWrites: number;
    uniqueCollectionSidecarTargetCount: number;
    uniquePhotoSourceSidecarTargetCount: number;
  };
};

export type CimmichRffFaceNameTargetFixtureState = {
  generatedAtUtc: string;
  mode: 'fixture_only_no_production_write';
  schemaVersion: string;
  status: 'fixture_materialized_and_reread';
  summary: {
    fixtureSidecarCount: number;
    openForProductionControlCount: number;
    policyRowCount: number;
    rereadEventCount: number;
    sourceSidecarWrites: number;
  };
};

export type CimmichFullArchiveQcDetail = {
  bodyOverlays: CimmichBodyOverlay[];
  counts: Record<string, number>;
  faceOverlays: CimmichFaceOverlay[];
  filename: string;
  identitySlate: {
    counts: Record<string, number>;
    displayNames: string[];
    entries: Array<{
      bbox?: { x1: number; x2: number; y1: number; y2: number } | null;
      bodyIds?: string[];
      boundary: string;
      confidence: string;
      displayStyle: string;
      entryId: string;
      evidence: Record<string, unknown>;
      faceIds?: string[];
      identityKey: string;
      image?: { height: number; width: number } | null;
      name: string;
      state: string;
    }>;
  };
  mediaId: string;
  overlays: {
    body: number;
    faces: number;
    sourceIdentityGeometry: number;
    sourcePresence: number;
  };
  proofPaths: {
    qcIndex: string;
    qcRows: string;
    qcUpgradeIndexes?: string[];
  };
  readiness: {
    entityGraph: 'ready' | 'partial' | 'missing' | 'not_applicable';
    identityBinding: 'ready' | 'review' | 'unresolved' | 'not_applicable';
    personGeometry: 'ready' | 'partial' | 'missing' | 'not_applicable';
    productProjection: 'ready' | 'held';
    promotion: 'closed' | 'eligible' | 'approved';
    sceneCaption: 'ready' | 'review' | 'missing';
  };
  sourcePath: string;
  sourcePreviewUrl: string;
  sourcePresenceOverlays: CimmichSourcePresenceOverlay[];
  status:
    | 'ready_for_cimmich'
    | 'source_only_or_unaccepted_faces'
    | 'no_machine_faces'
    | 'manifest_only_no_source_image';
  summary: {
    enhancedCaption: string;
    entities?: CimmichTypedEntity[];
    evidenceLines: string[];
    namedPeople: string[];
    normalCaption: string;
    placeContext: string;
    tripContext: string;
  };
  truthStatus: 'read_only_qc_projection_not_canonical_identity_truth';
};

type CimmichAugustPrimaryMachineCandidates = {
  rows: Array<{
    bboxXyxy: [number, number, number, number];
    decision: string;
    faceId: string;
    machineName: string;
    mediaId: string;
    projectionStatus: 'accepted' | 'review' | 'unresolved';
    score: string;
    temporalSupport: Array<{ deltaSeconds: number; mediaId: string }>;
  }>;
  schemaVersion: 'cimmich.august_machine_identities.v2';
};

export type CimmichFullArchiveQcStatus = {
  archiveId: string;
  boundary: Record<string, boolean>;
  bucketCounts: Record<
    'ready_for_cimmich' | 'source_only_or_unaccepted_faces' | 'no_machine_faces' | 'manifest_only_no_source_image',
    number
  >;
  bucketOrder: Array<
    'ready_for_cimmich' | 'source_only_or_unaccepted_faces' | 'no_machine_faces' | 'manifest_only_no_source_image'
  >;
  bucketSamples: Record<
    'ready_for_cimmich' | 'source_only_or_unaccepted_faces' | 'no_machine_faces' | 'manifest_only_no_source_image',
    Array<{
      accepted_assignment_count: string;
      enhanced_caption: string;
      filename: string;
      machine_face_count: string;
      media_id: string;
      normal_caption: string;
      source_anchor_count: string;
      source_path: string;
      status: string;
      unresolved_assignment_count: string;
    }>
  >;
  detail: CimmichFullArchiveQcDetail | null;
  finalCounts: {
    captionableImageRows: number;
    enhancedSummaries: number;
    identitySlateEntries: number;
    manifestRows: number;
    readyForCimmichRows: number;
    visualCaptions: number;
  };
  generatedAtUtc: string;
  manifest: {
    generatedAtUtc: string;
    lanes: Array<{ lane: string; status: string; counts?: Record<string, unknown>; summary?: string }>;
    requiredLanes: string[];
    schemaVersion: string;
    sourceMutation: string;
    sourceRoot: string;
    status: string;
  };
  packId: string;
  proofPaths: {
    finalPackManifest: string;
    qcAcceptance: string;
    qcIndex: string;
    qcRows: string;
    qcSummary: string;
    recoveryNote: string;
  };
  sampleSize: number;
  schemaVersion: string;
  status: string;
  truthStatus: 'read_only_qc_projection_not_cimmich_truth';
};

export type CimmichMultiFolderWave0Status = {
  acceptedFolderCount: number;
  boundary: Record<string, string>;
  folders: Array<{
    folderName: string;
    mediaCount: number;
    receiptSha256: string;
    sourceRoot: string;
    status: 'accepted';
  }>;
  phase: 'complete';
  schemaVersion: 'cimmich.multi_folder_wave0_status.v1';
  selectedFolderCount: number;
  selectedMediaCount: number;
  sourceDigestsReverified: true;
  status: 'ACCEPT';
  truthStatus: 'read_only_wave0_routing_evidence_not_wave1_or_canonical_truth';
};

export type CimmichWave1LaunchStatus = {
  acceptedInActivePhase: number;
  activePhase: string | null;
  blockingGates: string[];
  completedModelPhases: number;
  heldInActivePhase: number;
  inputInActivePhase: number;
  launchReady: true;
  mediaCount: 3747;
  modelPhaseCount: number;
  modelsStarted: number;
  planSha256: string;
  postModelGates: string[];
  schemaVersion: 'cimmich.wave1_launch_status.v1';
  selectedFolderCount: 59;
  status: 'COMPLETE_READ_ONLY_QC_OUTPUT_RELEASE_CLOSED' | 'READY_NOT_STARTED' | 'RUNNING';
  truthStatus:
    | 'launch_package_only_no_models_started_no_canonical_or_database_truth'
    | 'running_durable_model_evidence_no_canonical_or_database_truth'
    | 'complete_read_only_qc_output_no_canonical_or_database_truth';
};

const archivePackLabel = 'Cimmich Archive';
// Retained legacy projection types are compile-only compatibility for the old
// Person fallback below. Public builds expose no lab route or filesystem read.
const retiredProjectionUrl = undefined as never;
const bundleUrl = retiredProjectionUrl;
const archiveGraphUrl = retiredProjectionUrl;
const fullArchiveQcStatusUrl = retiredProjectionUrl;
const augustPrimaryMachineCandidatesUrl = retiredProjectionUrl;
const multiFolderWave0StatusUrl = retiredProjectionUrl;
const wave1LaunchStatusUrl = retiredProjectionUrl;
const step2ReadbackUrl = retiredProjectionUrl;
const palaceTimesArchiveQcIndexUrl = retiredProjectionUrl;
const sourceSupervisedArchiveQcIndexUrl = retiredProjectionUrl;
const rffCorrectionFamilyContractsUrl = retiredProjectionUrl;
const rffCorrectionFamilySpikeStateUrl = retiredProjectionUrl;
const rffCorrectionConflictStateUrl = retiredProjectionUrl;
const rffPhotosVideosReadModelUrl = retiredProjectionUrl;
const rffProjectionStoreIndexUrl = retiredProjectionUrl;
const rffProjectionStoreContractUrl = retiredProjectionUrl;
const rffSourceRootRefreshStateUrl = retiredProjectionUrl;
const rffWave15ConsolidationPlanUrl = retiredProjectionUrl;
const rffWave15RunnerOutputContractUrl = retiredProjectionUrl;
const rffWave15RunnerStateUrl = retiredProjectionUrl;
const rffFaceNameProductionTargetPolicyUrl = retiredProjectionUrl;
const rffFaceNameTargetFixtureStateUrl = retiredProjectionUrl;
let bundlePromise: Promise<CimmichEvidenceBundle> | undefined;
let archiveGraphVersion = 0;
let archiveGraphPromise: Promise<CimmichArchiveGraph> | undefined;
let rffCorrectionFamilyContractsPromise: Promise<CimmichRffCorrectionFamilyContracts> | undefined;
let rffCorrectionFamilySpikeStatePromise: Promise<CimmichRffCorrectionFamilySpikeState> | undefined;
let rffCorrectionConflictStatePromise: Promise<CimmichRffCorrectionConflictState> | undefined;
let palaceTimesArchiveQcIndexPromise: Promise<CimmichPackQcIndex> | undefined;
let sourceSupervisedArchiveQcIndexPromise: Promise<CimmichPackQcIndex> | undefined;
let archiveQcIndexesPromise: Promise<CimmichPackQcIndex[]> | undefined;
let rffPhotosVideosReadModelPromise: Promise<CimmichRffPhotosVideosReadModel> | undefined;
let rffProjectionStoreIndexPromise: Promise<CimmichRffWave15RunnerState> | undefined;
let rffProjectionStoreContractPromise: Promise<CimmichRffProjectionStoreContract> | undefined;
let rffSourceRootRefreshStatePromise: Promise<CimmichRffSourceRootRefreshState> | undefined;
let rffWave15ConsolidationPlanPromise: Promise<CimmichRffWave15ConsolidationPlan> | undefined;
let rffWave15RunnerOutputContractPromise: Promise<CimmichRffWave15RunnerOutputContract> | undefined;
let rffWave15RunnerStatePromise: Promise<CimmichRffWave15RunnerState> | undefined;
let rffFaceNameProductionTargetPolicyPromise: Promise<CimmichRffFaceNameProductionTargetPolicy> | undefined;
let rffFaceNameTargetFixtureStatePromise: Promise<CimmichRffFaceNameTargetFixtureState> | undefined;
let fullArchiveQcStatusPromise: Promise<CimmichFullArchiveQcStatus> | undefined;
let augustPrimaryMachineCandidatesPromise: Promise<CimmichAugustPrimaryMachineCandidates> | undefined;
let multiFolderWave0StatusPromise: Promise<CimmichMultiFolderWave0Status> | undefined;

export const getCimmichEvidenceBundle = async () => {
  bundlePromise ??= fetch(bundleUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load Cimmich evidence bundle: ${response.status}`);
    }

    return (await response.json()) as CimmichEvidenceBundle;
  });

  return bundlePromise;
};

export const getCimmichArchiveGraph = async () => {
  archiveGraphPromise ??= fetch(`${archiveGraphUrl}?v=${archiveGraphVersion}-${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load Cimmich archive graph: ${response.status}`);
    }

    return (await response.json()) as CimmichArchiveGraph;
  });

  return archiveGraphPromise;
};

export const getCimmichSourceSupervisedArchiveQcIndex = async () => {
  sourceSupervisedArchiveQcIndexPromise ??= fetch(`${sourceSupervisedArchiveQcIndexUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load Cimmich archive QC index: ${response.status}`);
    }

    return (await response.json()) as CimmichPackQcIndex;
  });

  return sourceSupervisedArchiveQcIndexPromise;
};

export const getCimmichPalaceTimesArchiveQcIndex = async () => {
  palaceTimesArchiveQcIndexPromise ??= fetch(`${palaceTimesArchiveQcIndexUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load Cimmich archive source-root QC index: ${response.status}`);
    }

    return (await response.json()) as CimmichPackQcIndex;
  });

  return palaceTimesArchiveQcIndexPromise;
};

export const getCimmichArchiveQcIndexes = async () => {
  archiveQcIndexesPromise ??= Promise.all([
    getCimmichPalaceTimesArchiveQcIndex().catch(() => undefined),
    getCimmichSourceSupervisedArchiveQcIndex().catch(() => undefined),
  ]).then((indexes) => indexes.filter(Boolean) as CimmichPackQcIndex[]);

  return archiveQcIndexesPromise;
};

export const getCimmichFullArchiveQcStatus = async () => {
  fullArchiveQcStatusPromise ??= fetch(`${fullArchiveQcStatusUrl}?sampleSize=4&v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load Cimmich full-archive QC status: ${response.status}`);
    }

    return (await response.json()) as CimmichFullArchiveQcStatus;
  });

  return fullArchiveQcStatusPromise;
};

const getCimmichAugustPrimaryMachineCandidates = async () => {
  augustPrimaryMachineCandidatesPromise ??= fetch(augustPrimaryMachineCandidatesUrl, { cache: 'no-store' }).then(
    async (response) => {
      if (!response.ok) {
        throw new Error(`Unable to load August primary machinery candidates: ${response.status}`);
      }
      return (await response.json()) as CimmichAugustPrimaryMachineCandidates;
    },
  );
  return augustPrimaryMachineCandidatesPromise;
};

export const getCimmichMultiFolderWave0Status = async () => {
  multiFolderWave0StatusPromise ??= fetch(`${multiFolderWave0StatusUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load multi-folder Wave 0 status: ${response.status}`);
    }
    return (await response.json()) as CimmichMultiFolderWave0Status;
  });
  return multiFolderWave0StatusPromise;
};

export const getCimmichWave1LaunchStatus = async () => {
  return fetch(`${wave1LaunchStatusUrl}?v=${Date.now()}`, { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load Wave 1 launch status: ${response.status}`);
    }
    return (await response.json()) as CimmichWave1LaunchStatus;
  });
};

export const getCimmichFullArchiveQcDetail = async (mediaId: string, filename: string, sourcePath = '') => {
  const search = new URLSearchParams({ filename, mediaId, sampleSize: '0', sourcePath, v: Date.now().toString() });
  const response = await fetch(`${fullArchiveQcStatusUrl}?${search.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to load Cimmich full-archive QC detail: ${response.status}`);
  }

  const result = (await response.json()) as CimmichFullArchiveQcStatus;
  if (!result.detail) {
    throw new Error('The selected full-archive QC row was not found.');
  }

  return result.detail;
};

export const getCimmichStep2Readback = async (asset: AssetResponseDto) => {
  const sourcePath = '';
  const search = new URLSearchParams({
    filename: asset.originalFileName,
    sourcePath,
    v: Date.now().toString(),
  });
  const response = await fetch(`${step2ReadbackUrl}?${search.toString()}`, { cache: 'no-store' });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Unable to load the Step 2 v3 readback: ${response.status}`);
  }
  return (await response.json()) as CimmichStep2Readback;
};

export const getCimmichRffPhotosVideosReadModel = async () => {
  rffPhotosVideosReadModelPromise ??= fetch(`${rffPhotosVideosReadModelUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF photos/videos read model: ${response.status}`);
    }

    return (await response.json()) as CimmichRffPhotosVideosReadModel;
  });

  return rffPhotosVideosReadModelPromise;
};

export const getCimmichRffCorrectionConflictState = async () => {
  rffCorrectionConflictStatePromise ??= fetch(`${rffCorrectionConflictStateUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF correction conflict state: ${response.status}`);
    }

    return (await response.json()) as CimmichRffCorrectionConflictState;
  });

  return rffCorrectionConflictStatePromise;
};

export const getCimmichRffSourceRootRefreshState = async () => {
  rffSourceRootRefreshStatePromise ??= fetch(`${rffSourceRootRefreshStateUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF source-root refresh state: ${response.status}`);
    }

    return (await response.json()) as CimmichRffSourceRootRefreshState;
  });

  return rffSourceRootRefreshStatePromise;
};

export const getCimmichRffWave15ConsolidationPlan = async () => {
  rffWave15ConsolidationPlanPromise ??= fetch(`${rffWave15ConsolidationPlanUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF Wave 1.5 consolidation plan: ${response.status}`);
    }

    return (await response.json()) as CimmichRffWave15ConsolidationPlan;
  });

  return rffWave15ConsolidationPlanPromise;
};

export const getCimmichRffWave15RunnerOutputContract = async () => {
  rffWave15RunnerOutputContractPromise ??= fetch(`${rffWave15RunnerOutputContractUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF Wave 1.5 runner contract: ${response.status}`);
    }

    return (await response.json()) as CimmichRffWave15RunnerOutputContract;
  });

  return rffWave15RunnerOutputContractPromise;
};

export const getCimmichRffProjectionStoreContract = async () => {
  rffProjectionStoreContractPromise ??= fetch(`${rffProjectionStoreContractUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF projection-store contract: ${response.status}`);
    }

    return (await response.json()) as CimmichRffProjectionStoreContract;
  });

  return rffProjectionStoreContractPromise;
};

export const getCimmichRffCorrectionFamilyContracts = async () => {
  rffCorrectionFamilyContractsPromise ??= fetch(`${rffCorrectionFamilyContractsUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF correction-family contracts: ${response.status}`);
    }

    return (await response.json()) as CimmichRffCorrectionFamilyContracts;
  });

  return rffCorrectionFamilyContractsPromise;
};

export const getCimmichRffWave15RunnerState = async () => {
  rffWave15RunnerStatePromise ??= fetch(`${rffWave15RunnerStateUrl}?v=${Date.now()}`, { cache: 'no-store' }).then(
    async (response) => {
      if (!response.ok) {
        throw new Error(`Unable to load RFF Wave 1.5 runner state: ${response.status}`);
      }

      return (await response.json()) as CimmichRffWave15RunnerState;
    },
  );

  return rffWave15RunnerStatePromise;
};

export const getCimmichRffProjectionStoreIndex = async () => {
  rffProjectionStoreIndexPromise ??= fetch(`${rffProjectionStoreIndexUrl}?v=${Date.now()}`, { cache: 'no-store' }).then(
    async (response) => {
      if (!response.ok) {
        throw new Error(`Unable to load RFF projection-store index: ${response.status}`);
      }

      return (await response.json()) as CimmichRffWave15RunnerState;
    },
  );

  return rffProjectionStoreIndexPromise;
};

export const getCimmichRffCorrectionFamilySpikeState = async () => {
  rffCorrectionFamilySpikeStatePromise ??= fetch(`${rffCorrectionFamilySpikeStateUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF correction-family spike state: ${response.status}`);
    }

    return (await response.json()) as CimmichRffCorrectionFamilySpikeState;
  });

  return rffCorrectionFamilySpikeStatePromise;
};

export const getCimmichRffFaceNameProductionTargetPolicy = async () => {
  rffFaceNameProductionTargetPolicyPromise ??= fetch(`${rffFaceNameProductionTargetPolicyUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF face-name target policy: ${response.status}`);
    }

    return (await response.json()) as CimmichRffFaceNameProductionTargetPolicy;
  });

  return rffFaceNameProductionTargetPolicyPromise;
};

export const getCimmichRffFaceNameTargetFixtureState = async () => {
  rffFaceNameTargetFixtureStatePromise ??= fetch(`${rffFaceNameTargetFixtureStateUrl}?v=${Date.now()}`, {
    cache: 'no-store',
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load RFF face-name target fixture state: ${response.status}`);
    }

    return (await response.json()) as CimmichRffFaceNameTargetFixtureState;
  });

  return rffFaceNameTargetFixtureStatePromise;
};

const archiveLabel = (packId: string) => {
  if (
    packId === 'palace-times' ||
    packId === 'cimmich_archive_pack1_provenance' ||
    packId === 'cimmich_test_pack2' ||
    packId === 'cimmich_archive'
  ) {
    return archivePackLabel;
  }
  return packId.replaceAll('_', ' ').replaceAll('-', ' ');
};

export const invalidateCimmichArchiveGraph = () => {
  archiveGraphVersion += 1;
  archiveGraphPromise = undefined;
};

const basename = (path: string | undefined) => (path ? path.split(/[\\/]/).at(-1) || path : '');

const rffProjectionLabel = (item: CimmichRffProjectionItem) => {
  if (
    item.correction_status === 'durable_record_applied' ||
    item.correction_status === 'production_source_sidecar_applied'
  ) {
    return item.caption_short;
  }
  if (item.projection_status === 'candidate_keyframes_ready') {
    return `${item.keyframe_count} proof-local keyframe${item.keyframe_count === 1 ? '' : 's'} ready`;
  }
  if (item.projection_status === 'explicit_backlog') {
    return item.backlog_reason.replaceAll('_', ' ') || 'Explicit backlog';
  }
  return item.caption_short || item.projection_kind.replaceAll('_', ' ');
};

const rffProjectionMatchesAsset = (item: CimmichRffProjectionItem, asset: AssetResponseDto) => {
  const originalFileName = asset.originalFileName || '';
  const originalPath = asset.originalPath || '';
  const sourcePath = item.source_path || '';
  const sourceBasename = basename(sourcePath).toLowerCase();

  return (
    Boolean(sourcePath && originalPath && sourcePath === originalPath) ||
    Boolean(sourcePath && originalPath && sourcePath.endsWith(`/${basename(originalPath)}`)) ||
    Boolean(originalFileName && sourceBasename === originalFileName.toLowerCase())
  );
};

const evidenceFromRffProjectionItem = (item: CimmichRffProjectionItem): CimmichPhotoEvidence => {
  const filename = basename(item.source_path) || item.projection_id;
  const label = rffProjectionLabel(item);
  const visualUrl = item.evidence_paths[1] || item.evidence_paths[0] || '';
  const correctionEvidence =
    item.correction_status === 'durable_record_applied' ||
    item.correction_status === 'production_source_sidecar_applied'
      ? [
          `RFF correction ${item.correction_delta_ids?.join(', ') || 'applied'}: ${item.correction_family || 'correction'} ${item.correction_status === 'production_source_sidecar_applied' ? 'source sidecar' : 'durable record'} overlaid.`,
          `Previous candidate: ${item.original_caption_short || 'not recorded'}.`,
        ]
      : [];

  return {
    bodyOverlays: [],
    faceOverlays: [],
    filename,
    mediaId: item.projection_id,
    packetItems: [],
    sourcePresenceOverlays: [],
    stateRows: [
      {
        bucket: item.projection_kind,
        confidence: item.projection_status === 'explicit_backlog' ? 'backlog' : 'candidate',
        family: 'rff_photos_videos',
        kind: item.projection_status,
        machineValue: label,
        mediaId: item.projection_id,
        personName: '',
        priority: item.projection_status === 'explicit_backlog' ? 'maintenance' : 'candidate',
        reason: `RFF ${item.lane.replaceAll('_', ' ')} projection; provenance sources only.`,
        stateId: item.projection_id,
        userAction: 'review_when_useful',
        visualUrl,
      },
    ],
    summary: {
      bodyContextPeople: [],
      bodyStateCounts: {},
      candidatePeople: [],
      eventAliases: [],
      eventContext: 'RFF photos/videos archive projection',
      exifDate: '',
      exifStatus: 'unknown',
      faceBucketCounts: {},
      localDescription: label,
      mediaId: item.projection_id,
      normalCaption: item.caption_short || label,
      queryText: [
        item.caption_short,
        item.backlog_reason,
        item.projection_kind,
        item.projection_status,
        item.source_path,
      ]
        .filter(Boolean)
        .join(' '),
      searchRowId: item.projection_id,
      sourcePath: item.source_path,
      sourcePeople: [],
      strongCandidatePeople: [],
      summaryEvidence: [
        `RFF projection ${item.projection_id}: ${item.projection_status.replaceAll('_', ' ')}.`,
        `Truth boundary: candidate read model, not source-of-record sidecar truth.`,
        ...correctionEvidence,
      ],
      visualScene: item.caption_short,
      visualSetting: 'RFF photos/videos lane',
      visionRoute: 'rff_photos_videos_projection',
      visionRouteReason: `archive=${item.projection_kind}; provenance sources only`,
    },
  };
};

const mergeRffProjectionEvidence = (
  evidence: CimmichPhotoEvidence,
  item: CimmichRffProjectionItem,
): CimmichPhotoEvidence => {
  const projectionEvidence = evidenceFromRffProjectionItem(item);
  return {
    ...evidence,
    stateRows: [...(evidence.stateRows ?? []), ...projectionEvidence.stateRows],
    summary: evidence.summary
      ? {
          ...evidence.summary,
          summaryEvidence: [
            ...(evidence.summary.summaryEvidence ?? []),
            ...(projectionEvidence.summary?.summaryEvidence ?? []),
          ],
        }
      : projectionEvidence.summary,
  };
};

const emptyPersonBucket = (): CountMap => ({});

const incrementCount = (counts: CountMap, label: string | undefined, by = 1) => {
  const key = (label || '').trim();
  if (!key) {
    return;
  }

  counts[key] = (counts[key] ?? 0) + by;
};

const evidenceFromPackQcPhoto = (
  pack: Pick<CimmichPackQcIndex, 'archiveId' | 'packId'>,
  photo: CimmichPackQcPhoto,
): CimmichPhotoEvidence => {
  const faceBucketCounts: CountMap = {};
  for (const face of photo.faceOverlays ?? []) {
    incrementCount(faceBucketCounts, face.bucket || face.status);
  }
  const candidatePeople = [
    ...new Set(
      (photo.faceOverlays ?? [])
        .filter((face) => face.status !== 'named' && isUsefulPersonName(face.candidateName))
        .map((face) => normalizedName(face.candidateName)),
    ),
  ];

  return {
    bodyOverlays: photo.bodyOverlays ?? [],
    faceOverlays: photo.faceOverlays ?? [],
    filename: photo.filename,
    mediaId: photo.mediaId,
    packetItems: [],
    sourcePresenceOverlays: photo.sourcePresenceOverlays ?? [],
    stateRows: [],
    summary: {
      bodyContextPeople: [],
      bodyStateCounts: {},
      candidatePeople,
      eventAliases: [],
      entities: photo.summary.entities ?? [],
      eventContext: photo.summary.tripContext || archiveLabel(pack.archiveId || pack.packId),
      exifDate: '',
      exifStatus: 'unknown',
      faceBucketCounts,
      localDescription: photo.summary.normalCaption,
      mediaId: photo.mediaId,
      normalCaption: photo.summary.normalCaption,
      enhancedCaption: photo.summary.enhancedCaption,
      summaryEvidence: photo.summary.evidenceLines ?? [],
      queryText: [
        photo.summary.normalCaption,
        photo.summary.enhancedCaption,
        photo.summary.placeContext,
        photo.summary.tripContext,
        ...photo.summary.namedPeople,
        ...(photo.summary.entities ?? []).flatMap((entity) => [
          entity.name,
          entity.entity_type,
          entity.description ?? '',
        ]),
        ...candidatePeople,
      ]
        .filter(Boolean)
        .join(' '),
      searchRowId: `${pack.archiveId || 'cimmich_archive'}:${photo.mediaId || photo.filename}`,
      sourcePath: photo.sourcePath,
      sourcePeople: photo.summary.namedPeople,
      strongCandidatePeople: [],
      trustedSourcePeople: photo.summary.namedPeople,
      visibleActions: [],
      visualScene: photo.summary.normalCaption,
      visualSetting: canonicalPlaceLabel(photo.summary.placeContext) || photo.summary.tripContext,
      visionRoute: 'cimmich_qc_index',
      visionRouteReason: `source_supervised_archive:${pack.archiveId || 'cimmich_archive'}`,
    },
  };
};

const projectFullArchiveIdentitySlate = (
  detail: CimmichFullArchiveQcDetail,
  machineIdentitiesByFaceId: ReadonlyMap<string, CimmichAugustPrimaryMachineCandidates['rows'][number]>,
) => {
  const faceById = new Map((detail.faceOverlays ?? []).map((face) => [face.id, face]));
  const bodyById = new Map((detail.bodyOverlays ?? []).map((body) => [body.id, body]));

  for (const entry of detail.identitySlate.entries) {
    if (!entry.bbox || !entry.faceIds?.length) {
      continue;
    }

    const entryIsNamed = entry.state === 'accepted_face_match' && Boolean(normalizedName(entry.name));
    const evidenceSource = typeof entry.evidence.source === 'string' ? entry.evidence.source : entry.boundary;
    const evidenceScore = entry.evidence.score == null ? '' : String(entry.evidence.score);
    for (const faceId of entry.faceIds) {
      const existing = faceById.get(faceId);
      const machineIdentity = machineIdentitiesByFaceId.get(faceId);
      const machineAcceptedName = machineIdentity?.projectionStatus === 'accepted' ? machineIdentity.machineName : '';
      const isNamed = entryIsNamed || Boolean(normalizedName(machineAcceptedName));
      const projectedName = entryIsNamed ? entry.name : machineAcceptedName;
      const primaryMachineCandidate = projectPrimaryMachineCandidateNames(
        existing,
        machineIdentity?.projectionStatus === 'review' ? machineIdentity.machineName : undefined,
      );
      faceById.set(faceId, {
        ...existing,
        bbox: entry.bbox,
        bucket: isNamed
          ? 'accepted_identity_slate'
          : machineIdentity?.projectionStatus === 'review'
            ? 'machine_review_identity'
            : 'unresolved_identity_slate',
        bucketConfidence: entry.confidence,
        candidateName: primaryMachineCandidate.candidateName,
        detScore: evidenceScore || existing?.detScore || '',
        id: faceId,
        image: entry.image ?? existing?.image ?? null,
        label: isNamed ? projectedName : existing?.label || 'Unresolved face',
        name: isNamed ? projectedName : existing?.name || '',
        personIdentityKey: isNamed ? entry.identityKey : existing?.personIdentityKey,
        personIdentitySource: isNamed ? evidenceSource : existing?.personIdentitySource,
        reviewCandidateName: primaryMachineCandidate.reviewCandidateName,
        source: existing?.source || evidenceSource,
        status: isNamed ? 'named' : 'untagged',
      });
    }

    if (entryIsNamed && entry.bodyIds?.length) {
      for (const bodyId of entry.bodyIds) {
        const body = bodyById.get(bodyId);
        if (!body) {
          continue;
        }
        bodyById.set(bodyId, {
          ...body,
          linkedFaceId: entry.faceIds[0],
          linkedName: entry.name,
          linkReason: 'identity_slate_face_body_link',
          linkStatus: 'linked_to_named_face',
          status: 'linked',
        });
      }
    }
  }

  const fallbackImage = detail.identitySlate.entries.find((entry) => entry.image)?.image ?? null;
  const overlapsExistingFace = (bbox: { x1: number; x2: number; y1: number; y2: number }) =>
    [...faceById.values()].some((face) => {
      const intersectionWidth = Math.max(0, Math.min(face.bbox.x2, bbox.x2) - Math.max(face.bbox.x1, bbox.x1));
      const intersectionHeight = Math.max(0, Math.min(face.bbox.y2, bbox.y2) - Math.max(face.bbox.y1, bbox.y1));
      const intersection = intersectionWidth * intersectionHeight;
      const faceArea = Math.max(0, face.bbox.x2 - face.bbox.x1) * Math.max(0, face.bbox.y2 - face.bbox.y1);
      const bboxArea = Math.max(0, bbox.x2 - bbox.x1) * Math.max(0, bbox.y2 - bbox.y1);
      const union = faceArea + bboxArea - intersection;
      return union > 0 && intersection / union >= 0.5;
    });
  for (const machineIdentity of machineIdentitiesByFaceId.values()) {
    if (faceById.has(machineIdentity.faceId)) {
      continue;
    }
    const [x1, y1, x2, y2] = machineIdentity.bboxXyxy;
    if (overlapsExistingFace({ x1, x2, y1, y2 })) {
      continue;
    }
    const isNamed = machineIdentity.projectionStatus === 'accepted';
    const isReview = machineIdentity.projectionStatus === 'review';
    faceById.set(machineIdentity.faceId, {
      bbox: { x1, x2, y1, y2 },
      bucket: isNamed
        ? 'accepted_machine_identity'
        : isReview
          ? 'machine_review_identity'
          : 'machine_unresolved_identity',
      bucketConfidence: machineIdentity.score,
      detScore: machineIdentity.score,
      id: machineIdentity.faceId,
      image: fallbackImage,
      label: isNamed ? machineIdentity.machineName : 'Unresolved face',
      name: isNamed ? machineIdentity.machineName : '',
      reviewCandidateName: isNamed ? undefined : machineIdentity.machineName,
      source: machineIdentity.decision,
      status: isNamed ? 'named' : 'untagged',
    });
  }

  const observationLinkedBodyIds = new Set<string>();
  for (const face of [...faceById.values()].filter((candidate) => candidate.status === 'untagged')) {
    const faceCenterX = (face.bbox.x1 + face.bbox.x2) / 2;
    const faceCenterY = (face.bbox.y1 + face.bbox.y2) / 2;
    const candidates = [...bodyById.values()]
      .filter(
        (body) =>
          body.status !== 'linked' &&
          !body.linkedFaceId &&
          !observationLinkedBodyIds.has(body.id) &&
          faceCenterX >= body.bbox.x1 &&
          faceCenterX <= body.bbox.x2 &&
          faceCenterY >= body.bbox.y1 &&
          faceCenterY <= body.bbox.y1 + (body.bbox.y2 - body.bbox.y1) * 0.42,
      )
      .sort((a, b) => {
        const score = (body: CimmichBodyOverlay) => {
          const width = Math.max(1, body.bbox.x2 - body.bbox.x1);
          const height = Math.max(1, body.bbox.y2 - body.bbox.y1);
          const headCenterX = (body.bbox.x1 + body.bbox.x2) / 2;
          const headCenterY = body.bbox.y1 + height * 0.12;
          return Math.abs(faceCenterX - headCenterX) / width + Math.abs(faceCenterY - headCenterY) / height;
        };
        return score(a) - score(b);
      });
    const linkedBody = candidates[0];
    if (!linkedBody) {
      continue;
    }
    observationLinkedBodyIds.add(linkedBody.id);
    bodyById.set(linkedBody.id, {
      ...linkedBody,
      linkedFaceId: face.id,
      linkReason: 'identity_slate_local_face_body_geometry',
    });
  }

  const faces = [...faceById.values()];
  const representedNames = new Set(
    faces.filter((face) => face.status === 'named').map((face) => normalizedName(face.name).toLowerCase()),
  );

  return {
    bodyOverlays: [...bodyById.values()],
    faceOverlays: faces,
    sourcePresenceOverlays: detail.sourcePresenceOverlays.filter(
      (presence) => !representedNames.has(normalizedName(presence.name).toLowerCase()),
    ),
  };
};

const normalizedName = (name: string | undefined) => (name || '').trim();
const archiveIdentityKeyForName = (name: string | undefined) =>
  normalizedName(name)
    .replace(/\s+\d+$/, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
const canonicalPlaceLabel = (label: string | undefined) => {
  const value = (label || '').trim();
  if (!value) {
    return '';
  }
  return value;
};

const isUsefulPersonName = (name: string | undefined) => {
  const value = normalizedName(name).toLowerCase();
  return Boolean(value) && !['noise', 'untagged', 'unlinked', 'unknown'].includes(value);
};

const numberValue = (value: string | number | undefined) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const boxArea = (bbox: CimmichFaceOverlay['bbox'] | CimmichBodyOverlay['bbox']) =>
  Math.max(1, bbox.x2 - bbox.x1) * Math.max(1, bbox.y2 - bbox.y1);

const imageArea = (image: CimmichFaceOverlay['image'] | CimmichBodyOverlay['image']) =>
  Math.max(1, image?.width ?? 1) * Math.max(1, image?.height ?? 1);

const bucketScore = (bucket: string | undefined = '') => {
  const value = bucket;
  if (value === 'face_source_tag_prototype_match') {
    return 90;
  }
  if (value.includes('accepted') || value.includes('matched')) {
    return 80;
  }
  if (value.includes('situational')) {
    return 66;
  }
  if (value.includes('hard_salvage')) {
    return 36;
  }
  return 50;
};

const confidenceScore = (confidence: string | undefined) => {
  if (confidence === 'high') {
    return 24;
  }
  if (confidence === 'medium') {
    return 14;
  }
  if (confidence === 'low') {
    return 4;
  }
  return 8;
};

const faceRepresentativeScore = (face: CimmichFaceOverlay) => {
  const areaRatio = boxArea(face.bbox) / imageArea(face.image);
  const sizeScore = Math.min(40, Math.sqrt(areaRatio) * 420);
  const detScore = numberValue(face.detScore) * 28;
  const prototypeScore = numberValue(face.prototypeScore) * 18;
  return bucketScore(face.bucket) + confidenceScore(face.bucketConfidence) + sizeScore + detScore + prototypeScore;
};

const bodyRepresentativeScore = (body: CimmichBodyOverlay) => {
  const areaRatio = boxArea(body.bbox) / imageArea(body.image);
  const sizeScore = Math.min(46, Math.sqrt(areaRatio) * 180);
  const confidence = numberValue(body.confidence) * 34;
  const poseScore = body.poseQuality.includes('full') ? 18 : body.poseQuality.includes('most') ? 12 : 6;
  return sizeScore + confidence + poseScore;
};

export const buildCimmichPeopleIndex = (bundle: CimmichEvidenceBundle, packIndexes: CimmichPackQcIndex[] = []) => {
  const people = new Map<string, CimmichPersonProfile>();
  const peopleByIdentityKey = new Map<string, CimmichPersonProfile>();
  const photoSeenByPerson = new Map<string, Set<string>>();
  const archiveQcFilenames = new Set(packIndexes.flatMap((pack) => (pack.photos ?? []).map((photo) => photo.filename)));

  const ensurePerson = (name: string, identityKey = '') => {
    const cleanName = normalizedName(name);
    if (!isUsefulPersonName(cleanName)) {
      return undefined;
    }

    const key = identityKey || archiveIdentityKeyForName(cleanName);
    let person = key ? peopleByIdentityKey.get(key) : undefined;
    person ??= people.get(cleanName);
    if (!person) {
      person = {
        aliases: [],
        bodyLinks: 0,
        buckets: emptyPersonBucket(),
        candidatePhotos: 0,
        eventCounts: emptyPersonBucket(),
        faceCount: 0,
        knownActions: emptyPersonBucket(),
        knownObjects: emptyPersonBucket(),
        knownPlaces: emptyPersonBucket(),
        identityKey: key || undefined,
        name: cleanName,
        packCounts: emptyPersonBucket(),
        photos: [],
        sourcePhotos: 0,
        sourceSupervisedPhotos: 0,
        unresolvedFaces: 0,
      };
      people.set(cleanName, person);
      photoSeenByPerson.set(cleanName, new Set<string>());
    } else if (person.name !== cleanName && !person.aliases.includes(cleanName)) {
      person.aliases.push(cleanName);
    }
    if (key && !person.identityKey) {
      person.identityKey = key;
    }
    if (key) {
      peopleByIdentityKey.set(key, person);
    }

    return person;
  };

  const addPhoto = (
    person: CimmichPersonProfile,
    photo: CimmichPhotoEvidence,
    extra: {
      packId?: string;
      packLabel?: string;
      qcStatus?: CimmichPackQcPhoto['status'];
      seenKey?: string;
      sourcePath?: string;
    } = {},
  ) => {
    const filename = photo.filename || photo.mediaId;
    const seen = photoSeenByPerson.get(person.name);
    const seenKey = extra.seenKey ?? filename;
    if (seen?.has(seenKey)) {
      return;
    }

    seen?.add(seenKey);
    person.photos.push({
      bodyLinks: [],
      enhancedCaption: photo.summary?.enhancedCaption,
      eventAliases: photo.summary?.eventAliases ?? [],
      eventContext: photo.summary?.eventContext || 'Unspecified event',
      evidence: photo,
      faceOverlays: [],
      filename,
      mediaId: photo.mediaId,
      normalCaption: photo.summary?.normalCaption || photo.summary?.visualCaption,
      packId: extra.packId,
      packLabel: extra.packLabel,
      qcStatus: extra.qcStatus,
      sourcePath: extra.sourcePath,
      visibleActions: photo.summary?.visibleActions ?? [],
      visualScene: photo.summary?.visualScene,
      visualSetting: photo.summary?.visualSetting,
    });
  };

  const getPersonPhoto = (person: CimmichPersonProfile, filename: string) =>
    person.photos.find((photo) => photo.filename === filename);

  const identityKeyForName = (photo: CimmichPhotoEvidence, name: string) =>
    photo.summary?.sourcePriorIdentityKeys?.[normalizedName(name)] ?? '';

  for (const photo of Object.values(bundle.photos)) {
    if (!photo.summary) {
      continue;
    }

    const filename = photo.filename || photo.mediaId;
    if (archiveQcFilenames.has(filename)) {
      continue;
    }

    const unresolvedFaces =
      photo.faceOverlays?.filter((face) => face.status === 'sidecar_only' || face.status === 'untagged') ?? [];
    const participantNames = new Set<string>();

    for (const name of photo.summary.sourcePeople ?? []) {
      const person = ensurePerson(name, identityKeyForName(photo, name));
      if (person) {
        person.sourcePhotos += 1;
        participantNames.add(person.name);
      }
    }

    for (const name of [...(photo.summary.candidatePeople ?? []), ...(photo.summary.strongCandidatePeople ?? [])]) {
      const person = ensurePerson(name, identityKeyForName(photo, name));
      if (person) {
        person.candidatePhotos += 1;
        participantNames.add(person.name);
      }
    }

    for (const face of photo.faceOverlays ?? []) {
      if (face.status !== 'named') {
        continue;
      }
      const person = ensurePerson(face.name, face.personIdentityKey || identityKeyForName(photo, face.name));
      if (person) {
        person.faceCount += 1;
        incrementCount(person.buckets, face.bucket || face.status);
        participantNames.add(person.name);
        const score = faceRepresentativeScore(face);
        if (!person.featureFace || score > (person.featureFace.score ?? 0)) {
          person.featureFace = { bbox: face.bbox, cropUrl: face.cropUrl, filename, image: face.image, score };
        }
      }
    }

    for (const body of photo.bodyOverlays ?? []) {
      const person = ensurePerson(body.linkedName, identityKeyForName(photo, body.linkedName));
      if (person) {
        person.bodyLinks += body.status === 'linked' ? 1 : 0;
        participantNames.add(person.name);
        if (body.status === 'linked') {
          const score = bodyRepresentativeScore(body);
          if (!person.featureBody || score > (person.featureBody.score ?? 0)) {
            person.featureBody = { bbox: body.bbox, filename, image: body.image, score };
          }
        }
      }
    }

    for (const name of participantNames) {
      const person = ensurePerson(name, identityKeyForName(photo, name));
      if (!person) {
        continue;
      }

      incrementCount(person.packCounts, archivePackLabel);
      addPhoto(person, photo, {
        packId: 'cimmich_archive',
        packLabel: archivePackLabel,
        seenKey: `cimmich_archive:${photo.mediaId || filename}`,
      });
      person.unresolvedFaces += unresolvedFaces.length;
      incrementCount(person.eventCounts, photo.summary.eventContext || 'Unspecified event');
      incrementCount(
        person.knownPlaces,
        canonicalPlaceLabel(photo.summary.visualSetting) || photo.summary.visualScene || photo.summary.eventContext,
      );
      incrementCount(person.knownObjects, photo.summary.visualScene);

      for (const action of photo.summary.visibleActions ?? []) {
        incrementCount(person.knownActions, action);
      }
    }

    for (const face of photo.faceOverlays ?? []) {
      if (face.status !== 'named') {
        continue;
      }
      const person = ensurePerson(face.name, face.personIdentityKey || identityKeyForName(photo, face.name));
      const personPhoto = person ? getPersonPhoto(person, filename) : undefined;
      personPhoto?.faceOverlays.push(face);
    }

    for (const body of photo.bodyOverlays ?? []) {
      const person = ensurePerson(body.linkedName, identityKeyForName(photo, body.linkedName));
      const personPhoto = person ? getPersonPhoto(person, filename) : undefined;
      if (body.status === 'linked') {
        personPhoto?.bodyLinks.push(body);
      }
    }
  }

  for (const pack of packIndexes) {
    const label = archiveLabel(pack.archiveId || pack.packId);
    for (const packPhoto of pack.photos ?? []) {
      const summary = packPhoto.summary;
      if (
        !summary?.namedPeople?.length &&
        !(packPhoto.faceOverlays ?? []).some((face) => isUsefulPersonName(face.candidateName))
      ) {
        continue;
      }
      const candidatePeople = [
        ...new Set(
          (packPhoto.faceOverlays ?? [])
            .filter((face) => face.status !== 'named' && isUsefulPersonName(face.candidateName))
            .map((face) => normalizedName(face.candidateName)),
        ),
      ];

      const evidence: CimmichPhotoEvidence = {
        bodyOverlays: packPhoto.bodyOverlays ?? [],
        faceOverlays: packPhoto.faceOverlays ?? [],
        filename: packPhoto.filename,
        mediaId: packPhoto.mediaId,
        packetItems: [],
        sourcePresenceOverlays: packPhoto.sourcePresenceOverlays ?? [],
        stateRows: [],
        summary: {
          bodyContextPeople: [],
          bodyStateCounts: {},
          candidatePeople,
          eventAliases: [],
          eventContext: summary.tripContext || label,
          exifDate: '',
          exifStatus: 'unknown',
          faceBucketCounts: {},
          localDescription: summary.normalCaption,
          mediaId: packPhoto.mediaId,
          normalCaption: summary.normalCaption,
          enhancedCaption: summary.enhancedCaption,
          summaryEvidence: summary.evidenceLines ?? [],
          queryText: [
            summary.normalCaption,
            summary.enhancedCaption,
            summary.placeContext,
            summary.tripContext,
            ...summary.namedPeople,
            ...candidatePeople,
          ]
            .filter(Boolean)
            .join(' '),
          searchRowId: `${pack.archiveId || 'cimmich_archive'}:${packPhoto.mediaId || packPhoto.filename}`,
          sourcePath: packPhoto.sourcePath,
          sourcePeople: summary.namedPeople,
          strongCandidatePeople: [],
          visibleActions: [],
          visualScene: summary.normalCaption,
          visualSetting: canonicalPlaceLabel(summary.placeContext) || summary.tripContext,
          visionRoute: 'cimmich_qc_index',
          visionRouteReason: `source_supervised_archive:${pack.archiveId || 'cimmich_archive'}`,
        },
      };

      for (const name of summary.namedPeople) {
        const person = ensurePerson(name);
        if (!person) {
          continue;
        }

        person.sourcePhotos += 1;
        person.sourceSupervisedPhotos += 1;
        incrementCount(person.buckets, `source_supervised_archive:${pack.archiveId || 'cimmich_archive'}`);
        incrementCount(person.packCounts, label);
        incrementCount(person.eventCounts, summary.tripContext || label);
        incrementCount(person.knownPlaces, canonicalPlaceLabel(summary.placeContext) || summary.tripContext || label);
        addPhoto(person, evidence, {
          packId: pack.archiveId || 'cimmich_archive',
          packLabel: label,
          qcStatus: packPhoto.status,
          seenKey: `${pack.archiveId || 'cimmich_archive'}:${packPhoto.mediaId || packPhoto.filename}`,
          sourcePath: packPhoto.sourcePath,
        });

        const personPhoto = getPersonPhoto(person, packPhoto.filename);
        for (const face of evidence.faceOverlays ?? []) {
          if (face.status !== 'named' || face.name !== person.name) {
            continue;
          }
          person.faceCount += 1;
          incrementCount(person.buckets, face.bucket || face.status);
          personPhoto?.faceOverlays.push(face);
          const score = faceRepresentativeScore(face);
          if (!person.featureFace || score > (person.featureFace.score ?? 0)) {
            person.featureFace = {
              bbox: face.bbox,
              cropUrl: face.cropUrl,
              filename: packPhoto.filename,
              image: face.image,
              score,
            };
          }
        }
      }

      for (const name of candidatePeople) {
        const person = ensurePerson(name);
        if (!person) {
          continue;
        }
        person.candidatePhotos += 1;
        incrementCount(person.buckets, `candidate_source_present:${pack.archiveId || 'cimmich_archive'}`);
        incrementCount(person.packCounts, label);
        incrementCount(person.eventCounts, summary.tripContext || label);
        incrementCount(person.knownPlaces, canonicalPlaceLabel(summary.placeContext) || summary.tripContext || label);
        addPhoto(person, evidence, {
          packId: pack.archiveId || 'cimmich_archive',
          packLabel: label,
          qcStatus: packPhoto.status,
          seenKey: `${pack.archiveId || 'cimmich_archive'}:candidate:${name}:${packPhoto.mediaId || packPhoto.filename}`,
          sourcePath: packPhoto.sourcePath,
        });

        const personPhoto = getPersonPhoto(person, packPhoto.filename);
        for (const face of evidence.faceOverlays ?? []) {
          if (face.status === 'named' || normalizedName(face.candidateName) !== person.name) {
            continue;
          }
          personPhoto?.faceOverlays.push(face);
        }
      }
    }
  }

  for (const person of people.values()) {
    person.photos.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  return [...people.values()].sort(
    (a, b) =>
      b.photos.length - a.photos.length ||
      b.faceCount - a.faceCount ||
      b.bodyLinks - a.bodyLinks ||
      a.name.localeCompare(b.name),
  );
};

export const resolveCimmichAssetsByFilename = async (filenames: string[]) => {
  const uniqueFilenames = [...new Set(filenames.filter(Boolean))];
  const resolved: Record<string, CimmichResolvedAsset> = {};

  await Promise.all(
    uniqueFilenames.map(async (filename) => {
      try {
        const result = await searchAssets({
          metadataSearchDto: { originalFileName: filename, size: 1, withExif: true },
        });
        const asset = result.assets.items.find((item) => item.originalFileName === filename) ?? result.assets.items[0];

        if (asset) {
          const latitude = asset.exifInfo?.latitude;
          const longitude = asset.exifInfo?.longitude;
          const hasCoordinates =
            typeof latitude === 'number' &&
            Number.isFinite(latitude) &&
            typeof longitude === 'number' &&
            Number.isFinite(longitude);

          resolved[filename] = {
            asset,
            city: asset.exifInfo?.city,
            country: asset.exifInfo?.country,
            hasCoordinates,
            latitude,
            longitude,
            previewUrl: getAssetMediaUrl({ id: asset.id, cacheKey: asset.thumbhash, size: AssetMediaSize.Preview }),
            state: asset.exifInfo?.state,
            thumbnailUrl: getAssetMediaUrl({ id: asset.id, cacheKey: asset.thumbhash, size: AssetMediaSize.Thumbnail }),
          };
        }
      } catch {
        // Missing assets should leave the Cimmich read model visible.
      }
    }),
  );

  return resolved;
};

const evidenceFromCimmichAsset = (asset: CimmichAssetEvidence): CimmichPhotoEvidence => {
  const image = { height: asset.height, width: asset.width };
  const toBox = (box: { box_h: number; box_w: number; box_x: number; box_y: number }) => ({
    x1: Math.round(box.box_x * asset.width),
    x2: Math.round((box.box_x + box.box_w) * asset.width),
    y1: Math.round(box.box_y * asset.height),
    y2: Math.round((box.box_y + box.box_h) * asset.height),
  });
  const faceOverlays: CimmichFaceOverlay[] = asset.faces.map((face) => {
    const mainBucket = ['prime', 'secondary', 'lq', 'head'].find((bucket) => face.buckets.includes(bucket));
    const specialty = face.buckets.find((bucket) => bucket.startsWith('specialty:'));
    const bucket = mainBucket
      ? `face_${mainBucket}`
      : specialty
        ? `face_${specialty.replace(':', '_')}`
        : face.display_name
          ? 'face_accepted'
          : face.candidate_display_name
            ? 'face_candidate'
            : 'face_unassigned';
    return {
      bbox: toBox(face),
      bucket,
      bucketConfidence: String(face.quality_measurements?.quality_score ?? ''),
      candidateIdentityKey: face.candidate_person_id ?? undefined,
      candidateAbstainReason: face.candidate_abstain_reason ?? undefined,
      candidateClaimId: face.candidate_identity_claim_id ?? undefined,
      candidateMatches: face.candidate_matches,
      candidateName: face.candidate_display_name ?? undefined,
      currentDecisionId: face.current_decision_id ?? undefined,
      currentRevision: face.current_revision,
      detScore: String(face.detection_confidence ?? ''),
      id: face.face_id,
      identityClaimId: face.identity_claim_id ?? undefined,
      image,
      label: face.display_name || face.candidate_display_name || 'Unassigned face',
      name: face.display_name || '',
      personIdentityKey: face.person_id ?? undefined,
      personIdentitySource: face.display_name ? 'Cimmich accepted identity' : undefined,
      rejectedClaimId: face.rejected_identity_claim_id ?? undefined,
      rejectedName: face.rejected_display_name ?? undefined,
      rejectedPersonIdentityKey: face.rejected_person_id ?? undefined,
      reviewDecisionId: face.review_decision_id ?? undefined,
      reviewDisposition: face.review_disposition,
      source: 'cimmich',
      status: face.display_name ? 'named' : 'untagged',
    };
  });
  const bodyOverlays: CimmichBodyOverlay[] = asset.bodies.map((body) => {
    const linkedFaceId = body.face_link_id || body.supporting_face_id || '';
    const geometryLinked = body.face_link_state === 'geometry';
    const pose = projectCimmichBodyPose(body.pose, image);
    return {
      bbox: toBox(body),
      bodyId: body.body_id,
      confidence: String(
        body.face_link_confidence ??
          body.quality_measurements?.quality_score ??
          body.quality_measurements?.score_mean ??
          '',
      ),
      currentDecisionId: body.current_decision_id ?? undefined,
      currentRevision: body.current_revision,
      id: body.body_id,
      image,
      keypoints: pose.keypoints,
      keypointScores: pose.keypointScores,
      keypointSkeleton: pose.keypointSkeleton,
      keypointSource: pose.keypointSource,
      label: body.display_name || (linkedFaceId ? 'Linked body' : 'Unlinked body'),
      linkedFaceId,
      linkedName: body.display_name || '',
      linkReason: body.display_name
        ? 'Cimmich accepted Body Tag'
        : geometryLinked
          ? 'Cimmich automatic face-body geometry'
          : '',
      linkSource: body.face_link_source ?? undefined,
      linkStatus: projectBodyLinkStatus({ displayName: body.display_name, geometryLinked, linkedFaceId }),
      maskStatus: '',
      maskUse: '',
      poseQuality: '',
      poseReasonCode: pose.poseReasonCode,
      poseState: pose.poseState,
      source: 'cimmich',
      status: projectBodyIdentityStatus({ displayName: body.display_name, linkedFaceId }),
    };
  });
  const sourcePeople = [...new Set(asset.faces.map((face) => face.display_name).filter(isNonEmptyString))];
  const candidatePeople = [...new Set(asset.faces.map((face) => face.candidate_display_name).filter(isNonEmptyString))];
  return {
    bodyOverlays,
    contexts: (asset.contexts ?? []).map((context) => ({
      associationKind: context.association_kind,
      displayName: context.display_name,
      entityId: context.entity_id,
      entityKind: context.entity_kind,
      family: context.entity_kind === 'event' ? 'events' : context.entity_kind === 'object' ? 'objects' : 'places',
      typeKind: context.type_kind,
    })),
    faceOverlays,
    filename: asset.filename,
    holdingPeople: asset.known_people.filter((person) => person.needs_holding).map((person) => person.display_name),
    knownPeople: asset.known_people.map((person) => person.display_name),
    mediaId: asset.sourceAssetId,
    ownerSummary: asset.ownerSummary,
    packetItems: [],
    provider: 'cimmich',
    sourcePresenceOverlays: [],
    stateRows: asset.presence.map((presence) => ({
      bucket: 'presence',
      confidence: '',
      family: 'presence',
      kind: 'accepted_presence',
      machineValue: '',
      mediaId: asset.sourceAssetId,
      personName: presence.display_name,
      priority: '',
      reason: presence.reason_code,
      stateId: `${presence.person_id}:${asset.asset_id}`,
      userAction: '',
      visualUrl: '',
    })),
    summary: {
      bodyContextPeople: bodyOverlays.map((body) => body.linkedName).filter(Boolean),
      bodyStateCounts: {},
      candidatePeople,
      eventAliases: [],
      eventContext: '',
      exifDate: asset.capture_time || '',
      exifStatus: '',
      faceBucketCounts: Object.fromEntries(
        [...new Set(faceOverlays.map((face) => face.bucket))].map((bucket) => [
          bucket,
          faceOverlays.filter((face) => face.bucket === bucket).length,
        ]),
      ),
      localDescription: '',
      mediaId: asset.sourceAssetId,
      queryText: '',
      searchRowId: asset.asset_id,
      sourcePath: '',
      sourcePeople,
      strongCandidatePeople: [],
      visionRoute: 'cimmich_local_evidence',
      visionRouteReason: '',
    },
    thingRegions: asset.thingRegions ?? [],
  };
};

const getCurrentCimmichEvidenceForAsset = async (asset: AssetResponseDto): Promise<CimmichEvidenceResult> => {
  try {
    const cimmich = await getCimmichAssetEvidence(asset.id);
    const evidence = evidenceFromCimmichAsset(cimmich);
    return {
      bundle: {
        globalSummary: {
          actionRowCount: 0,
          allowedDecisions: ['rename'],
          blanketReapprovalRows: 0,
          bodyContextRows: cimmich.bodies.length,
          knownPersonCandidateRows: cimmich.faces.filter((face) => face.candidate_display_name).length,
          markerSupportRows: 0,
          searchFrontierCandidateRows: 0,
          stateRowCount: evidence.stateRows.length,
        },
        photos: { [cimmich.filename]: evidence },
        schemaVersion: 'cimmich.asset-evidence.v1',
      },
      evidence,
      matchedFilename: cimmich.filename,
    };
  } catch (error) {
    if (error instanceof CimmichServiceError && error.code === 'ASSET_DISPLAY_NOT_FOUND') {
      throw new Error('Cimmich details are not available in this viewing mode.', { cause: error });
    }
    const detail = error instanceof Error ? error.message : 'Unknown Cimmich evidence error';
    throw new Error(`Cimmich details could not be loaded: ${detail}`, { cause: error });
  }
};

// The inherited resolver remains available for the preserved Cimmich-only routes,
// but the Cimmich photo viewer must never silently fall through to private bundles.
export const getLegacyCimmichEvidenceForAsset = async (asset: AssetResponseDto): Promise<CimmichEvidenceResult> => {
  const [bundle, step2Readback] = await Promise.all([
    getCimmichEvidenceBundle(),
    getCimmichStep2Readback(asset).catch(() => undefined),
  ]);
  const archiveQcIndexes = await getCimmichArchiveQcIndexes().catch(() => []);
  const rffReadModel = await getCimmichRffPhotosVideosReadModel().catch(() => undefined);
  const rffProjection = rffReadModel?.items.find((item) => rffProjectionMatchesAsset(item, asset));
  const exactCandidates = [asset.originalFileName, basename(asset.originalPath)].filter(Boolean);

  for (const archiveQcIndex of archiveQcIndexes) {
    const normalizedCandidates = new Set(exactCandidates.map((filename) => filename.toLowerCase()));
    const originalPath = (asset.originalPath || '').toLowerCase();
    const sourcePathVariants = (sourcePath: string) => [sourcePath].filter(Boolean).map((path) => path.toLowerCase());
    const packPhoto = archiveQcIndex.photos.find((photo) => {
      const filename = photo.filename.toLowerCase();
      return (
        normalizedCandidates.has(filename) ||
        basename(photo.sourcePath).toLowerCase() === basename(asset.originalPath).toLowerCase() ||
        sourcePathVariants(photo.sourcePath).some((sourcePath) => originalPath.endsWith(sourcePath))
      );
    });

    if (packPhoto) {
      return {
        bundle,
        evidence: evidenceFromPackQcPhoto(archiveQcIndex, packPhoto),
        matchedFilename: packPhoto.filename,
        rffProjection,
        step2Readback,
      };
    }
  }

  const fullArchiveSourcePath = '';
  const [fullArchiveDetail, augustPrimaryMachineCandidates] = await Promise.all([
    getCimmichFullArchiveQcDetail('', asset.originalFileName, fullArchiveSourcePath).catch(() => undefined),
    getCimmichAugustPrimaryMachineCandidates().catch(() => undefined),
  ]);
  if (fullArchiveDetail) {
    const machineIdentitiesByFaceId = new Map(
      (augustPrimaryMachineCandidates?.rows ?? [])
        .filter((row) => row.mediaId === fullArchiveDetail.mediaId)
        .map((row) => [row.faceId, row]),
    );
    const projectedIdentitySlate = projectFullArchiveIdentitySlate(fullArchiveDetail, machineIdentitiesByFaceId);
    const fullArchivePhoto: CimmichPackQcPhoto = {
      bodyOverlays: projectedIdentitySlate.bodyOverlays,
      counts: {
        acceptedAssignments: fullArchiveDetail.counts.acceptedAssignments ?? 0,
        machineFaces: fullArchiveDetail.counts.machineFaces ?? 0,
        reviewAssignments: fullArchiveDetail.counts.reviewAssignments ?? 0,
        sidecarDeltas: fullArchiveDetail.counts.sidecarDeltas ?? 0,
        sourceAnchors: fullArchiveDetail.counts.sourceAnchors ?? 0,
        unresolvedAssignments: fullArchiveDetail.counts.unresolvedAssignments ?? 0,
      },
      faceOverlays: projectedIdentitySlate.faceOverlays,
      filename: fullArchiveDetail.filename,
      mediaId: fullArchiveDetail.mediaId,
      sourcePath: fullArchiveDetail.sourcePath,
      sourcePresenceOverlays: projectedIdentitySlate.sourcePresenceOverlays,
      status: fullArchiveDetail.status,
      summary: fullArchiveDetail.summary,
    };

    return {
      bundle,
      evidence: evidenceFromPackQcPhoto(
        { archiveId: 'cimmich_archive', packId: 'cimmich_full_archive_machinery_safe_v1' },
        fullArchivePhoto,
      ),
      matchedFilename: fullArchiveDetail.filename,
      rffProjection,
      step2Readback,
    };
  }

  for (const filename of exactCandidates) {
    const evidence = bundle.photos[filename];
    if (evidence) {
      return {
        bundle,
        evidence: rffProjection ? mergeRffProjectionEvidence(evidence, rffProjection) : evidence,
        matchedFilename: filename,
        rffProjection,
        step2Readback,
      };
    }
  }

  const lowerFilenameMap = new Map(Object.keys(bundle.photos).map((filename) => [filename.toLowerCase(), filename]));
  for (const filename of exactCandidates) {
    const matchedFilename = lowerFilenameMap.get(filename.toLowerCase());
    if (matchedFilename) {
      const evidence = bundle.photos[matchedFilename];
      return {
        bundle,
        evidence: rffProjection ? mergeRffProjectionEvidence(evidence, rffProjection) : evidence,
        matchedFilename,
        rffProjection,
        step2Readback,
      };
    }
  }

  if (rffProjection) {
    return {
      bundle,
      evidence: evidenceFromRffProjectionItem(rffProjection),
      matchedFilename: basename(rffProjection.source_path),
      rffProjection,
      step2Readback,
    };
  }

  return { bundle, step2Readback };
};

export const getCimmichEvidenceForAsset = getCurrentCimmichEvidenceForAsset;

export const updateCimmichFace = (payload: {
  action:
    | 'add_face'
    | 'confirm_not_face'
    | 'delete_face'
    | 'mark_not_face'
    | 'reject_name_candidate'
    | 'rename'
    | 'restore_face'
    | 'retrigger'
    | 'update_box';
  bbox?: { x1: number; x2: number; y1: number; y2: number };
  faceId?: string;
  filename: string;
  image?: { height: number; width: number };
  mediaId: string;
  name?: string;
}): Promise<CimmichFaceActionResult> => {
  void payload;
  return Promise.reject(
    new Error('This retired evidence action is unavailable. Use the current Cimmich identity controls.'),
  );
};
