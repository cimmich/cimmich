# Cimmich — Build Week extension ledger

This public ledger distinguishes pre-existing context from work completed during
OpenAI Build Week's 13–21 July 2026 Submission Period. It is supporting evidence
for the repository's [Build Week account](BUILD_WEEK.md), not a replacement for
the source, tests or Codex `/feedback` Session ID submitted through Devpost.
The [privacy-cleared evidence index](BUILD_WEEK_EVIDENCE.md) maps the dated work
to public source, tests, contracts and reproduction paths.

## Before 13 July 2026

- Benji had spent several months exploring a private research project called
  Rimmich. It approached the problem from a model-processing direction: combine
  local and cloud models to sort, tag and semantically search a roughly 600 GB,
  15-year personal photo archive containing difficult low-quality and crowded
  images.
- That prior work contributed the original problem, archive-processing and
  model experiments, identity/matching and QC work, semantic-search exploration
  and experimental Immich-derived UI overlays. It did not contain the complete
  Cimmich product listed below.
- Immich and the inherited UI shell are third-party/open-source foundations.
  Their work is disclosed and is not claimed as newly authored Build Week work.

## 13–16 July — core product and evidence model

- Established Cimmich as a separate local intelligence service and PostgreSQL/
  pgvector database beside Immich rather than an Immich database modification.
- Built Person identity management; distinct Face, Head, Body and Presence
  evidence; correction, merge/split, Pet/category and review workflows.
- Diagnosed the original embedding failure, implemented target-centric corrected
  embeddings and built provider/vector-space and SourcePack safety contracts.
- Added the first deterministic Memory Steward and Codex-assisted review path.

## 16–17 July — supported companion and Product V1 breadth

- Added the read-only Immich companion, restart-safe inventory, local media jobs,
  cumulative Standard/Personal/Private projections and visibility-first reads.
- Added Places, Things, Events/Trips/Activities/Life Periods, Basic Smart Search
  and generic linked Documents.
- Added typed manual Face/Body/Presence and standalone Head truth with stable
  replay, conflict handling and decision-scoped Undo.
- Added provider-neutral recognition/body/continuity contracts and fail-closed
  human-review gates.

## 17–19 July — hardening, recovery and independent audits

- Extended the checksummed forward-only migration chain, exact backup/restore,
  restart, disable/remove and disposable acceptance programs.
- Ran fresh-install and expanded adversarial product audits, then closed their
  reproducible P0/P1 defects and repeated clean regression runs.
- Built the wholly synthetic Cedar House public demo archive with
  prompts, provenance, rights, attribution, hashes and a deterministic operator.
- Reconciled the product name and public boundary so Rimmich remains historical
  fork/build context rather than a user-facing product identity.

## 19–20 July — full product, Guided V2 and public demonstration

- Completed the photographic People and Pet experience, contexts, Documents,
  search, map, visibility, body-pose presentation and owner-facing correction
  journeys.
- Added Guided V2: a separately authenticated, provider-neutral machine bootstrap
  that publishes canonical API schemas, authority/visibility ceilings, replay,
  conflicts, Undo and verification links without brokering model credentials.
- Codex powered by GPT-5.6 Sol used Guided V2 discovery to add and configure the
  six-photo Space Trip archive end-to-end, including inventory, typed evidence,
  Event/Place/Thing context, visibility, search, replay and Undo.
- Completed the release proof, clean publication-tree audit and the combined
  Cedar House plus Space Trip synthetic release-candidate journey with zero
  automatic identity authority.

## 21 July — submission closure

- Reconciled the public README, Build Week account, video plan, licence/notices,
  judge test path and release checklist with the official Devpost FAQ and Rules.
- Completed the schema-66 owner UI sweep: web 739 passed/3 skipped, zero-warning
  lint, Svelte 0/0, TypeScript, formatting and production build; desktop, mobile,
  compact-layout, keyboard, visibility and console/network checks passed.
- Made Face matching a first-class Models & Guided journey. The signed-in owner
  can see provider readiness, accepted-Face evidence coverage and the latest
  owner-derived pack, then run bounded recognition, compile, evaluate and
  activate an already reviewed pack. Final web proof is 744 passed/3 skipped;
  no demo pack, model weight or automatic identity authority is introduced.
- Removed remaining product-facing Rimmich references from the shipped web
  source while retaining Rimmich only as disclosed historical fork/build context.
- Final backend and UI lanes are limited to evidence-backed release closure; held
  matcher claims remain excluded unless their existing QC/activation gates pass.
- Froze the local `cimmich-build-week-rc2` technical candidate at schema 72/patch
  1 with service 578/578, web 757 passed/2 skipped, three clean stock-Immich
  installs, full migration/synthetic acceptance and signed-in desktop/mobile
  proof from the exact deployed API/UI pair. The preserved 57-asset owner state
  remains Standard with 17/17 visibility surfaces and zero active SourcePacks.
- The independent blind empty-state audit caught a cold-demo operator ordering
  defect: a new Compose project attempted to run its project-scoped bootstrap
  image before building it. The operator now builds that local image first, an
  ordering regression test is included, and the corrected clean bootstrap
  reaches ready/ready/ready with the exact pristine `51:9:12:5:4:0` state.

## Scope and claim boundary

Cimmich's Build Week result is the Cimmich-specific service, data model, product
experience, operators, Guided interface, synthetic demo and proof program listed
above. The pre-existing Rimmich concept, experiments and basic UI shell are
prior work, not competition output. Cimmich does not claim authorship of Immich
or inherited upstream code; does not bundle model weights; does not claim
official Immich affiliation; and does not use private media as public
demonstration material.

## Release-count reconciliation

- Cedar House V1 contains 51 assets.
- Space Trip V1 adds six assets.
- The combined public demonstration contains 57 assets.
- The pristine Cedar House semantic tuple is `51:9:12:5:4:0`; the preserved
  owner-modified combined state is `57:8:15:5:18:0`.
- Dated 50- and 56-asset receipts remain historical checkpoints, not current
  release-count assertions.
