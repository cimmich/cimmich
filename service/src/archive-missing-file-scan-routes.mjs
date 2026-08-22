export const createArchiveMissingFileScanRoutes =
  ({ inventory, inventoryScan, requireProjection, sendJson }) =>
  async (_request, response, url, allowedOrigin) => {
    if (_request.method !== "GET" && _request.method !== "POST") {
      return false;
    }
    if (url.pathname !== "/v1/archive-integrity/missing-files/scan") {
      return false;
    }
    requireProjection("asset_detail");
    if (!inventory) {
      throw Object.assign(new Error("Immich inventory is unavailable"), {
        code: "IMMICH_INVENTORY_UNAVAILABLE",
        statusCode: 503,
      });
    }
    if (_request.method === "GET") {
      sendJson(
        response,
        200,
        {
          inventory: await inventory.status(),
          scan: inventoryScan.status(),
          schemaVersion: "cimmich.archive-missing-file-scan.v1",
        },
        allowedOrigin,
      );
      return true;
    }
    sendJson(
      response,
      202,
      {
        schemaVersion: "cimmich.archive-missing-file-scan.v1",
        ...inventoryScan.start(),
      },
      allowedOrigin,
    );
    return true;
  };
