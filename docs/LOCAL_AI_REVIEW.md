# Local AI review

Cimmich can run a deliberately small local photo lab from the photo viewer or
from a selected set of at most 12 photos. The feature is optional, disabled by
default, and remains useful only when the operator supplies compatible local
model files.

## Product contract

The owner can request:

- **Upscale · Quick** — a fast x4 derived review preview;
- **Upscale · Best** — a slower 2x derived review render;
- **Look for missed Faces** — a fresh detector pass compared with Cimmich's
  saved Face boxes;
- **Look for missed Bodies** — available only with a separately configured
  Body provider;
- **Add Context** — available only for a small multi-photo set with that Body
  provider; and
- **Read Scene & Text** — available only with a separately configured
  loopback-only vision model.

Unavailable operations remain visible and explain the missing capability. A
configured model never changes accepted identity or Context data by itself.
Results are review candidates, not decisions.

## Media and authority boundary

For each requested photo, the owner API first verifies that its Immich asset ID
is presentable in the current viewing mode. It then reads the original through
the existing bounded, read-only Immich adapter into a mode-restricted work
directory. The work copy is deleted after the run. The original is hashed
before and after processing, is never edited, and is not stored in the result.

Enhanced images and detection overlays are Cimmich-owned derived artifacts.
They never replace the Immich original. Before serving an artifact, Cimmich
re-reads the current source fingerprint and refuses a stale result if the photo
changed. Artifact requests use the current Cimmich viewing session rather than
a public media URL.

No Local AI result can automatically:

- create or accept a Person identity;
- attach Context, Presence, a Place, Event or Thing;
- write to the Immich database or source-media tree; or
- become matching/training evidence merely because a model produced it.

## Runtime limits and cleanup

The API runs one Local AI child process at a time and accepts at most four
active/queued jobs. A job contains 1–12 still images, uses the existing 128 MiB
per-image source-read ceiling, and has bounded provider and process output.
Cancellation sends `SIGTERM` and escalates to `SIGKILL` after two seconds if a
provider does not stop. Shutdown cancels unfinished work.

The child receives an allowlisted environment containing only locale, `PATH`
and `PYTHONNOUSERSITE`; API keys, database credentials and the parent process
environment are not forwarded. Provider failures returned to the browser are
redacted.

Temporary input/configuration files are removed after every run and abandoned
work directories are removed on service start. The derived store retains at
most 12 recent runs and at most 4 GiB, pruning the oldest first. Removing that
store loses previews only; it does not remove originals or accepted Cimmich
truth.

## Configuration

The default Compose deployment mounts:

- `cimmich-local-ai` at `/local-ai` for bounded derived work; and
- `cimmich-local-ai-models` read-only at `/local-ai-models` in the API.

Set `CIMMICH_LOCAL_AI_ENABLED=true` only after privately installing compatible
models. Face and enhancement default to
`/local-ai-models/face-detector.onnx` and
`/local-ai-models/enhance-x4.onnx`. Model weights are not bundled, fetched or
redistributed by Cimmich. The operator is responsible for source, licence,
integrity and suitability.

Body/Context stays unavailable unless both
`CIMMICH_LOCAL_AI_BODY_MODEL_PATH` and
`CIMMICH_LOCAL_AI_BODY_MANIFEST_PATH` resolve to local files and the separately
supplied provider runtime is compatible, and
`CIMMICH_LOCAL_AI_BODY_ENABLED=true` is deliberately set. Scene/Text stays
unavailable unless explicitly enabled against a loopback endpoint. This
document does not certify those optional models, biometric accuracy,
demographic fairness or archive-wide performance.

## API surface

The canonical owner API provides:

- `GET /v1/local-ai` — capabilities and limits;
- `POST /v1/local-ai/jobs` — start one bounded review run;
- `GET /v1/local-ai/jobs/:jobId` — poll progress/result;
- `DELETE /v1/local-ai/jobs/:jobId` — cancel; and
- `GET /v1/local-ai/jobs/:jobId/artifacts/:token` — verified derived image.

These routes are absent from the Guided listener. The same-origin gateway and
durably bound Immich owner session remain the authentication perimeter.
