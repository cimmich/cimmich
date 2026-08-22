import { createConnectionFactRoutes } from "./connection-fact-routes.mjs";

export const createMemoryGraphRoutes = (
  repository,
  requireProjection,
  readJsonBody,
  sendJson,
) => {
  const connectionFactRoutes = createConnectionFactRoutes(
    repository,
    requireProjection,
    readJsonBody,
    sendJson,
  );
  return async (request, response, url, allowedOrigin) => {
    if (
      request.method !== "GET" ||
      url.pathname !== "/v1/discover/memory-graph"
    ) {
      return connectionFactRoutes(request, response, url, allowedOrigin);
    }
    requireProjection("people");
    const result = await repository.discoverMemoryGraph({
      edgeLimit: url.searchParams.get("edgeLimit") || "72",
    });
    sendJson(
      response,
      200,
      { ...result, schemaVersion: "cimmich.memory-graph.v1" },
      allowedOrigin,
    );
    return true;
  };
};
