# Cimmich FAQ

## What is Cimmich?

Cimmich is an open-source, local-first companion for Immich. It adds a separate
memory and evidence layer for People, Pets, Places, Things, Events, Documents,
search, viewing modes and owner-controlled matching. Immich remains the photo
management system.

## Is Cimmich part of Immich?

No. Cimmich is an unofficial independent project and is not affiliated with or
endorsed by Immich or OpenAI. “Immich” is used to describe compatibility with
the base product.

## Does Cimmich replace or fork my Immich installation?

No. Cimmich runs beside a supported Immich installation. It keeps its own
database, credentials, migrations, documents and backups. It does not directly
write the Immich database or modify original media.

## Why separate Face, Head, Body and Presence?

They represent different kinds of truth. A clear Face may be useful matching
evidence. A visible Head without a usable face, a located Body, or a person the
owner knows was Present can complete the memory without contaminating the face
reference set.

## Does Cimmich identify people automatically?

No. Enhanced can rank possible matches from compatible, owner-confirmed
evidence, but the archive owner remains the identity authority. Cimmich can
abstain, and no released SourcePack or model can accept an identity
automatically.

## Do I need an AI model to use Cimmich?

No. Core works with human-owned and inherited library truth. Enhanced,
evidence providers and Guided clients are optional and separately configured.
No model weights are bundled with Cimmich.

## What is Enhanced?

Enhanced is Cimmich's included, owner-disabled matching component. Once the
owner deliberately configures compatible local evidence, it can build governed
references and rank possible matches. The public release proves the workflow
and control boundaries; it does not claim representative biometric accuracy or
fairness.

## What is Guided?

Guided is an optional, separately authenticated machine-readable interface. A
client chosen by the operator can discover only the catalogued operations,
grant and viewing ceiling available to it. Cimmich stores no OpenAI or other
model-provider key and does not make provider requests itself.

## Does local-first mean nothing can leave my computer?

Core and the supported local operators do not require a hosted model. If an
operator connects hosted software through Guided, information retrieved by
that client may leave the computer according to the client's behavior and the
operator's grant. Local Cimmich cannot make a hosted client private.

## Is Private mode encryption or access control?

No. Standard, Personal and Private are cumulative presentation modes inside an
authenticated session. Private may have an additional local view lock, but it
is not encryption, an ACL, a vault or protection from the host administrator.

Think of it as deciding what is on screen, not who may sign in. It answers
"someone is scrolling my photos beside me" and "the TV is running a slideshow".
Immich provides the access security, and switching to Immich shows everything
by design.

## How do I set or change the Private password?

**Settings → Private view password**, then one button to set it, reset it or
turn it off. A reset never asks for the previous password: the caller has
already signed in to Immich, and because this only filters presentation, a
forgotten value must not become a permanent lockout. Any change immediately
ends an open Private session. Headless and recovery paths are in
[Private viewing operations](VISIBILITY_PRIVATE_OPERATIONS.md).

## Can I try Cimmich without using my own photographs?

Yes. Follow [Try Cimmich](../README.md#try-cimmich-with-fictional-data) to launch an isolated,
loopback-only Immich 3.0.3 and Cimmich demonstration using the fictional Cedar
House archive. The optional six-image Space Trip extension demonstrates a
Guided album-organisation journey. Both packs include licensing, attribution,
provenance and checksums.

## What does the synthetic demo prove?

It proves installation, product behavior, viewing modes, evidence semantics,
Guided operations and lifecycle handling. It does not prove biometric
accuracy, demographic fairness or real-person consistency.

## Which Immich version is supported?

The current release candidate is proved against exact Immich 3.0.3. Later
Immich versions need their own compatibility proof before being claimed as
supported.

## How do I install Cimmich beside my library?

Use the [guided installation](../INSTALL.md#guided-install-recommended) on
macOS or Linux. Download the named Cimmich install bundle from the newest
Public Beta release, extract it, start Docker, then run:

```sh
./tools/install.sh --check
./tools/install.sh
```

The check explains prerequisites without changing the computer. Installation
creates Cimmich's separate Docker project but does not ask for an Immich API key
or import any library state. The signed-in setup screen handles the dedicated
read-only key and exact preview later. Native Windows PowerShell is not
currently supported.

## How long does installation take?

The guided check is immediate. A cold first build commonly takes 4–10 minutes
while pinned images and locked web dependencies are prepared. Hardware,
network and Docker cache state can change that time.

## Can I remove Cimmich without harming Immich?

Yes, when using the supported exact-project operators. Normal stop, restart and
down operations preserve Cimmich state. Confirmed reset, destroy or remove
commands target only the named Cimmich project. Read [INSTALL.md](../INSTALL.md)
before any destructive lifecycle command and back up first.

## How do backup and restore work?

Cimmich backs up its own database, documents and configuration. Restore is
confirmation-gated and preflights manifests, checksums, project identity,
database readability, schema compatibility and semantic counts before
replacement. It does not back up or restore Immich media.

## What parts existed before OpenAI Build Week?

The original problem, archive-processing and local/cloud-model experiments,
identity/matching research, semantic-search exploration and an experimental
Immich-derived UI seed predated Build Week. The Cimmich service, data model,
product experience, operators, Guided interface, synthetic demonstrations and
proof program are mapped in the dated
[Build Week changelog](BUILD_WEEK_CHANGELOG.md) and
[evidence index](BUILD_WEEK_EVIDENCE.md).

## How is the project licensed?

Cimmich source is AGPL-3.0-only with preserved upstream and third-party
notices. Cedar House and Space Trip are independently licensed demonstration
packages; their licence, notice, attribution, manifest and provenance files
must travel with them.

## Where should I report a bug or request a feature?

Use the repository's GitHub issue forms and include a minimal synthetic
reproduction. Never attach real photos, face/body embeddings, credentials,
database dumps, host paths or private library details.

## How do I report a security issue?

Do not open a public issue. Follow [SECURITY.md](../SECURITY.md) and use GitHub's
private vulnerability-reporting route once the repository is public.
