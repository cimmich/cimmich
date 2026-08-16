# Cimmich product architecture

This guide maps the user experience to the code, data and authority boundaries
that implement it. It is the engineering companion to the
[Cimmich user guide](USER_GUIDE.md), not a replacement for feature-specific
contracts or release receipts.

> [!IMPORTANT]
> This document follows the **current development source** (migration-ledger
> schema 140/patch 1 at the time of this reconciliation). The latest named
> public release is Community Preview 9 at schema 130/patch 1. Release claims
> belong to the named release and its changelog, not to an arbitrary checkout.

## Architectural promise

Cimmich is an additive companion around a supported Immich installation:

```text
Immich account + source media
          │ supported authenticated reads
          ▼
neutral inventory and stable content identity
          │
          ├── owner decisions and typed evidence ──► Cimmich PostgreSQL
          ├── imported Documents ─────────────────► Cimmich document store
          └── optional local providers ───────────► versioned observations
                                                     │
                                                     ▼
                                              bounded read projections
                                                     │
                                                     ▼
                                               Cimmich web experience
```

The direction matters. Immich owns authentication, original media and its own
database. Cimmich reads through supported interfaces, stores its own durable
knowledge and renders derived projections. It does not make its database a
shadow write path into Immich.

## Non-negotiable laws

Every capability must preserve these laws:

1. **Source media is immutable.** Original bytes and sidecars are never a
   Cimmich write target.
2. **Databases stay separate.** Cimmich has no cross-database foreign keys and
   does not directly mutate Immich tables.
3. **Observation is not authority.** Detectors, embeddings, scores, clusters
   and recommendations cannot accept an identity.
4. **Evidence types remain truthful.** Face, Head, Body and Presence are not
   interchangeable shortcuts.
5. **Visibility is applied before projection.** Filtering after names, counts,
   covers or media are assembled is a leak.
6. **Commands are replay-safe.** Consequential writes use a stable command ID,
   reject changed reuse and record a decision/provenance receipt.
7. **Undo is scoped.** Undo reverses the still-current effect of its decision;
   it does not restore an unrelated historical snapshot.
8. **Similarity is not deletion proof.** Complete-file digests control exact
   claims. Visual similarity remains a lead.
9. **Derived state is rebuildable.** Caches, candidates and read projections
   do not outrank accepted owner truth.
10. **Optional machinery is replaceable.** Providers and runners obey bounded,
    versioned contracts and do not become product authority.

The normative detail lives in
[source-media immutability](SOURCE_MEDIA_IMMUTABILITY.md),
[privacy boundary](PRIVACY_BOUNDARY.md),
[migration operations](MIGRATION_OPERATIONS.md) and the feature contracts in
this directory.

## Repository map

| Path                                                           | Responsibility                                                                                   |
| :------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| `service/src/server.mjs`                                       | HTTP composition, authentication boundary and top-level route registration.                      |
| `service/src/*-routes.mjs`                                     | Thin request validation and response mapping for a domain.                                       |
| `service/src/repository.mjs`                                   | Legacy central repository seam; new bounded domain repositories should live beside their domain. |
| `service/src/*repository*.mjs`                                 | Domain reads/writes, visibility admission and transactional command handling.                    |
| `service/src/immich-*.mjs`                                     | Supported Immich client, inventory and companion projection boundary.                            |
| `migrations/`                                                  | Ordered checksummed PostgreSQL schema ledger.                                                    |
| `service/test/`                                                | Unit, integration, security and route-contract proof.                                            |
| `tests/sql/`                                                   | Fresh-schema and migration acceptance invariants.                                                |
| `ui/web/src/routes/(user)/cimmich/`                            | SvelteKit route shells for Cimmich screens.                                                      |
| `ui/web/src/lib/components/cimmich/`                           | Product components, presentation controllers and shared Cimmich interactions.                    |
| `ui/web/src/lib/services/cimmich.service.ts`                   | Main typed Web client and cross-domain public types.                                             |
| `ui/web/src/lib/services/cimmich-*.ts`                         | Focused clients for explore, corrections, identity review, summaries, duplicates and Local AI.   |
| `ui/web/src/lib/managers/cimmich-visibility-manager.svelte.ts` | Client-side viewing-mode generation, invalidation and fail-closed coordination.                  |
| `ui/web/src/lib/route.ts`                                      | Canonical navigable URL builders.                                                                |
| `providers/`                                                   | Weight-free or separately licensed provider adapters and manifests.                              |
| `providers/apple-vision-summary/`                              | No-download native-macOS Smart evidence adapter and replaceable compile-on-first-use launcher.   |
| `tools/`                                                       | Installer, lifecycle, acceptance, publication and bounded operator tooling.                      |
| `demo/cedar-house-v1/`                                         | Fictional rights-cleared end-to-end fixture.                                                     |

## UX-to-implementation map

| Product surface      | Web entry and principal components                                                                                                 | Service/domain seam                                                                              | Durable or derived truth                                                                        |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| Home                 | `routes/(user)/cimmich/+page.svelte`; home presentation helpers                                                                    | bounded home/summary projections                                                                 | current visible counts and selected cover settings                                              |
| Library              | `/cimmich/library` redirects to the inherited photo route with Cimmich organise context; `CimmichBulkPhotoSorter`, Explore filters | tag/label/album operations, explore routes, asset corrections                                    | Cimmich labels, operation receipts, correction decisions; media remains Immich-owned            |
| Photo viewer         | `AssetViewerNavBar`, `CimmichPhotoOverlay`, viewer presentation, duplicate/file-location/visibility components                     | asset evidence, manual subject/context routes, correction routes, archive-integrity status       | accepted/proposed observations, typed tags, correction decisions, duplicate evidence            |
| People directory     | `routes/(user)/cimmich/people/+page.svelte`; People cache and Explore filters                                                      | People projection, candidate summary, possible-people and identity-audit routes                  | Person identities and categories are durable; queues/counts are projections                     |
| Person workspace     | `people/[personName]/+page.svelte`; identity navigation, coverage, candidate review, split, names and presentation components      | Person assets/connections/profile/names/presentation, identity audit, match refresh, merge/split | profile and accepted evidence are durable; coverage, candidates and Smart Split are rebuildable |
| Pets                 | `routes/(user)/cimmich/pets/+page.svelte`; `CimmichPetUnknownReview`                                                               | Pet CRUD/media/documents, Pet matching and Unknown review                                        | Pet profile and owner decisions durable; detector suggestions derived                           |
| Places/Things/Events | route shells plus `CimmichContextBrowser` and map/plan components                                                                  | context entity, relation, asset, cover, plan and geocoding routes                                | typed entities, hierarchy, links and decisions durable; nearby/media suggestions derived        |
| Documents            | route shell plus `CimmichDocuments`                                                                                                | Document metadata/link/content/version routes                                                    | metadata in PostgreSQL; imported bytes in the separate content-addressed store                  |
| Smart Search         | `routes/(user)/cimmich/smart-search/+page.svelte`                                                                                  | deterministic smart-search and Document queries                                                  | local read projection over confirmed truth; no search-owned authority                           |
| Archive Health       | archive-integrity route and focused client                                                                                         | exact copies, possible-duplicate groups, inline preservation recommendation and backup proof     | fingerprints/provenance durable or reproducible; recommendations derived                        |
| Settings/setup       | settings, setup and maintenance routes                                                                                             | integration, onboarding, provider, SourcePack, Local AI and Guided operators                     | configuration and reviewed lifecycle state; model output remains observation                    |

## Identity and evidence model

The photo navbar is one three-part grid: privacy and close at the left, a real
centre slot for Cimmich People/Context/evidence/file/Local-AI controls, and the
inherited Immich viewer actions at the right. `CimmichPhotoOverlay` portals its
controls into that centre slot rather than creating a second fixed toolbar.
The privacy popover owns both scopes: the current viewing mode and the saved
visibility of the opened photo. The app tooltip provider uses a 200 ms initial
delay, while dense viewer/Cimmich icon controls use 120 ms and replace native
`title` delays. Labels and `aria-label`s remain the authority for accessible
names.

### Person is the durable subject

A Person is not an Immich face cluster and not a display name string. It is a
stable Cimmich identity with aliases, profile fields, categories, presentation
choices and an accepted-evidence history. Display-name collisions and merges
therefore require explicit commands.

Current presentation reads only active, visibility-admitted assets. Retired
catalogue rows remain in provenance and matching history but cannot inflate the
ordinary Person photo count.

### Physical observation is separate from accepted meaning

The relevant layers are:

- a Face/Body observation says machinery or a user placed geometry on an
  asset;
- an accepted claim associates suitable evidence with a Person or Pet;
- a bucket or evidence type says how that observation may be used;
- a presentation choice says which accepted or explicitly eligible media to
  display; and
- a candidate says what should be reviewed next.

Same-photo and overlapping-XMP safeguards reason about the canonical physical
region before candidate grouping. Two source records that describe the same
physical face must not become independent votes or contradictory owner tasks.

### Face, Head, Body and Presence

- **Face** may enter Prime, Secondary or Low-quality matching policy when its
  provider, evidence and SourcePack lineage permit it.
- **Head** keeps visible-region knowledge but removes Face matching authority.
- **Body** records a bounded appearance region and never becomes Face evidence.
- **Presence** associates Person and asset without inventing visible geometry.

The projection order is Face, then Appearance (Head or Body), then Presence so
one Person/photo does not become several visible tasks. Canonical history is
not erased by that presentation collapse.

### Review queues

The queue taxonomy is operational and mutually comprehensible:

- New matches: unaccepted candidate evidence;
- Multiple in one photo: competing same-photo regions requiring exact-target
  inspection;
- Possible mistags: the union of stronger-other-Person evidence and
  conservative own-Person outliers;
- Possible people: coherent unnamed recurring groups; and
- Needs attention/Holding: owner workflow state, not a matching lock.

Review writes use physical-Face-aware batch commands. Head/Body reclassification
changes evidence meaning, while Unknown and Not-a-face have different
consequences and must not share a generic rejection path.

### Matching and SourcePacks

Matching consumes an immutable SourcePack binding:

```text
provider + preprocessing + vector space
        + exact reference membership
        + evidence cutoff + resolver policy
        + calibration/evaluation receipt
```

The active pack is never edited in place. Corrections, new eligible evidence or
provider changes produce a successor proposal. Same-photo and capture-context
guards prevent correlated evidence from masquerading as independent support.
Head, Body and Presence are excluded from Face scoring.

Person-scoped refresh checks whether the Person has relevant Head or current
mistag rows before adding only those rows to the ordinary candidate refresh.
Smart Split similarly requires compatible current embeddings; it emits clear
groups and an explicit Unclear remainder, never moves evidence.

## Pets

Pet profile truth and detector truth are separate. `speciesKind` and the
owner's label are editable profile fields; a detector classification remains
provenance rather than the desired recorded species.

Unknown Pet review is a state machine:

```text
Unknown ── Assign ──► existing/new Pet evidence
   │
   ├── Ignore ──────► Ignored ── Restore ──► Unknown
   │                       │
   └── False Match         └── False Match
```

Assign, Ignore, Restore and False Match are distinct replay-safe commands.
Bulk review is capped and returns per-item outcomes. Arbitrary reassignment of
already accepted Pet observations must not be inferred from the Unknown queue;
it needs its own exact atomic contract.

## Context graph

Place, Object and Event share a typed context-entity contract but keep their
own valid types, roles and routes. The graph contains:

- stable entities with aliases, descriptions, dates and visibility;
- same-kind parent hierarchy for Places and Events;
- typed entity-to-asset associations;
- typed entity-to-subject/entity relationships;
- explicit cover decisions; and
- decision-scoped archive/restore, update and relationship operations.

Context never creates identity evidence. A Person participating in an Event is
not automatically Face, Body or Presence evidence in every Event photo.

Place geometry has explicit provenance (`manual`, `photo_gps`, `contextual` or
`confirmed`). Nearby GPS media and external address results are review inputs.
Geocoding is the disclosed exception to the default no-outbound Core path and
sends only the typed address query.

## Documents

`cimmich.document.v1` separates metadata from bytes:

- PostgreSQL stores stable identity, metadata, links, visibility, versions and
  decisions;
- `immich_asset` sources reference existing visible Immich media; and
- `cimmich_file` sources use an atomic, content-addressed Cimmich store with
  SHA-256 verification and quotas.

Safe preview formats use restrictive response headers. Other formats are
attachment-only. Visibility is the stricter of the Document and its referenced
asset. Lower modes receive a generic not-found response before title,
filename, checksum, link or byte projection.

Document search is metadata/link search. OCR or semantic text is a separate
optional evidence pipeline and must not be implied by the Basic contract.

## Search

Basic Smart Search deterministically resolves current visible names, aliases,
context descriptions and ISO date selectors, then intersects recognized
groups in PostgreSQL. It returns both the interpretation and unresolved terms.

That “abstain visibly” contract is important: broad media retrieval is not a
valid fallback for an unrecognized query. Visibility is part of the SQL
population before result counts and `hasMore` are calculated.

## Archive identity and duplicate evidence

Cimmich distinguishes three identifiers that are easy to confuse:

- the current Immich/source asset ID addresses a specific catalogue copy;
- the Cimmich inventory identity tracks that projected source record and its
  revisions; and
- a content fingerprint or portable content identity can reconnect the same
  bytes across source rollover or copy changes.

Exact duplicates require verified complete-file SHA-256 equality. Current
source also retains a path-free visual signature from Immich so likely
same-image versions can be reviewed even without an Immich duplicate-group ID.
Equal signatures and dimensions can propose a group; different verified
SHA-256 values explicitly prevent an exact claim.

Immich's library-wide visual duplicate groups are an upstream enrichment, not
something Cimmich synthesizes. They require Immich Smart Search to produce a
CLIP embedding for each asset and Duplicate Detection to consume those
embeddings. Enabling Smart Search affects new assets; an existing library must
run the missing Smart Search jobs before missing Duplicate Detection jobs.
Changing the CLIP model requires an all-assets Smart Search rerun. OCR is a
separate optional upstream enrichment. Immich Facial Recognition is not a
Cimmich identity dependency and can remain disabled when Cimmich owns that
workflow.

Duplicate badges use one bounded status request for a viewport and a short
cache, not one request per card. Photo-specific Archive Health URLs preserve
the target asset and requested evidence mode. Archive Health already receives
each Immich `AssetResponseDto.originalPath`; it derives containing-folder and
folder-wide flagged-photo counts across the loaded duplicate review in the
client, so displaying and filtering folder context does not add a service query
or matcher pass.

Photo file-location actions do not attempt to launch a native file manager on
the remote archive host. They open an explicit browser boundary dialog and
route **Open folder view** to `Route.folders({ organise: 1, path })`. This avoids
the misleading former transition to the same asset overlay under a different
URL, which made the action appear inert.

The preservation recommendation is a pure ranking/read model rendered inline
with its comparison group. It records reasons and cautions, may hold an
ambiguous group and never deletes a file. Legacy `mode=plan` URLs open the
Possible duplicates view because the recommendation is no longer a duplicate
navigation destination.

## Visibility architecture

Visibility is cumulative: Personal admits Standard + Personal, and Private
admits all three. Admission must happen at every relevant source:

- asset and media reads;
- collection rows and counts;
- names, aliases and covers;
- context relationships and map markers;
- Person/Pet connections;
- Documents and their bytes;
- search selectors and results; and
- inherited Immich photo routes entered from Cimmich.

The Web manager tracks a viewing-mode generation. A rank change invalidates
mode-sensitive caches and mounted protected media. Server failures fail closed;
the client does not retain a stale higher-rank projection as convenience.

## Performance model

Cimmich is expected to stay interactive on large archives. The default design
rules are:

- page before expensive enrichment;
- return the primary useful projection before unrelated secondary work;
- query only the active tab/lane;
- batch viewport asset status and identity operations;
- use bounded cursors rather than unbounded “all” reads;
- coalesce identical in-flight requests and use short rebuildable caches;
- preflight whether extra work exists before starting a heavy matcher path;
- isolate maintenance compute from interactive database capacity; and
- run archive-wide or model-heavy compute on the configured capable worker,
  not by accidentally saturating the serving host.

Counts may be loaded separately from rows, but both must name the same
population. A quick partial page must say that it is partial rather than
presenting a misleading zero.

## Commands, decisions and consistency

Mutation handlers should follow this order:

1. authenticate actor and enforce viewing/ownership scope;
2. validate stable IDs, revisions and bounded item counts;
3. derive authoritative current state server-side;
4. lock the affected logical subject/observation;
5. reject stale or conflicting command reuse;
6. append the decision and apply its exact current projection atomically;
7. invalidate dependent candidates/caches; and
8. return an explicit receipt and supported Undo metadata.

The UI may optimistically reconcile a completed local card, but it must not
launch a full refresh storm after every action. Background recomputation can
follow without blocking the visible acknowledgement.

## Jobs and optional compute

Long work uses a deterministic identity:

```text
asset identity + operation + tool/model version
               + configuration digest + input evidence revision
```

Leases expire, checkpoints are monotonic, retries are bounded and completion
requires a matching result receipt. Heavy providers should be pausable and
must respect disk, memory, thermal and interactive-pressure boundaries.

Core remains useful without a model. Enhanced matching, Local AI and Guided
are independently enabled capabilities:

- **Enhanced** owns reviewed Cimmich ranking/abstention machinery, not model
  weights and not identity authority;
- **providers** produce versioned observations under their own licence and
  confinement contract;
- **Local AI** operates on one photo or a bounded selection. Most results and
  artifacts are temporary; explicitly generated Smart/Enhanced summary facts
  are revision-bound durable projections with no identity authority; and
- **Guided** is separately authenticated, capability-scoped and unable to raise
  its viewing ceiling.

The Local AI review surface carries an **Alpha · Experimental build** banner.
Its public build default is `false`; private deployments may deliberately set
`PUBLIC_CIMMICH_LOCAL_AI_EXPERIMENTAL_DEFAULT=true`, while the source, Compose
and Dockerfile defaults remain off for public builds.

Smart summary provider selection is `auto`: a native macOS worker selects the
bundled Apple Vision adapter with no downloaded weights or network access;
other platforms stay fail-closed unless an owner configures a compatible local
model. A complete photo set is one provider process, not one process per photo.
The stored proposal binds the adapter launcher, Swift source, operating-system
runtime and deterministic composer configuration. Provider output never gains
identity, Context or activation authority.

## Migrations and compatibility

Migrations are ordered, checksummed and replay-tested. A schema change requires:

- a fresh-schema path;
- upgrade proof from the declared prior baseline;
- idempotence/replay and adversarial cases;
- semantic before/after counts for affected truth;
- a checksum-recorded backup before live application; and
- post-migration health plus representative People, Person, Pets/Things and
  exact-photo reads.

Never edit an already applied migration. Add the next migration and make the
compatibility boundary explicit. See [migration operations](MIGRATION_OPERATIONS.md).

Cimmich supports exact named Immich versions, not “approximately recent”
Immich. The companion preflight must fail clearly when the version, permissions
or upstream availability is incompatible.

## Testing and acceptance

For an ordinary code change, start with the affected focused tests and then run
the complete gates from [DEVELOPMENT.md](../DEVELOPMENT.md):

```sh
cd service && npm test
cd ../ui/web && pnpm run check:typescript && pnpm run check:svelte
cd ../.. && ./tools/run_synthetic_acceptance.sh
```

Also run formatting, lint, production build, migration and publication/privacy
checks when the changed surface requires them. UI work is not accepted from
component tests alone: exercise the signed-in journey, empty/loading/error
states, keyboard path, visibility transitions and the exact owner correction
that motivated the change.

The Cedar House fixture proves deterministic product behavior with fictional
media. It is not evidence of representative biometric accuracy or fairness.

## Adding or changing a capability

Before implementation, write down:

1. the user's job and the screen where it belongs;
2. the durable fact, derived evidence and proposal involved;
3. who has authority to change each one;
4. the visibility population;
5. exact command, retry, conflict and Undo behavior;
6. bounded performance at the archive's worst expected size;
7. failure and abstention presentation; and
8. the focused plus end-to-end proof that will close the claim.

Then update this map only when the product surface or architectural boundary
changes. Keep detailed schemas and API payloads in their owning feature
contract; keep dated test counts and deployment identities in release receipts.

## Contract index

- [Person evidence and coverage](PERSON_EVIDENCE_COVERAGE.md)
- [Pet profile and Documents](PET_PROFILE_DOCUMENT_V1.md)
- [Context entities](CONTEXT_ENTITY_V1.md)
- [Documents](DOCUMENT_V1.md)
- [Basic Smart Search](BASIC_SMART_SEARCH_V1.md)
- [Archive mobility](ARCHIVE_MOBILITY.md)
- [Local AI review](LOCAL_AI_REVIEW.md)
- [Photo summaries](SUMMARIES.md)
- [Privacy boundary](PRIVACY_BOUNDARY.md)
- [Source-media immutability](SOURCE_MEDIA_IMMUTABILITY.md)
- [Private viewing operations](VISIBILITY_PRIVATE_OPERATIONS.md)
- [Migration operations](MIGRATION_OPERATIONS.md)
- [Community Preview acceptance journeys](COMMUNITY_PREVIEW_JOURNEYS.md)
