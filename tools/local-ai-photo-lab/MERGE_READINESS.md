# Standalone Local AI lab merge readiness

## Merge boundary

The branch is mergeable as a standalone tool under
`tools/local-ai-photo-lab/`. It does not authorize or implement the later
Cimmich product integration. Runtime config, source media, model checkpoints,
generated previews, and benchmark receipts remain outside Git.

## Required gates

Run from the repository root:

```sh
node --test tools/local-ai-photo-lab/test/*.test.mjs
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs doctor --config /absolute/local/config.json
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs benchmark --config /absolute/local/config.json --manifest tools/local-ai-photo-lab/benchmark/public-diverse-v1.json --fixture-root /absolute/public/media --output /absolute/local/benchmark-output
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs benchmark --config /absolute/local/config.json --manifest tools/local-ai-photo-lab/benchmark/context-head-occlusion-v1.json --fixture-root /absolute/local/context-fixture --output /absolute/local/benchmark-output
node tools/local-ai-photo-lab/bin/local-ai-photo-lab.mjs benchmark --config /absolute/local/config.json --manifest tools/local-ai-photo-lab/benchmark/enhancement-preview-v1.json --fixture-root /absolute/public/media --output /absolute/local/benchmark-output
```

All commands must exit zero. Doctor must report `ready`, every benchmark must
report `passed`, formatting must be clean, Python must parse, `git diff
--check` must be clean, and the branch diff must remain confined to this tool.

## Quality gates represented

- clear portrait, crowded group, no-person negative control, silhouettes,
  backs turned, and an OCR-heavy document;
- exact input dimensions, operation states, face/body/people ranges,
  cross-model review codes, and expected visible text;
- head-occluded middle-frame Context from two accepted independent anchors;
- competitor-margin, Presence fallback, duplicate-source, and abstention unit
  cases;
- x2 derived-preview dimensions, artifact digest, original immutability,
  downsample fidelity, structural similarity, edge energy, and seam risk;
- corrupt/oversized input rejection, loopback-only VLM, output-flood rejection,
  provider timeout/cancellation plumbing, append-only revisions, and path/vector
  sanitization.

## Known non-blocking limits

- The Context appearance feature is deliberately not production body-ReID.
- Generated enhancement detail is not certified as historical or identity
  truth and is preview-only.
- Model/licensing readiness is deployment-owned because weights are external.
- Performance is suitable for scoped photo/set testing, not yet archive-wide
  orchestration. The measured full-resolution enhancement path needs a loading
  UI and caching.

These limits are explicit product constraints, not hidden fallbacks. Changing
any of them requires a new benchmark wave and integration review.

## Latest measured certification

Measured locally on 2026-08-11 against the exact hardened implementation:

| Gate                        |                                           Result |
| --------------------------- | -----------------------------------------------: |
| Deterministic Node suite    |                                     15/15 passed |
| Runtime doctor              |                    ready, 8/8 passed, 0 warnings |
| Public diverse model matrix |                        104/104 assertions passed |
| Head-occlusion Context      |                          37/37 assertions passed |
| Enhancement preview         |                          23/23 assertions passed |
| Receipt privacy scan        | no absolute source path or raw appearance vector |

The body lane used an explicit CPU profile with detector config digest
`8329d123f471011c6f52b55f975fa6015e024d99de54e0f6d6ab650818ae1d8c`;
the source GPU manifest was not mutated. The final enhancement completed in
99.9 seconds with MAE `0.013992`, SSIM `0.996017`, edge-energy ratio `0.98133`,
maximum seam ratio `1.194699`, and an unchanged original. A real SIGINT test
recorded the active run as cancelled, terminated its provider, left no orphan,
and completed the retry at the next immutable revision.
