# Cimmich release-readiness checklist

Updated: 2026-08-03
Preserved public-demo runtime: schema 75/patch 1
Current source/disposable candidate: migration-ledger schema 119/patch 1
Preserved submission identity: `v1.0.0-build-week` at
`9b40c1b3b353f4e2e10aa91462ad821793ef043b`
Current public-beta target: `v1.0.1-beta.6`

## Current source audit addendum — 2026-08-01

The deployed schema-107/patch-1 feature source is
`d05f60464218790f38ce602384c93c420e757bc5`. It reconciles the migration-ledger
source with the private archive and adds recoverable bulk Organise operations.
The final source gate passes 816
service tests with two skipped, 938 web tests with two skipped, zero Svelte
errors or warnings, TypeScript, formatting, lint, production build, migration
acceptance through schema 119, and the complete disposable synthetic lifecycle.

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

Schema 78 opened the post-submission Public Beta development line (current source is schema 119; see the header). Schema 76 added
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
The live X1 proof is recorded in
`docs/X1_XMP_SIDECAR_RECOVERY_2026-07-27.md`.

Schema 96 turns the remaining exact imported-name groups into a bounded owner
triage surface, ordered by unresolved Face count so the People already present
throughout the archive lead the work. A replay-safe command resolves the full
group to an existing or new Person, records user-origin claims and preserves
the immutable original import classification. Alias collisions, pre-existing
identity conflicts and fuzzy matches fail closed.
The live X1 proof is recorded in
`docs/X1_XMP_NAME_RESOLUTION_2026-07-27.md`.

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

## Public Beta Patch 6 candidate

The patch-6 candidate adds the owner-facing product surface for the
post-submission identity machinery rather than publishing database work without
a usable review loop:

- known-Person and recurring unnamed-Person suggestions are separate;
- Face evidence, Head/Body/Presence appearance, Display framing and Review are
  separate jobs on a Person profile;
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
