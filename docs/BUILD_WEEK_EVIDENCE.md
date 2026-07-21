# Cimmich — Build Week evidence index

This is the public, privacy-cleared index of evidence supporting Cimmich's
OpenAI Build Week claims. It is designed for judges, maintainers and reviewers
who want to inspect the boundary between prior work and the work completed
during the 13–21 July 2026 Submission Period.

The underlying working record includes dated Codex tasks, implementation
receipts, test output, browser journeys and release checkpoints. This public
index omits private Session IDs, workstation paths, credentials, personal-photo
evidence and internal operational details. The primary Codex Session ID is
provided privately through the official Devpost field.

## Prior-work boundary

Before Build Week, the private Rimmich research project already explored:

- processing a roughly 600 GB, 15-year personal photo archive with local and
  cloud models;
- embeddings, identity resolution, matching quality and archive QC;
- semantic-search goals; and
- experimental Immich-derived People, Machinery, Matching and photo-overlay
  interfaces.

That work supplied the problem, research lineage and an experimental starting
surface. It is prior work and is not claimed as Build Week output.

During Build Week, the project was reframed and substantially extended into
Cimmich: a separate service and database, an owner-facing product across the
memory graph, governed evidence and correction semantics, supported lifecycle
operators, synthetic public demonstration archives, Guided V2 and a broad
release-proof program.

The narrative boundary is recorded in the
[dated extension ledger](BUILD_WEEK_CHANGELOG.md). Upstream Immich and inherited
work are disclosed in [NOTICE.md](../NOTICE.md).

## Dated claim-to-proof map

| Period     | Build Week work evidenced                                                                                                                                              | Public inspection path                                                                                                                                                                                                                    |
| :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13–16 July | Separate Cimmich service/database; Person identity management; distinct Face, Head, Body and Presence evidence; corrections; matching and SourcePack safety boundaries | [migrations](../migrations/), [service tests](../service/test/), [privacy boundary](PRIVACY_BOUNDARY.md)                                                                                                                                  |
| 16–17 July | Read-only Immich companion; restart-safe inventory and media jobs; cumulative visibility; contexts; Documents; Smart Search; typed manual evidence and Undo            | [companion operator](../tools/companion.sh), [context contract](CONTEXT_ENTITY_V1.md), [Documents contract](DOCUMENT_V1.md), [Smart Search contract](BASIC_SMART_SEARCH_V1.md), [visibility operations](VISIBILITY_PRIVATE_OPERATIONS.md) |
| 17–19 July | Forward-only migration runner; backup/restore and lifecycle proof; independent fresh-user and adversarial testing; wholly synthetic Cedar House demonstration          | [migration operations](MIGRATION_OPERATIONS.md), [acceptance tools](../tools/), [Cedar House contract](../demo/cedar-house-v1/README.md), [release readiness](RELEASE_READINESS.md)                                                       |
| 19–20 July | Completed memory-graph experience; Guided V2 machine contract; Codex-operated Space Trip journey; public-package and release convergence                               | [Build Week account](BUILD_WEEK.md), [Guided tests](../service/test/guided-route-catalog.test.mjs), [Space Trip contract](../demo/space-trip-v1/README.md), [Space Trip tests](../service/test/space-trip-demo.test.mjs)                  |
| 21 July    | Release reconciliation; inherited-versus-new disclosure; judge path; final matching/onboarding and public-package checks                                               | [README](../README.md), [extension ledger](BUILD_WEEK_CHANGELOG.md), [release readiness](RELEASE_READINESS.md)                                                                                                                            |

## Reproducible verification surfaces

The repository exposes the same classes of checks used during development:

```bash
cd service && npm test
cd ..
./tools/run_migration_runner_acceptance.sh
./tools/run_synthetic_acceptance.sh
./tools/run_public_demo_bootstrap_acceptance.sh
```

The web package separately exposes formatting, lint, Svelte, TypeScript, unit
and production-build checks. Exact frozen-checkpoint counts and remaining gates
are recorded in [release readiness](RELEASE_READINESS.md); counts are not used
here as a substitute for running the checks against the published revision.

The public demo operator provides the shortest product-level review path:

```bash
./tools/public_demo.sh up
./tools/public_demo.sh status
```

It creates only its named, loopback-bound demonstration stack. The Cedar House
and Space Trip packages contain synthetic media, prompts, provenance, rights,
attribution and manifests. They demonstrate product behaviour, not biometric
accuracy or demographic fairness.

## Count receipt

The release-count reconciliation freezes the public demonstration as:

- **Cedar House V1:** 51 assets;
- **Space Trip V1:** 6 assets;
- **combined demonstration:** 57 assets.

The deterministic pristine Cedar House semantic tuple is
`51:9:12:5:4:0`. The preserved combined owner state is
`57:8:15:5:18:0`; it contains deliberate owner-journey changes and is not a
second pristine-bootstrap claim. Dated 50- and 56-asset checkpoints remain
valid historical receipts but are superseded as current release counts.

## What the evidence does not claim

- Cimmich did not begin from an empty repository.
- Cimmich does not claim authorship of Immich or inherited Rimmich work.
- Synthetic demonstration media is not a matching benchmark.
- Passing tests does not prove universal biometric accuracy or fairness.
- Zero active SourcePacks means no automatic identity authority is active in
  the public demonstration.
- Private mode is a presentation boundary inside authenticated Immich, not
  encryption or hostile-host protection.
- GPT-5.6 Sol and Codex helped build and test Cimmich and completed the optional
  Guided Space Trip journey; they are not required runtime dependencies.

## Privacy review

This index intentionally contains no:

- private Codex Session ID;
- local absolute filesystem path;
- credential, API key, token or secret;
- real personal-photo identifier or media;
- private archive output or biometric vector; or
- internal agent/fleet architecture.

Reviewers with access to the official submission can use its Codex Session ID
and video alongside this repository to validate the development record.
