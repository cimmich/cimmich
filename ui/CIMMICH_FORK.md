# Cimmich UI lineage and boundary

Current release review: 2026-07-22

This directory contains Cimmich's product UI. Its shell lineage began from the
Immich 3.0.1 web application; the supported companion-server baseline for this
release is Immich 3.0.3. Cimmich retains the upstream AGPL licence and notices
while owning its separate routes, evidence model, service and database.

## Product scope

The inherited Immich shell continues to provide photo-library navigation and
viewer behavior. Cimmich adds its own Home, People, Pets, Places, Things,
Events, Trips, Activities, Life periods, Documents, Smart Search, evidence
overlays, viewing modes, maintenance and Models & Guided surfaces.

Cimmich is an unofficial companion, not an Immich replacement. Inherited
photo-management surfaces keep their upstream identity; Cimmich features are
named as Cimmich and use the separate Cimmich data boundary.

## Data boundary

The browser never receives a database connection. Cimmich's service owns its
PostgreSQL access and reads Immich only through the supported companion API.
Cimmich does not write the Immich database or original media bytes.

Generated dependencies, local builds, private evidence, credentials, runtime
state and source-media paths are development inputs only. They are excluded
from the clean public repository and release archives. Public synthetic
fixtures use neutral fictional identities and paths.

The Immich shell backend is configured through `IMMICH_SERVER_URL`; the
Cimmich API is configured separately through `PUBLIC_CIMMICH_API_URL`. Local
ignored environment files may supply deployment-specific values, but machine
paths and secrets are not source defaults.

## Current public boundary

The public source no longer contains the former Rimmich product routes,
terminology, proof loaders, private evidence roots or private writeback
machinery. Stable Cimmich IDs, visibility-first reads and typed owner decisions
are served through the supported Cimmich API.

The upstream GNU AGPL v3 licence is retained in `LICENSE`.
