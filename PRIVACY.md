# Privacy and data control

Cimmich is a local, single-owner companion that runs beside a supported Immich
installation. This guide explains the practical boundary: what Cimmich reads,
what it stores, what can leave the host, and what removal means.

For implementation-level rules, see the
[technical privacy boundary](docs/PRIVACY_BOUNDARY.md). For vulnerabilities and
deployment risks, see [SECURITY.md](SECURITY.md).

## The short version

- Immich remains the system that owns authentication and original media.
- Cimmich keeps its own database, configuration, documents and backups.
- Cimmich does not directly write the Immich database or source-media bytes.
- Core organisation does not require a model or hosted API key.
- Optional models can suggest evidence; only the owner decides who it belongs to.
- Product ports bind to loopback by default.
- Optional external services and clients are separate operator choices.
- Private mode controls presentation. It is not encryption or account security.

## What Cimmich reads and stores

| Data                                       | Read from                                      | Stored by Cimmich                                                                     | Written back to Immich |
| :----------------------------------------- | :--------------------------------------------- | :------------------------------------------------------------------------------------ | :--------------------- |
| Library inventory and supported metadata   | Supported Immich interfaces                    | Cimmich's own records linking back to each Immich asset                               | No                     |
| Original media bytes                       | Bounded read-only Immich request when required | Not retained as original media                                                        | No                     |
| Local AI review artifacts                  | A deliberate 1–12 photo owner request          | Bounded Cimmich-derived previews/overlays; temporary original work copies are deleted | No                     |
| People, Pets, Places, Things and Events    | Imported or owner-created context              | Cimmich's separate PostgreSQL database                                                | No                     |
| Face, Head, Body and Presence observations | Owner actions or optional providers            | Typed evidence in the Cimmich database                                                | No                     |
| Identity decisions and corrections         | Archive owner                                  | Cimmich decision history                                                              | No                     |
| Imported documents                         | Owner upload                                   | Separate Cimmich document store, indexed by file checksum                             | No                     |
| Configuration and credentials              | Owner configuration                            | Dedicated Cimmich configuration/state                                                 | No                     |

An original still may be read temporarily for a supported local operation. It
may exist briefly in process or browser memory while being viewed or handled,
but it must not be retained in logs, fixtures, checkpoints, diagnostics,
`localStorage`, `sessionStorage`, IndexedDB or Cimmich's API responses.

## Immich access

Cimmich uses your normal Immich sign-in for the supported browser experience.
During setup, it also asks for a dedicated **read-only Immich API key** through
a signed-in, write-only Settings field.

The key needs current-user read, asset read/download, Face read and Person read
only. Cimmich tests those operations before import. See the exact
[API-key setup steps](INSTALL.md#4-create-the-dedicated-immich-api-key).

Do not place an Immich password, token or API key in:

- `.env`;
- a command pasted into an AI conversation;
- an issue, screenshot or diagnostic attachment; or
- a public reverse-proxy configuration.

Cimmich's Compose source contains credential-free Immich URLs only.

## Identity and model authority

Cimmich separates Face, Head, Body and Presence because they represent
different evidence. A model observation is not an identity decision, and Body
or Presence evidence must not silently become face-training material.

Core Cimmich works without a model. Optional local providers may detect or rank
observations, but they cannot automatically accept a Person or Pet identity.
The owner accepts, corrects, rejects, merges or undoes consequential decisions.

The Community Preview makes no representative biometric-accuracy or
demographic-fairness claim.

Optional Local AI review is initiated from the viewer or a small selected set.
Its enhancement images and overlays are derived copies, capped to 12 recent
runs or 4 GiB. They do not replace originals or become accepted identity or
Context truth. Model weights remain separately supplied local artifacts. See
[Local AI review](docs/LOCAL_AI_REVIEW.md).

## Network behavior

The supported deployment binds product ports to loopback or a private container
network. It is designed for one local owner, not as an Internet-facing or
multi-user authorization service.

Cimmich itself does not require a hosted model and does not broker model-provider
traffic. Optional outbound features are separate:

- address search and map imagery are off by default;
- a Guided client is chosen and connected by the operator;
- a client may disclose anything it retrieves according to that client's own
  behavior and the grant the operator gave it; and
- Cimmich cannot make third-party or hosted software private.

Do not expose the Cimmich API, database or provider ports directly to a LAN or
the public Internet. Remote or multi-user deployment needs independently
reviewed authentication, TLS, network controls and backup protection; those are
not claimed by this preview.

When Cimmich reaches Immich on another machine over plain HTTP, the dedicated
API key and requested media cross that network unencrypted. Use plain HTTP only
on a network you trust. Prefer HTTPS with a valid certificate on shared or
untrusted networks; Cimmich does not add TLS to the Immich connection.

## Documents

Imported documents are Cimmich-owned local files. Their bytes are kept in a
separate, mode-restricted store and indexed by checksum. PostgreSQL stores
metadata such as checksum, size, provenance and relationships—not document
blobs.

Document bytes must not enter:

- Git;
- logs or diagnostics;
- model or matching inputs;
- browser storage such as `localStorage`, `sessionStorage` or
  IndexedDB; or
- the Immich database or media tree.

A complete Cimmich backup, restore or removal treats the database and document
store as one lifecycle.

## Viewing modes

Standard, Personal and Private modes are cumulative presentation filters.
Their purpose is to control what appears while someone else can see the screen.
Counts and previews follow the active mode so hidden material is not revealed
through an aggregate.

Private mode is **not**:

- encryption;
- an access-control list;
- a vault;
- protection from a host administrator; or
- a replacement for Immich authentication.

Anyone with an active Immich session can reset the optional Private-view
password by design. A forgotten presentation password must not become an
unrecoverable data lockout.

## Encryption and host trust

Cimmich does not add application-level encryption to its PostgreSQL,
configuration, document or provider volumes. The supported local deployment
trusts the Docker host and its administrator. Anyone who can administer that
host or read its Docker volumes may be able to read Cimmich state.

Use host-level full-disk or volume encryption where appropriate. Encrypt backup
destinations independently when they are shared or portable. Private viewing
mode does not change this boundary.

## Backups, exports and diagnostics

A normal Cimmich backup includes its database, documents, configuration and
provider state for the same installation. A portable export carries the
Cimmich database and document store while excluding original media, Immich
credentials and provider artifacts.

Treat every backup or export as sensitive. Use a protected destination and
encrypt it at rest when the host or destination is shared.

`./tools/companion.sh doctor` produces a redacted report covering version, service health,
schema compatibility, permissions and available storage. It intentionally
excludes credentials, configured origins, filesystem paths, filenames, media
and private identities. Review any diagnostic before sharing it.

## Stopping and removing Cimmich

The documented `disable` and `up` operations preserve Cimmich's named volumes.
Confirmation-gated removal targets the exact Cimmich Compose project, its
dedicated volumes and state directory.

Removal does not remove Immich or original media. It does delete Cimmich-owned
identity decisions, context, documents and configuration unless you preserve a
verified backup first. Follow [INSTALL.md](INSTALL.md) rather than deleting
volumes manually.

## Public issues and security reports

Never attach real photographs, names, embeddings, crops, database dumps,
credentials, host paths or library metadata to a public issue. Use fictional or
minimal synthetic reproduction material.

For a suspected vulnerability, do not open a public issue. Follow
[SECURITY.md](SECURITY.md) and use GitHub's private vulnerability-reporting
route.
