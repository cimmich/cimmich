import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPersonProfile = async () => {
  const sources = await Promise.all([
    readFile('src/routes/(user)/cimmich/people/[personName]/+page.svelte', 'utf8'),
    readFile('src/lib/components/cimmich/CimmichSamePhotoCollisionReview.svelte', 'utf8'),
    readFile('src/lib/components/cimmich/identity-audit-correction-controller.svelte.ts', 'utf8'),
    readFile('src/lib/components/cimmich/same-photo-collision-review.ts', 'utf8'),
    readFile('src/lib/components/cimmich/person-workspace-navigation.ts', 'utf8'),
    readFile('src/lib/components/cimmich/person-identity-workspace.ts', 'utf8'),
    readFile('src/lib/components/cimmich/person-connections.ts', 'utf8'),
    readFile('src/lib/components/cimmich/CimmichIdentityWaitingBadges.svelte', 'utf8'),
    readFile('src/lib/components/cimmich/CimmichReviewPhotoMedia.svelte', 'utf8'),
    readFile('src/lib/services/cimmich-face-review-comparison-client.ts', 'utf8'),
  ]);
  return sources.join('\n');
};

describe('Person profile layout', () => {
  it('opens with a photo-led identity hero instead of an administrative record card', async () => {
    const source = await readPersonProfile();

    expect(source).toContain('data-testid="cimmich-person-hero"');
    expect(source).toContain('style={cimmichPersonHeroStyle(cimmichPerson)}');
    expect(source).toContain('min-h-100');
    expect(source).toContain('sm:text-5xl lg:text-6xl');
    expect(source).toContain('bg-linear-to-r from-black/92');
    expect(source).toContain('ring-4 ring-white/90');
    expect(source).toContain('bg-black/30 px-3 font-semibold backdrop-blur-md');
  });

  it('pins navigation and editing to the hero corners while keeping administration in Details', async () => {
    const source = await readPersonProfile();

    expect(source).toContain('absolute top-5 left-5 z-10');
    expect(source).toContain('absolute top-5 right-5 z-10');
    expect(source).toContain('<CimmichObjectVisibility');
    expect(source).toContain('Merge duplicate');
    expect(source).toContain('data-testid="cimmich-person-display-shortcut"');
    expect(source).toContain(
      "aria-label={cimmichPerson.subject_kind === 'person' ? 'Edit display photos' : 'Edit details'}",
    );
    expect(source).toContain('void openCimmichDisplay()');
    expect(source).not.toContain('<span>Edit</span>');
    expect(source).not.toContain('startInEdit={cimmichProfileEditOnOpen}');
    expect(source).toContain("field.fieldKey === 'gender_identity'");
    expect(source).toContain('icon={cimmichGenderIcon ?? mdiGenderMaleFemaleVariant}');
  });

  it('keeps Photos compact and makes Identity an operational maintenance workspace', async () => {
    const [source, navigation, workspace] = await Promise.all([
      readPersonProfile(),
      readFile('src/lib/components/cimmich/CimmichPersonIdentityNavigation.svelte', 'utf8'),
      readFile('src/lib/components/cimmich/person-identity-workspace.ts', 'utf8'),
    ]);

    expect(source).toContain('aria-label="Photo view options"');
    expect(source).toContain('aria-label="Thumbnail size"');
    expect(source).toContain('<option value="medium">Medium</option>');
    expect(source).not.toContain('<h2 class="text-xl font-semibold">Identity</h2>');
    expect(source).not.toContain('Review what currently defines this person');
    expect(source).toContain('Display photos');
    expect(source).toContain('Face photo');
    expect(source).toContain('Body photo');
    expect(source).toContain('Hero photo');
    expect(source).not.toContain('Identity workspaces');
    expect(navigation).toContain('aria-label="Identity sections"');
    expect(workspace).toContain("label: 'Overview'");
    expect(workspace).toContain("label: 'Face'");
    expect(workspace).toContain("label: 'Appearance'");
    expect(workspace).toContain("label: 'Display'");
    expect(workspace).toContain("label: 'Checks'");
    expect(navigation).not.toContain('lg:border-l');
    expect(workspace).toMatch(/id: 'presentation',[\s\S]+label: 'Photos'/);
    expect(source).toContain('aria-label="Display photo choices"');
    expect(workspace).toContain("{ id: 'prime', label: 'Core matching set'");
    expect(workspace).toMatch(/id: 'secondary',[\s\S]+label: 'Supporting Face evidence'/);
    expect(source).toContain('Use automatic');
    expect(source).toContain("'Not selected'");
    expect(source).toContain("cimmichIdentityFilter === 'candidates'");
    expect(source).toContain("cimmichPresentationPickerSlot === slotKind ? '' : slotKind");
    expect(source).toContain('Select from this person');
    expect(source).toContain('Drag · Wheel · Arrow keys');
    expect(source).toContain('startCimmichPresentationDrag');
    expect(source).toContain('zoomCimmichPresentation');
    expect(source).toContain('keyCimmichPresentation');
    expect(source).toContain("slotKind === 'face'");
    expect(source).toContain("'aspect-square h-[76%] rounded-full'");
    expect(source).toContain("'aspect-12/5 w-[94%] rounded-lg'");
    expect(source).toContain("media?.selectionMode === 'automatic'");
    expect(source).toContain('class="max-w-none"');
    expect(source).toContain('width: ${100 / crop.w}%');
    expect(source).toContain('height: auto');
    expect(source).not.toContain('Save framing');
    expect(source).not.toContain('Choose confirmed evidence below for the Face, Body, and Hero image.');
    expect(source).not.toContain("'Automatic'");
    expect(source).not.toContain('mt-4 grid gap-3 border-t');
    expect(source).toContain("label: 'Core'");
    expect(source).toContain("label: 'Supporting'");
    expect(source).toContain("label: 'All confirmed'");
    expect(source).not.toContain("label: 'Unclassified'");
    expect(source).not.toContain('Classification maintenance is incomplete:');
    expect(source).toContain('Supporting evidence only');
    expect(source).toContain('Supporting matcher reference');
    expect(source).toContain('face.matching_reference_tier');
    expect(source).toContain('Awaiting confirmation');
    expect(source).toContain('const cimmichAwaitingCountHint');
    expect(source).toContain('Math.max(data.identityReviewCount, cimmichPerson?.candidate_faces ?? 0)');
    expect(source).toContain('{waitingHint.toLocaleString()} waiting');
    expect(source).toContain("title: isNewMatch ? 'New matches' : 'Possible mistags'");
    expect(source).toContain('const cimmichCandidateReviewItems');
    expect(source).toContain('const cimmichPersonReviewItems');
    expect(source).toContain('const cimmichSamePhotoCollisionGroups');
    expect(source).toContain('Multiple matches in one photo');
    expect(source).toContain('Closest known People');
    expect(source).toContain('A collage or reflection can genuinely contain');
    expect(source).toContain('correction.preload(groups.flatMap');
    expect(source).toContain('getCimmichFaceMatchesBatch(');
    expect(source).toContain("schemaVersion: 'cimmich.face-owner-review-comparisons-batch.v1'");
    expect(source).toContain('Nothing changes until you press the inline action.');
    expect(source).toContain('correction.toggleComparison(item, match.person_id)');
    expect(source).toContain('Apply this manual correction to this Face?');
    expect(source).toContain('correction.closeComparison(item)');
    expect(source).toContain('bulk confirmation is');
    expect(source).toContain('samePhotoAcceptedCount');
    expect(source).toContain("'Correct…'");
    expect(source).toContain('Fix box later');
    expect(source).toContain('Not a face');
    expect(source).toContain('Resize box now');
    expect(source).toContain('cimmichIdentityCollisionAssetIds');
    expect(source).toContain('retainedCollisionAssetIds(');
    expect(source).toContain('candidateClaimId: candidate.identity_claim_id');
    expect(source).toContain('candidateEvidence');
    expect(source).toContain('fitIdentityReviewCrop(item)');
    expect(source).toMatch(
      /Matched against \{item\.suggestedPerson\.displayName\}’s current Core reference[\s\n]+library\./,
    );
    expect(source).toContain("decideCimmichIdentityCandidate(item.candidateClaimId, 'accept')");
    expect(source).toContain("decideCimmichIdentityCandidate(item.candidateClaimId, 'reject')");
    expect(source).toContain('candidateItems.map((item) => item.candidateClaimId)');
    expect(source).toContain('bulkAcceptCimmichPersonCandidates(');
    expect(source).not.toContain('Candidate identity claims');
    expect(source).toContain('auditTotals.untagged_match');
    expect(source).toContain('auditTotals.accepted_contradiction');
    expect(source).toContain('showMoreCimmichIdentityAudit');
    expect(source).toContain('Previously untagged');
    expect(source).toContain('Existing tag disputed');
    expect(source).toContain("section.startsWith('identity-audit:') || section === 'machine-suggestions' ? 50 : 20");
    expect(source).toContain("'Show 50 more'");
    expect(source).toContain('Show 20 more');
    expect(source).toContain('getCimmichIdentityFacesPage(personId, 120)');
    expect(source).toContain('cimmichExplore.getAssetsPage(personId)');
    expect(source).toContain('loadPersonAppearanceAssets(personId)');
    expect(source).toContain('cimmichAppearanceAssets.bodyConfirmed.toLocaleString()');
    expect(source).toContain('cimmichAppearanceAssets.bodyCandidate.toLocaleString()');
    expect(source).toContain('refreshCimmichIdentityAfterReview');
    expect(source).toContain('cimmichIdentityAuditProgress.completed');
    expect(source).toContain('Route.viewCimmichPersonAsset');
    expect(source).toContain("overlay: 'people'");
    expect(source).toContain('`Confirm ${cimmichPerson.display_name}`');
    expect(source).toContain('`Leave as ${item.assignedPerson?.displayName ?? cimmichPerson.display_name}`');
    expect(source).toContain('cimmichIdentityAuditCorrection.decision(item).label');
    expect(source).toMatch(
      /cimmichIdentityAuditCorrection\.decision\(item\)\.targetPersonId ===[\s\n]+cimmichPerson\.person_id[\s\S]+\? 'bg-immich-primary'[\s\n]+: 'bg-amber-600'/,
    );
    expect(source).toContain('onclick={() => void changeCimmichAuditPerson(item)}');
    expect(source).toContain('aria-label={`Choose a different person for ${item.filename}`}');
    expect(source).toContain("item.kind === 'untagged_match'");
    expect(source).toContain("[item.faceId]: ''");
    expect(source).toContain("{#if item.kind === 'accepted_contradiction'}");
    expect(source).toContain('aria-label={`Preview ${filename} with context`}');
    expect(source).toContain('size="full"');
    expect(source).toContain('data-testid="cimmich-large-photo-preview-canvas"');
    expect(source).toContain('data-testid="cimmich-preview-people-tags"');
    expect(source).toContain('Drag, scroll, or use the arrow keys to move around the photo.');
    expect(source).toContain('AssetMediaSize.Fullsize');
    expect(source).toContain('getCimmichAssetEvidence(sourceAssetId)');
    expect(source).not.toContain('Open full photo and machinery');
    expect(source).not.toContain('max-h-[75vh]');
    expect(source).not.toContain('onclick={() => void dismissCimmichAuditMatch(item)}');
    expect(source).toContain('aria-label="Likely identity matches"');
    expect(source).toContain('placeholder="Type a name"');
    expect(source).toContain('cimmichIdentityAuditCorrection.searchResults(item)');
    expect(source).toContain('<CimmichUnknownPersonAction');
    expect(source).toContain("'Someone else…'");
    expect(source).toContain("'Rescan Heads'");
    expect(source).toContain("await loadCimmichIdentityBucket('head')");
    expect(source).toContain('!cimmichIdentityServerBucket(cimmichIdentityFilter) && cimmichIdentityNextCursor');
    expect(source).not.toContain('border-red-200 bg-red-50/40');
    expect(source).not.toContain('bg-red-50/60');
    expect(source).not.toContain("'Confirm move'");
    expect(source).toContain('setCimmichPersonPresentation(cimmichPerson.person_id, slotKind');
    expect(source).toContain("chooseCimmichPresentation('face', face, 'face')");
    expect(source).toContain("chooseCimmichPresentation('body', face, 'body')");
    expect(source).toContain("chooseCimmichPresentation('hero', face, 'face')");
    expect(source).toContain('`Confirm not ${cimmichPerson.display_name}`');
    expect(source).toContain(
      "{ id: 'prime', label: 'Core', description: 'Selected to cover the person for matching' }",
    );
    expect(source).toContain("{ id: 'head', label: 'Head references', description: 'Face-derived, not manual tags' }");
    expect(source).toContain(
      "{ id: 'body', label: 'Body', description: 'Body-only until a Face or Head is confirmed' }",
    );
    expect(source).toContain(
      "{ id: 'presence', label: 'Presence', description: 'Known appearance without usable person geometry' }",
    );
    expect(source).toContain("label: 'Body review'");
    expect(source).toContain('accepted · ${cimmichAppearanceAssets.bodyCandidate.toLocaleString()} placement');
    expect(source).toMatch(
      /id: 'presence',[\s\S]+label: 'Presence',[\s\S]+cimmichIdentityCountLabel\(cimmichAppearanceAssets\.presenceTotal\)/,
    );
    expect(source).toContain("association_types.includes('body_candidate')");
    expect(source).toContain('Body placement needed');
    expect(source).toContain('pre-Cimmich placement candidates are shown together');
    expect(source).toContain('Faces retained as identity evidence but excluded from matching.');
    expect(source).toContain('No Face-derived Head references');
    expect(source).toContain("const hasBody = asset.association_types.includes('body')");
    expect(source).toContain('Review face');
    expect(source).not.toContain("id: 'face_only', label: 'Not used'");
    expect(source).not.toContain('<h2 class="text-xl font-semibold">Matching</h2>');
    expect(source).not.toContain('Tagged appearances');
    expect(source).not.toContain('Filter tagged appearances');
    expect(source).toContain("preparePersonPhotos(cimmichAssets, 'all', cimmichPhotoSort)");
    expect(source).toContain("{cimmichFuturePhotoDateCount === 1 ? 'date needs' : 'dates need'} review");
    expect(source).toContain('date.getTime() > Date.now()');
  });

  it('adds the shared selected-photo workspace without turning presence into face evidence', async () => {
    const source = await readPersonProfile();

    expect(source).toContain('<CimmichEntityMediaActions');
    expect(source).toContain('currentSubject={{');
    expect(source).toContain('subjectKind: cimmichPerson.subject_kind');
    expect(source).toContain('Maximum ${ENTITY_MEDIA_SELECTION_LIMIT} photos');
    expect(source).toContain('cimmichPhotoSelectionMode');
    expect(source).toContain('handleCimmichMediaCardClick(event, cimmichPhotoSelectionMode');
    expect(source).not.toContain("tagType: 'face'");
  });

  it('renders the primary photo page without waiting for matching or secondary profile data', async () => {
    const source = await readPersonProfile();
    const projectionStart = source.indexOf('const loadPersonProjection = async');
    const projectionEnd = source.indexOf('\n  $effect(() => {', projectionStart);
    const projection = source.slice(projectionStart, projectionEnd);

    expect(projectionStart).toBeGreaterThan(-1);
    expect(projectionEnd).toBeGreaterThan(projectionStart);
    expect(projection).not.toContain('getCimmichMachineSuggestions');
    expect(projection).not.toContain('await Promise.all([');
    expect(projection).not.toContain('getCimmichPeople(500)');
    expect(projection.indexOf('cimmichAssets = assetsPage.items')).toBeLessThan(
      projection.indexOf('loadPersonSecondaryProjections'),
    );
    expect(projection).toContain('void openCimmichIdentity(generation)');
    expect(source).toMatch(
      /const loadCimmichIdentityReviewData = async[\s\S]*await getCimmichMachineSuggestions\(80, personId\)/,
    );
    expect(source).toContain('void loadCimmichIdentityReviewData(personId, generation)');
    expect(source).not.toContain("if (cimmichIdentityFilter === 'all') {\n        cimmichIdentityFilter = 'prime';");
  });

  it('keeps rapid review decisions independent and coalesces their projection refresh', async () => {
    const source = await readPersonProfile();
    const finishStart = source.indexOf('const finishCimmichAuditDecision');
    const finishEnd = source.indexOf('const confirmCimmichAuditPerson', finishStart);
    const finish = source.slice(finishStart, finishEnd);

    expect(source).toContain('cimmichIdentityAuditSavingFaceIds');
    expect(source).toContain('beginCimmichIdentityAuditFaceSave(item.faceId)');
    expect(source).toContain('scheduleCimmichIdentityReviewRefresh');
    expect(source).toContain('}, 1200);');
    expect(finish).not.toContain('void Promise.all([');
    expect(source).toContain('getCimmichIdentityFacesPage(cimmichPerson.person_id, 1)');
  });

  it('retains the Person workspace and exact viewer return state', async () => {
    const source = await readPersonProfile();

    expect(source).toContain('readPersonWorkspaceCache<CachedPersonWorkspace>');
    expect(source).toContain('writePersonWorkspaceCache<CachedPersonWorkspace>');
    expect(source).toContain('cimmichEvidenceCoverage = cached.evidenceCoverage');
    expect(source).toContain('evidenceCoverage: cimmichEvidenceCoverage');
    expect(source).toContain('void untrack(() => loadCimmichEvidence(generation))');
    expect(source).toContain("url.searchParams.set('returnScroll'");
    expect(source).toContain("url.searchParams.set('identityFilter', identityFilter)");
    expect(source).toContain('onOpen={storeCimmichReturnScroll}');
  });

  it('loads the light Overview projection before any full Identity workspace', async () => {
    const source = await readPersonProfile();
    const openStart = source.indexOf('const openCimmichIdentity = async');
    const openEnd = source.indexOf('const openCimmichIdentityAt', openStart);
    const openIdentity = source.slice(openStart, openEnd);

    expect(openIdentity).toContain("if (cimmichIdentityFilter === 'overview')");
    expect(openIdentity).toContain('void untrack(() => loadCimmichEvidence(generation))');
    expect(openIdentity.indexOf('return;')).toBeLessThan(openIdentity.indexOf('loadPersonIdentityPrimary'));
    expect(source).toContain('void openCimmichIdentityAt(identitySectionDefaultFilter(section))');
  });

  it('promotes Connections and keeps Details free of add and administration rails', async () => {
    const source = await readPersonProfile();

    expect(source).toContain("cimmichMode === 'connections'");
    expect(source).toContain('aria-label="Connections"');
    expect(source).not.toContain('id="person-connections-heading"');
    expect(source).not.toContain("connected through {cimmichPerson.display_name}'s photo stories");
    expect(source).toContain(".filter((category) => category.category_kind === 'relationship')");
    expect(source).toContain(".join(' · ') || 'Connected person'");
    expect(source).toContain("{ id: 'person', label: 'People' }");
    expect(source).toContain("{ id: 'event', label: 'Events' }");
    expect(source).toContain("{ id: 'place', label: 'Places' }");
    expect(source).toContain("{ id: 'object', label: 'Things' }");
    expect(source).toContain('removeCimmichPersonConnection');
    expect(source).toContain('undoCimmichPersonConnection');
    expect(source).toContain('existing.directRelations = [...(existing.directRelations ?? []), ...relation]');
    expect(source).toContain('connection.directRelations.map((relation) => relation.relationId)');
    expect(source).toContain('aria-label={`Remove linked roles from ${connection.displayName}`}');
    expect(source).toContain('getCimmichPersonConnections(cimmichPerson.person_id)');
    expect(source.indexOf("{ id: 'person', label: 'People' }")).toBeLessThan(
      source.indexOf("{ id: 'event', label: 'Events' }"),
    );
    expect(source).not.toContain('aria-label="Details tools"');
    expect(source).not.toContain('cimmichQuickDetailActions');
    expect(source).toContain('<h2 class="text-lg font-semibold">Profile settings</h2>');
  });
});
