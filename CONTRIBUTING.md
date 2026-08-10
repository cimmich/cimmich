# Contributing to Cimmich

Cimmich welcomes small, reviewable public contributions under the
AGPL-3.0-only licence.

Before changing code, read:

- [DEVELOPMENT.md](DEVELOPMENT.md) for architecture, workspaces and checks;
- [GOVERNANCE.md](GOVERNANCE.md) for product authority and AI-assisted
  development policy; and
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

## Choose the right starting point

Open an issue first for:

- a new product area or broad UX change;
- schema, migration or canonical API changes;
- matching, identity or provider policy;
- privacy, remote access or security boundaries;
- a new supported Immich version or host platform; or
- a change that introduces a dependency, model or external service.

Focused documentation, test and defect fixes may go directly to a pull request
when their scope and expected behavior are clear.

## Non-negotiable product boundaries

- Immich remains the base photo-management product.
- Cimmich owns only its separate derived intelligence, decisions, documents,
  jobs and projections.
- Do not directly write the Immich database or source-media bytes.
- Keep Face, Head, Body and Presence evidence semantically distinct.
- Treat model output as candidate evidence. Automatic identity acceptance and
  training authority remain zero unless a separately reviewed contract says
  otherwise.
- Apply viewing mode before exposing records, counts or mutation targets.
- Keep consequential decisions inspectable, confirmation-gated and reversible.
- Never publish private media, names, crops, embeddings, database dumps,
  credentials, workstation paths or generated model caches.
- Use licensed synthetic fixtures for tests and documentation.

## Keep the change reviewable

A good pull request explains:

1. the user problem and failure being solved;
2. what is deliberately out of scope;
3. the authority and privacy boundary;
4. schema or API contracts consumed or changed;
5. empty, error, replay, conflict and Undo behavior;
6. focused tests and wider regression proof; and
7. limitations or claims intentionally left open.

Prefer one coherent change over a broad cleanup mixed with new behavior.
Generated rewrites, dependency churn and unrelated formatting make product and
security review materially harder.

## Run the relevant checks

Start with the smallest affected test. A normal cross-layer change is expected
to finish with:

```sh
cd service
npm run check:syntax
npm run format
npm run lint
npm test

cd ../ui/web
pnpm run format
pnpm run lint
pnpm run check:typescript
pnpm run check:svelte
pnpm run test -- --run
pnpm run build
```

From the repository root, relevant changes may also require:

```sh
./tools/run_provider_contract_tests.sh
./tools/run_migration_runner_acceptance.sh
./tools/run_synthetic_acceptance.sh
./tools/run_publication_scan.sh
```

Do not claim a check was run unless its terminal result is available for the
exact proposed tree.

## Migrations and providers

Never edit an applied migration. Add the next contiguous migration and prove
fresh install, supported upgrades, interruption, concurrency, checksum drift
and restart behavior.

Provider dependency changes must pin every top-level requirement and audit the
fully resolved graph. A direct-only dependency audit is insufficient.

Matching changes must separate calibration from untouched evaluation and
account for consequential outcomes through visual review. Aggregate accuracy
alone is not an activation decision.

## Maintainability

Several preview-era files remain larger than the project wants. CI records
temporary ceilings and rejects growth. Do not increase a ceiling or add a new
exception. When a coherent extraction fits the change, reduce the file and its
ceiling together; otherwise explain why the existing debt remains unchanged.

## AI-assisted contributions and attribution

AI-assisted changes are permitted, but they receive the same review, test,
privacy and licensing requirements as other changes.

- Disclose material code-writing assistance accurately in the pull-request
  description.
- Never send private media, credentials, internal paths or private operational
  material to a hosted tool.
- The contributor remains responsible for understanding and defending the
  proposed change.

See [GOVERNANCE.md](GOVERNANCE.md) for the full attribution rule.

## Public communication

Do not imply official Immich affiliation or endorsement. Do not publish
private archive details or accuracy claims derived from a personal collection.
The Cedar House and Space Trip packs demonstrate behavior only; they are not
accuracy or fairness benchmarks.

## Branch and release posture

Living development uses short-lived branches against `main`. Supported user
installation comes from named releases, not arbitrary development commits.

The exact OpenAI Build Week revision remains preserved as
`v1.0.0-build-week`. Later work must not be described as part of that submitted
revision. See [docs/RELEASE_STRATEGY.md](docs/RELEASE_STRATEGY.md).
