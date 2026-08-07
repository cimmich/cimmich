# Cimmich

> [!NOTE]
> **Current release: Community Preview 6** — exact Immich 3.1.0, Cimmich
> schema 120/patch 1. The immutable
> [OpenAI Build Week release](https://github.com/cimmich/cimmich/releases/tag/v1.0.0-build-week),
> demo and evidence remain preserved and visible as the living project improves.
> Current development source is schema 121; it does not rewrite the Preview 6
> release or the Build Week artifact.

> **Complete the picture.**

<p align="center">
  <img src="docs/assets/cimmich-logo.png" alt="Cimmich astronaut inside a four-colour focus frame" width="220">
</p>

**Cimmich is an open-source, local-first memory companion for Immich.** It adds
People, Pets, Places, Things, Events and Documents around an existing library,
while keeping the archive owner—not a model—in charge of identity.

[Install in five minutes](INSTALL.md) · [Try fictional data](#try-the-fictional-demo) ·
[See current limitations](#current-limitations) · [Build Week evidence](docs/BUILD_WEEK_EVIDENCE.md) ·
[Privacy boundary](docs/PRIVACY_BOUNDARY.md) · [Contribute](CONTRIBUTING.md)

> [!IMPORTANT]
> Cimmich is an unofficial companion project. It is not affiliated with or
> endorsed by Immich or OpenAI. It never directly writes the Immich database or
> source media.

## What it adds

- **Complete people records.** Face, Head, Body and Presence are separate kinds
  of evidence, so a known appearance does not have to pretend to be a face.
- **A connected memory library.** People, Pets, Places, Things, Events and
  Documents have photo-first directories, relationships and real counts.
- **Overlapping context.** A photo can truthfully belong to a trip, recurring
  activity, client engagement and life period at the same time.
- **Intersection search.** Select several Cimmich tags and see only photos with
  all of them, without a hidden 5,000-result ceiling.
- **Owner-controlled review.** Matching can suggest; the owner accepts,
  corrects, merges, rejects or undoes every consequential identity decision.
- **Cumulative presentation modes.** Standard, Personal and optional
  password-gated Private modes control what is comfortable to show on a shared
  screen. They are presentation filters, not encryption or account security.

### The identity boundary, precisely

**Cimmich stores Face, Head, Body and Presence evidence separately from
Immich. Native Immich manual face assignments do not train or damage Immich’s
recognition model.** Cimmich’s distinction is about recording different kinds
of owner knowledge and governing which evidence its own optional matching uses.

No AI model is required. Optional local Face, Body, pose, OCR, object or vision
providers can add observations, but providers never gain identity authority.

## Install beside Immich

Requirements: Docker Compose v2, a working exact Immich 3.1.0 installation,
`curl`, `openssl`, and several gigabytes of free Docker storage.

```sh
cp .env.example .env
# Put a new `openssl rand -hex 32` value in CIMMICH_DB_PASSWORD.
# Confirm the two credential-free Immich URLs; do not put an API key in .env.
docker compose config --quiet
docker compose up --detach --build --wait
```

Open <http://127.0.0.1:3413>, sign in through Immich, add a dedicated read-only
Immich API key in Cimmich’s write-only Settings field, then preview the exact
scope before importing.

Compose builds the API and UI from the exact checked-in Dockerfiles. No Cimmich
registry account or private package access is required. Advanced operators may
override both image names with immutable digests from a registry they trust.

Read [INSTALL.md](INSTALL.md) for download verification, the guarded installer,
backups, updates, local builds and the redacted `cimmich doctor` report.

## Try the fictional demo

The isolated Cedar House demo creates its own loopback-only Immich and Cimmich
stack. It does not discover or operate on another installation.

1. Download the complete
   [Cedar House V1 archive](https://github.com/cimmich/cimmich/releases/download/v1.0.0-build-week/cimmich-cedar-house-v1.tar.gz).
2. Verify its documented SHA-256 in
   [the demo guide](demo/cedar-house-v1/README.md), then extract it.
3. Start the isolated project:

```sh
export CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT="$PWD/cedar-house-v1"
./tools/public_demo.sh up
./tools/public_demo.sh status
```

The fictional packs carry rights, attribution, prompts, provenance and checksum
manifests. They demonstrate product behavior—not biometric accuracy, fairness
or suitability for another person’s archive.

## Privacy and trust

- Cimmich has its own PostgreSQL database, configuration, documents and backups.
- Original media remains owned and served by Immich.
- Product ports bind to loopback by default; the owner API stays behind the
  authenticated same-origin gateway.
- Optional outbound address search and map imagery are off by default.
- Generated credentials are mode `0600`; diagnostics exclude credentials,
  paths, filenames, media and private identities.
- Third-party infrastructure images are digest-pinned. Cimmich product images
  are versioned, attested and published from immutable GitHub workflow actions.

See [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md) and the
[release-readiness proof](docs/RELEASE_READINESS.md).

## Build Week and prior work

Cimmich was built for **OpenAI Build Week — Apps for Your Life** with Codex
powered by GPT-5.6 Sol. The exact submission remains available as:

- the immutable [v1.0.0 Build Week release](https://github.com/cimmich/cimmich/releases/tag/v1.0.0-build-week);
- the [demo video](https://youtu.be/CfR_r0n4deQ);
- the [privacy-cleared evidence index](docs/BUILD_WEEK_EVIDENCE.md); and
- the [competition boundary and prior-work disclosure](docs/BUILD_WEEK.md).

Cimmich began from an Immich-derived private research seed before the event.
Those earlier archive-processing, matching, search and experimental UI efforts
are disclosed and are not claimed as Build Week work.

## Current limitations

- Community Preview, not a general-availability release.
- Exact Immich 3.1.0 only; other versions are added one tested release at a time.
- macOS and Linux are the supported guided-install hosts; native Windows is not.
- No biometric-accuracy or demographic-fairness claim is made.
- Private mode is a presentation filter, not encryption.
- Some large inherited and preview-era files remain; CI freezes their ceilings
  and each touched domain must shrink rather than grow.

## Develop and contribute

The service uses npm and Node 22; the Immich-derived UI workspace uses pnpm.
`ui/packages/sdk` is checked-in source, not `node_modules`. See
[DEVELOPMENT.md](DEVELOPMENT.md) for exact commands and architecture, then read
[CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Licensing and upstream attribution are recorded in [LICENSE](LICENSE),
[NOTICE.md](NOTICE.md), [ATTRIBUTION.md](ATTRIBUTION.md) and
[UPSTREAM_BASELINE](UPSTREAM_BASELINE).
