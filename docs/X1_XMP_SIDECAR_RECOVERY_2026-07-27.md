# X1 archive XMP Face recovery — 2026-07-27

## Outcome

Cimmich schema 95 patch level 1 is healthy on the X1 archive stack. The
archive's existing named XMP Face regions are now first-class, hash-bound
Cimmich evidence rather than work that must be rediscovered by a model.

The completed reader-v3 import processed:

- 125,572 XMP sidecars without following `.dtrash` or symlinks;
- 39,938 hash-bound photos and 65,646 named Face-region packets;
- 65,638 unique evidence rows after eight exact duplicate regions converged;
- 54,694 newly created mapped Face observations and identity claims;
- 7,294 regions reconciled to existing accepted Face observations;
- 3,650 unresolved Face observations, covering 224 distinct normalized names,
  with no automatic Person creation or identity claim;
- 360 existing People matched through an exact current display name or alias;
- four face-bearing sidecars skipped because their paired media is absent;
- zero ambiguous-name outcomes, zero geometry conflicts and zero source-media
  writes.

The evidence spans 37,132 unique Cimmich assets. Triage changed from
`3,643 / 322 / 115,973` to `35,887 / 1,448 / 82,603` across tiers 0, 1 and 2.
The old tier-0 count was therefore a migration gap, not the archive's real
high-value frontier.

## Authority and binding

The reader supports both common sidecar forms:

- appended: `photo.jpg.xmp`;
- replacement: `photo.xmp` beside one exact-stem eligible media file.

Replacement-style lookup fails closed when zero or multiple eligible siblings
exist. On this archive all 2,837 replacement-style Face sidecars had exactly
one eligible `.jpg` sibling. Each media file is SHA-256 hashed and accepted
only when it resolves through Cimmich's active, byte-verified exact-content
binding. Database rows retain content, evidence and opaque locator digests,
never archive paths.

Identity authority is deliberately narrow. A normalized XMP name may map only
to exactly one current Person display name or alias. The historical private
suffix normalization strips only a trailing `1` or `2`; it does not strip
arbitrary digits. Missing or ambiguous matches remain anonymous evidence.

## Live safety proof

Before migration, the database was backed up to:

`/srv/data4tb/Lake/Cimmich/backups/cimmich-pre-schema95-20260727.dump`

- size: 649 MB;
- SHA-256:
  `9ee4f503ef490d109ffbaeb72484357494c0929bdf4c337b2fbdef439a21e3c2`.

The first 25-photo dry-run predicted 50/50 mapped regions and no conflicts. Its
execute produced 50 evidence rows and exact command replay added nothing.

The initial full reader-v1 command completed and replayed exactly. Coverage
diagnostics then found 2,837 replacement-style sidecars. Reader v2's full
dry-run proved all 39,938 importable photos, but its execute failed closed after
41 item receipts when a photo with both sidecar forms exposed an item-key
collision. No conflicting evidence committed. Reader v3 corrected the source
locator to identify the sidecar packet while continuing to bind ownership by
media hash.

The final command `xmp-x1-archive-20260727-v3` completed with 39,938 item
receipts. An immediate replay returned `replayed: true` and produced no row
delta. Final relational audit found:

- 65,638 evidence rows and 127,153 provenance-source rows;
- 58,344 XMP-created Face observations;
- 54,694 trusted XMP identity claims;
- zero broken asset, content, Face, Person or identity-claim links;
- three completed runs retained plus the one intentionally failed v2 run;
- healthy API/database state at schema 95.1.

## Verification

- full service suite: 696 passed, one intentional skip, zero failed;
- focused XMP reader/import suite: four passed;
- schema 1–95 synthetic migration and SQL acceptance: PASS;
- Python compile and repository diff checks: clean.

Broad Face or Body model discovery remains held. Schema 96 now exposes the 224
unresolved normalized names as an owner-only highest-return-first Steward
queue; its live deployment proof is recorded in
`X1_XMP_NAME_RESOLUTION_2026-07-27.md`.
