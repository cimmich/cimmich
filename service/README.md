# Cimmich local service

This localhost-only service is the first Display/Input boundary over Cimmich's
PostgreSQL Intelligence store. It provides summary, Person and identity-review
reads plus transactional user accept/reject decisions.

The preserved recording runtime remains on migration-ledger-derived schema 75,
patch level 1. Current post-submission source is schema 77. Schema 76 adds
explicit Face, Body and Hero presentation selections with persisted framing.
Schema 77 admits the two explicit unnamed-Person follow-up reasons used by the
restart-safe onboarding import, so those groups are held for Review instead of
interrupting the import. Both leave the preserved Build Week runtime unchanged.
Schemas 49–54 add
typed manual Face/Body/Presence truth, validated manual-recognition intake,
atomic typed-tag replacement and standalone Head evidence, provenance-bound
Body-result persistence, revision-safe Detailed Face/Body correction, and an
immutable Place deletion tombstone. Schema 55 adds a path-free validated source
revision for assets that predate the Immich companion inventory: preparation
captures the expected source head, a bounded local read derives the content
digest and revision, and commit advances the scoped head atomically with a Body
result. “Current” means current at the last validated read, never an unproved
claim about the live filesystem or repository. Schemas 56–59 add exact Body
source binding, entity-level context visibility, Place cover parity and Object
cover/delete parity. Schema 60 adds replay-safe Person/Pet merge recovery,
actor-bound Person creation, visibility last-intent sequencing and
visibility-filtered Document Smart Search for the expanded public-demo gate.
Schema 61 fixes SourcePack activation validation so superseded historical claim
rows cannot falsely invalidate a reference whose current accepted truth remains
valid. Schema 62 adds provenance-bound recognition for existing Face
observations: one current asset/source binding is derived through Cimmich and
the read-only companion, canonical observation geometry and origin are frozen,
two deterministic provider runs must agree, and commit rechecks current rows.
Schemas 63–65 add presentation-safe Person/Body projections, Event cover parity
and the visibility-filtered native-map bridge. Schema 66 retains bounded Immich
original filenames in the current inventory projection so newly admitted media
keeps truthful labels across API restarts without persisting source paths.
Schema 73 adds exact no-change behavior and decision-scoped create/update Undo
for Places, Things and Events without changing association or visibility law.
Schema 74 atomically supersedes an incomplete Immich inventory run when a
newly authorized onboarding scope differs, starts a fresh exactly scoped run,
and makes a failed onboarding import durably resumable without treating an
abandoned partial run as absence evidence.
Schema 75 gives owner-resolved Unknown/Noise Face groups their own decision
provenance instead of misusing the identity-decision field, and prevents that
cluster decision from being undone while an active imported Face projection
depends on it.
Schema 67 adds restart-safe Immich onboarding, scoped inventory admission and
source-proven People/Face import. It preserves assigned Immich Faces as
presentation identity with immutable upstream IDs/revisions, reconciles only a
unique current provider Face at a frozen geometry threshold and records every
ambiguous, missing, stale, extra or naming-conflict outcome for review. An
`immich_import` Face has null detector confidence, cannot receive an embedding
and cannot enqueue matching work; an exact provider-bound Face remains subject
to the existing provider/quality/SourcePack review gates.
The service still preserves the schema-48 append-only face-local measurements,
partial region visibility and exact region-scoped contamination. These records
fail unknown unless evidence is independently sufficient; they never accept an
identity or silently change a gallery tier. The current private providers remain
diagnostic and have written zero live measurement rows.

`GET /health` checks the database and required lifecycle/SourcePack schema rather
than reporting success from the HTTP process alone. Error responses are stable
JSON with the intended 4xx/5xx status.

`GET|POST|DELETE /v1/visibility/credential` lets the signed-in owner set, reset
or remove the Private presentation password from Settings. Reset takes no
previous password by design — Immich owns account access, so a forgotten screen
filter must not become an unrecoverable lockout — and any change drops live
Private sessions. It is owner-only: a Guided credential is refused with
`VISIBILITY_CREDENTIAL_FORBIDDEN`. This is the only `DELETE` route, and browser
preflight advertises it accordingly.

Schema 38 adds the fail-closed `cimmich.visibility-projection.v1` registry.
`GET /v1/visibility/projections` reports which Product V1 asset-derived route
families are service-enforced or blocked. Schemas 44–47 now give Smart Search,
Places, Events and generic Documents native visibility-aware projections. The
registry fails closed if one is not enforced. The schema-68 source and public
demo have 17 registered and enforced surfaces, including
`manual_subject_tags`, `asset_evidence`, `map_assets` and `immich_onboarding`.
The untouched internal main remains at 16.

The Event collection projection adds `previewAssetIds`, a deterministic array
of at most four visible active Main assets. Main means only `direct` or
`manual`; `route_stop` and `context` never fill the array. The existing
`coverAssetId` is first only when that cover is itself Main-eligible, followed
by capture time descending and stable asset ID. Empty arrays are truthful, and
the field is computed in the list query to avoid per-Event detail reads.

`GET /v1/geocoding/addresses?q=&limit=` is the disclosed online address-search
capability. It sends the typed query to the public Photon service, returns OSM
attribution, caches by query digest briefly in memory, and never persists or
logs the raw query. The route is bounded to 3–160 characters and five results;
provider outage or timeout is typed. It writes no Place, Immich or media state.
Safely parsed numbered addresses use Photon structured search first. Every item
adds `matchQuality: exact|close|broad` and a closed `matchReason`; `exact` means
the requested house/range/alphanumeric number and normalized street agree, and
every supplied locality/state/postcode constraint agrees. An unverified unit is
`close`. A missing house point may return only an honest Street/Place result;
an unrelated numbered property is discarded rather than labelled exact.

Schema 54 adds `POST /v1/places/:placeId/delete` with
`{commandId,expectedRevision,deleteTags}`. Delete is an irreversible logical
tombstone, distinct from recoverable Archive. Children are detached and active
aliases, relations and Document links are superseded. `deleteTags:false`
retains accepted Cimmich asset tags against the tombstone for audit/recovery;
`deleteTags:true` supersedes them. Neither mode deletes assets, source media or
Immich state, and ordinary replay cannot restore the Place.

Schema 39 also exposes additive
`cimmich.person-projection-page.v1` without changing legacy reads:

- `GET /v1/people/:personId/assets?pageSize=1..250&cursor=...` returns a
  stable gallery page (default 120 when continuing a cursor);
- `GET /v1/people/:personId/identity?pageSize=1..120&cursor=...` returns a rich
  Identity page (default 24 when continuing a cursor) and selects that page
  before per-face enrichment;
- both responses contain `schemaVersion`, `pageSize`, `items` and nullable
  `nextCursor`; the continuation is opaque and must not be parsed or persisted;
- cursors bind route kind, stable Person ID and current visibility rank.
  Cross-Person or cross-mode reuse fails with
  `PERSON_PAGE_CURSOR_INVALID`; invalid bounds fail with
  `PERSON_PAGE_SIZE_INVALID`;
- existing `?limit=` clients retain their exact `{items}` response and ordering.

The existing exact Person response also carries
`cimmich.person-photo-history.v1` as `photo_history` with nullable ISO
`minCaptureTime`/`maxCaptureTime` and integer `futureCaptureDateCount`. It is
derived from distinct visible active image assets with accepted Face, Body or
Presence association. Future captures are excluded from the range and counted
separately; undated images and non-image media affect neither. This is a read
aggregate, not Profile persistence or source metadata repair.

Holding hints are separately bounded by
`cimmich.person-holding-match-batch.v1`:

- `POST /v1/people/:personId/identity/matches:batch` accepts 1–24 unique
  `faceIds` and `limitPerFace` from 1 to 3;
- every requested face must be a visible active accepted face of that exact
  current Holding Person; ordinary People and hidden/outside faces fail typed;
- response items preserve request order and reuse the exact existing face-match
  shape, while the server runs at most four scorers concurrently;
- this is a read projection only and grants no identity, category or gallery
  authority. The single-face route remains available for explicit detail reads.

Person-scoped candidate review is exposed without creating a global review queue:

- `GET /v1/people/:personId/candidates` returns every current candidate for that
  active human Person, ranked by stored raw match score and deterministic tie-breaks;
- `POST /v1/people/:personId/candidates/bulk-accept` accepts up to 100 selected
  current claims in one transaction, rejecting stale or cross-Person selections,
  preserving per-claim decisions, resolving accepted-identity conflicts and
  re-curating every affected gallery.

Committed identity commands are authoritative. Immediate Prime refresh is a
projection convenience backed by the durable rebuild queue; if that refresh
fails, the command returns `maintenancePending` rather than falsely reporting
the committed user decision as a failed save.

Accepted face-to-body inheritance is correction-aware: rejecting or moving the
supporting accepted face supersedes its derived BodyTag, and an accepted
replacement claim restores the link only when the body remains unclaimed.

Person setup is exposed through Cimmich-owned contracts:

- `GET /v1/people/:personId/setup` reads names, subject type and active merges;
- alias add/remove commands preserve typed name history;
- subject-type commands classify Person versus Pet and rebuild affected human galleries;
- merge preview, merge and unmerge commands provide directional, reversible identity consolidation.

Basic Pet management is exposed through `cimmich.pet-manual.v2`:

- `GET/POST /v1/pets` and `GET/PATCH /v1/pets/:petId` provide typed Pet
  list/create/detail/update/archive, aliases, description, normalized cover and
  optional user-managed species (`dog`, `cat`, `bird`, `rabbit`, `fish`,
  `reptile`, `small_mammal` or `other` with an optional label);
- `POST /v1/pets/:petId/media:attach` and `media:detach` accept 1–100 stable
  asset IDs and append user-origin manual Presence evidence;
- every mutation requires a client-stable `commandId`; exact retries replay the
  stored result while conflicting reuse fails typed;
- `POST /v1/decisions/:decisionId/undo` reverses only a still-current Pet media
  operation; later supersession fails closed;
- Pet-only preview/merge/unmerge reuses the proven lifecycle while Person/Pet
  merge is forbidden;
- Pet media, asset-subject and Basic Pet-filter search projections share the
  same graph truth. No Pet model or human face authority is involved.

Generic cross-cutting Documents are exposed through `cimmich.document.v1` on
schemas 47–48:

- `GET /v1/documents` and `GET /v1/documents/:documentId` list/read only rows
  visible in the current Cimmich viewing mode;
- `POST /v1/documents/reference` records one supported visible Cimmich asset
  without proxying or changing its source bytes;
- `POST /v1/documents/import` accepts bounded raw bytes plus base64url JSON in
  `x-cimmich-document-metadata`, then atomically writes mode-0600
  content-addressed local storage;
- per-file and total-unique-content quotas fail typed; exact duplicate bytes
  reuse storage without duplicating quota;
- `PATCH /v1/documents/:documentId`, typed 1–100 link attach/detach, and
  decision-scoped Undo preserve stable commands and original bytes;
- one Document links to Person, Pet, Place, Object and Event without copying;
  database triggers recheck every subject kind;
- optional `supersedesDocumentId` records one explicit direct successor while
  retaining the previous edition;
- `GET /v1/documents/:documentId/content` rechecks byte count/SHA-256 and uses
  `nosniff`, no-store, sandbox CSP and attachment fallback. Immich-owned content
  remains in the existing asset viewer;
- no OCR, classification, semantic retrieval, office editing, identity or
  matching authority exists in Basic V1.

Schema 48 adds `cimmich.document-lifecycle.v1` combined database/store
backup, independent verification, empty-target restore, explicit export,
edition-chain privacy purge and clean empty-store removal. It also supplies an
idempotent fail-closed repair for early schema-47 Buffer digests and
`cimmich.document-legacy-pet.v1`: an explicit replay-safe adoption/undo bridge
that never changes or deletes the existing schema-43 Pet association. Imports
and lifecycle operations use one cross-process database lock. Backup manifests
record the actual supported database schema, and restore
requires the restored migration ledger to match that version exactly.

The complete route/JSON/configuration/privacy contract is in
[`docs/DOCUMENT_V1.md`](../docs/DOCUMENT_V1.md).
Lifecycle and compatibility details are in
[`docs/DOCUMENT_LIFECYCLE_COMPATIBILITY_V1.md`](../docs/DOCUMENT_LIFECYCLE_COMPATIBILITY_V1.md).

Manual photo tagging is exposed through
`cimmich.manual-subject-presence.v1` on schema 41:

- `GET /v1/assets/:assetId/manual-presences` returns exactly
  `{assetId, items, schemaVersion}`. Each item is
  `{associationId, assetId, decisionId, displayName, geometry, origin,
reasonCode, state, subjectId, subjectKind}`.
- `POST /v1/assets/:assetId/manual-presences` accepts exactly one stable
  `{action, commandId, subjectKind, subjectId, geometry}` command. `action` is
  `attach|detach`; `subjectKind` is `person|pet`; detach omits geometry.
- Geometry is nullable or normalized image-space
  `{kind:"point",x,y}` / `{kind:"region",x,y,w,h}`. The database closes the
  key set and enforces finite bounds, positive region size and `x+w/y+h <= 1`.
- A mutation returns
  `{action, association, assetId, changed, decisionId, replayed,
schemaVersion, status, subject, undo}`. `status` is `applied|no_change`;
  `association` is null after detach. Exact `commandId` replay returns the
  stored response with `replayed:true`; different reuse fails typed.
- `POST /v1/manual-presences/decisions/:decisionId/undo` accepts
  `{commandId}` and returns the same envelope with `action:"undo"`,
  `status:"reverted"` and `supersedesDecisionId`. Only the still-current
  decision can be undone.
- Reads and writes require the asset to be visible in the current Cimmich
  viewing mode. Person/Pet kind is checked in both service and database.
  Existing accepted non-manual authority is never overwritten.
- Stable failures include `MANUAL_PRESENCE_GEOMETRY_INVALID`,
  `MANUAL_PRESENCE_SUBJECT_KIND_MISMATCH`,
  `MANUAL_PRESENCE_AUTHORITY_CONFLICT`,
  `MANUAL_PRESENCE_COMMAND_CONFLICT`,
  `MANUAL_PRESENCE_UNDO_NOT_AVAILABLE` and `MANUAL_PRESENCE_UNDO_STALE`, plus
  the existing fail-closed projection/visibility errors.
- This is user-origin Presence evidence only. It never creates or alters a
  FaceObservation, BodyObservation, embedding, identity claim, SourcePack,
  matching input, Immich database row or source-media byte.

The first stock-Immich boundary is exposed through
`cimmich.immich-companion.v1`:

- `IMMICH_API_URL` accepts a server origin or `/api` root;
- `IMMICH_API_KEY` is a server-side least-privilege key. Basic asset projection
  requires current-user and asset read; first-run People/Face discovery and an
  optional local provider media read additionally require Person, Face and
  original-asset download access. No write/admin permission is required;
- `GET /v1/companion/status` reports configured, compatible, authenticated and
  degraded state without returning the key, user profile or upstream body;
- `GET /v1/companion/assets/:immichAssetId` returns one path-minimized stable
  asset projection plus deterministic `inputRevision`;
- `GET /v1/companion/assets?visibility=...` reads a bounded page from one
  explicit `timeline|archive|hidden|locked` lane. Full inventory must sweep all
  authorized lanes and cannot treat the default timeline as the whole library;
- the adapter uses only Immich HTTP reads. It never connects to or writes the
  Immich database, and Cimmich retains its separate credentials, migrations,
  backup/restore and failure domain.

The release-certified companion compatibility target is exact Immich `3.0.3`.
Missing configuration leaves
the Cimmich service healthy with companion state `not_configured`; incompatible,
unauthorized, unavailable and invalid upstreams fail asset reads closed with
typed redacted codes.

`cimmich.immich-onboarding.v1` composes that read boundary into a restart-safe
first-run service contract:

- `GET /v1/onboarding/immich` returns connection/import readiness;
- `POST /v1/onboarding/immich/connect` accepts a write-only credential, verifies
  version/principal/permissions and persists it only in the configured
  mode-0600 secret file;
- `POST /v1/onboarding/immich/preview` freezes a digest over the selected
  visibility lanes, media kinds, provider choice and visibility-filtered
  People/Face counts before mutation;
- `POST /v1/onboarding/immich/import` revalidates that preview, runs scoped
  inventory and imports current assigned Face truth transactionally per asset.

Upstream Person and Face IDs/revisions remain durable provenance. Duplicate
local names, stale revisions, ambiguous geometry, missing or extra provider
Faces and unassigned upstream Faces become closed review items. Only one unique
current provider Face clearing the frozen overlap and bidirectional-margin law
receives the imported accepted claim. A source-only imported Face is truthful
presentation evidence with null detector confidence; the database forbids an
embedding on it and the identity-rebuild trigger excludes it. The accepted
identity therefore survives provider deferral or abstention without laundering
the source Face into matching authority.

`cimmich.immich-inventory.v1` turns those reads into restart-safe local work:

- migration 0032 stores sources, runs, four explicit visibility-lane cursors,
  page receipts and path-free asset projections only in Cimmich's database;
- `GET /v1/companion/inventory` exposes redacted inventory status plus one
  closed coverage row for each lane. Selected ordinary lanes report their
  durable `pending|processing|completed` ledger state; omitted lanes report
  `not_selected`; Locked reports `elevated_session_required` when the bounded
  current companion probe cannot use the API-key session. Aggregate coverage
  ends as `complete_with_exclusions` only after every selected ordinary lane
  completes; pending or processing ordinary work remains `processing` even
  when Locked is excluded. This avoids both pretending Locked was empty and
  declaring an active inventory run complete too early;
- `bin/sync-immich-inventory.mjs` performs the bounded sweep. It requires an
  explicit local provider tool version/config digest and enqueues through
  `cimmich.media-job.v1`;
- a committed page advances its cursor in the same database transaction as its
  asset upserts and job enqueue. Restart therefore re-fetches or resumes the
  exact durable page rather than skipping work;
- unchanged assets reuse their deterministic completed/pending job; a changed
  `inputRevision` pauses obsolete uncompleted work and enqueues one new work
  identity;
- one full all-lane absence becomes `suspected_missing` and pauses work. Only a
  second complete absence becomes `missing`; reappearance restores the same
  stable Cimmich asset and resumes the exact paused job;
- the upstream principal is stored only as a digest and cannot silently change
  under an existing source ID. Paths, profiles, People, tags and EXIF are not
  persisted by inventory. Schema 66 persists only the current bounded display
  filename on the Cimmich projection so list/detail reads survive an API
  restart without reopening source media.

This gate proves static synthetic Immich pagination, interruption, unchanged
replay, changed revision, two-pass absence and re-entry. The source-owned
[guided installer](../INSTALL.md) brings up the isolated stack without accepting
an API key in Terminal or importing before signed-in preview. The advanced
`tools/companion.sh` lifecycle additionally proves configure/up/sync/status,
checksummed Cimmich-only backup/restore, disable and exact removal against
official Immich 3.0.3 without touching the Immich database or source media.
Representative concurrent-library rate/latency behavior remains a
release-performance gate.

General resumable media work is exposed through `cimmich.media-job.v1`:

- `POST /v1/media-jobs`, `GET /v1/media-jobs` and
  `GET /v1/media-jobs/:jobId` expose deterministic enqueue and public-safe
  status/history;
- the work key binds asset, operation, tool version, provider/config digest and
  input revision;
- `bin/media-job.mjs` claims exclusive expiring leases, records monotonic
  checkpoints, schedules bounded retries and recovers interrupted work;
- completion requires a matching producer receipt/result digest, so a stale or
  missing output cannot be silently skipped;
- `bin/commit-recognition-job.mjs` independently validates the provider
  checkpoint, job asset/configuration and existing valid FaceObservations before
  persisting embeddings idempotently. It grants no activation or identity
  authority.

Schema 33 closes general face detection and durable terminal `no_face`.
Schema 34 adds `cimmich.media-pipeline.v1`: one immutable manifest binds the
independent detector and recognizer configuration digests, vector space and
recognition tool version without using the ambiguous combined job. A completed
detection result continues to one exact `recognize_faces` job, or terminates as
`no_face`. The local recognition worker rechecks the active Immich revision and
detection-time source-content digest, requires an exact terminal packet set for
the bound observations, and commits embeddings transactionally. The OpenCV/
SFace adapter passes one bounded image plus target boxes to a no-shell process
through framed stdin; it does not persist source media. The existing machine
review scorer then projects alternatives without creating identity claims.

The disposable decision journey carries a provider-bound synthetic candidate
through Unknown/restore and identity Accept, compiles and evaluates a successor
SourcePack, performs an operator-reviewed activation, and proves the next
genuinely unresolved suggestion improves. It proves the complete product path,
replay and authority separation in a synthetic fixture only. It is not a claim
that the current real-archive matcher has passed or is active: the latest
corrected condition-consensus policy was rejected and release runtimes have
zero active SourcePacks.

Schema 35 closes that source/synthetic operator gate with
`cimmich.media-operator.v1`. `GET/POST /v1/operator/media-pipeline` expose
status, run, pause and resume. Stable commands bind actor, exact request digest
and small page/job/candidate/backlog/time/lease limits. Pause is durable and
graceful, replay is idempotent, conflicting reuse fails typed, backpressure
defers inventory, and requested but unconfigured stages fail rather than being
silently skipped.

`cimmich.local-media-provider-runtime.v1` now closes the first real provider
wiring seam. Setting `CIMMICH_LOCAL_MEDIA_PROVIDER=opencv-yunet-sface-cpu` plus
explicit Python/YuNet/SFace paths verifies both manifests, model digests,
OpenCV 4.11 compatibility and script digests before constructing the dedicated
detector, pipeline continuation and recognizer workers. Status returns only a
redacted provider receipt. Disabled remains the default; no model is fetched or
enabled implicitly. One public-safe Immich-compatible journey persists one real
SFace embedding with zero identity claims/source writes and stable replay. A
second journey now uses official Immich 3.0.3: one quiesced timeline asset
completes through the same operator, Cimmich database stop/remove leaves Immich
healthy, and an independent restore reproduces 1 projected asset/1 embedding/0
claims. Full all-lane stock inventory and representative load remain open.
Locked inventory stays an explicit typed exclusion when the configured Immich
credential lacks the required interactive authority; Cimmich neither retries
with broader authority nor treats that lane as empty.

Provider enablement after an earlier provider-disabled inventory sync is also a
supported lifecycle. Before bounded detection work, the operator replay-safely
ensures one current provider/config/input-revision job for each active supported
projection. Existing jobs are reused, changed provider configurations receive
distinct jobs, and the detector worker leases only jobs for its exact validated
configuration. Disposable acceptance proves late enablement, exact replay,
provider replacement, revision change, absence and re-entry without silently
processing another provider's queue.

It also owns the Adaptive SourcePack boundary:

- `GET /v1/operator/face-matching` is the owner-facing state machine. It
  reports provider validation, accepted/provider-space evidence, the current
  minimized pack head and exactly one next action. Provider-disabled responses
  retain the complete shape with `providerEmbeddings: 0` and
  `latestPack: null`; Basic accepted identity truth remains available;
- `POST /v1/operator/face-matching/recognition` starts or resumes one bounded
  configured-provider media-operator command. The server derives the provider,
  configuration and vector space; callers supply only `commandId` and
  `workLimit`;
- `POST /v1/operator/face-matching/source-packs` content-addresses the current
  accepted owner evidence into one proposed provider-specific pack using a
  deterministic three-window plan. Unchanged evidence replays the same pack;
- `POST /v1/operator/face-matching/source-packs/:packId/evaluate`, `/review`,
  `/activate` and `/rollback` expose the existing immutable evaluator,
  human-review gate and lifecycle heads. The diagnostic evaluator and reviewed
  gate remain two separate immutable records. Pack read, status and evaluation
  project the exact nullable `reviewGateReceipt` plus a closed
  `reviewGateReceiptNullReason`. The service freezes the
  `best_individual_prime` score/margin policy on calibration evidence and
  measures it on untouched known and identity-disjoint unknown evidence using
  the accepted 98% precision, 2.5% false-accept and 100-unknown gate. The review
  write accepts only that byte-equivalent server projection. Callers cannot
  submit provider settings or invent matching thresholds;
- Guided V2 publishes the same eight canonical operations with closed schemas,
  replay/conflict/continuation law and `/cimmich/maintenance` verification
  links. It does not implement a second mutation path.

- `bin/compile-source-pack.mjs --cutoff=<ISO> --model-version=<version> [--execute]`
  deterministically creates an immutable `proposed` pack from trusted pre-cutoff evidence;
- `bin/compile-shadow-source-pack.mjs` accepts a frozen provider face payload
  on stdin, compiles through the same SourcePack code entirely in memory and
  emits aggregate membership/parity digests. It has no persistence or
  activation path, fails on expected Prime membership drift and returns
  `blocked` when any currently anchored Person has no Prime in the candidate
  provider's exact vector space;
- `bin/evaluate-source-pack.mjs --pack-id=<id> --calibration-end=<ISO> [--execute]`
  evaluates later calibration/holdout evidence and persists leakage assertions;
- `bin/source-pack-lifecycle.mjs` records a versioned human-review-only gate
  receipt including the frozen review score/margin policy, atomically activates
  a qualified pack and rolls an active successor
  back to its still-qualified predecessor;
- PostgreSQL blocks activation without passed leakage-safe verified-unknown proof,
  manifest parity, one embedding space and still-trusted reference identities;
- later accepted-identity correction immediately retires any active pack that
  contains that face directly or as a prototype member; stale reactivation fails;
- identity, user-bucket, embedding and quality changes enqueue successor-pack rebuilds;
- `bin/run-source-pack-rebuild-worker.mjs` leases and coalesces those requests,
  recovers expired work and converges them into a proposed successor only. A
  replay performs zero work and a change arriving during processing remains a
  trailing request;
- Secondary references compile as `condition_only`: they remain available to
  the top-two ambiguity resolver but cannot enter the default Prime gallery.
  `bin/secondary-routing-gate.mjs` requires blind net gain, bounded false flips
  and no ordinary-query regression before a policy can pass;
- `POST /v1/identity-claims/:claimId/not-this-person` supersedes an accepted
  identity, records negative user evidence, removes matching memberships and
  rebuilds or retires its live prototype.

The service does not expose PostgreSQL. In the local fixture runtime it shares
the private Docker network with the database and publishes HTTP only on
`127.0.0.1`. An optional private display bridge maps neutral Cimmich asset IDs
to the current local source application's asset IDs for preview rendering; it
contains no filesystem paths and is not required by the Cimmich data model.
Inventory UUIDs remain authoritative. A source-controlled fixture whose archive
hashes and semantic bindings have already been validated may explicitly set
`filenameAuthority: canonical_source`; only those listed assets retain the
reviewed canonical filename when an older upstream upload label disagrees.
Ordinary bridges omit that field and continue to take their filenames from the
current inventory projection.

This first slice is local-development security, not a production authentication
boundary. Writes require an explicit `X-Cimmich-Actor` header and the configured
browser origin, but production deployment still needs the versioned Immich
user/session binding defined by the companion contract.

The service can create capture contexts and select Body Tags, but the complete
product journey is not yet closed: arbitrary Presence creation and low-friction
context correction/merge/split remain UI/API work. Legacy Specialty and private
suffix compatibility are laboratory migration debt, not future public contracts.

## Machine review and Memory Steward

The ordinary product loop is split so inference cannot become identity truth:

- `GET /v1/review/machine-suggestions` reads corrected local query embeddings,
  suppresses already-resolved, overlapping and same-photo identities, retains
  Sort/Holding as realistic distractors without surfacing them as leads, and
  returns up to three stable Person-ID alternatives per face. The overview uses
  the empirically selected best individual Prime; prototype, top-three and
  Secondary diagnostics are deferred to face detail so opening the queue stays bounded.
- Summary, People and Memory Steward share one cached ranked projection from a
  fixed 48-face scoring frontier. A caller's `limit` only truncates that
  projection; it cannot change eligibility. Legacy/imported candidate signals
  remain evidence and do not contribute to `suggestions_ready`.
- `POST /v1/review/machine-suggestions/:faceId/accept` is a user command. It
  accepts the selected stable Person ID, preserves decision provenance and
  requests reference maintenance.
- `POST /v1/faces/:faceId/identity` accepts exactly one selector:
  `{personId}`, `{personName}` or `{newPersonName}`. The creation form locks the
  visible current Face, rejects active Person display-name/alias collisions
  with structured existing-Person details, then creates one active Person, one
  accepted origin=user identity claim and one Sort membership in a single
  transaction. It returns `createdPerson=true`; it creates no bucket,
  embedding, automatic identity or activation authority. Existing selection
  returns `createdPerson=false` and remains replay-safe as a no-change when the
  Face already belongs to that Person.
- `POST /v1/review/machine-suggestions/:faceId/unknown` records a durable user
  abstention scoped to the current embedding model, configuration and scorer
  policy. A future matcher contract may ask
  again; the current one may not nag.
- `POST /v1/steward/plan` is a deterministic local read/propose surface. It
  uses the same bounded machine-suggestion projection as the UI, makes no
  outbound request and exposes no write authority.
- Guided V1 is disabled by default. When explicitly enabled with a strong
  dedicated `CIMMICH_GUIDED_ACCESS_TOKEN`, authenticated
  `/v1/guided/v1/capabilities`, `/instructions` and `/access` expose a closed
  Standard-only HTTP/JSON read/propose contract. The token is Cimmich access,
  never a model-provider credential. Cimmich sends nothing to a provider;
  connected software may transmit retrieved data and its operator owns that
  disclosure. Codex, hosted HTTP clients, local models and scripts use the same
  provider-neutral recipe. Guided V1 exposes no mutation operation.
- Guided V2 is the general machine access point at
  `GET /v1/guided/v2/bootstrap`. Its dedicated token is configured with an
  explicit `read|operate` authority and `Standard|Personal|Private` ceiling.
  The bootstrap publishes the Cimmich and connected Immich boundaries, auth
  lifecycle, disclosure language, Space Trip workflow and a closed catalogue
  of canonical routes. Every catalogue item carries request/query/response
  JSON Schemas, replay/conflict/no-change law, typed error families, Undo
  contract and product-UI verification link. A V2 client calls those existing
  APIs with `x-cimmich-surface: guided`; it does not use a parallel mutation
  implementation. The server derives the actor from the token, ignores a
  caller-supplied actor and enforces the configured authority and visibility
  ceiling before canonical dispatch.
- Immich upload remains direct client→Immich using a separate user-issued
  Immich credential. Guided never returns that credential or proxies file
  bytes. After upload, the client runs the bounded canonical media operator,
  then resolves each returned Immich source ID through the visibility-safe
  asset-evidence projection. Cimmich still performs no provider brokerage,
  automatic identity acceptance, SourcePack activation or training.
- `read.integration_status` and `read.provider_settings` make that recipe
  operational for provider setup: any compatible client can inspect current
  local evidence coverage, exact accepted contracts, tested settings and
  official upstream sources. Neither action returns a token, model artifact,
  provider credential, private media or identity mutation authority.
- `read.evidence_backlog` adds a count-only Standard-visible operational view:
  identified/unresolved Faces, valid/linked/unlinked Bodies and closed manual
  Face matching lifecycle counts. `propose.review_plan` uses those aggregates
  to distinguish an empty suggestion queue from real local evidence work. It
  returns no names, paths, media, vectors, quality payloads or provider secrets.
- `npm run guided-local-conformance` remains the replaceable V1 non-Codex reference
  client. It accepts only an uncredentialed loopback HTTP origin from
  `CIMMICH_GUIDED_BASE_URL`, carries the dedicated Cimmich token only in the
  Authorization header, validates the forced-Standard/disclosure/read-propose
  contract and emits a minimized digest receipt. It runs no model, accepts no
  provider credential, calls no mutation and cannot connect to a remote host.

Machine review is disabled unless the local provider is explicitly configured.
Even then, the review query consumes only the exact same-space active
SourcePack whose evaluation is `passed` and whose human-reviewed gate receipt
contains the supported `best_individual_prime` score/margin policy. Environment
variables cannot invent those thresholds. Schema 26 adds the decision,
active-model, accepted-identity and asset-local geometry indexes required by the
overlap-safe review query. Simultaneous review and Steward requests share one
in-flight snapshot and a short post-completion cache.
`GET /v1/integrations/status` reports `provider_disabled`,
`needs_source_pack`, `needs_operator_review`, `needs_review_policy` or `ready`
without exposing paths, credentials or vector digests.
`GET /v1/operator/face-matching` adds the exact actionable progression:
`configure_provider`, `run_recognition`, `compile_source_pack`,
`evaluate_source_pack`, `record_operator_review`, `activate_source_pack` or
`review_suggestions`. A rejected pack remains rejected; insufficient temporal
holdout, missing calibration unknowns, fewer than 100 untouched unknowns and
legacy evaluations without a derived receipt remain explicit operator holds.
The source/disposable inherited-tag
journey proves provider-command replay, one proposed pack, immutable evaluator
plus gate records, reviewed-head activation, restart, database-only backup
readiness and a human-review-only suggestion. It is a mechanics fixture, not a
representative accuracy claim or a prebuilt release pack.

## Recognition providers

`bin/validate-recognition-provider.mjs` is the public boundary for a local face
provider. Its manifest fixes detector and recognizer artifact digests,
preprocessing, embedding dimension/metric, vector-space identity, licence
metadata and a `local-read-only` / no-upload privacy declaration. Observation
packets must end as `embedded`, `abstained` or `failed`; embedded vectors are
finite, normalized, dimension-checked and digest-bound. Atomic checkpoints make
replay idempotent and reject a changed result under an existing observation ID.

The repository deliberately does not bundle face-model weights. The public
`providers/opencv-sface` reference implementation uses CPU OpenCV YuNet + SFace,
confines reads beneath an explicit media root, emits no source paths, and
downloads pinned official artifacts only when the operator runs its installer.
Its independent Node validator still owns packet, vector-space and checkpoint
acceptance. Other providers remain first-class and must earn separate calibrated
SourcePacks.

`cimmich.matching-qc-cohort.v1` closes the row-level truth-QC gap between an
offline matching experiment and `cimmich.matching-lever-gate.v1`. `npm run
matching-qc-cohort` prepares a portable anonymous review packet, then evaluates
a digest-bound completion. Every changed holdout query is bound to its frozen
visually eligible candidate set, baseline/candidate replay digests and resolved
or unresolved truth. Resolved truth derives model rescue/regression; unresolved
truth accepts only the closed historical-tag, ambiguous-group,
visually-unresolvable, metadata-conflict or unreviewed dispositions. Missing
rows become unreviewed and block the existing gate. The contract carries no
names, paths or media and performs no review itself: producer results are
digest-bound only, while provider execution, visual-review execution,
calibration timing and holdout-access execution remain explicitly unproven.

`cimmich.matching-qc-cohort.v2` preserves that V1 surface and adds the two
truthful outcomes exposed by representative visual review. A resolved truth may
be declared outside the frozen candidate set without manufacturing a candidate,
and a baseline-wrong/candidate-wrong transition is `confirmed_model_neutral`
rather than a fabricated regression. Human review may also identify a closed
historical-tag, ambiguous-group, metadata-conflict or visually-unresolvable
condition even when the frozen input previously called truth resolved. Every V2
completion item must bind an anonymous visual-review evidence digest. The
receipt remains path/name/media-free, counts neutral changes separately, reuses
`cimmich.matching-lever-gate.v2`, and grants no recommendation, activation,
training, persistence or automatic identity authority. Reference tokens are
bound per calibration/holdout fold so overlap is rejected in the fold where a
query was scored without falsely treating the other fold's gallery as leakage.
The same bounded CLI selects V1 or V2 from the versioned cohort/packet; V1
behavior is unchanged.

`cimmich.asset-similarity-provider.v1` is the source-only provider-neutral
boundary for visual similarity between two anonymous asset revisions. Its
validated envelope binds one derived provider configuration and feature space,
two distinct deterministic result packets, exact input/source digests and only
bounded non-visual capture hints. The pure projection feeds the existing
capture-context classifier; timestamps, filename-sequence distance, device,
location and coappearance never substitute for the validated visual score.
Replay drift and insufficient independent evidence abstain, while identical
source-content digests are quarantined as the same source observation.

The minimized validation receipt omits asset tokens, revisions and source
digests. The pure contract executes no provider, reads no media, writes no
repository, infers no model rights and grants no accepted-truth, recommendation,
training, persistence or automatic-identity authority. The additive
`cimmich.local-asset-similarity-worker.v1` seam now binds two prepared current
asset projections, revalidates revisions and post-read source digests, invokes
the allowlisted local provider twice and returns only the validated no-write
envelope. Representative media calibration and any persistence remain separate
operator/QC gates.

`npm run asset-similarity-conformance` runs the bundled non-learned Pillow
dHash implementation twice over two synthetic in-memory images. The provider
accepts only bounded binary stdin framing, verifies its manifest and script
artifact, and emits one scalar similarity. This command proves local process
integration and deterministic contract replay; it is not representative-media
calibration or provider recommendation.

`cimmich.body-detector.v1` is the provider-neutral Body interchange. A manifest
binds one local-only detector artifact/configuration and a result binds an
anonymous asset token, exact input revision, source-content digest and bounded
normalized observations. `npm run body-provider-conformance` accepts that
manifest plus two distinctly identified result packets for the same anonymous
input. It validates each packet independently, compares their canonical result
digests and emits only a minimized `replay_consistent|replay_drift` receipt.
Distinct run identifiers prove contract replay structure, not that a provider
actually executed twice. This gate runs no detector, reads no media, infers no
model rights and grants no recommendation, activation, training, persistence or
identity authority.

`cimmich.local-body-detection-worker.v1` is the no-write bridge from a prepared
current asset revision to that interchange. It requires two exact canonical
provider packets, projects a result only through the module-private conformance
envelope, and returns the existing repository validation. It performs no media
read, provider execution or commit itself.

The isolated Cedar House demo adds the missing operator composition without
weakening those boundaries. `tools/public_demo_body.sh run` enumerates every
current image in the exact `cimmich-public-demo` project, rereads it through the
read-only Immich companion, runs an operator-supplied local provider twice,
commits only a replay-consistent validated result, and then invokes the existing
Face-to-Body linker. `status` reports aggregate completed, detected, no-body,
Body and linked counts. The command is library-wide, fail-fast and
interrupt-safe; it is not a one-asset product shortcut. A checkpoint and Python
runtime must be supplied explicitly through `CIMMICH_BODY_MODEL_PATH` and
`CIMMICH_BODY_PYTHON_PATH`. Cimmich does not bundle that checkpoint, infer its
redistribution rights or turn a detected Body into identity without the
accepted linker policy.

The signed-in `GET /v1/integrations/status` and
`GET /v1/integrations/provider-settings-pack` routes provide the owner-facing
control plane. The settings pack records the provider-neutral intake contract,
two-run replay requirement, known tested settings and official-source links.
It contains no weights or checkpoints. The operator or a Guided client may
obtain a chosen model from its official source; Cimmich validates the resulting
evidence rather than pretending to certify every model/hardware combination.

`cimmich.body-pose-provider.v1` adds optional, replaceable COCO-17 pose evidence
without turning pose into identity. The manifest binds one local-only artifact,
preprocessing/configuration and output space; the result binds the exact
validated Body envelope, source digest and two distinctly identified canonical
runs. Association is unique mutual-best geometry with a minimum overlap and
alternative margin, so weak or symmetric evidence abstains. Only module-issued,
deep-frozen envelopes may produce the minimized receipt or repository
projection. The projection contains stable anonymous Body IDs and normalized
keypoints, never Person/Face ownership, paths, media or vectors.

`cimmich.local-body-pose-worker.v1` is the no-write execution bridge. It binds a
prepared asset revision, post-read source digest, the exact Body envelope and
two local provider invocations under an allowlisted process environment. That
environment removes ambient credentials but is not an operating-system network
or filesystem sandbox; operators must trust provider code or add external
container isolation.
The bundled `ultralytics-yolo-pose` reference pack is optional and ships no
weights. COCO-17 projection requires at least seven keypoints clearing the
manifest threshold; a caller cannot lower that floor. One isolated
operator-local challenge run found 13 Body observations and associated seven
replay-consistent, visually plausible pose results after two sparse six-joint
results abstained. `cimmich.body-pose-current-projection.v1` can reconstruct an
exact visibility-filtered current Body envelope from the immutable schema-52
lineage without writing state. That adapter is source-proven; the lab currently
has no persisted provider Body result, so the real run still used a synthetic
projection revision and does not prove representative accuracy, repository-
current execution, provider recommendation, persistence or identity authority.

Guided V1 also supports `read.local_intelligence_queue`. The result is limited
to 24 Standard-visible anonymous assets and exposes only projection readiness,
Body-analysis readiness, bounded evidence counts and closed work reasons. A
missing current Immich projection is explicit. The local conformance client
retrieves this queue but keeps asset IDs out of its minimized receipt.

`cimmich.asset-detailed-evidence.v3` is the visibility-first read model for the
photo Detailed overlay. It returns distinct canonical `faces`, `bodies`,
`heads` and `presence` collections. Unresolved Faces carry at most five ranked
same-recognition-space cosine-similarity suggestions with backend-owned display
eligibility and a closed abstention reason; the score is never a probability or
identity decision. Bodies include stable geometry/revision heads, available
pose evidence, durable/geometry link state and source, linked Face and accepted
subject projection. Manual Head observations remain separate from Bodies.

`cimmich.detailed-observation-correction.v1` adds revision-safe Face and Body
geometry correction plus reversible `not_face` and `not_body` decisions. Every
command is exact-replay-safe and decision-scoped. Rejection installs a durable
tombstone that prevents ordinary import/rebuild replay from resurrecting the
observation until Undo. Face geometry changes retire matching packs that
reference the old crop and supersede its active embeddings while preserving
accepted human identity truth. The contract never writes Immich or source
media and grants no automatic identity, Prime, activation or training
authority.
