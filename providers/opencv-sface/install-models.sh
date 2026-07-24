#!/bin/sh
set -eu

destination="${1:-./models}"
mkdir -p "$destination"

download_verified() {
  name="$1"
  url="$2"
  expected="$3"
  target="$destination/$name"
  temporary="$target.part"
  if [ -f "$target" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      actual="$(sha256sum "$target" | awk '{print $1}')"
    else
      actual="$(shasum -a 256 "$target" | awk '{print $1}')"
    fi
    if [ "$actual" = "$expected" ]; then
      echo "$actual  $target"
      return
    fi
  fi
  curl -fL --retry 3 -o "$temporary" "$url"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$temporary" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$temporary" | awk '{print $1}')"
  fi
  if [ "$actual" != "$expected" ]; then
    rm -f "$temporary"
    echo "SHA-256 mismatch for $name" >&2
    exit 1
  fi
  mv "$temporary" "$target"
  echo "$actual  $target"
}

download_verified \
  face_detection_yunet_2023mar.onnx \
  https://github.com/opencv/opencv_zoo/raw/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
  8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4

download_verified \
  face_recognition_sface_2021dec.onnx \
  https://github.com/opencv/opencv_zoo/raw/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface/face_recognition_sface_2021dec.onnx \
  0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79
