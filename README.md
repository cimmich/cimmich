# Cimmich

> **Complete the picture.**

<p align="center">
  <img src="docs/assets/cimmich-logo.png" alt="Cimmich astronaut inside a four-colour focus frame" width="220">
</p>

**Cimmich is an open-source, local-first companion for Immich.** It adds the
missing memory layer around a photo library: people can be recorded even when a
face is obscured or absent, useful local matching can stay selective, and the
archive owner remains the authority on identity.

Built for **OpenAI Build Week — Apps for Your Life** with **Codex powered by
GPT-5.6 Sol**.

[Watch the Build Week demo](https://youtu.be/CfR_r0n4deQ) · [Install Cimmich](INSTALL.md) · [Read the FAQ](docs/FAQ.md) · [Try the synthetic demo](#try-cimmich) · [Prior work and Build Week boundary](#prior-work-and-build-week-boundary) ·
[Inspect the Build Week evidence](docs/BUILD_WEEK_EVIDENCE.md) · [Read the privacy boundary](docs/PRIVACY_BOUNDARY.md) ·
[Check release proof](docs/RELEASE_READINESS.md) · [See the release strategy](docs/RELEASE_STRATEGY.md) · [Brand asset notice](docs/BRAND_ASSETS.md)

> [!IMPORTANT]
> Cimmich is an unofficial companion project. It is not affiliated with or
> endorsed by Immich or OpenAI. Immich remains the base photo-management
> product; Cimmich stores its own derived state separately and never directly
> writes the Immich database or source media.

**Prior-work disclosure:** Cimmich began from a private Immich-derived research
seed built before Build Week. Its archive-processing experiments,
identity/matching work, semantic-search exploration and experimental UI are
disclosed and are not claimed as competition work. The
[exact boundary](#prior-work-and-build-week-boundary) is recorded below and in
the [privacy-cleared evidence index](docs/BUILD_WEEK_EVIDENCE.md).

## No more choosing between matching accuracy and completeness

Face recognition works best when its reference set contains actual, useful
faces. A memory library has a broader job: it should still know who is in a
photo when a face is turned away, hidden behind a visor, partly obscured or not
visible at all.

Instead of forcing every appearance into a face bucket, Cimmich gives one
person four distinct kinds of owner truth:

| Evidence     | What it means                                                         |           Used for face matching?            |
| :----------- | :-------------------------------------------------------------------- | :------------------------------------------: |
| **Face**     | A visible face associated with a person                               | Yes, only when governed as suitable evidence |
| **Head**     | The person's head is visible, but no usable face is claimed           |                      No                      |
| **Body**     | The person is located through body evidence                           |                      No                      |
| **Presence** | The owner knows the person was there without claiming visual evidence |                      No                      |

That distinction lets Cimmich keep matching evidence clean **without making the
library incomplete**.

## What Cimmich adds

- **More complete people records:** Face, Head, Body and Presence evidence,
  multiple appearances per person, groups, aliases, merge/unmerge and
  correction.
- **A richer memory graph:** People, Pets, Places, Things, Events, Trips,
  Activities, Life periods and linked Documents.
- **Better ways to revisit a library:** person, pet and context pages; maps;
  covers; relationships; filters; and visibility-aware Smart Search.
- **Three cumulative viewing modes:** Standard, Personal and an optional
  password-gated Private presentation mode—a screen filter for shoulder-surfing
  and TV slideshows, set from Settings; Immich still owns account access.
- **Selective local matching:** confirmed owner evidence becomes governed
  references; Cimmich ranks candidates, abstains when evidence is insufficient
  and never accepts identity automatically.
- **Optional model assistance:** separately chosen Face, Body, pose, OCR, object
  or vision providers can add evidence. No model weight is bundled with
  Cimmich.
- **Optional Guided clients:** a local model, Codex or another compatible client
  can discover and use only the catalogued operations, authority and viewing
  ceiling the operator grants.

Every consequential owner decision has provenance, replay behavior and
decision-scoped Undo.

## One product, four boundaries

| Boundary               | Purpose                                                                        | Default                                           |
| :--------------------- | :----------------------------------------------------------------------------- | :------------------------------------------------ |
| **Core**               | People, Pets, contexts, Documents, search, visibility and human-owned evidence | Available without a model                         |
| **Enhanced**           | Included Cimmich matching over confirmed, governed references                  | Owner-disabled until configured                   |
| **Evidence providers** | Optional Face, Body, pose, OCR, object or vision observations                  | Separate install, manifest and licence            |
| **Guided**             | Optional machine-readable access for a client the operator chooses             | Disabled; bounded by grant and visibility ceiling |

Core remains useful by itself. Enhanced does not bundle a model. Providers do
not gain identity authority. Guided is not required to install or use Cimmich.

## See it working

The public demonstration uses fictional, synthetic media so the full product
can be shown without exposing a real person's archive.

- **[Cedar House V1](demo/cedar-house-v1/README.md)** is the established household library: fictional people,
  pets, places, events, documents, visibility states and deliberately difficult
  evidence.
- **[Space Trip V1](demo/space-trip-v1/README.md)** is a bundled six-image extension added to that existing
  library through Guided V2. It proves a real album-organisation journey—not a
  pre-seeded final state.

Both packs carry their own rights, attribution, prompts, provenance and SHA-256
manifests. They demonstrate product behavior, not biometric accuracy,
demographic fairness or suitability for another person's archive.

### Five-minute product journey

1. Open **People** and follow the Cedar House cast across clear faces, partial
   views, rear views and known Presence. The optional Space Trip Guided journey
   adds all four evidence types to Maya without pre-seeding that final state.
2. Open a photo from a person's page and see the person's name briefly orient
   the viewer before the controls recede.
3. Move through the related Pet, Place, Event and linked Document pages.
4. Search the shared memory graph and switch between Standard, Personal and
   Private presentation.
5. Open **Models & Guided** to inspect the exact local evidence and matching
   state. Optional machinery remains visibly separate from owner truth.

## Try Cimmich

The supported public operator creates a fresh, loopback-only Immich 3.0.3
instance, a separate Cimmich PostgreSQL/API stack and a production-built Cimmich
UI. It owns one exact Compose project and does not discover or operate on other
Immich/Cimmich installations.

### Requirements

- Docker with Compose v2;
- `curl`, `nc` and either `sha256sum` or macOS `shasum`;
- the complete [Cedar House V1 release archive](https://github.com/cimmich/cimmich/releases/download/v1.0.0-build-week/cimmich-cedar-house-v1.tar.gz);
- three free local ports (defaults: `3303`, `3301` and `22859`).

The source-controlled [Cedar House contract](demo/cedar-house-v1/README.md)
contains the operator guide, ledger, notices and provenance rules. The full
rights-bound media archive is distributed as a release asset because it is
approximately 134 MiB.

Download, verify and extract the exact Build Week archive:

```sh
curl -fLO https://github.com/cimmich/cimmich/releases/download/v1.0.0-build-week/cimmich-cedar-house-v1.tar.gz
expected_sha256=937b5859635af6f1b775dcbab1e28411b2e6f4a6182b72e003e3ccdda455347f
if command -v sha256sum >/dev/null 2>&1; then
  actual_sha256=$(sha256sum cimmich-cedar-house-v1.tar.gz | awk '{print $1}')
else
  actual_sha256=$(shasum -a 256 cimmich-cedar-house-v1.tar.gz | awk '{print $1}')
fi
test "$actual_sha256" = "$expected_sha256"
tar -xzf cimmich-cedar-house-v1.tar.gz
```

### Start the isolated demo

```sh
export CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT="$PWD/cedar-house-v1"
./tools/public_demo.sh up
./tools/public_demo.sh status
```

A cold first run normally takes 4–10 minutes while pinned images and locked UI
dependencies are prepared. `status` reports readiness and local URLs without
printing passwords, API keys or Guided tokens.

Default loopback URLs:

- Cimmich product: `http://127.0.0.1:3303`
- stock Immich: `http://127.0.0.1:22859`
- Cimmich API/health: `http://127.0.0.1:3301`

Generated credentials live only in mode-`0600` operator state. The detailed
[demo guide](demo/cedar-house-v1/README.md) covers first Immich sign-in, Private
view-lock handling, Guided credentials, map behavior, backup/restore and
offline-safe choices.

### Optional public CPU Face provider

```sh
./tools/public_demo.sh install-face-provider
```

This explicitly downloads and verifies the checksum-pinned official OpenCV
YuNet/SFace artifacts into the demo's dedicated model volume. Model weights are
not committed to this repository or bundled into the application image.

### Stop, restart or remove the isolated demo

```sh
./tools/public_demo.sh stop
./tools/public_demo.sh restart
./tools/public_demo.sh destroy --confirm=cimmich-public-demo
```

`stop` pauses containers, `restart` restarts them in place, and `down` removes
only containers and the project network. All three preserve the complete demo
library, databases, Documents, models and generated operator state. `up` resumes
that exact state without rebuilding it. Permanent removal is separately named,
confirmation-gated and scoped to the exact disposable demo project. It does
not target an existing Immich installation.

## Add Cimmich beside an existing Immich installation

Choose the [guided or advanced install](INSTALL.md). Both create a separate
Cimmich database, document volume, API, signed-in UI and loopback gateway.

If Docker is unfamiliar—or an AI assistant is helping—start with:

```sh
./tools/install.sh --check
./tools/install.sh
```

The guided installer does not ask for an API key or import anything before the
signed-in preview. It brings up Cimmich, then the setup screen verifies the
connection and lets the owner inspect the proposed scope before admission.

Advanced operators can use the exact-project lifecycle directly:

```sh
export CIMMICH_COMPANION_STATE_ROOT=/srv/cimmich/operator
export CIMMICH_COMPANION_PRIVATE_LOCK_MODE=none
./tools/companion.sh configure http://host.docker.internal:2283
./tools/companion.sh up
./tools/companion.sh status
```

Open the loopback URL returned by `status` and sign in with the normal Immich
account. Cimmich does not create a second user account. Create a dedicated
least-privilege Immich API key and enter it only into the write-only Settings
field. The key is used only by the server-side read companion.

The same exact-project operator owns Cimmich-only backup, disable, restore and
confirmed removal:

```sh
./tools/companion.sh backup /safe/new/cimmich-companion-backup
./tools/companion.sh disable
./tools/companion.sh restore /safe/cimmich-companion-backup --confirm=cimmich-companion
./tools/companion.sh up
./tools/companion.sh remove --confirm=cimmich-companion
```

See [release readiness](docs/RELEASE_READINESS.md) for the exact supported
baseline and current lifecycle proof.

## How it is built

```text
Immich media + supported APIs (read-only)
                    |
                    v
       Cimmich inventory and evidence
       separate PostgreSQL + pgvector
                    |
      +-------------+--------------+
      |                            |
      v                            v
owner decisions              local proposals
Face / Head / Body /          matching + optional
Presence + contexts           evidence providers
      |                            |
      +-------------+--------------+
                    |
                    v
      provenance-bearing product state
       with replay, conflict and Undo
                    |
                    v
       optional authenticated Guided client
```

- Cimmich has separate credentials, migrations, backups and restore.
- It shares no schema or foreign keys with Immich.
- It does not directly write the Immich database or source media.
- Local providers produce typed observations, not identity decisions.
- Local comparison uses accepted, compatible reference photos. Any separately
  evaluated bulk-matching policy must pass human review and is invalidated by
  later identity corrections.
- Private is a cumulative presentation mode—not encryption, an ACL, a vault or
  protection from a host administrator. Immich provides the access security;
  the Private password only decides what Cimmich draws on screen, so the owner
  can reset it from Settings without the previous password.

Detailed contracts live in the [service documentation](service/README.md),
[privacy boundary](docs/PRIVACY_BOUNDARY.md) and provider directories.

## Guided without hidden authority

Guided V2 is a provider-neutral machine bootstrap. A separately authenticated
client can discover versioned JSON schemas, typed errors, replay/conflict/Undo
laws and UI verification links for an exact catalogue of existing Cimmich
operations.

The credential has an explicit `read|operate` grant and
`Standard|Personal|Private` visibility ceiling. The server derives the actor,
rechecks current visibility and rejects every route outside that catalogue.
Guided does not grant ambient filesystem, database, model-provider,
bulk-matching activation or automatic identity authority.

Cimmich stores no OpenAI or other model-provider key and makes no provider
request. A connected hosted client may disclose what it retrieves; that client
and its operator own the disclosure choice. Running Cimmich locally does not
make a hosted client local or private.

## Prior work and Build Week boundary

Cimmich began from a private Immich-derived archive-research seed that I had
been exploring for several months before Build Week. That work approached the
problem from the other direction: how could a combination of local and cloud
models sort, tag and process a roughly 600 GB personal photo archive spanning
15 years, including low-quality and crowded images, then make its actual
contents semantically searchable? A representative goal was a query as specific as:
“Show me the photos from Greece with two named friends, eating saganaki and
drinking retsina, while I was wearing a 76ers shirt.”

That prior project contributed the original problem, archive-processing and
model experiments, identity/matching and QC work, semantic-search exploration,
and experimental Immich-derived UI overlays.
It did **not** contribute the complete Cimmich product described in this README,
and none of the inherited Immich-derived work is claimed as newly authored
competition work.

During OpenAI Build Week's 13–21 July 2026 Submission Period, the project was
reframed around completeness, trustworthy evidence and human authority. The
dated, agent-kept [Build Week extension ledger](docs/BUILD_WEEK_CHANGELOG.md)
records the work completed during that period. A
[privacy-cleared claim-to-proof index](docs/BUILD_WEEK_EVIDENCE.md) links those
claims to public source, tests, contracts and reproduction paths:

- a separate Cimmich intelligence service and PostgreSQL/pgvector database
  beside Immich;
- Person identity management and distinct Face, Head, Body and Presence truth;
- owner correction, merge/unmerge, Pets and review journeys;
- a read-only Immich companion, restart-safe inventory and local media jobs;
- Places, Things, Events/Trips/Activities/Life periods, linked Documents,
  Smart Search and Standard/Personal/Private presentation;
- optional evidence-provider and matching boundaries with no automatic identity
  authority;
- the provider-neutral Guided V2 machine interface and its executed Space Trip
  journey;
- the synthetic Cedar House and Space Trip public demonstration material;
- migration, backup/restore, restart, disable/remove, accessibility, privacy,
  security, browser-journey and release-proof programs.

The retained Immich web foundation and all upstream licences remain disclosed in
[NOTICE.md](NOTICE.md). This is an existing-project extension permitted by the
[Build Week rules](https://openai.devpost.com/rules), not a claim that the
repository began from an empty folder.

## Built during OpenAI Build Week

During the 13–21 July 2026 Build Week, **Codex powered by GPT-5.6 Sol** helped
turn that direction into a separately stored intelligence service, a coherent
product experience and, through the final hardening gates, an installable public
release candidate. The workflow was specific:

- product intent, user stories, North Stars and definitions of done were
  challenged and refined before implementation;
- coordinated Controller, Backend and UI/UX tasks used task-to-task messaging
  to route product findings into code and return proof without losing the
  active user journey;
- Codex used the browser as a real user, tested end-to-end journeys and routed
  defects discovered during live use;
- long-running service, migration, UI, accessibility, privacy, security and
  lifecycle checks ran alongside product work;
- Codex and GPT-5.6 planned the synthetic public archive so a real private photo
  library never had to become demo material;
- GPT-5.6 Sol operated Guided V2 from its published contracts to add the six
  Space Trip images to the existing library, organise their Event, Place and
  Thing context, set visibility, and prove replay and Undo.

The fuller [Build Week account](docs/BUILD_WEEK.md) explains the Codex workflow,
GPT-5.6 use and runtime boundary.

GPT-5.6 is part of how Cimmich was built and of the demonstrated optional Guided
journey. It is not a required runtime dependency and is never the authority on
who a person is.

## Verification

Current release-hardening evidence is recorded in
[release readiness](docs/RELEASE_READINESS.md). The same checkout must pass the
service, migration, disposable synthetic, web, Svelte, TypeScript,
production-build and public-demo lifecycle gates.

The Build Week release tag is `v1.0.0-build-week`. It targets exact Immich 3.0.3
and derives schema 75 from its contiguous migration ledger. Its certification
requires service, migration, synthetic, clean public-demo and fresh stock-Immich
lifecycle gates from the release checkout.
The public-demo gate starts from no prepared Cimmich data at the pristine
`51:9:12:5:4:0` semantic state, preserves owner/database/volume markers across
stop, restart and down/up, restores a checksummed schema-74 backup forward to
schema 75, and proves that only explicit reset/destroy removes state. Runtime
deployment receipts remain separate from this source claim.

Enhanced's setup and evaluation mechanics are proved. The release does not
claim representative matching accuracy, an active evaluated SourcePack or
automatic identity authority.

Core source checks:

```sh
cd service && npm test
cd ../ui/web && pnpm exec prettier --check .
pnpm run lint
pnpm run check:svelte
pnpm run check:typescript
pnpm run build
cd ../../..
./tools/run_migration_runner_acceptance.sh
./tools/run_synthetic_acceptance.sh
```

The synthetic suite uses an isolated disposable database and grants no identity
or bulk-matching activation authority to a model. Real-provider acceptance is
separate, explicit and licence-gated.

## Current limitations

- Cimmich is an early public release. Evaluate it with the synthetic demo before
  connecting a private archive.
- Automatic identity acceptance is off. Local comparisons can rank likely
  People, but only an owner action can change identity.
- The public demo proves product behavior, not representative biometric
  accuracy or demographic fairness.
- Provider weights, licences, calibration and resource requirements remain
  provider-specific.
- Optional hosted Guided use inherits the privacy behavior of the client the
  operator chooses.
- The supported companion baseline is Immich 3.0.3. Later Immich versions and
  sustained large-archive behavior require their own proof.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Keep Immich as
the base product, preserve the evidence/authority boundaries and use synthetic
fixtures in public tests and documentation.

Do not open a public issue for a suspected vulnerability or include real media,
embeddings, credentials or private library details. Follow
[SECURITY.md](SECURITY.md).

## Licence and attribution

Cimmich source is licensed under
[GNU AGPL v3.0 only](LICENSE). Preserved upstream and third-party terms remain
in force; see [NOTICE.md](NOTICE.md) and the provider-specific notices.

Cedar House V1 and Space Trip V1 are independently licensed demo packages and
must retain their licence, notice, attribution, manifest and provenance files.

“Immich” is used nominatively to describe compatibility and the ecosystem this
unofficial companion serves. No trademark rights, affiliation or endorsement
are claimed.
