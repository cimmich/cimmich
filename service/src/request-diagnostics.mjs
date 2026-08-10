export const safeRouteFamily = (requestUrl) => {
  try {
    const parts = new URL(requestUrl || "/", "http://cimmich.local").pathname
      .split("/")
      .filter(Boolean);
    return parts[0] === "v1"
      ? `v1.${String(parts[1] || "root").replace(/[^a-z0-9_-]/gi, "")}`
      : String(parts[0] || "root").replace(/[^a-z0-9_-]/gi, "");
  } catch {
    return "invalid";
  }
};

export const observeRequestTiming = ({
  request,
  response,
  requestId,
  startedAt,
  thresholdMs = 250,
}) => {
  response.on("finish", () => {
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    if (response.statusCode >= 400 || durationMs < thresholdMs) return;
    console.info(
      JSON.stringify({
        code: "CIMMICH_REQUEST_SLOW",
        durationMs,
        method: request.method || "UNKNOWN",
        requestId,
        routeFamily: safeRouteFamily(request.url),
        statusCode: response.statusCode,
      }),
    );
  });
};
