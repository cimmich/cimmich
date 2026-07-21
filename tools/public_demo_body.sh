#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT=${CIMMICH_PUBLIC_DEMO_PROJECT:-cimmich-public-demo}
STATE_ROOT=${CIMMICH_PUBLIC_DEMO_STATE_ROOT:-"${XDG_STATE_HOME:-$HOME/.local/state}/$PROJECT"}
COMPOSE_FILE="$ROOT/tools/public_demo.compose.yml"
COMMAND=${1:-status}
MODEL_PATH=${CIMMICH_BODY_MODEL_PATH:-}
POSE_MODEL_PATH=${CIMMICH_POSE_MODEL_PATH:-}
PYTHON_PATH=${CIMMICH_BODY_PYTHON_PATH:-}
SOURCE_ASSET_ID=${CIMMICH_BODY_SOURCE_ASSET_ID:-}

fail() { printf 'public-demo-body: %s\n' "$1" >&2; exit 1; }
test "$PROJECT" = cimmich-public-demo || fail "only the exact isolated public demo is supported"
test -f "$STATE_ROOT/.cimmich-public-demo" || fail "public demo state is unavailable"
test -f "$STATE_ROOT/operator.env" || fail "public demo operator state is unavailable"
test -f "$MODEL_PATH" || fail "set CIMMICH_BODY_MODEL_PATH to an operator-supplied checkpoint"
test -f "$POSE_MODEL_PATH" || fail "set CIMMICH_POSE_MODEL_PATH to an operator-supplied pose checkpoint"
test -x "$PYTHON_PATH" || fail "set CIMMICH_BODY_PYTHON_PATH to the local provider Python"
# shellcheck disable=SC1090
. "$STATE_ROOT/operator.env"
export IMMICH_DB_PASSWORD CIMMICH_DB_PASSWORD
compose() {
  CIMMICH_PUBLIC_DEMO_PROJECT="$PROJECT" \
    CIMMICH_PUBLIC_DEMO_STATE_ROOT="$STATE_ROOT" \
    CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT="${CIMMICH_PUBLIC_DEMO_ARCHIVE_ROOT:-$ROOT/demo/cedar-house-v1}" \
    docker compose --project-name "$PROJECT" --file "$COMPOSE_FILE" "$@"
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/cimmich-public-demo-body.XXXXXX")
cleanup() { rm -rf "$tmp"; }
stop() { exit 130; }
trap cleanup EXIT
trap stop INT TERM
chmod 700 "$tmp"
manifest="$tmp/manifest.json"
pose_manifest="$tmp/pose-manifest.json"
"$PYTHON_PATH" "$ROOT/providers/ultralytics-yolo-body/build_manifest.py" \
  --device cpu --image-size 640 --max-memory-mib 4096 --max-runtime-ms 120000 \
  --model "$MODEL_PATH" --model-id yolo11n --model-version operator-supplied-v1 \
  --model-rights unknown --training-data-rights unknown \
  --runtime-id ultralytics-8.4.92 --threshold 0.30 --output "$manifest"
config_digest=$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).detectorConfigDigest)' "$manifest")
"$PYTHON_PATH" "$ROOT/providers/ultralytics-yolo-pose/build_manifest.py" \
  --device cpu --image-size 640 --keypoint-threshold 0.20 \
  --max-memory-mib 4096 --max-runtime-ms 120000 \
  --model "$POSE_MODEL_PATH" --model-id yolo11x-pose \
  --model-version operator-supplied-v1 --model-rights unknown \
  --training-data-rights unknown --runtime-id ultralytics-8.4.92 \
  --threshold 0.20 --output "$pose_manifest"

status() {
  node -e 'process.stdout.write(JSON.stringify({action:"status",detectorConfigDigest:process.argv[1]}))' "$config_digest" |
    compose exec -T cimmich-api node bin/body-detection-operator.mjs
}

if test "$COMMAND" = status; then
  status
  exit 0
fi
test "$COMMAND" = run || test "$COMMAND" = pose || fail "usage: tools/public_demo_body.sh run|pose|status"

if test "$COMMAND" = pose; then
  node -e 'process.stdout.write(JSON.stringify({action:"poseList",detectorConfigDigest:process.argv[1]}))' "$config_digest" |
    compose exec -T cimmich-api node bin/body-detection-operator.mjs > "$tmp/list.json"
  node -e 'const fs=require("fs");for(const id of JSON.parse(fs.readFileSync(process.argv[1],"utf8")).items)console.log(id)' "$tmp/list.json" > "$tmp/assets.txt"
  if test -n "$SOURCE_ASSET_ID"; then
    grep -Fx "$SOURCE_ASSET_ID" "$tmp/assets.txt" >/dev/null || fail "requested source asset has no current Body result"
    printf '%s\n' "$SOURCE_ASSET_ID" > "$tmp/assets.txt"
  fi
  index=0
  failed=0
  while IFS= read -r source_id; do
    index=$((index + 1))
    pose_preparation="$tmp/pose-preparation-$index.json"
    pose_commit="$tmp/pose-commit-$index.json"
    pose_receipt="$tmp/pose-receipt-$index.json"
    if ! node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({action:"posePrepare",sourceAssetId:process.argv[1],detectorManifest:JSON.parse(fs.readFileSync(process.argv[2],"utf8")),poseManifest:JSON.parse(fs.readFileSync(process.argv[3],"utf8"))}))' "$source_id" "$manifest" "$pose_manifest" |
        compose exec -T cimmich-api node bin/body-detection-operator.mjs > "$pose_preparation"; then
      failed=$((failed + 1))
      break
    fi
    mime_type=$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).mimeType)' "$pose_preparation")
    case "$mime_type" in
      image/jpeg) extension=jpg ;;
      image/png) extension=png ;;
      image/webp) extension=webp ;;
      *) failed=$((failed + 1)); break ;;
    esac
    image="$tmp/pose-image-$index.$extension"
    if node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify({action:"read",sourceAssetId:p.sourceAssetId,inputRevision:p.inputRevision,sourceContentDigest:p.sourceContentDigest}))' "$pose_preparation" |
        compose exec -T cimmich-api node bin/body-detection-operator.mjs > "$image" &&
      node "$ROOT/service/bin/run-yolo-pose-provider.mjs" \
        --preparation "$pose_preparation" --detector-manifest "$manifest" \
        --manifest "$pose_manifest" --image "$image" --model "$POSE_MODEL_PATH" \
        --provider "$ROOT/providers/ultralytics-yolo-pose/provider.py" \
        --python "$PYTHON_PATH" > "$pose_commit" &&
      compose exec -T cimmich-api node bin/body-detection-operator.mjs < "$pose_commit" > "$pose_receipt"; then
      :
    else
      failed=$((failed + 1))
      break
    fi
    rm -f "$image"
  done < "$tmp/assets.txt"
  status_json=$(status)
  node -e 'const value=JSON.parse(process.argv[1]);value.failed=Number(process.argv[2]);value.poseAttempted=Number(process.argv[3]);value.state=value.failed===0?"complete":"incomplete";process.stdout.write(JSON.stringify(value)+"\n")' "$status_json" "$failed" "$index"
  exit 0
fi

node -e 'process.stdout.write(JSON.stringify({action:"list"}))' |
  compose exec -T cimmich-api node bin/body-detection-operator.mjs > "$tmp/list.json"
node -e 'const fs=require("fs");for(const id of JSON.parse(fs.readFileSync(process.argv[1],"utf8")).items)console.log(id)' "$tmp/list.json" > "$tmp/assets.txt"
if test -n "$SOURCE_ASSET_ID"; then
  grep -Fx "$SOURCE_ASSET_ID" "$tmp/assets.txt" >/dev/null || fail "requested source asset is not in the current demo library"
  printf '%s\n' "$SOURCE_ASSET_ID" > "$tmp/assets.txt"
fi

index=0
failed=0
while IFS= read -r source_id; do
  index=$((index + 1))
  preparation="$tmp/preparation-$index.json"
  commit="$tmp/commit-$index.json"
  receipt="$tmp/receipt-$index.json"
  if node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({action:"prepare",sourceAssetId:process.argv[1],manifest:JSON.parse(fs.readFileSync(process.argv[2],"utf8"))}))' "$source_id" "$manifest" |
      compose exec -T cimmich-api node bin/body-detection-operator.mjs > "$preparation"; then
    mime_type=$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).mimeType)' "$preparation")
    case "$mime_type" in
      image/jpeg) extension=jpg ;;
      image/png) extension=png ;;
      image/webp) extension=webp ;;
      *) failed=$((failed + 1)); break ;;
    esac
    image="$tmp/image-$index.$extension"
  else
    failed=$((failed + 1))
    break
  fi
  if
    node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify({action:"read",sourceAssetId:p.sourceAssetId,inputRevision:p.inputRevision,sourceContentDigest:p.sourceContentDigest}))' "$preparation" |
      compose exec -T cimmich-api node bin/body-detection-operator.mjs > "$image" &&
    test "$(sha256sum "$image" | awk '{print $1}')" = "$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).sourceContentDigest)' "$preparation")" &&
    node "$ROOT/service/bin/run-yolo-body-provider.mjs" \
      --preparation "$preparation" --manifest "$manifest" --image "$image" \
      --model "$MODEL_PATH" --provider "$ROOT/providers/ultralytics-yolo-body/provider.py" \
      --python "$PYTHON_PATH" > "$commit" &&
    compose exec -T cimmich-api node bin/body-detection-operator.mjs < "$commit" > "$receipt"; then
    :
  else
    failed=$((failed + 1))
    break
  fi
  if test "$(node -e 'const fs=require("fs");process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).bodyCount))' "$receipt")" -gt 0; then
    pose_preparation="$tmp/pose-preparation-$index.json"
    pose_commit="$tmp/pose-commit-$index.json"
    pose_receipt="$tmp/pose-receipt-$index.json"
    if node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({action:"posePrepare",sourceAssetId:process.argv[1],detectorManifest:JSON.parse(fs.readFileSync(process.argv[2],"utf8")),poseManifest:JSON.parse(fs.readFileSync(process.argv[3],"utf8"))}))' "$source_id" "$manifest" "$pose_manifest" |
        compose exec -T cimmich-api node bin/body-detection-operator.mjs > "$pose_preparation" &&
      node "$ROOT/service/bin/run-yolo-pose-provider.mjs" \
        --preparation "$pose_preparation" --detector-manifest "$manifest" \
        --manifest "$pose_manifest" --image "$image" --model "$POSE_MODEL_PATH" \
        --provider "$ROOT/providers/ultralytics-yolo-pose/provider.py" \
        --python "$PYTHON_PATH" > "$pose_commit" &&
      compose exec -T cimmich-api node bin/body-detection-operator.mjs < "$pose_commit" > "$pose_receipt"; then
      :
    else
      failed=$((failed + 1))
      break
    fi
  fi
  rm -f "$image"
done < "$tmp/assets.txt"

status_json=$(status)
node -e 'const value=JSON.parse(process.argv[1]);value.failed=Number(process.argv[2]);value.state=value.failed===0&&value.completed===value.assets?"complete":"incomplete";process.stdout.write(JSON.stringify(value)+"\n")' "$status_json" "$failed"
