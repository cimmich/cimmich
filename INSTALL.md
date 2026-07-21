# Install Cimmich

Cimmich runs beside an existing Immich installation. It has its own database,
configuration and backups. It does not replace Immich, write to the Immich
database or modify original media.

Choose the path that matches how you want to work:

- **Guided install:** for people who do not normally use Docker, including
  people asking an AI assistant to help.
- **Advanced install:** for operators who want to choose state paths, ports and
  lifecycle commands themselves.

Both paths install the same product with the same safety boundaries. This
release builds its Cimmich containers locally from the downloaded source; a
published-image installation is not yet claimed.

## Before you begin

You need:

1. A working Immich installation on a supported 3.x release.
2. Docker Desktop, OrbStack or Docker Engine with Docker Compose v2.
3. A downloaded Cimmich release folder. Extract it before running commands.
4. Enough free disk space for a separate Cimmich database and local image
   builds. Cimmich does not copy your original photo library.

Do not paste an Immich API key, password or token into an AI conversation. The
guided installer deliberately does not ask for an API key in Terminal. You add
it later to a write-only field inside the signed-in Cimmich setup screen.

## Option 1 — guided install

This is the recommended path when Docker is unfamiliar or an AI assistant is
helping you.

### 1. Open Terminal in the extracted Cimmich folder

On macOS, open Terminal, type `cd ` with a trailing space, drag the extracted
Cimmich folder into the Terminal window, then press Return. On Linux, open a
terminal and change to the extracted folder.

### 2. Check the computer without changing anything

```sh
./tools/install.sh --check
```

The successful result ends with:

```json
{ "docker": "ready", "installer": "ready", "state": "unchanged" }
```

If Docker is installed but not running, start Docker and repeat the check. The
check does not create containers, configuration or database state.

### 3. Run the guided installer

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

The first local build can take several minutes. If it stops, read the final
error and run `./tools/install.sh --resume` after fixing the reported issue.
Check it at any time with `./tools/install.sh --status`. These commands remember
the guided install's safe default state location. They will not reset or remove
your Immich installation.

### 4. Finish setup in Cimmich

When installation completes:

1. Open [http://127.0.0.1:3413](http://127.0.0.1:3413).
2. Sign in using your normal Immich account. Cimmich does not create a second
   user account.
3. Open **Settings** and choose **Connect your existing Immich library**.
4. In Immich, create a dedicated least-privilege API key with current-user,
   asset read/download, Face read and Person read access.
5. Paste the key only into Cimmich's write-only API-key field.
6. Verify the reported Immich version, principal and permissions.
7. Preview the exact library lanes, media and inherited People/Face labels
   before choosing what to import.

Cimmich Core works without a model. Matching and evidence providers remain
disabled until you deliberately configure them.

### Safe prompt for an AI assistant

Give an assistant the extracted folder and this prompt:

> Help me install Cimmich from this extracted folder. First run
> `./tools/install.sh --check`, explain any error in plain language, then run
> `./tools/install.sh`. Stop whenever the installer asks me a question so I can
> answer it myself. Never ask me to paste an API key, password or token into
> chat; never put secrets in command arguments, environment variables or shell
> history; never use `sudo`; never modify or remove my Immich containers,
> database or media; and do not run any Cimmich remove, reset or restore command.

The assistant may explain output, but you should personally enter any secret
into Cimmich or the installer's hidden terminal prompt.

## Option 2 — advanced install

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

Set `CIMMICH_COMPANION_PRIVATE_LOCK_MODE=password` before `configure`, start
Cimmich, then supply the value over standard input:

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
