# Install Cimmich

Cimmich runs beside Immich with its own database, configuration, documents and
backups. It does not replace Immich, write to the Immich database or modify
original media.

## Requirements

- exact Immich 3.1.0;
- Docker Desktop, OrbStack or Docker Engine with Compose v2;
- macOS or Linux for the guarded installer (`curl` and `openssl` required);
- several gigabytes of free Docker storage; and
- your normal Immich sign-in.

Do not paste an Immich API key, password or token into an AI conversation or
`.env`. Cimmich accepts a dedicated read-only Immich API key later, through a
write-only field in its signed-in Settings screen.

## Five-minute Docker Compose install

This is the conventional, script-free path.

### 1. Download and inspect

Download the named Cimmich tar or ZIP and `SHA256SUMS` from the
[latest release](https://github.com/cimmich/cimmich/releases/latest). The Cedar
House archive is demo data, not the application. Extract the bundle and inspect:

```sh
ls compose.yaml .env.example INSTALL.md
docker compose version
```

Verify the bundle against `SHA256SUMS` before running it. GitHub’s generated
source archives contain the same source, but the named bundle is the documented
install artifact.

### 2. Configure without secrets in Compose source

```sh
cp .env.example .env
openssl rand -hex 32
```

Put that new random value in `CIMMICH_DB_PASSWORD`. Confirm the credential-free
Immich API and web URLs. For Immich on the same computer at its normal port, the
supplied `host.docker.internal` values are usually correct. For another machine,
use its LAN address.

```sh
docker compose config --quiet
```

### 3. Pull and start

```sh
docker compose pull cimmich-api cimmich-ui
docker compose up --detach --no-build --wait
docker compose ps
```

The preflight stops before Cimmich database startup unless Immich is reachable
and exactly 3.1.0. Open <http://127.0.0.1:3413>, sign in through Immich, add a
dedicated read-only Immich API key in Cimmich Settings, then preview the exact
library scope before importing.

Normal lifecycle commands preserve Cimmich’s named volumes:

```sh
docker compose stop
docker compose start
docker compose down
```

Never add `--volumes` unless you deliberately intend to destroy Cimmich’s own
database, documents and configuration. These commands do not target Immich.

## Guarded installer

This route adds preflight, resumable setup, checksummed backup/restore and
confirmation-gated Cimmich-only removal around the same Compose definition.

```sh
./tools/install.sh --check
./tools/install.sh
```

The installer asks for the credential-free Immich origin and whether Private
viewing should require an extra local password. It does not ask for an Immich
API key. If Docker or the network interrupts installation, fix the named issue
and continue with:

```sh
./tools/install.sh --resume
./tools/install.sh --status
```

Native Windows PowerShell is not supported. WSL2 remains an advanced, unclaimed
path until it has clean-install proof.

## Operator commands

Advanced commands require the same dedicated state root used during configure:

```sh
export CIMMICH_COMPANION_STATE_ROOT="$HOME/.local/state/cimmich-companion"
./tools/companion.sh status
./tools/companion.sh doctor
```

`doctor` emits a redacted JSON report covering the Cimmich version, Docker and
Compose availability, service health, schema version/patch, exact Immich
compatibility, configuration permissions and available disk. It intentionally
excludes credentials, origins, paths, filenames, media and private identities.

Other guarded operations:

```sh
./tools/companion.sh sync
./tools/companion.sh face-provider install-recommended
./tools/companion.sh private-password status
./tools/companion.sh backup /absolute/new/backup-directory
./tools/companion.sh portable-export /absolute/new/export-directory
./tools/companion.sh disable
```

### Optional local Face recognition

```sh
./tools/companion.sh face-provider install-recommended
```

This installs the checksum-pinned OpenCV YuNet and SFace CPU provider into a
separate Cimmich volume. It is optional, local and does not grant automatic
identity acceptance.

Restore and removal require an exact project confirmation. Read the command’s
usage and inspect the backup before proceeding:

```sh
./tools/companion.sh restore /absolute/backup --confirm=cimmich-companion
./tools/companion.sh portable-restore /absolute/export --confirm=cimmich-companion
./tools/companion.sh remove --confirm=cimmich-companion
```

`remove` deletes only the exact Cimmich Compose project, Cimmich volumes and its
dedicated state directory after refusing unknown files. It never removes Immich
or source media.

## Build locally instead of pulling images

Published API and UI images are the ordinary install path. They are built for
amd64 and arm64 with SBOM and GitHub provenance attestations. A contributor can
build the checked-in Dockerfiles instead:

```sh
docker compose build cimmich-api
docker compose build cimmich-ui
docker compose up --detach --no-build --wait
```

For the guarded operator, set `CIMMICH_COMPANION_BUILD_LOCAL=true` only for the
command that prepares or updates images.

## Updating

1. Make and verify a current Cimmich backup.
2. Download the next named release and its `SHA256SUMS`.
3. Read its changelog, exact Immich compatibility and image digests.
4. Preserve your dedicated state root and named volumes.
5. Run the new release’s `./tools/install.sh --resume`, or pull the new image
   tags and run `docker compose up --detach --no-build --wait`.
6. Run `./tools/companion.sh doctor` and verify `ok: true`.

Do not reuse a newer Compose file with older images or vice versa.

## Troubleshooting

### Docker is installed but unavailable

Start Docker Desktop, OrbStack or the Docker daemon, wait for `docker info` to
succeed, then repeat the check. Do not run the installer with `sudo`.

### Cimmich cannot reach Immich

From a container, `127.0.0.1` means that container. Use
`host.docker.internal` for Immich on the same host or a reachable LAN address
for another machine. Keep the URL free of credentials, query strings and
fragments.

### The UI does not open

Run `./tools/companion.sh doctor` or `docker compose ps`. The database, API, UI
and gateway must all be running; health errors are more useful than repeatedly
restarting the stack.

### Where data lives

Compose stores Cimmich data in the exact project’s named database, documents,
configuration and optional provider volumes. It does not copy the original
Immich photo library. See [PRIVACY.md](PRIVACY.md) and
[docs/PRIVACY_BOUNDARY.md](docs/PRIVACY_BOUNDARY.md).

For the fictional isolated demo, follow
[demo/cedar-house-v1/README.md](demo/cedar-house-v1/README.md). For development,
workspace/package-manager details and all validation commands, see
[DEVELOPMENT.md](DEVELOPMENT.md).
