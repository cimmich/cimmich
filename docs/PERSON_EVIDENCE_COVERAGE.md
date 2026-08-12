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
4. Which accepted Face sources provide a strong, year-diverse starting point
   for cover selection or closer inspection?

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

## Source suggestions

Suggestions are accepted Face observations only. Cimmich chooses the strongest
visible source per capture year, ranks Core then Supporting references ahead of
unclassified/low-quality/head roles, excludes future-dated sources from the
front of the selection, and returns at most six. The profile labels these
Recognition examples and displays the selected set chronologically. Opening a
suggestion enters the existing machinery overlay; the suggestion itself has no
write authority.

The Person profile and Overview use the same population: visible accepted
associations on active assets. Active assets are labelled **available photos**.
Retired catalogue rows remain in the provenance ledgers, but never inflate a
Person's current photo or Face totals. Archive Health reports source/inventory
problems directly; the UI never infers a missing file by subtracting two
different projections.

## Privacy and performance

Every asset, Person and context read stays inside the current viewing-mode
ceiling. The response contains stable IDs, bounded aggregate counts and at most
six source/context rows per family; it contains no vectors or source paths. The
profile loads it only when Identity Overview is opened and retains it for that
mounted Person/visibility generation.
