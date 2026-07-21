# Ultralytics YOLO Body Provider — third-party record

Recorded 2026-07-20 for the optional, unbundled local Body provider.

## Ultralytics

- Project: Ultralytics YOLO
- Upstream: <https://github.com/ultralytics/ultralytics>
- Licensing guidance: <https://www.ultralytics.com/license>
- Default licence stated by upstream for its code and trained models:
  AGPL-3.0. Upstream offers separate Enterprise terms for uses that do not meet
  its AGPL requirements.
- Cimmich integration: optional local Python runtime imported by `provider.py`.
  It is not installed by the Cimmich service package and is not required when
  Body providers are disabled.

The Cedar House validation used a local file named `yolo11n.pt`, SHA-256
`0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1`.
Its original download receipt and redistribution provenance were not available
at review time. Cimmich therefore records model and training-data rights as
`unknown`, does not copy the file into the repository or demo bundle, and makes
no claim that the local file may be redistributed. A future bundle must bind an
authoritative source receipt, the exact applicable licence text and required
notices before including any model artifact.

This record describes upstream's published terms and Cimmich's distribution
decision; it is not legal advice or an additional grant of rights.
