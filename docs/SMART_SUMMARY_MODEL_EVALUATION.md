# Smart summary model evaluation

Research current as of 16 August 2026. This document defines the candidate
models and acceptance bar for Cimmich **Smart** photo understanding. It does not
approve a model, download weights or start an archive job.

## The actual deployment envelope

The private reference machines expose two very different useful profiles:

| Profile | Hardware | Guaranteed acceleration | Smart implication |
| --- | --- | --- | --- |
| Portable Linux | 8-core / 16-thread AMD Ryzen 7 255, Radeon 780M, 28 GiB usable RAM | CPU only. The 780M is not in Ollama's supported Linux ROCm list; Vulkan remains optional proof, never the baseline. | A default must be small, quantized and useful without a discrete GPU. |
| Apple Silicon | M5 Pro, 64 GiB unified memory, 20-core GPU | Metal through MLX, Core ML or Ollama | This is the preferred private bulk worker and may use an independently selected accelerated profile. |

Phone-scale models are useful evidence that this capability is computationally
modest on current computers; phones are not a Cimmich deployment target. A
100,000-photo/three-hour run is a useful stress calculation, not a product goal.
Smart is a marginal-value convenience feature: it fails the product test if an
owner normally has to leave a computer running for hours or days to benefit.

## Candidate shortlist

### First benchmark set

1. **Qwen3-VL-2B-Instruct** is the leading general Smart candidate. It is
   Apache-2.0, current, explicitly spans edge deployments, has strong OCR and
   spatial understanding, and is available as a 1.9 GB Q4 Ollama model for
   Linux and macOS. It should be tested with thinking disabled, bounded image
   resolution and a short schema-constrained response.
2. **SmolVLM-500M-Instruct** is the portability and speed floor. Hugging Face
   provides Transformers, MLX, ONNX and WebGPU routes and describes the 500M
   model as more robust to prompting than the 256M variant. If it meets the
   truth bar, its footprint makes it particularly attractive for CPU, browser
   and future phone use.
3. **Florence-2-base-ft and Florence-2-large-ft** are the specialist/hybrid
   candidates. Microsoft's 0.23B and 0.77B MIT-licensed models expose caption,
   dense caption, object detection and OCR tasks. They are not expected to be
   the final prose writer. They may be the fastest way to produce grounded
   facts over every image before a compact language pass.

### Useful challengers

- **Moondream 0.5B / 2B** is Apache-2.0 and explicitly built for edge image
  understanding and detection. The 2B Ollama route is mature; the 0.5B route
  needs separate runtime integration. It must prove structured-output and
  instruction reliability before displacing SmolVLM.
- **Gemma 3n E2B** was designed for phones, tablets and laptops and supports
  visual input. Its Ollama Q4 package is 5.6 GB and the weights use Gemma terms,
  so it is a quality challenger rather than the first portable default.
- **Qwen3-VL-4B-Instruct** is the fallback if 2B narrowly misses the quality bar.
  At 3.3 GB Q4 it may still fit both machines, but its throughput must justify
  doubling the model size.

### Research-only or platform-specific probes

- **FastVLM 0.5B / 1.5B** is the most interesting Apple-Silicon speed probe.
  Apple ships MLX/Core ML formats and an iOS demo; the 0.5B model reports much
  faster visual time-to-first-token than comparable small VLMs. The released
  weights are restricted to non-commercial research, so they cannot be the
  Community default or bundled product model.
- **Apple Vision** can provide fast on-device OCR, image classification, face,
  body, pose, saliency, quality and similarity signals. It is a strong optional
  macOS/iOS specialist backend, not a cross-platform summary model.
- **MobileCLIP2** is useful evidence that classification/retrieval can be very
  fast on phones, but Apple's released weights are also research-only. It is a
  design reference, not a product dependency.

## Recommended Smart architecture

Smart should be a pipeline, not a smaller imitation of Enhanced:

1. Decode and normalize each image once.
2. Reuse existing Immich/Cimmich people, OCR, date, location, quality and
   duplicate evidence.
3. Run a fast specialist pass over every eligible photo for grounded caption,
   objects and visual quality leads.
4. Invoke the compact VLM only when the specialist result is incomplete,
   contradictory or sufficiently information-rich to benefit.
5. Persist validated structured facts, never frozen final prose.
6. Build event, group and archive summaries from those photo facts. Do not send
   the original archive through another large visual pass.

This design makes useful results available quickly without requiring a complete
archive sweep. A VLM that generates even 40 output tokens for every photo would
need at least 370 output tokens per second to process 100,000 photos in three
hours, before any image work. That arithmetic demonstrates why routing easy,
duplicate and low-value photos around generation matters more than shaving a few
tokens from a caption; it is not a promised completion time.

## Acceptance corpus

Use private owner-labelled images; never publish them or their outputs. Start
with a 300-photo screening set, then qualify the best two pipelines on 1,000
photos, stratified across:

- ordinary daylight and indoor photos;
- low light, blur, compression, occlusion and partial crops;
- one person, small groups and dense crowds;
- head-only, body-only and missing-observation QC cases;
- pets and other animals;
- travel, landscapes, buildings, vehicles and events;
- screenshots, documents, signs and other visible text;
- old scans and damaged photos;
- exact duplicates and lower-quality variants; and
- blank, accidental or visually uninformative frames.

Keep a separate rights-cleared 100-photo regression set in the repository. The
private corpus remains outside Git and model training.

## Smart release bar

### Truth and usefulness

| Measure | Required bar |
| --- | --- |
| Major-error-free summary | At least 95% of acceptance photos |
| Owner rates result useful and materially correct | At least 90% |
| Unsupported precise identity, date or location claim | 0 occurrences |
| Concrete object precision / recall | At least 92% / 75% |
| Visible activity precision | At least 90% |
| People count, 0–5 visible people | Exact at least 90%; within one at least 98% |
| Dense-scene people bucket: 0, 1, 2, 3–5, 6+ | At least 90% |
| Quality-flag precision / recall | At least 90% / 80% |
| Missing Face/Body review-lead precision / recall | At least 80% / 85% |
| Invented visible text | No more than 1% of photos containing a text claim |
| Routed photos receiving at least one useful fact beyond Standard | At least 80% |
| Smart results the owner would choose to wait for again | At least 75% |

People and QC counts remain review leads. They must never create observations,
name a Person or alter accepted identity.

### Contract and repeatability

- at least 99.5% of responses satisfy the exact schema on the first attempt;
- 100% either validate after one bounded repair or fail closed without a stored
  proposal;
- semantically equivalent output on at least 99% of three repeated deterministic
  runs;
- source, model, quantization, prompt, configuration and proposal digests bind
  every stored result; and
- stale source/model results are visible as stale and never silently current.

### Performance and perceived cost

Measure time to a useful committed result and complete-asset throughput, not
tokens per second or time-to-first-token.

| Experience | Accelerated computer | Portable CPU baseline |
| --- | --- | --- |
| One requested photo | p95 at most 2 seconds | p95 at most 5 seconds |
| 100 selected/recent photos | at most 1 minute | at most 5 minutes |
| 1,000-photo voluntary catch-up | at most 10 minutes | at most 30 minutes |
| Ordinary background slice | useful progress inside 5 minutes | useful progress inside 10 minutes |

These are usability ceilings, not invitations to occupy the ceiling. The worker
must prioritize the open photo, explicit selections, new imports and recent
unsummarized photos. A complete historical sweep is optional, chunked and
resumable; Cimmich must never imply that the feature is incomplete until every
old photo has run.

The Mac Smart worker should stay below 16 GiB additional memory. X1 should stay
below 8 GiB additional memory, use adaptive multi-core concurrency, and
automatically reduce or pause when API/database latency, memory pressure or
Immich jobs cross their guardrails. A faster model that makes ordinary Cimmich
slow does not pass. Neither does a model whose small improvement over Standard
requires a persistent service, a large mandatory download or long unattended
compute.

### Operational bar

- 10,000-photo soak with no memory growth, orphaned temporary media or queue
  loss; this is engineering proof, not the expected owner workflow;
- bounded retry, lease expiry, cancellation, checkpoint and resume proof;
- no duplicate model copies per release and less than 4 KiB stored facts per
  photo on average;
- source media remains read-only and working copies are deleted after use; and
- group/archive roll-up reads stored facts and does not rerun photo inference.

## Evaluation order

1. Run the 300-photo screen on Qwen3-VL-2B, SmolVLM-500M and both Florence-2
   sizes with identical normalized input and output limits.
2. Compare Florence-only, Qwen-only and Florence-to-Qwen routed pipelines. Add
   Moondream only if one of the first three leaves an unfilled speed/quality
   quadrant.
3. Qualify the best two on 1,000 photos on both the Mac and X1 CPU baseline,
   including whether their incremental value justifies their elapsed time.
4. Use the already available larger local VLM only as a diagnostic comparison;
   human labels remain authority.
5. Run the 10,000-photo engineering soak before selecting a private default. No
   archive-wide run begins until the queue and pressure guards exist, and no
   complete archive sweep becomes a normal product requirement.

## Source notes

- [Qwen3-VL official repository](https://github.com/QwenLM/Qwen3-VL) and
  [2B Apache-2.0 model card](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct)
- [Qwen3-VL 2B Ollama package](https://ollama.com/library/qwen3-vl:2b-instruct)
- [SmolVLM 256M/500M release](https://huggingface.co/blog/smolervlm)
- [Florence-2 official model card](https://huggingface.co/microsoft/Florence-2-base)
- [Moondream official repository](https://github.com/m87-labs/moondream)
- [Gemma 3n official overview](https://ai.google.dev/gemma/docs/gemma-3n)
- [FastVLM official repository](https://github.com/apple/ml-fastvlm) and
  [research-only model licence](https://github.com/apple/ml-fastvlm/blob/main/LICENSE_MODEL)
- [Apple Vision framework](https://developer.apple.com/documentation/vision)
- [Ollama hardware support](https://docs.ollama.com/gpu)
