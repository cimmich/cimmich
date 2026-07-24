# Install Cimmich

Cimmich runs beside an existing Immich installation. It has its own database,
configuration and backups. It does not replace Immich, write to the Immich
database or modify original media.

## Choose your path

- **I want an AI assistant to install and set everything up:** give it this
  folder and the [agent installation contract](AGENT_INSTALL.md). The assistant
  handles the installer and verified setup while you retain secrets and approve
  the exact import preview.
- **I want to connect my existing Immich library:** use the
  [guided install](#guided-install-recommended). This is the recommended path.
- **I want to explore fictional data first:** use the
  [synthetic demo](README.md#try-cimmich-with-fictional-data). It does not touch your Immich
  installation or photographs.
- **I manage Docker and server paths myself:** use the
  [advanced install](#advanced-install).

The guided and advanced paths install the same product with the same safety
boundaries. Cimmich currently builds its containers locally from the downloaded
release; a published-image installation is not yet claimed.

> [!IMPORTANT]
> The guided installer currently supports **macOS and Linux**. Native Windows
> PowerShell is not supported. WSL2 remains an advanced, unclaimed path until
> it has its own clean-install proof.

## Before you begin

You need:

1. A working Immich 3.0.3 installation. Other 3.x releases are not claimed by
   this release until their compatibility is proved.
2. Docker Desktop, OrbStack or Docker Engine with Docker Compose v2.
3. `curl` and `openssl`. They are already present on a normal macOS system;
   the preflight check names anything missing on Linux.
4. Several gigabytes of free disk space for local image builds, Docker cache
   and Cimmich's separate database. Cimmich does not copy your original photo
   library.
5. Your normal Immich sign-in. You will create a dedicated read-only API key
   later, inside Immich; do not create or paste it into Terminal.

Do not paste an Immich API key, password or token into an AI conversation. The
guided installer deliberately does not ask for an API key in Terminal. You add
it later to a write-only field inside the signed-in Cimmich setup screen.

## Guided install (recommended)

This is the recommended path when Docker is unfamiliar or an AI assistant is
helping you.

### 1. Download Cimmich

1. Open the [Cimmich releases page](https://github.com/cimmich/cimmich/releases).
2. Choose the newest release labelled **Public Beta**.
3. Expand **Assets**.
4. Download the named `cimmich-<version>.tar.gz` install bundle. Use the ZIP
   bundle if your computer handles ZIP files more comfortably.
5. Download `SHA256SUMS` from the same release if you want to verify the
   download independently.

The Cedar House archive is the fictional demo data, not the application
installer. GitHub's automatically generated **Source code** archives contain
the same source, but the named Cimmich bundle has a predictable folder name and
is the documented installation path.

Extract the download. You should now have one folder named for the release,
containing `INSTALL.md`, `README.md` and a `tools` folder.

### 2. Start Docker

Open Docker Desktop or OrbStack and wait until it says the engine is running.
Linux Docker Engine users should confirm their normal account can run
`docker info` without `sudo`.

Do not continue with an administrator/root Terminal. Cimmich does not require
`sudo`.

### 3. Open Terminal in the extracted Cimmich folder

On macOS, open Terminal, type `cd ` with a trailing space, drag the extracted
Cimmich folder into the Terminal window, then press Return. On Linux, open a
terminal and change to the extracted folder.

You can confirm you are in the right folder with:

```sh
ls INSTALL.md tools/install.sh
```

Both paths should be printed. If either is missing, return to the extracted
Cimmich folder before continuing.

### 4. Check the computer without changing anything

```sh
./tools/install.sh --check
```

The check does not create containers, configuration or database state. A successful
result explains each prerequisite and ends with:

```json
{"docker":"ready","installer":"ready","state":"unchanged"}
```

If Docker is installed but not running, start Docker and repeat the check. The
check also reports the supported platform, required commands, local ports,
existing guided-install state and free space on the release-folder volume.
Docker Desktop or another remote Docker engine may store images elsewhere, so
confirm its own storage allocation if that volume is separate.

### 5. Run the guided installer

```sh
./tools/install.sh
```

The installer asks only for:

- the address Docker should use to reach Immich; and
- whether switching to Cimmich's optional Private viewing mode should require
  an extra local password.

For Immich running on the same computer at its usual port, accept
`http://host.docker.internal:2283`. For Immich on another machine, enter its
LAN address, for example `http://192.168.1.20:2283`. Do not add `/api`, a path,
credentials or a query string.

The Private password is a local view-mode preference, not Immich login security
or encryption. No extra password is the simplest default. If you choose one,
any non-empty value is accepted and the prompt is hidden.

You do not have to decide now. Once Cimmich is running you can set, change or
remove it at any time from **Settings → Private view password**.

The first local build can take several minutes. If it stops, read the final
error and run `./tools/install.sh --resume` after fixing the reported issue.
Check it at any time with `./tools/install.sh --status`. These commands remember
the guided install's safe default state location. They will not reset or remove
your Immich installation.

The installer is finished only when it prints **Cimmich is installed** and the
API, database and web interface all report healthy.

### 6. Create a dedicated Immich API key

Keep the Terminal window open, but create the key in your browser:

1. Open your normal Immich web interface and sign in.
2. Open your account settings.
3. Find **API Keys** and choose **New API Key**.
4. Name it `Cimmich read-only`.
5. Grant only permissions covering:
   - the current signed-in user;
   - asset metadata and original-asset download/read;
   - Face read; and
   - Person read.
6. Do not grant asset, Face, Person, user or administration write permissions.
7. Create the key and keep the value on screen until the next step.

Immich may group or slightly rename permissions between compatible releases.
Cimmich verifies the required read operations before import and reports the
missing permission without echoing the key.

### 7. Connect and preview your library in Cimmich

When installation completes:

1. Open [http://127.0.0.1:3413](http://127.0.0.1:3413).
2. Sign in using your normal Immich account. Cimmich does not create a second
   user account.
3. Open **Settings** and choose **Connect your existing Immich library**.
4. Return to the dedicated, read-only API key you created in step 6.
5. Paste the key only into Cimmich's write-only API-key field.
6. Verify the reported Immich version, principal and permissions.
7. Preview the exact library lanes, media and inherited People/Face labels
   before choosing what to import.

Setup is successful when Cimmich shows the expected Immich account, supported
version, permission checks and a preview count that makes sense for your
library. Do not import if the account, server or preview is unexpected.

Cimmich Core works without a model. Matching and evidence providers remain
disabled until you deliberately configure them.

### Install with an AI assistant

For the simplest path, give an assistant the extracted folder and
[`AGENT_INSTALL.md`](AGENT_INSTALL.md). It joins this installer to the signed-in
setup and optional Guided V2 handoff, while keeping authentication, secrets and
the final import decision with you.

Use this prompt:

> Install and set up Cimmich from this extracted release folder. Follow
> `AGENT_INSTALL.md` exactly. Keep me in control of every secret and
> consequential choice. Complete the safe work you can, pause only when I must
> sign in, enter a secret locally or approve the exact import preview, then
> verify the finished installation.

The assistant may explain output, but you should personally enter any secret
into Cimmich or the installer's hidden terminal prompt.

## Advanced install

The companion operator is the canonical lifecycle interface. Pick a dedicated
absolute directory that is not your Immich directory, Cimmich source folder or
home directory.

```sh
export CIMMICH_COMPANION_STATE_ROOT=/srv/cimmich/operator
export CIMMICH_COMPANION_PROJECT=cimmich-companion
export CIMMICH_COMPANION_PRIVATE_LOCK_MODE=none

./tools/companion.sh configure http://host.docker.internal:2283
./tools/companion.sh up
./tools/companion.sh status
```

`configure` writes generated database credentials into a mode-`0600`
`runtime.env` under the state root. Ports default to loopback-only API `3411`
and UI `3413`; set `CIMMICH_COMPANION_API_PORT` and
`CIMMICH_COMPANION_UI_PORT` before `configure` to change them.

The recommended first-run path is still the signed-in Settings journey: enter
the Immich API key there, verify permissions, preview the scope and then import.
For headless operator workflows only, `configure` also accepts a second argument
pointing to a mode-`0600` API-key file. Never pass the key value itself on the
command line.

### Optional Private viewing password

The normal path is **Settings → Private view password** in Cimmich: one button
to set it, reset it or turn it off. Because this password decides what is drawn
on screen rather than who may sign in — Immich owns that — a reset does not ask
for the previous one, so a forgotten value is never a lockout.

For headless installs, scripted provisioning or recovery when the UI is
unavailable, set `CIMMICH_COMPANION_PRIVATE_LOCK_MODE=password` before
`configure`, start Cimmich, then supply the value over standard input:

```sh
trusted-secret-command | ./tools/companion.sh private-password configure
./tools/companion.sh private-password status
```

The command accepts no password argument or password environment variable.
See [Private viewing operations](docs/VISIBILITY_PRIVATE_OPERATIONS.md) for
rotation and removal.

### Inventory-only operator sync

The UI preview/import journey is preferred because it displays scope before
mutation. A headless operator may explicitly admit the ordinary inventory with:

```sh
./tools/companion.sh sync
```

This calls supported Immich APIs through the read companion. It does not write
the Immich database or source media and does not run an optional model.

### Optional local Face recognition

Cimmich Core does not need a model. To add optional local Face matching, run
this from the extracted Cimmich release folder:

```sh
./tools/companion.sh face-provider install-recommended
```

This explicit command downloads the checksum-pinned OpenCV YuNet and SFace
models from the official OpenCV publisher into Cimmich's private provider
volume, verifies both files, and restarts only the Cimmich API. It never uploads
photos, writes to Immich, names anyone automatically, or turns Enhanced on.
Return to **Models & Guided**, refresh status, and choose **Turn on Enhanced**
when you are ready.

#### Advanced: use your own compatible Face provider

An operator who already has compatible SCRFD and ArcFace ONNX files, and the
rights to use them, can instead bind them to the weight-free local InsightFace
adapter:

```sh
./tools/companion.sh face-provider configure \
  /absolute/private/path/provider-manifest.json \
  /absolute/private/path/detector.onnx \
  /absolute/private/path/recognizer.onnx
./tools/companion.sh face-provider status
```

The command validates the manifest and both model hashes before copying them
into Cimmich's private provider volume. It never downloads weights, uploads
photos or gives the model identity authority. Provider files are included in
Cimmich backup/restore once configured.

After importing accepted Immich Faces, run a bounded, resumable batch:

```sh
./tools/companion.sh process-faces 10 10
```

The first number is the number of batches; the second is the maximum assets per
batch (up to 25). Each photo is read through the configured read-only Immich
API, recognition results are provenance-bound to that exact source revision,
and replaying a completed command does not duplicate work. SourcePack
evaluation and activation remain governed operator-review steps; candidate
matches still require human confirmation in Review.

See
[the user-supplied provider boundary](providers/insightface-user-supplied/README.md)
before supplying any third-party model.

## Updating Cimmich

Do not remove the existing project to update it. Back up first, download and
extract the newer named release bundle, then run its installer against the same
guided state:

```sh
./tools/companion.sh backup /safe/new/cimmich-backup
./tools/install.sh --check
./tools/install.sh --resume
./tools/install.sh --status
```

The update path preserves the separate Cimmich database and configuration.
Read the newer release notes before updating, especially when its supported
Immich version or migration boundary changes. A future release that requires a
different command must say so explicitly in its release notes.

## Everyday operations

Use the same `CIMMICH_COMPANION_STATE_ROOT` and project for every command:

```sh
./tools/companion.sh status
./tools/companion.sh backup /safe/new/cimmich-backup
./tools/companion.sh disable
./tools/companion.sh up
```

- **status** reads health and connection state.
- **backup** creates a checksum manifest for Cimmich's database, Documents and
  configuration. The new backup directory must be outside the live state root.
- **disable** stops the API/UI while preserving the separate Cimmich database.
- **up** resumes the same installation.

Restore is state-changing and requires the exact project confirmation:

```sh
./tools/companion.sh restore /safe/cimmich-backup --confirm=cimmich-companion
```

Permanent removal deletes only the named Cimmich Compose project's containers,
volumes and recognized runtime file. Back up first and type the exact project
name:

```sh
./tools/companion.sh remove --confirm=cimmich-companion
```

Neither command is needed for a normal upgrade. Never point the Cimmich state
root or backup path at an Immich data or media directory.

## Troubleshooting

### Docker is installed but not running

Start Docker Desktop, OrbStack or Docker Engine, wait until it reports ready,
then repeat `./tools/install.sh --check`.

### Cimmich cannot reach Immich

`127.0.0.1` inside a container means that container, not the host. For Immich
on the same computer use `host.docker.internal`; for another computer use a LAN
hostname or address reachable from Docker. Confirm Immich is open in a browser
before retrying.

### The API key is rejected

Create a fresh dedicated key in Immich with current-user, asset read/download,
Face read and Person read access. Do not grant write/admin access to fix a read
permission error. Cimmich reports the failing permission without echoing the
key.

### The UI does not open

Run:

```sh
./tools/install.sh --status
```

If another process uses port `3413`, choose unused ports and configure a fresh
dedicated state root. Do not edit an active `runtime.env` by hand.

### Where is my data?

Cimmich's generated credentials live in the dedicated state root. Its database,
Documents and configuration use Compose volumes named for the configured
project. Immich remains independently owned and operational when Cimmich is
disabled.

For the supported release boundary and verification commands, see
[Release readiness](docs/RELEASE_READINESS.md).
