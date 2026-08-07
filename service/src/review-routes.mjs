export const createReviewRoutes =
  (repository, requireProjection, readJsonBody, sendJson) =>
  async (request, response, url, allowedOrigin) => {
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
    return false;
  };
