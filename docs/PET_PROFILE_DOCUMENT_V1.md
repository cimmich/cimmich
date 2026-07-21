# Pet Profile and Documents V1

Migration 0043 adds two independent, local-only capabilities:

- nullable user-managed `breedLabel` on the existing Pet projection; and
- durable manual Pet-to-document links in `cimmich.pet-document.v1`.

## Boundaries

- State lives only in the separate Cimmich database.
- A document references an existing stable active Cimmich asset. In V1 this may
  be an image or video; `documentKind` supplies the semantic document type.
- Document links are not Pet photo Presence, Face/Body evidence, identity,
  recognition or matching input. They never change source media or Immich.
- Visibility filtering occurs in the database query before counts and rows are
  projected.
- `breedLabel` is user-managed only and is never inferred.

## Routes

- `GET /v1/pets/:petId/documents`
- `POST /v1/pets/:petId/documents:attach`
- `POST /v1/pets/:petId/documents:detach`
- `POST /v1/pet-documents/decisions/:decisionId/undo`

Attach accepts one to 100 unique `{assetId, documentKind, documentLabel?}`
records. Detach accepts one to 100 unique `assetIds`. Every mutation requires
`x-cimmich-actor` and a stable `commandId`; exact replay is stable and changed
reuse returns `PET_DOCUMENT_COMMAND_CONFLICT`.

`documentKind` is one of `veterinary`, `vaccination`, `registration`,
`insurance`, `adoption`, `receipt`, `care`, or `other`. The optional trimmed
label is at most 120 characters.

The GET response is:

```json
{
  "items": [
    {
      "assetId": "asset_...",
      "associationId": "petdoc_...",
      "documentKind": "vaccination",
      "documentLabel": "Annual vaccination",
      "linkedAt": "2026-07-17T00:00:00.000Z",
      "mediaKind": "image",
      "mimeType": "image/jpeg",
      "captureTime": null,
      "width": 1000,
      "height": 800,
      "sourceAssetId": "",
      "filename": ""
    }
  ],
  "petId": "pet_...",
  "schemaVersion": "cimmich.pet-document.v1"
}
```

The existing Pet projection additively returns nullable `breedLabel` and the
visibility-filtered `documentCount`. `confirmedMediaCount` remains based only
on accepted Pet media associations and is unaffected by documents.

## Acceptance

Fresh-schema SQL and service acceptance proves breed set/clear/readback,
Person/Pet isolation, exact document kinds, attach/read/no-change/detach/undo,
replay/conflict, stale undo, restart persistence and cumulative
Standard/Personal/Private no-leak behavior. Live deployment followed a
checksum-backed separate-Cimmich backup; disposable live data was fully removed.
