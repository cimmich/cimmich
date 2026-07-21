# Cimmich UI fork baseline

Date: 2026-07-14
Fresh-eyes review: 2026-07-16

This directory is the dependency-complete Cimmich fork of the current local
Rimmich UI working tree, based on Immich 3.0.1. Today it is honestly a
Cimmich-owned People/Identity slice inside an inherited Immich-backed shell,
not yet a standalone Cimmich application.

## Preserved scope

The fork intentionally preserves the complete current UI surface, including
library intelligence, extended summaries, People, Places, Trips, Events,
Activities, Pets & Objects, Documents, Smart Search, QC, Maintenance, overlays,
viewer integrations, and their supporting routes and services.

No feature is removed from this fork unless the project owner explicitly selects
it for removal.

## Data boundary

Generated builds and dependency directories may exist in this local development
working tree, while `web/static/rimmich-data` and private evidence remain outside
the intended release boundary. None may enter a clean public Cimmich repository.
Private media, names, paths, crops, embeddings, and evidence payloads remain in
protected local storage and are served through the Cimmich-owned local
data/service boundary.

Inherited machine-specific roots are configuration, not source constants. The
advanced RMP+/QC/readback routes accept environment-based proof, preparation,
release, correction-contract, and media roots (`RIMMICH_RMP_*`,
`RIMMICH_FULL_ARCHIVE_QC_*`, `RIMMICH_RFF_*`, and `CIMMICH_MEDIA_ROOT`) and use
neutral local defaults when they are absent. Synthetic fixtures contain neutral
names and `/media/library`-style paths.

## First Cimmich binding

The People surface reads the Cimmich Person index, exposes candidates only when
the operator chooses that lane, and can submit explicit reviewed decisions.
People/Pets/photo failures are visible and retryable, and Person links carry the
stable Cimmich Person ID rather than treating a mutable display name as identity.
The inherited private evidence bundle is optional enrichment, not a page-load
requirement. The service owns
PostgreSQL access; the browser never receives a database connection. For the
current private fixture only, a protected ID-only bridge maps neutral Cimmich
asset IDs to local source-application asset IDs for previews. It contains no
paths and is not a required Cimmich dependency.

Local development keeps the inherited shell backend configurable through
`IMMICH_SERVER_URL`; `.env.local` supplies the current ignored deployment value,
while `.env.example` documents the neutral loopback shape. The Cimmich API is
separately configured through `PUBLIC_CIMMICH_API_URL`.

## Verification

- production build: pass
- Svelte diagnostics: 0 errors, 0 warnings
- TypeScript: pass
- service tests: see the current acceptance receipt; counts are not a release contract
- source and rebuilt-output private-path/name scans: pass
- Cimmich fresh-schema database/service contract and bounded leak scan: pass
- disposable local-service decision proof: queue 1 → 0 and user decisions 0 → 1

The upstream GNU AGPL v3 licence is retained in `LICENSE`.

## 2026-07-16 release-boundary finding

Preserving the full inherited surface remains the operator's explicit product choice for
the private laboratory. It also means this fork is not currently a public Cimmich
application: Rimmich routes, terminology, proof loaders and writeback machinery
remain present. Public release requires a deliberate partition into a clean
Cimmich shell; it must not be achieved by silently deleting useful private
features from this working UI.
