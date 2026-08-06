# Cimmich development guide

## Repository shape

Cimmich has two deliberately separate JavaScript workspaces:

| Workspace  | Runtime | Package manager                      | Why                                                                          |
| :--------- | :------ | :----------------------------------- | :--------------------------------------------------------------------------- |
| `service/` | Node 22 | npm with `service/package-lock.json` | The Cimmich-owned local service is a small independent Node application.     |
| `ui/`      | Node 24 | pnpm with `ui/pnpm-lock.yaml`        | The UI retains the Immich web monorepo structure and its workspace packages. |

Do not run npm inside `ui/` or pnpm inside `service/`. There is no competing
lockfile inside either workspace.

`ui/packages/sdk` is **not** `node_modules`. It is the seven-file,
auto-generated `@immich/sdk` TypeScript source workspace retained from the
Immich web foundation so its inherited client is built with the UI. Cimmich's
exact Immich 3.1.0 compatibility claim comes from the stock-Immich lifecycle
acceptance, not from silently relabelling that inherited package version.
Installed dependency trees are ignored and must never be committed. Upstream
lineage and licensing are recorded in `NOTICE.md`, `ui/LICENSE` and
`ui/CIMMICH_FORK.md`.

## Install dependencies and run checks

```sh
cd service
npm ci
npm run check:syntax
npm run format
npm run lint
npm test

cd ../ui
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @immich/sdk build
cd web
pnpm run format
pnpm run lint
pnpm run check:svelte
pnpm run check:typescript
pnpm run test -- --run
pnpm run build
```

Release-level changes also run:

```sh
./tools/run_provider_contract_tests.sh
./tools/run_migration_runner_acceptance.sh
./tools/run_synthetic_acceptance.sh
./tools/run_publication_scan.sh
```

## Maintainability policy

The Community Preview accumulated several large implementation files during
the product sprint. They are tested but harder to review than they should be.
`tools/check_source_shape.mjs` records the current temporary ceilings and fails
CI if an oversized file grows or a new production file exceeds 1,000 lines.

When changing an oversized file, prefer extracting one coherent domain,
service, state manager or presentation module. Reduce its recorded ceiling in
the checker in the same pull request. Do not add new exceptions.

Use named constants for policy, limits, timeouts, retry counts and thresholds.
Inline numbers remain appropriate for self-evident arithmetic, array indexes,
HTTP status codes, geometry percentages and short UI transition values.
