# Person Identity overview

Person profiles expose a read-only **Identity → Overview** view backed by
`GET /v1/people/:personId/evidence-coverage`.

The former top-level Evidence tab is retired. Existing `?mode=evidence` links
normalize to `?mode=identity`, whose default subview is Overview. Identity now owns five
jobs: Overview, Face, Appearance, Checks and Display. Face and Appearance retain
their own bounded filters; Checks separates New matches, Multiple in one photo
and Possible mistags.

The projection answers four bounded questions:

1. Which visible photos have accepted Face, standalone Head, Body or Presence
   evidence for this Person?
2. How much accepted Body evidence has persisted pose geometry?
3. Across which capture years and accepted Place/Event/Thing links is the
   Person currently observed?
4. Which privacy-visible photo best represents each capture year in a visual
   evolution timeline?
5. Which visible People and Pets most frequently share accepted active photos
   with this Person?

Bars report the fraction of accepted Person photos on which a channel is
observed. They are not identity confidence and are not combined into a
completeness score. A photo does not become defective because it lacks a Place,
Event, Thing, Head or Body observation.

## Authority

The endpoint:

- reads current accepted ledgers and visibility-filtered active assets;
- performs no model inference;
- creates no observation, claim, proposal, decision or repository row;
- does not change matching, reference buckets, Context, Immich or source media;
- never promotes a source suggestion automatically.

Candidate Face claims and future capture dates are shown as genuine review
work. Missing pose and standalone Head observations are neutral coverage notes.
Context counts are descriptive, not a demand to tag every photo.

## Timeline photos

The projection returns one photo for every represented capture year, bounded
to 120 distinct years. Selection happens after the current viewing-mode
ceiling. A best available accepted Face leads a year because it gives the
clearest Person-centred crop; when that year has no accepted Face, another
accepted Person photo is used as a full-photo fallback. Future-dated years stay
visible with an explicit date-review marker instead of silently distorting the
credible year range. Timeline cards display chronologically with each year's
photo count and open as ordinary Cimmich photos without forcing the machinery
overlay. Selection itself has no write or identity authority.

The Person profile and Overview use the same population: visible accepted
associations on active assets. Active assets are labelled **available photos**.
Retired catalogue rows remain in the provenance ledgers, but never inflate a
Person's current photo or Face totals. Archive Health reports source/inventory
problems directly; the UI never infers a missing file by subtracting two
different projections.

## People and pets

The Overview returns at most six other active People or Pets, ordered by the
number of distinct accepted active photos they share with the current Person.
Both subjects and preview media must pass the current viewing-mode ceiling.
The count is literal co-appearance frequency, not an inferred relationship or
identity-confidence score. Saved presentation media leads when available; a
visible shared photo is the bounded fallback.

## Privacy and performance

Every asset, Person and context read stays inside the current viewing-mode
ceiling. The response contains stable IDs, bounded aggregate counts, at most
six context rows per family and at most one timeline photo for each of 120
years, plus at most six co-appearing People or Pets; it contains no vectors or
source paths. The profile loads it only when
Identity Overview is opened and retains it for that mounted Person/visibility
generation.
