import { describe, expect, it } from 'vitest';
import {
  CimmichServiceError,
  adoptCimmichLegacyPetDocument,
  attachCimmichManualSubjectTag,
  attachCimmichContextAssets,
  attachCimmichContextRelations,
  attachCimmichDocumentLinks,
  attachCimmichPetDocuments,
  correctCimmichBodyGeometry,
  correctCimmichFaceGeometry,
  createCimmichContextCommandId,
  createCimmichContextEntity,
  createCimmichDocumentCommandId,
  createCimmichEnhancedCommandId,
  createCimmichCommandId,
  createCimmichIdentityCorrectionCommandId,
  createCimmichManualPresenceCommandId,
  createCimmichManualSubjectTagCommandId,
  createCimmichObservationCorrectionCommandId,
  createCimmichPersonProfileCommandId,
  createCimmichPersonProfileItemId,
  createCimmichPersonMergeIntentTracker,
  createCimmichPersonMergeCommandId,
  createCimmichPersonCommandId,
  createCimmichViewingModeIntentSequence,
  createCimmichVisibilityCommandId,
  getCimmichHoldingMatchesBatch,
  getCimmichContextEntities,
  getCimmichContextEntity,
  getCimmichDocument,
  getCimmichDocumentContent,
  getCimmichEnhancedComponentStatus,
  getCimmichDocuments,
  getCimmichIdentityFacesPage,
  getCimmichIdentityCorrectionDiscovery,
  getCimmichIdentityCorrectionHistory,
  getCimmichLegacyPetDocumentLinks,
  getCimmichManualPresences,
  getCimmichManualSubjectTags,
  getCimmichPetDocuments,
  getCimmichPersonDetailsDisplay,
  getCimmichPersonDetailsDisplayDefaults,
  getCimmichPersonAssetsPage,
  getCimmichPersonByName,
  getCimmichSourcePack,
  getCimmichVisibilityObject,
  getCimmichVisibilityProjections,
  getCimmichVisibilityStatus,
  lockCimmichPrivateMode,
  createCimmichPerson,
  mergeCimmichPeople,
  markCimmichBodyNotBody,
  markCimmichFaceNotFace,
  importCimmichDocument,
  patchCimmichPersonDetailsDisplay,
  patchCimmichPersonDetailsDisplayDefaults,
  setCimmichManualPresence,
  setCimmichFaceIdentity,
  setCimmichViewingMode,
  searchCimmichSmart,
  referenceCimmichDocument,
  rejectCimmichAcceptedIdentity,
  replaceCimmichManualSubjectTag,
  resolveCimmichImmichPersonCluster,
  reviewCimmichSourcePack,
  rollbackCimmichSourcePack,
  setCimmichEventCover,
  detachCimmichPetDocuments,
  detachCimmichContextAssets,
  detachCimmichContextRelations,
  undoCimmichContextDecision,
  undoCimmichDocumentDecision,
  undoCimmichIdentityCorrection,
  undoCimmichLegacyPetDocumentAdoption,
  undoCimmichPetDocumentDecision,
  undoCimmichManualSubjectTag,
  undoCimmichObservationCorrection,
  undoCimmichImmichPersonClusterResolution,
  unlockCimmichPrivateMode,
  unmergeCimmichPeople,
  updateCimmichContextEntity,
  updateCimmichDocument,
  updateCimmichEnhancedComponent,
} from './cimmich.service';

describe('Cimmich Immich Person resolution owner contract', () => {
  it('binds resolve and Undo writes to the local owner actor', async () => {
    const resolution = {
      changed: true,
      cluster: {
        faceCount: 2,
        immichPersonId: 'immich-person-1',
        snapshotDigest: 'a'.repeat(64),
        sourceRevision: 'b'.repeat(64),
      },
      createdPerson: false,
      replayed: false,
      resolution: {
        action: 'existing_person',
        decisionId: 'decision-1',
        personId: 'person-1',
        resolutionId: 'resolution-1',
        state: 'resolved',
      },
      schemaVersion: 'cimmich.immich-person-resolution.v1',
      undo: { available: true, decisionId: 'decision-1' },
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(resolution))
      .mockResolvedValueOnce(
        Response.json({ ...resolution, resolution: { ...resolution.resolution, state: 'reverted' } }),
      );

    await resolveCimmichImmichPersonCluster('immich-person-1', {
      action: 'existing_person',
      commandId: 'immich-person.resolve.command-1',
      expectedSourceRevision: 'b'.repeat(64),
      personId: 'person-1',
      scope: {
        importPeople: true,
        includeHiddenPeople: false,
        mediaKinds: ['image', 'video'],
        providerMode: 'deferred',
        visibilities: ['timeline'],
      },
      snapshotDigest: 'a'.repeat(64),
    });
    await undoCimmichImmichPersonClusterResolution('decision-1', {
      commandId: 'immich-person.undo.command-1',
      scope: {
        importPeople: true,
        includeHiddenPeople: false,
        mediaKinds: ['image', 'video'],
        providerMode: 'deferred',
        visibilities: ['timeline'],
      },
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    });
    fetchMock.mockRestore();
  });
});

describe('Cimmich Enhanced owner client contract', () => {
  it('reads readiness and sends an exact revision-bound owner action', async () => {
    const status = {
      active: null,
      authority: { automaticIdentity: 'none', sourcePackActivation: 'governed_operator_review_only', training: 'none' },
      available: { artifactDigest: 'a'.repeat(64), version: '1.0.0' },
      coreAvailable: true,
      currentRevision: 2,
      enabled: false,
      rollbackAvailable: false,
      schemaVersion: 'cimmich.enhanced-component.v1',
      state: 'disabled',
      updateAvailable: true,
    } as const;
    const result = { ...status, changed: true, commandId: 'enhanced.enable.command-1', replayed: false };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json(result));

    await expect(getCimmichEnhancedComponentStatus()).resolves.toEqual(status);
    await expect(
      updateCimmichEnhancedComponent({
        action: 'enable',
        commandId: 'enhanced.enable.command-1',
        expectedRevision: 2,
      }),
    ).resolves.toEqual(result);

    expect(createCimmichEnhancedCommandId('enable')).toMatch(/^enhanced\.enable\.[0-9a-f-]{36}$/);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/operator/enhanced');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3101/v1/operator/enhanced');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ action: 'enable', commandId: 'enhanced.enable.command-1', expectedRevision: 2 }),
      method: 'POST',
    });
    fetchMock.mockRestore();
  });
});

describe('Cimmich SourcePack operator client contract', () => {
  it('binds minimized reads, human gate review and exact-predecessor rollback', async () => {
    const gateReceipt = {
      authorityScope: 'human-review',
      cohortDigest: 'a'.repeat(64),
      leakage: { passed: true, queryReferenceOverlap: 0 },
      matcherPolicy: {
        marginFloor: 0.08,
        policyVersion: 'cimmich-best-prime-v1',
        scoreFloor: 0.52,
        scorer: 'best_individual_prime',
      },
      metrics: {
        decisionPrecisionPercent: 99,
        knownCorrectCoveragePercent: 75,
        unknownFalseAcceptRatePercent: 1,
        verifiedUnknowns: 120,
      },
      packId: 'pack/one',
      schemaVersion: 'cimmich.source-pack-gate-evaluation.v1',
      status: 'passed',
      thresholds: {
        maximumUnknownFalseAcceptRatePercent: 2.5,
        minimumDecisionPrecisionPercent: 98,
        minimumVerifiedUnknowns: 100,
      },
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({}));

    await getCimmichSourcePack('pack/one');
    await reviewCimmichSourcePack('pack/one', gateReceipt);
    await rollbackCimmichSourcePack('pack/one', 'pack/zero');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:3101/v1/operator/face-matching/source-packs/pack%2Fone',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://127.0.0.1:3101/v1/operator/face-matching/source-packs/pack%2Fone/review',
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ gateReceipt }),
      method: 'POST',
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'http://127.0.0.1:3101/v1/operator/face-matching/source-packs/pack%2Fone/rollback',
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ expectedPredecessorPackId: 'pack/zero' }),
      method: 'POST',
    });
    fetchMock.mockRestore();
  });
});

describe('Cimmich viewing mode intent client contract', () => {
  it('sends a strictly increasing invocation sequence and preserves explicit sequences', async () => {
    const first = createCimmichViewingModeIntentSequence();
    const second = createCimmichViewingModeIntentSequence();
    expect(second).toBe(first + 1);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ applied: true, intentSequence: first, viewingMode: 'personal' }))
      .mockResolvedValueOnce(Response.json({ applied: true, intentSequence: second, viewingMode: 'standard' }));

    await setCimmichViewingMode('personal', first);
    await setCimmichViewingMode('standard', second);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ intentSequence: first, viewingMode: 'personal' }),
      method: 'POST',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ intentSequence: second, viewingMode: 'standard' }),
      method: 'POST',
    });
    fetchMock.mockRestore();
  });
});

describe('Cimmich Person merge replay client contract', () => {
  it('binds a stable command to merge and unmerge requests', async () => {
    const mergeCommandId = createCimmichPersonMergeCommandId('merge');
    const unmergeCommandId = createCimmichPersonMergeCommandId('unmerge');
    const result = {
      changed: true,
      commandId: mergeCommandId,
      mergeOperationId: 'merge_1',
      replayed: false,
      schemaVersion: 'cimmich.person-merge.v2',
      sourcePersonId: 'person_source',
      targetPersonId: 'person_target',
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json({ ...result, changed: false, commandId: unmergeCommandId }));

    await mergeCimmichPeople('person_source', 'person_target', mergeCommandId);
    await unmergeCimmichPeople('merge_1', unmergeCommandId);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        commandId: mergeCommandId,
        sourcePersonId: 'person_source',
        targetPersonId: 'person_target',
      }),
      method: 'POST',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ commandId: unmergeCommandId }),
      method: 'POST',
    });
    fetchMock.mockRestore();
  });

  it('retains one command across a lost response and rotates it only after completion or intent change', () => {
    let nextId = 0;
    const tracker = createCimmichPersonMergeIntentTracker((kind) => `${kind}-command-${(nextId += 1)}`);

    const firstMerge = tracker.mergeCommandId('person_source', 'person_target');
    expect(tracker.mergeCommandId('person_source', 'person_target')).toBe(firstMerge);
    expect(tracker.mergeCommandId('person_other', 'person_target')).not.toBe(firstMerge);

    const secondMerge = tracker.mergeCommandId('person_other', 'person_target');
    tracker.completeMerge('person_other', 'person_target');
    expect(tracker.mergeCommandId('person_other', 'person_target')).not.toBe(secondMerge);

    const firstUnmerge = tracker.unmergeCommandId('merge_1');
    expect(tracker.unmergeCommandId('merge_1')).toBe(firstUnmerge);
    expect(tracker.unmergeCommandId('merge_2')).not.toBe(firstUnmerge);

    const secondUnmerge = tracker.unmergeCommandId('merge_2');
    tracker.completeUnmerge('merge_2');
    expect(tracker.unmergeCommandId('merge_2')).not.toBe(secondUnmerge);
  });
});

describe('Cimmich selected Face identity client contract', () => {
  it('sends one exact existing or new Person selector', async () => {
    const result = {
      changed: true,
      claimId: 'claim_1',
      createdPerson: true,
      decisionId: 'decision_1',
      faceId: 'face/1',
      personId: 'person_new',
      personName: 'New Person',
      previousPersonId: null,
      state: 'accepted',
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json({ ...result, createdPerson: false, personId: 'person_1' }));

    await expect(setCimmichFaceIdentity('face/1', { newPersonName: 'New Person' })).resolves.toEqual(result);
    await expect(setCimmichFaceIdentity('face/1', { personId: 'person_1' })).resolves.toMatchObject({
      createdPerson: false,
      personId: 'person_1',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/faces/face%2F1/identity');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ newPersonName: 'New Person' }),
      method: 'POST',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ personId: 'person_1' }),
      method: 'POST',
    });
    fetchMock.mockRestore();
  });
});

describe('Cimmich Person creation client contract', () => {
  it('creates a native Person through the replay-safe supported route', async () => {
    const commandId = createCimmichPersonCommandId('create');
    const result = {
      changed: true,
      commandId,
      createdPerson: true,
      decisionId: 'decision_1',
      personId: 'person_new',
      personName: 'Audit Fresh Person',
      replayed: false,
      schemaVersion: 'cimmich.person-create.v1',
      source: { kind: 'cimmich_native', sourcePersonId: null },
      status: 'applied',
      subjectKind: 'person',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(result));

    await expect(createCimmichPerson(commandId, { newPersonName: 'Audit Fresh Person' })).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/people');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ commandId, newPersonName: 'Audit Fresh Person' }),
      method: 'POST',
    });
    fetchMock.mockRestore();
  });
});

describe('Cimmich accepted identity correction client contract', () => {
  it('binds replay-safe rejection, audited history and decision Undo', async () => {
    const result = {
      changed: true,
      claimId: 'claim/1',
      commandId: 'identity.reject.command-1',
      decisionId: 'decision/1',
      faceId: 'face/1',
      personId: 'person/1',
      replayed: false,
      state: 'rejected',
      undo: { decisionId: 'decision/1', eligible: true },
    } as const;
    const history = {
      claimId: 'claim/1',
      faceId: 'face/1',
      items: [],
      personId: 'person/1',
      schemaVersion: 'cimmich.identity-correction-history.v1',
    } as const;
    const discovery = {
      items: [],
      schemaVersion: 'cimmich.identity-correction-history.v1',
      scope: { kind: 'asset', sourceAssetId: 'asset/1' },
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json(history))
      .mockResolvedValueOnce(Response.json(discovery))
      .mockResolvedValueOnce(Response.json({ ...result, state: 'accepted', undoneDecisionId: 'decision/1' }));

    await rejectCimmichAcceptedIdentity('claim/1', 'identity.reject.command-1');
    await getCimmichIdentityCorrectionHistory('claim/1');
    await getCimmichIdentityCorrectionDiscovery({ sourceAssetId: 'asset/1' }, { limit: 1, undoEligible: true });
    await undoCimmichIdentityCorrection('decision/1', 'identity.undo.command-1');

    expect(createCimmichIdentityCorrectionCommandId('not this person')).toMatch(
      /^identity\.not-this-person\.[0-9a-f-]{36}$/,
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:3101/v1/identity-claims/claim%2F1/not-this-person',
      'http://127.0.0.1:3101/v1/identity-claims/claim%2F1/history',
      'http://127.0.0.1:3101/v1/identity-corrections?limit=1&sourceAssetId=asset%2F1&undoEligible=true',
      'http://127.0.0.1:3101/v1/identity-claims/decisions/decision%2F1/undo',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      commandId: 'identity.reject.command-1',
      note: 'Removed from Person in the Identity workspace',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ commandId: 'identity.undo.command-1' });
    fetchMock.mockRestore();
  });
});

describe('Cimmich Detailed observation correction client contract', () => {
  it('creates bounded correction command IDs', () => {
    expect(createCimmichObservationCorrectionCommandId('face geometry')).toMatch(
      /^observation\.face-geometry\.[0-9a-f-]{36}$/,
    );
  });

  it('binds exact geometry, rejection and decision Undo routes', async () => {
    const result = {
      changed: true,
      decisionId: 'decision_1',
      observation: {
        assetId: 'asset_1',
        decisionId: 'decision_1',
        observationId: 'face/1',
        observationKind: 'face',
        region: { h: 0.2, w: 0.1, x: 0.3, y: 0.4 },
        revision: 2,
        state: 'valid',
      },
      replayed: false,
      schemaVersion: 'cimmich.detailed-observation-correction.v1',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(Response.json(result)));
    const correctionInput = {
      commandId: 'observation.geometry.command-1',
      expectedDecisionId: null,
      expectedRevision: 1,
      region: result.observation.region,
    };
    const rejectionInput = {
      commandId: 'observation.reject.command-1',
      expectedDecisionId: 'decision_1',
      expectedRevision: 2,
    };

    await correctCimmichFaceGeometry('face/1', correctionInput);
    await correctCimmichBodyGeometry('body/1', correctionInput);
    await markCimmichFaceNotFace('face/1', rejectionInput);
    await markCimmichBodyNotBody('body/1', rejectionInput);
    await undoCimmichObservationCorrection('decision/1', 'observation.undo.command-1');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:3101/v1/faces/face%2F1/geometry',
      'http://127.0.0.1:3101/v1/bodies/body%2F1/geometry',
      'http://127.0.0.1:3101/v1/faces/face%2F1/not-face',
      'http://127.0.0.1:3101/v1/bodies/body%2F1/not-body',
      'http://127.0.0.1:3101/v1/observation-corrections/decisions/decision%2F1/undo',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(correctionInput);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual(rejectionInput);
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({
      commandId: 'observation.undo.command-1',
    });
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'POST')).toBe(true);
    fetchMock.mockRestore();
  });
});

describe('Cimmich typed manual subject tag client contract', () => {
  it('creates service-safe command IDs for typed tags', () => {
    expect(createCimmichManualSubjectTagCommandId('photo tag')).toMatch(/^manual-tag\.photo-tag\.[0-9a-f-]{36}$/);
  });

  it('binds exact typed attach, read, atomic replace and decision Undo routes', async () => {
    const tag = {
      decision: { decisionId: 'decision_1', state: 'active' },
      geometry: { h: 0.16, w: 0.1, x: 0.45, y: 0.42 },
      identityStatus: 'accepted',
      matchingStatus: 'waiting_for_provider',
      observationId: 'face_1',
      provenance: 'manual_user',
      subject: { displayName: 'Test Person', subjectId: 'person_1', subjectKind: 'person' },
      tagId: 'claim_1',
      tagType: 'face',
      undo: { decisionId: 'decision_1', eligible: true },
    } as const;
    const result = {
      assetId: 'asset_1',
      changed: true,
      replayed: false,
      schemaVersion: 'cimmich.typed-manual-subject-tag.v2',
      status: 'applied',
      tag,
    } as const;
    const projection = {
      assetId: 'asset_1',
      items: [tag],
      schemaVersion: 'cimmich.typed-manual-subject-tag.v2',
    } as const;
    const input = {
      commandId: 'manual-tag.photo-tag.command-1',
      region: tag.geometry,
      subjectId: 'person_1',
      subjectKind: 'person' as const,
      tagType: 'face' as const,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json(projection))
      .mockResolvedValueOnce(Response.json({ ...result, tag: { ...tag, tagType: 'head' } }))
      .mockResolvedValueOnce(Response.json({ ...result, status: 'reverted' }));

    await expect(attachCimmichManualSubjectTag('asset/1', input)).resolves.toEqual(result);
    await expect(getCimmichManualSubjectTags('asset/1')).resolves.toEqual(projection);
    await expect(
      replaceCimmichManualSubjectTag('claim/1', {
        ...input,
        commandId: 'manual-tag.photo-tag-replace.command-1',
        expectedDecisionId: 'decision_1',
        tagType: 'head',
      }),
    ).resolves.toMatchObject({ tag: { tagType: 'head' } });
    await expect(undoCimmichManualSubjectTag('decision/1', 'manual-tag.undo.command-1')).resolves.toMatchObject({
      status: 'reverted',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/assets/asset%2F1/manual-subject-tags');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(input);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3101/v1/assets/asset%2F1/manual-subject-tags');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://127.0.0.1:3101/v1/manual-subject-tags/claim%2F1/replace');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      commandId: 'manual-tag.photo-tag-replace.command-1',
      expectedDecisionId: 'decision_1',
      tagType: 'head',
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      'http://127.0.0.1:3101/v1/manual-subject-tags/decisions/decision%2F1/undo',
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      commandId: 'manual-tag.undo.command-1',
    });
    fetchMock.mockRestore();
  });
});

describe('Cimmich manual subject Presence client contract', () => {
  it('creates service-safe command IDs for a placed photo tag', () => {
    expect(createCimmichManualPresenceCommandId('photo tag')).toMatch(/^presence\.photo-tag\.[0-9a-f-]{36}$/);
  });

  it('sends stable subject IDs and normalized region geometry to the asset route', async () => {
    const result = {
      action: 'attach',
      association: null,
      assetId: 'asset_1',
      changed: true,
      decisionId: 'decision_1',
      replayed: false,
      schemaVersion: 'cimmich.manual-subject-presence.v1',
      status: 'applied',
      subject: { displayName: 'Test Person', subjectId: 'person_1', subjectKind: 'person' },
      undo: { decisionId: 'decision_1', eligible: true },
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(result));
    const input = {
      action: 'attach' as const,
      commandId: 'presence.photo-tag.command-1',
      geometry: { h: 0.16, kind: 'region' as const, w: 0.1, x: 0.45, y: 0.42 },
      subjectId: 'person_1',
      subjectKind: 'person' as const,
    };

    await expect(setCimmichManualPresence('asset/1', input)).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/assets/asset%2F1/manual-presences');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ body: JSON.stringify(input), method: 'POST' });
    fetchMock.mockRestore();
  });

  it('reads the asset-scoped Presence projection without client-side synthesis', async () => {
    const projection = {
      assetId: 'asset_1',
      items: [],
      schemaVersion: 'cimmich.manual-subject-presence.v1',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(projection));

    await expect(getCimmichManualPresences('asset_1')).resolves.toEqual(projection);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/assets/asset_1/manual-presences');
    fetchMock.mockRestore();
  });
});

describe('Cimmich Pet client contract', () => {
  it('creates service-safe, caller-stable command IDs', () => {
    const commandId = createCimmichCommandId('media attach');

    expect(commandId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/);
    expect(commandId).toContain('media-attach');
  });

  it('preserves typed service failure state for UI branching', () => {
    const error = new CimmichServiceError('Pet media projection changed', {
      code: 'PET_UNDO_SUPERSEDED',
      details: { assetId: 'asset_1' },
      status: 409,
    });

    expect(error).toMatchObject({
      code: 'PET_UNDO_SUPERSEDED',
      details: { assetId: 'asset_1' },
      name: 'CimmichServiceError',
      status: 409,
    });
  });

  it('reads the visibility-filtered Pet document projection', async () => {
    const projection = {
      items: [],
      petId: 'pet_1',
      schemaVersion: 'cimmich.pet-document.v1',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(projection));

    await expect(getCimmichPetDocuments('pet/1')).resolves.toEqual(projection);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/pets/pet%2F1/documents');
    fetchMock.mockRestore();
  });

  it('binds exact Pet document attach, detach and decision undo routes', async () => {
    const result = {
      changedAssetIds: ['asset_1'],
      decisionId: 'decision_1',
      documents: [],
      replayed: false,
      schemaVersion: 'cimmich.pet-document.v1',
      status: 'applied',
      unchangedAssetIds: [],
      undo: { eligible: true, token: 'undo_1' },
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json({ ...result, restoredAssetIds: ['asset_1'], status: 'reverted' }));
    const attachInput = {
      commandId: 'pet.document-attach.command-1',
      documents: [{ assetId: 'asset_1', documentKind: 'veterinary' as const, documentLabel: 'Annual check' }],
    };

    await attachCimmichPetDocuments('pet_1', attachInput);
    await detachCimmichPetDocuments('pet_1', 'pet.document-detach.command-1', ['asset_1']);
    await undoCimmichPetDocumentDecision('decision/1', 'pet.document-undo.command-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/pets/pet_1/documents:attach');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify(attachInput),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3101/v1/pets/pet_1/documents:detach');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ assetIds: ['asset_1'], commandId: 'pet.document-detach.command-1' }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://127.0.0.1:3101/v1/pet-documents/decisions/decision%2F1/undo');
    fetchMock.mockRestore();
  });
});

describe('Cimmich Person Profile client contract', () => {
  it('creates stable service-safe profile command and item IDs', () => {
    expect(createCimmichPersonProfileCommandId('save profile')).toMatch(/^profile\.save-profile\.[0-9a-f-]{36}$/);
    expect(createCimmichPersonProfileItemId()).toMatch(/^profile-item\.[0-9a-f-]{36}$/);
  });

  it('preserves typed Person Profile conflicts for UI branching', () => {
    const error = new CimmichServiceError('Command ID already used', {
      code: 'PERSON_PROFILE_COMMAND_CONFLICT',
      status: 409,
    });

    expect(error).toMatchObject({
      code: 'PERSON_PROFILE_COMMAND_CONFLICT',
      name: 'CimmichServiceError',
      status: 409,
    });
  });
});

describe('Cimmich Person Details display client contract', () => {
  it('reads the separate Details defaults and Person override projections', async () => {
    const defaults = {
      owner: { ownerId: 'local-primary', ownerKind: 'local_library' },
      schemaVersion: 'cimmich.person-details-display.v1',
      sections: [],
    } as const;
    const display = { ...defaults, personId: 'person_1' } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(defaults))
      .mockResolvedValueOnce(Response.json(display));

    await expect(getCimmichPersonDetailsDisplayDefaults()).resolves.toEqual(defaults);
    await expect(getCimmichPersonDetailsDisplay('person/1')).resolves.toEqual(display);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/people/profile-details-display-defaults');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3101/v1/people/person%2F1/profile-details-display');
    fetchMock.mockRestore();
  });

  it('writes exact ordered defaults and stable Person overrides with actor authority', async () => {
    const response = {
      commandId: 'profile.details-display.command-1',
      replayed: false,
      schemaVersion: 'cimmich.person-details-display.v1',
      status: 'applied',
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ ...response, defaults: { sections: [] } }))
      .mockResolvedValueOnce(Response.json({ ...response, display: { sections: [] } }));
    const sections = [{ order: 0, sectionKey: 'about' as const, visible: true }];
    const overrides = [{ sectionKey: 'about' as const, visibility: 'hide' as const }];

    await patchCimmichPersonDetailsDisplayDefaults(response.commandId, sections);
    await patchCimmichPersonDetailsDisplay('person_1', response.commandId, overrides);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ commandId: response.commandId, sections }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'PATCH',
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ commandId: response.commandId, overrides }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'PATCH',
    });
    fetchMock.mockRestore();
  });
});

describe('Cimmich Person projection page client contract', () => {
  it('projects the visibility-aware Person photo-history aggregate unchanged', async () => {
    const photoHistory = {
      futureCaptureDateCount: 41,
      maxCaptureTime: '2025-12-24T13:27:11+00:00',
      minCaptureTime: '2007-12-31T14:00:00+00:00',
      schemaVersion: 'cimmich.person-photo-history.v1',
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ person_id: 'person_1', photo_history: photoHistory }));

    await expect(getCimmichPersonByName('', 'person_1')).resolves.toMatchObject({ photo_history: photoHistory });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/people/person_1');
    fetchMock.mockRestore();
  });

  it('requests bounded asset pages and treats the cursor as opaque', async () => {
    const page = {
      items: [],
      nextCursor: 'next-cursor',
      pageSize: 120,
      schemaVersion: 'cimmich.person-projection-page.v1',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(page));

    await expect(getCimmichPersonAssetsPage('person/1', 120, 'opaque+/=')).resolves.toEqual(page);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:3101/v1/people/person%2F1/assets?pageSize=120&cursor=opaque%2B%2F%3D',
    );
    fetchMock.mockRestore();
  });

  it('requests the Review page at the 24-item UI boundary', async () => {
    const page = {
      items: [],
      nextCursor: null,
      pageSize: 24,
      schemaVersion: 'cimmich.person-projection-page.v1',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(page));

    await expect(getCimmichIdentityFacesPage('person_1')).resolves.toEqual(page);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/people/person_1/identity?pageSize=24');
    fetchMock.mockRestore();
  });

  it('requests Holding matches in one bounded ordered batch', async () => {
    const result = {
      items: [
        { faceId: 'face_1', matches: [] },
        { faceId: 'face_2', matches: [] },
      ],
      limitPerFace: 1,
      personId: 'person_1',
      requestedCount: 2,
      schemaVersion: 'cimmich.person-holding-match-batch.v1',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(result));

    await expect(getCimmichHoldingMatchesBatch('person_1', ['face_1', 'face_2'])).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/people/person_1/identity/matches:batch');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ faceIds: ['face_1', 'face_2'], limitPerFace: 1 }),
      method: 'POST',
    });
    fetchMock.mockRestore();
  });
});

describe('Cimmich Visibility client contract', () => {
  it('persists the non-secret device binding across full module reloads', async () => {
    const deviceStorageKey = 'cimmich.visibility.device-id.v1';
    const intentStorageKey = 'cimmich.visibility.intent-sequence.v1';
    const principalStorageKey = 'cimmich.visibility.principal-id.v1';
    globalThis.localStorage.removeItem(deviceStorageKey);
    globalThis.localStorage.removeItem(intentStorageKey);
    globalThis.localStorage.removeItem(principalStorageKey);
    const status = {
      capabilities: { album: false, asset: true, collection: false, entityProfile: false },
      forcedStandard: false,
      inactivitySeconds: 300,
      maxPrivateSessionSeconds: 900,
      principalBound: false,
      principalId: 'local-primary',
      privateAuthorized: false,
      privateConfigured: true,
      schemaVersion: 'cimmich.visibility.v1',
      surface: 'interactive',
      viewingMode: 'personal',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(Response.json(status)));

    vi.resetModules();
    const firstModule = await import('./cimmich.service');
    await firstModule.getCimmichVisibilityStatus();
    const firstDevice = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('x-cimmich-device-id');
    expect(firstDevice).toMatch(/^[0-9a-f-]{36}$/i);
    expect(globalThis.localStorage.getItem(deviceStorageKey)).toBe(firstDevice);
    expect(globalThis.localStorage.getItem(principalStorageKey)).toBe('local-primary');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstSequence = firstModule.createCimmichViewingModeIntentSequence();

    vi.resetModules();
    const reloadedModule = await import('./cimmich.service');
    await reloadedModule.getCimmichVisibilityStatus();
    const reloadedHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    const reloadedDevice = reloadedHeaders.get('x-cimmich-device-id');
    expect(reloadedDevice).toBe(firstDevice);
    expect(reloadedHeaders.get('x-cimmich-principal-id')).toBe('local-primary');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(reloadedModule.createCimmichViewingModeIntentSequence()).toBe(firstSequence + 1);
    globalThis.localStorage.removeItem(deviceStorageKey);
    globalThis.localStorage.removeItem(intentStorageKey);
    globalThis.localStorage.removeItem(principalStorageKey);
    fetchMock.mockRestore();
  });

  it('keeps principal, device and Private token in request-only runtime state', async () => {
    const status = {
      capabilities: { album: false, asset: true, collection: false, entityProfile: false },
      forcedStandard: false,
      inactivitySeconds: 300,
      maxPrivateSessionSeconds: 900,
      principalBound: false,
      principalId: 'local-primary',
      privateAuthorized: false,
      privateConfigured: true,
      schemaVersion: 'cimmich.visibility.v1',
      surface: 'interactive',
      viewingMode: 'standard',
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json({ ...status, principalBound: true }))
      .mockResolvedValueOnce(
        Response.json({
          expiresAt: '2026-07-16T12:15:00.000Z',
          privateSessionToken: 'opaque-test-token',
          schemaVersion: 'cimmich.visibility.v1',
          viewingMode: 'private',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          decisionId: null,
          explicit: false,
          objectId: 'asset_1',
          objectScope: 'asset',
          revision: 0,
          schemaVersion: 'cimmich.visibility.v1',
          visibilityTier: 'standard',
        }),
      )
      .mockResolvedValueOnce(Response.json({ ...status, principalBound: true }));

    await getCimmichVisibilityStatus();
    await unlockCimmichPrivateMode('test-password-from-user');
    await getCimmichVisibilityObject('asset', 'asset_1');
    await lockCimmichPrivateMode();

    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const boundHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    const privateHeaders = new Headers(fetchMock.mock.calls[3]?.[1]?.headers);
    expect(firstHeaders.get('x-cimmich-principal-id')).toBeNull();
    expect(firstHeaders.get('x-cimmich-device-id')).toBeTruthy();
    expect(boundHeaders.get('x-cimmich-principal-id')).toBe('local-primary');
    expect(boundHeaders.get('x-cimmich-device-id')).toBe(firstHeaders.get('x-cimmich-device-id'));
    expect(privateHeaders.get('x-cimmich-private-session')).toBe('opaque-test-token');
    expect(privateHeaders.get('x-cimmich-surface')).toBe('interactive');
    fetchMock.mockRestore();
  });

  it('creates service-safe visibility command IDs', () => {
    expect(createCimmichVisibilityCommandId('set asset')).toMatch(/^visibility\.set-asset\.[0-9a-f-]{36}$/);
  });

  it('reads the typed visibility projection registry without calling blocked routes', async () => {
    const registry = {
      items: [
        {
          assetDerived: true,
          coverageState: 'enforced',
          reasonCode: null,
          routeFamily: '/v1/search/smart',
          surfaceKey: 'smart_search',
        },
      ],
      allRegisteredSurfacesEnforced: true,
      schemaVersion: 'cimmich.visibility-projection.v1',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(registry));

    await expect(getCimmichVisibilityProjections()).resolves.toEqual(registry);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/visibility/projections');
    fetchMock.mockRestore();
  });
});

describe('Cimmich context entity and Basic Smart Search client contracts', () => {
  const detail = {
    assets: [],
    entity: {
      aliases: ['Harbour'],
      assetCount: 0,
      coverAssetId: null,
      dateEnd: null,
      datePrecision: 'unknown',
      dateStart: null,
      description: 'A synthetic place',
      displayName: 'Test Harbour',
      entityId: 'place_1',
      entityKind: 'place',
      geometry: null,
      parentEntityId: null,
      revision: 1,
      status: 'active',
      typeKind: 'unlocated',
    },
    relations: [],
    schemaVersion: 'cimmich.context-entity.v1',
  } as const;

  it('creates stable service-safe context command IDs', () => {
    expect(createCimmichContextCommandId('asset attach')).toMatch(/^context\.asset-attach\.[0-9a-f-]{36}$/);
  });

  it('binds native context collection, detail, create and update routes', async () => {
    const mutation = {
      commandId: 'context.create.command-1',
      decisionId: 'decision_1',
      detail,
      replayed: false,
      schemaVersion: 'cimmich.context-entity.v1',
      status: 'applied',
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ items: [detail.entity], schemaVersion: 'cimmich.context-entity.v1' }))
      .mockResolvedValueOnce(Response.json(detail))
      .mockResolvedValueOnce(Response.json(detail))
      .mockResolvedValueOnce(Response.json(mutation))
      .mockResolvedValueOnce(Response.json(mutation));
    const input = {
      aliases: ['Harbour'],
      commandId: 'context.create.command-1',
      description: 'A synthetic place',
      displayName: 'Test Harbour',
      geometry: null,
      typeKind: 'unlocated' as const,
    };

    await expect(
      getCimmichContextEntities('places', {
        includeArchived: true,
        includeHidden: true,
        limit: 25,
        query: 'test harbour',
      }),
    ).resolves.toEqual([detail.entity]);
    await expect(getCimmichContextEntity('places', 'place/1')).resolves.toEqual(detail);
    await expect(getCimmichContextEntity('places', 'place/1', { includeArchived: true })).resolves.toEqual(detail);
    await createCimmichContextEntity('places', input);
    await updateCimmichContextEntity('places', 'place/1', {
      commandId: 'context.update.command-1',
      description: 'Updated',
      expectedRevision: 3,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:3101/v1/places?limit=25&q=test+harbour&includeArchived=true&includeHidden=true',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3101/v1/places/place%2F1');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://127.0.0.1:3101/v1/places/place%2F1?includeArchived=true');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('http://127.0.0.1:3101/v1/places');
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify(input),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    });
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      body: JSON.stringify({ commandId: 'context.update.command-1', description: 'Updated', expectedRevision: 3 }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'PATCH',
    });
    fetchMock.mockRestore();
  });

  it('binds context media attach, detach and decision-scoped undo routes', async () => {
    const mutation = {
      changedAssetIds: ['asset_1'],
      commandId: 'context.asset.command-1',
      decisionId: 'decision_1',
      detail,
      replayed: false,
      schemaVersion: 'cimmich.context-entity.v1',
      status: 'applied',
      undo: { eligible: true, token: 'decision_1' },
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(mutation))
      .mockResolvedValueOnce(Response.json(mutation))
      .mockResolvedValueOnce(Response.json({ ...mutation, status: 'reverted' }));

    await attachCimmichContextAssets('events', 'event/1', 'context.asset.command-1', [
      { assetId: 'asset_1', associationKind: 'direct' },
    ]);
    await detachCimmichContextAssets('events', 'event/1', 'context.detach.command-1', ['asset_1']);
    await undoCimmichContextDecision('decision/1', 'context.undo.command-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/events/event%2F1/assets:attach');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3101/v1/events/event%2F1/assets:detach');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://127.0.0.1:3101/v1/context/decisions/decision%2F1/undo');
    fetchMock.mockRestore();
  });

  it('binds Event cover selection to the revision-safe Event route', async () => {
    const input = {
      commandId: 'context.event-cover.command-1',
      expectedRevision: 7,
      sourceAssetId: 'asset/source-1',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        changed: true,
        commandId: input.commandId,
        decisionId: 'decision_1',
        detail,
        replayed: false,
        schemaVersion: 'cimmich.event-cover.v1',
        status: 'applied',
        undo: { eligible: true, token: 'decision_1' },
      }),
    );

    await setCimmichEventCover('event/1', input);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/events/event%2F1/cover');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify(input),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    });
    fetchMock.mockRestore();
  });

  it('binds typed context relation attach and detach routes', async () => {
    const mutation = {
      commandId: 'context.relation.command-1',
      decisionId: 'decision_1',
      detail,
      replayed: false,
      schemaVersion: 'cimmich.context-entity.v1',
      status: 'applied',
      undo: { eligible: true, token: 'decision_1' },
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(mutation))
      .mockResolvedValueOnce(Response.json(mutation));

    await attachCimmichContextRelations('events', 'event_1', 'context.relation.command-1', [
      { relationKind: 'participant', targetId: 'person_1', targetKind: 'person' },
    ]);
    await detachCimmichContextRelations('events', 'event_1', 'context.relation-detach.command-1', ['relation_1']);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/events/event_1/relations:attach');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        commandId: 'context.relation.command-1',
        relations: [{ relationKind: 'participant', targetId: 'person_1', targetKind: 'person' }],
      }),
      method: 'POST',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3101/v1/events/event_1/relations:detach');
    fetchMock.mockRestore();
  });

  it('passes the query to native Basic Smart Search and preserves its interpretation', async () => {
    const result = {
      documentHasMore: false,
      documents: [
        {
          displayTitle: 'Audit Plain Document',
          documentId: 'document_1',
          documentKind: 'correspondence',
          documentLabel: null,
          effectiveVisibilityTier: 'standard',
          expiresOn: null,
          issuedOn: '2026-07-19',
          sourceFilename: 'audit-plain.txt',
          sourceKind: 'cimmich_file',
          subjectCount: 0,
        },
      ],
      hasMore: false,
      interpretation: {
        candidateSetTruncated: false,
        dateRange: null,
        mode: 'basic',
        selectors: [
          {
            entityKind: 'place',
            ids: ['place_1'],
            label: 'Test Harbour',
            matchKind: 'label',
            selectorKind: 'context',
          },
          {
            entityKind: 'document',
            ids: ['document_1'],
            label: 'Audit Plain Document',
            matchKind: 'label',
            selectorKind: 'document',
          },
        ],
        unresolvedTerms: ['sunset'],
      },
      items: [],
      query: 'Test Harbour sunset',
      schemaVersion: 'cimmich.smart-search-basic.v2',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(result));

    await expect(searchCimmichSmart(' Test Harbour sunset ', 42)).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/search/smart?q=Test+Harbour+sunset&limit=42');
    fetchMock.mockRestore();
  });
});

describe('Cimmich Generic Document client contract', () => {
  const document = {
    displayTitle: 'Synthetic lease',
    documentId: 'document_00000000000000000000000000000001',
    documentKind: 'lease',
    documentLabel: null,
    effectiveVisibilityTier: 'standard',
    expiresOn: null,
    issuedOn: '2026-01-02',
    preview: { available: true, disposition: 'inline', mimeType: 'application/pdf' },
    revision: 1,
    source: {
      assetId: null,
      byteSize: 4,
      contentSha256: 'a'.repeat(64),
      filename: 'synthetic.pdf',
      kind: 'cimmich_file',
      mimeType: 'application/pdf',
      sourceContentHash: null,
    },
    status: 'active',
    subjectCount: 0,
    supersededByDocumentId: null,
    supersedesDocumentId: null,
    updatedAt: '2026-07-17T00:00:00.000Z',
    visibilityTier: 'standard',
  } as const;

  it('creates service-safe Document command IDs and reads scoped collection/detail routes', async () => {
    expect(createCimmichDocumentCommandId('link existing')).toMatch(/^document\.link-existing\.[0-9a-f-]{36}$/);
    const detail = { ...document, links: [], schemaVersion: 'cimmich.document.v1' } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ items: [document], schemaVersion: 'cimmich.document.v1' }))
      .mockResolvedValueOnce(Response.json(detail));

    await expect(
      getCimmichDocuments({ documentKind: 'lease', subjectId: 'place_1', subjectKind: 'place' }),
    ).resolves.toEqual({ items: [document], schemaVersion: 'cimmich.document.v1' });
    await expect(getCimmichDocument(document.documentId)).resolves.toEqual(detail);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:3101/v1/documents?limit=200&documentKind=lease&subjectKind=place&subjectId=place_1',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`http://127.0.0.1:3101/v1/documents/${document.documentId}`);
    fetchMock.mockRestore();
  });

  it('binds reference, metadata update, typed links and decision Undo', async () => {
    const result = {
      changed: true,
      decisionId: 'decision_1',
      documentId: document.documentId,
      replayed: false,
      schemaVersion: 'cimmich.document.v1',
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json({ ...result, linkCount: 1 }))
      .mockResolvedValueOnce(Response.json({ ...result, undoneDecisionId: 'decision_1' }));
    const reference = {
      assetId: 'asset_1',
      commandId: 'document.reference.command-1',
      displayTitle: 'Synthetic lease',
      documentKind: 'lease' as const,
      sourceFilename: 'lease.pdf',
      visibilityTier: 'personal' as const,
    };

    await referenceCimmichDocument(reference);
    await updateCimmichDocument(document.documentId, {
      commandId: 'document.update.command-1',
      expiresOn: '2027-01-02',
    });
    await attachCimmichDocumentLinks(document.documentId, 'document.link.command-1', [
      { relationKind: 'applies_to', subjectId: 'place_1', subjectKind: 'place' },
    ]);
    await undoCimmichDocumentDecision('decision/1', 'document.undo.command-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3101/v1/documents/reference');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify(reference),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`http://127.0.0.1:3101/v1/documents/${document.documentId}/links:attach`);
    expect(fetchMock.mock.calls[3]?.[0]).toBe('http://127.0.0.1:3101/v1/document-decisions/decision%2F1/undo');
    fetchMock.mockRestore();
  });

  it('sends imported bytes outside JSON with exact base64url metadata', async () => {
    const result = {
      changed: true,
      decisionId: 'decision_1',
      documentId: document.documentId,
      replayed: false,
      schemaVersion: 'cimmich.document.v1',
    } as const;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(result));
    const file = new File(['test'], 'record.txt', { type: 'text/plain' });

    await importCimmichDocument(file, {
      commandId: 'document.import.command-1',
      displayTitle: 'Synthetic record',
      documentKind: 'correspondence',
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    const encoded = headers.get('x-cimmich-document-metadata')!;
    const padded = encoded
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    expect(JSON.parse(atob(padded))).toMatchObject({
      commandId: 'document.import.command-1',
      displayTitle: 'Synthetic record',
      documentKind: 'correspondence',
      sourceFilename: 'record.txt',
    });
    expect(init).toMatchObject({ body: file, method: 'POST' });
    expect(headers.get('content-type')).toBe('text/plain');
    fetchMock.mockRestore();
  });

  it('keeps local bytes no-store behind the content route and branches Immich-owned references by typed code', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('test', {
          headers: {
            'content-disposition': `inline; filename="record.txt"`,
            'content-type': 'text/plain',
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            code: 'DOCUMENT_CONTENT_IMMICH_OWNED',
            details: { assetId: 'asset_1' },
            error: 'Presented by source asset',
          },
          { status: 409 },
        ),
      );

    await expect(getCimmichDocumentContent(document.documentId)).resolves.toMatchObject({
      disposition: 'inline',
      filename: 'record.txt',
      kind: 'cimmich_file',
      mimeType: 'text/plain',
    });
    await expect(getCimmichDocumentContent(document.documentId)).resolves.toEqual({
      assetId: 'asset_1',
      kind: 'immich_asset',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:3101/v1/documents/${document.documentId}/content`);
    fetchMock.mockRestore();
  });

  it('binds the explicit legacy Pet candidate, adoption and decision Undo routes', async () => {
    const candidate = {
      adoptedDocumentId: null,
      adoptionId: null,
      assetId: 'asset_1',
      documentKind: 'vaccination',
      documentLabel: 'Annual vaccination',
      legacyAssociationId: 'petdoc/1',
      linkedAt: '2026-07-17T00:00:00.000Z',
      mediaKind: 'image',
      mimeType: 'image/jpeg',
      petId: 'pet_1',
      petName: 'Test Pet',
      state: 'available',
    } as const;
    const result = {
      adoptionId: 'adoption_1',
      changed: true,
      createdDocument: true,
      createdLink: true,
      decisionId: 'decision/1',
      documentId: document.documentId,
      legacyAssociationId: candidate.legacyAssociationId,
      reactivatedDocument: false,
      replayed: false,
      schemaVersion: 'cimmich.document-legacy-pet.v1',
    } as const;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ items: [candidate], schemaVersion: 'cimmich.document-legacy-pet.v1' }))
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json({ ...result, undoneDecisionId: result.decisionId }));

    await expect(getCimmichLegacyPetDocumentLinks({ includeAdopted: true, petId: 'pet/1' })).resolves.toEqual({
      items: [candidate],
      schemaVersion: 'cimmich.document-legacy-pet.v1',
    });
    await adoptCimmichLegacyPetDocument(candidate.legacyAssociationId, {
      commandId: 'document.legacy-pet-adopt.command-1',
      displayTitle: 'Test Pet annual vaccination',
      visibilityTier: 'personal',
    });
    await undoCimmichLegacyPetDocumentAdoption(result.decisionId, 'document.legacy-pet-undo.command-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:3101/v1/documents/legacy-pet-links?petId=pet%2F1&includeAdopted=true',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3101/v1/documents/legacy-pet-links/petdoc%2F1:adopt');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({
        commandId: 'document.legacy-pet-adopt.command-1',
        displayTitle: 'Test Pet annual vaccination',
        visibilityTier: 'personal',
      }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'http://127.0.0.1:3101/v1/document-legacy-pet-decisions/decision%2F1/undo',
    );
    fetchMock.mockRestore();
  });
});
