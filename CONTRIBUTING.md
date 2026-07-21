# Contributing to Cimmich

Cimmich is being prepared for public contribution. The source licence must be
present at the repository root before outside contributions are accepted.

## Branch and release posture

The exact OpenAI Build Week revision is preserved as
`v1.0.0-build-week`. During its judging freeze, stable `main` remains on that
revision and continued development targets `post-build-week`. After judging,
accepted continuation returns to `main` and normal short-lived feature/fix
branches resume. See the [release strategy](docs/RELEASE_STRATEGY.md).

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
cd service && npm test
cd ../ui/web && pnpm run check:typescript && pnpm run check:svelte
cd ../.. && ./tools/run_synthetic_acceptance.sh
```

Web changes should also pass the affected Vitest files, Prettier, scoped ESLint,
and the production build. Migration changes must pass fresh, upgrade,
interruption, concurrency, checksum-drift, and restart proof. Never edit an
applied migration; add the next contiguous migration instead.

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
