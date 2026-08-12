const typedError = (code, message, statusCode) =>
  Object.assign(new Error(message), { code, statusCode });

export const handleOwnerSessionAuthRequest = async ({
  immichOwnerSession,
  request,
  response,
  surfacePolicy,
  url,
}) => {
  if (
    surfacePolicy !== "canonical" ||
    url.pathname !== "/_internal/owner-session"
  ) {
    return false;
  }
  if (request.method !== "GET" || !immichOwnerSession?.authorize) {
    throw typedError(
      "IMMICH_OWNER_SESSION_ROUTE_UNAVAILABLE",
      "Owner session route is unavailable",
      404,
    );
  }
  const decision = await immichOwnerSession.authorize(request.headers);
  response.writeHead(204, {
    "cache-control": "no-store",
    "x-cimmich-authenticated-principal": decision.principalId,
    "x-cimmich-owner-binding-state": decision.state,
  });
  response.end();
  return true;
};

export const enforceOwnerGatewayRequest = ({
  allowedOrigin,
  ownerGatewayRequired,
  request,
  surfacePolicy,
  url,
}) => {
  if (
    !ownerGatewayRequired ||
    surfacePolicy !== "canonical" ||
    url.pathname === "/health"
  ) {
    return;
  }
  const bindingState = String(
    request.headers["x-cimmich-owner-binding-state"] || "",
  );
  const authenticatedPrincipalId = String(
    request.headers["x-cimmich-authenticated-principal"] || "",
  ).trim();
  const bootstrapRoute =
    (request.method === "GET" &&
      ["/v1/onboarding/immich", "/v1/companion/status"].includes(
        url.pathname,
      )) ||
    (request.method === "POST" &&
      url.pathname === "/v1/onboarding/immich/connect");
  if (
    !authenticatedPrincipalId ||
    authenticatedPrincipalId.length > 200 ||
    !["bootstrap", "owner"].includes(bindingState) ||
    (bindingState === "bootstrap" && !bootstrapRoute)
  ) {
    throw typedError(
      "IMMICH_OWNER_SESSION_FORBIDDEN",
      "The configured Cimmich owner session is required",
      403,
    );
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method || "")) {
    const fetchSite = String(
      request.headers["sec-fetch-site"] || "",
    ).toLowerCase();
    if (!allowedOrigin || (fetchSite && fetchSite !== "same-origin")) {
      throw typedError(
        "IMMICH_OWNER_ORIGIN_REQUIRED",
        "Owner mutations require the exact product origin",
        403,
      );
    }
  }
};
