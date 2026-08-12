#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUN_ID=$$
CONTAINER="cimmich-source-pack-freshness-acceptance-$RUN_ID"
IMAGE=pgvector/pgvector:0.8.2-pg17-trixie

cleanup() {
  status=$?
  docker rm -fv "$CONTAINER" >/dev/null 2>&1 || true
  return "$status"
}
trap cleanup EXIT INT TERM

docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=cimmich_freshness_test \
  -e POSTGRES_USER=cimmich_freshness_test \
  -e POSTGRES_PASSWORD=synthetic-source-pack-password \
  -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data "$IMAGE" >/dev/null

i=0
until docker exec "$CONTAINER" pg_isready \
  -U cimmich_freshness_test -d cimmich_freshness_test >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "SourcePack freshness acceptance database readiness timeout" >&2
    exit 1
  fi
  sleep 1
done

HOST_PORT=$(docker port "$CONTAINER" 5432/tcp | sed -n 's/.*://p' | head -n 1)
case "$HOST_PORT" in
  '' | *[!0-9]*)
    echo "SourcePack freshness acceptance port discovery failed" >&2
    exit 1
    ;;
esac
DATABASE_URL="postgres://cimmich_freshness_test:synthetic-source-pack-password@127.0.0.1:$HOST_PORT/cimmich_freshness_test"

DATABASE_URL="$DATABASE_URL" CIMMICH_MIGRATIONS_DIRECTORY="$ROOT/migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >/dev/null
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 \
  -U cimmich_freshness_test -d cimmich_freshness_test \
  < "$ROOT/tests/sql/021_source_pack_candidate_freshness_acceptance.sql"
