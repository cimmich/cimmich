# Source-media immutability

Cimmich treats the user’s Immich library and any configured external-library roots as read-only source evidence. Cimmich decisions, tags, context, indexes, credentials, generated reports, managed document copies and model files live in Cimmich-owned storage instead.

## Enforced boundaries

- The Immich companion has an exact route allowlist. It uses `GET` for records and originals, plus `POST /search/metadata` for a read-only search. It permits no Immich `PATCH`, `PUT` or `DELETE` request.
- The display bridge is read-only and only maps Cimmich IDs to Immich IDs and filenames.
- Cimmich organisation uses its own append-only label and membership decisions.
  Collections, tags, favourites and archive choices never call Immich album,
  tag or asset-update APIs.
- The Web boundary test rejects Immich SDK mutation functions from the folder
  manifest, Bulk Organise and selected-photo Cimmich surfaces.
- Local media providers receive source paths for reads. The XMP importer launches a bounded reader and commits parsed evidence to Cimmich’s database; it does not write XMP or source media.
- The production filesystem-writer inventory is locked by `service/test/source-media-immutability.test.mjs`. A new writer fails the test until its destination and purpose are reviewed here.

## Reviewed production filesystem writers

| Surface                                                | Writes only to                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `service/src/documents.mjs`                            | Cimmich-managed document object storage and its temporary files                                                      |
| `service/src/immich-companion-manager.mjs`             | Cimmich’s local companion credential file                                                                            |
| `service/src/local-ai-service.mjs`                     | Bounded Cimmich-owned Local AI work and derived-artifact storage; temporary source copies are deleted after each run |
| `service/bin/bootstrap-public-demo*.mjs`               | disposable public-demo state, bridge and receipt files                                                               |
| `service/bin/refresh-public-demo-immich-companion.mjs` | the disposable demo companion credential                                                                             |
| `service/bin/prepare-public-demo-external-library.mjs` | a newly created demo external-library target populated from fixtures                                                 |
| `service/bin/configure-local-face-provider.mjs`        | Cimmich’s governed local model directory                                                                             |
| `service/bin/document-lifecycle.mjs`                   | Cimmich document backup, restore, quarantine and managed-store paths                                                 |
| evaluation/compile/validation CLIs                     | an explicit operator-selected output/report path                                                                     |

This contract does not claim that a disk, filesystem, backup tool or Immich itself cannot change source bytes. It claims that shipped Cimmich runtime and CLI paths do not do so, and the exact-candidate lifecycle check separately hashes the exercised source set before and after use.

The companion manager re-runs its bounded read-only permission probes when a
stored connection is restored. Direct status consumers therefore receive a
fresh verification result after restart rather than mistaking a working saved
connection for an unverified one.
