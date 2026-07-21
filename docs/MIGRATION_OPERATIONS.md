# Migration operations

Cimmich owns a separate PostgreSQL database. Its schema is changed only by the
bundled migration runner; Immich's database is never inspected or changed by
this process.

## Guarantees

- Numbered migrations are contiguous from `0001` and retain their exact source
  SHA-256 after application.
- The runner holds a PostgreSQL advisory lock for discovery, validation and
  application. Concurrent starts serialize safely.
- Each migration SQL body and its ledger row commit in one transaction.
- New applications record bounded SQL execution duration; explicitly adopted
  historic rows retain null duration because fabricating old timing is worse
  than recording it as unknown.
- Ordered schema-48 hardening patches use a separate checksummed patch ledger.
  The runner applies each patch immediately after its declared base migration
  and before any later migration; current order is 1…48 → 0048_0001 → 49…66.
- Missing, reordered or edited applied source fails startup. The service health
  response derives `schemaVersion` and `schemaPatchLevel` from the ledgers.
- A database with schema objects but no ledger is never guessed. The only
  supported bootstrap is explicit `--adopt-existing 48`, which verifies 48
  source-owned sentinels before recording the historic chain and applying any
  pending schema-48 patch.

## New installation or routine upgrade

The production container runs the migration runner before opening the HTTP
listener. Operators can also run it directly from `service/`:

```sh
DATABASE_URL=postgres://... npm run migrate -- apply
```

Create and verify a separate Cimmich database backup before an upgrade. Never
point `DATABASE_URL` at the Immich database.

## One-time adoption of a pre-ledger schema-48 database

1. Stop the Cimmich API while leaving Immich untouched.
2. Create and checksum a restorable Cimmich-only database backup.
3. Run:

```sh
DATABASE_URL=postgres://... npm run migrate -- apply --adopt-existing 48
```

4. The runner verifies/adopts 1…48, applies the schema-48 patch, then continues
   through every bundled later migration. Run it again without
   `--adopt-existing`; it must report no newly applied migration or patch.
5. Start Cimmich and verify `/health` reports the latest bundled schema
   (`schemaVersion` equal to the highest contiguous migration in this source)
   and `schemaPatchLevel: 1`.

For a one-time container adoption, set
`CIMMICH_MIGRATION_ADOPT_EXISTING=48` only for that start and remove it after a
successful receipt. The value has no effect once a valid ledger exists, but
removing it prevents configuration from overstating an ongoing exception.

Do not repair a checksum mismatch by editing the ledger. Restore the backed-up
database and the exact released migration source, then investigate the drift.
