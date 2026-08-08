export const matchPossiblePeopleRoutes = (pathname) => ({
  personCandidatesMatch: pathname.match(/^\/v1\/people\/([^/]+)\/candidates$/),
  personKnownClusterSuggestionsMatch: pathname.match(
    /^\/v1\/people\/([^/]+)\/possible-clusters$/,
  ),
  possiblePersonResolveMatch: pathname.match(
    /^\/v1\/possible-people\/([^/]+)\/resolve$/,
  ),
  possiblePersonUndoMatch: pathname.match(
    /^\/v1\/possible-people\/decisions\/([^/]+)\/undo$/,
  ),
});
