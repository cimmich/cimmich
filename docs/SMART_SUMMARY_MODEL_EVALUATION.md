# Smart summary model evaluation

Research current as of 16 August 2026. This document defines the candidate
models and acceptance bar for Cimmich **Smart** photo understanding. It does not
approve a model, download weights or start an archive job.

## The actual deployment envelope

The private reference machines expose two very different useful profiles:

| Profile        | Hardware                                                           | Guaranteed acceleration                                                                                             | Smart implication                                                                                    |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Portable Linux | 8-core / 16-thread AMD Ryzen 7 255, Radeon 780M, 28 GiB usable RAM | CPU only. The 780M is not in Ollama's supported Linux ROCm list; Vulkan remains optional proof, never the baseline. | A default must be small, quantized and useful without a discrete GPU.                                |
| Apple Silicon  | M5 Pro, 64 GiB unified memory, 20-core GPU                         | Metal through MLX, Core ML or Ollama                                                                                | This is the preferred private bulk worker and may use an independently selected accelerated profile. |

Phone-scale models are useful evidence that this capability is computationally
modest on current computers; phones are not a Cimmich deployment target. A
100,000-photo/three-hour run is a useful stress calculation, not a product goal.
Smart is a marginal-value convenience feature: it fails the product test if an
owner normally has to leave a computer running for hours or days to benefit.

## Candidate shortlist

### First benchmark set

1. **Apple Vision plus deterministic composition** is the provisional Mac
   champion. Its built-in classifier, accurate OCR, Face, Human and Animal
   requests already clear the archive-speed class on the M5 Pro. It does not
   solve the portable Linux profile and still needs the labelled truth screen.
2. **SmolVLM-500M-Instruct** is the leading selective generative challenger,
   not an every-photo default. Hugging Face provides Transformers, MLX, ONNX
   and WebGPU routes. A persistent 4-bit MLX screen reached 3.05 photos/s on the
   M5 Pro: much closer than Qwen, but below the 4.29/s hard gate and with one
   invented-text failure in six examples. It may still add value on a bounded
   minority of photos selected by the fast specialist pass.
3. **Florence-2-base-ft and Florence-2-large-ft** are the specialist/hybrid
   candidates. Microsoft's 0.23B and 0.77B MIT-licensed models expose caption,
   dense caption, object detection and OCR tasks. The 164 MB 4-bit base build
   could not be benchmarked in the current Mac MLX environment: its processor
   needs a Transformers combination that the current `mlx-vlm` runtime does
   not support cleanly. Resolve that in an isolated runtime before judging its
   speed; do not install a large compatibility stack into a shared environment.
4. **Qwen3-VL-2B-Instruct** is rejected as an every-photo Smart candidate. It
   is Apache-2.0 and produced useful compact facts, but the Mac screen reached
   only 0.84 photos/s sequentially and 1.61 photos/s with four concurrent
   requests. Its full contract also invented visible text. It remains an
   Enhanced or tightly routed comparison model.

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
- **Apple Vision** provides the default Smart specialist backend on native
  macOS workers. It remains platform-specific rather than a cross-platform
  summary model, and custom model profiles remain supported.
- **MobileCLIP2** is useful evidence that classification/retrieval can be very
  fast on phones, but Apple's released weights are also research-only. It is a
  design reference, not a product dependency.

## Recommended Smart architecture

Smart should be an always-batched pipeline, not a smaller imitation of
Enhanced:

1. Decode and normalize each image once.
2. Reuse existing Immich/Cimmich people, OCR, date, location, quality and
   duplicate evidence.
3. Run a fast specialist pass over every eligible photo for grounded caption,
   objects and visual quality leads.
4. Batch compact-VLM work only for photos where the specialist result is
   incomplete, contradictory or sufficiently information-rich to benefit.
5. Persist validated structured facts, never frozen final prose.
6. Build event, group and archive summaries from those photo facts. Do not send
   the original archive through another large visual pass.

Smart is never the one-photo interactive action. Standard serves the open photo
immediately; Enhanced is the explicit action when an owner cares about one
photo or a selected set. Smart consumes imports, selections or catch-up work in
batches so model load, image preprocessing and persistence are amortized.

This design makes useful results available quickly without requiring a complete
archive sweep. A VLM that generates even 40 output tokens for every photo would
need at least 370 output tokens per second to process 100,000 photos in three
hours, before any image work. That arithmetic demonstrates why routing easy,
duplicate and low-value photos around generation matters more than shaving a few
tokens from a caption; it is not a promised completion time.

## Provisional Mac screen

The first Mac screen used the six rights-cleared Space Trip demo images. It is a
pipeline-direction screen, not the 300-photo acceptance corpus. Repeated-image
runs expose warm sustained cost and can benefit from filesystem/model caches;
the first-pass figures therefore remain visible rather than being averaged
away.

| Pipeline                           | Work per photo                                                                   | Result                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Existing Apple Vision worker       | Accurate OCR, Face, Human, pose and Animal evidence, source hashing and receipts | 6 photos in 1.335 s: 4.49/s including cold start; about 10.0/s after the first photo |
| Apple Vision classification screen | Classification, accurate OCR, Face, Human and Animal evidence                    | First six in 0.636 s: 9.43/s; 120 repeated completions in 6.168 s: 19.46/s           |
| Qwen3-VL 8B full contract          | Full image-to-structured-facts generation                                        | About 0.18/s warm; useful output, decisively Enhanced-only                           |
| Qwen3-VL 2B Q4 full contract       | Full image-to-structured-facts generation                                        | About 0.29/s warm; invented visible text and repetitive objects                      |
| Qwen3-VL 2B Q4 compact facts       | No OCR output, 61 output tokens average                                          | 0.84/s sequential; 1.61/s at concurrency four                                        |
| SmolVLM 500M 4-bit MLX             | One short literal sentence, persistent loaded model                              | 18 completions in 5.899 s: 3.05/s; one invented-text failure                         |
| Florence-2 base 4-bit MLX          | Intended specialist task tokens                                                  | No score: current MLX/Transformers processor incompatibility                         |

### Real archive screen

A second bounded screen used 24 private photos with accepted owner evidence,
stratified across four time periods and small, medium and large saved Face areas.
The set included nightlife, beaches, cliffs, ATVs, a fruit market, low light,
crowds and compressed social-media images. Media stayed local and the active X1
OCR run was not changed.

| Apple path                                           | Result                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Classification + accurate OCR + Face/Human/Animal    | 24/24 valid; 9.12 photos/s warm                                        |
| Classification + Face/Human/Animal; reuse Immich OCR | 24/24 valid; 17.86 photos/s warm; 0.067 s median and 0.116 s p95/photo |

Useful high-confidence evidence included `atv`, `helmet`, `fruit`, `banana`,
`interior_shop`, `beach`, `palm_tree`, `nightclub`, `restaurant`, `mask` and
`costume`. Apple also proposed weaker `rock_climbing` labels for people standing
on cliffs, proving that activity storage needs a stricter threshold than object
storage. The shipped deterministic composer therefore admits activities only at
0.45 confidence, removes generic taxonomy parents, and keeps identity/date/place
authority in current Cimmich truth.

At the measured no-duplicate-OCR rate, the current 118,458-photo archive is
about 1 hour 51 minutes of native inference before archive I/O and persistence.
This replaces the earlier synthetic-only estimate; a full run is still not
authorized by this screen.

The Apple classifier labels were useful but deliberately generic: for example
`helmet`, `moon`, `porthole`, `backpack`, `cup`, `people` and `adult`. They are
evidence inputs, not finished summaries. Cimmich should collapse taxonomy
parents, merge them with stored OCR/People/Place/Context and compose the common
case deterministically. A compact VLM should run only when those facts are
incomplete or contradictory.

Using the conservative warm Apple worker rate of 10 photos/s and the measured
SmolVLM rate of 3.05 photos/s, routing 20% of photos through SmolVLM yields an
estimated serial pipeline rate of about 6.0 photos/s. Routing one third falls to
roughly the OCR target. This makes **routing rate** a release metric: a default
profile must not depend on generative escalation for most of the archive.

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

| Measure                                                                  | Required bar                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| Major-error-free summary                                                 | At least 95% of acceptance photos                 |
| Owner rates result useful and materially correct                         | At least 90%                                      |
| Unsupported precise identity, date or location claim                     | 0 occurrences                                     |
| Concrete object precision / recall                                       | At least 92% / 75%                                |
| Visible activity precision                                               | At least 90%                                      |
| People count, 0–5 visible people                                         | Exact at least 90%; within one at least 98%       |
| Dense-scene people bucket: 0, 1, 2, 3–5, 6+                              | At least 90%                                      |
| Quality-flag precision / recall                                          | At least 90% / 80%                                |
| Missing Face/Body review-lead precision / recall                         | At least 80% / 85%                                |
| Invented visible text                                                    | No more than 1% of photos containing a text claim |
| Acceptance photos receiving a stored Smart result                        | At least 70%                                      |
| Stored Smart results containing at least one useful fact beyond Standard | At least 90%                                      |
| Smart results the owner would choose to run again                        | At least 85%                                      |

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

### Performance

Measure time to a useful committed result and complete-asset throughput, not
tokens per second or time-to-first-token. Speed and value are independent hard
gates: quality cannot excuse a slow Smart pipeline, and speed cannot excuse
low-value output.

Smart is benchmarked against the Immich work owners already choose to run on
the same machine. Before testing a candidate, run Immich OCR and Smart Search
over the same corpus and record their complete queue throughput. These are the
native reference lanes:

- **OCR** is the minimum acceptable Smart-summary speed. It already performs
  per-photo visual inference and persistence at a cost Immich treats as normal
  archive processing.
- **Smart Search** is the stretch target. It measures how quickly the installed
  Immich visual encoder can turn an image into useful stored evidence.

On the private X1 archive, a live Immich v3.1.0 CPU run on 16 August 2026
retained enough queue history for an end-to-end measurement:

| Native X1 lane | Installed model | Completed sample          | Sustained rate |
| -------------- | --------------- | ------------------------- | -------------- |
| OCR            | PP-OCRv5_mobile | 5,000 photos in 1,048.7 s | 4.77 photos/s  |
| Smart Search   | ViT-B/32 OpenAI | 5,000 photos in 254.8 s   | 19.62 photos/s |

Those numbers are a provisional UX anchor, not a portable model claim. The
current OCR run has one active queue job and was observed using roughly two CPU
cores; Smart Search used a different concurrency pattern. Clean qualification
therefore repeats all three lanes with the same corpus, worker limits and
machine state, and records core-seconds per committed photo as well as wall
throughput.

| Qualification                    | Hard gate                                                 | Target                                                                |
| -------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Same-host throughput             | At least 90% of that host's Immich OCR rate               | At least the OCR rate; approach Smart Search where truth still passes |
| Same-host compute                | No more than 110% of OCR core-seconds per committed photo | At or below OCR core-seconds per photo                                |
| Private X1 provisional wall-rate | At least 4.29 complete photos/s                           | At least 4.77 complete photos/s                                       |

The 10% qualification tolerance absorbs normal queue and storage variance; it
does not redefine a substantially slower model as fast. A Mac profile is judged
against Immich OCR and Smart Search measured on that Mac, not against an
invented accelerated-machine number or an X1 result scaled by core count.

The sustained rate includes image decode, model work, schema validation and
committing the result. It is measured over both the labelled 1,000-photo corpus
and the 10,000-photo soak, including batch initialization and final flush. The
default Smart model package should be at most 2 GB; a larger model needs a
separately chosen Enhanced or accelerated-only profile.

The worker prioritizes explicit batches, new imports and voluntary catch-up,
but scheduling is not a substitute for performance. Chunking and resume protect
interrupted work; they do not make a slow model acceptable. Smart reuses stored
OCR, People, Context and other metadata rather than calculating them again. If
no candidate clears both the Immich-relative throughput gate and the usefulness
bar, Cimmich does not ship it as Smart.

The Mac Smart worker should stay below 16 GiB additional memory. X1 should stay
below 8 GiB additional memory, use adaptive multi-core concurrency, and
automatically reduce or pause when API/database latency, memory pressure or
Immich jobs cross their guardrails. A faster model that makes ordinary Cimmich
slow does not pass. Neither does a model whose small improvement over Standard
requires long unattended compute.

### Operational bar

- 10,000-photo soak with no memory growth, orphaned temporary media or queue
  loss; this is engineering proof, not the expected owner workflow;
- bounded retry, lease expiry, cancellation, checkpoint and resume proof;
- no duplicate model copies per release and less than 4 KiB stored facts per
  photo on average;
- source media remains read-only and working copies are deleted after use; and
- group/archive roll-up reads stored facts and does not rerun photo inference.

## Evaluation order

1. Run native Immich OCR and Smart Search over the exact benchmark corpus on
   each claimed host profile with fixed worker/resource limits. Record
   end-to-end throughput, core-seconds per committed photo, peak memory and
   foreground API latency.
2. Run the 300-photo Mac screen on Apple Vision composition, then Apple Vision
   with SmolVLM escalation capped at 10%, 20% and 30%. Measure both useful
   coverage and total routed throughput.
3. Resolve Florence in a disposable compatible runtime and compare it as the
   portable specialist. Add Moondream only if Florence and SmolVLM leave an
   unfilled speed/quality quadrant. Do not retest Qwen as an every-photo lane.
4. Qualify the best two on 1,000 photos on both the Mac and X1 CPU baseline.
   Reject any profile below either its hard throughput gate or the independent
   usefulness bar; do not average the two into one forgiving score.
5. Use the already available larger local VLM only as a diagnostic comparison;
   human labels remain authority.
6. Run the 10,000-photo engineering soak before selecting a private default. No
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
