# Cimmich release-readiness checklist

Updated: 2026-08-14
Preserved Build Week public-demo runtime: schema 75/patch 1
Current Community Preview release: migration-ledger schema 128/patch 1
Current development source: migration-ledger schema 138/patch 1
Preserved submission identity: `v1.0.0-build-week` at
`9b40c1b3b353f4e2e10aa91462ad821793ef043b`
Current release candidate: `v1.1.0-community-preview.8` for exact Immich 3.1.0

Schema 136 adds review-only own-Person outlier evidence to Possible mistags.
The Mac-local scorer first preserves the stronger-different-Person route, then
checks an accepted Face against the current Person's full confirmed Face set,
including low-quality support. A low absolute score alone is insufficient: the
Face must also fall beneath that Person's conservative lower-tail baseline.
Schema 137 projects that evidence route through the canonical physical-Face
audit view so the review API can render the new rows instead of failing closed.

## Community Preview release contract

The release is English-first and supports guided macOS/Linux installation
beside exact Immich 3.1.0. Native Windows, other Immich versions,
Internet-facing or multi-user deployment, automatic identity acceptance and
representative matching-accuracy claims are explicitly outside this preview.

Release evidence must be produced from one clean immutable commit and include:

- privacy/publication scan and reconciled public documentation;
- named tar/ZIP bundles plus `SHA256SUMS`, with installer preflight from both;
- service, web, Svelte, TypeScript, formatting, lint and production build;
- measured Web coverage across the Cimmich component, manager and service
  modules, with higher per-file floors for privacy/session, mutation,
  bounded-cache, geometry and viewer-presentation paths;
- migration, synthetic, stock-Immich and public-demo lifecycle acceptance;
- schema-75 Patch-6 forward-upgrade and portable restore proof;
- signed-in desktop/mobile walkthroughs of every top-level Cimmich section;
- keyboard, 200% zoom, reduced-motion, failure-state and destructive-action
  recovery checks; and
- one final receipt naming the commit, tree, artifacts, checksums, support
  boundary, known limitations and rollback path.

## Independent-review follow-up gate — 2026-08-11

The local development candidate closes every High, Medium and Low actionable
finding in the independent CD report. Geometry arrows are consumed even at a
clamp boundary and first adjustment feedback uses persistent live regions.
Context tabs use the shared synchronous keyboard-tabs behavior. Identity-audit
query and independent-verification ceilings are durably projected to the owner,
while bounded unnamed-person discovery returns explicit hydrated partial
progress instead of discarding it.

Maintenance retries now use observable exponential backoff, preserve original
failure details, and apply equally to Prime and Body-link projections. Smart
Search never publishes an unsubmitted draft and its lenses own real tabpanels.
The required Web coverage gate measures the full Cimmich component, manager and
service surface, with higher floors on critical modules. Browser acceptance
navigates every Organise mode, verifies the rendered viewer media changes, and
restores Standard mode in `finally`. Disposable Postgres acceptance compares
batch Face-review output byte-for-byte with the single-Face path. The Guided
client rejects redirects, and Compose hardens PostgreSQL, the API and optional
face-model installer in addition to the gateway.

Required proof for this gate is schema-130 migration acceptance, full synthetic
acceptance, the service suite, Web coverage, Svelte/TypeScript/lint/format/build,
source-shape, Compose render and the publication/privacy scan. This remains a
local source gate: it authorizes no deployment or public release.

## Community Preview 8 photo-presentation and portable-lifecycle gate — 2026-08-11

Preview 8 corrects the owner-discovered boundary where Preview 7 could filter
Cimmich detail metadata while an inherited Folder or direct-viewer path still
rendered the protected photo itself. It also closes the macOS lifecycle gap
where the bundle download used `shasum` but backup/restore hard-coded
unpreflighted `sha256sum`.

The candidate requires:

- shared fail-closed presentation admission before Folder/gallery, Timeline and
  direct-viewer media or actions mount;
- immediate removal when the viewing rank drops and Private continuity across
  ordinary authenticated product routes;
- bounded server and client batching, serialisation, mode-versioned caching and
  failure hiding;
- one checksum operator used for ordinary and portable backup verification,
  with installer preflight for `sha256sum` or `shasum`;
- a complete companion backup/restore/portable lifecycle under a PATH that
  exposes `shasum` but no `sha256sum`; and
- public documentation and screenshots audited against the exact candidate,
  preserving all Preview 7 organisation and People-filter capabilities.

The candidate gates closed locally with:

- publication/privacy scan: pass across 1,864 tracked files, with all 191 local
  documentation links and anchors across 69 Markdown files resolving;
- service: 904 passed, 3 intentionally skipped and 0 failed, with syntax,
  formatting and lint clean;
- web: 1,059 passed, 2 intentionally skipped and 0 failed across 148 test
  files, with formatting, lint, Svelte (0 errors, 0 warnings), TypeScript and
  the production build clean;
- source-shape enforcement: pass across 1,011 checked files;
- migration runner, complete synthetic lifecycle and latency guard: pass at
  schema 128/patch 1;
- pinned OpenCV 4.11 detection and recognition: one releasable-fixture
  detection, observation and embedding, zero identity claims and exact replay;
- companion backup, portable restore, fresh import/replay, seven adversarial
  restore rejections, disable and residue-free removal: pass under an isolated
  macOS-style PATH exposing `shasum` but no `sha256sum`;
- Cedar House public-demo import and five-browser-journey proof, interruption
  recovery, adversarial restore rejection, stop/restart/down preservation,
  portable schema-128 restore, secret-boundary checks and residue-free destroy:
  pass against all 51 rights-cleared assets;
- root Compose render, guarded non-mutating installer check and zero known
  production web or service dependency vulnerabilities: pass; and
- signed-in X1 photo-presentation walkthrough: Private revealed the protected
  photo in Folder and direct viewer, Personal and Standard hid it in Folder,
  Timeline and direct viewer, an in-place rank drop removed mounted media
  immediately, and Private persisted across ordinary routes.

Exact clean-tree commit/tree identity, bundles, checksums and hosted proof are
recorded only after the reviewed merge produces the immutable tag target.

## Community Preview 7 archive-review and organisation gate — 2026-08-10

Preview 7 promotes the schema-127 physical-Face review line and the schema-128
archive-organisation line that were already exercised against the private X1
archive. It does not publish private archive data, identities, paths, model
weights or runtime configuration.

The candidate adds:

- bounded physical-Face review, same-photo comparison evidence, manual inline
  correction and a large pannable context preview;
- lazy Person identity loading with waiting-count continuity, scoped asset and
  facet refreshes, short rebuildable caches and request coalescing;
- Cimmich-owned generic labels that never require source-side XMP writes;
- a reviewed, collision-safe folder-to-album manifest with idempotent batches,
  exact checkpoints and operation-scoped Undo; and
- shared People/Person Explore filters for exact privacy, tags/labels, Places,
  Events and Things, including an explicit Standard-to-protected transition.

Publication requires the complete current service/web/provider/migration,
synthetic, stock-Immich, public-demo, installer, publication-scan,
source-shape, extracted-bundle and Docker build gates. Exact commit, tree,
bundle checksums and hosted proof belong in the external release receipt after
the reviewed merge produces the immutable tag target.

The clean-tree candidate gates closed locally with:

- publication/privacy scan: pass across 1,844 tracked files;
- service: 902 passed, 3 intentionally skipped, 0 failed, with syntax,
  formatting and lint clean;
- web: 1,053 passed, 2 intentionally skipped, 0 failed, with formatting, lint,
  Svelte (0 errors, 0 warnings), TypeScript and the production build clean;
- provider contracts: 39 passed, 0 failed, plus pinned OpenCV 4.11 detection
  and recognition against a releasable fixture;
- migration runner: schema 128/patch 1 fresh, schema-75 upgrade, concurrent,
  checksum, resume, legacy-restore, locator-preservation and new-write
  enforcement acceptance;
- complete synthetic lifecycle and the repository latency guard: pass;
- actual stock Immich 3.1.0 provider lifecycle, independent database restore,
  disable and removal with Immich remaining healthy: pass;
- companion fresh import/replay, seven adversarial restore rejections,
  backup/portable restore, disable and residue-free removal: pass;
- public-demo five-browser-journey proof, interruption recovery, adversarial
  restore rejection, stop/restart/down preservation, portable schema-128
  restore, secret-boundary checks and residue-free destroy: pass;
- root Compose render, guarded non-mutating installer check, source-shape
  enforcement and zero known production dependency vulnerabilities: pass; and
- Docker build contexts now exclude generated coverage, Playwright results and
  reports, so lifecycle rebuilds cannot invalidate the pinned dependency layer.

## Community Preview 6 self-contained-install close — 2026-08-07

Preview 6 changes no product behavior or schema. It removes the unpublished
Preview 5 candidate's dependency on separately visible GHCR packages: the
ordinary public Compose path and guarded installer build the exact checked-in
API and UI Dockerfiles locally.

The release required all Preview 5 source/product gates plus:

- root Compose defaults contain no Cimmich registry reference and use local,
  versioned API/UI image names;
- README, `.env.example`, `INSTALL.md` and the guarded installer agree on the
  build-first command and first-run expectations;
- `companion.sh up` builds locally by default while explicit trusted-registry
  overrides retain a pull path;
- install contract tests prevent inaccessible GHCR defaults from returning;
- both named release bundles reproduce the exact Git tree, render Compose and
  build the API/UI Dockerfiles from their extracted contents; and
- logged-out release downloads, checksums, README and Build Week visibility
  pass after publication.

Publication closed at commit
`8c4d4abf220f90e20e5021df770d31cdb0d7c444`, tree
`8d4b261c19370f2e20763768e62a7854e09f2b41`. Logged-out downloads reproduced
tar SHA-256 `6aa99eb514b92a14c6c2c4ef5cc70420865ec96a02e869841db0ecd9352f8080`
and ZIP SHA-256
`3ccf7ce884e28060db71cb67ae8e479590fdafee01887021d397d02e1fc22ba3`.

## Community Preview 5 operability gate — 2026-08-06

Preview 5 deliberately adds no major product area. It turns the supported
release into a more conventional operator artifact: published product images,
redacted diagnostics, real-browser journeys, shorter front-door documentation,
precise identity claims and the first enforced reduction in the largest
repository module.

The candidate must not publish until all normal Preview 4 gates pass plus:

- five browser journeys against an isolated fictional demo;
- API and UI multi-platform image publication with SBOM, provenance,
  attestation, public pull proof and recorded immutable digests;
- healthy and degraded `cimmich doctor` fixtures with redaction assertions;
- focused tag-intersection repository tests after extraction;
- root Compose render for published-image and local-build routes; and
- logged-out verification of the shorter README, install guide, Build Week
  visibility and corrected identity wording.

This section records the candidate contract. Exact commit, tree, image and
bundle hashes belong in the final external release receipt after all gates pass.

The clean-tree candidate gates closed locally with:

- service: 847 passed, 2 skipped, 0 failed, with syntax, format and lint clean;
- web: 989 passed, 2 skipped, 0 failed, with format, lint, Svelte (0 errors,
  0 warnings), TypeScript and production build clean;
- five Playwright journeys passed against a freshly reset Cedar House demo;
- the full public-demo lifecycle passed with onboarding complete, browser
  journeys, secret-boundary checks, restart/down preservation, adversarial
  restore rejection, portable schema-120 restore and residue-free teardown;
- the stock-Immich companion lifecycle passed fresh import/replay, seven
  adversarial restore rejections, backup/portable restore, disable and removal;
- migration, synthetic and 38 provider contract suites passed;
- publication scan, Compose render, local API/UI image builds, doctor redaction
  fixtures and source-shape enforcement passed; and
- repository size moved from 10,669 to 10,427 lines without behavior or schema
  change.

The source and product gates passed, and GitHub produced the attested images,
but anonymous GHCR pull remained blocked by package visibility. Preview 5 was
therefore not published and is superseded by Preview 6 rather than weakening
the public-install contract or moving its existing tag.

## Community Preview 4 repository-trust gate — 2026-08-06

Preview 4 makes the supported repository conventional to inspect before it
changes a host: the production Compose definition is now `compose.yaml` at the
root, `.env.example` names the three required values, Compose itself performs
the exact-Immich preflight, and the manual path is documented before the
guarded installer or optional agent route. The development guide explains the
deliberate npm service / pnpm Immich-derived UI boundary and establishes that
`ui/packages/sdk` is checked-in SDK source rather than `node_modules`.

The maintainability gate records the existing oversized production files,
fails if any grows and refuses new production files over 1,000 lines. Existing
source concentration remains explicit debt rather than being represented as
already refactored. Database schema, product behavior and X1 data are unchanged.

The Preview 4 source candidate closes its local gates with:

- publication/privacy scan: pass across 1,714 tracked files;
- root Compose render and containerized exact-Immich-3.1.0 preflight: pass;
- source-shape check: 928 production files, 32 non-growing legacy ceilings and
  a 1,000-line limit for new files;
- service: 845 passed, 2 skipped, 0 failed, with syntax, format and lint clean;
- web: 989 passed, 2 skipped, 0 failed, with format, lint, Svelte (0 errors,
  0 warnings), TypeScript and production build clean;
- provider contracts: 38 passed, 0 failed;
- migration runner: schema 120/patch 1 fresh, schema-75 upgrade, concurrent,
  checksum, resume, legacy-restore and locator-preservation acceptance;
- complete synthetic lifecycle: pass; and
- full companion lifecycle against stock Immich 3.1.0: fresh import and replay,
  seven adversarial restore rejections, backup/portable restore, disable and
  residue-free companion removal while Immich remains healthy.

The immutable commit, artifact hashes and GitHub CI result are recorded in the
external Preview 4 release receipt after publication from the clean tree.

## Community Preview 3 final gate closure — 2026-08-06

The public candidate now carries one [user-journey acceptance map](COMMUNITY_PREVIEW_JOURNEYS.md)
and one release contract. The immutable commit, tree and bundle checksums are
recorded in the external release receipt after both beginner bundles are built
from the clean tree; keeping that receipt outside the bundle avoids a circular
artifact hash.

The final source gates are:

- publication scan: pass across 1,711 tracked files;
- service: 843 passed, 2 skipped, 0 failed;
- web: 989 passed, 2 skipped, 0 failed;
- service syntax, format and lint: pass;
- web format, lint, Svelte (468 files, 0 errors, 0 warnings), TypeScript and
  production build: pass;
- migration runner: schema 120/patch 1, including explicit Public Beta Patch 6
  schema-75 forward-upgrade with representative assets, People and Faces
  retained;
- complete synthetic lifecycle: pass;
- actual stock Immich 3.1.0 media/provider lifecycle: pass;
- companion install, preview/import, restart, backup, portable restore,
  disable and removal with Immich remaining ready: pass;
- public-demo fresh start, interrupted-state recovery, adversarial restore
  rejection, stop/restart/down preservation, portable schema-120 restore and
  residue-free destroy: pass; and
- deterministic Cedar House bootstrap replay: 51 assets, 9 People, 12
  contexts, 5 Documents, 4 manual tags and 16 non-standard asset overrides.

The `.2` repair candidate also closes all ten findings exposed while filming:
identity tagging fails visibly when a photo is not imported, unavailable-photo
copy names import and viewing-mode recovery, featured Home media follows its
Event, context chips and Body wording are accurate, collection counts follow
filters, Info does not leak across photos, Organise names match visible labels,
the portaled visibility menu works with a pointer, and decision-history counts
declare their current-viewing-mode projection.

Candidate CI dependency audits report zero known web or service
vulnerabilities. Provider contracts pass with an existing cross-platform
outside-root confinement fixture rather than assuming macOS `/private/tmp`.

Signed-in walkthrough proof covers every Cimmich navigation section, all five
Organise modes, Cimmich/Normal Tags, multi-tag photo intersection, Event copy,
save-another, hierarchy, connections and multi-folder admission, the newcomer
setup state and Smart Search failure/retry recovery. Desktop and 390 px phone
reflow have no page-level horizontal overflow; keyboard tab switching and the
tested skip-link/dialog focus contracts pass. Required understanding does not
depend on motion and Cimmich's animated People/Pet treatments include
reduced-motion alternatives.

Normal Chrome native-200% proof changed the CSS viewport from 1,200 to 600 px
and device pixel ratio from 2 to 4. Home, Organise, Tags, Events, Documents,
Search and Maya Identity/Display each retained page-width reflow without
horizontal overflow; Chrome was returned to 100%. The global
`prefers-reduced-motion: reduce` contract and its regression suppress
nonessential animation, transitions and smooth scrolling.

## Current source audit addendum — 2026-08-04

The schema-120/patch-1 replacement reconciles the migration-ledger source with
the accepted product work, closes the final human-workflow findings and adds
recoverable bulk Organise operations. The immutable commit/tree and bundle
hashes are deliberately recorded in the external release receipt after the
clean tree is packaged, avoiding a circular self-reference inside the bundle.
The one canonical gate block above records the current verified totals; this
addendum does not maintain a second, drifting set of counts.

Bulk Organise now confirms two identical complete asset enumerations before a
write, records only API-confirmed changed asset IDs, checkpoints its receipt
after every bounded batch, survives reload, resumes Undo, and blocks a second
operation until the prior receipt is undone or explicitly kept. Person and
Place/Event selectors are searchable rather than silently limited by a
page-sized response.

CI audits each provider requirements file as a fully resolved dependency graph.
The former direct-only `pip-audit --no-deps --disable-pip` check is not accepted
as transitive dependency proof.

This is the go/no-go checklist for publishing Cimmich source, a downloadable
demo and launch media. It separates product proof from legal/publication choices
and from matching claims that have not cleared their gates.

Schema 78 opened the post-submission Public Beta development line (current source is schema 128; see the header). Schema 76 added
persisted Person display framing; schema 77 repairs unnamed-Person onboarding
follow-up admission; schema 78 adds durable, provenance-bound full-library
identity-audit runs and separate review-only queues for untagged matches and
accepted tags worth double-checking. Schema 79 prevents a winning same-photo
derivative from masquerading as independent Prime evidence. Schema 80 records
and verifies the independent reference evidence used by those queues. Schema 81
preserves imported Body- and Head-intended source geometry as unresolved
identity locators rather than silently reducing it to regionless Presence. The
owner’s schema-82 correction binds the retained locator to its resulting typed
tag and decision so unresolved evidence cannot remain as a duplicate. Schema 83
adds review-only, same-species Pet matching proposals and preserves Unknown Pet
rather than forcing the nearest named result. Schema 84 adds hash-linked archive
mobility. Schema 85 exposed a legacy Base64 checksum backfill gap; schema 86
quarantines those inferred links because Immich can return deprecated path
hashes without exposing their algorithm. The tagged
Build Week release and its preserved schema-75 runtime remain the submission
baseline.

Schemas 93–94 add live Person-linked media-work triage and a resident,
resumable, exact-result-bound Body-rectangle lane. They do not add automatic
identity, pose or mask authority.

Schema 95 restores the missing archive-wide XMP seam. Named sidecar Face
regions are read without source writes, paired media is resolved only through
byte-verified SHA-256 content identity, duplicate sources converge, and
interrupted batches resume from path-free item receipts. Exact existing People
may receive trusted-import identity claims; missing or ambiguous names remain
anonymous review evidence. Appended and unambiguous replacement-style sidecars
are both supported, with packet locators kept distinct from media identity.
Private real-library rehearsal evidence remains outside the publication tree;
public claims rely on the synthetic lifecycle and release-candidate gates.

Schema 96 turns the remaining exact imported-name groups into a bounded owner
triage surface, ordered by unresolved Face count so the People already present
throughout the archive lead the work. A replay-safe command resolves the full
group to an existing or new Person, records user-origin claims and preserves
the immutable original import classification. Alias collisions, pre-existing
identity conflicts and fuzzy matches fail closed.
Private real-library rehearsal evidence remains outside the publication tree;
public claims rely on the synthetic lifecycle and release-candidate gates.

Schema 97 restores expired-lease recovery to exact existing-Face claims, so an
interrupted parallel worker can reclaim only its own job while preserving the
ordinary retry and event history.

Schema 98 preserves a corrupt Body source as an exact source-unreadable
abstention with zero observations instead of inventing no-Body evidence.

Schema 99 re-issues the same-photo derivative guard with explicit false
semantics for an empty asset pair, so NOT-guarded audit queries no longer
silently drop candidates on a NULL result.

Schema 100 adds retroactive producer attribution to media_content and
documents the migration 0086 caveat: future cleanups must scope destructive
deletes to their own producer's rows.

Schema 101 adds the missing supporting indexes for the identity-audit,
pet-match and provider-bound media-job claim query shapes (cascading foreign
keys, the lead-scoped review lookup, the pending claim binding, the recent-jobs
list) and recreates the pending pet-suggestion index with the tiebreak order
the review list actually sorts by. Index-only: no table shape changes.
Schema 102 removes the imported_identity_locator runtime paths but retains its
exact dormant rows and constraints. Public service source never produced rows,
but private archive operators may have; migration and backup preflight prove
that removing a reader does not erase imported spatial provenance.

Schema 103 gives identity-audit runs a last_progress_at liveness column so the
interrupted-run sweep fails only runs that have actually stopped progressing
(the fixed 15-minute start-age threshold killed legitimate long runs), and adds
a BRIN index on identity_claim(created_at) for the incremental-audit staleness
probe. No behavior changes for completed data.

Schema 104 re-issues the same-photo derivative guard so assets holding several
active Immich projections (legitimate under schema-84 content-hash mobility)
contribute one deterministic projection per side instead of multiplying the
verdict subquery into a "more than one row" failure that closed every guarded
audit statement. The conservative verdict body is unchanged.

Schema 105 closes the inventory-authority rollover gap. An explicit,
replay-safe owner command requires a completed full successor inventory before
disabling its named predecessor, moving predecessor projections and bindings
to historical/missing state, pausing only jobs whose assets no longer have an
active binding, and recording predecessor-to-successor lineage. It deletes no
Face, Body, identity, media or source evidence.

Schema 106 provides a separately confirmed, replay-safe prune for never-run
inventory-only placeholder jobs. Its predicate fails closed on any attempt,
lease, checkpoint, payload, result, receipt, pipeline dependency, derived
result or unexpected history event. It cannot prune completed or general media
job history, SourcePacks, observations, embeddings, identities or source media.
Schema 107 adds the missing partial index supporting the
media_pipeline_run.detection_job_id foreign key. This is an index-only
maintenance correction: it changes no evidence or identity authority and keeps
dependency enforcement bounded during the schema-106 confirmed prune.
Schema 108 adds Place directory placement independently of visibility and
status, unique photo rollups over visible active descendants, and a replay-safe,
undoable move from one parent's direct assignment to one immediate child. It
does not infer room membership or inherit fabricated geometry. Context children
inherit the strictest ancestor visibility tier, preventing hierarchy or asset
leakage through a less-restricted descendant.
Schema 109 preserves existing rectangular Place areas and adds bounded,
owner-painted polygon geometry for real child-Place outlines. The Place canvas
starts from a focused satellite view but stores only the owner's 3–500-point
boundary; provider tiles are not copied into Cimmich. GPS remains suggestion
evidence and cannot assign a subsection automatically.
Schema 110 separates geographic containment from human Locations, preserves
all existing IDs and media links as unclassified reviewable rows, and adds a
validated Location-to-Geography cross-link without merging the two hierarchies.
Schema 111 removes needless follow-up from that compatibility state: exact
GPS-create command provenance automatically classifies untouched GPS-generated
Places as Geography, while manual and already reviewed Places are unchanged.
Schema 112 keeps internal Location Plans out of latitude/longitude Place
geometry. It stores normalized visual areas for immediate child Locations,
supports multiple named plans, inherits Location privacy and saves each complete
arrangement as one revisioned command with one exact Undo.
Schema 113 adds satellite as the primary Plan background for mapped Locations
without copying provider tiles into the photo library or changing geographic
Place geometry.
Schema 114 persists the owner-aligned satellite centre and zoom, and schema 115
permits honest Plan-only digital enlargement past the provider's final real
tile. Schema 116 keeps Outline as one closed polygon and adds bounded
multi-stroke Paint coverage for disconnected parts of the same child Location.
Schema 117 makes recurring Activity time and ordered Trip stops durable without
creating a second event or route model. Activities may carry one bounded daily,
weekly, monthly or yearly rule inside their honest date window. Trip stops are
ordered forms of the existing Event-to-Place location relation, preserving the
same decision history, visibility boundary, correction path and Undo.
Schema 118 lets a Place use an active accepted photo from any bounded subsection
as its explicit cover. Direct Place covers and Object/Event exact-link cover
rules remain valid; collection, detail and hero projections resolve the same
subtree cover.
Schema 119 lets Events remember bounded source folders for refresh while one
asset identity can participate in several nested or connected memories.
Schema 120 keeps folder/date candidates in an explicit Needs check media lane
instead of silently treating them as Main, ordered Stops or adjacent context.
It also persists bounded Place location provenance and uncertainty alongside
point, area or route geometry without changing source-photo EXIF.
Schema 121 keeps photo corrections in Cimmich: quarter-turn presentation,
capture-time overrides and effective Places are reversible owner decisions and
do not mutate source files or Immich. Likely-sideways Face pose, future dates
and conflicting Places now have separate deterministic Photo details queues.
Schema 122 makes the measured Face reject-noise floor authoritative for identity
matching and retires only unreviewed candidates that should never have entered
the queue; accepted owner decisions remain intact.
Schema 123 materializes Possible people from Cimmich-owned embeddings behind an
explicit Refresh. Page loads are bounded snapshot reads, the previous completed
snapshot stays available during a refresh, and group-to-Person mapping creates
review candidates rather than automatic identity truth.
Schema 124 separates confidently named recurring groups from genuinely unknown
ones. It records a versioned cluster-to-Person proposal with the lead, runner-up,
reference Face and thresholds, projects the group into the named Person's Checks,
and lets the owner move it into ordinary Face review or reject the proposed name.
Neither classification nor projection accepts an identity, and an existing
snapshot can be reclassified without rerunning neighbour discovery.
Schema 125 makes physical Face identity distinct from source observations. It
retains detector, legacy-import and XMP rows, but projects strong one-per-lane
geometry equivalents through one canonical Face. Any group carrying conflicting
accepted People remains unmerged and excluded from matching. The migration
records and retires only unconfirmed graph-v1 candidates, while graph-v2 and all
candidate writes consult the physical-Face boundary. Reconciliation runs only
inside an explicit Possible people Refresh, never from a page load.
Schema 126 completes the physical-Face contract for XMP and review. Containment
reconciles differently sized detector/sidecar regions, overlapping same-Person
XMP observations may converge, and identity audit generation, reference
galleries, review cards and dismissals operate once per physical Face. Accepted
identity and source media remain unchanged.
Schema 127 fixes rotated XMP geometry at the producer boundary. Regions backed
by MWG `AppliedToDimensions` are transformed through EXIF orientation before
storage; legacy coordinates are repaired through an append-only correction
ledger, and their derived embeddings and review proposals are invalidated for
bounded recomputation. Recognition for sidecar regions cannot expand into a
neighbouring face.
Schema 128 keeps generic labels inside Cimmich and records exact browser-driven
folder-album checkpoints. Neither path writes archive sidecars or moves source
media; duplicate titles must be resolved in the reviewed manifest and Undo
removes only memberships proven to have been created by that operation.
Schema 129 adds one durable Immich-owner binding. The gateway now delegates its
session decision to a bounded Cimmich `/users/me` authorizer, rejects a valid
secondary-user session or API key, limits first setup to a closed bootstrap
surface, and requires the exact configured Origin for unsafe owner requests.
Schema 130 durably records both ranked-query and independent-verification
frontiers on every identity-audit run. The owner surface reports partial audit
coverage explicitly, and legacy runs state that they predate complete limit
reporting rather than presenting a bounded queue as exhaustive.
Schema 131 transactionally supersedes Prime identity candidates whenever their
SourcePack stops being active, rejects new candidates from stale or
policy-mismatched packs, and requires the active pack at every review/accept
read boundary. Historical proposals remain auditable but cannot stay actionable.
The Community Preview 8 release remains schema 128; schema 131 is current local
development source pending full lifecycle and live-runtime certification.

## Historical Public Beta Patch 6 certification

The patch-6 candidate adds the owner-facing product surface for the
post-submission identity machinery rather than publishing database work without
a usable review loop:

- known-Person and recurring unnamed-Person suggestions are separate;
- Identity is one Person-profile destination with Overview, Face,
  Head/Body/Presence Appearance, Checks and Display jobs. Checks visibly split
  New matches, same-photo collisions and Possible mistags;
- a negative proposed-name decision opens reassignment instead of discarding
  the unresolved face;
- imported source locators remain explicit owner placement questions and are
  resolved atomically with the resulting typed evidence;
- full-library identity audits and SourcePack challengers preserve abstention,
  independent evidence and held-inactive safety outcomes; and
- Pet matching is species/vector-space-bound and review-only, with a global
  Unknown Pets workspace that can assign a known Pet or reject only the
  detector observation.

The reference Pet providers are weight-free adapters. No model weight, private
archive evidence, private evaluation result or active SourcePack is shipped.
The release makes no representative biometric-accuracy or fairness claim.

The exact patch-6 publication candidate has passed:

- service tests: 701 passed, one skipped;
- web tests: 833 passed, two skipped;
- Svelte diagnostics: zero errors and zero warnings;
- TypeScript, formatting, lint and the production web build;
- fresh, upgrade, concurrent, interrupted/resumed and checksum-drift migration
  acceptance through schema 98;
- the complete disposable synthetic product lifecycle;
- the install preflight and focused Pet matching/provider tests; and
- the same pinned Python provider dependency audit used by CI, with no known
  vulnerabilities in the declared direct dependencies.

The publication scan excludes private archive evidence, workstation paths,
credentials, model weights, generated bytecode and local runtime state. The
Build Week tag, release and downloadable assets are unchanged.

## Current proved baseline

- Supported companion base: Immich 3.1.0.
- Preserved public-release dataset: 51 Cedar House assets plus six Space Trip
  assets (57 total). The keeper recording runtime adds two film-only synthetic
  scenes and runs on schema 75/patch 1.
- Deployed public-demo visibility projections: 17/17 enforced, including
  `immich_onboarding`; the untouched internal main remains 16/16.
- Current schema-75 Backend source proof includes the atomic partial-inventory
  scope rollover, resumable onboarding import and dedicated Unknown/Noise
  owner-resolution provenance. The schema-75 candidate passes service 595/595;
  migration acceptance
  passes fresh, 72→73, current no-op, concurrent, checksum-drift,
  interrupted/resumed and legacy-restore paths; the complete disposable
  synthetic product acceptance passes, including exact Place/Thing/Event
  create/update no-change and decision-scoped Undo. The integrated web proof is
  768 passed/2 skipped with Svelte 0/0, TypeScript, formatting, lint and
  production build green on the same schema-75 source checkout. The preserved
  deployed API/UI pair then passed signed-in
  1280x720 and 390x844 owner acceptance with zero errors in a clean browser
  traversal, no horizontal overflow, Personal-mode direct-route/reload
  persistence and a final Standard/locked handoff.
- The public-demo operator now has one exact lifecycle grammar. `stop`,
  `restart`, and `down` preserve the project databases and named volumes;
  only confirmation-scoped `reset` and `destroy` remove them. A disposable
  cold run proved an owner-state database marker and Documents-volume marker
  across stop/start, restart, and down/up, then proved both disappear only on
  reset/destroy with zero residue.
- Backup restore is destructive only after an isolated preflight has verified
  the exact manifest, checksums, project identity, archive members, database
  readability, migration ledger, forward migration to schema 75, and semantic
  counts. The cold run restored a real schema-74 backup forward to 75 and
  rejected malformed, newer, wrong-project, corrupt, traversal, checksum and
  semantic-count-drift packets before replacement.
- Independent blind empty-state bootstrap caught and corrected a project-image
  ordering defect in `tools/public_demo.sh`. A new exact Compose project now
  builds its local API/bootstrap image before the first migration run and reaches
  ready/ready/ready at the pristine Cedar House `51:9:12:5:4:0` state with no
  prepared Cimmich database, session or provider state.
- Guided V2: one complete six-file Space Trip operation run from discovered
  contracts, with replay and Undo.
- Active SourcePacks in release runtimes: zero. The complete provider-bound,
  evaluated-pack product loop is green in disposable acceptance; the current
  real provider policy has not earned activation.
- Fresh-owner matching setup is source-complete: signed-in UI and Guided V2 can
  read one exact provider/pack next state, run bounded recognition, compile an
  owner-derived proposed pack, evaluate it, record the existing reviewed gate,
  activate or rollback by exact heads and verify the normal Review surface.
  No demo/prebuilt pack or caller-selected provider policy is shipped.
- Accepted inherited Faces now enter the configured provider path without
  detector fiction: the owner scheduler binds the current visible accepted
  Face, active Immich projection, exact source revision/content digest and
  validated provider/vector space, then requires two deterministic provider
  executions before persisting one current embedding. Identity remains accepted
  if provider work is unavailable or abstains.
- Exact public-demo provider setup is live-proved without repository or
  image-bundled weights: the checksum-pinned OpenCV YuNet/SFace adapter processed
  the then-complete 56-image library, persisted 56 current detection results, 64
  Faces and 63 active embeddings, and replayed with zero pending/failed jobs.
  The later 57th asset is the explicit CHA-051 unknown-person review control and
  is not retroactively counted in that historical provider-run receipt. The five-person
  `CHA-023` control produces exactly five Faces at the frozen 0.80 threshold.
  Those Faces now have five explicit user-reviewed identity decisions derived
  from unique accepted Body links and cross-checked against the shot ledger;
  they are not automatic matcher or generic-import output. Active SourcePacks
  remain zero.
- Fresh Immich identity admission is source/disposable and API-deployment green.
  Connection
  credentials are write-only/server-stored; preview freezes visibility/media
  scope and exact counts; import preserves upstream Person/Face IDs/revisions
  and binds only unique current provider geometry. The CHA-shaped fixture binds
  five of five assignments with zero automatic identity or active SourcePack.
  The preserved public demo was migrated through schema 71. Its preview reports 6 unlabeled
  Immich People and 55 assigned Face rows; generic identity import therefore
  fails before writes with `IMMICH_ONBOARDING_PERSON_LABEL_REQUIRED`. Blank
  upstream clusters are never labelled by Cimmich. The preserved demo now runs
  the schema-75 source and current UI.
- Decision 208 fixes one installation with independently useful Core, included
  owner-disabled Enhanced matching and separate optional evidence providers.
  Enhanced now has an executable digest/version/interface boundary with
  enable, disable, compatible update, shadow validation, rollback and
  last-known-good semantics; all mutation commands are replay/conflict safe.
- Guided discovery now includes Pets, Documents, Person merge/unmerge,
  Enhanced owner controls, regionless Presence and bounded decision history.
  Private-tier writes require an actual Private session even when the grant's
  ceiling includes Private; Personal writes remain available from Standard.
- Review ordering labels differentiated, unscored and zero-margin rows
  explicitly and orders useful separation first. Raw similarity remains
  explanatory evidence, never confidence or identity truth.

## Two loops, named precisely

- **Manual correction loop — green:** an owner records or corrects
  Face/Head/Body/Presence truth; the decision persists, reads back, replays and
  can be undone.
- **Governed matching product loop — green in disposable acceptance:** a
  provider-bound correction enters a proposed SourcePack, clears the frozen
  gate, activates, improves a later genuinely unresolved review suggestion and
  preserves human-only acceptance plus replay-safe dismissal/restore of the
  improved review decision. Accepted-identity correction retains its separate
  Not-this-person/Undo contract.
- **Fresh-owner setup loop — green in disposable acceptance:** inherited human
  tags and exact provider-space evidence can be advanced through the canonical
  owner/Guided API. Provider disable leaves Basic truth intact. The fixture
  proves mechanics only and supplies no representative performance claim.
- **Current provider performance loop — red:** no release-runtime pack is active.
  The public CPU SFace baseline is operational but its provider-specific Prime
  policy trailed its same-space baseline; the corrected condition-consensus
  policy also produced no product-valid holdout gain. Neither is activated.

Do not call either one merely “the Golden Loop.” Earlier completion receipts
closed individual machinery, migration or rejection-proof slices. The source
now has the complete consumer path, but zero active release SourcePacks remains
the decisive real-provider fact.

## Stop-ship gates

- [x] Root source licence selected by the project owner and added as
      `AGPL-3.0-only`; preserved upstream and independently licensed demo/
      provider notices remain in force.
- [x] Export a clean publication repository with no private development history.
- [x] Pass the private-path, credential, personal-ID, database, media and
      generated-artifact audit from the exact publication tree.
- [x] Three isolated schema-72 instances (`release1`, `release2`, `release3`)
      each passed configure, local API/UI image build, up, inventory sync,
      status, backup, disable, restore, restart and exact removal against fresh
      stock Immich 3.0.3. Immich remained healthy throughout and every
      disposable Cimmich state was removed. The first run caught and corrected
      a non-portable Compose build flag before the 3/3 proof.
- [x] One immutable schema-75 public-demo cold run passed pristine recovery,
      stateful lifecycle continuity, older-schema forward restore, invalid
      backup rejection, explicit reset/destroy and zero-residue teardown with
      no cached-image assumption.
- [x] Migrate the older internal main deployment through its then-current ledger and prove its
      counts, visibility surfaces and read-only smoke unchanged.
- [x] Record the final product demo from the deployed video-ready build. The
      publication source retains that demonstrated product and adds only the
      bounded, separately proved final-audit repairs to inventory continuation,
      Smart Search, first-run clarity and matching-reference wording. The
      completed Guided build recording is retained as its own proof.
- [ ] Publish matching-improvement language only if one provider-specific
      correction→better-next-suggestion loop clears the existing replay,
      holdout, QC, operator-review and activation gates.

## Build Week submission outcome

The [official FAQ](https://openai.devpost.com/details/faqs) and
[Official Rules](https://openai.devpost.com/rules) controlled the submission.
Benji confirmed the **Apps for Your Life** entry was submitted before the
deadline; the authenticated Devpost receipt and private `/feedback` value are
deliberately not copied into this public repository.

- [x] Public repository: <https://github.com/cimmich/cimmich>.
- [x] Immutable release: `v1.0.0-build-week` at
      `9b40c1b3b353f4e2e10aa91462ad821793ef043b`.
- [x] Exact release CI passed service/release truth, web quality, migration
      acceptance and the full disposable synthetic lifecycle:
      <https://github.com/cimmich/cimmich/actions/runs/29870903618>.
- [x] Public English-language film: <https://youtu.be/CfR_r0n4deQ>,
      177.989696 seconds.
- [x] Cedar House release download independently reverified at 139,905,427
      bytes and SHA-256
      `937b5859635af6f1b775dcbab1e28411b2e6f4a6182b72e003e3ccdda455347f`.
- [x] Public README, film and submission preserve the inherited/open-source
      disclosure and the synthetic-data/licensing boundary.
- [x] The Build Week evaluation setup path is free and is intended to remain available through
      5 August 2026 at 5:00 PM Pacific Time.
- [x] Devpost submission completion was confirmed by the entrant; its private
      authenticated receipt remains outside the public source tree.

## Public repository contents

The publication tree should contain:

- root README, two-audience `INSTALL.md`, AGPL-3.0 `LICENSE`, `NOTICE.md`,
  `SECURITY.md`, `CONTRIBUTING.md` and this checklist;
- numbered Cimmich migrations and service source/tests;
- product UI source plus preserved upstream licence and attribution;
- guided, advanced companion and public-demo operators;
- provider-neutral contracts and settings packs;
- reference provider adapters, official acquisition links and digest rules, but
  no model weights;
- synthetic acceptance fixtures and public-safe docs;
- Cedar House demo metadata and its independent rights/provenance bundle;
- the optional Space Trip V1 six-photo Guided extension, including its own
  licence, attribution, provenance, prompts, manifest and checksums.

It must exclude:

- private-owner media, names, IDs, embeddings, QC artifacts and local runtime state;
- API keys, passwords, tokens, environment files and database dumps;
- workstation paths and internal agent/fleet infrastructure;
- model weights, generated bytecode, caches, build output and `node_modules`;
- private evaluation packs, private SourcePacks and private provider receipts.

## Demo download strategy

Use two versioned, rights-bound layers:

1. `cedar-house-v1`: the deterministic 51-photo base archive and bootstrap.
2. `space-trip-v1`: the six-photo Guided extension and completed-workflow
   manifest.

The complete 57-asset state proves the combined product experience. The Space Trip
source bundle now lives at `demo/space-trip-v1`. Its six admitted PNGs match the
manifest checksums, and its licence, notice, attribution, prompts, provenance
and contact-sheet review surface travel with the extension. The 51-photo Cedar
House archive remains the deterministic base; Space Trip remains an optional
Guided workflow rather than hidden seed state.

The demo pack proves product workflow and privacy-safe presentation. It does not
prove matcher accuracy, fairness or real-person identity consistency.

## Required final commands

From the publication root:

```sh
cd service && npm test
cd ../ui/web && pnpm exec prettier --check .
pnpm run lint
pnpm run check:svelte
pnpm run check:typescript
pnpm run build
cd ../../..
./tools/run_migration_runner_acceptance.sh
./tools/run_synthetic_acceptance.sh
```

Then run the clean-clone companion lifecycle, public-demo reset/bootstrap and
finished-state backup/restore from the exact candidate revision. Record the
final product demo only after that revision is frozen.

## Launch claim boundary

Safe now: local-first Immich companion; separate database; typed
Face/Head/Body/Presence; reversible owner decisions; People/Pets/contexts/
Documents/search; cumulative viewing modes; optional provider-neutral Guided V2.

Held: active self-improving matcher; representative accuracy or fairness;
automatic identity; bundled models; cloud privacy; Private as encryption or
access control; official Immich affiliation.
