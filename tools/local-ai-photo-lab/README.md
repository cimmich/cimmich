# Cimmich Local AI Photo Lab

Standalone, local-only experimentation for one photo or an explicit photo set.
This lab does not connect to Cimmich's API, database, viewer, queues, or X1
runtime.

## Operations

- `faces` — rerun local face detection.
- `bodies` — rerun local person/body detection.
- `context` — evaluate ordered cross-photo body and Presence continuity from
  explicit accepted-subject anchors.
- `scene-text` — ask a loopback-only local vision model for visible scene,
  activity, object, text, people-count, and quality proposals.
- `enhance` — create a non-destructive Real-ESRGAN derived image.
- `full` — run every configured operation.

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
      "acceptedSubjects": ["Person A"]
    },
    {
      "assetId": "frame-002",
      "path": "/absolute/local/path/frame-002.jpg",
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
      "acceptedSubjects": ["Person A"]
    }
  ]
}
```

`acceptedSubjects` is existing human/imported truth for the test set, not model
output. With exactly one accepted subject and one detected body, that body may
act as an identity anchor. Multi-person anchors require an explicit
`bodyAssignments` object mapping a subject label to a detected body index.

`baselineObservations` is optional. It represents the face/body boxes currently
known for that exact source revision. When supplied, the report separates new
model candidates, geometry matches, and baseline observations not redetected.
This is the standalone testing seam for “find missed faces/bodies” before any
Cimmich persistence adapter exists.

The current Context lane uses a deliberately modest local colour/spatial
appearance descriptor as a test baseline, not a production body-ReID model.
It requires independent source digests and accepted anchors on both sides by
default, ranks competitors, and abstains below the configured similarity or
margin. It never promotes a subject assignment automatically.

## Runtime configuration

Runtime paths remain outside Git. Create a local JSON file using
`config.example.json` as the shape, then supply it with `--config`.

The Scene/Text endpoint must be loopback (`127.0.0.1`, `::1`, or `localhost`).
No provider may upload source media. Provider failures are represented as typed
unavailable/failed operation results so other requested lanes can still finish.

For multi-photo sets, the body detector uses its resident local protocol: the
model loads once, then each bounded source is framed through the same process.
Receipts distinguish `resident-set` from `one-shot` execution and retain
per-photo timings.

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

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs run \
  --config /absolute/local/config.json \
  --set /absolute/local/photo-set.json \
  --operations faces,bodies,context,scene-text,enhance \
  --output /absolute/local/output
```

For one photo:

```sh
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs run \
  --config /absolute/local/config.json \
  --photo /absolute/local/photo.jpg \
  --operations faces,bodies,scene-text,enhance \
  --output /absolute/local/output
```

Outputs contain JSON receipts, a human-readable Markdown report, optional
review overlays, and optional enhanced images. Reports identify inputs by asset
ID, basename, and digest; absolute source paths and raw biometric vectors are
not persisted. A set-summary proposal combines literal Scene/Text evidence and
cross-photo Context candidates while preserving candidate language.
