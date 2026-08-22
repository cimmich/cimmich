# Cimmich Local AI integration contract

This contract defines the later adapter. This branch intentionally contains no
Cimmich API, queue, database, viewer, or live-deployment integration.

## Operator surface

The photo viewer and multi-select toolbar may expose one **Local AI** action.
Its primary surface is:

- **Upscale — Quick**: deterministic full-source x2 resize and conservative
  sharpening for the current photo.
- **Upscale — Best**: learned full-source x2 cached derivation with structured
  tile progress. A deployment may select CPU/CoreML ONNX or guarded Linux
  Vulkan execution, but the receipt must expose the actual provider and bind
  the runtime/model/config digests.
- **Context**: explain and propose continuity across the selected ordered set.

An **Advanced rerun** section contains Find faces, Find bodies, and Add scene /
visible-text context. These are valuable scoped diagnostics, not the product
hierarchy.

The panel must show the exact scope (`1 photo` or `N selected photos`), model
availability, expected derived-output behavior, and a cancellable progress
state. Context is available only for an explicitly ordered set. Both
enhancement modes are labelled **derived**, never **replace original**.

## Request adapter

The future adapter builds `cimmich.local-ai-photo-set.v1` from an explicit
selection. Each asset receives a stable asset ID, a local read-only source
path, accepted subject labels already known to Cimmich, optional explicit body
assignments, capture time, and current champion face/body boxes as
`baselineObservations`. Accepted champion faces carry their existing opaque
subject ID so Context can associate a body anchor geometrically without
rerunning or altering champion identity machinery.

The adapter invokes only requested operations. `context` may add `bodies` as a
declared dependency. No operation implies an archive-wide scan. Archive jobs
remain a separate, later orchestration surface.

## Result adapter

The adapter consumes only a completed `cimmich.local-ai-photo-lab-run.v1`
receipt whose source digest still matches the asset revision.

- Face/body additions become review candidates, not silent accepted rows.
- Baseline matches are shown as unchanged; non-redetections are shown as review
  information, not deletions.
- Scene/Text remains a proposal until accepted.
- `supported` and `possible` Context rows remain candidates. `abstained` rows
  are retained as evidence but are not presented as matches.
- Enhanced artifacts are cached derivatives bound to source/model/config
  digests and can be discarded without data loss.
- `partial`, `failed`, or `cancelled` runs never auto-apply results.

The lab receipt contains no raw appearance vector or absolute source path.
Future persistence must preserve that boundary.

## Identity rule

Accepted identity flows into the lab as a read-only champion anchor; it never
flows out automatically. Challenger face detections cannot create Context
identity anchors. Context may say “candidate for Person A” only when the
ordered evidence and configured margins support it. A human acceptance action
is the sole authority that may change identity state in Cimmich. Any future
champion improvement must use a separate reviewed champion/challenger promotion
process, not this request path.

## Concurrency and lifecycle

One scoped request runs serially. The future queue may serialize enhancement
and local VLM work globally and should preserve the one-load resident face/body
set paths, but it must retain per-request cancellation, timeouts, output bounds,
append-only revision receipts, and exact model/config digests. UI retries create
a new revision; they do not mutate an interrupted one.

## Integration acceptance

Integration is acceptable only when end-to-end tests prove:

1. one-photo and explicit multi-photo scope;
2. individual model reruns without unrelated lanes;
3. no original mutation and no automatic identity acceptance;
4. candidate review and explicit acceptance/rejection;
5. cancellation with no orphan provider;
6. stale-source rejection before persistence;
7. derived-preview cache invalidation on source/model/config change;
8. no regression in the standalone doctor and all golden benchmarks;
9. no writes to, deletion from, or replacement of champion face/identity rows;
10. at most one supported body per subject per photo; and
11. Quick and Best cache keys remain distinct.

An accelerated Best path must additionally prove that the selected device is
actually reachable, reject missing or mismatched runtime/model artifacts, run
the x4 model at native scale before producing x2, preserve the accepted
fidelity/seam envelope, and terminate its accelerator child on cancellation.
