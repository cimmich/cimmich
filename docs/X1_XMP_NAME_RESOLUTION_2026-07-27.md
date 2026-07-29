# X1 XMP imported-name resolution proof

Date: 2026-07-27  
Authority: X1 archive stack  
Result: schema 96/patch 1 healthy; owner review queue live; no name resolved
during deployment proof

## Outcome

Schema 96 turns the archive's remaining unresolved XMP names into an explicit
Memory Steward queue. Groups are ordered by unresolved Face count, so one owner
decision clears the largest amount of already-imported truth first.

Each command must select exactly one existing Person or one new Person name.
Resolution is atomic across the exact source/name group, replay-safe, and
recorded as owner authority. The original sidecar import classification remains
immutable. Alias collisions, fuzzy matches and conflicting current identities
fail closed.

## Local proof

- service suite: 701 passed, one intentional skip, zero failed;
- focused XMP review and integration proof: 92 passed;
- schema 1–96 migration and synthetic product lifecycle: PASS;
- owner-resolution journey: two Faces resolved, exact replay stable, imported
  state preserved and alias provenance retained;
- Svelte diagnostics: zero errors and zero warnings;
- TypeScript check and production web build: PASS.

## Backup and deployment

Before migration, X1 wrote a custom-format PostgreSQL backup to:

`/srv/data4tb/Lake/Cimmich/backups/cimmich-pre-schema96-20260727.dump`

- size: 692 MB;
- SHA-256:
  `efe6c785f027d358a4962dee899fcafe454dedd4033e73b73bb25cdf592cb799`.

The API and UI were rebuilt from the transferred schema-96 source before either
container was replaced. Migration 96 then applied once through the normal
runner-owned startup path.

## Live read-only proof

After promotion:

- API, UI, gateway and database containers are healthy;
- health reports schema 96/patch 1;
- 54,694 `created_mapped`, 7,294 `reused_mapped` and 3,650
  `created_unresolved` evidence rows remain;
- zero owner-resolution commands exist;
- the queue reports 224 unresolved exact-name groups;
- the first 50 groups cover 2,447 Faces;
- their Face counts are descending, from 181 to 20;
- all 50 groups expose three bounded previews; and
- none of those groups reports a conflicting current identity.

The existing X1 administrator credential was recovered from the Mac login
Keychain without printing or placing it in project files. Authenticated visual
review then proved the deployed `/cimmich/steward` surface: 224 names remain,
the 181-Face highest-ROI group renders three real archive previews, and both
existing-Person and new-Person controls are present with the final command
disabled until the owner makes a selection. No identity command was issued.

## Next move

Open Cimmich's review page at `/cimmich/steward` and resolve the highest-return
names first. The initial ten groups cover 1,078 Faces. After a bounded
owner-reviewed cohort, remeasure the remaining name queue and only then schedule
residual Face/Body discovery.
