export const createLocalAiRoutes =
  (localAi, readJsonBody, sendJson, sendBinary) =>
  async (request, response, url, allowedOrigin) => {
    if (!localAi) return false;
    if (request.method === "GET" && url.pathname === "/v1/local-ai") {
      sendJson(response, 200, localAi.status(), allowedOrigin);
      return true;
    }
    if (request.method === "POST" && url.pathname === "/v1/local-ai/jobs") {
      sendJson(
        response,
        202,
        await localAi.start(await readJsonBody(request)),
        allowedOrigin,
      );
      return true;
    }
    const jobMatch = url.pathname.match(
      /^\/v1\/local-ai\/jobs\/([0-9a-f-]+)$/i,
    );
    if (jobMatch && request.method === "GET") {
      sendJson(response, 200, localAi.get(jobMatch[1]), allowedOrigin);
      return true;
    }
    if (jobMatch && request.method === "DELETE") {
      sendJson(response, 200, localAi.cancel(jobMatch[1]), allowedOrigin);
      return true;
    }
    const artifactMatch = url.pathname.match(
      /^\/v1\/local-ai\/jobs\/([0-9a-f-]+)\/artifacts\/([^/]+)$/i,
    );
    if (artifactMatch && request.method === "GET") {
      sendBinary(
        response,
        await localAi.artifact({
          jobId: artifactMatch[1],
          token: decodeURIComponent(artifactMatch[2]),
        }),
        allowedOrigin,
      );
      return true;
    }
    return false;
  };
