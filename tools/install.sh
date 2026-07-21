#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPANION="$ROOT/tools/companion.sh"
STATE_ROOT=${CIMMICH_COMPANION_STATE_ROOT:-"${XDG_STATE_HOME:-$HOME/.local/state}/cimmich-companion"}
PROJECT=${CIMMICH_COMPANION_PROJECT:-cimmich-companion}
DEFAULT_IMMICH_ORIGIN=${CIMMICH_INSTALL_IMMICH_ORIGIN:-http://host.docker.internal:2283}
finished=false
show_recovery=false
saved_stty=

say() {
  printf '%s\n' "$*"
}

fail() {
  printf '\nCimmich installer: %s\n' "$*" >&2
  exit 1
}

restore_terminal() {
  if test -n "$saved_stty"; then
    stty "$saved_stty" 2>/dev/null || true
    saved_stty=
  fi
}

finish() {
  status=$?
  trap - EXIT INT TERM
  restore_terminal
  unset secret_input 2>/dev/null || true
  if test "$status" -ne 0 && test "$finished" != true && test "$show_recovery" = true; then
    printf '\nNothing outside the dedicated Cimmich project was removed.\n' >&2
    printf 'Your Cimmich state was left in place. After fixing the issue, inspect it with:\n' >&2
    printf '  ./tools/install.sh --status\n' >&2
    printf 'If configuration succeeded but startup did not, resume with:\n' >&2
    printf '  ./tools/install.sh --resume\n' >&2
  fi
  exit "$status"
}
trap finish EXIT INT TERM

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required. Install it, then run this installer again."
}

prompt_default() {
  label=$1
  default=$2
  printf '%s [%s]: ' "$label" "$default" >&2
  IFS= read -r prompt_value || true
  if test -z "$prompt_value"; then
    prompt_value=$default
  fi
}

read_secret() {
  test -t 0 || fail "Private-password setup needs an interactive terminal"
  printf '%s' "$1" >&2
  saved_stty=$(stty -g)
  stty -echo
  IFS= read -r secret_input || true
  restore_terminal
  printf '\n' >&2
  test -n "$secret_input" || fail "the Private password cannot be empty"
}

check_requirements() {
  require_command docker
  require_command curl
  require_command openssl
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
  docker info >/dev/null 2>&1 || fail "Docker is installed but is not running"
  test -x "$COMPANION" || fail "run this command from an intact Cimmich release folder"
}

usage() {
  cat <<'EOF'
Usage: ./tools/install.sh [--check|--status|--resume|--help]

With no option, this guided installer creates one loopback-only Cimmich
companion beside an existing Immich installation. It never writes the Immich
database or source media. It does not ask for the Immich API key: enter that
later in Cimmich's signed-in first-run page so the secret never enters shell
history or an AI chat.

Options:
  --check  Verify Docker and required local commands without changing state.
  --status Read the health of the guided installation without changing state.
  --resume Build/start an already configured guided installation.
  --help   Show this help.
EOF
}

case ${1:-} in
  --help|-h)
    usage
    finished=true
    exit 0
    ;;
  --check)
    test "$#" -eq 1 || fail "--check does not accept another argument"
    check_requirements
    say '{"docker":"ready","installer":"ready","state":"unchanged"}'
    finished=true
    exit 0
    ;;
  --status)
    test "$#" -eq 1 || fail "--status does not accept another argument"
    check_requirements
    export CIMMICH_COMPANION_STATE_ROOT=$STATE_ROOT
    export CIMMICH_COMPANION_PROJECT=$PROJECT
    "$COMPANION" status
    finished=true
    exit 0
    ;;
  --resume)
    test "$#" -eq 1 || fail "--resume does not accept another argument"
    show_recovery=true
    check_requirements
    export CIMMICH_COMPANION_STATE_ROOT=$STATE_ROOT
    export CIMMICH_COMPANION_PROJECT=$PROJECT
    "$COMPANION" up
    finished=true
    exit 0
    ;;
  '') show_recovery=true ;;
  *) usage >&2; fail "unsupported option; use --help" ;;
esac

check_requirements

say ""
say "Cimmich guided installation"
say "============================"
say ""
say "This installs Cimmich Core beside your existing Immich library."
say "Your Immich database and original media remain untouched."
say "Cimmich keeps its own database and can be disabled or removed separately."
say ""
say "The normal defaults are correct when Immich runs on this computer on port 2283."
say "For another computer, enter an address reachable from Docker, such as"
say "http://192.168.1.20:2283. Do not include /api or an API key."
say ""

prompt_default "Immich address" "$DEFAULT_IMMICH_ORIGIN"
immich_origin=$prompt_value

say ""
say "Private is an optional Cimmich viewing mode, not account security or encryption."
say "  1) No extra password (recommended for the simplest setup)"
say "  2) Ask for a local password before switching to Private"
prompt_default "Choose 1 or 2" "1"
case "$prompt_value" in
  1) private_lock_mode=none ;;
  2) private_lock_mode=password ;;
  *) fail "choose 1 or 2 for the Private viewing mode" ;;
esac

if test -f "$STATE_ROOT/runtime.env"; then
  fail "Cimmich is already configured at $STATE_ROOT; use ./tools/install.sh --status instead"
fi

say ""
say "Installing Cimmich into: $STATE_ROOT"
say "Docker will build the release images locally. The first build can take several minutes."
say ""

export CIMMICH_COMPANION_STATE_ROOT=$STATE_ROOT
export CIMMICH_COMPANION_PROJECT=$PROJECT
export CIMMICH_COMPANION_PRIVATE_LOCK_MODE=$private_lock_mode

"$COMPANION" configure "$immich_origin"
"$COMPANION" up

if test "$private_lock_mode" = password; then
  say ""
  read_secret "Private viewing password (any non-empty value): "
  printf '%s\n' "$secret_input" | "$COMPANION" private-password configure >/dev/null
  unset secret_input
fi

say ""
"$COMPANION" status
say ""
say "Cimmich is installed."
say ""
say "Next:"
say "  1. Open http://127.0.0.1:${CIMMICH_COMPANION_UI_PORT:-3413}"
say "  2. Sign in with your normal Immich account."
say "  3. Open Cimmich Settings."
say "  4. In 'Connect your existing Immich library', enter the Immich address"
say "     and a least-privilege Immich API key. The key field is write-only."
say "  5. Preview the proposed scope before importing anything."
say ""
say "Cimmich Core works without a model. Optional matching and evidence providers"
say "remain disabled until you deliberately configure them."
say ""
say "Keep this release folder for updates and administration. See INSTALL.md for"
say "backup, disable, removal and the advanced installation path."

finished=true
