#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUN_ID=$$
CONTAINER="cimmich-physical-face-acceptance-$RUN_ID"
IMAGE=pgvector/pgvector:0.8.2-pg17-trixie
TMP_ROOT=$(mktemp -d)

cleanup() {
  status=$?
  docker rm -fv "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
  return "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$TMP_ROOT/migrations/patches"
for migration in "$ROOT"/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  version=$(basename "$migration" | cut -c1-4 | sed 's/^0*//')
  if [ "$version" -le 124 ]; then cp "$migration" "$TMP_ROOT/migrations/"; fi
done
cp "$ROOT"/migrations/patches/*.sql "$TMP_ROOT/migrations/patches/"

docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=cimmich_physical_test \
  -e POSTGRES_USER=cimmich_physical_test \
  -e POSTGRES_PASSWORD=synthetic-physical-face-password \
  -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data "$IMAGE" >/dev/null

i=0
until docker exec "$CONTAINER" pg_isready \
  -U cimmich_physical_test -d cimmich_physical_test >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "physical Face acceptance database readiness timeout" >&2
    exit 1
  fi
  sleep 1
done

HOST_PORT=$(docker port "$CONTAINER" 5432/tcp | sed -n 's/.*://p' | head -n 1)
case "$HOST_PORT" in
  '' | *[!0-9]*)
    echo "physical Face acceptance port discovery failed" >&2
    exit 1
    ;;
esac
DATABASE_URL="postgres://cimmich_physical_test:synthetic-physical-face-password@127.0.0.1:$HOST_PORT/cimmich_physical_test"

DATABASE_URL="$DATABASE_URL" CIMMICH_MIGRATIONS_DIRECTORY="$TMP_ROOT/migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >/dev/null
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 \
  -U cimmich_physical_test -d cimmich_physical_test \
  < "$ROOT/tests/sql/019_physical_face_reconciliation_fixture.sql"
DATABASE_URL="$DATABASE_URL" CIMMICH_MIGRATIONS_DIRECTORY="$ROOT/migrations" \
  npm --prefix "$ROOT/service" run migrate -- apply >/dev/null
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 \
  -U cimmich_physical_test -d cimmich_physical_test \
  < "$ROOT/tests/sql/020_physical_face_reconciliation_acceptance.sql"
docker exec "$CONTAINER" psql -v ON_ERROR_STOP=1 \
  -U cimmich_physical_test -d cimmich_physical_test \
  -c "SELECT cimmich_refresh_physical_face_reconciliation()" >/dev/null
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 \
  -U cimmich_physical_test -d cimmich_physical_test \
  < "$ROOT/tests/sql/020_physical_face_reconciliation_acceptance.sql"

echo "Cimmich physical Face reconciliation acceptance: PASS (schema124 upgrade/rebuild/conflict quarantine/candidate repair)"
