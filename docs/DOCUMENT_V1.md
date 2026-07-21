# Generic Document V1

`cimmich.document.v1` is Cimmich's Basic, model-free retrieval contract for
important life documents. It is deliberately not a document editor.

## Ownership and boundaries

- Metadata, links, decisions and commands live only in Cimmich's separate
  PostgreSQL database.
- A source is either an existing stable visible Cimmich asset reference
  (`immich_asset`) or an explicitly imported file (`cimmich_file`).
- Imported bytes live in the configured Cimmich document store, outside the
  relational database and outside the source Immich library.
- No route writes an Immich row, source-media byte, Face, Body, Presence,
  identity claim, embedding, matching input or model-training input.
- This is local organisation and presentation, not encryption, a vault, an
  Immich ACL or an office suite.

## Configuration

- `CIMMICH_DOCUMENT_STORE_ROOT`: absolute or service-resolved local directory.
  If absent, references and reads remain available but file import fails with
  `DOCUMENT_STORE_NOT_CONFIGURED`.
- `CIMMICH_DOCUMENT_MAX_FILE_BYTES`: per-file limit, hard-capped at 25 MiB.
- `CIMMICH_DOCUMENT_MAX_STORE_BYTES`: total unique-content quota, default
  10 GiB and hard-capped at 1 TiB. It cannot be smaller than the per-file cap.

Files are content-addressed as `<sha256[0:2]>/<sha256>`, written through a
mode-0600 temporary file and atomic rename. Re-importing identical bytes reuses
the same stored content without consuming quota twice. Every content read
rechecks both size and SHA-256.

`GET /health` includes:

```json
{
  "documentStore": {
    "configured": true,
    "maxFileBytes": 26214400,
    "maxStoreBytes": 10737418240,
    "usedBytes": 1234,
    "writable": true
  },
  "schemaVersion": 48
}
```

## Stable values

Source kinds are `immich_asset|cimmich_file`.

Document kinds are `veterinary|vaccination|registration|insurance|adoption|receipt|care|identity|lease|contract|certificate|correspondence|financial|booking|manual|other`.
`other` requires `documentLabel`.

Subject kinds are `person|pet|place|object|event`; relation kinds are
`about|belongs_to|issued_to|applies_to|related`. Database triggers recheck
Person/Pet and Place/Object/Event isolation.

## Projection

A Document detail has this shape:

```json
{
  "documentId": "document_00000000000000000000000000000001",
  "documentKind": "lease",
  "documentLabel": null,
  "displayTitle": "Home lease",
  "effectiveVisibilityTier": "personal",
  "expiresOn": "2027-01-31",
  "issuedOn": "2026-02-01",
  "links": [
    {
      "displayName": "Example place",
      "relationKind": "applies_to",
      "subjectId": "place_00000000000000000000000000000001",
      "subjectKind": "place"
    }
  ],
  "preview": {
    "available": true,
    "disposition": "inline",
    "mimeType": "application/pdf"
  },
  "revision": 1,
  "schemaVersion": "cimmich.document.v1",
  "source": {
    "assetId": null,
    "byteSize": 1234,
    "contentSha256": "<64 lowercase hex characters>",
    "filename": "lease.pdf",
    "kind": "cimmich_file",
    "mimeType": "application/pdf",
    "sourceContentHash": null
  },
  "status": "active",
  "subjectCount": 1,
  "supersededByDocumentId": null,
  "supersedesDocumentId": null,
  "updatedAt": "2026-07-17T00:00:00.000Z",
  "visibilityTier": "personal"
}
```

List responses are `{items, schemaVersion}` and omit `links`. Dates are exact
`YYYY-MM-DD` values, not timezone-expanded instants. `visibilityTier` is the
Document's current explicit/default tier; `effectiveVisibilityTier` also
includes a referenced source asset's more-restrictive tier.

## Routes

- `GET /v1/documents?q=&documentKind=&subjectKind=&subjectId=&includeArchived=&limit=1..200`
- `GET /v1/documents/:documentId`
- `POST /v1/documents/reference`
- `POST /v1/documents/import`
- `PATCH /v1/documents/:documentId`
- `POST /v1/documents/:documentId/links:attach`
- `POST /v1/documents/:documentId/links:detach`
- `POST /v1/document-decisions/:decisionId/undo`
- `GET /v1/documents/:documentId/content[?download=true]`

Every mutation requires `x-cimmich-actor` and a stable `commandId`. Exact
retries return the stored result with `replayed:true`; different reuse returns
`DOCUMENT_COMMAND_CONFLICT`. Link commands accept 1–100 unique typed links.

Reference/import metadata includes `displayTitle`, `documentKind`, optional
`documentLabel`, `issuedOn`, `expiresOn`, `visibilityTier` and optional
`supersedesDocumentId`. A predecessor must be visible and may have only one
direct successor. The predecessor remains intact.

Import sends raw bytes as the request body. Its metadata is UTF-8 JSON encoded
as unpadded base64url in `x-cimmich-document-metadata`; the request
`Content-Type` becomes the stored MIME type. This avoids placing document bytes
inside JSON or the database.

Safe inline MIME types are PDF, JPEG, PNG, GIF, WebP and plain text. Responses
use `nosniff`, `no-store`, a sandbox CSP and a safe content disposition.
Everything else is attachment-only. Immich-owned sources return
`DOCUMENT_CONTENT_IMMICH_OWNED` with their stable asset ID so the UI can use the
existing supported asset viewer instead of proxying source bytes.

## Visibility and privacy

`documents` entered as the enforced fourteenth visibility surface and is now
one of 15 registered surfaces. List, detail, link
projection and content filter before output. A referenced Document inherits the
more restrictive of its Document tier and source asset tier. Lower modes get a
generic `DOCUMENT_NOT_FOUND`; titles, counts, filenames, checksums, links and
content are not returned. Native Immich access remains Immich-owned.

Document text is not extracted in Basic V1. Search uses only user-confirmed
title, filename, kind/label, exact dates and confirmed entity links. Local OCR,
classification, duplicate suggestions and semantic retrieval remain separate
Standard-derived work.

## Lifecycle truth

Archiving is reversible and never deletes source bytes. Metadata/link/create
decisions are decision-scoped and undoable until superseded. A new edition is a
new stable Document with `supersedesDocumentId`; ordinary edits never replace
or rewrite source content.

Database backup alone is not a complete backup for imported files. Schema 48's
`cimmich.document-lifecycle.v1` operator tool creates and independently verifies
one repeatable database/content-store restore set, restores only into empty
targets, exports one record, purges an explicitly confirmed complete edition
chain, and removes only an unreferenced empty store. Imports and lifecycle
operations share one cross-process database lock.

Schema 48 also provides an explicit no-loss bridge from schema-43 Pet document
associations. Nothing is converted automatically: the legacy association stays
intact while an explicit replay-safe adoption creates/reuses a generic Document
and typed Pet link, with decision-scoped undo. Early schema-47 Buffer digests
have a fail-closed, idempotent local repair command. See
[Document lifecycle and legacy Pet compatibility V1](DOCUMENT_LIFECYCLE_COMPATIBILITY_V1.md).
