#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONTAINER=cimmich-pg-stock-provider-acceptance
IMAGE=pgvector/pgvector:0.8.2-pg17-trixie

: "${CIMMICH_LOCAL_PYTHON_PATH:?Set CIMMICH_LOCAL_PYTHON_PATH to an isolated Python with OpenCV 4.11}"
: "${CIMMICH_OPENCV_DETECTOR_MODEL_PATH:?Set CIMMICH_OPENCV_DETECTOR_MODEL_PATH}"
: "${CIMMICH_OPENCV_RECOGNIZER_MODEL_PATH:?Set CIMMICH_OPENCV_RECOGNIZER_MODEL_PATH}"
: "${CIMMICH_PUBLIC_FIXTURE_IMAGE:?Set CIMMICH_PUBLIC_FIXTURE_IMAGE to an explicitly releasable image}"
: "${CIMMICH_PUBLIC_FIXTURE_SHA256:?Set CIMMICH_PUBLIC_FIXTURE_SHA256}"

cleanup() {
  status=$?
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  return "$status"
}
trap cleanup EXIT INT TERM
cleanup

docker run -d --name "$CONTAINER" \
  -e POSTGRES_DB=cimmich_stock_provider \
  -e POSTGRES_USER=cimmich_stock_provider \
  -e POSTGRES_PASSWORD=public-fixture-only-password \
  -p 127.0.0.1:55434:5432 \
  --tmpfs /var/lib/postgresql/data \
  "$IMAGE" >/dev/null

i=0
until docker exec "$CONTAINER" pg_isready -U cimmich_stock_provider -d cimmich_stock_provider >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "database readiness timeout" >&2
    exit 1
  fi
  sleep 1
done

DATABASE_URL=postgres://cimmich_stock_provider:public-fixture-only-password@127.0.0.1:55434/cimmich_stock_provider \
  npm --prefix "$ROOT/service" run migrate -- apply

DATABASE_URL=postgres://cimmich_stock_provider:public-fixture-only-password@127.0.0.1:55434/cimmich_stock_provider \
CIMMICH_LOCAL_MEDIA_PROVIDER=opencv-yunet-sface-cpu \
CIMMICH_OPENCV_PROVIDER_ROOT="$ROOT/providers/opencv-sface" \
/usr/bin/time -lp node "$ROOT/service/acceptance/stock-provider-journey.mjs"
