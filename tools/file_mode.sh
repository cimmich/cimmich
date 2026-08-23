#!/usr/bin/env sh
set -eu

test "$#" -eq 1 || {
  printf 'usage: tools/file_mode.sh PATH\n' >&2
  exit 2
}

# GNU stat and BSD stat use different format flags. Capture each probe
# separately so output produced by a failed implementation cannot contaminate
# the successful fallback.
if mode=$(stat -c '%a' "$1" 2>/dev/null); then
  :
elif mode=$(stat -f '%Lp' "$1" 2>/dev/null); then
  :
else
  printf 'unable to read file mode: %s\n' "$1" >&2
  exit 1
fi

case "$mode" in
  ''|*[!0-7]*)
    printf 'invalid file mode returned for: %s\n' "$1" >&2
    exit 1
    ;;
esac

printf '%s\n' "$mode"
