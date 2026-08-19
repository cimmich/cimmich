export const createAssetLabelRoutes =
  (repository, requireProjection, readJsonBody, sendJson) =>
  async (request, response, url, allowedOrigin) => {
    if (request.method === "GET" && url.pathname === "/v1/asset-labels") {
      requireProjection("person_assets");
      sendJson(
        response,
        200,
        await repository.assetLabels({
          kind: url.searchParams.get("kind"),
          limit: url.searchParams.get("limit"),
          query: url.searchParams.get("q"),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (request.method === "POST" && url.pathname === "/v1/asset-labels") {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.createAssetLabel({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          displayName: body.displayName,
          kind: body.kind,
        }),
        allowedOrigin,
      );
      return true;
    }
    const membershipMatch = url.pathname.match(
      /^\/v1\/asset-labels\/([^/]+)\/assets:(attach|detach)$/,
    );
    if (request.method === "POST" && membershipMatch) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.changeAssetLabelMembership({
          action: membershipMatch[2],
          actorId: request.headers["x-cimmich-actor"],
          assetIds: body.assetIds,
          commandId: body.commandId,
          labelId: decodeURIComponent(membershipMatch[1]),
        }),
        allowedOrigin,
      );
      return true;
    }
    const undoMatch = url.pathname.match(
      /^\/v1\/asset-label-decisions\/([^/]+)\/undo$/,
    );
    if (request.method === "POST" && undoMatch) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.undoAssetLabelDecision({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          decisionId: decodeURIComponent(undoMatch[1]),
        }),
        allowedOrigin,
      );
      return true;
    }
    return false;
  };
