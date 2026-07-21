# Ultralytics YOLO Body-object conflict adapter

Optional local adapter for producing bounded cat/dog boxes used only to detect
conflicts with an existing anonymous Body observation. It is not a Body
detector, identity provider, Pet recognizer, downloader or model installer.

The adapter accepts one length-prefixed JSON header followed by encoded image
bytes on stdin. It validates the source digest, offline manifest and
operator-supplied checkpoint digest before invoking YOLO. Output contains only
normalized `cat|dog` boxes and confidences. Network and external upload are
forbidden; media is never written.

Model and training-data rights remain operator declarations. This directory
ships no checkpoint and infers no right to download, redistribute or use one.
