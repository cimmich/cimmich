export const createBulkAlbumOperationRoutes =
  (repository, readJsonBody, sendJson) =>
  async (request, response, url, allowedOrigin) => {
    if (
      request.method === "GET" &&
      url.pathname === "/v1/bulk-album-operations/active"
    ) {
      sendJson(
        response,
        200,
        await repository.activeBulkAlbumOperation(),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/bulk-album-operations"
    ) {
      const body = await readJsonBody(request, 256_000);
      sendJson(
        response,
        200,
        await repository.createBulkAlbumOperation({
          actorId: request.headers["x-cimmich-actor"],
          manifest: body.manifest,
          operationId: body.operationId,
          snapshotDigest: body.snapshotDigest,
          sourcePath: body.sourcePath,
        }),
        allowedOrigin,
      );
      return true;
    }
    const checkpointMatch = url.pathname.match(
      /^\/v1\/bulk-album-operations\/([^/]+)\/checkpoints$/,
    );
    if (request.method === "POST" && checkpointMatch) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.checkpointBulkAlbumOperation({
          actorId: request.headers["x-cimmich-actor"],
          albumCreated: body.albumCreated,
          albumId: body.albumId,
          albumName: body.albumName,
          assetIds: body.assetIds,
          batchSequence: body.batchSequence,
          commandId: body.commandId,
          operationId: decodeURIComponent(checkpointMatch[1]),
          sourcePath: body.sourcePath,
        }),
        allowedOrigin,
      );
      return true;
    }
    const checkpointUndoMatch = url.pathname.match(
      /^\/v1\/bulk-album-operations\/checkpoints\/([^/]+)\/undo$/,
    );
    if (request.method === "POST" && checkpointUndoMatch) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.undoBulkAlbumCheckpoint({
          actorId: request.headers["x-cimmich-actor"],
          checkpointId: decodeURIComponent(checkpointUndoMatch[1]),
          commandId: body.commandId,
        }),
        allowedOrigin,
      );
      return true;
    }
    const operationMatch = url.pathname.match(
      /^\/v1\/bulk-album-operations\/([^/]+)$/,
    );
    if (request.method === "GET" && operationMatch) {
      sendJson(
        response,
        200,
        await repository.bulkAlbumOperation({
          operationId: decodeURIComponent(operationMatch[1]),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (request.method === "PATCH" && operationMatch) {
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.setBulkAlbumOperationState({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          operationId: decodeURIComponent(operationMatch[1]),
          state: body.state,
        }),
        allowedOrigin,
      );
      return true;
    }
    return false;
  };
