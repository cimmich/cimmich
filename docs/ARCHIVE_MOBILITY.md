# Archive mobility

Cimmich treats media content as durable identity and treats Immich UUIDs,
filesystem locations and storage roots as replaceable source bindings.

## Identity model

`cimmich.hash-linked-archive-mobility.v1` separates four concerns:

- `media_content` is one exact byte identity.
- `media_content_fingerprint` records an algorithm-labelled SHA-1 or SHA-256
  digest. Production Immich inventory streams the original and records
  byte-verified SHA-256. Upstream checksums are metadata only because Immich may
  expose `sha1-path` without its algorithm.
- `asset_content_link` binds the stable opaque Cimmich asset used by Faces,
  Bodies, People, decisions and jobs to that exact content.
- `asset_source_binding` records where an instance is currently visible.
  Immich UUIDs, filesystem locators and trusted-import IDs live here, not in
  Cimmich's intelligence identity.

One asset may therefore have several active source bindings. Moving a file,
rebuilding Immich or observing an exact duplicate does not create a second
intelligence graph.

## Reconciliation law

Inventory resolves supported media in this order:

1. stream the read-only Immich original and compute SHA-256;
2. adopt the one active Cimmich asset already linked to that fingerprint;
3. derive a new stable content-linked Cimmich asset when no match exists;
4. retain the replaceable Immich UUID as a source binding, never content
   identity.

An exact fingerprint linked to multiple legacy Cimmich assets is ambiguous and
fails closed. Cimmich does not silently merge their intelligence. A source
binding that later reports different bytes moves to a new content-linked asset;
the old asset and its intelligence remain intact, and binding history records
the transition.

Perceptual hashes and visual similarity are candidate signals only. They never
grant exact content identity.

For restored assets that predate byte verification, pipe one closed command to:

```sh
npm --prefix service run bind-verified-content
```

The `cimmich.verified-content-binding.v1` JSON object contains only actor and
command IDs, one Immich source tuple, SHA-256 and byte length. Paths are not
accepted. Exact replay is write-stable; command reuse with changed input,
conflicting byte length or an already-linked different content identity fails
closed.

## Portable export

The portable format carries Cimmich-owned state without carrying the media
owner or target-machine secrets:

```sh
./tools/companion.sh portable-export /safe/new/cimmich-portable
```

The new directory contains:

- `cimmich.dump`;
- `documents.tgz`;
- `manifest.json`;
- `SHA256SUMS`.

It explicitly excludes original media, Immich credentials and user-supplied
provider artifacts. The exporter checks semantic counts before and after,
verifies every checksum, rejects unsafe archive members and proves the database
can restore and migrate before publishing the directory.

Restore into an already configured target:

```sh
./tools/companion.sh portable-restore \
  /safe/cimmich-portable \
  --confirm=cimmich-companion
```

Portable restore replaces the Cimmich database and Documents store only. It
preserves the target installation's Immich credentials and provider artifacts.
Configure the new Immich installation with a distinct
`CIMMICH_IMMICH_SOURCE_ID`, then run inventory. Exact content reconnects to
existing Cimmich assets; new content enters normal processing; absent old
bindings remain historical/offline rather than deleting intelligence.

Use ordinary `backup` / `restore` for complete same-installation recovery,
including credentials and provider artifacts. Use `portable-export` /
`portable-restore` when moving Cimmich-owned intelligence to another
installation.

## Storage and Docker preflight

Archive attachment must not begin while local build storage is unbounded or the
working volume lacks an explicit reserve.

Generate a no-delete Cimmich image retention plan:

```sh
npm --prefix service run docker-image-retention -- \
  --output=/absolute/new/cimmich-image-plan.json
```

The planner protects images referenced by every running or stopped container,
keeps two additional rollback images for each known deployment repository,
classifies disposable acceptance builds, and retains unknown Cimmich image
families for review. It does not delete by default. Execution requires both the
explicit destructive confirmation and the exact plan digest from the reviewed
dry run; a changed Docker inventory fails closed and requires a new review.

Prove an explicit working-space and post-operation reserve budget:

```sh
npm --prefix service run storage-budget-preflight -- \
  --path=/absolute/cimmich-working-volume \
  --required-working-bytes=NUMBER \
  --reserve-bytes=NUMBER
```

The required working budget is for Cimmich's database, Documents, temporary
artifacts and bounded processing—not a false assumption that read-only source
media must be copied locally. A blocked result is a hard stop for archive
attachment.

## Acceptance

The synthetic mobility journey proves:

- the same bytes under different paths, source IDs and Immich UUIDs reuse one
  Cimmich asset;
- multiple exact duplicate bindings remain visible without duplicate
  intelligence;
- an existing Face observation survives relocation;
- changed bytes create a different asset rather than inheriting old evidence;
- source-binding history retains the transition; and
- portable export/restore excludes media, credentials and provider artifacts
  while preserving semantic counts.
