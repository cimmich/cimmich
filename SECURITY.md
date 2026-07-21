# Security policy

Cimmich is a local-first companion for a photo library. Security reports can
therefore contain unusually sensitive facts even when they contain no media.

## Supported versions

Until the first tagged public release, only the current main branch is under
active security review. A supported-version table will be added with the first
release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
[private vulnerability-reporting form](https://github.com/cimmich/cimmich/security/advisories/new)
under **Security → Report a vulnerability**. If that form is temporarily
unavailable, do not place sensitive details in a public issue; wait for the
private intake route to return.

Include the smallest reproducible description, affected version or commit,
impact, and any proposed mitigation. Do not attach real photos, crops, face or
body embeddings, database dumps, credentials, host paths, private names, or
source-library metadata. Use synthetic fixtures wherever possible.

## Security boundary

Cimmich keeps its derived state in a database separate from Immich and must not
write the Immich database or source-media bytes. Private viewing mode is a
local presentation convenience inside an already authenticated Immich session;
it is not encryption, an access-control list, a vault, or protection from a
host administrator.

Guided is optional and disabled by default. Cimmich does not broker model
provider traffic. Connected software may disclose anything it retrieves, and
the operator is responsible for that disclosure.

The canonical API is a local, single-owner service. Its product containers bind
to loopback, and actor/device headers provide audit attribution rather than a
remote authentication perimeter. Do not expose the API, database, or provider
ports directly to a LAN or the public Internet. A remote or multi-user install
must add a separately reviewed authenticated reverse proxy, TLS, network access
controls, and backup protection; Cimmich does not claim those controls itself.

Treat backups, provider artifacts, configuration volumes, and Document-store
exports as sensitive. Keep them mode-restricted and encrypted at rest where the
host or backup destination is shared. Restore only through the checksummed
operator flow, which validates project identity, schema compatibility, semantic
counts, archive members, and credential shape before replacing state.

See [Privacy boundary](docs/PRIVACY_BOUNDARY.md) and
[Private viewing operations](docs/VISIBILITY_PRIVATE_OPERATIONS.md) for the
full operational boundary.

## Disclosure

The project will acknowledge a valid report, reproduce it privately, agree on
a remediation and disclosure window, and credit the reporter when requested.
Do not publish exploit details before a fix and operator guidance are ready.
