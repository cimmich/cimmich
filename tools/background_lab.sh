#!/usr/bin/env bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE="$ROOT/tools/background-lab.compose.yml"
PROJECT=cimmich-background-lab
LAB_ENV_FILE=${CIMMICH_LAB_ENV_FILE:-}

if [ -n "$LAB_ENV_FILE" ] && { [ ! -f "$LAB_ENV_FILE" ] || [ ! -r "$LAB_ENV_FILE" ]; }; then
  echo "Configured background-lab environment file is unavailable" >&2
  exit 2
fi

compose() {
  if [ -n "$LAB_ENV_FILE" ]; then
    docker compose --env-file "$LAB_ENV_FILE" --project-name "$PROJECT" --file "$COMPOSE_FILE" "$@"
  else
    docker compose --project-name "$PROJECT" --file "$COMPOSE_FILE" "$@"
  fi
}

case "${1:-status}" in
  start)
    compose up --detach --build
    i=0
    until curl --fail --silent --show-error http://127.0.0.1:3201/health >/dev/null; do
      i=$((i + 1))
      if [ "$i" -ge 60 ]; then
        compose logs --tail=120 api postgres
        exit 1
      fi
      sleep 1
    done
    compose ps
    ;;
  stop)
    compose stop
    ;;
  status)
    compose ps
    curl --fail --silent --show-error http://127.0.0.1:3201/health || true
    printf '\n'
    ;;
  guided-token)
    compose exec --no-TTY api /bin/sh -c 'cat /run/cimmich-lab/guided-token'
    printf '\n'
    ;;
  destroy)
    if [ "${2:-}" != "--confirm=cimmich-background-lab" ]; then
      echo "Refusing destructive reset without --confirm=cimmich-background-lab" >&2
      exit 2
    fi
    compose down --volumes --remove-orphans
    ;;
  *)
    echo "usage: $0 {start|stop|status|guided-token|destroy --confirm=cimmich-background-lab}" >&2
    exit 2
    ;;
esac
