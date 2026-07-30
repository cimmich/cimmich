#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

rg --files "$repo_root/service" -g '*.mjs' |
  while IFS= read -r source_file; do
    node --check "$source_file"
  done
