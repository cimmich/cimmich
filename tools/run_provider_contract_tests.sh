#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
python_bin=${PYTHON_BIN:-python3}

for test_file in "$repo_root"/providers/*/test_*.py; do
  test_dir=$(dirname "$test_file")
  test_name=$(basename "$test_file")
  PYTHONDONTWRITEBYTECODE=1 "$python_bin" -m unittest discover \
    -s "$test_dir" \
    -p "$test_name"
done
