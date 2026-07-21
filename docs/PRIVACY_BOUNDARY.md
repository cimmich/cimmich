# Privacy Boundary

The public Cimmich release tree contains code and synthetic evidence only. The
development estate also preserves internal historical build records, which are
not product or machine-facing terminology.

## Allowed

- migrations and deterministic policies;
- synthetic identities such as `person_alpha`;
- synthetic vectors with no relationship to a real person;
- aggregate benchmark results that cannot identify a person or source path;
- neutral adapter interfaces.

## Forbidden

- real names, aliases, media paths or folder names;
- media, crops, masks, thumbnails or overlays from a private collection;
- real biometric vectors, gallery centroids or vector digests;
- database dumps, XMP sidecars, API tokens, credentials or private hostnames;
- private-fixture-specific import configuration.

Private import/evaluation tools must run read-only against their source and write only redacted aggregate reports outside this repository. Cimmich keeps its derived intelligence in a permanently separate database with separate credentials, migrations, backups and restore. It shares no schema or cross-database foreign keys with Immich and never directly writes Immich database internals or source media. The public companion may authenticate to supported Immich interfaces through the documented versioned adapter.

Schema changes are applied only by `service/bin/migrate.mjs`. The runner holds a
cross-process PostgreSQL advisory lock, verifies an ordered SHA-256 ledger and
records each migration or ordered schema-48 hardening patch in the same
transaction as its SQL. Pre-ledger schema 48
requires the explicit `--adopt-existing 48` path and all 48 source-owned schema
sentinels; it is never inferred from a single latest table or operator claim.

Local detection may read a bounded original still through that supported API.
Those bytes are ephemeral worker input: they are not exposed by Cimmich's HTTP
API and must not enter checkpoints, receipts, logs, fixtures or the Cimmich
database. Only path-free asset revision/content digests, normalized derived
observations and terminal outcomes may persist.

The publication tree also excludes private-fixture suffix interpretation, the
legacy Specialty compatibility write path, inherited private proof/writeback
routes, generated builds, dependency directories and deployment-specific
runtime configuration. A regex leak scan does not prove this architectural
separation.

Body and Presence associations are identity-sensitive data even though they are not biometric vectors. They receive the same local/private handling as face identity records.

Manual subject Presence geometry is normalized image-space metadata stored only
in the separate Cimmich database. It must never be written into Immich/source
metadata, logged with a real subject name, exported as a FaceObservation or
silently admitted to embedding, identity, SourcePack or matching inputs. The
current viewing mode filters the asset before Cimmich lists or mutates the
association; native Immich access remains outside that presentation promise.

Imported Document bytes are a separate Cimmich-owned local-store class. They
must never enter Git, PostgreSQL blobs, logs, matching/model inputs, temporary
browser storage or the Immich database/media tree. The service stores only a
content-addressed mode-0600 file plus checksum/size/provenance in Cimmich's
database, verifies integrity on every read and filters visibility before title,
filename, checksum, link or content projection. A complete operator backup or
privacy removal must treat the separate database and document-store root as one
declared lifecycle; backing up only one is incomplete.

## Local caller trust boundary

Cimmich V1 is a single-user local companion, not a multi-tenant authorization
server. `x-cimmich-actor`, `x-cimmich-principal-id` and
`x-cimmich-device-id` are local attribution and presentation-session inputs;
they are not proof of a remote user's identity. The supported deployment binds
the service to loopback or a private container network and admits only exact
configured UI origins. Publishing the API directly to a LAN or the internet is
outside the supported threat model and requires an independently reviewed
authentication/reverse-proxy contract.

Guided operation does not weaken this boundary. An optional local or remote
client receives a dedicated credential with an explicit canonical authority and
visibility ceiling. The server derives its actor from that credential; caller
actor headers do not grant authority. Personal or Private projection still
requires the bound viewing session and cannot exceed the credential ceiling.
The client may disclose anything it retrieves, and the user/operator accepts
that external-client/provider risk; Cimmich itself does not transmit to a model
provider. Native Immich upload remains direct client→Immich with a separate
user-issued Immich credential. Cimmich never returns that secret or proxies the
uploaded bytes.
