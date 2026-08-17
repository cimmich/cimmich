# Security policy

Cimmich is a local-first companion for a photo library. Security reports can
therefore contain unusually sensitive facts even when they contain no media.

## Supported versions

| Version                         | Supported                                 |
| :------------------------------ | :---------------------------------------- |
| `v1.1.0-community-preview.10`   | Yes, while Community Preview 10 is current |
| Earlier Community Preview tags  | No; upgrade to the current named release  |
| Public Beta and Build Week tags | No                                        |

`main` is reviewed for the next candidate but is not a substitute for a named
release when reporting an installed-version problem.

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
host administrator. Its password is owner-resettable from Settings without the
previous value by design: Immich owns account access, so a forgotten screen
filter must not become an unrecoverable lockout. Treat anyone with a live
Immich session as able to clear that filter.

Guided is optional and disabled by default. Cimmich does not broker model
provider traffic. Connected software may disclose anything it retrieves, and
the operator is responsible for that disclosure.

The canonical API is a local, single-owner service. Its product containers bind
to loopback, and actor/device headers provide audit attribution rather than a
remote authentication perimeter. Do not expose the API, database, or provider
ports directly to a LAN or the public Internet. If a same-origin gateway makes
the UI reachable beyond loopback, every API route except an intentionally
minimal health check must validate that the current Immich session belongs to
the exact principal durably bound during Cimmich setup before proxying the
request. The shipped gateway delegates that decision to Cimmich's bounded
`/api/users/me` authorizer; valid secondary-user sessions and API keys are
refused. Unsafe owner requests also require the exact configured product Origin.
Forwarding cookies or actor/device headers alone is not authentication. A
remote install still requires TLS, network access controls, and backup
protection appropriate to its environment.

The shipped same-origin gateway listens on unprivileged container port 8080
as the nginx user. Its root filesystem is read-only, all Linux capabilities
are dropped, privilege escalation is disabled, and nginx's bounded runtime
state is confined to a 16 MiB `noexec,nosuid,nodev` temporary filesystem.
These controls limit container impact; they do not make an unsupported public
or directly LAN-exposed installation safe.

The long-lived API also uses a read-only root filesystem, a bounded
`noexec,nosuid,nodev` temporary filesystem, dropped capabilities and
`no-new-privileges`. PostgreSQL drops every capability before adding back only
the five capabilities its official entrypoint needs for initial volume
ownership and user transition. The optional, short-lived face-model installer
uses a read-only root filesystem, drops all capabilities and disables privilege
escalation; downloaded models are checksum-pinned and written only to its
dedicated volume.

Optional Local AI jobs remain on the canonical owner listener and are absent
from Guided. They verify current photo visibility before each read, run one
child at a time with a four-job queue, and do not forward API keys, database
credentials or the parent environment to providers. Temporary originals are
deleted after the run. Derived artifacts are digest-checked and the current
source fingerprint is re-verified before download. Cancellation has a bounded
forced-stop path, and the derived store is capped to 12 runs or 4 GiB. Model
weights are user-supplied and mounted read-only; Cimmich does not infer their
licence or trustworthiness. See [Local AI review](docs/LOCAL_AI_REVIEW.md).

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
