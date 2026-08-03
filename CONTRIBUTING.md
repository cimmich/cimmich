# Contributing to Cimmich

Cimmich welcomes small, reviewable public contributions under the repository's
AGPL-3.0-only licence. Start with an issue for broad product or schema changes;
focused documentation, test and defect fixes may go directly to a pull request.
Participation is also governed by the [community code of conduct](CODE_OF_CONDUCT.md).

## Branch and release posture

The exact OpenAI Build Week revision remains preserved as
`v1.0.0-build-week`. Living development uses short-lived feature/fix branches
against `main`; Community Preview candidates are frozen on dedicated release
branches. See the [release strategy](docs/RELEASE_STRATEGY.md).

## Before opening a change

- Keep Immich as the base product. Cimmich owns only its separate derived
  intelligence, decisions, documents, jobs, and projections.
- Do not write the Immich database or source-media bytes.
- Keep Face, Head, Body, and Presence evidence semantically distinct.
- Treat model output as candidate evidence. Automatic identity acceptance,
  SourcePack activation, and training authority remain zero unless an explicit
  reviewed contract says otherwise.
- Never commit private media, names, crops, embeddings, database dumps,
  credentials, workstation paths, or generated model caches.
- Use synthetic fixtures for tests and documentation. Media fixtures must carry
  their own licence, notice, attribution, provenance, and checksum records.

## Development proof

Run the smallest focused test first, then the relevant full checks. A normal
cross-layer change is expected to pass:

```sh
cd service
npm run check:syntax && npm run format && npm run lint && npm test
cd ../ui/web
pnpm run format && pnpm run lint
pnpm run check:typescript && pnpm run check:svelte
pnpm run test -- --run && pnpm run build
cd ../..
./tools/run_migration_runner_acceptance.sh
./tools/run_synthetic_acceptance.sh
```

Start with affected tests while iterating; the commands above are the final
cross-layer gate. Migration changes must pass fresh, upgrade,
interruption, concurrency, checksum-drift, and restart proof. Never edit an
applied migration; add the next contiguous migration instead.

Provider dependency changes must keep every top-level requirement pinned and
pass an audit of the fully resolved dependency graph. A direct-only audit is
not sufficient release proof.

## Change design

Keep a change bounded and explain:

1. the user story and failure being solved;
2. the authority and privacy boundary;
3. schema or API contracts consumed or changed;
4. replay, conflict, visibility, Undo, and failure behavior;
5. focused and full proof;
6. anything intentionally not claimed.

Changes that touch matching must separate calibration from untouched holdout,
account for every consequential outcome through visual QC, and fail closed on
regressions or missing evidence. Aggregate accuracy alone is not an activation
decision.

## Public communication

Do not imply official Immich affiliation or endorsement. Do not publish private
operator details or accuracy claims derived from a personal archive. The
synthetic Cedar House demo shows product behavior only; it is not an accuracy or
fairness benchmark.
