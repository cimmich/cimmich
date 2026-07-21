# Basic Smart Search V1

`GET /v1/search/smart?q=...&limit=...` exposes
`cimmich.smart-search-basic.v1`. It is a deterministic, local, model-free
intersection over confirmed Cimmich truth.

Basic recognizes:

- current Person and Pet display names and aliases;
- current Place, Object and Event names, aliases and descriptions;
- ISO day (`YYYY-MM-DD`), month (`YYYY-MM`) and year (`YYYY`) ranges.

Recognized selector groups and the date range are intersected in PostgreSQL.
Asset visibility is applied before result rows or `hasMore` are calculated.
The response explains the selectors it used and returns unresolved terms rather
than pretending to understand unsupported semantics.

Candidate discovery is deterministic and bounded at 5,000 current entities.
`interpretation.candidateSetTruncated` reports that guard explicitly. Invalid
ISO-looking days or months fail with `SMART_SEARCH_DATE_INVALID` rather than
silently degrading into a different date interpretation. Searchable names,
aliases, descriptions and active capture time have dedicated local indexes.

The search never reads Person Profile values, private Notes, identity-model
inputs, source paths or Immich database metadata. Its safe asset response is
limited to stable Cimmich/source IDs, filename, capture time, media kind, MIME
type and dimensions.

Standard may later resolve unsupported visual/semantic terms with local models.
Guided may decompose or quality-check difficult queries through the optional
model-neutral instruction pack. Neither extension is required for Basic or
authorized to silently change user truth.
