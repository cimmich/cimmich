# Ultralytics YOLO Body Provider

This optional local pack turns one operator-supplied Ultralytics person-detection checkpoint into `cimmich.body-detection-result.v1`. It reads one configured local image and returns normalized anonymous Body boxes only. It does not assign identity, emit embeddings, write media, contact a network service, or activate itself.

The model checkpoint is not bundled. Build a manifest from the exact local artifact, declared resource profile and calibrated threshold, then invoke `provider.py` through a Cimmich local-media worker. Model and training-data rights remain `unknown` unless the operator has separately established them.

See `THIRD_PARTY.md` before installing the optional runtime or distributing a
checkpoint. The Cedar House validation artifact remains local-only because its
download/provenance record is incomplete even though its filename matches an
Ultralytics model.

The first measured profiles are intentionally separate: a high-compute 1024px detector for best human-count agreement and a 640px profile for lower latency. Pose/keypoint enrichment is a distinct replaceable stage; this detector does not pretend a detection-only checkpoint produced pose evidence.

Provider V2 reproduces the calibrated threshold law: inference retains person
candidates from the fixed 0.05 raw-confidence floor with a maximum of 100 raw
detections, then applies the manifest's accepted score threshold after NMS.
Passing the accepted threshold into inference changes NMS behavior on crowded
images and is forbidden by the provider tests. The manifest provider version
binds this execution semantic; every threshold still requires its own config
digest and evaluation.
