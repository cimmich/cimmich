# Photo summaries

Cimmich offers three summary levels from the **Summary** icon in the photo
viewer. They share one display surface but have deliberately different cost and
authority.

> [!NOTE]
> Apple Vision as the automatic native-macOS Smart provider is **Source
> current** and newer than Community Preview 9.

## Standard

Standard is immediate and uses no generative model. It rebuilds whenever the
photo is opened from currently available facts such as:

- accepted People, Bodies and Presence;
- Place, Event and Thing Context;
- capture date and location; and
- Immich OCR text.

Because Standard is compiled rather than stored as prose, correcting a name or
adding Context changes the next read immediately.

## Smart

Smart is the fast, always-batched local visual pass. It consumes imports,
explicit selections or voluntary catch-up work in batches; it is not the
one-photo interactive action. It is intended for high-throughput archive work
where useful scene, activity, object, visible-text and basic QC evidence is more
valuable than an expensive near-perfect caption. A Smart run stores validated
structured facts and exact source/model/configuration lineage.

Its Face and Body counts are **review leads only**. They can point out that a
photo may be missing a saved Face or Body, but cannot create observations,
identify anyone or alter People automatically.

## Enhanced

Enhanced is the deliberate one-photo or selected-photo visual pass for material
an owner specifically cares about. It uses the same durable fact contract but
is expected to be configured with a stronger model profile. Once current,
ordinary changes such as renaming a Person, naming a boat or attaching a Place
are merged into the displayed result without rerunning the heavy model.

Enhanced should run again only when the source pixels changed, its model/profile
changed, or the owner explicitly requests a fresh visual interpretation.

## Owner note

The editable manual field is called **Owner note**. It remains separate from all
three generated levels, is revisioned, supports Undo and is never overwritten by
a model.

## Availability and privacy

Standard is always available on a presentable Cimmich photo. Smart and Enhanced
require Local AI. Public builds keep Local AI opt-in. On a native macOS worker,
Smart automatically uses the bundled Apple Vision adapter; an owner can instead
name any compatible local Ollama vision model. Enhanced remains an independent
owner-selected model profile. The UI reports the actual provider rather than
assuming a particular machine or model.

Source media is read-only. Local working copies are removed after each job. The
stored analysis is private and source-revision-bound. A result from an older
source revision is marked **Needs refresh** rather than presented as current.

## Engineering contract

Migration `0140_generated_asset_summary_v1.sql` owns the durable record:

- `generated_asset_summary_analysis` stores one current row per Asset and tier;
- `visual_facts` retains scene, summary, activities, objects, visible text,
  quality flags and people-count estimate;
- source content, projection revision, provider, model, configuration and
  proposal digests bind provenance; and
- final display prose is intentionally absent.

`service/src/generated-asset-summary.mjs` validates and commits provider output.
`service/src/local-ai-service.mjs` exposes `summary-smart` and
`summary-enhanced`, selects the configured profile and commits successful local
scene proposals. `providers/apple-vision-summary` owns the no-download macOS
adapter; the Local AI runner invokes the whole set once and deterministically
collapses Apple taxonomy parents before storage. `CimmichSummaryAction.svelte`
compiles the photo-facing result with current evidence.

The current implementation is photo-scoped. Group/event/archive roll-ups should
aggregate current photo facts hierarchically; they should not repeatedly send
all original photos through a large model.

Model selection and archive-speed claims are governed by the
[Smart summary model evaluation](SMART_SUMMARY_MODEL_EVALUATION.md). No model is
a Smart default until it passes that Cimmich-specific truth, throughput and
operational bar on both the accelerated and portable profiles it claims.
