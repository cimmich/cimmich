# Security policy

Cimmich is a local-first companion for a photo library. Security reports can
therefore contain unusually sensitive facts even when they contain no media.

## Supported versions

Until the first tagged public release, only the current main branch is under
active security review. A supported-version table will be added with the first
release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Once the public
repository is available, use its private vulnerability-reporting form under
**Security → Report a vulnerability**. Before that channel exists, contact the
project owner privately and wait for a safe intake route.

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

See [Privacy boundary](docs/PRIVACY_BOUNDARY.md) and
[Private viewing operations](docs/VISIBILITY_PRIVATE_OPERATIONS.md) for the
full operational boundary.

## Disclosure

The project will acknowledge a valid report, reproduce it privately, agree on
a remediation and disclosure window, and credit the reporter when requested.
Do not publish exploit details before a fix and operator guidance are ready.
