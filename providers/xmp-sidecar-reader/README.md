# XMP sidecar reader

Read-only, path-minimizing XMP face-region scanner for Cimmich. It walks a
media root, pairs each media file with its `.xmp` sidecar, and emits bounded
JSON packets of named MWG and Microsoft Photo face regions plus byte digests.
It never emits filesystem paths, never writes media, and performs no network
access.

The reader is invoked by `service/bin/import-xmp-sidecars.mjs`, which passes
the Python interpreter via `CIMMICH_XMP_PYTHON_PATH` (default
`/usr/bin/python3`).

## XML safety

Sidecar bytes are untrusted input. When `defusedxml` (see `requirements.txt`)
is importable, all parsing goes through `defusedxml.ElementTree`, which blocks
entity-expansion attacks. Without it, the reader falls back to the standard
library parser but rejects any packet containing a `<!DOCTYPE` or `<!ENTITY`
declaration -- legitimate XMP never carries a DTD. Install `defusedxml` into
the interpreter you pass to the importer for the strongest posture:

```sh
python3 -m pip install -r requirements.txt
```

## Files

- `provider.py` -- the scanner (`--root`, `--limit-assets`), schema
  `cimmich.xmp-sidecar-reader.v3`.
- `audit.py` -- offline counts of importable sidecars under a root; reuses the
  same parser and safety guards.
