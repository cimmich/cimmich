# Install and operate Cimmich

Cimmich runs beside Immich in its own Docker project. It keeps a separate
database, configuration, document store and backups. It does not replace or
write Immich, including albums, memberships, tags, asset metadata and original
media.

The checked-in installer is the tested end-to-end path for this preview. It creates the
private runtime configuration that the backup, restore, diagnostic and removal
commands use. The root `compose.yaml` remains fully inspectable, but a raw
`docker compose up` does not create that operator state and is not a second
complete lifecycle.

## Before you begin

Community Preview 17 requires:

- exact Immich 3.1.0 already running;
- Docker Desktop, OrbStack or Docker Engine with Compose v2;
- a tested macOS or Linux Docker host;
- outbound access for Docker images and locked Debian, PyPI, npm and pnpm
  dependencies during a cold build, unless every required artifact is cached;
- `curl` and `openssl`;
- either `sha256sum` or `shasum` for checksummed lifecycle operations; and
- your normal Immich sign-in.

Native Windows PowerShell and WSL2 have not yet completed the clean-install
proof required for this release. They are untested, not disproven.

### Resource expectations

| Resource | What to expect |
| :--- | :--- |
| Disk | Keep several gigabytes free for local image builds, Docker cache and Cimmich state. Cimmich does not duplicate the original photo library. |
| Time | A cold first build commonly takes 4–10 minutes; network speed, CPU and Docker cache can change this substantially. |
| CPU and memory | No minimum has been certified yet. The core stack adds a Node service, web process and PostgreSQL database beside Immich. Increase Docker's allocation if a local build is killed for memory. |
| Optional models | Core does not need one. Local provider resource use is additional and provider-specific. |

`./tools/install.sh --check` reports available disk on the release-folder
volume. Docker Desktop or another remote engine may store images elsewhere, so
check that allocation separately.

> [!IMPORTANT]
> Download a **named Cimmich release bundle**, not the Cedar House demo archive
> and not an arbitrary snapshot of `main`.

> [!CAUTION]
> Never paste an Immich account password, API key or token into `.env`, a shell
> command copied from an issue, an AI conversation or a public diagnostic.
> Cimmich accepts a dedicated read-only Immich API key later through a
> write-only field in its signed-in Settings screen.

## 1. Download and check the release

Open the [latest release](https://github.com/cimmich/cimmich/releases/latest),
expand **Assets**, and download:

- the named `cimmich-<version>.tar.gz` or ZIP application bundle; and
- `SHA256SUMS` from the same release.

The Cedar House archive is fictional demo data, not the application. GitHub's
automatic **Source code** archives contain the source, but the named bundle is
the documented installation artifact.

Check the downloaded bundle before extracting it.

macOS:

```sh
shasum -a 256 --ignore-missing -c SHA256SUMS
```

Linux:

```sh
sha256sum --ignore-missing -c SHA256SUMS
```

The bundle you downloaded must report `OK`; the missing alternative archive is
ignored. `SHA256SUMS` detects corruption or a mismatched bundle; by itself it is
an integrity check, not independent proof of publisher identity.

After extracting the bundle, open a terminal in that folder and confirm:

```sh
ls INSTALL.md compose.yaml tools/install.sh
docker compose version
```

## 2. Check the computer without changing it

Start Docker, then run:

```sh
./tools/install.sh --check
```

The check does not create containers, configuration or database state. It
reports the platform, required commands, checksum implementation, local ports,
existing guided state and available disk. A ready new machine ends with:

```json
{"docker":"ready","installer":"ready","state":"unchanged"}
```

Do not run the installer with `sudo`.

## 3. Run the installer

```sh
./tools/install.sh
```

The installer asks for:

1. the credential-free address Docker should use to reach Immich; and
2. whether switching to Cimmich's optional Private viewing mode should require
   an extra local password.

For Immich on the same computer at its normal port, accept
`http://host.docker.internal:2283`. For Immich on another machine, use a LAN
address reachable from Docker, such as `http://192.168.1.20:2283`. Do not add
`/api`, credentials, a query string or a fragment.

Plain HTTP to another machine sends the dedicated API key and requested media
unencrypted across that network. Use it only on a network you trust. Prefer an
HTTPS Immich address with a valid certificate on shared or untrusted networks;
Cimmich does not add TLS to a remote Immich connection.

The installer verifies exact Immich 3.1.0 before it creates Cimmich state. It
generates a database password, stores mode-restricted runtime configuration in
`${XDG_STATE_HOME:-$HOME/.local/state}/cimmich-companion/runtime.env`, builds
the checked-in API and UI sources, and starts only the Cimmich project. The
installer prints the resolved state path.

If Docker or the network interrupts installation, fix the reported issue and
continue with:

```sh
./tools/install.sh --resume
./tools/install.sh --status
```

Installation is complete only when the installer says Cimmich is installed and
the API, database and web interface are healthy.

Keep the verified extracted release folder in a stable location: its checked-in
`tools/` and `compose.yaml` are the operator for that installation. If it is
lost, download and verify the same named release again before administering the
state. Use a newer release's operator only through that release's documented
update path.

## 4. Create the dedicated Immich API key

Cimmich uses two different Immich credentials for two different jobs:

- your normal Immich session signs you into the browser; and
- a dedicated, least-privilege API key lets Cimmich read the library inventory
  and original assets needed for the features you choose.

Create the key in your normal Immich web interface:

1. Sign in to Immich.
2. Select the user icon at the top right, then **Account Settings**. Immich's
   [user-settings guide](https://docs.immich.app/features/user-settings/)
   shows the same route.
3. Open **API Keys** and choose **New API Key**.
4. Name it `Cimmich read-only`.
5. Grant only permissions covering:
   - current-user read;
   - asset read and original-asset download;
   - Face read; and
   - Person read.
6. Do not grant asset, Face, Person, user or administration write permissions.
7. Create the key and keep its value on screen for the next step.

Immich may group or slightly rename permissions. Cimmich tests the exact read
operations before import and names a missing permission without echoing the
key.

Cimmich organisation is stored only in Cimmich. Collections, tags, favourites,
archive choices and their Undo history do not require an Immich write scope.

## 5. Connect and preview the library

1. Open [http://127.0.0.1:3413](http://127.0.0.1:3413). This is the local
   Cimmich gateway; its familiar shell comes from the attributed
   Immich-derived web foundation.
2. Sign in with your normal Immich account. Cimmich does not create a second
   user account.
3. Open **Cimmich Settings → Connect your existing Immich library**.
4. Paste the dedicated key only into Cimmich's write-only API-key field.
5. Verify the reported Immich version, account and permissions.
6. Preview the exact library lanes, media counts and inherited People/Face
   labels.
7. Import only when the server, account and preview are what you expect.

No optional model is required for core organisation. Cimmich owns matching.
Compatible local face-analysis providers are optional inputs that extract
observations and embeddings. Cimmich builds and evaluates reference libraries,
ranks or abstains, and leaves every identity decision to the owner.

### Optional Immich features Cimmich can reuse

These Immich features are not prerequisites for Cimmich matching or library
import. Enable only the capabilities you want Cimmich to reuse:

- **Smart Search** supplies Immich visual-search and similar-photo results,
  including bounded Rotation review leads.
- **Duplicate Detection** supplies native possible-duplicate groups to Archive
  Health.
- **OCR** supplies text for summaries, Documents and search.

Immich Facial Recognition is not required for Cimmich's identity workflow and
can remain off unless you also use Immich People matching.

For an existing library, open **Administration → Jobs** and run **Missing** in
this order:

1. Smart Search
2. Duplicate Detection
3. OCR

Wait for each queue to reach zero before starting the next one. This order is
an Immich processing dependency: Smart Search supplies the embeddings used by
Immich Duplicate Detection. Starting both together can leave early Duplicate
Detection jobs without an embedding. If that happened, run **Duplicate
Detection → Missing** again after Smart Search finishes. New assets are queued
automatically while these features remain enabled. Use **All** only after
changing the relevant Immich model or processing configuration; it deliberately
reprocesses already completed assets. None of these jobs prepares Cimmich face
matching.

After connection, you may delete or rotate the key from Immich's **Account
Settings → API Keys**. Deleting it immediately stops Cimmich's library reads;
create and verify a new dedicated key to reconnect.

## Next: start matching

Cimmich is installed once the expected account, version and library import are
visible. To start the matching loop, follow the
[matching task in the Cimmich Guide](https://benjihagenhart.com/cimmich/guide/#matching):

1. Open **Settings → Models & Guided → Local Face matching**.
2. Connect a compatible local face-analysis provider. It extracts observations
   and embeddings; Cimmich remains the matcher.
3. Turn on **Enhanced**, then follow the current action until **Face matching**
   reports **Ready** and **Reference library** names the library in use.
4. Open a Person, choose **Identity → Checks**, confirm or correct the review
   items, then use **Refresh matches** on that Person.

Refresh re-evaluates that Person with the latest confirmed evidence. New matches
and possible mistakes return to Checks for the owner to review.

## Normal operation

The installer uses this state root by default. Export it before calling the
lower-level operator directly:

```sh
export CIMMICH_COMPANION_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/cimmich-companion"
./tools/companion.sh status
./tools/companion.sh doctor
```

`doctor` returns redacted JSON covering Cimmich version, Docker and Compose,
service health, schema compatibility, exact Immich compatibility,
configuration permissions and available storage. It intentionally excludes
credentials, origins, paths, filenames, media and private identities. Review
the output before sharing it.

Everyday operations:

```sh
./tools/companion.sh backup /absolute/new/backup-directory
./tools/companion.sh disable
./tools/companion.sh up
```

- `backup` covers Cimmich's database, documents, configuration and provider
  state. It does not back up Immich media.
- `disable` stops Cimmich while preserving its state.
- `up` resumes the same configured installation.

Do not add `--volumes` to ad hoc Compose commands. Do not edit an active
`runtime.env` by hand.

## Optional local face provider

Core Cimmich does not need a model. To install the checksum-pinned OpenCV YuNet
and SFace CPU provider into Cimmich's separate provider volume:

```sh
./tools/companion.sh face-provider install-recommended
```

The provider is local and optional. Installing it does not turn on automatic
identity acceptance.

## Optional read-only media backup scan

Archive Health can compare Immich media evidence with a genuinely independent
destination. This is an advanced opt-in because the destination must be mounted
into the API container. Keep the base Compose file plus the supplied override,
use a stable storage-domain ID that is not the archive disk, and mount only the
folder intended for verification:

```sh
export CIMMICH_BACKUP_SCAN_PATH=/mnt/independent-photo-backup
export CIMMICH_BACKUP_SCAN_LABEL='Primary NAS backup'
export CIMMICH_BACKUP_STORAGE_DOMAIN='nas-volume-photos-1'
export CIMMICH_COMPANION_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/cimmich-companion"
export CIMMICH_COMPANION_PROJECT=cimmich-companion
docker compose \
  --project-name "$CIMMICH_COMPANION_PROJECT" \
  --env-file "$CIMMICH_COMPANION_STATE_ROOT/runtime.env" \
  --file compose.yaml \
  --file compose.backup-scan.yaml \
  up --detach --wait cimmich-api
```

The override mounts the target at `/backup/primary` read-only. Cimmich accepts
only the configured target ID, does not follow symlinks and runs at most one
sequential complete-file hash scan at a time. Do not reuse the archive storage
domain or point the mount at another folder on the archive disk; that is a copy,
not independent backup proof. The project and environment arguments above are
required so this override extends the existing guided installation instead of
starting an unrelated Compose project or losing its generated configuration.

## Optional scheduled database backups

Archive Health > Backup check > Database can create and verify PostgreSQL
custom-format backups of Cimmich's own database. This protects People, review
decisions, settings and other Cimmich-owned records. It does not copy Immich
photo files or Cimmich's separate Document store.

Create a destination directory on a physically independent disk or mounted
network share, then add the database-backup override:

```sh
export CIMMICH_DATABASE_BACKUP_PATH=/mnt/independent-disk/cimmich-database
export CIMMICH_DATABASE_BACKUP_LABEL='Primary database backup'
export CIMMICH_DATABASE_BACKUP_DESCRIPTION='External drive or NAS'
export CIMMICH_DATABASE_BACKUP_STORAGE_DOMAIN=independent-disk-id
export CIMMICH_COMPANION_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/cimmich-companion"
export CIMMICH_COMPANION_PROJECT=cimmich-companion
docker compose \
  --project-name "$CIMMICH_COMPANION_PROJECT" \
  --env-file "$CIMMICH_COMPANION_STATE_ROOT/runtime.env" \
  --file compose.yaml \
  --file compose.database-backup.yaml \
  up --detach --wait cimmich-api
```

The destination must already exist. Cimmich exposes only configured locations
in the UI and writes below `/database-backup`; it cannot browse or write to an
arbitrary server path. The storage-domain ID must differ from the Cimmich
database volume. The project and environment arguments are required so the
override extends the configured guided installation. To offer more than one
location, add equivalent writable
mounts below `/database-backup` and include them in
`CIMMICH_DATABASE_BACKUP_TARGETS_JSON`.

In Archive Health, select one or more locations, choose Manual, Daily or Weekly,
set how many verified copies to retain, then save the schedule. **Back up now**
creates a new dump, verifies its PostgreSQL catalogue, calculates SHA-256 and
publishes a sidecar manifest. **Check latest** re-reads every byte, compares the
recorded size and SHA-256, and verifies the restore catalogue again. Older
Cimmich-created artifacts are removed only after a newer verified backup has
been recorded at that destination.

For a full emergency restore, size PostgreSQL's maintenance memory for the
largest vector index. The current representative archive requires at least
311 MB, so use a 512 MB restore session, for example
`PGOPTIONS='-c maintenance_work_mem=512MB' pg_restore ...`. `Check latest`
validates the complete checksum and restore catalogue; release acceptance must
still rehearse a full isolated restore before relying on a new backup path.

## Back up, move, restore or remove

Create and inspect a backup before updates, restore or removal:

```sh
./tools/companion.sh backup /absolute/new/backup-directory
```

The command validates the database dump, archive members, configuration,
semantic counts and checksums before it renames the new directory into place.
Success is a JSON receipt containing `"status":"READY"`. The directory should
contain `cimmich.dump`, three `.tgz` archives, `manifest.json` and
`SHA256SUMS`; retain the receipt with the backup.

For a move to another installation, use portable export. It carries the
Cimmich database and document store while excluding original media, Immich
credentials and provider artifacts:

```sh
./tools/companion.sh portable-export /absolute/new/export-directory
```

Restore and removal require the exact project confirmation:

```sh
./tools/companion.sh restore /absolute/backup --confirm=cimmich-companion
./tools/companion.sh portable-restore /absolute/export --confirm=cimmich-companion
./tools/companion.sh remove --confirm=cimmich-companion
```

`remove` deletes only the exact Cimmich project, Cimmich volumes and its
recognised state directory after refusing unknown files. It never removes
Immich or original media. Read [archive mobility](docs/ARCHIVE_MOBILITY.md)
before moving state to a different Immich installation.

## Updating

1. Export the same state root used for installation.
2. Make and inspect a current Cimmich backup.
3. Download the next named release and its `SHA256SUMS`.
4. Read the release's compatibility statement, changelog and limitations.
5. Verify and extract the new bundle.
6. From the new release folder, run:

   ```sh
   ./tools/install.sh --check
   ./tools/install.sh --resume
   ./tools/install.sh --status
   ./tools/companion.sh doctor
   ```

Do not combine a newer Compose definition with older images or source. Do not
remove the existing project to perform a normal update.

## Advanced operator install

Operators who need a non-default state root can use the same complete lifecycle
explicitly:

```sh
export CIMMICH_COMPANION_STATE_ROOT=/srv/cimmich/operator
export CIMMICH_COMPANION_PROJECT=cimmich-companion
export CIMMICH_COMPANION_PRIVATE_LOCK_MODE=none

./tools/companion.sh configure http://host.docker.internal:2283
./tools/companion.sh up
./tools/companion.sh status
```

Choose a new, dedicated absolute state directory outside the Immich directory,
Cimmich source folder and the home directory itself. A private subdirectory
inside your home directory is valid. `configure` writes a mode-`0600`
`runtime.env`. Ports default to loopback-only API `3411` and UI `3413`; set
`CIMMICH_COMPANION_API_PORT` and `CIMMICH_COMPANION_UI_PORT` before `configure`
to change them.

The root `compose.yaml` is the deployment definition used by this operator.
Running it directly with a hand-written `.env` can start the services, but it
does not create the operator's `runtime.env`; the documented backup, restore,
doctor and removal commands will therefore not own that manual installation.
Do not mix the two lifecycle styles.

## Troubleshooting

### Docker is installed but unavailable

Start Docker Desktop, OrbStack or Docker Engine, wait for `docker info` to
succeed, then repeat `./tools/install.sh --check`.

### Cimmich cannot reach Immich

Inside a container, `127.0.0.1` means that container. Use
`host.docker.internal` for Immich on the same host or a reachable LAN address
for another machine. Confirm Immich opens in a browser before retrying.

### The version check fails

Community Preview 17 is tested with exact Immich 3.1.0. Do not bypass the
preflight or edit the claimed version. Use the tested Immich version or wait for
a named Cimmich release that explicitly tests yours.

### The API key is rejected

Create a new dedicated key with current-user read, asset read/download, Face
read and Person read. Do not add write or admin access to fix a read-permission
error. Cimmich reports the failing permission without returning the key.

### The UI does not open

```sh
./tools/install.sh --status
export CIMMICH_COMPANION_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/cimmich-companion"
./tools/companion.sh doctor
```

Use the named health error rather than repeatedly recreating the stack.

### I downloaded Cedar House instead of Cimmich

`cimmich-cedar-house-v1.tar.gz` contains fictional demonstration media. It is
not the application. Return to the latest release and download the named
`cimmich-<version>` bundle plus `SHA256SUMS`.

### Where is Cimmich data?

Cimmich stores its database, documents, configuration and optional provider
state in its exact project's named volumes and dedicated state root. Original
Immich media is not copied into those volumes. Read [PRIVACY.md](PRIVACY.md).

## Next steps

- [Product walkthrough](docs/WALKTHROUGH.md)
- [Privacy and data control](PRIVACY.md)
- [Frequently asked questions](docs/FAQ.md)
- [Development setup](DEVELOPMENT.md)
- [Fictional isolated demo](demo/cedar-house-v1/README.md)
