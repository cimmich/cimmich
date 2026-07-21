# User-supplied InsightFace ONNX provider

This weight-free adapter lets an operator connect compatible SCRFD detection
and 512-dimensional ArcFace recognition ONNX files to Cimmich's frozen local
provider contract. Cimmich does not bundle, download or redistribute model
weights through this provider.

The adapter code contains no networking calls: it accepts explicit model files,
reads source media only beneath `--media-root`, emits no source paths and writes
only the requested packet output. The subprocess boundary is not an
operating-system network or filesystem sandbox. Operators must trust the
provider code or run it inside their own network-disabled, read-only container.
The materialized
manifest binds both artifact hashes, a fixed 640×640 detector input, detector
threshold, one-thread sequential ONNX Runtime execution, five-point alignment,
the 512-dimensional vector space and operator-declared licence/training truth.

## Licence boundary

InsightFace's Python code is MIT. Its upstream pretrained model packs, including
`buffalo_l`, are restricted to non-commercial research unless the operator has
separate permission. Supporting user-supplied files is not permission to use or
redistribute them. The operator is responsible for supplying accurate model and
training-data rights in the manifest.

There is deliberately no model installer or automatic download command here.

## Materialize a private manifest

```sh
python build-manifest.py \
  --detector-model /private/models/detector.onnx \
  --recognizer-model /private/models/recognizer.onnx \
  --detector-name SCRFD --recognizer-name ArcFace \
  --model-version operator-model-v1 \
  --model-licence 'operator-owned or separately licensed; redistribution prohibited' \
  --training-data 'operator-declared provenance' \
  --output /private/runtime/provider-manifest.json --execute
```

## Run

```sh
python provider.py \
  --manifest /private/runtime/provider-manifest.json \
  --requests requests.ndjson --packets packets.ndjson \
  --media-root /photos \
  --detector-model /private/models/detector.onnx \
  --recognizer-model /private/models/recognizer.onnx --execute
```

The independent Node checkpoint validator remains mandatory after inference.
Every exact model/configuration compiles and calibrates its own SourcePack.
