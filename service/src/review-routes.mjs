export const createReviewRoutes =
  (repository, requireProjection, readJsonBody, sendJson) =>
  async (request, response, url, allowedOrigin) => {
    const personMatchRefreshMatch = url.pathname.match(
      /^\/v1\/people\/([^/]+)\/matching\/refresh$/,
    );
    if (request.method === "POST" && personMatchRefreshMatch) {
      requireProjection("person_review");
      sendJson(
        response,
        200,
        await repository.refreshPersonMatches({
          actorId: request.headers["x-cimmich-actor"],
          personId: decodeURIComponent(personMatchRefreshMatch[1]),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/archive-integrity/missing-files"
    ) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.archiveIntegrityMissingFiles({
          limit: url.searchParams.get("limit"),
          offset: url.searchParams.get("offset"),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/archive-integrity/missing-files:remove"
    ) {
      requireProjection("asset_detail");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.archiveIntegrityRemoveMissingFiles({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          expectedCount: body.expectedCount,
          selection: body.selection,
          sourceId: body.sourceId,
          sourceAssetIds: body.sourceAssetIds,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/archive-integrity/exact-duplicates"
    ) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.exactDuplicates({
          limit: url.searchParams.get("limit"),
          offset: url.searchParams.get("offset"),
          sourceAssetId: url.searchParams.get("sourceAssetId"),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/archive-integrity/duplicate-status"
    ) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.archiveIntegrityDuplicateStatus({
          sourceAssetIds: url.searchParams.get("sourceAssetIds"),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/archive-integrity/backup-targets"
    ) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.archiveIntegrityBackupTargets(),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/archive-integrity/database-backups"
    ) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.archiveIntegrityDatabaseBackupStatus(),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "PUT" &&
      url.pathname === "/v1/archive-integrity/database-backups/policy"
    ) {
      requireProjection("asset_detail");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.archiveIntegritySetDatabaseBackupPolicy({
          actorId: request.headers["x-cimmich-actor"],
          destinationIds: body.destinationIds,
          frequency: body.frequency,
          retentionCount: body.retentionCount,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/archive-integrity/database-backups/runs"
    ) {
      requireProjection("asset_detail");
      const body = await readJsonBody(request);
      sendJson(
        response,
        202,
        await repository.archiveIntegrityStartDatabaseBackup({
          actorId: request.headers["x-cimmich-actor"],
          destinationIds: body.destinationIds,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/archive-integrity/database-backups/checks"
    ) {
      requireProjection("asset_detail");
      const body = await readJsonBody(request);
      sendJson(
        response,
        202,
        await repository.archiveIntegrityCheckLatestDatabaseBackup({
          destinationIds: body.destinationIds,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/archive-integrity/backup-scans"
    ) {
      requireProjection("asset_detail");
      const body = await readJsonBody(request);
      sendJson(
        response,
        202,
        await repository.archiveIntegrityStartBackupScan({
          targetId: body.targetId,
        }),
        allowedOrigin,
      );
      return true;
    }
    const backupScanMatch = url.pathname.match(
      /^\/v1\/archive-integrity\/backup-scans\/([^/]+)$/,
    );
    if (request.method === "GET" && backupScanMatch) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.archiveIntegrityBackupScan({
          id: decodeURIComponent(backupScanMatch[1]),
          kind: url.searchParams.get("kind"),
          limit: url.searchParams.get("limit"),
          offset: url.searchParams.get("offset"),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/archive-integrity/backup-targets"
    ) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.archiveIntegrityBackupTargets(),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/archive-integrity/backup-scans"
    ) {
      requireProjection("asset_detail");
      const body = await readJsonBody(request);
      sendJson(
        response,
        202,
        await repository.archiveIntegrityStartBackupScan({
          targetId: body.targetId,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/archive-integrity/backup-proof"
    ) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.archiveIntegrityBackupProof({
          sourceAssetIds: url.searchParams.get("sourceAssetIds"),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/archive-integrity/source-evidence"
    ) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.archiveIntegritySourceEvidence({
          sourceAssetIds: url.searchParams.get("sourceAssetIds"),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/assets/corrections:batch"
    ) {
      requireProjection("asset_detail");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.assetCorrectionDetails({ assetIds: body.assetIds }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/review/photo-details"
    ) {
      requireProjection("asset_detail");
      sendJson(
        response,
        200,
        await repository.assetCorrectionReview({
          kind: url.searchParams.get("kind"),
          limit: url.searchParams.get("limit"),
          offset: url.searchParams.get("offset"),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/assets/corrections/rotation:set"
    ) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.setAssetRotations({
          actorId: request.headers["x-cimmich-actor"],
          changes: body.changes,
          commandId: body.commandId,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/assets/corrections/rotation"
    ) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.rotateAssets({
          actorId: request.headers["x-cimmich-actor"],
          assetIds: body.assetIds,
          commandId: body.commandId,
          direction: body.direction,
        }),
        allowedOrigin,
      );
      return true;
    }
    const captureMatch = url.pathname.match(
      /^\/v1\/assets\/([^/]+)\/corrections\/capture-time$/,
    );
    if (request.method === "POST" && captureMatch) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.setAssetCaptureTime({
          actorId: request.headers["x-cimmich-actor"],
          assetId: decodeURIComponent(captureMatch[1]),
          captureTime: body.captureTime,
          commandId: body.commandId,
        }),
        allowedOrigin,
      );
      return true;
    }
    const placeMatch = url.pathname.match(
      /^\/v1\/assets\/([^/]+)\/corrections\/place$/,
    );
    if (request.method === "POST" && placeMatch) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.setAssetPlace({
          actorId: request.headers["x-cimmich-actor"],
          assetId: decodeURIComponent(placeMatch[1]),
          commandId: body.commandId,
          placeEntityId: body.placeEntityId,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/assets/corrections/undo"
    ) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.undoAssetCorrections({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          decisionIds: body.decisionIds,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/review/machine-suggestions"
    ) {
      requireProjection("machine_suggestions");
      sendJson(
        response,
        200,
        {
          items: await repository.machineSuggestions({
            leadPersonId: url.searchParams.get("leadPersonId"),
            limit: url.searchParams.get("limit"),
          }),
        },
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/review/identity-audit"
    ) {
      requireProjection("machine_suggestions");
      sendJson(
        response,
        200,
        { run: await repository.identityAuditLatest() },
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/review/identity-audit"
    ) {
      requireProjection("machine_suggestions");
      const body = await readJsonBody(request);
      sendJson(
        response,
        202,
        {
          run: await repository.startIdentityAudit({
            actorId: request.headers["x-cimmich-actor"],
            ...(body.detectorConfigDigest
              ? { detectorConfigDigest: body.detectorConfigDigest }
              : {}),
          }),
        },
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/review/identity-audit/leads"
    ) {
      requireProjection("machine_suggestions");
      sendJson(
        response,
        200,
        await repository.identityAuditLeads(),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/review/identity-audit/items"
    ) {
      requireProjection("machine_suggestions");
      sendJson(
        response,
        200,
        await repository.identityAuditItems({
          kind: url.searchParams.get("kind"),
          limit: url.searchParams.get("limit"),
          offset: url.searchParams.get("offset"),
          personId: url.searchParams.get("personId"),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/review/identity-audit/items/dismiss:batch"
    ) {
      requireProjection("machine_suggestions");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.dismissIdentityAuditItems({
          actorId: request.headers["x-cimmich-actor"],
          items: body.items,
        }),
        allowedOrigin,
      );
      return true;
    }
    const dismissMatch = url.pathname.match(
      /^\/v1\/review\/identity-audit\/items\/(untagged_match|accepted_contradiction)\/([^/]+)\/dismiss$/,
    );
    if (request.method === "POST" && dismissMatch) {
      requireProjection("machine_suggestions");
      sendJson(
        response,
        200,
        await repository.dismissIdentityAuditItem({
          actorId: request.headers["x-cimmich-actor"],
          faceId: decodeURIComponent(dismissMatch[2]),
          kind: dismissMatch[1],
        }),
        allowedOrigin,
      );
      return true;
    }
    const personEvidenceCoverageMatch = url.pathname.match(
      /^\/v1\/people\/([^/]+)\/evidence-coverage$/,
    );
    if (request.method === "GET" && personEvidenceCoverageMatch) {
      requireProjection("people");
      sendJson(
        response,
        200,
        await repository.personEvidenceCoverage({
          personId: decodeURIComponent(personEvidenceCoverageMatch[1]),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/faces/matches:batch"
    ) {
      requireProjection("asset_evidence");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.faceReviewComparisonsBatch({
          faceIds: body.faceIds,
          limitPerFace: body.limitPerFace,
        }),
        allowedOrigin,
      );
      return true;
    }
    return false;
  };
