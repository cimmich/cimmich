const exploreFacetPath = "/v1/explore/facets";

const isExploreFacetRead = (request) =>
  request.method === "POST" &&
  String(request.url || "").split("?", 1)[0] === exploreFacetPath;

const attachProjectionSnapshotInvalidation = ({
  repository,
  request,
  response,
}) => {
  if (request.method === "GET" || isExploreFacetRead(request)) return;
  response.on("finish", () => {
    if (response.statusCode >= 400) return;
    repository.clearPeopleHotSnapshot?.();
    repository.clearExploreFacetSnapshot?.();
  });
};

const exploreFacetResponse = async ({
  readJsonBody,
  repository,
  request,
  requireProjection,
  url,
}) => {
  if (request.method !== "POST" || url.pathname !== exploreFacetPath) {
    return null;
  }
  const body = await readJsonBody(request);
  requireProjection(
    body?.scope?.kind === "person" ? "person_assets" : "people",
  );
  return repository.exploreFacets({
    filters: body.filters,
    scope: body.scope,
  });
};

const exploreFiltersFromSearchParams = (searchParams) => {
  const filters = {
    eventIds: searchParams.getAll("event"),
    labelIds: searchParams.getAll("label"),
    placeIds: searchParams.getAll("place"),
    privacyTiers: searchParams.getAll("privacy"),
    thingIds: searchParams.getAll("thing"),
  };
  return Object.values(filters).some((values) => values.length > 0)
    ? filters
    : undefined;
};

const personAssetRequestFromUrl = (encodedPersonId, searchParams) => {
  const pageSize = searchParams.has("pageSize")
    ? searchParams.get("pageSize")
    : null;
  const cursor = searchParams.get("cursor") || "";
  const exploreFilters = exploreFiltersFromSearchParams(searchParams);
  return {
    input: {
      associationType: searchParams.get("associationType"),
      cursor,
      ...(exploreFilters ? { exploreFilters } : {}),
      limit: searchParams.get("limit"),
      pageSize,
      personId: decodeURIComponent(encodedPersonId),
    },
    paginated: pageSize !== null || Boolean(cursor),
  };
};

export {
  attachProjectionSnapshotInvalidation,
  exploreFacetResponse,
  personAssetRequestFromUrl,
};
