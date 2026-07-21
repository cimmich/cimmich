# Context Entity V1

`cimmich.context-entity.v1` is the Basic, local, user-managed record contract
for Places, Objects and Events. It lives only in Cimmich's separate database.
It never writes the Immich database, source media or media metadata.

## Types

- Place: `point`, `area`, `route`, `unlocated`.
- Object: `vehicle`, `property`, `device`, `collectible`, `equipment`, `other`.
- Event: `trip`, `event`, `activity`, `life_period`.
- Date precision: `exact`, `month`, `year`, `approximate`, `unknown`.

Point, area and route geometry uses bounded latitude/longitude in normalized
JSON shapes. Routes contain 2–500 points. Only Places carry geometry. Place and
Event parents must be current same-kind entities. Parent cycles are rejected,
and a parent cannot be archived while it has a current child.

## Routes

- `GET|POST /v1/places`
- `GET|POST /v1/objects`
- `GET|POST /v1/events`
- `GET|PATCH /v1/{places|objects|events}/:entityId`
- `POST /v1/{family}/:entityId/assets:attach|detach`
- `POST /v1/{family}/:entityId/relations:attach|detach`
- `POST /v1/context/decisions/:decisionId/undo`

Every mutation requires `x-cimmich-actor` and a stable `commandId`. Asset and
relation commands contain 1–100 unique items. Exact replay returns the original
response identity; conflicting reuse fails. Its embedded detail projection is
always recomputed under the caller's current viewing mode, so replay cannot
leak a historical count or cover. Association changes are decision-scoped and
undoable until superseded. Archived records may be explicitly restored to
`active` or `hidden`; new records cannot start archived.

## Evidence meaning

Place asset roles are `captured_at`, `depicts`, `route_stop`, `manual`. Object
roles are `depicts`, `owned_at`, `manual`. Event roles are `direct`,
`route_stop`, `context`, `manual`.

Event relations may identify a Person `participant`, Pet `companion`, Place
`location` or related Object. `parent` is same-kind; `related` is general.
These records organize known context. They do not create Face, Body, Presence,
embedding or matching authority.

## Visibility

A user-created record with no asset links remains visible. Once assets are
linked, collection visibility, counts, cover selection, detail assets and
context-relation targets are calculated from the current cumulative Cimmich
viewing rank. A record whose linked assets are all hidden is absent rather than
leaking through a zero count or direct detail route. Native Immich remains
outside this boundary.
