# Document lifecycle and legacy Pet compatibility V1

Schema 48 closes the operational boundary around `cimmich.document.v1` without
changing its public record shape. The lifecycle contract is
`cimmich.document-lifecycle.v1`; the explicit schema-43 bridge is
`cimmich.document-legacy-pet.v1`.

## Combined lifecycle

Run the operator tool from the Cimmich service image so its PostgreSQL client
version and document-store mount match the installation:

```sh
node bin/document-lifecycle.mjs backup --output=/safe/new/backup
node bin/document-lifecycle.mjs verify --input=/safe/new/backup
DATABASE_URL_FILE=/run/secrets/cimmich-empty-target-database-url
export DATABASE_URL="$(cat "$DATABASE_URL_FILE")"
node bin/document-lifecycle.mjs restore \
  --input=/safe/backup --store-root=/safe/empty-store
node bin/document-lifecycle.mjs export \
  --document-id=document_... --output=/safe/new/export
node bin/document-lifecycle.mjs purge \
  --document-id=document_... --confirm=document_...
node bin/document-lifecycle.mjs remove-empty-store \
  --confirm=remove-empty-document-store
```

`backup` holds the same database advisory lock used by imports, exports one
repeatable-read PostgreSQL snapshot, copies each referenced unique content blob,
verifies raw byte count and SHA-256 independently, writes mode-0600 artifacts,
and publishes the manifest last. A backup is valid only when `verify` passes.

`backup` records the exact Cimmich database migration version in the manifest;
the current tool supports schema 48 through the highest checksummed migration
embedded in the same service image and fails closed outside that range.
`restore` accepts only an empty target database and empty target store.
It verifies the complete input first, restores into a staging store, requires
the restored migration ledger to equal the manifest version, checks the
schema-48 Document-lifecycle receipt and exact Document count, and then
atomically publishes the store. It never targets or writes Immich. Historical
schema-48 manifests remain valid and restore as schema 48; they may then be
upgraded only through the normal checksummed migration runner.

`export` writes one Document's user-managed metadata, exact typed links and—only
for a Cimmich-local source—its verified original bytes. An Immich-owned source
remains a stable reference and is not copied through Cimmich.

`purge` requires the exact stable Document ID twice. It walks the complete
edition chain, removes generic links, operations, commands, decisions and
Document visibility state, deletes only now-unreferenced local content, scrubs
the stable ID from retained visibility replay projections, and leaves one
non-identifying count/digest receipt. Files are quarantined until the database
transaction commits. It never deletes an Immich asset or a schema-43 Pet link.
If post-commit unlink fails, the result and durable receipt say
`purged_with_retained_quarantine`/`contentDeleted:false`; the tool never rolls
back the database by deleting the new authoritative content or falsely claims
physical erasure.

`remove-empty-store` requires an exact confirmation and refuses while any local
Document row still references content. Imports and all lifecycle mutations use
one cross-process database lock, preventing cleanup/backup races.

## Schema-47 digest repair

Early schema-47 builds stored a canonicalized JavaScript Buffer digest instead
of the raw file SHA-256. Schema 48 deliberately does not rewrite content from
SQL. With the API stopped, run:

```sh
node bin/document-lifecycle.mjs repair-legacy-digests \
  --confirm=repair-schema47-document-digests
```

The tool locks the store, reads each referenced local blob, accepts only either
the correct raw digest or the exact known schema-47 legacy form, copies verified
bytes to the correct content-addressed key, updates every sharing Document in
one transaction, records a non-identifying repair receipt, and removes the old
blob only after commit. Unknown corruption fails closed. Repeating the command
returns `no_repair_needed`.

## Schema-43 Pet compatibility

Schema-43 `cimmich.pet-document.v1` records remain unchanged and readable.
They are asset associations, not silently converted generic Documents.

- `GET /v1/documents/legacy-pet-links?petId=&includeAdopted=` returns only
  visibility-safe current schema-43 candidates.
- `POST /v1/documents/legacy-pet-links/:legacyAssociationId:adopt` requires
  `x-cimmich-actor` and `{commandId,displayTitle,sourceFilename?,visibilityTier}`.
- `POST /v1/document-legacy-pet-decisions/:decisionId/undo` requires
  `x-cimmich-actor` and `{commandId}`.

An adoption either creates one generic Immich-reference Document or reuses the
one already owning that stable asset, then creates a Pet `about` link if needed.
It never changes or deletes the schema-43 association. Undo removes only the
still-current bridge-created effect; changed Documents or links fail stale.
Re-adoption may reactivate the same archived generic Document, preserving its
stable identity.

Candidate response:

```json
{
  "items": [
    {
      "adoptedDocumentId": null,
      "adoptionId": null,
      "assetId": "asset_...",
      "documentKind": "vaccination",
      "documentLabel": null,
      "legacyAssociationId": "petdoc_...",
      "linkedAt": "2026-07-17T00:00:00.000Z",
      "mediaKind": "image",
      "mimeType": "image/jpeg",
      "petId": "person_...",
      "petName": "Example Pet",
      "state": "available"
    }
  ],
  "schemaVersion": "cimmich.document-legacy-pet.v1"
}
```

Adopt returns `{adoptionId,changed,createdDocument,createdLink,decisionId,
documentId,legacyAssociationId,reactivatedDocument,replayed,schemaVersion}`.
Undo adds `undoneDecisionId`. Exact retries replay; changed reuse returns
`DOCUMENT_COMMAND_CONFLICT`. Other stable failures include
`DOCUMENT_LEGACY_PET_NOT_FOUND`, `DOCUMENT_LEGACY_PET_ALREADY_ADOPTED`,
`DOCUMENT_LEGACY_PET_SOURCE_CONFLICT`, `DOCUMENT_UNDO_STALE` and the existing
visibility/not-found isolation responses.

## Non-claims

These tools are local operator and migration surfaces, not a cloud backup
service, sync protocol, encrypted vault, office editor or Immich ACL. Backup
retention, encryption-at-rest and off-device custody remain operator choices.
