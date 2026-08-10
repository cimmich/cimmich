# Cimmich Local AI integration contract

This contract defines the later adapter. This branch intentionally contains no
Cimmich API, queue, database, viewer, or X1 integration.

## Operator surface

The photo viewer and multi-select toolbar may expose one **Local AI** action.
It opens a scoped panel with independently selectable operations:

- Find faces
- Find bodies
- Add scene and visible-text context
- Check sequence context
- Create x2 enhanced preview

The panel must show the exact scope (`1 photo` or `N selected photos`), model
availability, expected derived-output behavior, and a cancellable progress
state. “Check sequence context” is available only for an explicitly ordered
set. Enhancement is labelled **preview**, never **replace original**.

## Request adapter

The future adapter builds `cimmich.local-ai-photo-set.v1` from an explicit
selection. Each asset receives a stable asset ID, a local read-only source
path, accepted subject labels already known to Cimmich, optional explicit body
assignments, and optional current face/body boxes as `baselineObservations`.

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

Accepted identity flows into the lab as an anchor; it never flows out of the
lab automatically. Context may say “candidate for Person A” only when the
ordered evidence and configured margin support it. A human acceptance action
is the sole authority that may change identity state in Cimmich.

## Concurrency and lifecycle

One scoped request runs serially. The future queue may serialize enhancement
and local VLM work globally and may reuse a resident body process, but it must
retain per-request cancellation, timeouts, output bounds, append-only revision
receipts, and exact model/config digests. UI retries create a new revision; they
do not mutate an interrupted one.

## Integration acceptance

Integration is acceptable only when end-to-end tests prove:

1. one-photo and explicit multi-photo scope;
2. individual model reruns without unrelated lanes;
3. no original mutation and no automatic identity acceptance;
4. candidate review and explicit acceptance/rejection;
5. cancellation with no orphan provider;
6. stale-source rejection before persistence;
7. derived-preview cache invalidation on source/model/config change; and
8. no regression in the standalone doctor and all golden benchmarks.
