# Cimmich

<p align="center">
  <img src="docs/assets/cimmich-logo.png" alt="Cimmich astronaut inside a four-colour focus frame" width="200">
</p>

> **Complete the picture.**

**Cimmich is an open-source, local-first memory companion for Immich.** It adds
People, Pets, Places, Things, Events and Documents around the library you
already own, without writing to the Immich database or modifying original
media.

Photo libraries are good at storing files and grouping visible faces. They are
less good at preserving the overlapping context that makes a photograph
meaningful: the person you know was present without a visible face, the place
and event it belongs to, or the document that explains it. Cimmich adds that
owner-controlled context beside Immich.

[See the walkthrough](docs/WALKTHROUGH.md) · [Install Cimmich](INSTALL.md) ·
[Try fictional data](demo/cedar-house-v1/README.md) · [Understand privacy](PRIVACY.md) ·
[Contribute](CONTRIBUTING.md)

> [!NOTE]
> **OpenAI Build Week: Apps for Your Life.** Cimmich's original submission was
> built with **Codex powered by GPT-5.6 Sol** and remains preserved at the exact
> [`v1.0.0-build-week` tag and release](https://github.com/cimmich/cimmich/releases/tag/v1.0.0-build-week):
> [read the original submission README](https://github.com/cimmich/cimmich/blob/v1.0.0-build-week/README.md) ·
> [watch the three-minute demo](https://youtu.be/CfR_r0n4deQ) ·
> [inspect the Build Week evidence](https://github.com/cimmich/cimmich/blob/v1.0.0-build-week/docs/BUILD_WEEK_EVIDENCE.md).
> Living product development continues on `main` without rewriting that
> historical release.

> [!IMPORTANT]
> Cimmich is an unofficial companion project. It is not affiliated with or
> endorsed by Immich or OpenAI.

> [!NOTE]
> **Community Preview 10** supports exact Immich 3.1.0 on tested macOS and Linux
> Docker hosts. Install the [latest named release](https://github.com/cimmich/cimmich/releases/latest),
> not an arbitrary snapshot of `main`.

![Cimmich Home showing the fictional Cedar House memory library](docs/assets/screenshots/home.webp)

## What Cimmich adds

- **People beyond face recognition.** Face, Head, Body and Presence remain
  separate kinds of evidence, so knowing someone is in a photograph does not
  require pretending that a usable face is visible.
- **A connected memory library.** People, Pets, Places, Things, Events and
  Documents have visual directories, relationships and counts.
- **Overlapping context.** One photograph can belong to a trip, recurring
  activity, client engagement and life period at the same time.
- **Intersection search.** Select several Cimmich tags to see only photographs
  carrying all of them, without a hidden 5,000-result ceiling.
- **Reversible archive organisation.** Apply Cimmich-owned Labels and preview
  folder-derived album manifests before creating collision-safe albums, without
  moving source media or writing sidecars.
- **Archive health without deletion authority.** Compare exact bytes and
  possible duplicates, check one folder against the rest of the archive, and
  scan a configured read-only independent backup. Each category loads only
  when selected.
- **People exploration with context.** Filter People and a Person's photographs
  by exact privacy tier, Tags and Labels, Places, Events and Things.
- **Owner-controlled review.** Matching may suggest; the archive owner accepts,
  corrects, rejects, merges or undoes every consequential identity decision.
- **Bounded Local AI review.** From one photo or a small selection, optional
  local models can look for missed Faces or create derived enhancement previews
  without replacing originals or silently accepting results.
- **Presentation modes.** Standard, Personal and optional password-gated
  Private modes control what is comfortable to show on a shared screen.

**Cimmich keeps Face, Head, Body and Presence evidence in its own system.
Native Immich manual face assignments do not train or damage Immich's
recognition model.** The distinction is about recording different kinds of
owner knowledge and controlling which evidence Cimmich's optional matching may
use.

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/screenshots/person-evidence.webp" alt="A fictional Cimmich Person page showing separate identity and appearance evidence categories">
      <br><strong>Evidence without invented certainty.</strong> Identity shows
      separate Face and appearance categories; an empty Core set is honest too.
    </td>
    <td width="50%">
      <img src="docs/assets/screenshots/tags-intersection.webp" alt="Cimmich showing photographs that match two selected tags">
      <br><strong>Combine what you already know.</strong> Intersect people,
      places, events and other tags across the library.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/assets/screenshots/event.webp" alt="The fictional Bluewater Weekend event in Cimmich">
      <br><strong>Memories can overlap.</strong> Build trips, activities and life
      periods from existing photographs and folders.
    </td>
    <td width="50%">
      <img src="docs/assets/screenshots/documents.webp" alt="An annotated product capture of a fictional invitation connected to an event and person in Cimmich">
      <br><strong>Keep the record with the memory.</strong> Link invitations,
      receipts and other documents to the people and events they belong to.
    </td>
  </tr>
</table>

The screenshots use the fictional, rights-cleared Cedar House demonstration
archive. The invitation image is an annotated product capture; the others show
the named interface directly. They demonstrate product behavior, not biometric
accuracy or demographic fairness. [Take the full product tour](docs/WALKTHROUGH.md).

## Is the Community Preview for you?

| A reasonable fit today                                            | Not yet a supported fit                                                |
| :---------------------------------------------------------------- | :--------------------------------------------------------------------- |
| You already run exact Immich 3.1.0                                | You need compatibility with another Immich version                     |
| You can run the checked-in installer and inspect its Compose file | You need a one-click native Windows installer                          |
| You can keep a separate Cimmich backup                            | You need stable APIs and schemas across releases                       |
| You want a local, single-owner companion                          | You need Internet-facing or multi-user deployment                      |
| You want inspectable suggestions and manual decisions             | You need automatic identity acceptance or certified biometric accuracy |

## Install beside Immich

Download the named Cimmich bundle and `SHA256SUMS` from the
[latest release](https://github.com/cimmich/cimmich/releases/latest), verify it,
then extract the bundle:

```sh
./tools/install.sh --check
./tools/install.sh
```

Open <http://127.0.0.1:3413>, sign in through Immich, and complete the guided
library preview. Cimmich asks for a dedicated read-only Immich API key only in
its signed-in Settings screen, never in `.env` or an AI conversation.

Read [INSTALL.md](INSTALL.md) before starting. It covers checksum verification,
host addressing, first-run expectations, backups, updates, diagnostics and
confirmation-gated Cimmich-only removal.

## Privacy and control

Cimmich is designed to be additive and removable:

- Cimmich has its own PostgreSQL database, configuration, documents and backups.
- Immich continues to own and serve original media.
- Cimmich does not directly write the Immich database or source-media bytes.
- Product ports bind to loopback by default.
- Core organisation works without a model or model-provider API key.
- Optional local providers produce observations, not identity decisions.
- Optional hosted clients may disclose what the operator chooses to send them;
  Cimmich cannot make third-party software private.
- Private mode filters presentation inside an authenticated session. It is not
  encryption, an ACL or protection from the host administrator.

Read the plain-language [privacy guide](PRIVACY.md), the technical
[privacy boundary](docs/PRIVACY_BOUNDARY.md), and [SECURITY.md](SECURITY.md).

## Documentation

| I want to…                                               | Start here                                                                          |
| :------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| See what the product does                                | [Product walkthrough](docs/WALKTHROUGH.md)                                          |
| Install, update, back up or remove it                    | [Installation and operations](INSTALL.md)                                           |
| Understand data and network behavior                     | [Privacy guide](PRIVACY.md)                                                         |
| Use or operate optional Local AI review                  | [Local AI review](docs/LOCAL_AI_REVIEW.md)                                          |
| Check copies, folders or an independent media backup     | [Archive Health walkthrough](docs/WALKTHROUGH.md#6-check-the-health-of-the-archive) |
| Resolve a common question                                | [FAQ](docs/FAQ.md)                                                                  |
| Understand the repository                                | [Development guide](DEVELOPMENT.md)                                                 |
| Propose a change                                         | [Contributing guide](CONTRIBUTING.md)                                               |
| Understand project authority and AI-assisted development | [Governance](GOVERNANCE.md)                                                         |
| Inspect release and journey evidence                     | [Documentation index](docs/README.md)                                               |

## Current limitations

- Community Preview, not a general-availability release.
- Exact Immich 3.1.0 only; each additional version needs its own compatibility
  proof.
- Tested guided-install hosts are macOS and Linux. Native Windows PowerShell is
  not supported.
- Internet-facing and multi-user deployment are not supported.
- No biometric-accuracy or demographic-fairness claim is made.

## Develop and contribute

Cimmich contains two deliberate JavaScript workspaces: a Node 22/npm service
and an Immich-derived Node 24/pnpm UI. `ui/packages/sdk` is checked-in generated
source, not `node_modules`.

Read [DEVELOPMENT.md](DEVELOPMENT.md) before installing dependencies. Small,
reviewable documentation, test and defect fixes are welcome under the
[contribution guide](CONTRIBUTING.md) and [code of conduct](CODE_OF_CONDUCT.md).

## Project history

Cimmich began as a bounded **OpenAI Build Week: Apps for Your Life** project.
The exact submission remains preserved as the
[v1.0.0 Build Week release](https://github.com/cimmich/cimmich/releases/tag/v1.0.0-build-week),
with its [prior-work disclosure](docs/BUILD_WEEK.md) and
[privacy-cleared evidence index](docs/BUILD_WEEK_EVIDENCE.md). Living product
development continues on `main` without rewriting that historical release.

Product direction, acceptance and release authority are held by Benji.
Living Cimmich development uses substantial AI assistance coordinated and
accepted under Benji's product and release authority. The exact Build Week
tooling and inherited Immich-derived web foundation are separately attributed. See
[GOVERNANCE.md](GOVERNANCE.md) for the decision, acceptance and attribution
model.

## Licence and lineage

Cimmich is distributed under the [GNU AGPL v3](LICENSE). It contains and adapts
Immich web source under preserved upstream terms. See [NOTICE.md](NOTICE.md) and
[the UI lineage record](ui/CIMMICH_FORK.md).
