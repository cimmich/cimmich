# Ultralytics YOLO pose provider

This weight-free local provider emits normalized COCO17 pose evidence for a
separately validated Cimmich Body detector result. The operator supplies the
checkpoint and declares its model/training-data rights; Cimmich does not infer
those rights, download a model, contact a network service or upload media.

Pose is optional enrichment. It never creates a Person, assigns identity,
overrides the dedicated Body detector, activates a SourcePack or trains a
model. A Cimmich worker must bind the exact asset revision/source digest, run
the provider twice and uniquely associate pose boxes to validated Body boxes
before any evidence is usable.

Build a manifest with `build_manifest.py`. The process adapter passes the
manifest/checkpoint as operator-private command arguments and transfers one
bounded encoded image in memory behind a four-byte-length JSON binding header.
No media or path enters the result or minimized Cimmich receipt.
