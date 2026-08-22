# Cimmich FAQ

For a friendly walkthrough with exact tasks, open the
[Cimmich Guide](https://benjihagenhart.com/cimmich/guide/). The
[repository user guide](USER_GUIDE.md) is the complete reference.

## What is Cimmich?

Cimmich is the open-source, local-first matcher and memory layer for Immich.
Confirm and correct people, Refresh the matcher with that evidence, and review
what it finds next. Cimmich also connects People, Pets, Places, Things, Events
and Documents beside the photo library Immich continues to own.

## Is Cimmich part of Immich?

No. Cimmich is an unofficial independent project and is not affiliated with or
endorsed by Immich or OpenAI. “Immich” describes the tested base product and
compatibility target.

## Does Cimmich replace or modify my Immich installation?

No. It runs beside Immich with its own database, credentials, migrations,
documents and backups. It does not directly write the Immich database or
modify original media.

## What does Community Preview mean?

The preview is for technically comfortable Immich users who can inspect Docker
Compose, use the checked-in installer, maintain a Cimmich backup and report
reproducible problems. Workflows and schemas may still change.

The current named release is being tested with exact Immich 3.1.0 on macOS and
Linux Docker hosts. Native Windows PowerShell and WSL2 have not yet been tested.
Other Immich versions, Internet-facing deployment and multi-user operation are
outside this preview's tested boundary.

## Which version should I install?

Install [Community Preview 19](https://github.com/cimmich/cimmich/releases/tag/v1.1.0-community-preview.19)
and use its Cimmich tar or ZIP plus `SHA256SUMS`. `main` contains living
development and may be ahead of the named release.

## Why does Cimmich look like Immich?

The web shell is derived from Immich so the existing photo viewer, account and
navigation remain familiar. Cimmich adds its own named routes and runs a
separate service, database, document store and lifecycle. The inherited source
and licence are recorded in [the UI lineage record](../ui/CIMMICH_FORK.md).

Open Cimmich at <http://127.0.0.1:3413> after installation. Opening the normal
Immich address takes you to Immich itself.

## Can I try it without my own photographs?

Yes. The isolated Cedar House demo runs its own loopback-only Immich and Cimmich
stack using fictional, rights-cleared media. Follow the
[demo guide](../demo/cedar-house-v1/README.md).

The demo proves product behavior and lifecycle controls. It does not prove
biometric accuracy, demographic fairness or real-person consistency.

## Do I need an AI model?

Not for core organisation. People matching does require a compatible local
face-analysis provider to supply observations and embeddings. Cimmich remains
the matcher: it builds and evaluates the reference library, ranks or abstains,
and keeps identity acceptance with the archive owner. No model weights are
bundled with Cimmich.

## Does Cimmich identify people automatically?

No. Cimmich matching can rank or abstain using compatible, owner-confirmed
evidence from an optional local face-analysis provider, but only the archive
owner can accept who it belongs to. Providers extract observations and
embeddings; they do not own matching or accept an identity.

## Why separate Face, Head, Body and Presence?

They represent different truth. A clear Face may support matching. A visible
Head, a Body appearance or the owner's knowledge that someone was Present can
complete the memory without contaminating the face reference set.

## Can Cimmich handle Pets?

Yes. Pets have their own profiles, media, documents and optional provider
evidence. Different Pet evidence types and vector spaces remain separate. Only
an owner assignment creates Pet identity evidence; Cimmich may abstain and
hold an observation as Unknown.

## What are Enhanced and Guided?

**Enhanced** is an owner-controlled strategy inside Cimmich's matcher. A
compatible local provider extracts observations and embeddings;
Cimmich builds and evaluates the reference library, ranks or abstains, and
keeps every acceptance, correction or rejection with the owner.

**Guided** is an optional authenticated machine-readable interface. Software
chosen by the operator can discover only the operations and viewing level it
was granted. Cimmich stores no model-provider API key and does not make provider
requests itself.

## Does local-first mean nothing can ever leave my computer?

Core Cimmich and its built-in local operators do not require a hosted model.
If you enable map services or connect external software through Guided, data
may leave according to that service or client's behavior and the access you
grant it. Local Cimmich cannot make third-party software private.

Read [the privacy guide](../PRIVACY.md) before enabling optional outbound paths.

## Is Private mode encryption?

No. Standard, Personal and Private are presentation filters inside an
authenticated session. Private mode may add a local screen password, but it is
not encryption, an ACL, a vault or protection from the host administrator.

Think “what is comfortable to show on this screen,” not “who can access the
host.” Immich continues to own account access.

## Why can an Immich user reset the Private-view password?

Because Private mode is a presentation filter, not a second account system. An
already authenticated Immich user can reset or disable it so a forgotten value
does not become an unrecoverable data lockout. Any reset ends the open Private
session.

## How do I install Cimmich?

Download and verify the named release bundle, then follow
[INSTALL.md](../INSTALL.md). The tested end-to-end path is the checked-in
installer:

```sh
./tools/install.sh --check
./tools/install.sh
```

It creates the private runtime state used by backup, restore, diagnostics and
removal. The root Compose file remains inspectable, but running it directly is
not a second complete lifecycle. The guide explains host addressing, the
first-run preview, backup, updates, diagnostics and removal.

## Why do I sign in and also create an API key?

They do different jobs. Your normal Immich session authenticates the browser.
The dedicated read-only key lets the Cimmich service read library inventory and
original assets for the features you choose.

Create the key in Immich **Account Settings → API Keys** with current-user read,
asset read/download, Face read and Person read only. Enter it only in Cimmich's
write-only Settings field. Cimmich verifies the key before import, and you can
revoke it later from Immich. See the
[exact steps](../INSTALL.md#4-create-the-dedicated-immich-api-key).

## How long does the first start take?

A cold source build commonly takes 4–10 minutes while locked dependencies and
container layers are prepared. Hardware, network and Docker cache state vary.
Use `./tools/install.sh --status` rather than repeatedly recreating the stack.
The [Cimmich Guide](https://benjihagenhart.com/cimmich/guide/#trouble) covers
deeper checks. No CPU or memory minimum has been certified;
the [install guide](../INSTALL.md#resource-expectations) states the current
resource boundary without inventing one.

## Can I remove Cimmich without harming Immich?

Yes, when using the installer-created exact-project operator. `disable` and
`up` preserve Cimmich state. Confirmed removal targets only Cimmich's project,
volumes and dedicated state directory.

Back up first. Removal deletes Cimmich-owned context, decisions and documents;
it does not remove Immich or original media.

## How do backup and restore work?

A normal backup covers Cimmich's database, documents, configuration and
provider state for the same installation. Restore verifies checksums, project
identity, schema compatibility and semantic counts before replacement.

Portable export carries the Cimmich database and Documents store to another
installation while excluding original media, Immich credentials and provider
artifacts. Exact media content can reconnect after inventory even when paths or
Immich UUIDs changed. See [archive mobility](ARCHIVE_MOBILITY.md).

## What existed before OpenAI Build Week?

The underlying archive problem, identity and matching research, semantic-search
exploration and an experimental Immich-derived UI seed predated the event. The
Build Week work and prior-work boundary are recorded in the
[Build Week account](BUILD_WEEK.md) and
[evidence index](BUILD_WEEK_EVIDENCE.md). The exact submission remains
preserved as `v1.0.0-build-week`; later product work does not rewrite it.

## How was Cimmich built?

Benji holds product direction, acceptance and release authority. The product
problem, privacy and identity boundaries, compatibility target, acceptance
gates and release decisions are human-owned. Living Cimmich development uses
substantial AI assistance coordinated and accepted under that authority; the
historical Build Week tooling and inherited Immich-derived web foundation are
separately attributed. See [project governance](../GOVERNANCE.md).

## How is Cimmich licensed?

Cimmich source is AGPL-3.0-only with preserved upstream and third-party notices.
The repository contains an adapted Immich web foundation. See
[NOTICE.md](../NOTICE.md) and [the UI lineage record](../ui/CIMMICH_FORK.md).

Cedar House and Space Trip carry their own licence, attribution, provenance and
checksum material, which must travel with the packs.

## Where do I report a bug or request a feature?

Use the repository's GitHub issue forms and include a minimal synthetic
reproduction. Never attach real photographs, embeddings, credentials, database
dumps, host paths or private library details.

## How do I report a security issue?

Do not open a public issue. Follow [SECURITY.md](../SECURITY.md) and use GitHub's
private vulnerability-reporting route.
