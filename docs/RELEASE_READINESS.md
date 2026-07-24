# Cimmich release-readiness checklist

Updated: 2026-07-22
Preserved public-demo runtime: schema 75/patch 1
Current source/disposable candidate: migration-ledger schema 77/patch 1
Publication identity: `v1.0.0-build-week` at
`9b40c1b3b353f4e2e10aa91462ad821793ef043b`

This is the go/no-go checklist for publishing Cimmich source, a downloadable
demo and launch media. It separates product proof from legal/publication choices
and from matching claims that have not cleared their gates.

Schema 77 is the post-submission Public Beta development line. Schema 76 added
persisted Person display framing; schema 77 repairs unnamed-Person onboarding
follow-up admission. The tagged Build Week release and its preserved schema-75
runtime remain the submission baseline.

## Current proved baseline

- Supported companion base: Immich 3.0.3.
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
