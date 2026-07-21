# Cedar House public demo bootstrap

This directory carries the source-controlled state contract and rights bundle
for Cimmich's wholly synthetic 51-asset public demonstration archive. The media
files are distributed separately because the accepted PNG set is about 128 MB.

The archive is product demonstration material, not a representative biometric
benchmark. It proves Cimmich journeys and state handling; it does not prove a
provider's matching accuracy, demographic fairness or suitability for a real
library.

## What the seed creates

- 51 stable Cimmich assets bound to 51 explicit Immich API upload results;
- six fictional People, two fictional Pets and one intentional duplicate
  Person for merge/unmerge demonstration;
- four Places, four Things and four Events/Life shapes with covers,
  participants, companions and linked media;
- five linked Documents across Standard, Personal and Private presentation;
- one true manual Face, Head, Body and Presence tag;
- accepted anchor truth, one candidate, one rejected “Not this person” example,
  one unresolved low-quality Face and one intentionally incorrect accepted
  identity for correction/Undo demonstration;
- exactly 16 asset visibility overrides from the shot ledger;
- zero active SourcePacks and zero automatic identity authority.

## Inputs

Set `CIMMICH_DEMO_ARCHIVE_ROOT` to the complete Cedar House V1 bundle. It must
contain `media/`, `provenance/manifest.csv`, `shot-ledger.csv`, `LICENSE.md`,
`NOTICE.md` and `ATTRIBUTION.md`. The uploader verifies every admitted file's
SHA-256 and synthetic/visual-acceptance declarations before sending it to the
operator's dedicated demo Immich instance.

The source-controlled copies in this directory let tests and reviewers inspect
the state contract, prompts, hashes and redistribution notice without requiring
the large media bundle. They do not replace the complete archive.

The canonical Build Week release asset is
[`cimmich-cedar-house-v1.tar.gz`](https://github.com/cimmich/cimmich/releases/download/v1.0.0-build-week/cimmich-cedar-house-v1.tar.gz),
SHA-256
`937b5859635af6f1b775dcbab1e28411b2e6f4a6182b72e003e3ccdda455347f`.
It contains 51 PNGs plus the complete licence, notice, attribution, prompts,
manifests, ledgers and contact sheets.

## Preferred isolated operator path

Use the repository-root operator. It creates only the exact
`cimmich-public-demo` Compose project, pins Immich 3.0.3, builds a production UI
and wires the Cimmich API, origins, read-only Immich companion credential and
display bridge automatically. Never point any Cedar House tooling at an
ordinary or private library.

```sh
export CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT=/absolute/path/to/cedar-house-v1
./tools/public_demo.sh up
./tools/public_demo.sh status
```

`up` enables Immich's native map, disables reverse geocoding and assigns 46
deterministic fictional GPS points to the photo chapters. Existing exact demo
state can be reconciled without reset using:

```sh
./tools/public_demo.sh configure-map
```

The coordinates demonstrate Cedar House, Bluewater, Willow and Northside; they
are not real addresses. Cimmich admits native marker IDs only after the current
viewing-mode visibility check. Document artwork remains unmapped.

Default loopback URLs are:

- product UI: `http://127.0.0.1:3303`;
- stock Immich: `http://127.0.0.1:22859`;
- Cimmich API/health: `http://127.0.0.1:3301`.

Set `CIMMICH_PUBLIC_DEMO_UI_PORT`, `CIMMICH_PUBLIC_DEMO_IMMICH_PORT` and
`CIMMICH_PUBLIC_DEMO_API_PORT` before the first `up` to use other free ports.
The generated Immich credential and mapping receipt remain mode `0600` beneath
the exact state root reported by `status`; they must never enter the repository
or distributed archive. The public seed receipt and display bridge contain no
credential. The demo administrator password is intentionally not printed; it
is available to the local operator in the mode-0600 `operator.env` file named
by `status`. A separate randomly generated Private view-lock password is stored
only in a mode-0600 file. Locate that file without printing its contents with:

```sh
./tools/public_demo.sh private-password-file
```

Read it directly into the trusted password-entry surface; do not pass it as a
command argument, export it, paste it into logs or add it to shell history.
This demo deliberately uses the password-gated Private preference. Standard or
Personal is device-sticky across a fresh page and a second tab; Private
authorization is session-only and falls back to the device's non-Private mode
on reload. Cimmich still supports an explicitly passwordless local preference
outside this demo.

Guided uses a different randomly generated mode-0600 token. It is a local
Cimmich capability, never an OpenAI/model-provider credential. Locate its file
without printing the token with:

```sh
./tools/public_demo.sh guided-token-file
```

The product's **Models & Guided** page exposes status, accepted evidence
contracts, tested settings and official provider/model links. No model binary
is stored in this repository or demo bundle. Operators choose their own local
or hosted client and remain responsible for its licence and disclosure.

The long-lived Cimmich API receives only exact read-only mounts for the public
display bridge, its dedicated Immich API credential and its dedicated Guided
token. The Private password, administrator/database credentials, upload mapping
and operator receipts are not mounted into that service.

To rotate the generated demo-only preference and invalidate existing Private
sessions without placing either secret in argv or output, run:

```sh
./tools/public_demo.sh rotate-private-password
```

### Expected time and first Immich sign-in

A cold first run normally takes **4–10 minutes**, depending on container pulls,
the production UI build and local storage. The 51 supported API uploads take
roughly 80 seconds on the reference workstation. With images and build layers
cached, a full reset has typically taken **3–6 minutes**. `status` is safe to
run at any time and reports readiness and semantic counts without secrets.

The uploader creates the Immich administrator, but Immich still presents its
normal first-user onboarding. Complete Theme and Language according to your
preference. For the most privacy-conscious demonstration:

- disable **Version Check** during Server Privacy onboarding;
- keep reverse geocoding disabled; the demo operator enforces this setting;
- decide whether loading external map tiles is acceptable for the session;
- leave **Google Cast** disabled;
- keep all storage/backups scoped to this disposable demo;
- do not enable optional Immich machine-learning jobs unless their model
  downloads and network behavior are acceptable for the demonstration.

The initial `up` is not offline: it may download pinned container images and
the UI's locked package dependencies. Once those inputs are present, Cimmich
itself makes no model-provider request. Guided is available only through its
dedicated local token with the explicit operator grant published by Guided
bootstrap. The shipped demo grant is `operate` with a Private visibility
ceiling; Private reads still require the canonical Private session. The demo
operator exposes services on loopback only. Immich retains its own separately
chosen onboarding/privacy behavior.

### Stop, restart, reset and removal

Ordinary lifecycle commands preserve the complete demo library and generated
operator state:

```sh
./tools/public_demo.sh stop
./tools/public_demo.sh restart
```

`down` is also non-destructive: it removes only the demo containers and project
network. The named database/library/Document/model volumes and operator state
remain in place, and the next `up` resumes them without rebuilding. Unlike
`stop`, `down` gives operators a conventional container-removal boundary.

The destructive commands are deliberately separate and require the exact
resolved project name:

```sh
./tools/public_demo.sh reset --confirm=cimmich-public-demo
./tools/public_demo.sh destroy --confirm=cimmich-public-demo
```

`reset` removes and rebuilds only the demo's exact containers, network, named
volumes and generated state. Runtime Immich UUIDs change; the 51/9/12/5/4/0
semantic fixture counts remain stable. `destroy` performs the same exact
removal without recreation and refuses to remove a state directory containing
unknown files.

### Backup and restore

The operator creates a cold application-consistent bundle covering both
PostgreSQL databases, Immich media, Cimmich Documents, the display bridge and
private operator state, including the Private view-lock file. The destination must be an absolute external directory
whose basename exactly matches `<project>-backup`:

```sh
./tools/public_demo.sh backup /absolute/path/cimmich-public-demo-backup
./tools/public_demo.sh restore /absolute/path/cimmich-public-demo-backup \
  --confirm=cimmich-public-demo
```

Backup briefly stops the UI/API/Immich writers, creates custom-format database
dumps and volume archives, validates archive traversal, writes an exact
SHA-256 manifest, then restarts the demo. Restore verifies every digest,
manifest field, project binding, member boundary and operator-state shape. It
then restores both database dumps into isolated preflight databases, verifies
the backup ledger, migrates Cimmich to the current schema, and compares the
resulting semantic counts before replacing only the exact confirmed demo project. The
backup contains credentials and is mode `0600`; store and delete it as private
operator material. A backup from an older supported Cimmich schema is restored
first and then advanced through the current migration ledger; a backup newer
than the running build fails closed. `destroy` never removes an external backup.

## Advanced manual bootstrap

The lower-level `bootstrap-public-demo-immich` and `bootstrap-public-demo`
CLIs remain available for an already isolated stack. Supply their documented
environment inputs from a generated mode-0600 operator state file; do not put a
database URL, password, API key or workstation path in a command history or
repository file. The preferred operator above generates, transports and mounts
those inputs without printing them.

## Reset proof

`tools/public_demo_acceptance.sh` exercises the complete production operator:
fresh start, status, exact semantic counts, durable database and volume markers,
non-destructive stop/start, restart and down/up continuity, checksummed current
backup plus schema-74-to-current restore, fail-closed malformed/newer/wrong-project/
corrupt/count-drift inputs, destructive reset with new runtime UUIDs, and destroy with no project
containers/network/volumes/state left behind.
It requires the complete archive and three free acceptance ports.

`tools/run_public_demo_bootstrap_acceptance.sh` separately creates a temporary PostgreSQL
instance, migrates it through the current contiguous migration ledger, seeds
the archive, destroys and
recreates only the disposable demo database, seeds it again, and requires
byte-identical semantic receipts and display bridges. It also proves the exact
surface counts and that no SourcePack is active.

The operator reset model is therefore deliberate recreation of the dedicated
demo Immich/Cimmich state, not mutation or cleanup of a personal installation.

## Rights and disclosure

Every distributed or displayed form must retain [LICENSE.md](LICENSE.md),
[NOTICE.md](NOTICE.md), [ATTRIBUTION.md](ATTRIBUTION.md) and the complete
`provenance/` directory. Demo videos and hosted demos must carry the same
synthetic-data and non-benchmark disclosure.
