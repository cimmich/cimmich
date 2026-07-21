# OpenCV YuNet + SFace reference provider

This is Cimmich's first redistributable, CPU-first recognition provider. It is
a reference baseline, not a privileged dependency: every detector/recognizer
pair must enter through the same provider contract and earn its own calibrated
SourcePack.

The worker code has no networking calls. It reads only files beneath the
explicit `--media-root`, never writes source media and emits no path in its
packets. The subprocess boundary is not an operating-system network or
filesystem sandbox: operators must trust the provider code or run it inside
their own network-disabled, read-only container. Model acquisition is a
separate explicit operator step.
YuNet's `0.80` detector threshold is part of the provider manifest and therefore
the configuration digest; an operator cannot silently change it while claiming
the same provider configuration. The reference provider also binds single-thread
OpenCV execution and a fixed 320×320 detector input to remove route/vector drift
observed during repeated pilots.

The provider also exposes an identity-free `detect_all` primitive for Cimmich's
general detection stage. It returns normalized boxes, detector confidence and a
landmark digest only. Detection never assigns a Person; recognition, matching
and user decisions remain later, separately receipted stages.

## Reference-fixture result

The frozen configuration completed 37,761 read-only requests from the private
already-processed fixture: 27,043 embedded, 10,689 explicitly abstained and 29
RAW decode failures. Two independent 640-request pilots were packet-identical,
and the independent full checkpoint replay reused all 37,761 observations with
unchanged digests.

This proves the provider boundary and reproducibility, not an accuracy default.
Under the same leakage-safe evaluator, a calibration-selected SFace-specific
Prime gallery trailed SFace's own all-trusted baseline on untouched closed-set
top-1 (75.576% versus 85.003%) and high-precision correct-known coverage
(54.706% versus 60.647%). Cimmich therefore keeps YuNet/SFace as a replaceable
CPU reference baseline. Every provider must compile and calibrate its own Prime
gallery and SourcePack; gallery membership is not portable across vector spaces.

## Install

Use Python 3.11 or 3.12 in an isolated environment:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
./install-models.sh ./models
```

The installer downloads pinned official OpenCV artifacts and refuses a digest
mismatch. ONNX files are ignored by the repository and must not be committed.

## Service runtime

The provider is disabled unless explicitly selected. To let the Cimmich service
assemble the detector and recognizer behind `cimmich.media-operator.v1`, set:

```sh
CIMMICH_LOCAL_MEDIA_PROVIDER=opencv-yunet-sface-cpu
CIMMICH_LOCAL_PYTHON_PATH=/absolute/path/to/isolated/python
CIMMICH_OPENCV_DETECTOR_MODEL_PATH=/absolute/path/to/face_detection_yunet_2023mar.onnx
CIMMICH_OPENCV_RECOGNIZER_MODEL_PATH=/absolute/path/to/face_recognition_sface_2021dec.onnx
```

`CIMMICH_OPENCV_PROVIDER_ROOT` is optional when the source provider directory is
at its standard repository location. Startup fails closed on manifest, artifact,
OpenCV-version or script-digest drift. Operator status does not expose paths.

## Standard review setup

Provider readiness and matcher readiness are different states. After enabling
the provider, inspect `GET /v1/operator/face-matching`. It returns one exact
next action. The signed-in UI and Guided V2 both call the same canonical routes:

```text
POST /v1/operator/face-matching/recognition
POST /v1/operator/face-matching/source-packs
POST /v1/operator/face-matching/source-packs/{packId}/evaluate
POST /v1/operator/face-matching/source-packs/{packId}/review
POST /v1/operator/face-matching/source-packs/{packId}/activate
POST /v1/operator/face-matching/source-packs/{packId}/rollback
```

Recognition accepts only a replay-safe `commandId` and bounded `workLimit`.
Compilation accepts an empty object: the service derives provider, model,
configuration, vector space and temporal split from current accepted owner
evidence. Evaluation returns a minimized frozen artifact. Review consumes the
existing `cimmich.source-pack-gate-evaluation.v1` receipt, and activation binds
the reviewed evaluation head plus the expected active-pack head. Embeddings
alone never create review suggestions. Cimmich requires an exact same-space
SourcePack, leakage-safe holdout/QC, a human-reviewed gate receipt and explicit
activation.

The lower-level commands remain available for offline operators and audit:

```sh
DATABASE_URL=postgres://... node service/bin/compile-source-pack.mjs \
  --cutoff=2026-07-21T00:00:00Z \
  --model-family=SFace-MobileFaceNet --model-version=2021dec \
  --config-digest=419e7b86603bb36a2577f33e1ec7542ffd3399a9889699e9e71db23b05607f5a \
  --execute

DATABASE_URL=postgres://... node service/bin/evaluate-source-pack.mjs \
  --pack-id=sourcepack_... --calibration-end=2026-07-21T00:00:00Z --execute

DATABASE_URL=postgres://... node service/bin/source-pack-lifecycle.mjs \
  --action=record-evaluation --receipt=/safe/local/gate-receipt.json --execute

DATABASE_URL=postgres://... node service/bin/source-pack-lifecycle.mjs \
  --action=activate --pack-id=sourcepack_... --execute
```

For these lower-level commands, the dates are operator-selected frozen cohort
boundaries, not defaults. The canonical API instead derives a deterministic
three-window plan and holds when the owner's evidence cannot support it. The
gate receipt must use `cimmich.source-pack-gate-evaluation.v1`, preserve zero
query/reference overlap and verified-unknown proof, and include the reviewed
matcher policy:

```json
{
  "matcherPolicy": {
    "marginFloor": 0.08,
    "policyVersion": "cimmich-best-prime-v1",
    "scoreFloor": 0.52,
    "scorer": "best_individual_prime"
  }
}
```

Those numbers are an illustrative shape, not recommended values. Use only the
thresholds frozen before the untouched holdout and confirmed by the gate. A
passed pack without that binding remains inert. When ready, Standard users see
bounded Person candidates in the normal Review surface; an explicit user action
is still required to accept identity. Disabling the provider removes machine
review availability without deleting accepted Faces, manual tags, People or
other Basic truth.

## Request format

Input is NDJSON. Each request contains an opaque asset token, a stable
observation ID, a path beneath the configured media root, and the existing
normalized face box:

```json
{
  "schemaVersion": "cimmich.recognition-request.v1",
  "observationId": "observation_example",
  "assetToken": "asset_example",
  "sourcePath": "relative/photo.jpg",
  "targetBox": {
    "coordinateSpace": "normalized",
    "x": 0.2,
    "y": 0.1,
    "w": 0.3,
    "h": 0.4
  }
}
```

Run the provider, then pass its packet file through Cimmich's independent Node
validator/checkpoint writer:

```sh
python provider.py --manifest provider-manifest.json --requests requests.ndjson \
  --packets packets.ndjson --media-root /photos \
  --detector-model models/face_detection_yunet_2023mar.onnx \
  --recognizer-model models/face_recognition_sface_2021dec.onnx --execute

npm --prefix ../../service run validate-recognition-provider -- \
  --manifest provider-manifest.json --packets packets.ndjson \
  --checkpoint checkpoint.json --receipt receipt.json --execute
```

## Licence and provenance boundary

- YuNet files in OpenCV Zoo declare MIT.
- SFace files declare Apache-2.0.
- OpenCV's SFace model card does not identify which exact training corpus
  produced the published weight. The upstream paper evaluates models trained
  on CASIA-WebFace, VGGFace2 and MS1MV2; Cimmich records that gap instead of
  presenting model-file licensing as complete training-data provenance.

See `THIRD_PARTY.md` for source links. Users can replace this provider without
changing Cimmich identity, review or SourcePack semantics.
