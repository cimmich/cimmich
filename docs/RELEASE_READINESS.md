# Cimmich release-readiness checklist

Updated: 2026-07-22
Preserved public-demo runtime: schema 75/patch 1
Current source/disposable candidate: migration-ledger schema 75/patch 1

This is the go/no-go checklist for publishing Cimmich source, a downloadable
demo and launch media. It separates product proof from legal/publication choices
and from matching claims that have not cleared their gates.

## Current proved baseline

- Supported companion base: Immich 3.0.3.
- Preserved public-release dataset: 51 Cedar House assets plus six Space Trip
  assets (57 total). The keeper recording runtime adds two film-only synthetic
  scenes and runs on schema 75/patch 1.
- Deployed public-demo visibility projections: 17/17 enforced, including
  `immich_onboarding`; the untouched internal main remains 16/16.
- Current schema-75 Backend source proof includes the atomic partial-inventory
  scope rollover, resumable onboarding import and dedicated Unknown/Noise
  owner-resolution provenance. The schema-75 candidate passes service 588/588;
  migration acceptance
  passes fresh, 72→73, current no-op, concurrent, checksum-drift,
  interrupted/resumed and legacy-restore paths; the complete disposable
  synthetic product acceptance passes, including exact Place/Thing/Event
  create/update no-change and decision-scoped Undo. The integrated web proof is
  757 passed/2 skipped with Svelte 0/0, TypeScript, formatting and production
  builds from the deployed schema-72 release boundary. The exact deployed API/UI
  pair then passed signed-in
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
- [ ] Initialise or export a clean public Git repository with no private history.
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
- [ ] Freeze one named `video-ready` state and record the final product demo from
      that exact release build. The completed Guided build recording is retained
      as its own proof; no three-rehearsal requirement exists.
- [ ] Publish matching-improvement language only if one provider-specific
      correction→better-next-suggestion loop clears the existing replay,
      holdout, QC, operator-review and activation gates.

## Devpost submission gates

The [official FAQ](https://openai.devpost.com/details/faqs) and
[Official Rules](https://openai.devpost.com/rules) control. Submission closes
21 July 2026 at 5:00 PM Pacific Time; the working judge path must remain free
and available through the judging period.

- [ ] Devpost registration and **Apps for Your Life** selection confirmed.
- [ ] Human eligibility, entrant/representative status and conflict-of-interest
      declarations confirmed by the entrant.
- [ ] Public repository URL published, or private repository shared with both
      `testing@devpost.com` and `build-week-event@openai.com`.
- [ ] Exact published repository passes its setup/sample-data/test instructions
      without private infrastructure.
- [ ] Primary majority-core task runs `/feedback`; returned Session ID matches
      the private ledger before it is entered into Devpost.
- [ ] Public YouTube video is under 180 seconds, contains English audio, clearly
      demonstrates the working product, and explicitly explains what was built,
      how Codex was used and how GPT-5.6 was used.
- [ ] Final video contains no unlicensed music, copyrighted material or
      third-party trademarks; privacy and credential frame audit passes.
- [ ] Devpost description and public README disclose inherited/open-source work,
      link the dated Build Week extension ledger and preserve all licences and
      notices.
- [ ] Judge download/demo/test path is free, stable and planned to remain
      available through 5 August 2026 at 5:00 PM Pacific Time.
- [ ] Final submission receipt, repository revision, video URL and test-build
      checksum are recorded before the deadline.

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
