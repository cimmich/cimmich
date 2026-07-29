# X1 Local Face Provider Pilot — 2026-07-26

## Decision

Do not run the current OpenCV YuNet/SFace configuration over the full archive,
and do not enable recognition yet.

The local provider is operational and inexpensive enough to run, but the
fixed 320-pixel YuNet detector configuration has inadequate recall for this
archive. The next gate is a higher-resolution or multi-scale detector
configuration with a minimum recognition-input quality rule, followed by a
larger stratified detection-only pilot.

## Authority boundary

- Original media remained read-only.
- Inference was local CPU-only with network and external upload forbidden.
- Immich face recognition, OCR, semantic search and transcoding remained
  disabled.
- Cimmich automatic identity authority remained `none`.
- Recognition budget was exactly zero.
- The media operator was explicitly paused after each live proof.

## Pilot envelope and result

- Provider: `opencv-yunet-sface-cpu`
- Detector: YuNet, fixed 320-pixel input, confidence threshold `0.8`
- Initial cohort: 25 deterministic active archive images with no inherited
  Face observation or current detector work
- Capture-year spread: seven years between 2011 and 2025
- Runtime: 34.30 seconds wall clock
- Per-image detector job: 0.613 seconds minimum, 1.356 seconds average,
  1.679 seconds maximum
- Outcomes: one image with one detected Face; 24 `no_face`
- Failures: zero
- Recognition jobs processed: zero
- Embeddings before/after: 56,027 / 56,027
- Face observations before/after the initial pilot: 37,762 / 37,763

A subsequent one-image live contract proof confirmed that a zero-recognition
envelope no longer creates downstream recognition queue work. Final detector
receipt totals are 26 completed jobs: one `faces_detected`, 25 `no_face`.

## Quality review

The sole detected Face was a true positive in a wide action photograph, but
its box was only about 22 × 27 source pixels and several other distant people
in the same frame were missed. It is not suitable recognition input.

A deterministic visual review of five `no_face` results found:

- three genuine no-face images;
- one heavily blurred person whose Face was missed; and
- one multi-person scene whose visible Faces were missed.

This tiny review is not a calibrated benchmark, but two false-negative images
out of five reviewed `no_face` results—and multiple misses in the positive
frame—are sufficient to reject a full-library rollout at the current detector
settings.

## Resource and storage observations

- Cimmich API peak observed during inference: 976.9 MiB and 141.86% CPU
- Cimmich API idle after restart: 62.2 MiB
- Provider volume: 38,933,038 bytes
- Cimmich database growth across install/pilot receipts: 245,760 bytes
- Archive filesystem free space remained 818,050,125,824 bytes

One recognition job created by the pre-fix pilot remains intentionally paused
as an auditable withheld candidate. No model consumed it.

## Corrections landed

1. Bounded detection scheduling now advances past inherited Face evidence,
   current detector results and already-enqueued current jobs instead of
   repeatedly selecting the same lowest hash-linked asset IDs.
2. A media-operator envelope with `maxRecognitionJobs: 0` no longer creates
   downstream recognition jobs.

Both corrections have regression tests, passed the full service suite
(678 passed, one intentional skip), were deployed to X1, and were proved
against the live queue.

## Next gate

Before any archive-wide processing:

1. add a higher-resolution or multi-scale detector configuration;
2. reject recognition input below an explicit pixel/quality threshold;
3. run a stratified detection-only cohort across portraits, groups, action,
   low light, blur, scans and no-face controls;
4. measure reviewed recall and precision separately; and
5. consider recognition only after detection quality passes.

