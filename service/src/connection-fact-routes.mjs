export const createConnectionFactRoutes =
  (repository, requireProjection, readJsonBody, sendJson) =>
  async (request, response, url, allowedOrigin) => {
    if (
      request.method === "GET" &&
      url.pathname === "/v1/connection-modifiers"
    ) {
      requireProjection("people");
      sendJson(
        response,
        200,
        {
          items: await repository.connectionModifiers(),
          schemaVersion: "cimmich.connection-facts.v4",
        },
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/connection-modifiers"
    ) {
      requireProjection("people");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.createConnectionModifier({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          input: body,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/connection-types") {
      requireProjection("people");
      sendJson(
        response,
        200,
        {
          items: await repository.connectionTypes({
            targetKind: url.searchParams.get("targetKind") || "",
          }),
          schemaVersion: "cimmich.connection-facts.v4",
        },
        allowedOrigin,
      );
      return true;
    }
    if (request.method === "POST" && url.pathname === "/v1/connection-types") {
      requireProjection("people");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.createConnectionType({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          input: body,
        }),
        allowedOrigin,
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/connection-hubs:record"
    ) {
      requireProjection("people");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.recordConnectionHub({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          input: body,
        }),
        allowedOrigin,
      );
      return true;
    }
    const personFacts = url.pathname.match(
      /^\/v1\/people\/([^/]+)\/connection-facts$/,
    );
    if (personFacts && request.method === "GET") {
      requireProjection("people");
      sendJson(
        response,
        200,
        await repository.personConnectionFacts({
          personId: decodeURIComponent(personFacts[1]),
        }),
        allowedOrigin,
      );
      return true;
    }
    if (personFacts && request.method === "POST") {
      requireProjection("people");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.recordConnectionFact({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          input: body,
          personId: decodeURIComponent(personFacts[1]),
        }),
        allowedOrigin,
      );
      return true;
    }
    const retractFact = url.pathname.match(
      /^\/v1\/people\/([^/]+)\/connection-facts\/([^/]+):retract$/,
    );
    if (retractFact && request.method === "POST") {
      requireProjection("people");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.retractConnectionFact({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          factId: decodeURIComponent(retractFact[2]),
          personId: decodeURIComponent(retractFact[1]),
        }),
        allowedOrigin,
      );
      return true;
    }
    const dismissSuggestion = url.pathname.match(
      /^\/v1\/people\/([^/]+)\/connection-suggestions\/([^/]+):dismiss$/,
    );
    if (dismissSuggestion && request.method === "POST") {
      requireProjection("people");
      const body = await readJsonBody(request);
      sendJson(
        response,
        200,
        await repository.dismissConnectionSuggestion({
          actorId: request.headers["x-cimmich-actor"],
          commandId: body.commandId,
          personId: decodeURIComponent(dismissSuggestion[1]),
          suggestion: decodeURIComponent(dismissSuggestion[2]),
        }),
        allowedOrigin,
      );
      return true;
    }
    return false;
  };
