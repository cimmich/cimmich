#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPANION="$ROOT/tools/companion.sh"
STATE_ROOT=${CIMMICH_COMPANION_STATE_ROOT:-"${XDG_STATE_HOME:-$HOME/.local/state}/cimmich-companion"}
PROJECT=${CIMMICH_COMPANION_PROJECT:-cimmich-companion}
DEFAULT_IMMICH_ORIGIN=${CIMMICH_INSTALL_IMMICH_ORIGIN:-http://host.docker.internal:2283}
GATEWAY_IMAGE=nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de
finished=false
show_recovery=false
saved_stty=
port_issue_count=0

say() {
  printf '%s\n' "$*"
}

ok() {
  printf '  ✓ %s\n' "$*"
}

note() {
  printf '  • %s\n' "$*"
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
  verbose=${1:-false}
  case "$(uname -s)" in
    Darwin) platform="macOS" ;;
    Linux) platform="Linux" ;;
    *) fail "the guided installer currently supports macOS and Linux" ;;
  esac
  test -f "$ROOT/AGENT_INSTALL.md" && test -f "$ROOT/INSTALL.md" && test -f "$ROOT/README.md" ||
    fail "run this command from an intact extracted Cimmich release folder"
  test -x "$COMPANION" ||
    fail "tools/companion.sh is missing or not executable; extract the complete Cimmich release bundle again"
  require_command docker
  require_command curl
  require_command openssl
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
  docker info >/dev/null 2>&1 || fail "Docker is installed but is not running"
  if test "$verbose" = true; then
    ok "Intact Cimmich release folder"
    ok "Supported platform: $platform"
    ok "Docker installed"
    ok "Docker Compose v2 available"
    ok "Docker engine running"
    ok "curl available"
    ok "openssl available"
  fi
}

report_disk_space() {
  available_kb=$(df -Pk "$ROOT" 2>/dev/null | awk 'NR == 2 { print $4 }')
  case "$available_kb" in
    ''|*[!0-9]*)
      note "Available disk space could not be measured; local Docker builds need several gigabytes"
      ;;
    *)
      available_gb=$((available_kb / 1024 / 1024))
      note "Approximately ${available_gb} GB available on the release-folder volume (Docker storage may be elsewhere)"
      ;;
  esac
}

port_check() {
  checked_port=$1
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$checked_port" >/dev/null 2>&1
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$checked_port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn | awk -v suffix=":$checked_port" '
      NR > 1 && substr($4, length($4) - length(suffix) + 1) == suffix {
        found = 1
      }
      END { exit found ? 0 : 1 }
    '
    return
  fi
  return 2
}

report_port() {
  port=$1
  label=$2
  mode=${3:-install}
  if port_check "$port"; then
    if test "$mode" = check; then
      note "$label port $port is already in use"
      port_issue_count=$((port_issue_count + 1))
    else
      fail "$label port $port is already in use; close the other service or use the advanced install to choose ports"
    fi
  else
    port_status=$?
    if test "$port_status" -eq 2; then
      note "$label port $port could not be prechecked; it will be verified when Cimmich starts"
    else
      ok "$label port $port available"
    fi
  fi
}

validate_immich_origin() {
  value=$1
  case "$value" in
    http://*|https://*) ;;
    *) fail "Immich addresses must begin with http:// or https://" ;;
  esac
  authority=${value#*://}
  test -n "$authority" || fail "the Immich address needs a host"
  case "$authority" in
    *[[:space:]]*|*@*|*/*|*\#*|*\?*)
      fail "use only the Immich address and port, without /api, a path, credentials, query or fragment"
      ;;
    *[!A-Za-z0-9._:-]*) fail "the Immich address contains unsupported characters" ;;
  esac
}

verify_immich_reachable_from_docker() {
  origin=$1
  say ""
  say "Checking that Docker can reach Immich..."
  if ! docker run --rm \
    --add-host host.docker.internal:host-gateway \
    "$GATEWAY_IMAGE" \
    wget -q -O /dev/null "$origin/api/server/version"; then
    fail "Docker could not reach Immich at $origin. Check the address and port, then run the installer again. No Cimmich state was created."
  fi
  ok "Immich is reachable from Docker at $origin"
}

guided_state() {
  if test -f "$STATE_ROOT/runtime.env"; then
    printf 'existing'
  else
    printf 'unchanged'
  fi
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

For agent-assisted installation and signed-in setup, read AGENT_INSTALL.md.
EOF
}

configured_private_lock_mode() {
  awk -F= '
    $1 == "CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE" {
      print substr($0, index($0, "=") + 1)
      found = 1
      exit
    }
    END { if (!found) exit 1 }
  ' "$STATE_ROOT/runtime.env"
}

complete_private_password_after_resume() {
  private_lock_mode=$(configured_private_lock_mode) ||
    fail "the saved Private viewing mode is missing; inspect $STATE_ROOT/runtime.env"
  test "$private_lock_mode" = password || return 0

  private_status=$("$COMPANION" private-password status)
  case "$private_status" in
    *'"configured":true'*) return 0 ;;
  esac

  say ""
  say "Finish the interrupted Private viewing setup"
  read_secret "Private viewing password (any non-empty value): "
  printf '%s\n' "$secret_input" | "$COMPANION" private-password configure >/dev/null
  unset secret_input
}

installation_ui_port() {
  if test -n "${CIMMICH_COMPANION_UI_PORT:-}"; then
    printf '%s' "$CIMMICH_COMPANION_UI_PORT"
    return
  fi
  if test -f "$STATE_ROOT/runtime.env"; then
    awk -F= '
      $1 == "CIMMICH_COMPANION_UI_PORT" {
        print substr($0, index($0, "=") + 1)
        found = 1
        exit
      }
      END { if (!found) exit 1 }
    ' "$STATE_ROOT/runtime.env" && return
  fi
  printf '3413'
}

print_install_success() {
  ui_port=$(installation_ui_port)
  say ""
  "$COMPANION" status
  say ""
  say "Cimmich is installed."
  say "API, database and web interface are healthy."
  say ""
  say "Next:"
  say "  1. Open http://127.0.0.1:${ui_port}"
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
  say ""
  printf '{"schemaVersion":"cimmich.agent-install-handoff.v1","state":"installed","webUrl":"http://127.0.0.1:%s","nextAction":"signed_in_setup"}\n' \
    "$ui_port"
}

case ${1:-} in
  --help|-h)
    usage
    finished=true
    exit 0
    ;;
  --check)
    test "$#" -eq 1 || fail "--check does not accept another argument"
    say ""
    say "Cimmich install check"
    say "====================="
    check_requirements true
    report_disk_space
    state=$(guided_state)
    if test "$state" = existing; then
      note "An existing guided Cimmich installation is configured at $STATE_ROOT"
      note "Use ./tools/install.sh --status instead of installing again"
    else
      report_port "${CIMMICH_COMPANION_API_PORT:-3411}" "API" check
      report_port "${CIMMICH_COMPANION_UI_PORT:-3413}" "Web" check
      ok "No existing guided installation at $STATE_ROOT"
      say ""
      if test "$port_issue_count" -eq 0; then
        say "This computer is ready for the guided install."
      else
        say "Cimmich needs ${port_issue_count} local port issue(s) resolved before installation."
      fi
    fi
    say ""
    if test "$port_issue_count" -eq 0; then
      printf '{"docker":"ready","installer":"ready","state":"%s"}\n' "$state"
    else
      printf '{"docker":"ready","installer":"blocked","state":"%s","portIssues":%s}\n' "$state" "$port_issue_count"
      finished=true
      exit 1
    fi
    finished=true
    exit 0
    ;;
  --status)
    test "$#" -eq 1 || fail "--status does not accept another argument"
    check_requirements false
    export CIMMICH_COMPANION_STATE_ROOT=$STATE_ROOT
    export CIMMICH_COMPANION_PROJECT=$PROJECT
    "$COMPANION" status
    finished=true
    exit 0
    ;;
  --resume)
    test "$#" -eq 1 || fail "--resume does not accept another argument"
    show_recovery=true
    check_requirements false
    export CIMMICH_COMPANION_STATE_ROOT=$STATE_ROOT
    export CIMMICH_COMPANION_PROJECT=$PROJECT
    "$COMPANION" up
    complete_private_password_after_resume
    print_install_success
    finished=true
    exit 0
    ;;
  '') ;;
  *) usage >&2; fail "unsupported option; use --help" ;;
esac

say ""
say "Cimmich install check"
say "====================="
check_requirements true
report_disk_space
if test "$(guided_state)" = existing; then
  fail "Cimmich is already configured at $STATE_ROOT; use ./tools/install.sh --status instead"
fi
report_port "${CIMMICH_COMPANION_API_PORT:-3411}" "API"
report_port "${CIMMICH_COMPANION_UI_PORT:-3413}" "Web"
ok "No existing guided installation at $STATE_ROOT"

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
validate_immich_origin "$immich_origin"

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

verify_immich_reachable_from_docker "$immich_origin"

say ""
say "Ready to install"
say "----------------"
say "Immich: $immich_origin"
say "Cimmich web address: http://127.0.0.1:${CIMMICH_COMPANION_UI_PORT:-3413}"
say "Cimmich state: $STATE_ROOT"
say "Private view password: $private_lock_mode"
say ""
say "Cimmich will create only its own Docker project, database and configuration."
say "It will not import anything or ask for an Immich API key during installation."
prompt_default "Continue? Enter y or n" "y"
case "$prompt_value" in
  y|Y|yes|YES) ;;
  n|N|no|NO) fail "installation cancelled before any Cimmich state was created" ;;
  *) fail "enter y or n" ;;
esac

say ""
say "Step 1 of 3 — Create private Cimmich configuration"
say "Installing Cimmich into: $STATE_ROOT"
say ""

export CIMMICH_COMPANION_STATE_ROOT=$STATE_ROOT
export CIMMICH_COMPANION_PROJECT=$PROJECT
export CIMMICH_COMPANION_PRIVATE_LOCK_MODE=$private_lock_mode

"$COMPANION" configure "$immich_origin"
show_recovery=true

say ""
say "Step 2 of 3 — Build and start Cimmich"
say "The first local build commonly takes 4–10 minutes. Docker output will follow."
"$COMPANION" up

if test "$private_lock_mode" = password; then
  say ""
  say "Step 3 of 3 — Configure the optional Private viewing password"
  read_secret "Private viewing password (any non-empty value): "
  printf '%s\n' "$secret_input" | "$COMPANION" private-password configure >/dev/null
  unset secret_input
else
  say ""
  say "Step 3 of 3 — Private viewing uses no extra password"
fi

print_install_success

finished=true
