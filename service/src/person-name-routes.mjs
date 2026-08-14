export const routePersonNames = async ({
  allowedOrigin,
  readJsonBody,
  repository,
  request,
  response,
  sendJson,
  url,
}) => {
  const setup = url.pathname.match(/^\/v1\/people\/([^/]+)\/setup$/);
  if (request.method === "GET" && setup) {
    sendJson(
      response,
      200,
      await repository.personSetup({
        personId: decodeURIComponent(setup[1]),
      }),
      allowedOrigin,
    );
    return true;
  }
  const aliases = url.pathname.match(/^\/v1\/people\/([^/]+)\/aliases$/);
  if (request.method === "POST" && aliases) {
    const body = await readJsonBody(request);
    sendJson(
      response,
      200,
      await repository.addPersonAlias({
        actorId: request.headers["x-cimmich-actor"],
        aliasKind: body.aliasKind,
        label: body.label,
        personId: decodeURIComponent(aliases[1]),
        sourceSubjectId: body.sourceSubjectId,
        sourceSystem: body.sourceSystem,
      }),
      allowedOrigin,
    );
    return true;
  }
  const removeAlias = url.pathname.match(
    /^\/v1\/people\/([^/]+)\/aliases\/([^/]+)\/remove$/,
  );
  if (request.method === "POST" && removeAlias) {
    sendJson(
      response,
      200,
      await repository.removePersonAlias({
        actorId: request.headers["x-cimmich-actor"],
        aliasId: decodeURIComponent(removeAlias[2]),
        personId: decodeURIComponent(removeAlias[1]),
      }),
      allowedOrigin,
    );
    return true;
  }
  const displayName = url.pathname.match(
    /^\/v1\/people\/([^/]+)\/display-name$/,
  );
  if (request.method === "POST" && displayName) {
    const body = await readJsonBody(request);
    sendJson(
      response,
      200,
      await repository.setPersonDisplayName({
        actorId: request.headers["x-cimmich-actor"],
        displayName: body.displayName,
        personId: decodeURIComponent(displayName[1]),
      }),
      allowedOrigin,
    );
    return true;
  }
  return false;
};
