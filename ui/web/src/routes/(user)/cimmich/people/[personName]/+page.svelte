<script lang="ts">
  import CimmichPersonDetails from '$lib/components/cimmich/CimmichPersonDetails.svelte';
  import CimmichDocuments from '$lib/components/cimmich/CimmichDocuments.svelte';
  import CimmichObjectVisibility from '$lib/components/cimmich/CimmichObjectVisibility.svelte';
  import CimmichStatePanel from '$lib/components/cimmich/CimmichStatePanel.svelte';
  import {
    preparePersonCandidates,
    rawSimilarityLabel,
    type PersonCandidateReviewMode,
  } from '$lib/components/cimmich/person-candidate-review';
  import {
    groupPersonPhotos,
    personPhotoDateLabel,
    personPhotoGridClass,
    preparePersonPhotos,
    type PersonPhotoGroup,
    type PersonPhotoSize,
    type PersonPhotoSort,
  } from '$lib/components/cimmich/person-photo-gallery';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
  import { Route } from '$lib/route';
  import {
    addCimmichPersonAlias,
    bulkAcceptCimmichPersonCandidates,
    CimmichServiceError,
    createCimmichIdentityCorrectionCommandId,
    createCimmichPersonMergeIntentTracker,
    decideCimmichFaceModifierProposal,
    getCimmichFaceMatches,
    getCimmichContextEntity,
    getCimmichHoldingMatchesBatch,
    getCimmichIdentityFacesPage,
    getCimmichIdentityCorrectionDiscovery,
    getCimmichIdentityCorrectionHistory,
    getCimmichMergePreview,
    getCimmichPeople,
    getCimmichPersonDetailsDisplay,
    getCimmichPersonDetailsDisplayDefaults,
    getCimmichPersonAssetsPage,
    getCimmichPersonByName,
    getCimmichPersonCandidates,
    getCimmichPersonProfile,
    getCimmichPersonProfileDisplay,
    getCimmichPersonProfileDisplayDefaults,
    getCimmichPersonSetup,
    getCimmichVisibilityObject,
    mergeCimmichPeople,
    moveCimmichIdentityFace,
    rejectCimmichAcceptedIdentity,
    removeCimmichPersonAlias,
    setCimmichFaceBucket,
    setCimmichFaceModifier,
    setCimmichPersonCategory,
    setCimmichPersonSubjectKind,
    unmergeCimmichPeople,
    undoCimmichIdentityCorrection,
    type CimmichIdentityCandidate,
    type CimmichIdentityCorrectionDiscovery,
    type CimmichIdentityFace,
    type CimmichFaceMatch,
    type CimmichFaceOwnerReviewMatch,
    type CimmichMergePreview,
    type CimmichPerson,
    type CimmichPersonAsset,
    type CimmichPersonDetailsDisplay,
    type CimmichPersonDetailsDisplayDefaults,
    type CimmichPersonProfileDisplay,
    type CimmichPersonProfileDisplayDefaults,
    type CimmichPersonProfileFieldKey,
    type CimmichPersonProfileProjection,
    type CimmichPersonSetup,
    type CimmichVisibilityObject,
  } from '$lib/services/cimmich.service';
  import {
    buildCimmichPeopleIndex,
    resolveCimmichAssetsByFilename,
    updateCimmichFace,
    type CimmichEvidenceBundle,
    type CimmichFaceOverlay,
    type CimmichPackQcIndex,
    type CimmichPersonFeatureFace,
    type CimmichPersonPhoto,
    type CimmichPersonProfile,
    type CimmichResolvedAsset,
  } from '$lib/services/cimmich-evidence.service';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import {
    mdiAccount,
    mdiAccountMultipleOutline,
    mdiArrowLeft,
    mdiCalendarAlertOutline,
    mdiCalendarRange,
    mdiCheckCircleOutline,
    mdiGenderFemale,
    mdiGenderMale,
    mdiGenderMaleFemaleVariant,
    mdiGenderNonBinary,
    mdiGroup,
    mdiImageMultipleOutline,
    mdiMapMarkerOutline,
    mdiPencilOutline,
    mdiShapeOutline,
    mdiSortVariant,
    mdiTagMultipleOutline,
    mdiViewGridOutline,
  } from '@mdi/js';
  import { Icon, Tooltip } from '@immich/ui';
  import { SvelteMap, SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  type CountRow = { count: number; label: string };
  type CimmichIdentityFilter = 'all' | 'head' | 'lq' | 'needs_qc' | 'non_face' | 'prime' | 'references' | 'secondary';
  type CimmichPersonMode = 'candidates' | 'connections' | 'details' | 'documents' | 'identity' | 'photos' | 'setup';
  type CimmichMoveMode = 'existing' | 'new';
  type CimmichPersonConnection = {
    displayName: string;
    entityId: string;
    entityKind: 'event' | 'object' | 'person' | 'place';
    metaLabel: string;
    photoCount: number;
    sourceAssetId: string;
    typeKind: string;
  };
  type PhotoFilter = 'all' | 'body' | 'face' | 'needs';
  type PersonTab = 'identity' | 'maintenance' | 'photos' | 'places' | 'signals' | 'story' | 'with';
  type FaceConfirmationCandidate = {
    asset?: CimmichResolvedAsset;
    evidenceKind: 'candidate' | 'source';
    face: CimmichFaceOverlay;
    filename: string;
    id: string;
    mediaId: string;
    photo: CimmichPersonPhoto;
    proposedName: string;
  };
  type CimmichHeroField = {
    fieldKey: CimmichPersonProfileFieldKey;
    label: string;
    value: string;
  };

  let { data }: Props = $props();
  let activeTab = $state<PersonTab>('photos');
  let cimmichPhotoGroup = $state<PersonPhotoGroup>('none');
  let cimmichPhotoSize = $state<PersonPhotoSize>('medium');
  let cimmichPhotoSort = $state<PersonPhotoSort>('newest');
  let cimmichAssets = $state<CimmichPersonAsset[]>([]);
  let cimmichAssetsLoadingMore = $state(false);
  let cimmichAssetsNextCursor = $state<string | null>(null);
  let cimmichCandidateConfirm = $state(false);
  let cimmichCandidateError = $state('');
  let cimmichCandidateLoaded = $state(false);
  let cimmichCandidateLoading = $state(false);
  let cimmichCandidateMessage = $state('');
  let cimmichCandidateSaving = $state(false);
  let cimmichCandidateSelection = $state<string[]>([]);
  let cimmichCandidates = $state<CimmichIdentityCandidate[]>([]);
  let cimmichCandidateReviewMode = $state<PersonCandidateReviewMode>('useful');
  let cimmichIdentityError = $state('');
  let cimmichIdentityMessage = $state('');
  let cimmichIdentityUndoDecisionId = $state('');
  let cimmichIdentityCorrections = $state<CimmichIdentityCorrectionDiscovery['items']>([]);
  let cimmichIdentityFaces = $state<CimmichIdentityFace[]>([]);
  let cimmichHoldingMatches = $state<Record<string, CimmichFaceMatch | CimmichFaceOwnerReviewMatch | undefined>>({});
  let cimmichHoldingMatchesLoading = $state<Record<string, boolean>>({});
  let cimmichIdentityFilter = $state<CimmichIdentityFilter>('all');
  let cimmichIdentityLoaded = $state(false);
  let cimmichIdentityLoadingMore = $state(false);
  let cimmichIdentityLoading = $state(false);
  let cimmichIdentityNextCursor = $state<string | null>(null);
  let cimmichIdentityRejectConfirmId = $state('');
  let cimmichIdentityMoveBody = $state(false);
  let cimmichIdentityMoveFaceId = $state('');
  let cimmichIdentityMoveMode = $state<CimmichMoveMode>('existing');
  let cimmichIdentityMoveNewName = $state('');
  let cimmichIdentityMovePersonId = $state('');
  let cimmichIdentityMoveQuery = $state('');
  let cimmichIdentityMoveSuggestion = $state<CimmichFaceMatch | CimmichFaceOwnerReviewMatch>();
  let cimmichIdentitySavingId = $state('');
  let cimmichLoadError = $state('');
  let cimmichMode = $state<CimmichPersonMode>('photos');
  let cimmichPerson = $state<CimmichPerson>();
  let personProjectionGeneration = 0;
  let cimmichProfile = $state<CimmichPersonProfileProjection>();
  let cimmichProfileDefaults = $state<CimmichPersonProfileDisplayDefaults>();
  let cimmichProfileDisplay = $state<CimmichPersonProfileDisplay>();
  let cimmichDetailsDefaults = $state<CimmichPersonDetailsDisplayDefaults>();
  let cimmichDetailsDisplay = $state<CimmichPersonDetailsDisplay>();
  let cimmichPersonVisibility = $state<CimmichVisibilityObject>();
  let cimmichPeopleConnections = $state<CimmichPersonConnection[]>([]);
  let cimmichProfileError = $state('');
  let cimmichSetup = $state<CimmichPersonSetup>();
  let cimmichSetupAliasDraft = $state('');
  let cimmichSetupAliasKind = $state<'former_name' | 'imported' | 'nickname'>('nickname');
  let cimmichSetupError = $state('');
  let cimmichSetupLoading = $state(false);
  let cimmichSetupMergePersonId = $state('');
  let cimmichSetupMergeQuery = $state('');
  let cimmichSetupMergePreview = $state<CimmichMergePreview>();
  const cimmichSetupMergeIntents = createCimmichPersonMergeIntentTracker();
  let cimmichSetupPeople = $state<CimmichPerson[]>([]);
  let cimmichSetupSaving = $state('');
  let cimmichSetupSubjectConfirm = $state<'person' | 'pet'>();
  let loadError = $state('');
  let people = $state<CimmichPersonProfile[]>([]);
  let person = $state<CimmichPersonProfile>();
  let faceCandidateDrafts = $state<Record<string, string>>({});
  let faceCandidateError = $state('');
  let faceCandidateMessage = $state('');
  let faceCandidateSavingId = $state('');
  let packIndexes = $state<CimmichPackQcIndex[]>([]);
  let photoFilter = $state<PhotoFilter>('all');
  let resolvedAssets = $state<Record<string, CimmichResolvedAsset>>({});
  let assetResolveRun = 0;

  const photoFilters: Array<{ id: PhotoFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'face', label: 'Face' },
    { id: 'body', label: 'Body' },
    { id: 'needs', label: 'Needs check' },
  ];
  const cimmichIdentityFilters: Array<{
    id: CimmichIdentityFilter;
    label: string;
    description: string;
  }> = [
    { id: 'all', label: 'Identity observations', description: 'Faces currently accepted as this person' },
    { id: 'references', label: 'Reference set', description: 'Strong and supporting matching references' },
    { id: 'needs_qc', label: 'Needs attention', description: 'Quality flags in the loaded observations' },
  ];
  const cimmichIdentityAdvancedFilters: Array<{
    id: CimmichIdentityFilter;
    label: string;
    description: string;
  }> = [
    { id: 'prime', label: 'Strong', description: 'Best reference photos' },
    { id: 'secondary', label: 'Supporting', description: 'Useful extra angles' },
    { id: 'lq', label: 'Low quality', description: 'Kept with less weight' },
    { id: 'head', label: 'Head references', description: 'Face-derived, not manual tags' },
    { id: 'non_face', label: 'Body & Presence', description: 'Appearance evidence, not matching references' },
  ];
  const cimmichModifierOptions = ['Helmet', 'Sunglasses', 'Mask', 'Profile', 'Low light', 'Occluded'];

  const tabs: Array<{ id: PersonTab; label: string }> = [
    { id: 'photos', label: 'Photos' },
    { id: 'story', label: 'Story' },
    { id: 'identity', label: 'Identity' },
    { id: 'with', label: 'With' },
    { id: 'places', label: 'Places' },
    { id: 'signals', label: 'Signals' },
    { id: 'maintenance', label: 'Maintenance' },
  ];

  const resolveFilenames = $derived(
    [person?.featureFace?.filename, ...(person?.photos.map((photo) => photo.filename) ?? [])].filter(
      (filename): filename is string => typeof filename === 'string',
    ),
  );
  const visibleCimmichAssets = $derived(preparePersonPhotos(cimmichAssets, 'all', cimmichPhotoSort));
  const cimmichPersonConnections = $derived.by(() => {
    const connections = new SvelteMap<string, CimmichPersonConnection & { assetIds: Set<string> }>();
    for (const asset of cimmichAssets) {
      for (const context of asset.contexts) {
        const existing = connections.get(context.entityId);
        if (existing) {
          existing.assetIds.add(asset.asset_id);
          existing.photoCount = existing.assetIds.size;
          continue;
        }
        connections.set(context.entityId, {
          assetIds: new Set([asset.asset_id]),
          displayName: context.displayName,
          entityId: context.entityId,
          entityKind: context.entityKind,
          metaLabel: '',
          photoCount: 1,
          sourceAssetId: asset.sourceAssetId,
          typeKind: context.typeKind,
        });
      }
    }
    return [...connections.values()].sort(
      (left, right) =>
        left.entityKind.localeCompare(right.entityKind) || left.displayName.localeCompare(right.displayName),
    );
  });
  const cimmichPersonConnectionGroups = $derived(
    [
      { id: 'person', label: 'People' },
      { id: 'event', label: 'Events' },
      { id: 'place', label: 'Places' },
      { id: 'object', label: 'Things' },
    ]
      .map((group) => ({
        ...group,
        items: [...cimmichPeopleConnections, ...cimmichPersonConnections].filter(
          (connection) => connection.entityKind === group.id,
        ),
      }))
      .filter((group) => group.items.length > 0),
  );
  const cimmichPersonConnectionHref = ({ entityId, entityKind }: CimmichPersonConnection) => {
    if (entityKind === 'person') {
      const person = cimmichSetupPeople.find((row) => row.person_id === entityId);
      return person
        ? Route.cimmichPerson({ name: person.display_name, personId: person.person_id })
        : Route.cimmichPeople();
    }
    const search = new SvelteURLSearchParams({ entityId });
    if (entityKind === 'object') {
      search.set('family', 'objects');
      return `${Route.cimmichPlaces()}?${search.toString()}`;
    }
    return `${entityKind === 'event' ? Route.cimmichEvents() : Route.cimmichPlaces()}?${search.toString()}`;
  };
  const loadCimmichPeopleConnections = async (
    personId: string,
    assets: CimmichPersonAsset[],
    people: CimmichPerson[],
  ) => {
    const contexts = [
      ...new SvelteMap(
        assets.flatMap((asset) => asset.contexts).map((context) => [context.entityId, context]),
      ).values(),
    ];
    const details = await Promise.all(
      contexts.map((context) =>
        getCimmichContextEntity(
          context.entityKind === 'event' ? 'events' : context.entityKind === 'object' ? 'objects' : 'places',
          context.entityId,
        ).catch(() => null),
      ),
    );
    const linked = new SvelteMap<string, CimmichPersonConnection & { contextIds: Set<string> }>();
    for (const detail of details) {
      if (!detail) {
        continue;
      }
      for (const relation of detail.relations) {
        if (relation.targetKind !== 'person' || relation.targetId === personId) {
          continue;
        }
        const person = people.find((row) => row.person_id === relation.targetId);
        if (!person?.sourceAssetId) {
          continue;
        }
        const existing = linked.get(person.person_id);
        if (existing) {
          existing.contextIds.add(detail.entity.entityId);
          existing.photoCount = existing.contextIds.size;
          continue;
        }
        linked.set(person.person_id, {
          contextIds: new Set([detail.entity.entityId]),
          displayName: person.display_name,
          entityId: person.person_id,
          entityKind: 'person',
          metaLabel:
            person.categories
              .filter((category) => category.category_kind === 'relationship')
              .sort((left, right) => left.sort_order - right.sort_order)
              .map((category) => category.name)
              .join(' · ') || 'Connected person',
          photoCount: 1,
          sourceAssetId: person.sourceAssetId,
          typeKind: relation.relationKind,
        });
      }
    }
    return [...linked.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
  };
  const visibleCimmichCandidates = $derived(preparePersonCandidates(cimmichCandidates, cimmichCandidateReviewMode));
  const groupedCimmichAssets = $derived(groupPersonPhotos(visibleCimmichAssets, cimmichPhotoGroup));
  const cimmichMergeOptions = $derived(
    cimmichSetupPeople.filter(
      (row) => row.person_id !== cimmichPerson?.person_id && row.subject_kind === cimmichPerson?.subject_kind,
    ),
  );
  const filteredCimmichMergeOptions = $derived.by(() => {
    const query = cimmichSetupMergeQuery.trim().toLocaleLowerCase();
    if (!query) {
      return [];
    }
    return cimmichMergeOptions
      .filter((row) => [row.display_name, ...row.aliases].join(' ').toLocaleLowerCase().includes(query))
      .slice(0, 12);
  });
  const selectedCimmichMerge = $derived(
    cimmichMergeOptions.find((option) => option.person_id === cimmichSetupMergePersonId),
  );
  const cimmichMoveOptions = $derived(
    cimmichSetupPeople.filter(
      (row) =>
        row.person_id !== cimmichPerson?.person_id &&
        row.subject_kind === 'person' &&
        (!cimmichPerson?.needs_holding || !row.needs_holding),
    ),
  );
  const filteredCimmichMoveOptions = $derived.by(() => {
    const query = cimmichIdentityMoveQuery.trim().toLocaleLowerCase();
    if (!query) {
      return [];
    }
    return cimmichMoveOptions
      .filter((row) => [row.display_name, ...row.aliases].join(' ').toLocaleLowerCase().includes(query))
      .slice(0, 8);
  });
  const cimmichMainBucket = (face: CimmichIdentityFace) =>
    face.main_evidence_tier === 'face_only' ? null : face.main_evidence_tier;
  const cimmichBodyPresenceAssets = $derived(
    cimmichAssets.filter(
      ({ association_types }) => association_types.includes('body') || association_types.includes('presence'),
    ),
  );
  const visibleCimmichIdentityFaces = $derived.by(() => {
    if (cimmichIdentityFilter === 'references') {
      return cimmichIdentityFaces.filter((face) => {
        const bucket = cimmichMainBucket(face);
        return bucket === 'prime' || bucket === 'secondary';
      });
    }
    if (
      cimmichIdentityFilter === 'prime' ||
      cimmichIdentityFilter === 'secondary' ||
      cimmichIdentityFilter === 'lq' ||
      cimmichIdentityFilter === 'head'
    ) {
      return cimmichIdentityFaces.filter((face) => cimmichMainBucket(face) === cimmichIdentityFilter);
    }
    if (cimmichIdentityFilter === 'non_face') {
      return [];
    }
    if (cimmichIdentityFilter === 'needs_qc') {
      return cimmichIdentityFaces.filter((face) => cimmichMainBucket(face) === 'head' || face.qc_flags.length > 0);
    }
    return cimmichIdentityFaces;
  });
  const renderedCimmichIdentityFaces = $derived(visibleCimmichIdentityFaces);
  const cimmichIdentityBucketCount = (filter: CimmichIdentityFilter) => {
    if (filter === 'all') {
      return cimmichIdentityFaces.length;
    }
    if (filter === 'needs_qc') {
      return cimmichIdentityFaces.filter((face) => cimmichMainBucket(face) === 'head' || face.qc_flags.length > 0)
        .length;
    }
    if (filter === 'non_face') {
      return cimmichBodyPresenceAssets.length;
    }
    if (filter === 'references') {
      return cimmichIdentityFaces.filter((face) => {
        const bucket = cimmichMainBucket(face);
        return bucket === 'prime' || bucket === 'secondary';
      }).length;
    }
    return cimmichIdentityFaces.filter((face) => cimmichMainBucket(face) === filter).length;
  };
  const cimmichIdentityBucketLabel = (face: CimmichIdentityFace) => {
    const bucket = cimmichMainBucket(face);
    if (bucket === 'prime') {
      return 'Strong reference';
    }
    if (bucket === 'secondary') {
      return 'Supporting reference';
    }
    if (bucket === 'lq') {
      return 'Low quality';
    }
    if (bucket === 'head') {
      return 'Head reference';
    }
    return 'Not used for matching';
  };

  const visibleCimmichAliases = $derived(
    cimmichPerson?.aliases.filter(
      (alias) => alias.trim().toLocaleLowerCase() !== cimmichPerson?.display_name.trim().toLocaleLowerCase(),
    ) ?? [],
  );
  const cimmichRelationshipLabels = $derived(
    cimmichPerson?.categories.filter((category) => category.category_kind === 'relationship').map(({ name }) => name) ??
      [],
  );
  const cimmichPhotoDates = $derived.by(() =>
    cimmichAssets
      .flatMap(({ capture_time }) => {
        if (!capture_time) {
          return [];
        }
        const date = new Date(capture_time);
        return Number.isNaN(date.getTime()) ? [] : [date];
      })
      .sort((left, right) => left.getTime() - right.getTime()),
  );
  const cimmichFuturePhotoDateCount = $derived(
    cimmichPerson?.photo_history?.futureCaptureDateCount ??
      cimmichPhotoDates.filter((date) => date.getTime() > Date.now()).length,
  );
  const cimmichPhotoTimeframe = $derived.by(() => {
    const now = Date.now();
    const aggregate = cimmichPerson?.photo_history;
    const dates = aggregate
      ? [aggregate.minCaptureTime, aggregate.maxCaptureTime]
          .flatMap((captureTime) => {
            if (!captureTime) {
              return [];
            }
            const date = new Date(captureTime);
            return Number.isNaN(date.getTime()) ? [] : [date];
          })
          .sort((left, right) => left.getTime() - right.getTime())
      : cimmichPhotoDates.filter((date) => date.getTime() <= now);
    const first = dates[0];
    const last = dates.at(-1);
    if (!first || !last) {
      return cimmichFuturePhotoDateCount > 0 ? 'Dates need review' : 'Date unavailable';
    }
    const fullDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    if (first.toDateString() === last.toDateString()) {
      return fullDate.format(first);
    }
    if (first.getFullYear() === last.getFullYear()) {
      const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
      return `${shortDate.format(first)}–${fullDate.format(last)}`;
    }
    return `${first.getFullYear()}–${last.getFullYear()}`;
  });
  const cimmichPhotoTimeframeLabel = $derived(
    cimmichPerson?.photo_history || !cimmichAssetsNextCursor ? 'Photo history' : 'Loaded date range',
  );
  const cimmichGenderLabel = $derived(
    cimmichProfile?.profile.genderIdentityKind === 'self_described'
      ? cimmichProfile.profile.genderIdentityLabel
      : cimmichProfile?.profile.genderIdentityKind === 'non_binary'
        ? 'Non-binary'
        : cimmichProfile?.profile.genderIdentityKind === 'woman'
          ? 'Woman'
          : cimmichProfile?.profile.genderIdentityKind === 'man'
            ? 'Man'
            : null,
  );
  const cimmichGenderIcon = $derived(
    cimmichProfile?.profile.genderIdentityKind === 'woman'
      ? mdiGenderFemale
      : cimmichProfile?.profile.genderIdentityKind === 'man'
        ? mdiGenderMale
        : cimmichProfile?.profile.genderIdentityKind === 'non_binary'
          ? mdiGenderNonBinary
          : cimmichProfile?.profile.genderIdentityKind === 'self_described'
            ? mdiGenderMaleFemaleVariant
            : null,
  );
  const cimmichHeroFields = $derived.by(() => {
    if (!cimmichProfile || !cimmichProfileDisplay) {
      return [];
    }
    const importantDates = cimmichProfile.items.filter(({ kind }) => kind === 'important_date');
    const work = cimmichProfile.items.filter(({ kind }) => kind === 'work');
    const values: Record<CimmichPersonProfileFieldKey, string> = {
      about: cimmichProfile.profile.about ?? '',
      aliases: visibleCimmichAliases.join(', '),
      gender_identity: cimmichGenderLabel ?? '',
      important_dates: importantDates
        .map((item) => {
          const date = new Intl.DateTimeFormat(undefined, {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
            year: 'numeric',
          }).format(new Date(`${item.dateValue}T00:00:00Z`));
          return `${item.label}: ${date}`;
        })
        .join(' · '),
      photo_history: cimmichPhotoTimeframe,
      pronouns: cimmichProfile.profile.pronounsLabel ?? '',
      relationships: cimmichProfile.relationships.map(({ name }) => name).join(', '),
      work: work
        .map((item) => [item.value, item.secondaryValue].filter(Boolean).join(' · '))
        .filter(Boolean)
        .join(' · '),
    };
    const labels: Record<CimmichPersonProfileFieldKey, string> = {
      about: 'About',
      aliases: 'Also known as',
      gender_identity: 'Gender identity',
      important_dates: 'Important dates',
      photo_history: cimmichPhotoTimeframeLabel,
      pronouns: 'Pronouns',
      relationships: 'Relationship',
      work: 'Work',
    };
    return cimmichProfileDisplay.fields
      .filter(({ effectiveVisible, fieldKey }) => effectiveVisible && values[fieldKey])
      .sort((left, right) => left.order - right.order)
      .map<CimmichHeroField>(({ fieldKey }) => ({ fieldKey, label: labels[fieldKey], value: values[fieldKey] }));
  });

  const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

  const cimmichQcLabel = (face: CimmichIdentityFace, flag: CimmichIdentityFace['qc_flags'][number]) => {
    if (flag === 'tiny_face') {
      return `${Math.min(face.face_pixel_width, face.face_pixel_height)}px`;
    }
    if (flag === 'low_detection_confidence') {
      return 'Low confidence';
    }
    if (flag === 'low_quality') {
      return 'Low quality';
    }
    if (flag === 'nearby_face') {
      return face.nearby_face_count > 1 ? `${face.nearby_face_count} nearby faces` : 'Nearby face';
    }
    return `Imported #${face.source_instance_suffix}`;
  };

  const countRows = (counts: Record<string, number>, limit = 8): CountRow[] =>
    Object.entries(counts)
      .map(([label, count]) => ({ count, label }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit);

  const bucketLabel = (bucket: string) =>
    bucket
      .replace(/^face_/, '')
      .replace(/^reject_/, '')
      .replaceAll('_', ' ');
  const normalizeName = (value: string | undefined) => (value ?? '').trim().replaceAll(/\s+/g, ' ');
  const sameName = (left: string | undefined, right: string | undefined) =>
    normalizeName(left).toLowerCase() === normalizeName(right).toLowerCase();
  const nameInList = (names: string[] | undefined, name: string | undefined) =>
    (names ?? []).some((row) => sameName(row, name));

  const personNamesForPhoto = (photo: CimmichPersonPhoto) => {
    const names = new SvelteSet<string>();
    for (const name of photo.evidence.summary?.sourcePeople ?? []) {
      names.add(name);
    }
    for (const name of photo.evidence.summary?.candidatePeople ?? []) {
      names.add(name);
    }
    for (const face of photo.evidence.faceOverlays ?? []) {
      if (face.status === 'named') {
        names.add(face.name);
      }
    }
    for (const body of photo.evidence.bodyOverlays ?? []) {
      if (body.status === 'linked') {
        names.add(body.linkedName);
      }
    }
    return [...names].filter((name) => name && name !== person?.name);
  };

  const unresolvedFaceCount = (photo: CimmichPersonPhoto) =>
    photo.evidence.faceOverlays?.filter((face) => face.status === 'sidecar_only' || face.status === 'untagged')
      .length ?? 0;

  const photoEvidenceLabels = (photo: CimmichPersonPhoto) => {
    const labels: string[] = [];
    const isSource = photo.evidence.summary?.sourcePeople?.includes(person?.name ?? '');
    const isCandidate = photo.evidence.summary?.candidatePeople?.includes(person?.name ?? '');
    const bodyObservationCount = photo.evidence.bodyOverlays?.length ?? 0;
    if (photo.faceOverlays.length > 0) {
      labels.push(`${photo.faceOverlays.length} face`);
    }
    if (photo.bodyLinks.length > 0) {
      labels.push(`${photo.bodyLinks.length} body`);
    } else if (bodyObservationCount > 0) {
      labels.push(`${bodyObservationCount} body obs`);
    }
    if (isSource) {
      labels.push('source');
    } else if (isCandidate) {
      labels.push('candidate');
    }
    if (photo.qcStatus && photo.qcStatus !== 'ready_for_cimmich') {
      labels.push(photo.qcStatus.replaceAll('_', ' '));
    }
    const unresolved = unresolvedFaceCount(photo);
    if (unresolved > 0) {
      labels.push(`${unresolved} unresolved`);
    }
    return labels;
  };

  const filteredPhotos = $derived.by(() => {
    const photos = person?.photos ?? [];
    if (photoFilter === 'face') {
      return photos.filter((photo) => photo.faceOverlays.length > 0);
    }
    if (photoFilter === 'body') {
      return photos.filter((photo) => photo.bodyLinks.length > 0 || (photo.evidence.bodyOverlays?.length ?? 0) > 0);
    }
    if (photoFilter === 'needs') {
      return photos.filter((photo) => unresolvedFaceCount(photo) > 0 || photo.faceOverlays.length === 0);
    }
    return photos;
  });

  const years = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const photo of person?.photos ?? []) {
      const rawDate = photo.evidence.summary?.exifDate || '';
      const year = rawDate.match(/\d{4}/)?.[0] || 'Unknown';
      counts[year] = (counts[year] ?? 0) + 1;
    }
    return countRows(counts, 8);
  });

  const peopleWith = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const photo of person?.photos ?? []) {
      for (const name of personNamesForPhoto(photo)) {
        counts[name] = (counts[name] ?? 0) + 1;
      }
    }
    return countRows(counts, 18);
  });

  const topPlace = $derived(countRows(person?.knownPlaces ?? {}, 1)[0]?.label ?? 'Place pending');
  const topEvent = $derived(countRows(person?.eventCounts ?? {}, 1)[0]?.label ?? 'Event pending');
  const topSignal = $derived(
    [...countRows(person?.knownObjects ?? {}, 1), ...countRows(person?.knownActions ?? {}, 1)][0]?.label ??
      'Signals pending',
  );
  const archiveProvenanceRows = $derived(countRows(person?.packCounts ?? {}, 4));
  const featureAsset = $derived(person?.featureFace ? resolvedAssets[person.featureFace.filename] : undefined);
  const needsCheckCount = $derived(
    person?.photos.filter((photo) => unresolvedFaceCount(photo) > 0 || photo.faceOverlays.length === 0).length ?? 0,
  );
  const signalRows = $derived([
    ...countRows(person?.knownObjects ?? {}, 8),
    ...countRows(person?.knownActions ?? {}, 16),
  ]);
  const rejectedFaceCandidate = (photo: CimmichPersonPhoto, faceId: string, name: string) =>
    (photo.evidence.faceEditLog ?? []).some(
      (event) => event.action === 'reject_name_candidate' && event.faceId === faceId && sameName(event.name, name),
    );

  const faceConfirmationCandidates = $derived.by<FaceConfirmationCandidate[]>(() => {
    if (!person) {
      return [];
    }

    const candidates: FaceConfirmationCandidate[] = [];
    for (const photo of person.photos) {
      const proposedName = person.name;
      const isSourceTagged = nameInList(photo.evidence.summary?.sourcePeople, proposedName);
      const isCandidateTagged =
        nameInList(photo.evidence.summary?.candidatePeople, proposedName) ||
        nameInList(photo.evidence.summary?.strongCandidatePeople, proposedName);
      if (!isCandidateTagged) {
        continue;
      }

      const alreadyNamed = (photo.evidence.faceOverlays ?? []).some(
        (face) => face.status === 'named' && sameName(face.name, proposedName),
      );
      if (alreadyNamed) {
        continue;
      }

      const openFaces = (photo.evidence.faceOverlays ?? [])
        .filter((face) => face.status === 'untagged' || face.status === 'sidecar_only')
        .sort((a, b) => a.bbox.x1 - b.bbox.x1 || a.bbox.y1 - b.bbox.y1);

      for (const face of openFaces) {
        if (rejectedFaceCandidate(photo, face.id, proposedName)) {
          continue;
        }
        candidates.push({
          asset: resolvedAssets[photo.filename],
          evidenceKind: isSourceTagged ? 'source' : 'candidate',
          face,
          filename: photo.filename,
          id: `${photo.filename}:${face.id}:${proposedName}`,
          mediaId: photo.mediaId,
          photo,
          proposedName,
        });
      }
    }

    return candidates;
  });

  const faceCropStyle = (
    asset: CimmichResolvedAsset | undefined,
    featureFace: CimmichPersonFeatureFace | undefined,
  ) => {
    if (!asset) {
      return featureFace?.cropUrl
        ? `background-image: url("${featureFace.cropUrl}"); background-size: cover; background-position: center;`
        : '';
    }
    if (!featureFace?.image) {
      return `background-image: url("${asset.thumbnailUrl}"); background-size: cover; background-position: center;`;
    }

    const imageWidth = featureFace.image.width || 1;
    const imageHeight = featureFace.image.height || 1;
    const boxWidth = Math.max(1, featureFace.bbox.x2 - featureFace.bbox.x1);
    const boxHeight = Math.max(1, featureFace.bbox.y2 - featureFace.bbox.y1);
    const sizeX = (imageWidth / boxWidth) * 100;
    const sizeY = (imageHeight / boxHeight) * 100;
    const positionX = clampPercent((featureFace.bbox.x1 / Math.max(1, imageWidth - boxWidth)) * 100);
    const positionY = clampPercent((featureFace.bbox.y1 / Math.max(1, imageHeight - boxHeight)) * 100);

    return [
      `background-image: url("${asset.previewUrl}")`,
      `background-size: ${sizeX}% ${sizeY}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const faceOverlayCropStyle = (asset: CimmichResolvedAsset | undefined, face: CimmichFaceOverlay | undefined) => {
    if (!asset) {
      return '';
    }
    if (!face?.image) {
      return `background-image: url("${asset.thumbnailUrl}"); background-size: cover; background-position: center;`;
    }

    const imageWidth = face.image.width || 1;
    const imageHeight = face.image.height || 1;
    const boxWidth = Math.max(1, face.bbox.x2 - face.bbox.x1);
    const boxHeight = Math.max(1, face.bbox.y2 - face.bbox.y1);
    const sizeX = (imageWidth / boxWidth) * 100;
    const sizeY = (imageHeight / boxHeight) * 100;
    const positionX = clampPercent((face.bbox.x1 / Math.max(1, imageWidth - boxWidth)) * 100);
    const positionY = clampPercent((face.bbox.y1 / Math.max(1, imageHeight - boxHeight)) * 100);

    return [
      `background-image: url("${asset.previewUrl}")`,
      `background-size: ${sizeX}% ${sizeY}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const cimmichPersonCropStyle = (row: CimmichPerson) => {
    if (!row.sourceAssetId || row.box_x === null || row.box_y === null || row.box_w === null || row.box_h === null) {
      return '';
    }
    const cropSize = Math.min(1, Math.max(row.box_w * 1.15, row.box_h * 1.15, 0.01));
    const centerX = row.box_x + row.box_w / 2;
    const centerY = row.box_y + row.box_h / 2;
    const cropX = Math.max(0, Math.min(1 - cropSize, centerX - cropSize / 2));
    const cropY = Math.max(0, Math.min(1 - cropSize, centerY - cropSize / 2));
    const positionX = clampPercent((cropX / Math.max(0.0001, 1 - cropSize)) * 100);
    const positionY = clampPercent((cropY / Math.max(0.0001, 1 - cropSize)) * 100);
    return [
      `background-image: url("${getAssetMediaUrl({ id: row.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      `background-size: ${100 / cropSize}% ${100 / cropSize}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const cimmichPersonHeroStyle = (row: CimmichPerson) => {
    if (!row.sourceAssetId) {
      return '';
    }
    const centerX = row.box_x === null || row.box_w === null ? 50 : clampPercent((row.box_x + row.box_w / 2) * 100);
    const centerY = row.box_y === null || row.box_h === null ? 42 : clampPercent((row.box_y + row.box_h / 2) * 100);
    return [
      `background-image: url("${getAssetMediaUrl({ id: row.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      'background-size: cover',
      `background-position: ${centerX}% ${centerY}%`,
    ].join('; ');
  };

  const cimmichObservationCropStyle = (face: CimmichIdentityFace, kind: 'body' | 'face') => {
    if (!face.sourceAssetId) {
      return '';
    }
    const boxX = kind === 'body' ? face.body_box_x : face.box_x;
    const boxY = kind === 'body' ? face.body_box_y : face.box_y;
    const boxW = kind === 'body' ? face.body_box_w : face.box_w;
    const boxH = kind === 'body' ? face.body_box_h : face.box_h;
    if (boxX === null || boxY === null || boxW === null || boxH === null) {
      return '';
    }
    const padding = kind === 'face' ? 2.4 : 1.12;
    const cropW = Math.min(1, Math.max(boxW * padding, 0.01));
    const cropH = Math.min(1, Math.max(boxH * padding, 0.01));
    const centerX = boxX + boxW / 2;
    const centerY = boxY + boxH / 2;
    const cropX = Math.max(0, Math.min(1 - cropW, centerX - cropW / 2));
    const cropY = Math.max(0, Math.min(1 - cropH, centerY - cropH / 2));
    const positionX = clampPercent((cropX / Math.max(0.0001, 1 - cropW)) * 100);
    const positionY = clampPercent((cropY / Math.max(0.0001, 1 - cropH)) * 100);
    return [
      `background-image: url("${getAssetMediaUrl({ id: face.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      `background-size: ${100 / cropW}% ${100 / cropH}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const cimmichCandidateCropStyle = (candidate: CimmichIdentityCandidate) => {
    if (!candidate.sourceAssetId) {
      return '';
    }
    const cropW = Math.min(1, Math.max(candidate.box_w * 2.4, 0.01));
    const cropH = Math.min(1, Math.max(candidate.box_h * 2.4, 0.01));
    const centerX = candidate.box_x + candidate.box_w / 2;
    const centerY = candidate.box_y + candidate.box_h / 2;
    const cropX = Math.max(0, Math.min(1 - cropW, centerX - cropW / 2));
    const cropY = Math.max(0, Math.min(1 - cropH, centerY - cropH / 2));
    const positionX = clampPercent((cropX / Math.max(0.0001, 1 - cropW)) * 100);
    const positionY = clampPercent((cropY / Math.max(0.0001, 1 - cropH)) * 100);
    return [
      `background-image: url("${getAssetMediaUrl({ id: candidate.sourceAssetId, size: AssetMediaSize.Preview })}")`,
      `background-size: ${100 / cropW}% ${100 / cropH}%`,
      `background-position: ${positionX}% ${positionY}%`,
    ].join('; ');
  };

  const candidateSelected = (claimId: string) => cimmichCandidateSelection.includes(claimId);

  const toggleCandidate = (claimId: string) => {
    cimmichCandidateSelection = candidateSelected(claimId)
      ? cimmichCandidateSelection.filter((id) => id !== claimId)
      : [...cimmichCandidateSelection, claimId];
    cimmichCandidateConfirm = false;
  };

  const selectAllCandidates = () => {
    cimmichCandidateSelection = visibleCimmichCandidates.map((candidate) => candidate.identity_claim_id);
    cimmichCandidateConfirm = false;
  };

  const resetCimmichAssetsPagination = async (personId: string, generation = personProjectionGeneration) => {
    const page = await getCimmichPersonAssetsPage(personId, 120);
    if (generation !== personProjectionGeneration) {
      return;
    }
    cimmichAssets = page.items;
    cimmichAssetsNextCursor = page.nextCursor;
  };

  const loadMoreCimmichAssets = async () => {
    if (!cimmichPerson || !cimmichAssetsNextCursor || cimmichAssetsLoadingMore) {
      return;
    }
    const personId = cimmichPerson.person_id;
    const generation = personProjectionGeneration;
    const cursor = cimmichAssetsNextCursor;
    cimmichAssetsLoadingMore = true;
    cimmichLoadError = '';
    try {
      const page = await getCimmichPersonAssetsPage(personId, 120, cursor);
      if (generation !== personProjectionGeneration) {
        return;
      }
      const seen = new Set(cimmichAssets.map(({ asset_id }) => asset_id));
      cimmichAssets = [...cimmichAssets, ...page.items.filter(({ asset_id }) => !seen.has(asset_id))];
      cimmichAssetsNextCursor = page.nextCursor;
    } catch (error) {
      if (error instanceof CimmichServiceError && error.code === 'PERSON_PAGE_CURSOR_INVALID') {
        await resetCimmichAssetsPagination(personId);
        cimmichLoadError = 'Viewing mode changed. Photos restarted from the first page.';
      } else {
        cimmichLoadError = error instanceof Error ? error.message : 'Unable to load more photos';
      }
    } finally {
      cimmichAssetsLoadingMore = false;
    }
  };

  const resetCimmichIdentityPagination = async (personId: string, generation = personProjectionGeneration) => {
    const page = await getCimmichIdentityFacesPage(personId, 24);
    if (generation !== personProjectionGeneration) {
      return;
    }
    cimmichIdentityFaces = page.items;
    cimmichIdentityNextCursor = page.nextCursor;
    cimmichIdentityLoaded = true;
  };

  const loadMoreCimmichIdentity = async () => {
    if (!cimmichPerson || !cimmichIdentityNextCursor || cimmichIdentityLoadingMore) {
      return;
    }
    const personId = cimmichPerson.person_id;
    const generation = personProjectionGeneration;
    const cursor = cimmichIdentityNextCursor;
    cimmichIdentityLoadingMore = true;
    cimmichIdentityError = '';
    try {
      const page = await getCimmichIdentityFacesPage(personId, 24, cursor);
      if (generation !== personProjectionGeneration) {
        return;
      }
      const seen = new Set(cimmichIdentityFaces.map(({ face_id }) => face_id));
      const appended = page.items.filter(({ face_id }) => !seen.has(face_id));
      cimmichIdentityFaces = [...cimmichIdentityFaces, ...appended];
      cimmichIdentityNextCursor = page.nextCursor;
      if (cimmichPerson.needs_holding) {
        void loadCimmichHoldingMatches(appended);
      }
    } catch (error) {
      if (error instanceof CimmichServiceError && error.code === 'PERSON_PAGE_CURSOR_INVALID') {
        await resetCimmichIdentityPagination(personId);
        cimmichIdentityError = 'Viewing mode changed. Review restarted from the first page.';
      } else {
        cimmichIdentityError = error instanceof Error ? error.message : 'Unable to load more identity photos';
      }
    } finally {
      cimmichIdentityLoadingMore = false;
    }
  };

  const openCimmichCandidates = async () => {
    cimmichMode = 'candidates';
    if (!cimmichPerson || cimmichCandidateLoaded || cimmichCandidateLoading) {
      return;
    }
    cimmichCandidateLoading = true;
    cimmichCandidateError = '';
    try {
      cimmichCandidates = await getCimmichPersonCandidates(cimmichPerson.person_id);
      cimmichCandidateLoaded = true;
    } catch (error) {
      cimmichCandidateError = error instanceof Error ? error.message : 'Unable to load candidates';
    } finally {
      cimmichCandidateLoading = false;
    }
  };

  const acceptSelectedCandidates = async () => {
    if (!cimmichPerson || cimmichCandidateSelection.length === 0) {
      return;
    }
    if (!cimmichCandidateConfirm) {
      cimmichCandidateConfirm = true;
      return;
    }
    const personId = cimmichPerson.person_id;
    cimmichCandidateSaving = true;
    cimmichCandidateError = '';
    cimmichCandidateMessage = '';
    try {
      const result = await bulkAcceptCimmichPersonCandidates(personId, cimmichCandidateSelection);
      cimmichCandidateMessage = `${result.acceptedCount} ${result.acceptedCount === 1 ? 'face' : 'faces'} accepted.`;
      cimmichCandidateSelection = [];
      cimmichCandidateConfirm = false;
      const [candidates, assetsPage, people] = await Promise.all([
        getCimmichPersonCandidates(personId),
        getCimmichPersonAssetsPage(personId, 120),
        getCimmichPeople(500),
      ]);
      cimmichCandidates = candidates;
      cimmichAssets = assetsPage.items;
      cimmichAssetsNextCursor = assetsPage.nextCursor;
      cimmichCandidateLoaded = true;
      cimmichIdentityLoaded = false;
      cimmichIdentityFaces = [];
      cimmichIdentityNextCursor = null;
      cimmichHoldingMatches = {};
      cimmichHoldingMatchesLoading = {};
      const refreshed = people.find((row) => row.person_id === personId);
      if (refreshed) {
        cimmichPerson = refreshed;
      }
    } catch (error) {
      cimmichCandidateConfirm = false;
      cimmichCandidateError = error instanceof Error ? error.message : 'Unable to accept candidates';
    } finally {
      cimmichCandidateSaving = false;
    }
  };

  const refreshCimmichIdentity = async () => {
    if (!cimmichPerson) {
      return;
    }
    const generation = personProjectionGeneration;
    const [page, row, corrections] = await Promise.all([
      getCimmichIdentityFacesPage(cimmichPerson.person_id, 24),
      getCimmichPersonByName(data.personName, data.personId),
      getCimmichIdentityCorrectionDiscovery({ personId: cimmichPerson.person_id }, { limit: 12 }),
    ]);
    if (generation !== personProjectionGeneration) {
      return;
    }
    cimmichIdentityFaces = page.items;
    cimmichIdentityNextCursor = page.nextCursor;
    cimmichIdentityLoaded = true;
    cimmichIdentityCorrections = corrections.items;
    cimmichIdentityUndoDecisionId = corrections.items.find((item) => item.undo.eligible)?.undo.decisionId ?? '';
    if (row) {
      cimmichPerson = row;
    }
    cimmichHoldingMatches = {};
    cimmichHoldingMatchesLoading = {};
    if (row?.needs_holding) {
      void loadCimmichHoldingMatches(page.items);
    }
  };

  const loadCimmichHoldingMatch = async (face: CimmichIdentityFace) => {
    const generation = personProjectionGeneration;
    if (cimmichHoldingMatchesLoading[face.face_id]) {
      return;
    }
    cimmichHoldingMatchesLoading = { ...cimmichHoldingMatchesLoading, [face.face_id]: true };
    try {
      const [match] = await getCimmichFaceMatches(face.face_id, 1);
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichHoldingMatches = { ...cimmichHoldingMatches, [face.face_id]: match };
    } catch {
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichHoldingMatches = { ...cimmichHoldingMatches, [face.face_id]: undefined };
    } finally {
      if (generation === personProjectionGeneration) {
        cimmichHoldingMatchesLoading = { ...cimmichHoldingMatchesLoading, [face.face_id]: false };
      }
    }
  };

  const loadCimmichHoldingMatches = async (faces: CimmichIdentityFace[]) => {
    const generation = personProjectionGeneration;
    if (!cimmichPerson) {
      return;
    }
    const faceIds = [...new Set(faces.map(({ face_id }) => face_id))].slice(0, 24);
    if (faceIds.length === 0) {
      return;
    }
    cimmichHoldingMatchesLoading = {
      ...cimmichHoldingMatchesLoading,
      ...Object.fromEntries(faceIds.map((faceId) => [faceId, true])),
    };
    try {
      const result = await getCimmichHoldingMatchesBatch(cimmichPerson.person_id, faceIds);
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichHoldingMatches = {
        ...cimmichHoldingMatches,
        ...Object.fromEntries(result.items.map(({ faceId, matches }) => [faceId, matches[0]])),
      };
    } catch {
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichHoldingMatches = {
        ...cimmichHoldingMatches,
        ...Object.fromEntries(faceIds.map((faceId) => [faceId, undefined])),
      };
    } finally {
      if (generation === personProjectionGeneration) {
        cimmichHoldingMatchesLoading = {
          ...cimmichHoldingMatchesLoading,
          ...Object.fromEntries(faceIds.map((faceId) => [faceId, false])),
        };
      }
    }
  };

  const openCimmichIdentity = async (generation = personProjectionGeneration) => {
    cimmichMode = 'identity';
    if (!cimmichPerson || cimmichIdentityLoaded || cimmichIdentityLoading) {
      return;
    }
    cimmichIdentityLoading = true;
    cimmichIdentityError = '';
    try {
      await resetCimmichIdentityPagination(cimmichPerson.person_id, generation);
      if (generation !== personProjectionGeneration) {
        return;
      }
      if (cimmichPerson.needs_holding) {
        cimmichHoldingMatches = {};
        void loadCimmichHoldingMatches(cimmichIdentityFaces);
      }
    } catch (error) {
      if (generation === personProjectionGeneration) {
        cimmichIdentityError = error instanceof Error ? error.message : 'Unable to load identity photos';
      }
    } finally {
      if (generation === personProjectionGeneration) {
        cimmichIdentityLoading = false;
      }
    }
  };

  const refreshCimmichSetup = async () => {
    if (!cimmichPerson) {
      return;
    }
    const personId = cimmichPerson.person_id;
    const [setup, people, assetsPage] = await Promise.all([
      getCimmichPersonSetup(personId),
      getCimmichPeople(500),
      getCimmichPersonAssetsPage(personId, 120),
    ]);
    cimmichSetup = setup;
    cimmichSetupPeople = people;
    cimmichAssets = assetsPage.items;
    cimmichAssetsNextCursor = assetsPage.nextCursor;
    cimmichIdentityLoaded = false;
    cimmichIdentityLoading = false;
    cimmichIdentityLoadingMore = false;
    cimmichIdentityFaces = [];
    cimmichIdentityNextCursor = null;
    cimmichHoldingMatches = {};
    cimmichHoldingMatchesLoading = {};
    if (cimmichPerson.subject_kind === 'person') {
      cimmichProfile = await getCimmichPersonProfile(personId);
    }
    const refreshed = people.find((row) => row.person_id === personId);
    if (refreshed) {
      cimmichPerson = refreshed;
    }
  };

  const openCimmichSetup = async () => {
    cimmichMode = 'setup';
    cimmichSetupError = '';
    cimmichSetupMergePersonId = '';
    cimmichSetupMergeQuery = '';
    cimmichSetupMergePreview = undefined;
    cimmichSetupMergeIntents.clearMerge();
    cimmichSetupSubjectConfirm = undefined;
    if (cimmichSetupLoading || !cimmichPerson) {
      return;
    }
    cimmichSetupLoading = true;
    try {
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to load identity setup';
    } finally {
      cimmichSetupLoading = false;
    }
  };

  const openCimmichDetails = () => {
    cimmichMode = 'details';
  };

  const addSetupAlias = async () => {
    if (!cimmichPerson || !cimmichSetupAliasDraft.trim()) {
      return;
    }
    cimmichSetupSaving = 'alias:add';
    cimmichSetupError = '';
    try {
      await addCimmichPersonAlias(cimmichPerson.person_id, cimmichSetupAliasDraft, cimmichSetupAliasKind);
      cimmichSetupAliasDraft = '';
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to add name';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const removeSetupAlias = async (aliasId: string) => {
    if (!cimmichPerson) {
      return;
    }
    cimmichSetupSaving = `alias:${aliasId}`;
    cimmichSetupError = '';
    try {
      await removeCimmichPersonAlias(cimmichPerson.person_id, aliasId);
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to remove name';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const toggleSetupCategory = async (categoryId: string) => {
    if (!cimmichPerson || !cimmichSetup) {
      return;
    }
    const selected = cimmichSetup.categories.some((category) => category.category_id === categoryId);
    cimmichSetupSaving = `category:${categoryId}`;
    cimmichSetupError = '';
    try {
      await setCimmichPersonCategory(cimmichPerson.person_id, categoryId, !selected);
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to update category';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const saveSetupSubjectKind = async () => {
    if (!cimmichPerson || !cimmichSetupSubjectConfirm) {
      return;
    }
    cimmichSetupSaving = 'subject-kind';
    cimmichSetupError = '';
    try {
      await setCimmichPersonSubjectKind(cimmichPerson.person_id, cimmichSetupSubjectConfirm);
      cimmichSetupSubjectConfirm = undefined;
      cimmichSetupMergePersonId = '';
      cimmichSetupMergeQuery = '';
      cimmichSetupMergePreview = undefined;
      cimmichSetupMergeIntents.clearMerge();
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to update identity type';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const previewSetupMerge = async () => {
    if (!cimmichPerson || !cimmichSetupMergePersonId) {
      return;
    }
    cimmichSetupSaving = 'merge:preview';
    cimmichSetupError = '';
    try {
      cimmichSetupMergePreview = await getCimmichMergePreview(cimmichSetupMergePersonId, cimmichPerson.person_id);
    } catch (error) {
      cimmichSetupMergePreview = undefined;
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to preview merge';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const confirmSetupMerge = async () => {
    if (!cimmichPerson || !cimmichSetupMergePreview) {
      return;
    }
    cimmichSetupSaving = 'merge:confirm';
    cimmichSetupError = '';
    try {
      const sourcePersonId = cimmichSetupMergePreview.source.person_id;
      const targetPersonId = cimmichPerson.person_id;
      const commandId = cimmichSetupMergeIntents.mergeCommandId(sourcePersonId, targetPersonId);
      await mergeCimmichPeople(sourcePersonId, targetPersonId, commandId);
      cimmichSetupMergeIntents.completeMerge(sourcePersonId, targetPersonId);
      cimmichSetupMergePersonId = '';
      cimmichSetupMergeQuery = '';
      cimmichSetupMergePreview = undefined;
      cimmichIdentityLoaded = false;
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to merge identities';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const undoSetupMerge = async (mergeOperationId: string) => {
    cimmichSetupSaving = `unmerge:${mergeOperationId}`;
    cimmichSetupError = '';
    try {
      const commandId = cimmichSetupMergeIntents.unmergeCommandId(mergeOperationId);
      await unmergeCimmichPeople(mergeOperationId, commandId);
      cimmichSetupMergeIntents.completeUnmerge(mergeOperationId);
      cimmichIdentityLoaded = false;
      await refreshCimmichSetup();
    } catch (error) {
      cimmichSetupError = error instanceof Error ? error.message : 'Unable to undo merge';
    } finally {
      cimmichSetupSaving = '';
    }
  };

  const selectCimmichFaceBucket = async (
    face: CimmichIdentityFace,
    bucketKind: 'head' | 'lq' | 'prime' | 'secondary' | null,
  ) => {
    if (!cimmichPerson || cimmichMainBucket(face) === bucketKind) {
      return;
    }
    cimmichIdentitySavingId = `face:${face.face_id}`;
    cimmichIdentityError = '';
    try {
      await setCimmichFaceBucket(cimmichPerson.person_id, face.face_id, bucketKind);
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to update face bucket';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const toggleCimmichFaceModifier = async (face: CimmichIdentityFace, modifierName: string, selected: boolean) => {
    if (!cimmichPerson || !modifierName) {
      return;
    }
    cimmichIdentitySavingId = `modifier:${face.face_id}:${modifierName}`;
    cimmichIdentityError = '';
    try {
      await setCimmichFaceModifier(cimmichPerson.person_id, face.face_id, modifierName, selected);
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to update face modifier';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const decideCimmichModifierProposal = async (proposalId: string, action: 'accept' | 'reject') => {
    if (!cimmichPerson) {
      return;
    }
    cimmichIdentitySavingId = `modifier-proposal:${proposalId}`;
    cimmichIdentityError = '';
    try {
      await decideCimmichFaceModifierProposal(cimmichPerson.person_id, proposalId, action);
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to review modifier suggestion';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const rejectCimmichIdentity = async (face: CimmichIdentityFace) => {
    if (cimmichIdentityRejectConfirmId !== face.face_id) {
      cimmichIdentityRejectConfirmId = face.face_id;
      return;
    }
    cimmichIdentitySavingId = `reject:${face.face_id}`;
    cimmichIdentityError = '';
    try {
      const correction = await rejectCimmichAcceptedIdentity(
        face.identity_claim_id,
        createCimmichIdentityCorrectionCommandId('person-not-this-person'),
      );
      const history = await getCimmichIdentityCorrectionHistory(face.identity_claim_id);
      cimmichIdentityUndoDecisionId =
        history.items.find(
          (item) => item.decisionId === correction.decisionId && item.undo.eligible && item.undo.decisionId,
        )?.undo.decisionId ?? '';
      cimmichIdentityRejectConfirmId = '';
      cimmichIdentityMessage = 'Identity removed. The Face is ready to identify again.';
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to remove identity';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const undoRejectedCimmichIdentity = async (decisionId = cimmichIdentityUndoDecisionId) => {
    if (!decisionId) {
      return;
    }
    cimmichIdentitySavingId = 'undo:identity';
    cimmichIdentityError = '';
    try {
      await undoCimmichIdentityCorrection(
        decisionId,
        createCimmichIdentityCorrectionCommandId('person-not-this-person-undo'),
      );
      cimmichIdentityUndoDecisionId = '';
      cimmichIdentityMessage = 'Identity restored.';
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to undo the identity correction';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const openCimmichIdentityMove = (
    face: CimmichIdentityFace,
    suggestion?: CimmichFaceMatch | CimmichFaceOwnerReviewMatch,
  ) => {
    if (cimmichIdentityMoveFaceId === face.face_id) {
      cimmichIdentityMoveFaceId = '';
      return;
    }
    cimmichIdentityMoveBody =
      face.body_selected &&
      !(face.body_link_origin === 'face_body_linkage' && face.body_supporting_face_id === face.face_id);
    cimmichIdentityMoveFaceId = face.face_id;
    cimmichIdentityMoveMode = 'existing';
    cimmichIdentityMoveNewName = '';
    cimmichIdentityMoveSuggestion = suggestion;
    cimmichIdentityMovePersonId = suggestion?.person_id ?? '';
    cimmichIdentityMoveQuery = suggestion?.display_name ?? '';
    cimmichIdentityError = '';
    if (cimmichSetupPeople.length === 0) {
      void getCimmichPeople(500)
        .then((people) => (cimmichSetupPeople = people))
        .catch((error) => {
          cimmichIdentityError = error instanceof Error ? error.message : 'Unable to load People';
        });
    }
  };

  const submitCimmichIdentityMove = async (face: CimmichIdentityFace) => {
    if (!cimmichPerson) {
      return;
    }
    if (cimmichIdentityMoveMode === 'existing' && !cimmichIdentityMovePersonId) {
      return;
    }
    if (cimmichIdentityMoveMode === 'new' && !cimmichIdentityMoveNewName.trim()) {
      return;
    }
    cimmichIdentitySavingId = `move:${face.face_id}`;
    cimmichIdentityError = '';
    cimmichIdentityMessage = '';
    try {
      const result = await moveCimmichIdentityFace(cimmichPerson.person_id, face.face_id, {
        ...(cimmichIdentityMoveBody && face.body_id ? { bodyId: face.body_id } : {}),
        moveBody: cimmichIdentityMoveBody,
        ...(cimmichIdentityMoveMode === 'new'
          ? { newPersonName: cimmichIdentityMoveNewName.trim() }
          : { targetPersonId: cimmichIdentityMovePersonId }),
      });
      cimmichIdentityMessage = `${result.createdPerson ? 'Created' : 'Moved to'} ${result.personName}${result.movedBody ? ' with its selected body' : ''}.`;
      cimmichIdentityMoveFaceId = '';
      cimmichIdentityMoveQuery = '';
      cimmichSetupPeople = await getCimmichPeople(500);
      await refreshCimmichIdentity();
    } catch (error) {
      cimmichIdentityError = error instanceof Error ? error.message : 'Unable to move identity';
    } finally {
      cimmichIdentitySavingId = '';
    }
  };

  const applyUpdatedEvidenceBundle = (bundle: CimmichEvidenceBundle, packs = packIndexes) => {
    people = buildCimmichPeopleIndex(bundle, packs);
    person = people.find((row) => row.name === data.personName);
    loadError = person ? '' : `No Cimmich person named ${data.personName}`;
  };

  const faceCandidateDraft = (candidate: FaceConfirmationCandidate) =>
    normalizeName(faceCandidateDrafts[candidate.id] ?? candidate.proposedName);

  const runFaceCandidateAction = async (
    candidate: FaceConfirmationCandidate,
    action: 'confirm' | 'reject' | 'rename',
  ) => {
    const name = action === 'rename' ? faceCandidateDraft(candidate) : candidate.proposedName;
    if (action !== 'reject' && !name) {
      faceCandidateError = 'Name is required';
      return;
    }

    faceCandidateSavingId = `${candidate.id}:${action}`;
    faceCandidateError = '';
    faceCandidateMessage = '';
    try {
      const result = await updateCimmichFace({
        action: action === 'reject' ? 'reject_name_candidate' : 'rename',
        faceId: candidate.face.id,
        filename: candidate.filename,
        mediaId: candidate.mediaId,
        name,
      });
      applyUpdatedEvidenceBundle(result.bundle);
      faceCandidateMessage =
        action === 'reject' ? `Skipped ${candidate.proposedName} for this face.` : `Bound ${name} to this face.`;
    } catch (error) {
      faceCandidateError = error instanceof Error ? error.message : 'Unable to update face candidate';
    } finally {
      faceCandidateSavingId = '';
    }
  };

  const loadPersonProjection = async (generation: number) => {
    try {
      const row = await getCimmichPersonByName(data.personName, data.personId);
      if (generation !== personProjectionGeneration) {
        return;
      }
      if (!row) {
        throw new Error(`No person named ${data.personName}`);
      }
      cimmichPerson = row;
      const assetsPromise = getCimmichPersonAssetsPage(row.person_id, 120);
      const peoplePromise = getCimmichPeople(500);
      const correctionsPromise = getCimmichIdentityCorrectionDiscovery({ personId: row.person_id }, { limit: 12 });
      const visibilityPromise =
        row.subject_kind === 'person'
          ? getCimmichVisibilityObject('person', row.person_id)
          : Promise.resolve(undefined);
      const profilePromise =
        row.subject_kind === 'person'
          ? Promise.all([
              getCimmichPersonProfile(row.person_id),
              getCimmichPersonProfileDisplayDefaults(),
              getCimmichPersonProfileDisplay(row.person_id),
              getCimmichPersonDetailsDisplayDefaults(),
              getCimmichPersonDetailsDisplay(row.person_id),
            ]).catch((error) => {
              if (generation === personProjectionGeneration) {
                cimmichProfileError = error instanceof Error ? error.message : 'Unable to load profile details';
              }
              return null;
            })
          : Promise.resolve(null);
      const [assetsPage, profileProjection, corrections, personVisibility, setupPeople] = await Promise.all([
        assetsPromise,
        profilePromise,
        correctionsPromise,
        visibilityPromise,
        peoplePromise,
      ]);
      if (generation !== personProjectionGeneration) {
        return;
      }
      const peopleConnections = await loadCimmichPeopleConnections(row.person_id, assetsPage.items, setupPeople);
      if (generation !== personProjectionGeneration) {
        return;
      }
      cimmichAssets = assetsPage.items;
      cimmichSetupPeople = setupPeople;
      cimmichPeopleConnections = peopleConnections;
      cimmichAssetsNextCursor = assetsPage.nextCursor;
      cimmichIdentityCorrections = corrections.items;
      cimmichIdentityUndoDecisionId = corrections.items.find((item) => item.undo.eligible)?.undo.decisionId ?? '';
      cimmichPersonVisibility = personVisibility;
      if (profileProjection) {
        const [profile, defaults, display, detailsDefaults, detailsDisplay] = profileProjection;
        cimmichProfile = profile;
        cimmichProfileDefaults = defaults;
        cimmichProfileDisplay = display;
        cimmichDetailsDefaults = detailsDefaults;
        cimmichDetailsDisplay = detailsDisplay;
        cimmichProfileError = '';
      }
      if (row.needs_holding || cimmichMode === 'identity') {
        await openCimmichIdentity(generation);
      }
      if (generation === personProjectionGeneration) {
        cimmichLoadError = '';
      }
    } catch (error) {
      if (generation === personProjectionGeneration) {
        cimmichLoadError = error instanceof Error ? error.message : 'Unable to load person';
      }
    }
  };

  $effect(() => {
    void cimmichVisibilityManager.version;
    const generation = ++personProjectionGeneration;
    cimmichPerson = undefined;
    cimmichPersonVisibility = undefined;
    cimmichPeopleConnections = [];
    cimmichAssets = [];
    cimmichAssetsNextCursor = null;
    cimmichIdentityLoaded = false;
    cimmichIdentityLoading = false;
    cimmichIdentityLoadingMore = false;
    cimmichIdentityFaces = [];
    cimmichIdentityNextCursor = null;
    cimmichHoldingMatches = {};
    cimmichHoldingMatchesLoading = {};
    cimmichIdentityUndoDecisionId = '';
    cimmichIdentityCorrections = [];
    cimmichProfile = undefined;
    cimmichProfileDefaults = undefined;
    cimmichProfileDisplay = undefined;
    cimmichDetailsDefaults = undefined;
    cimmichDetailsDisplay = undefined;
    cimmichLoadError = '';
    void loadPersonProjection(generation);
  });

  $effect(() => {
    const filenames = [...new Set(resolveFilenames)];
    const run = ++assetResolveRun;
    if (filenames.length === 0) {
      resolvedAssets = {};
      return;
    }

    void resolveCimmichAssetsByFilename(filenames).then((assets) => {
      if (run === assetResolveRun) {
        resolvedAssets = assets;
      }
    });
  });
</script>

<UserPageLayout>
  <div class="mx-auto flex w-full max-w-7xl flex-col gap-3 p-4 text-immich-fg sm:p-5 dark:text-immich-dark-fg">
    {#if cimmichPerson}
      <section
        class="relative min-h-100 overflow-hidden rounded-[1.75rem] bg-slate-950 text-white shadow-2xl ring-1 ring-white/10"
        data-testid="cimmich-person-hero"
      >
        {#if cimmichPerson.sourceAssetId}
          <div class="absolute inset-0 bg-cover bg-no-repeat" style={cimmichPersonHeroStyle(cimmichPerson)}></div>
        {:else}
          <div
            class="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgb(71_85_105),rgb(15_23_42)_58%,rgb(2_6_23))]"
          ></div>
        {/if}
        <div class="absolute inset-0 bg-linear-to-r from-black/92 via-black/60 to-black/18"></div>
        <div class="absolute inset-0 bg-linear-to-t from-black/92 via-transparent to-black/45"></div>
        <a
          class="absolute top-5 left-5 z-10 inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 text-sm font-semibold text-white/80 backdrop-blur-md transition hover:bg-black/55 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:top-7 sm:left-7"
          href={cimmichPerson.subject_kind === 'pet' ? Route.cimmichPets() : Route.cimmichPeople()}
        >
          <Icon icon={mdiArrowLeft} size="16" />
          {cimmichPerson.subject_kind === 'pet' ? 'Pets & Things' : 'People'}
        </a>
        <button
          class="absolute top-5 right-5 z-10 inline-flex h-10 items-center gap-2 rounded-full bg-white px-3.5 text-sm font-semibold text-slate-950 shadow-lg transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:top-7 sm:right-7"
          type="button"
          data-testid="cimmich-person-edit"
          aria-label={cimmichPerson.subject_kind === 'person' ? 'Edit profile' : 'Edit'}
          onclick={() => (cimmichPerson?.subject_kind === 'person' ? openCimmichDetails() : void openCimmichSetup())}
        >
          <Icon icon={mdiPencilOutline} size="17" />
          <span>Edit</span>
        </button>
        <div
          class="relative flex min-h-100 min-w-0 flex-col justify-end gap-5 p-5 sm:flex-row sm:items-end sm:p-7 lg:p-8"
        >
          {#if cimmichPerson.sourceAssetId}
            <span
              class="block size-28 shrink-0 rounded-full bg-slate-700 bg-cover bg-center shadow-2xl ring-4 ring-white/90 sm:size-32"
              style={cimmichPersonCropStyle(cimmichPerson)}
              aria-label={cimmichPerson.display_name}
            ></span>
          {:else}
            <span
              class="flex size-28 shrink-0 items-center justify-center rounded-full bg-white/15 text-white shadow-2xl ring-4 ring-white/70 backdrop-blur-md sm:size-32"
            >
              <Icon icon={mdiAccount} size="52" />
            </span>
          {/if}
          <div class="min-w-0 flex-1">
            <div class="min-w-0">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <h1 class="max-w-full text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl">
                  {cimmichPerson.display_name}
                </h1>
                {#if cimmichPerson.subject_kind === 'pet'}
                  <span
                    class="rounded-full border border-white/20 bg-black/35 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md"
                    >Pet</span
                  >
                {/if}
                {#if cimmichPerson.needs_holding}
                  <span class="rounded-full bg-violet-200 px-3 py-1 text-xs font-semibold text-violet-950">Holding</span
                  >
                {:else if cimmichPerson.needs_sort}
                  <span class="rounded-full bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-950"
                    >On review list</span
                  >
                {/if}
              </div>
              {#if !cimmichProfile && visibleCimmichAliases.length > 0}
                <p class="mt-2 truncate text-sm text-white/65">
                  Also known as {visibleCimmichAliases.join(', ')}
                </p>
              {/if}
            </div>

            {#if cimmichProfile && cimmichProfileDisplay}
              {#if cimmichHeroFields.length > 0}
                <dl class="mt-4 flex flex-wrap gap-2 text-sm text-white">
                  {#each cimmichHeroFields as field (field.fieldKey)}
                    <div class={field.fieldKey === 'about' ? 'mb-1 basis-full' : ''}>
                      <dt class="sr-only">{field.label}</dt>
                      <dd
                        class={field.fieldKey === 'about'
                          ? 'max-w-3xl text-base/7 font-normal text-pretty whitespace-pre-wrap text-white/85 sm:text-lg/8'
                          : 'inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 font-semibold backdrop-blur-md'}
                      >
                        {#if field.fieldKey !== 'about' && field.fieldKey !== 'gender_identity'}
                          <span class="font-medium text-white/55">{field.label}</span>
                        {/if}
                        {#if field.fieldKey === 'gender_identity'}
                          <span class="sr-only">{field.label}: {field.value}</span>
                          <Icon icon={cimmichGenderIcon ?? mdiGenderMaleFemaleVariant} size="20" />
                        {:else}
                          <span>{field.value}</span>
                        {/if}
                        {#if field.fieldKey === 'photo_history' && cimmichFuturePhotoDateCount > 0}
                          <Tooltip
                            text={`${cimmichFuturePhotoDateCount.toLocaleString()} ${cimmichFuturePhotoDateCount === 1 ? 'photo has a future date' : 'photos have future dates'} and ${cimmichFuturePhotoDateCount === 1 ? 'is' : 'are'} excluded from this range.`}
                          >
                            {#snippet child({ props })}
                              <span
                                {...props}
                                class="-my-1 -mr-1 inline-flex min-h-7 items-center gap-1.5 rounded-full bg-amber-300/15 px-2 text-xs font-semibold text-amber-100"
                                aria-label={`${cimmichFuturePhotoDateCount.toLocaleString()} photo dates need review`}
                              >
                                <Icon icon={mdiCalendarAlertOutline} size="16" />
                                {cimmichFuturePhotoDateCount.toLocaleString()}
                                {cimmichFuturePhotoDateCount === 1 ? 'date needs' : 'dates need'} review
                              </span>
                            {/snippet}
                          </Tooltip>
                        {/if}
                      </dd>
                    </div>
                  {/each}
                </dl>
              {/if}
            {:else}
              <dl class="mt-4 flex flex-wrap gap-2 text-sm text-white">
                <div
                  class="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 backdrop-blur-md"
                >
                  <dt class="font-medium text-white/55">{cimmichPhotoTimeframeLabel}</dt>
                  <dd class="font-semibold">{cimmichPhotoTimeframe}</dd>
                </div>
                <div
                  class="inline-flex min-h-9 items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 backdrop-blur-md"
                >
                  <dt class="font-medium text-white/55">Relationship</dt>
                  <dd class="font-semibold">
                    {cimmichRelationshipLabels.length > 0 ? cimmichRelationshipLabels.join(', ') : 'Not set'}
                  </dd>
                </div>
              </dl>
            {/if}
          </div>
        </div>
      </section>

      <div class="min-w-0 overflow-x-auto border-b border-gray-200 dark:border-immich-dark-gray">
        <div class="flex min-w-max items-stretch sm:min-w-full">
          <div class="flex shrink-0" role="tablist" aria-label="Person content">
            <button
              class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'photos' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
              type="button"
              role="tab"
              aria-selected={cimmichMode === 'photos'}
              onclick={() => (cimmichMode = 'photos')}
            >
              Photos
              <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-immich-dark-gray"
                >{cimmichPerson.asset_count.toLocaleString()}</span
              >
            </button>
            {#if !cimmichPerson.needs_holding && (cimmichPerson.candidate_faces > 0 || cimmichMode === 'candidates')}
              <button
                class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'candidates' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                type="button"
                role="tab"
                aria-selected={cimmichMode === 'candidates'}
                onclick={() => void openCimmichCandidates()}
              >
                Suggestions
                <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-immich-dark-gray"
                  >{cimmichPerson.candidate_faces.toLocaleString()}</span
                >
              </button>
            {/if}
            {#if cimmichPerson.subject_kind === 'person'}
              <button
                class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'details' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                type="button"
                role="tab"
                aria-selected={cimmichMode === 'details'}
                onclick={openCimmichDetails}
              >
                Details
              </button>
              <button
                class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'connections' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
                type="button"
                role="tab"
                aria-selected={cimmichMode === 'connections'}
                onclick={() => (cimmichMode = 'connections')}
              >
                Connections
                {#if cimmichPeopleConnections.length + cimmichPersonConnections.length > 0}
                  <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-immich-dark-gray">
                    {(cimmichPeopleConnections.length + cimmichPersonConnections.length).toLocaleString()}
                  </span>
                {/if}
              </button>
            {/if}
            <button
              class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'identity' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
              type="button"
              role="tab"
              aria-selected={cimmichMode === 'identity'}
              onclick={() => void openCimmichIdentity()}
            >
              Matching
            </button>
            <button
              class={`inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold sm:px-4 ${cimmichMode === 'documents' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-immich-fg dark:text-gray-400 dark:hover:text-immich-dark-fg'}`}
              type="button"
              role="tab"
              aria-selected={cimmichMode === 'documents'}
              onclick={() => (cimmichMode = 'documents')}
            >
              Documents
            </button>
          </div>

          {#if cimmichMode === 'photos'}
            <div class="my-2 w-px shrink-0 bg-gray-300 dark:bg-gray-700" aria-hidden="true"></div>
            <div
              class="ml-auto flex min-w-max items-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-immich-dark-bg"
              aria-label="Photo view options"
            >
              <label
                class="relative inline-flex size-10 cursor-pointer items-center justify-center text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                title="Sort photos"
              >
                <Icon icon={mdiSortVariant} size="19" />
                <select
                  class="absolute inset-0 size-full cursor-pointer opacity-0"
                  bind:value={cimmichPhotoSort}
                  aria-label="Sort photos"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="filename">Filename</option>
                </select>
              </label>
              <label
                class="relative inline-flex size-10 cursor-pointer items-center justify-center border-l border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                title="Group photos"
              >
                <Icon icon={mdiGroup} size="19" />
                <select
                  class="absolute inset-0 size-full cursor-pointer opacity-0"
                  bind:value={cimmichPhotoGroup}
                  aria-label="Group photos"
                >
                  <option value="none">No grouping</option>
                  <option value="year">Year</option>
                  <option value="place">Place</option>
                  <option value="event">Event</option>
                  <option value="object">Thing</option>
                </select>
              </label>
              <label
                class="relative inline-flex size-10 cursor-pointer items-center justify-center border-l border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                title="Thumbnail size"
              >
                <Icon icon={mdiViewGridOutline} size="19" />
                <select
                  class="absolute inset-0 size-full cursor-pointer opacity-0"
                  bind:value={cimmichPhotoSize}
                  aria-label="Thumbnail size"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </label>
            </div>
          {/if}
        </div>
      </div>

      {#if cimmichMode === 'photos'}
        <section class="grid gap-4">
          {#each groupedCimmichAssets as group (group.id)}
            {#if group.label}
              <div class="flex items-center gap-3">
                <h2 class="text-base font-semibold text-gray-800 dark:text-gray-100">{group.label}</h2>
                {#if group.kindLabel}
                  <span
                    class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-immich-dark-gray dark:text-gray-300"
                  >
                    {group.kindLabel}
                  </span>
                {/if}
                <span class="text-sm text-gray-500 dark:text-gray-400">{group.items.length.toLocaleString()}</span>
                <div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
              </div>
            {/if}
            <div class={personPhotoGridClass(cimmichPhotoSize)}>
              {#each group.items as asset (asset.asset_id)}
                {#if asset.sourceAssetId}
                  <article class="group relative aspect-square overflow-hidden rounded-sm bg-gray-200 dark:bg-gray-800">
                    <a
                      href={Route.viewCimmichPersonAsset({
                        id: asset.sourceAssetId,
                        personId: cimmichPerson.person_id,
                        personName: cimmichPerson.display_name,
                      })}
                      class="block size-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      title={asset.filename}
                    >
                      <img
                        src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Thumbnail })}
                        alt={asset.filename}
                        class="size-full object-cover transition-transform group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                      <span
                        class="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 to-transparent px-3 pt-10 pb-2 text-xs font-medium text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                      >
                        <span class="line-clamp-1">{asset.filename}</span>
                        {#if personPhotoDateLabel(asset)}
                          <span class="mt-0.5 block font-normal text-white/80">{personPhotoDateLabel(asset)}</span>
                        {/if}
                      </span>
                    </a>
                  </article>
                {:else}
                  <div
                    class="flex aspect-square items-end rounded-sm bg-gray-200 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <span class="line-clamp-3">{asset.filename || asset.asset_id}</span>
                  </div>
                {/if}
              {/each}
            </div>
          {:else}
            <div class="rounded-xl border border-dashed border-gray-300 px-5 py-12 text-center dark:border-gray-700">
              <p class="font-medium text-gray-700 dark:text-gray-200">No photos yet</p>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Try All photos, or use Tags to review how photos are connected to {cimmichPerson.display_name}.
              </p>
            </div>
          {/each}

          {#if cimmichAssetsNextCursor}
            <button
              class="mx-auto min-h-11 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-immich-dark-gray dark:text-gray-200"
              type="button"
              disabled={cimmichAssetsLoadingMore}
              onclick={() => void loadMoreCimmichAssets()}
            >
              {cimmichAssetsLoadingMore ? 'Loading…' : 'Load 120 more'}
            </button>
          {/if}

          {#if cimmichIdentityError}
            <p
              class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {cimmichIdentityError}
            </p>
          {/if}
        </section>
      {:else if cimmichMode === 'connections'}
        <section class="grid gap-4" aria-label="Connections">
          {#if cimmichPersonConnectionGroups.length > 0}
            <div class="grid gap-7">
              {#each cimmichPersonConnectionGroups as group (group.id)}
                <section class="grid gap-3" aria-labelledby={`person-connections-${group.id}`}>
                  <div class="flex items-baseline gap-2 border-b border-gray-200 pb-2 dark:border-gray-800">
                    <h3 class="text-sm font-semibold tracking-wide uppercase" id={`person-connections-${group.id}`}>
                      {group.label}
                    </h3>
                    <span class="text-xs text-gray-400">{group.items.length.toLocaleString()}</span>
                  </div>
                  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {#each group.items as connection (connection.entityId)}
                      <a
                        class="group grid min-h-28 grid-cols-[7rem_1fr] overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:hover:border-gray-600"
                        href={cimmichPersonConnectionHref(connection)}
                      >
                        <img
                          class="size-full object-cover transition duration-200 group-hover:scale-[1.03]"
                          src={getAssetMediaUrl({ id: connection.sourceAssetId, size: AssetMediaSize.Thumbnail })}
                          alt=""
                        />
                        <span class="flex min-w-0 flex-col justify-center p-4">
                          <span class="text-xs font-semibold tracking-wide text-gray-400 uppercase">
                            {connection.entityKind === 'person'
                              ? connection.metaLabel
                              : connection.typeKind.replaceAll('_', ' ')}
                          </span>
                          <span class="mt-1 truncate font-semibold">{connection.displayName}</span>
                          <span class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {#if connection.entityKind === 'person'}
                              {connection.photoCount.toLocaleString()} shared
                              {connection.photoCount === 1 ? 'context' : 'contexts'}
                            {:else}
                              {connection.photoCount.toLocaleString()}
                              {connection.photoCount === 1 ? 'photo' : 'photos'}
                            {/if}
                          </span>
                        </span>
                      </a>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          {:else}
            <CimmichStatePanel
              title="No connections yet"
              description={`People, events, places and things linked to ${cimmichPerson.display_name}'s photo stories will appear here.`}
            />
          {/if}
        </section>
      {:else if cimmichMode === 'documents'}
        <CimmichDocuments
          heading=""
          subject={{ id: cimmichPerson.person_id, kind: cimmichPerson.subject_kind, name: cimmichPerson.display_name }}
        />
      {:else if cimmichMode === 'details'}
        {#if cimmichProfile && cimmichProfileDefaults && cimmichProfileDisplay && cimmichDetailsDefaults && cimmichDetailsDisplay}
          <CimmichPersonDetails
            aliases={visibleCimmichAliases}
            compact
            defaults={cimmichProfileDefaults}
            detailsDefaults={cimmichDetailsDefaults}
            detailsDisplay={cimmichDetailsDisplay}
            display={cimmichProfileDisplay}
            profile={cimmichProfile}
            railManaged
            ondefaultschange={(value) => (cimmichProfileDefaults = value)}
            ondetailsdefaultschange={(value) => (cimmichDetailsDefaults = value)}
            ondetailsdisplaychange={(value) => (cimmichDetailsDisplay = value)}
            ondisplaychange={(value) => (cimmichProfileDisplay = value)}
            onprofilechange={(value) => (cimmichProfile = value)}
            onopenidentitysettings={() => void openCimmichSetup()}
          />
        {:else if cimmichProfileError}
          <p
            class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            role="alert"
          >
            {cimmichProfileError}
          </p>
        {:else}
          <p class="text-sm text-gray-500 dark:text-gray-400">Loading details…</p>
        {/if}
      {:else if cimmichMode === 'candidates'}
        <section class="grid gap-4">
          <div
            class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3 dark:border-immich-dark-gray"
          >
            <div class="flex flex-wrap items-center gap-2">
              <fieldset class="flex min-h-10 items-center rounded-lg bg-gray-100 p-1 dark:bg-immich-dark-gray">
                <legend class="sr-only">Candidate evidence filter</legend>
                {#each [{ id: 'useful', label: 'Useful first' }, { id: 'all', label: `All ${cimmichCandidates.length.toLocaleString()}` }] as option (option.id)}
                  <button
                    class={[
                      'min-h-8 rounded-md px-3 text-xs font-semibold',
                      cimmichCandidateReviewMode === option.id
                        ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white'
                        : 'text-gray-600 dark:text-gray-300',
                    ]}
                    type="button"
                    aria-pressed={cimmichCandidateReviewMode === option.id}
                    onclick={() => {
                      cimmichCandidateReviewMode = option.id as PersonCandidateReviewMode;
                      cimmichCandidateSelection = [];
                      cimmichCandidateConfirm = false;
                    }}>{option.label}</button
                  >
                {/each}
              </fieldset>
              <button
                class="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
                disabled={cimmichCandidateSaving || visibleCimmichCandidates.length === 0}
                onclick={selectAllCandidates}
                type="button"
              >
                Select all
              </button>
              {#if cimmichCandidateSelection.length > 0}
                <button
                  class="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
                  disabled={cimmichCandidateSaving}
                  onclick={() => {
                    cimmichCandidateSelection = [];
                    cimmichCandidateConfirm = false;
                  }}
                  type="button"
                >
                  Clear
                </button>
              {/if}
              <span class="text-sm text-gray-500 dark:text-gray-400">
                {cimmichCandidateSelection.length.toLocaleString()} selected
              </span>
            </div>
            <button
              class={[
                'rounded-md px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-black',
                cimmichCandidateConfirm
                  ? 'bg-amber-600 dark:bg-amber-400'
                  : 'bg-immich-primary dark:bg-immich-dark-primary',
              ]}
              disabled={cimmichCandidateSaving || cimmichCandidateSelection.length === 0}
              onclick={() => void acceptSelectedCandidates()}
              type="button"
            >
              {#if cimmichCandidateSaving}
                Accepting…
              {:else if cimmichCandidateConfirm}
                Confirm accept {cimmichCandidateSelection.length}
              {:else}
                Accept selected ({cimmichCandidateSelection.length})
              {/if}
            </button>
          </div>

          {#if cimmichCandidateError}
            <p
              class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {cimmichCandidateError}
            </p>
          {/if}
          {#if cimmichCandidateMessage}
            <p
              class="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
            >
              {cimmichCandidateMessage}
            </p>
          {/if}

          {#if cimmichCandidateLoading}
            <p class="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Loading candidates…</p>
          {:else}
            <p class="text-sm/6 text-gray-500 dark:text-gray-400">
              Raw same-model similarity and separation margin explain the ordering; neither is an identity probability.
              Useful first hides zero-margin ties only. All preserves the complete owner queue.
            </p>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {#each visibleCimmichCandidates as candidate, index (candidate.identity_claim_id)}
                {@const selected = candidateSelected(candidate.identity_claim_id)}
                <article
                  class={[
                    'relative overflow-hidden rounded-lg border-2 bg-white dark:bg-immich-dark-bg',
                    selected
                      ? 'border-immich-primary shadow-sm dark:border-immich-dark-primary'
                      : 'border-gray-200 dark:border-immich-dark-gray',
                  ]}
                >
                  <a
                    href={candidate.sourceAssetId ? Route.viewAsset({ id: candidate.sourceAssetId }) : undefined}
                    class="relative block aspect-4/5 overflow-hidden bg-gray-200 dark:bg-gray-800"
                    title={candidate.filename}
                  >
                    {#if candidate.sourceAssetId}
                      <span
                        class="absolute inset-0 bg-cover transition-transform hover:scale-[1.02]"
                        style={cimmichCandidateCropStyle(candidate)}
                        aria-label={`Candidate face in ${candidate.filename}`}
                      ></span>
                    {:else}
                      <span class="flex size-full items-center justify-center p-4 text-center text-xs text-gray-500">
                        Preview unavailable
                      </span>
                    {/if}
                    <span
                      class="absolute top-2 left-2 rounded-sm bg-black/75 px-2 py-1 text-xs font-semibold text-white"
                    >
                      #{index + 1}
                    </span>
                    <span
                      class="absolute bottom-2 left-2 rounded-sm bg-black/75 px-2 py-1 text-xs font-semibold text-white"
                    >
                      Raw similarity {rawSimilarityLabel(candidate.match_score)}
                    </span>
                  </a>
                  <label
                    class="absolute top-2 right-2 flex size-9 cursor-pointer items-center justify-center rounded-md bg-white/95 shadow-sm dark:bg-black/85"
                  >
                    <span class="sr-only">Select candidate {index + 1}</span>
                    <input
                      class="size-5 accent-immich-primary"
                      type="checkbox"
                      checked={selected}
                      disabled={cimmichCandidateSaving}
                      onchange={() => toggleCandidate(candidate.identity_claim_id)}
                    />
                  </label>
                  <div class="grid gap-1.5 p-3">
                    <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                      {candidate.filename || candidate.asset_id}
                    </p>
                    <div class="flex flex-wrap gap-1 text-[11px] text-gray-600 dark:text-gray-300">
                      {#if candidate.source_margin !== null}
                        <span
                          class="rounded-sm bg-gray-100 px-1.5 py-0.5 dark:bg-white/10"
                          title="Difference between the first and second same-model match; larger separation is easier to review."
                          >Separation {candidate.source_margin.toFixed(3)}</span
                        >
                      {/if}
                      <span
                        class="rounded-sm bg-gray-100 px-1.5 py-0.5 dark:bg-white/10"
                        title="How certain the detector was that this region contains a face; it does not identify the person."
                      >
                        Face detector {Math.round(candidate.detection_confidence * 100)}%
                      </span>
                    </div>
                    {#if candidate.current_person_name}
                      <p class="text-xs font-medium text-amber-700 dark:text-amber-300">
                        Currently {candidate.current_person_name}; accepting will move it here.
                      </p>
                    {/if}
                  </div>
                </article>
              {:else}
                <p class="col-span-full py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                  {cimmichCandidateReviewMode === 'useful'
                    ? 'No candidates have a positive separation margin. Choose All to inspect the complete queue.'
                    : 'No candidates for this Person.'}
                </p>
              {/each}
            </div>
          {/if}
        </section>
      {:else if cimmichMode === 'identity'}
        <section class="grid gap-4">
          <div class="grid gap-3">
            {#if cimmichPerson.needs_holding}
              <p class="text-sm font-semibold">Choose a match for each held face</p>
            {:else}
              <div>
                <h2 class="text-xl font-semibold">Matching</h2>
                <p class="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
                  Keep identity truth correct, maintain a small varied reference set, then review the suggestions it
                  produces. Photo tags are a separate Photos workflow.
                </p>
              </div>
              <div class="grid gap-3 md:grid-cols-3" aria-label="Matching workflow">
                <article
                  class="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/25"
                >
                  <p class="text-xs font-semibold tracking-wide text-blue-700 uppercase dark:text-blue-300">
                    1 · Identity truth
                  </p>
                  <p class="mt-2 text-3xl font-semibold">{cimmichPerson.accepted_faces.toLocaleString()}</p>
                  <p class="mt-1 text-sm font-semibold">accepted faces</p>
                  <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">Correct anything that is not this person.</p>
                  <button
                    class="mt-3 min-h-10 rounded-lg border border-blue-300 px-3 text-sm font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-200 dark:hover:bg-blue-950"
                    type="button"
                    onclick={() => (cimmichIdentityFilter = 'all')}>Review identity</button
                  >
                </article>
                <article
                  class="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900 dark:bg-violet-950/25"
                >
                  <p class="text-xs font-semibold tracking-wide text-violet-700 uppercase dark:text-violet-300">
                    2 · Reference set
                  </p>
                  <p class="mt-2 text-3xl font-semibold">
                    {(cimmichPerson.prime_faces + cimmichPerson.secondary_faces).toLocaleString()}
                  </p>
                  <p class="mt-1 text-sm font-semibold">matching references</p>
                  <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">Use a small set of clear, varied faces.</p>
                  <button
                    class="mt-3 min-h-10 rounded-lg border border-violet-300 px-3 text-sm font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:text-violet-200 dark:hover:bg-violet-950"
                    type="button"
                    onclick={() => (cimmichIdentityFilter = 'references')}>View references</button
                  >
                </article>
                <article
                  class="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/25"
                >
                  <p class="text-xs font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
                    3 · Review results
                  </p>
                  <p class="mt-2 text-3xl font-semibold">{cimmichPerson.candidate_faces.toLocaleString()}</p>
                  <p class="mt-1 text-sm font-semibold">suggested faces</p>
                  <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">Accept or reject suggestions separately.</p>
                  {#if cimmichPerson.candidate_faces > 0}
                    <button
                      class="mt-3 min-h-10 rounded-lg border border-amber-300 px-3 text-sm font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950"
                      type="button"
                      onclick={() => void openCimmichCandidates()}>Review suggestions</button
                    >
                  {:else}
                    <p class="mt-4 text-xs font-semibold text-gray-500 dark:text-gray-400">No suggestions waiting</p>
                  {/if}
                </article>
              </div>
              <fieldset class="grid gap-2 sm:grid-cols-3">
                <legend class="sr-only">Choose a Matching view</legend>
                {#each cimmichIdentityFilters as filter (filter.id)}
                  <button
                    class={[
                      'rounded-xl border p-3 text-left transition-colors',
                      cimmichIdentityFilter === filter.id
                        ? 'border-gray-950 bg-gray-950 text-white shadow-sm dark:border-white dark:bg-white dark:text-black'
                        : 'border-gray-200 bg-white hover:border-gray-400 dark:border-immich-dark-gray dark:bg-immich-dark-bg dark:hover:border-gray-500',
                    ]}
                    type="button"
                    aria-pressed={cimmichIdentityFilter === filter.id}
                    onclick={() => (cimmichIdentityFilter = filter.id)}
                  >
                    <span class="text-sm font-semibold">{filter.label}</span>
                    <span class="mt-1 block text-[11px] opacity-70">{filter.description}</span>
                  </button>
                {/each}
              </fieldset>
              <details
                class="rounded-xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
              >
                <summary
                  class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold marker:content-none"
                >
                  <span>Advanced evidence views</span>
                  <span class="text-xs font-normal text-gray-500 dark:text-gray-400"
                    >Quality, Head, Body & Presence</span
                  >
                </summary>
                <fieldset
                  class="grid grid-cols-2 gap-2 border-t border-gray-200 p-3 sm:grid-cols-3 lg:grid-cols-5 dark:border-immich-dark-gray"
                >
                  <legend class="sr-only">Choose an advanced evidence view</legend>
                  {#each cimmichIdentityAdvancedFilters as filter (filter.id)}
                    {@const count = cimmichIdentityBucketCount(filter.id)}
                    <button
                      class={[
                        'rounded-lg border p-3 text-left transition-colors',
                        cimmichIdentityFilter === filter.id
                          ? 'border-gray-950 bg-gray-950 text-white dark:border-white dark:bg-white dark:text-black'
                          : 'border-gray-200 hover:border-gray-400 dark:border-immich-dark-gray dark:hover:border-gray-500',
                      ]}
                      type="button"
                      aria-pressed={cimmichIdentityFilter === filter.id}
                      onclick={() => (cimmichIdentityFilter = filter.id)}
                    >
                      <span class="text-sm font-semibold">{filter.label}</span>
                      <span class="mt-1 block text-[11px] opacity-70"
                        >{count.toLocaleString()} loaded · {filter.description}</span
                      >
                    </button>
                  {/each}
                </fieldset>
              </details>
              <div
                class="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-immich-dark-gray"
              >
                <div>
                  <p class="text-sm font-semibold">
                    {[...cimmichIdentityFilters, ...cimmichIdentityAdvancedFilters].find(
                      (filter) => filter.id === cimmichIdentityFilter,
                    )?.label}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
                    {cimmichIdentityFilter === 'non_face'
                      ? `${cimmichBodyPresenceAssets.length.toLocaleString()} loaded appearance${cimmichBodyPresenceAssets.length === 1 ? '' : 's'}`
                      : cimmichIdentityFilter === 'all'
                        ? `${renderedCimmichIdentityFaces.length.toLocaleString()} loaded of ${cimmichPerson.accepted_faces.toLocaleString()} accepted faces`
                        : `${renderedCimmichIdentityFaces.length.toLocaleString()} in the loaded observations`}
                  </p>
                </div>
                <p class="max-w-xl text-right text-xs text-gray-500 dark:text-gray-400">
                  {cimmichIdentityFilter === 'non_face'
                    ? 'Open an appearance to inspect Body or Presence. Manual Head tags remain on the photo.'
                    : cimmichIdentityFilter === 'head'
                      ? 'Face-derived Head references only; manual Head tags are not counted in this library.'
                      : 'Use Review face to manage matching role, appearance notes, or identity corrections.'}
                </p>
              </div>
            {/if}
          </div>

          {#if cimmichIdentityError}
            <p
              class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {cimmichIdentityError}
            </p>
          {/if}
          {#if cimmichIdentityMessage || cimmichIdentityUndoDecisionId}
            <div
              class="flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
            >
              <p>{cimmichIdentityMessage || 'A recent identity correction can still be undone.'}</p>
              {#if cimmichIdentityUndoDecisionId}
                <button
                  class="shrink-0 rounded-md border border-green-300 px-3 py-1.5 font-semibold disabled:opacity-50 dark:border-green-800"
                  disabled={Boolean(cimmichIdentitySavingId)}
                  type="button"
                  onclick={() => void undoRejectedCimmichIdentity()}
                >
                  {cimmichIdentitySavingId === 'undo:identity' ? 'Undoing…' : 'Undo'}
                </button>
              {/if}
            </div>
          {/if}

          {#if cimmichIdentityCorrections.length > 0}
            <details
              class="rounded-xl border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
            >
              <summary
                class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold marker:content-none"
              >
                <span>Recent identity changes</span>
                <span class="text-xs font-normal text-gray-500 dark:text-gray-400">
                  {cimmichIdentityCorrections.length.toLocaleString()} shown
                </span>
              </summary>
              <div class="grid gap-2 border-t border-gray-200 p-3 dark:border-immich-dark-gray">
                {#each cimmichIdentityCorrections as correction (correction.decisionId)}
                  <div
                    class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-immich-dark-gray/50"
                  >
                    <div>
                      <p class="font-semibold">Removed an incorrect identity</p>
                      <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {new Date(correction.createdAt).toLocaleString()} · Face remains available to identify again
                      </p>
                    </div>
                    {#if correction.undo.eligible}
                      <button
                        class="min-h-9 rounded-md border border-gray-300 px-3 text-xs font-semibold hover:bg-white disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
                        type="button"
                        disabled={Boolean(cimmichIdentitySavingId)}
                        onclick={() => void undoRejectedCimmichIdentity(correction.undo.decisionId)}>Undo</button
                      >
                    {:else}
                      <span class="max-w-64 text-right text-xs text-gray-500 dark:text-gray-400">
                        Undo unavailable because this Face has changed since that decision.
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            </details>
          {/if}

          {#if cimmichIdentityLoading}
            <p class="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Loading matching evidence…</p>
          {:else if cimmichIdentityFilter === 'non_face'}
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {#each cimmichBodyPresenceAssets as asset (asset.asset_id)}
                {@const hasBody = asset.association_types.includes('body')}
                {@const hasPresence = asset.association_types.includes('presence')}
                <article
                  class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                >
                  <a
                    href={Route.viewCimmichPersonAsset({
                      id: asset.sourceAssetId,
                      personId: cimmichPerson.person_id,
                      personName: cimmichPerson.display_name,
                    })}
                    class="group relative block aspect-4/5 overflow-hidden bg-gray-200 dark:bg-gray-800"
                    title={asset.filename}
                  >
                    <img
                      class="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                      src={getAssetMediaUrl({ id: asset.sourceAssetId, size: AssetMediaSize.Thumbnail })}
                      alt={asset.filename}
                    />
                    <div class="pointer-events-none absolute right-2 bottom-2 flex flex-wrap justify-end gap-1">
                      {#if hasBody}
                        <span class="rounded-sm bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">Body</span>
                      {/if}
                      {#if hasPresence}
                        <span class="rounded-sm bg-black/75 px-2 py-1 text-[10px] font-semibold text-white"
                          >Presence</span
                        >
                      {/if}
                    </div>
                  </a>
                  <div class="grid gap-1 p-2.5">
                    <p class="text-xs font-semibold">
                      {[hasBody ? 'Body' : '', hasPresence ? 'Presence' : ''].filter(Boolean).join(' · ')}
                    </p>
                    <p class="truncate text-[11px] text-gray-500 dark:text-gray-400" title={asset.filename}>
                      {asset.filename}
                    </p>
                  </div>
                </article>
              {/each}
            </div>
            {#if cimmichBodyPresenceAssets.length === 0}
              <CimmichStatePanel
                title="No Body or Presence evidence"
                description="Body and whole-photo Presence tags for this person will appear here."
              />
            {/if}
          {:else}
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {#each renderedCimmichIdentityFaces as face (face.face_id)}
                {@const mainBucket = cimmichMainBucket(face)}
                {@const holdingMatch = cimmichHoldingMatches[face.face_id]}
                {@const bodyOwnedElsewhere = Boolean(
                  face.body_assigned_person_id && face.body_assigned_person_id !== cimmichPerson.person_id,
                )}
                <article
                  class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                >
                  <a
                    href={face.sourceAssetId
                      ? Route.viewCimmichPersonAsset({
                          id: face.sourceAssetId,
                          personId: cimmichPerson.person_id,
                          personName: cimmichPerson.display_name,
                        })
                      : undefined}
                    class="group relative block aspect-4/5 overflow-hidden bg-gray-200 dark:bg-gray-800"
                    title={face.filename}
                  >
                    <span
                      class="absolute inset-0 bg-cover transition duration-200 group-hover:scale-[1.02] group-hover:opacity-0"
                      style={cimmichObservationCropStyle(face, 'face')}
                      aria-label={`Face in ${face.filename}`}
                    ></span>
                    {#if face.body_id}
                      <span
                        class="absolute inset-0 bg-cover opacity-0 transition duration-200 group-hover:scale-[1.02] group-hover:opacity-100"
                        style={cimmichObservationCropStyle(face, 'body')}
                        aria-label={`Body in ${face.filename}`}
                      ></span>
                      <span
                        class="pointer-events-none absolute bottom-2 left-2 rounded-sm bg-black/70 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        {face.body_linked ? 'Linked full body' : 'Body in frame'}
                      </span>
                    {/if}
                    <div class="pointer-events-none absolute top-2 right-2 flex flex-wrap justify-end gap-1">
                      {#each face.modifiers.slice(0, 2) as modifier (modifier.modifierKey)}
                        <span class="rounded-sm bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                          {modifier.modifierLabel}
                        </span>
                      {/each}
                      {#each face.modifier_proposals.slice(0, Math.max(0, 2 - face.modifiers.length)) as proposal (proposal.proposalId)}
                        <span
                          class="rounded-sm border border-amber-300 bg-amber-50/95 px-2 py-1 text-[10px] font-semibold text-amber-950"
                        >
                          {proposal.modifierLabel}? · {Math.round(proposal.confidence * 100)}%
                        </span>
                      {/each}
                      {#each face.capture_contexts.slice(0, 1) as context (context.contextId)}
                        <span class="rounded-sm bg-sky-950/80 px-2 py-1 text-[10px] font-semibold text-white">
                          {context.contextKind === 'rapid_burst'
                            ? 'Burst'
                            : context.contextKind === 'same_moment'
                              ? 'Same moment'
                              : 'Sequence'}
                          · {context.memberCount}
                        </span>
                      {/each}
                    </div>
                    {#if face.qc_flags.length > 0}
                      <div class="pointer-events-none absolute top-2 left-2 flex max-w-[72%] flex-wrap gap-1">
                        {#each face.qc_flags.slice(0, 2) as flag (flag)}
                          <span class="rounded-sm bg-amber-400/90 px-2 py-1 text-[10px] font-semibold text-black">
                            {cimmichQcLabel(face, flag)}
                          </span>
                        {/each}
                        {#if face.qc_flags.length > 2}
                          <span class="rounded-sm bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                            +{face.qc_flags.length - 2}
                          </span>
                        {/if}
                      </div>
                    {/if}
                  </a>

                  <div class="grid gap-2 p-2.5">
                    <div class="flex min-w-0 items-center justify-between gap-2">
                      <span class="truncate text-xs font-semibold">{cimmichIdentityBucketLabel(face)}</span>
                      <span
                        class="max-w-[48%] truncate text-[11px] text-gray-500 dark:text-gray-400"
                        title={face.filename}>{face.filename}</span
                      >
                    </div>
                    {#if cimmichPerson.needs_holding}
                      {#if holdingMatch}
                        <button
                          class="grid rounded-md border border-violet-300 bg-violet-50 px-2.5 py-2 text-left hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:hover:bg-violet-950"
                          type="button"
                          disabled={Boolean(cimmichIdentitySavingId)}
                          onclick={() => openCimmichIdentityMove(face, holdingMatch)}
                        >
                          <span class="truncate text-sm font-semibold">{holdingMatch.display_name}</span>
                          <span class="text-[11px] text-violet-700 dark:text-violet-300"
                            >Closest · {'similarity' in holdingMatch
                              ? (holdingMatch.similarity?.toFixed(3) ?? 'not available')
                              : holdingMatch.prime_score.toFixed(3)}</span
                          >
                        </button>
                      {:else}
                        <button
                          class="rounded-md border border-gray-200 px-2.5 py-2 text-left text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray"
                          type="button"
                          disabled={cimmichHoldingMatchesLoading[face.face_id] || Boolean(cimmichIdentitySavingId)}
                          onclick={() => void loadCimmichHoldingMatch(face)}
                        >
                          {cimmichHoldingMatchesLoading[face.face_id] ? 'Finding closest…' : 'Find closest match'}
                        </button>
                      {/if}
                    {:else}
                      <details
                        class="rounded-lg border border-gray-200 bg-gray-50 dark:border-immich-dark-gray dark:bg-black/10"
                      >
                        <summary class="flex min-h-11 cursor-pointer items-center px-3 text-xs font-semibold">
                          Review face
                        </summary>
                        <div class="grid gap-2 border-t border-gray-200 p-2.5 dark:border-immich-dark-gray">
                          <label
                            class="grid gap-1 text-[11px] font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400"
                          >
                            Face matching role
                            <select
                              class="min-w-0 rounded-md border border-gray-200 bg-white p-2 text-sm font-medium tracking-normal text-immich-fg normal-case outline-none focus:border-primary disabled:opacity-60 dark:border-immich-dark-gray dark:bg-immich-dark-gray dark:text-immich-dark-fg"
                              value={mainBucket ?? ''}
                              disabled={cimmichIdentitySavingId === `face:${face.face_id}`}
                              onchange={(event) => {
                                const value = event.currentTarget.value;
                                void selectCimmichFaceBucket(
                                  face,
                                  value === 'prime' || value === 'secondary' || value === 'lq' || value === 'head'
                                    ? value
                                    : null,
                                );
                              }}
                            >
                              <option value="">Not a matching reference</option>
                              <option value="prime">Strong reference</option>
                              <option value="secondary">Supporting reference</option>
                              <option value="lq">Low-quality reference</option>
                              <option value="head">Head reference (Face-derived)</option>
                            </select>
                          </label>

                          <div class="grid gap-1.5">
                            {#if face.modifiers.length > 0 || face.modifier_proposals.length > 0 || face.capture_contexts.length > 0}
                              <div class="flex flex-wrap gap-1">
                                {#each face.modifiers as modifier (modifier.modifierKey)}
                                  <button
                                    class="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-200 disabled:opacity-50 dark:bg-violet-950 dark:text-violet-200"
                                    type="button"
                                    title={`Remove ${modifier.modifierLabel}`}
                                    disabled={cimmichIdentitySavingId.startsWith(`modifier:${face.face_id}:`)}
                                    onclick={() => void toggleCimmichFaceModifier(face, modifier.modifierLabel, false)}
                                  >
                                    {modifier.modifierLabel} ×
                                  </button>
                                {/each}
                                {#each face.modifier_proposals as proposal (proposal.proposalId)}
                                  <span
                                    class="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 p-0.5 pl-2 text-[11px] font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                                    title={`Suggested with ${Math.round(proposal.confidence * 100)}% confidence`}
                                  >
                                    {proposal.modifierLabel}?
                                    <button
                                      class="rounded-full bg-amber-200 px-1.5 py-0.5 font-semibold hover:bg-amber-300 disabled:opacity-50 dark:bg-amber-900 dark:hover:bg-amber-800"
                                      type="button"
                                      disabled={cimmichIdentitySavingId === `modifier-proposal:${proposal.proposalId}`}
                                      onclick={() => void decideCimmichModifierProposal(proposal.proposalId, 'accept')}
                                    >
                                      Add
                                    </button>
                                    <button
                                      class="rounded-full px-1.5 py-0.5 hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-950"
                                      type="button"
                                      aria-label={`Reject ${proposal.modifierLabel} suggestion`}
                                      disabled={cimmichIdentitySavingId === `modifier-proposal:${proposal.proposalId}`}
                                      onclick={() => void decideCimmichModifierProposal(proposal.proposalId, 'reject')}
                                    >
                                      ×
                                    </button>
                                  </span>
                                {/each}
                                {#each face.capture_contexts as context (context.contextId)}
                                  <span
                                    class="rounded-full bg-sky-100 px-2 py-1 text-[11px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200"
                                    title={context.label || 'Shared capture context'}
                                  >
                                    {context.contextKind === 'rapid_burst'
                                      ? 'Burst'
                                      : context.contextKind === 'same_moment'
                                        ? 'Same moment'
                                        : 'Sequence'}
                                    · {context.memberCount}
                                  </span>
                                {/each}
                              </div>
                            {/if}
                            <select
                              class="min-w-0 rounded-md border border-gray-200 bg-white p-2 text-sm text-immich-fg outline-none focus:border-primary disabled:opacity-60 dark:border-immich-dark-gray dark:bg-immich-dark-gray dark:text-immich-dark-fg"
                              value=""
                              aria-label="Add modifier"
                              disabled={cimmichIdentitySavingId.startsWith(`modifier:${face.face_id}:`)}
                              onchange={(event) => {
                                const modifierName = event.currentTarget.value;
                                event.currentTarget.value = '';
                                if (modifierName) {
                                  void toggleCimmichFaceModifier(face, modifierName, true);
                                }
                              }}
                            >
                              <option value="">Add modifier…</option>
                              {#each cimmichModifierOptions.filter((name) => !face.modifiers.some((modifier) => modifier.modifierLabel === name)) as modifierName (modifierName)}
                                <option value={modifierName}>{modifierName}</option>
                              {/each}
                            </select>
                          </div>
                        </div>
                      </details>
                    {/if}

                    {#if face.body_linked}
                      <p
                        class="rounded-md border border-sky-200 bg-sky-50 p-2 text-sm font-medium text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
                      >
                        Linked full body
                      </p>
                    {:else if bodyOwnedElsewhere}
                      <p
                        class="rounded-md border border-gray-200 p-2 text-sm text-gray-500 dark:border-immich-dark-gray"
                      >
                        Nearby body belongs elsewhere
                      </p>
                    {:else if face.body_id}
                      <p
                        class="rounded-md border border-gray-200 p-2 text-sm text-gray-500 dark:border-immich-dark-gray"
                      >
                        Body detected · not linked
                      </p>
                    {/if}

                    {#if cimmichIdentityMoveFaceId === face.face_id}
                      <div
                        class="grid gap-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 dark:border-blue-900 dark:bg-blue-950/40"
                      >
                        <div class="grid grid-cols-2 gap-1 rounded-md bg-white/70 p-1 text-xs dark:bg-black/20">
                          {#each [{ id: 'existing', label: 'Existing Person' }, { id: 'new', label: 'New Person' }] as mode (mode.id)}
                            <button
                              class={[
                                'rounded-sm px-2 py-1.5 font-semibold',
                                cimmichIdentityMoveMode === mode.id
                                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-black'
                                  : 'text-gray-600 dark:text-gray-300',
                              ]}
                              type="button"
                              aria-pressed={cimmichIdentityMoveMode === mode.id}
                              onclick={() => (cimmichIdentityMoveMode = mode.id as CimmichMoveMode)}
                              >{mode.label}</button
                            >
                          {/each}
                        </div>
                        {#if cimmichIdentityMoveMode === 'existing'}
                          <div class="grid gap-1.5">
                            <input
                              class="min-w-0 rounded-md border border-gray-200 bg-white p-2 text-sm outline-none focus:border-blue-500 dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                              value={cimmichIdentityMoveQuery}
                              placeholder="Search People"
                              aria-label="Search for the Person to receive this face"
                              oninput={(event) => {
                                cimmichIdentityMoveQuery = event.currentTarget.value;
                                cimmichIdentityMovePersonId = '';
                              }}
                            />
                            {#if cimmichIdentityMoveQuery.trim() && filteredCimmichMoveOptions.length > 0}
                              <div
                                class="max-h-44 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                                role="listbox"
                                aria-label="Matching People"
                              >
                                {#each filteredCimmichMoveOptions as option (option.person_id)}
                                  <button
                                    class="flex min-h-10 w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-white/10"
                                    type="button"
                                    role="option"
                                    aria-selected={cimmichIdentityMovePersonId === option.person_id}
                                    onclick={() => {
                                      cimmichIdentityMovePersonId = option.person_id;
                                      cimmichIdentityMoveQuery = option.display_name;
                                    }}
                                  >
                                    <span class="truncate font-medium">{option.display_name}</span>
                                    <span class="shrink-0 text-xs text-gray-500">{option.asset_count} photos</span>
                                  </button>
                                {/each}
                              </div>
                            {:else if cimmichIdentityMoveQuery.trim() && !cimmichIdentityMovePersonId}
                              <p class="px-1 text-xs text-gray-500">No matching People.</p>
                            {/if}
                            {#if cimmichIdentityMovePersonId}
                              <p class="px-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                                Selected: {cimmichMoveOptions.find(
                                  (option) => option.person_id === cimmichIdentityMovePersonId,
                                )?.display_name ?? cimmichIdentityMoveSuggestion?.display_name}
                              </p>
                            {/if}
                          </div>
                        {:else}
                          <input
                            class="min-w-0 rounded-md border border-gray-200 bg-white p-2 text-sm outline-none dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                            bind:value={cimmichIdentityMoveNewName}
                            placeholder="New Person name"
                            aria-label="New Person name"
                          />
                        {/if}
                        {#if face.body_selected && face.body_link_origin === 'face_body_linkage' && face.body_supporting_face_id === face.face_id}
                          <p class="text-xs text-gray-600 dark:text-gray-300">
                            Linked body follows this face automatically.
                          </p>
                        {:else if face.body_selected}
                          <label class="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                            <input type="checkbox" bind:checked={cimmichIdentityMoveBody} />
                            Move selected body too
                          </label>
                        {/if}
                        <div class="grid grid-cols-[1fr_auto] gap-1.5">
                          <button
                            class="rounded-md bg-blue-700 p-2 text-sm font-semibold text-white disabled:opacity-50"
                            type="button"
                            disabled={Boolean(cimmichIdentitySavingId) ||
                              (cimmichIdentityMoveMode === 'existing'
                                ? !cimmichIdentityMovePersonId
                                : !cimmichIdentityMoveNewName.trim())}
                            onclick={() => void submitCimmichIdentityMove(face)}
                          >
                            {cimmichIdentitySavingId === `move:${face.face_id}`
                              ? 'Moving…'
                              : cimmichIdentityMoveMode === 'new'
                                ? 'Create and split'
                                : 'Move face'}
                          </button>
                          <button
                            class="rounded-md p-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
                            type="button"
                            disabled={Boolean(cimmichIdentitySavingId)}
                            onclick={() => (cimmichIdentityMoveFaceId = '')}>Cancel</button
                          >
                        </div>
                      </div>
                    {:else}
                      <button
                        class="rounded-md px-2 py-1.5 text-left text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950"
                        type="button"
                        disabled={Boolean(cimmichIdentitySavingId)}
                        onclick={() => void openCimmichIdentityMove(face)}
                        >{cimmichPerson.needs_holding ? 'Choose person' : 'Move / split'}</button
                      >
                    {/if}

                    {#if cimmichIdentityRejectConfirmId === face.face_id}
                      <div class="grid grid-cols-[1fr_auto] gap-1.5">
                        <button
                          class="rounded-md bg-red-600 p-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          type="button"
                          disabled={Boolean(cimmichIdentitySavingId)}
                          onclick={() => void rejectCimmichIdentity(face)}
                        >
                          {cimmichIdentitySavingId === `reject:${face.face_id}` ? 'Removing…' : 'Confirm removal'}
                        </button>
                        <button
                          class="rounded-md bg-gray-100 p-2 text-sm font-medium hover:bg-gray-200 dark:bg-immich-dark-gray"
                          type="button"
                          disabled={Boolean(cimmichIdentitySavingId)}
                          onclick={() => (cimmichIdentityRejectConfirmId = '')}
                        >
                          Cancel
                        </button>
                      </div>
                    {:else}
                      <button
                        class="rounded-md px-2 py-1.5 text-left text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-700 dark:text-gray-400 dark:hover:bg-red-950 dark:hover:text-red-200"
                        type="button"
                        disabled={Boolean(cimmichIdentitySavingId)}
                        onclick={() => void rejectCimmichIdentity(face)}
                      >
                        Not this person
                      </button>
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
            {#if renderedCimmichIdentityFaces.length === 0}
              <CimmichStatePanel
                title={cimmichIdentityNextCursor
                  ? 'Nothing in the loaded results'
                  : cimmichIdentityFilter === 'needs_qc'
                    ? 'Nothing needs review'
                    : cimmichIdentityFilter === 'head'
                      ? 'No Face-derived Head references'
                      : 'This bucket is empty'}
                description={cimmichIdentityNextCursor
                  ? 'Load more identity faces to continue checking this filter.'
                  : cimmichIdentityFilter === 'needs_qc'
                    ? 'This person has no currently flagged identity evidence.'
                    : cimmichIdentityFilter === 'head'
                      ? 'Manual Head tags remain visible on photos and are intentionally not counted in this reference library.'
                      : 'Choose another view or assign a matching role from Identity observations.'}
              />
            {/if}
            {#if cimmichIdentityNextCursor}
              <button
                class="mx-auto min-h-11 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-immich-dark-gray dark:text-gray-200"
                type="button"
                disabled={cimmichIdentityLoadingMore}
                onclick={() => void loadMoreCimmichIdentity()}
              >
                {cimmichIdentityLoadingMore ? 'Loading…' : 'Load 24 more'}
              </button>
            {/if}
          {/if}
        </section>
      {:else}
        <section class="grid gap-4 lg:grid-cols-2" data-testid="cimmich-person-setup">
          {#if cimmichSetupError}
            <p
              class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 lg:col-span-2 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {cimmichSetupError}
            </p>
          {/if}

          {#if cimmichSetupLoading || !cimmichSetup}
            <p class="py-10 text-sm text-gray-500 lg:col-span-2 dark:text-gray-400">Loading setup…</p>
          {:else}
            <article
              class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 p-4 lg:col-span-2 dark:border-immich-dark-gray"
            >
              <div>
                <h2 class="text-lg font-semibold">Profile settings</h2>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Control this Person's visibility. Duplicate identity tools remain below.
                </p>
              </div>
              {#if cimmichPersonVisibility}
                <CimmichObjectVisibility
                  object={cimmichPersonVisibility}
                  objectLabel="Person"
                  onChange={(value) => (cimmichPersonVisibility = value)}
                />
              {/if}
            </article>
            <article class="rounded-lg border border-gray-200 p-4 dark:border-immich-dark-gray">
              <h2 class="text-lg font-semibold">Names</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Keep one display name and every name this identity is known by.
              </p>

              <div class="mt-4 flex flex-wrap gap-2">
                <span
                  class="rounded-full bg-gray-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-gray-100 dark:text-black"
                >
                  {cimmichSetup.display_name} · display
                </span>
                {#each cimmichSetup.alias_items as alias (alias.alias_id)}
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-gray-100 py-1 pr-1 pl-3 text-sm dark:bg-immich-dark-gray"
                  >
                    <span>{alias.label} · {alias.alias_kind.replace('_', ' ')}</span>
                    <button
                      class="rounded-full px-2 py-0.5 text-gray-500 hover:bg-red-100 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-950 dark:hover:text-red-200"
                      type="button"
                      aria-label={`Remove ${alias.label}`}
                      disabled={Boolean(cimmichSetupSaving)}
                      onclick={() => void removeSetupAlias(alias.alias_id)}>×</button
                    >
                  </span>
                {/each}
              </div>

              <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                <input
                  class="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                  placeholder="Add another name"
                  bind:value={cimmichSetupAliasDraft}
                  onkeydown={(event) => {
                    if (event.key === 'Enter') {
                      void addSetupAlias();
                    }
                  }}
                />
                <select
                  class="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                  bind:value={cimmichSetupAliasKind}
                >
                  <option value="nickname">Nickname</option>
                  <option value="former_name">Former name</option>
                  <option value="imported">Imported name</option>
                </select>
                <button
                  class="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50 dark:bg-gray-100 dark:text-black"
                  type="button"
                  disabled={!cimmichSetupAliasDraft.trim() || Boolean(cimmichSetupSaving)}
                  onclick={() => void addSetupAlias()}>{cimmichSetupSaving === 'alias:add' ? 'Adding…' : 'Add'}</button
                >
              </div>
            </article>

            <article class="rounded-lg border border-gray-200 p-4 dark:border-immich-dark-gray">
              <h2 class="text-lg font-semibold">Categories</h2>
              <div class="mt-4 flex flex-wrap gap-2">
                {#each cimmichSetup.category_catalog.filter((category) => category.category_kind === 'relationship') as category (category.category_id)}
                  {@const selected = cimmichSetup.categories.some((item) => item.category_id === category.category_id)}
                  <button
                    class={[
                      'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                      selected
                        ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-black'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray',
                    ]}
                    type="button"
                    aria-pressed={selected}
                    disabled={Boolean(cimmichSetupSaving)}
                    onclick={() => void toggleSetupCategory(category.category_id)}>{category.name}</button
                  >
                {/each}
              </div>
              <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">No relationship selected appears in Others.</p>
              {#each cimmichSetup.category_catalog.filter((category) => category.slug === 'sort') as category (category.category_id)}
                {@const selected = cimmichSetup.categories.some((item) => item.category_id === category.category_id)}
                {@const holdingSelected = cimmichSetup.categories.some((item) => item.slug === 'holding')}
                <button
                  class={[
                    'mt-4 flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
                    selected
                      ? 'border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray',
                  ]}
                  type="button"
                  aria-pressed={selected}
                  disabled={Boolean(cimmichSetupSaving) || (selected && holdingSelected)}
                  onclick={() => void toggleSetupCategory(category.category_id)}
                >
                  <span>
                    <span class="block font-semibold">Review list</span>
                    <span class="block text-xs opacity-70"
                      >Keep matches visible, but treat this identity as review-only.</span
                    >
                  </span>
                  <span class="font-semibold">{selected ? 'On' : 'Off'}</span>
                </button>
              {/each}
              {#each cimmichSetup.category_catalog.filter((category) => category.slug === 'holding') as category (category.category_id)}
                {@const selected = cimmichSetup.categories.some((item) => item.category_id === category.category_id)}
                <button
                  class={[
                    'mt-2 ml-4 flex w-[calc(100%-1rem)] items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
                    selected
                      ? 'border-violet-400 bg-violet-50 text-violet-950 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray',
                  ]}
                  type="button"
                  aria-pressed={selected}
                  disabled={Boolean(cimmichSetupSaving)}
                  onclick={() => void toggleSetupCategory(category.category_id)}
                >
                  <span>
                    <span class="block font-semibold">Holding</span>
                    <span class="block text-xs opacity-70">Mixed people; match and move each face individually.</span>
                  </span>
                  <span class="font-semibold">{selected ? 'On' : 'Off'}</span>
                </button>
              {/each}
            </article>

            <article class="rounded-lg border border-gray-200 p-4 dark:border-immich-dark-gray">
              <h2 class="text-lg font-semibold">Identity type</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Pets stay out of human face matching and move to Pets & Things. Pet matching is not active yet.
              </p>
              <div class="mt-4 grid grid-cols-2 gap-2">
                {#each [{ id: 'person', label: 'Person' }, { id: 'pet', label: 'Pet' }] as kind (kind.id)}
                  <button
                    class={[
                      'rounded-md border px-4 py-3 text-left text-sm font-medium',
                      cimmichSetup.subject_kind === kind.id
                        ? 'border-primary bg-primary/10 text-primary dark:border-immich-dark-primary dark:text-immich-dark-primary'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray',
                    ]}
                    type="button"
                    aria-pressed={cimmichSetup.subject_kind === kind.id}
                    disabled={Boolean(cimmichSetupSaving)}
                    onclick={() => {
                      if (cimmichSetup?.subject_kind !== kind.id) {
                        cimmichSetupSubjectConfirm = kind.id as 'person' | 'pet';
                      }
                    }}>{kind.label}</button
                  >
                {/each}
              </div>
              {#if cimmichSetupSubjectConfirm}
                <div
                  class="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
                >
                  <p class="font-medium">
                    Mark {cimmichSetup.display_name} as {cimmichSetupSubjectConfirm === 'pet' ? 'a pet' : 'a person'}?
                  </p>
                  <p class="mt-1 text-xs opacity-80">
                    {cimmichSetupSubjectConfirm === 'pet'
                      ? 'Human Prime, Secondary and LQ matching references will be retired. Modifiers and existing evidence stay recoverable.'
                      : 'Human reference galleries will be rebuilt from accepted face evidence.'}
                  </p>
                  <div class="mt-3 flex gap-2">
                    <button
                      class="rounded-md bg-amber-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-amber-100 dark:text-amber-950"
                      type="button"
                      disabled={Boolean(cimmichSetupSaving)}
                      onclick={() => void saveSetupSubjectKind()}
                      >{cimmichSetupSaving === 'subject-kind' ? 'Saving…' : 'Confirm'}</button
                    >
                    <button
                      class="rounded-md px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
                      type="button"
                      disabled={Boolean(cimmichSetupSaving)}
                      onclick={() => (cimmichSetupSubjectConfirm = undefined)}>Cancel</button
                    >
                  </div>
                </div>
              {/if}
            </article>

            <article
              id="cimmich-merge-identities"
              class="scroll-mt-20 rounded-lg border border-gray-200 p-4 lg:col-span-2 dark:border-immich-dark-gray"
            >
              <h2 class="text-lg font-semibold">Merge identities</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Select a duplicate to merge into {cimmichSetup.display_name}. This identity stays; the duplicate becomes
                a reversible redirect.
              </p>
              <div class="relative mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                <label class="grid gap-1 text-sm font-medium">
                  Find a duplicate
                  <input
                    class="h-11 min-w-0 rounded-md border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray"
                    type="search"
                    placeholder={`Search ${cimmichSetup.subject_kind === 'pet' ? 'pets' : 'people'} by name`}
                    bind:value={cimmichSetupMergeQuery}
                    disabled={Boolean(cimmichSetupSaving)}
                    oninput={() => {
                      cimmichSetupMergePersonId = '';
                      cimmichSetupMergePreview = undefined;
                      cimmichSetupMergeIntents.clearMerge();
                    }}
                  />
                </label>
                <button
                  class="h-11 self-end rounded-md bg-gray-100 px-4 text-sm font-medium hover:bg-gray-200 disabled:opacity-50 dark:bg-immich-dark-gray"
                  type="button"
                  disabled={!cimmichSetupMergePersonId || Boolean(cimmichSetupSaving)}
                  onclick={() => void previewSetupMerge()}
                  >{cimmichSetupSaving === 'merge:preview' ? 'Checking…' : 'Preview merge'}</button
                >
                {#if cimmichSetupMergeQuery.trim() && !selectedCimmichMerge}
                  <div
                    class="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg sm:col-span-1 dark:border-immich-dark-gray dark:bg-immich-dark-bg"
                    role="listbox"
                    aria-label="Duplicate people"
                  >
                    {#each filteredCimmichMergeOptions as option (option.person_id)}
                      <button
                        class="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-immich-dark-gray"
                        type="button"
                        role="option"
                        aria-selected={false}
                        onclick={() => {
                          cimmichSetupMergePersonId = option.person_id;
                          cimmichSetupMergeQuery = option.display_name;
                          cimmichSetupMergePreview = undefined;
                          cimmichSetupMergeIntents.clearMerge();
                        }}
                      >
                        <span class="truncate font-medium">{option.display_name}</span>
                        <span class="shrink-0 text-xs text-gray-500">{option.asset_count.toLocaleString()} photos</span>
                      </button>
                    {:else}
                      <p class="p-3 text-sm text-gray-500">No matching people.</p>
                    {/each}
                  </div>
                {/if}
              </div>

              {#if selectedCimmichMerge}
                <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  Selected <span class="font-semibold">{selectedCimmichMerge.display_name}</span> · {selectedCimmichMerge.asset_count.toLocaleString()}
                  photos
                </p>
              {/if}

              {#if cimmichSetupMergePreview}
                <div
                  class="mt-4 grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
                >
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p class="text-xs font-semibold tracking-wide uppercase opacity-70">Merge duplicate</p>
                      <p class="mt-1 font-semibold">{cimmichSetupMergePreview.source.display_name}</p>
                      <p class="mt-1 text-xs opacity-80">
                        {cimmichSetupMergePreview.source.assets} photos · {cimmichSetupMergePreview.source
                          .accepted_faces} faces · {cimmichSetupMergePreview.source.aliases} aliases
                      </p>
                    </div>
                    <div>
                      <p class="text-xs font-semibold tracking-wide uppercase opacity-70">Keep</p>
                      <p class="mt-1 font-semibold">{cimmichSetupMergePreview.target.display_name}</p>
                      <p class="mt-1 text-xs opacity-80">
                        {cimmichSetupMergePreview.target.assets} photos · {cimmichSetupMergePreview.target
                          .accepted_faces} faces · {cimmichSetupMergePreview.target.aliases} aliases
                      </p>
                    </div>
                  </div>
                  {#if cimmichSetupMergePreview.conflicts.shared_assets > 0 || cimmichSetupMergePreview.conflicts.duplicate_presence > 0}
                    <p class="text-xs font-medium">
                      {cimmichSetupMergePreview.conflicts.shared_assets} shared photos · {cimmichSetupMergePreview
                        .conflicts.duplicate_presence} duplicate presence tags will be deduplicated.
                    </p>
                  {/if}
                  <button
                    class="w-fit rounded-md bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800 disabled:opacity-50"
                    type="button"
                    disabled={Boolean(cimmichSetupSaving)}
                    onclick={() => void confirmSetupMerge()}
                    >{cimmichSetupSaving === 'merge:confirm'
                      ? 'Merging…'
                      : `Merge ${cimmichSetupMergePreview.source.display_name} into ${cimmichSetupMergePreview.target.display_name}`}</button
                  >
                </div>
              {/if}

              {#if cimmichSetup.merges.length > 0}
                <div class="mt-5 border-t border-gray-200 pt-4 dark:border-immich-dark-gray">
                  <h3 class="text-sm font-semibold">Merged into this identity</h3>
                  <div class="mt-2 grid gap-2">
                    {#each cimmichSetup.merges as merge (merge.merge_operation_id)}
                      <div
                        class="flex flex-wrap items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-immich-dark-gray"
                      >
                        <span>{merge.source_display_name}</span>
                        <button
                          class="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white hover:text-gray-950 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                          type="button"
                          disabled={Boolean(cimmichSetupSaving)}
                          onclick={() => void undoSetupMerge(merge.merge_operation_id)}
                          >{cimmichSetupSaving === `unmerge:${merge.merge_operation_id}`
                            ? 'Restoring…'
                            : 'Undo merge'}</button
                        >
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </article>
          {/if}
        </section>
      {/if}
    {:else if cimmichLoadError}
      <p
        class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        {cimmichLoadError}
      </p>
    {:else if loadError}
      <p
        class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      >
        {loadError}
      </p>
    {:else if !person}
      <p class="text-sm text-gray-500 dark:text-gray-400">Loading person...</p>
    {:else}
      <section
        class="flex flex-wrap items-center justify-between gap-5 border-b border-gray-200 pb-5 dark:border-immich-dark-gray"
      >
        <div class="flex min-w-0 flex-wrap items-center gap-5">
          {#if featureAsset || person.featureFace?.cropUrl}
            <span
              class="block size-32 rounded-full bg-gray-200 bg-cover bg-center shadow-sm dark:bg-gray-700"
              style={faceCropStyle(featureAsset, person.featureFace)}
              aria-label={person.name}
            ></span>
          {:else}
            <span
              class="flex size-32 items-center justify-center rounded-full bg-gray-200 text-gray-700 shadow-sm dark:bg-immich-dark-gray dark:text-gray-200"
            >
              <Icon icon={mdiAccount} size="56" />
            </span>
          {/if}
          <div class="min-w-0">
            <h1 class="truncate text-3xl font-semibold">{person.name}</h1>
            <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {person.photos.length} photos · {person.faceCount} confirmed faces · {person.bodyLinks} body links
            </p>
            <div class="mt-3 flex flex-wrap gap-2 text-xs">
              <span
                class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1.5 dark:bg-immich-dark-gray"
              >
                <Icon icon={mdiCalendarRange} size="16" />
                {topEvent}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1.5 dark:bg-immich-dark-gray"
              >
                <Icon icon={mdiMapMarkerOutline} size="16" />
                {topPlace}
              </span>
              <span
                class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1.5 dark:bg-immich-dark-gray"
              >
                <Icon icon={mdiShapeOutline} size="16" />
                {topSignal}
              </span>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div class="min-w-24 rounded-md border border-gray-200 px-3 py-2 dark:border-immich-dark-gray">
            <p class="text-gray-500 dark:text-gray-400">Face</p>
            <p class="text-xl font-semibold">{person.faceCount}</p>
          </div>
          <div class="min-w-24 rounded-md border border-gray-200 px-3 py-2 dark:border-immich-dark-gray">
            <p class="text-gray-500 dark:text-gray-400">Body</p>
            <p class="text-xl font-semibold">{person.bodyLinks}</p>
          </div>
          <div class="min-w-24 rounded-md border border-gray-200 px-3 py-2 dark:border-immich-dark-gray">
            <p class="text-gray-500 dark:text-gray-400">Needs</p>
            <p class="text-xl font-semibold">{needsCheckCount}</p>
          </div>
          <div class="min-w-24 rounded-md border border-gray-200 px-3 py-2 dark:border-immich-dark-gray">
            <p class="text-gray-500 dark:text-gray-400">With</p>
            <p class="text-xl font-semibold">{peopleWith.length}</p>
          </div>
        </div>
      </section>

      <datalist id="cimmich-people-names">
        {#each people as row (row.name)}
          <option value={row.name}></option>
        {/each}
      </datalist>

      {#if faceConfirmationCandidates.length > 0}
        <section class="grid gap-3 border-b border-gray-200 pb-5 dark:border-immich-dark-gray">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">Tagged Face Confirmations</h2>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {faceConfirmationCandidates.length} waiting face crops from photos already tagged as {person.name}.
              </p>
            </div>
            {#if faceCandidateMessage}
              <p
                class="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
              >
                {faceCandidateMessage}
              </p>
            {/if}
            {#if faceCandidateError}
              <p class="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
                {faceCandidateError}
              </p>
            {/if}
          </div>

          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {#each faceConfirmationCandidates as candidate (candidate.id)}
              <article class="grid gap-3 rounded-md border border-gray-200 p-3 dark:border-immich-dark-gray">
                <div class="flex items-center gap-3">
                  <span
                    class="block size-20 shrink-0 rounded-full bg-gray-200 bg-cover bg-center dark:bg-gray-700"
                    style={faceOverlayCropStyle(candidate.asset, candidate.face)}
                    aria-label={candidate.proposedName}
                  ></span>
                  <div class="min-w-0">
                    <p class="truncate font-medium">{candidate.proposedName}</p>
                    <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                      {candidate.evidenceKind === 'source' ? 'source tag' : 'candidate'} · {candidate.filename}
                    </p>
                  </div>
                </div>
                <label class="grid gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                  Change to
                  <input
                    class="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-immich-fg outline-none focus:border-primary dark:border-immich-dark-gray dark:bg-immich-dark-gray dark:text-immich-dark-fg"
                    list="cimmich-people-names"
                    value={faceCandidateDrafts[candidate.id] ?? candidate.proposedName}
                    oninput={(event) => {
                      faceCandidateDrafts = {
                        ...faceCandidateDrafts,
                        [candidate.id]: event.currentTarget.value,
                      };
                    }}
                  />
                </label>
                <div class="grid grid-cols-3 gap-2">
                  <button
                    class="rounded-md bg-primary p-2 text-xs font-medium text-white disabled:opacity-60 dark:bg-immich-dark-primary dark:text-black"
                    disabled={Boolean(faceCandidateSavingId)}
                    type="button"
                    onclick={() => void runFaceCandidateAction(candidate, 'confirm')}
                  >
                    {faceCandidateSavingId === `${candidate.id}:confirm` ? 'Saving...' : 'Correct'}
                  </button>
                  <button
                    class="rounded-md bg-gray-100 p-2 text-xs font-medium hover:bg-gray-200 disabled:opacity-60 dark:bg-immich-dark-gray"
                    disabled={Boolean(faceCandidateSavingId)}
                    type="button"
                    onclick={() => void runFaceCandidateAction(candidate, 'rename')}
                  >
                    {faceCandidateSavingId === `${candidate.id}:rename` ? 'Saving...' : 'Change'}
                  </button>
                  <button
                    class="rounded-md bg-gray-100 p-2 text-xs font-medium hover:bg-gray-200 disabled:opacity-60 dark:bg-immich-dark-gray"
                    disabled={Boolean(faceCandidateSavingId)}
                    type="button"
                    onclick={() => void runFaceCandidateAction(candidate, 'reject')}
                  >
                    {faceCandidateSavingId === `${candidate.id}:reject` ? 'Saving...' : 'No'}
                  </button>
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/if}

      <nav
        class="flex gap-2 overflow-x-auto border-b border-gray-200 pb-3 dark:border-immich-dark-gray"
        aria-label="Cimmich person sections"
      >
        {#each tabs as tab (tab.id)}
          <button
            class={[
              'rounded-md px-3 py-2 text-sm font-medium',
              activeTab === tab.id
                ? 'bg-primary text-white dark:bg-immich-dark-primary dark:text-black'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-immich-dark-gray dark:text-gray-200',
            ]}
            type="button"
            aria-pressed={activeTab === tab.id}
            onclick={() => (activeTab = tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </nav>

      {#if activeTab === 'photos'}
        <section class="grid gap-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap gap-2">
              {#each photoFilters as filter (filter.id)}
                <button
                  class={[
                    'rounded-md px-3 py-2 text-sm font-medium',
                    photoFilter === filter.id
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-black'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-immich-dark-gray dark:text-gray-200',
                  ]}
                  type="button"
                  aria-pressed={photoFilter === filter.id}
                  onclick={() => (photoFilter = filter.id)}
                >
                  {filter.label}
                </button>
              {/each}
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400">{filteredPhotos.length} shown</p>
          </div>

          <div
            class="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8"
          >
            {#each filteredPhotos as photo (photo.filename)}
              {@const asset = resolvedAssets[photo.filename]}
              {#if asset}
                <a
                  href={Route.viewAsset(asset.asset)}
                  class="group relative aspect-square overflow-hidden bg-gray-200 dark:bg-gray-800"
                >
                  <img
                    src={asset.thumbnailUrl}
                    alt={photo.filename}
                    class="size-full object-cover transition-transform group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                  <span
                    class="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/55 to-transparent px-2 pt-10 pb-2 text-left text-white"
                  >
                    <span class="block truncate text-[11px]/4 font-semibold"
                      >{photoEvidenceLabels(photo).slice(0, 3).join(' · ') || 'context'}</span
                    >
                    <span class="mt-0.5 line-clamp-2 block text-[11px]/4 text-white/85">
                      {photo.normalCaption || photo.enhancedCaption || photo.filename}
                    </span>
                  </span>
                </a>
              {:else}
                <div
                  class="flex aspect-square flex-col justify-end gap-2 bg-gray-200 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                >
                  <span class="line-clamp-3 text-left leading-5"
                    >{photo.normalCaption || photo.enhancedCaption || photo.filename}</span
                  >
                  <span class="truncate font-medium text-gray-900 dark:text-gray-100">{photo.filename}</span>
                </div>
              {/if}
            {:else}
              <p
                class="col-span-full rounded-md border border-gray-200 p-4 text-sm text-gray-500 dark:border-immich-dark-gray dark:text-gray-400"
              >
                No photos match this filter.
              </p>
            {/each}
          </div>
        </section>
      {:else if activeTab === 'story'}
        <section class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Timeline</h2>
            <div class="mt-4 grid gap-3">
              {#each years as row (row.label)}
                <div class="grid grid-cols-[80px_minmax(0,1fr)_48px] items-center gap-3 text-sm">
                  <span>{row.label}</span>
                  <span class="h-2 rounded-full bg-gray-100 dark:bg-immich-dark-gray">
                    <span
                      class="block h-2 rounded-full bg-primary dark:bg-immich-dark-primary"
                      style={`width: ${Math.max(8, (row.count / Math.max(1, person.photos.length)) * 100)}%`}
                    ></span>
                  </span>
                  <span class="text-right font-medium">{row.count}</span>
                </div>
              {/each}
            </div>
          </div>
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Current Read</h2>
            <p class="mt-3 text-sm/6 text-gray-600 dark:text-gray-300">
              {person.name} appears most strongly in {topEvent}. The current read model most often places them around {topPlace},
              with visible signals led by {topSignal}.
            </p>
          </div>
        </section>
      {:else if activeTab === 'identity'}
        <section class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Face Buckets</h2>
            <div class="mt-4 grid gap-2">
              {#each countRows(person.buckets, 10) as row (row.label)}
                <div class="flex justify-between gap-3 text-sm">
                  <span class="truncate">{bucketLabel(row.label)}</span>
                  <span class="font-medium">{row.count}</span>
                </div>
              {:else}
                <p class="text-sm text-gray-500 dark:text-gray-400">No face buckets yet.</p>
              {/each}
            </div>
          </div>
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Aliases</h2>
            <div class="mt-4 flex flex-wrap gap-2 text-sm">
              {#each person.aliases as alias (alias)}
                <span class="rounded-md bg-gray-100 px-2.5 py-1.5 dark:bg-immich-dark-gray">{alias}</span>
              {:else}
                <p class="text-gray-500 dark:text-gray-400">No alias source is attached yet.</p>
              {/each}
            </div>
          </div>
        </section>
      {:else if activeTab === 'with'}
        <section class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {#each peopleWith as row (row.label)}
            <a
              class="rounded-md border border-gray-200 p-4 hover:bg-gray-50 dark:border-immich-dark-gray dark:hover:bg-immich-dark-gray"
              href={Route.cimmichPerson({ name: row.label })}
            >
              <span class="block truncate font-medium">{row.label}</span>
              <span class="mt-1 block text-sm text-gray-500 dark:text-gray-400">{row.count} photos together</span>
            </a>
          {:else}
            <p class="col-span-full text-sm text-gray-500 dark:text-gray-400">No co-appearance evidence yet.</p>
          {/each}
        </section>
      {:else if activeTab === 'places'}
        <section class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {#each countRows(person.knownPlaces, 18) as row (row.label)}
            <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
              <span class="inline-flex items-center gap-2 font-medium"
                ><Icon icon={mdiMapMarkerOutline} size="18" /> {row.label}</span
              >
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{row.count} appearances</p>
            </div>
          {:else}
            <p class="text-sm text-gray-500 dark:text-gray-400">No place evidence yet.</p>
          {/each}
        </section>
      {:else if activeTab === 'signals'}
        <section class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {#each signalRows as row (row.label)}
            <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
              <span class="inline-flex items-center gap-2 font-medium"
                ><Icon icon={mdiTagMultipleOutline} size="18" /> {row.label}</span
              >
              <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">{row.count} photos</p>
            </div>
          {:else}
            <p class="col-span-full text-sm text-gray-500 dark:text-gray-400">No thing or action evidence yet.</p>
          {/each}
        </section>
      {:else if activeTab === 'maintenance'}
        <section class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Evidence Health</h2>
            <div class="mt-4 grid gap-2 text-sm">
              <div class="flex justify-between gap-3">
                <span>Source-tag photos</span><span class="font-medium">{person.sourcePhotos}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Candidate-only photos</span><span class="font-medium">{person.candidatePhotos}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Confirmed face overlays</span><span class="font-medium">{person.faceCount}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Body links</span><span class="font-medium">{person.bodyLinks}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span>Unresolved nearby faces</span><span class="font-medium">{person.unresolvedFaces}</span>
              </div>
            </div>
          </div>
          <div class="rounded-md border border-gray-200 p-4 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Next Checks</h2>
            <div class="mt-4 grid gap-2 text-sm text-gray-600 dark:text-gray-300">
              <p>
                <Icon icon={mdiCheckCircleOutline} size="16" class="inline" /> Confirm weak/context-only photos before promoting
                them.
              </p>
              <p>
                <Icon icon={mdiAccountMultipleOutline} size="16" class="inline" /> Review high-count People With links for
                relationship/event quality.
              </p>
              <p>
                <Icon icon={mdiImageMultipleOutline} size="16" class="inline" /> Add true aliases and stable profile facts
                when the read model has them.
              </p>
            </div>
          </div>
          <div class="rounded-md border border-gray-200 p-4 lg:col-span-2 dark:border-immich-dark-gray">
            <h2 class="text-lg font-semibold">Archive Provenance</h2>
            <div class="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              {#each archiveProvenanceRows as row (row.label)}
                <div class="flex justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 dark:bg-immich-dark-gray">
                  <span class="truncate">{row.label}</span>
                  <span class="font-medium">{row.count}</span>
                </div>
              {:else}
                <p class="text-gray-500 dark:text-gray-400">No archive provenance yet.</p>
              {/each}
            </div>
          </div>
        </section>
      {/if}
    {/if}
  </div>
</UserPageLayout>
