# X1 body-triage pilot — 2026-07-27

> Historical note: the tier counts below were correct before archive-wide XMP
> Face recovery, but were not representative of the archive's existing named
> evidence. Schema 95 recovery later changed live tiers to
> `35,887 / 1,448 / 82,603`. See
> `docs/X1_XMP_SIDECAR_RECOVERY_2026-07-27.md`.

## Outcome

Cimmich schema 94 and patch level 1 are healthy on the X1 archive stack.
Body detection now uses the same live, Person-linked media triage as the face
and generic media-job lanes.

The bounded live pilot ran from the Mac accelerator against ten read-only
Immich assets on X1:

- 10 jobs scheduled and 10 completed;
- 8.3 seconds wall time, including one resident YOLO11x model startup;
- exactly two provider runs per asset;
- 145 anonymous Person boxes across the ten group-heavy photos;
- 46 new Body observations inherited 19 existing Person identities through
  accepted Face-to-Body geometry links;
- no automatic identity selection and no source-media writes.

All ten assets were priority tier 0. Together they had 360 distinct accepted
Person associations before this run, proving that the bounded scheduler chose
the intended high-ROI work.

## Live triage

At deployment time the active X1 archive projected:

- tier 0 — 3,643 assets with accepted Person associations;
- tier 1 — 322 assets with valid human observations but no accepted Person;
- tier 2 — 115,973 otherwise unexplored assets.

Priority is a live view, not a copied queue score. New owner decisions therefore
affect subsequent claims without rewriting outstanding jobs. Within a tier,
assets with more accepted People, accepted associations, and human observations
are claimed first; stable asset and job identifiers break ties.

The triage is consumed by:

- generic resumable media-job claims;
- existing and exact face-recognition claims;
- local face-detection claims;
- Immich inventory scheduling;
- Body operator listing and pose selection;
- resumable Body-detection scheduling and claims.

## Corrected first attempt

The first ten-job Body attempt committed no detections. Its replay run
identifiers contained a colon, which the public conformance contract correctly
rejected. Three jobs reached their bounded terminal failure and seven remained
pending.

The worker was corrected to derive portable digest-backed run identifiers and
was advanced from tool version `cimmich-resident-body-detection-v1` to `v2`.
The seven pending v1 jobs were auditably paused as implementation-superseded;
the three failed jobs remain immutable history. Fresh v2 jobs then completed
10/10.

## Proof

- Database backup before schema 93–94:
  `/srv/data4tb/Lake/Cimmich/backups/cimmich-pre-schema93-94-20260727.dump`
- Backup SHA-256:
  `472d3783a5079f424697add614391498d947047ce4978980e0a2b86a38b74e5d`
- Detector configuration digest:
  `719bfb9ee284c659b8e481950548803f3d52a91c7c850685b44e689e0fbf4e98`
- Live health after rebuild:
  `status=ok`, `database=ready`, `schemaVersion=94`, `schemaPatchLevel=1`
- Local service suite:
  692 tests, 691 passed, one intentional skip, zero failures.

## Interpretation

The ten-photo sample is intentionally biased toward highly tagged group photos,
so its 11–23 detections per image must not be extrapolated as an
archive-average Body count. It does show the desired economic property:
compute first enriches photos where existing owner work can immediately turn
anonymous geometry into useful, reviewable Person evidence.
