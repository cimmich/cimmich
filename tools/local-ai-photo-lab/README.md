# Cimmich Local AI Photo Lab

Standalone, local-only experimentation for one photo or an explicit photo set.
This lab does not connect to Cimmich's API, database, viewer, queues, or X1
runtime.

The two primary product lanes are progressive local upscaling and cross-photo
Context. Face, body, and Scene/Text reruns are supporting diagnostic tools. The
existing Cimmich face/identity machinery is a protected champion: this lab may
read its accepted observations as anchors, but cannot replace, retrain, delete,
or write back to it.

## Operations

- `enhance-preview` — create a fast native-x4 progressive Real-ESRGAN result
  from a bounded one-tile working image.
- `enhance` — create the slower full-source x2 Best derivation.
- `context` — evaluate ordered cross-photo body and Presence continuity from
  explicit accepted-subject anchors.
- `faces` — rerun local face detection as review evidence.
- `bodies` — rerun local person/body detection as review evidence and a Context
  dependency.
- `scene-text` — ask a loopback-only local vision model for visible scene,
  activity, object, text, people-count, and quality proposals.
- `full` — run faces, bodies, Context, Scene/Text, and Best enhancement. Quick
  enhancement remains an explicit interactive operation rather than duplicating
  Best work in a batch.

Every run binds the exact source digest, provider/model/config digests, ordered
set, operation list, and limits. Reruns append a new receipt and diff against the
previous compatible run. Existing observations are never overwritten.

## Input set

```json
{
  "schemaVersion": "cimmich.local-ai-photo-set.v1",
  "setId": "birthday-sequence",
  "contextKind": "sequence",
  "assets": [
    {
      "assetId": "frame-001",
      "path": "/absolute/local/path/frame-001.jpg",
      "captureTime": "2026-08-11T10:00:00Z",
      "acceptedSubjects": ["Person A"],
      "baselineObservations": {
        "bodies": [],
        "faces": [
          {
            "observationId": "accepted-face-1",
            "subject": "Person A",
            "box": { "x": 0.3, "y": 0.1, "w": 0.1, "h": 0.15 }
          }
        ]
      }
    },
    {
      "assetId": "frame-002",
      "path": "/absolute/local/path/frame-002.jpg",
      "captureTime": "2026-08-11T10:00:05Z",
      "acceptedSubjects": [],
      "baselineObservations": {
        "faces": [],
        "bodies": [
          {
            "observationId": "existing-body-1",
            "box": { "x": 0.2, "y": 0.1, "w": 0.5, "h": 0.8 }
          }
        ]
      }
    },
    {
      "assetId": "frame-003",
      "path": "/absolute/local/path/frame-003.jpg",
      "captureTime": "2026-08-11T10:00:10Z",
      "acceptedSubjects": ["Person A"]
    }
  ]
}
```

`acceptedSubjects` and subject-labelled baseline faces are existing
human/imported champion truth for the exact test set, not challenger model
output. A champion face box can associate its accepted subject with a detected
body by geometry, including in multi-person anchors. Explicit `bodyAssignments`
remain available when the source already has a trusted mapping. With exactly
one accepted subject and one detected body, the unambiguous pair may also act
as an anchor.

`baselineObservations` is optional. It represents the face/body boxes currently
known for that exact source revision. When supplied, the report separates new
model candidates, geometry matches, and baseline observations not redetected.
This is the standalone testing seam for “find missed faces/bodies” before any
Cimmich persistence adapter exists.

The current Context lane combines protected champion anchors, source
independence, bidirectional order, capture-time gaps, body geometry, and a
deliberately modest local colour/spatial appearance descriptor. Appearance
support must beat both competing subjects and competing bodies. Close-time
evidence can produce only `possible`, and only when one subject and one
unassigned target body make the scope unambiguous. It is not a production
body-ReID model and never promotes a subject assignment automatically.

## Runtime configuration

Runtime paths remain outside Git. Create a local JSON file using
`config.example.json` as the shape, then supply it with `--config`.

The example face threshold is `0.45`. Across the labelled public calibration
and holdout sets it removed back-of-head/silhouette proposals while retaining
the genuine rainy partial face at `0.463` and all six crowded-case faces; the
weakest crowded genuine proposal scored `0.492`. Proposals below `0.6` remain
explicit review candidates, which also contains the measured animal-face false
positive at `0.515`.
Thresholds remain part of the bound runtime config, so future model changes
must rerun the benchmark instead of inheriting this value blindly.

The Scene/Text endpoint must be loopback (`127.0.0.1`, `::1`, or `localhost`).
No provider may upload source media. Provider failures are represented as typed
unavailable/failed operation results so other requested lanes can still finish.

For multi-photo sets, both face and body detectors load their model once and
process each bounded source through that resident set runtime. Receipts
distinguish `resident-set` from `one-shot` execution and retain per-photo
timings. Face receipts also record the actual ONNX execution providers plus
shared initialization, provider, and process durations so the faster path does
not hide model-startup cost.

If the source body manifest requests an accelerator that `doctor` cannot
confirm, derive a non-overwriting local execution profile and point the local
config at it:

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs body-profile \
  --source-manifest /absolute/local/body-manifest.json \
  --device cpu \
  --output /absolute/local/body-cpu-manifest.json
```

This changes only the execution device and recomputes the manifest digest. It
does not alter the source manifest or model artifact. The output path must not
already exist.

## Run

Verify all configured runtimes, model artifacts, the body manifest/privacy
boundary, accelerator providers, and loopback vision model before using media:

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs doctor \
  --config /absolute/local/config.json
```

The doctor receipt contains runtime versions and artifact digests without local
filesystem paths.

Run the labelled public benchmark against an explicit fixture root:

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs benchmark \
  --config /absolute/local/config.json \
  --manifest tools/local-ai-photo-lab/benchmark/public-diverse-v1.json \
  --fixture-root /absolute/path/to/cedar-house-v1/media \
  --output /absolute/local/benchmark-output
```

The benchmark emits a machine-readable receipt and Markdown scorecard. Fixture
paths are constrained beneath `--fixture-root`; scorecards retain only relative
result paths.

Run the broader face/body holdout, including profiles, motion, pets, backs,
partial faces, groups, and additional negative controls:

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs benchmark \
  --config /absolute/local/config.json \
  --manifest tools/local-ai-photo-lab/benchmark/public-holdout-v2.json \
  --fixture-root /absolute/path/to/cedar-house-v1/media \
  --output /absolute/local/benchmark-output
```

Run the derived-preview enhancement gate against the same public fixture root:

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs benchmark \
  --config /absolute/local/config.json \
  --manifest tools/local-ai-photo-lab/benchmark/enhancement-preview-v1.json \
  --fixture-root /absolute/path/to/cedar-house-v1/media \
  --output /absolute/local/benchmark-output
```

It checks output dimensions and digest binding plus downsample fidelity,
structural similarity, edge-energy retention, and tile-seam risk. These are
regression gates, not a claim that generated detail is historically true or
identity preserving.

Run the separate one-tile Quick gate with
`benchmark/enhancement-quick-v1.json`. It proves the native-x4 progressive
artifact, bounded 256-pixel working dimension, source immutability, and the
same fidelity metrics without invoking Best.

Create and benchmark the deterministic head-occlusion Context fixture:

```sh
tools/local-ai-photo-lab/python/make_head_occlusion_fixture.py \
  --source /absolute/path/to/CHA-001-maya-kitchen.png \
  --output /absolute/local/context-fixture

node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs benchmark \
  --config /absolute/local/config.json \
  --manifest tools/local-ai-photo-lab/benchmark/context-head-occlusion-v1.json \
  --fixture-root /absolute/local/context-fixture \
  --output /absolute/local/benchmark-output
```

The fixture receipt binds the public source, transform configuration, and all
three derived image digests without persisting the source path.

Build a read-only pilot from an existing private Cimmich projection and its
local previews:

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs archive-pilot \
  --imports-root /absolute/private/import/current \
  --thumb-root /absolute/private/thumb/root \
  --output /absolute/private/new-pilot-directory \
  --limit 12 \
  --maximum-gap-seconds 600
```

The command never copies media or writes to the projection. It derives strict
three-photo candidates where the middle has one champion body and no accepted
identity while the adjacent photos share exactly one accepted subject. The
path-free index binds source projection digests; private set files reference
the read-only previews and must stay outside Git.

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs run \
  --config /absolute/local/config.json \
  --set /absolute/local/photo-set.json \
  --operations context \
  --output /absolute/local/output
```

For one photo:

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs run \
  --config /absolute/local/config.json \
  --photo /absolute/local/photo.jpg \
  --operations enhance-preview \
  --output /absolute/local/output
```

Use `--operations enhance` for the separate full-source Best derivation, or
select any supporting rerun lane explicitly.

Outputs contain JSON receipts, a human-readable Markdown report, optional
review overlays, and optional enhanced images. Reports identify inputs by asset
ID, basename, and digest; absolute source paths and raw biometric vectors are
not persisted. A set-summary proposal combines literal Scene/Text evidence and
cross-photo Context candidates while preserving candidate language.

Each reserved revision also has `run-state.json`. A normal run transitions
from `running` to `complete`; provider exceptions record `failed`; SIGINT or
SIGTERM records `cancelled` after terminating tracked local providers. A rerun
never overwrites the interrupted revision and advances to the next number.

Execution is intentionally bounded and serial: one resident face process and
one resident body process per set, one VLM/enhancement operation at a time,
bounded provider output, a configured input byte/pixel cap, and a configured
timeout. This favors stable local memory use over archive-scale throughput.

## Safety and limits

- Results and Context assignments are proposals. Only a person can accept an
  identity; no candidate writes back to Cimmich in this branch.
- Quick and Best enhancements are disposable derived images. The source stays
  read-only and neither derivative may replace it.
- The current Context appearance descriptor is a proving baseline, not body
  identity. Clothing changes, uniforms, low light, and multiple similar people
  require abstention or review.
- Model files are not bundled. Their code, model, and training-data licences
  must be resolved by the deployment owner before distribution.
- On the measured local CoreML runtime, Quick produced a 752×1024 real-archive
  result in 2.9 seconds from a 528×720 preview; Best produced 1056×1440 in 26.9
  seconds. A larger 1024×1536 source still took roughly two minutes for Best.
  The viewer should show Quick progressively and cache Best rather than block
  zoom on full-source work.

See `INTEGRATION_CONTRACT.md` for the later Cimmich seam and
`MERGE_READINESS.md` for the standalone branch gates.
