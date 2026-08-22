# Ultralytics YOLO Body Provider

This optional local pack turns one operator-supplied Ultralytics person-detection checkpoint into `cimmich.body-detection-result.v1`. It reads one configured local image and returns normalized anonymous Body boxes only. It does not assign identity, emit embeddings, write media, contact a network service, or activate itself.

The model checkpoint is not bundled. Build a manifest from the exact local artifact, declared resource profile and calibrated threshold, then invoke `provider.py` through a Cimmich local-media worker. Model and training-data rights remain `unknown` unless the operator has separately established them.

See `THIRD_PARTY.md` before installing the optional runtime or distributing a
checkpoint. The Cedar House validation artifact remains local-only because its
download/provenance record is incomplete even though its filename matches an
Ultralytics model.

The accepted reference-host profile is the 1024px detector for small and
crowded people. On the representative private slice it completed 11 photos in about 0.61 seconds
after warm-up at four CPU threads, retained more true people than 640px, and
kept the empty landscape negative empty. Pose/keypoint enrichment is a distinct
replaceable stage; this detector does not pretend a detection-only checkpoint
produced pose evidence.

When Cimmich has a saved quarter-turn correction, inference uses that corrected
presentation while returned boxes remain in immutable source coordinates. The
review overlay then applies the same presentation turn. This preserves exact
comparison with saved Face/Body geometry without asking the detector to reason
over a sideways photo.

Provider V3 retains V2's calibrated threshold law: inference keeps person
candidates from the fixed 0.05 raw-confidence floor with a maximum of 100 raw
detections, then applies the manifest's accepted score threshold after NMS.
Passing the accepted threshold into inference changes NMS behavior on crowded
images and is forbidden by the provider tests. The manifest provider version
binds this execution semantic plus correction-aware presentation; every
threshold still requires its own config digest and evaluation.

The Linux/amd64 private deployment may build the optional CPU runtime through
`compose.local-ai-body.yaml`. This adds pinned Ultralytics, Torch and
Torchvision packages to that API image only; it still adds no model weight.
The provider applies the manifest's `execution.threads` value to PyTorch's
intra-op pool and caps the inter-op pool at four. A deployment should benchmark
the available thread counts while preserving headroom for the interactive
photo service.
