import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const readPersonProfile = () => readFile('src/routes/(user)/cimmich/people/[personName]/+page.svelte', 'utf8');

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
    const source = await readPersonProfile();

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
    expect(source).toContain('aria-label="Identity tools"');
    expect(source).toContain("label: 'Face evidence'");
    expect(source).toContain("label: 'Appearance'");
    expect(source).toContain("label: 'Display'");
    expect(source).toContain("label: 'Review'");
    expect(source).toContain('lg:border-l');
    expect(source).not.toContain('overflow-x-auto pb-1');
    expect(source).toContain("{ id: 'presentation', label: 'Photos'");
    expect(source).toContain('aria-label="Display photo choices"');
    expect(source).toContain("{ id: 'prime', label: 'Core matching set'");
    expect(source).toContain("{ id: 'secondary', label: 'Supporting'");
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
    expect(source).toContain("title: 'New matches'");
    expect(source).toContain("title: 'Possible mistags'");
    expect(source).toContain('const cimmichCandidateReviewItems');
    expect(source).toContain('const cimmichPersonReviewItems');
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
    expect(source).toContain('cimmichIdentityAuditTotals.untagged_match');
    expect(source).toContain('cimmichIdentityAuditTotals.accepted_contradiction');
    expect(source).toContain('showMoreCimmichIdentityAudit');
    expect(source).toContain('Previously untagged');
    expect(source).toContain('Existing tag disputed');
    expect(source).toContain('Show 20 more');
    expect(source).toContain('getCimmichIdentityFacesPage(personId, 120)');
    expect(source).toContain('getCimmichPersonAssetsPage(personId, 120)');
    expect(source).toContain('refreshCimmichIdentityAfterReview');
    expect(source).toContain('cimmichIdentityAuditProgress.completed');
    expect(source).toContain('Route.viewCimmichPersonAsset');
    expect(source).toContain("overlay: 'people'");
    expect(source).toContain('getCimmichFaceMatches(item.faceId, 5)');
    expect(source).toContain('`Confirm ${cimmichPerson.display_name}`');
    expect(source).toContain("'Mark as Head'");
    expect(source).toContain("markAsHead && item.kind !== 'accepted_contradiction'");
    expect(source).toMatch(/\{#if item\.kind === 'accepted_contradiction'\}[\s\S]{0,800}'Mark as Head'/);
    expect(source).toContain("item.kind === 'untagged_match' ? 'col-span-2' : ''");
    expect(source).toContain("'Change to…'");
    expect(source).toContain("item.kind === 'untagged_match'");
    expect(source).toContain("[item.faceId]: ''");
    expect(source).toContain("{#if item.kind !== 'untagged_match'}");
    expect(source).not.toContain('onclick={() => void dismissCimmichAuditMatch(item)}');
    expect(source).toContain('aria-label="Likely identity matches"');
    expect(source).toContain('placeholder="Type a name"');
    expect(source).toContain('cimmichAuditPersonSearchResults(item)');
    expect(source).toContain("'Rescan Heads'");
    expect(source).toContain("await loadCimmichIdentityBucket('head')");
    expect(source).toContain('!cimmichIdentityServerBucket(cimmichIdentityFilter) && cimmichIdentityNextCursor');
    expect(source).not.toContain('border-red-200 bg-red-50/40');
    expect(source).not.toContain('bg-red-50/60');
    expect(source).toContain("setCimmichFaceBucket(personId, item.faceId, 'head')");
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
      "{ id: 'body', label: 'Body', description: 'Body-only evidence without a usable Face or Head' }",
    );
    expect(source).toContain(
      "{ id: 'presence', label: 'Presence', description: 'Known appearance without usable person geometry' }",
    );
    expect(source).toContain("{ id: 'body', label: 'Body', count: cimmichBodyAssets.length.toLocaleString() }");
    expect(source).toContain(
      "{ id: 'presence', label: 'Presence', count: cimmichPresenceAssets.length.toLocaleString() }",
    );
    expect(source).toContain("association_types.includes('body_candidate')");
    expect(source).toContain('Body placement needed');
    expect(source).toContain('Faces retained as identity evidence but excluded from matching.');
    expect(source).toContain('No Face-derived Head references');
    expect(source).toContain("association_types.includes('body') || association_types.includes('body_candidate')");
    expect(source).toContain('Review face');
    expect(source).not.toContain("id: 'face_only', label: 'Not used'");
    expect(source).not.toContain('<h2 class="text-xl font-semibold">Matching</h2>');
    expect(source).not.toContain('Tagged appearances');
    expect(source).not.toContain('Filter tagged appearances');
    expect(source).toContain("preparePersonPhotos(cimmichAssets, 'all', cimmichPhotoSort)");
    expect(source).toContain("{cimmichFuturePhotoDateCount === 1 ? 'date needs' : 'dates need'} review");
    expect(source).toContain('date.getTime() > Date.now()');
  });

  it('renders the primary photo page without waiting for matching or secondary profile data', async () => {
    const source = await readPersonProfile();
    const projectionStart = source.indexOf('const loadPersonProjection = async');
    const projectionEnd = source.indexOf('\n  $effect(() => {', projectionStart);
    const projection = source.slice(projectionStart, projectionEnd);

    expect(projectionStart).toBeGreaterThan(-1);
    expect(projectionEnd).toBeGreaterThan(projectionStart);
    expect(projection).not.toContain('getCimmichMachineSuggestions');
    expect(projection.indexOf('cimmichAssets = assetsPage.items')).toBeLessThan(
      projection.indexOf('] = await Promise.all(['),
    );
    expect(source).toMatch(
      /const openCimmichIdentity = async[\s\S]*await getCimmichMachineSuggestions\(80, personId\)/,
    );
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
    expect(source.indexOf("{ id: 'person', label: 'People' }")).toBeLessThan(
      source.indexOf("{ id: 'event', label: 'Events' }"),
    );
    expect(source).not.toContain('aria-label="Details tools"');
    expect(source).not.toContain('cimmichQuickDetailActions');
    expect(source).toContain('<h2 class="text-lg font-semibold">Profile settings</h2>');
  });
});
