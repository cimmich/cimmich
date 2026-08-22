const routeContract = (pathname) => {
  if (pathname === "/v1/visibility/assets/presentable") {
    return {
      code: "PRESENTATION_ASSET_IDS_INVALID",
      message: "Photo presentation visibility input is invalid",
      method: "filterViewableAssetSourceIds",
    };
  }
  if (pathname === "/v1/visibility/assets/viewable") {
    return {
      code: "VIEWABLE_ASSET_IDS_INVALID",
      message: "Photo viewer visibility input is invalid",
      method: "filterViewableAssetSourceIds",
    };
  }
  if (pathname === "/v1/map/visible-assets") {
    return {
      code: "MAP_ASSET_IDS_INVALID",
      message: "Map visibility input is invalid",
      method: "filterVisibleMapAssetSourceIds",
    };
  }
  return null;
};

export const createAssetVisibilityRoutes =
  (repository, requireProjection, readJsonBody, sendJson) =>
  async (request, response, url, allowedOrigin) => {
    if (request.method !== "POST") return false;
    const contract = routeContract(url.pathname);
    if (!contract) return false;
    requireProjection("map_assets");
    const body = await readJsonBody(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "sourceAssetIds"
    ) {
      throw Object.assign(new Error(contract.message), {
        code: contract.code,
        statusCode: 400,
      });
    }
    sendJson(
      response,
      200,
      await repository[contract.method]({
        sourceAssetIds: body.sourceAssetIds,
      }),
      allowedOrigin,
    );
    return true;
  };
