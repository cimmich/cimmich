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

Standard describes the photograph in natural language. Review workload such as
unresolved Face or Body counts belongs in People and QC controls, never in the
photo summary.

## Smart

Smart is the fast, always-batched local visual pass. It consumes imports,
explicit selections or voluntary catch-up work in batches; it is not the
one-photo interactive action. It is intended for high-throughput archive work
where useful scene, activity, object, visible-text and basic QC evidence is more
valuable than an expensive near-perfect caption. A Smart run stores validated
structured facts and exact source/model/configuration lineage.

Facts-first providers such as Apple Vision are composed at read time rather
than preserving their inventory-style sentence. Current People, Context, place
and date are woven into one conservative description; scene, atmosphere,
activity and object facts keep distinct grammatical roles; owner Context
supersedes duplicate visual labels; low-value classifier taxonomy is omitted.
A richer custom Smart provider keeps its relational prose instead. This changes
no pixels and requires no model rerun.

Its Face and Body counts are **review leads only**. They can point out that a
photo may be missing a saved Face or Body, but cannot create observations,
identify anyone or alter People automatically. Zero-result QC is hidden. A
current stored result remains readable even when its producing provider is not
available on the viewing host; provider availability matters only when a run
or refresh is needed.

## Enhanced

Enhanced is the deliberate one-photo or selected-photo visual pass for material
an owner specifically cares about. It uses the same durable fact contract but
is expected to be configured with a stronger model profile. Once current,
ordinary changes such as renaming a Person, naming a boat or attaching a Place
are merged into the displayed result without rerunning the heavy model. The
model's useful relational prose is preserved: current Person tokens and
owner-recorded object names are resolved inside it, while Place, Event and date
are woven into its first sentence. Only owner facts that the prose genuinely
did not mention become a short natural follow-up; labelled database-field
sentences are not appended.

Enhanced should run again only when the source pixels changed, its model/profile
changed, or the owner explicitly requests a fresh visual interpretation.

## Custom

**Custom** is the editable fourth option in the Summary bar. It remains separate
from all three generated levels, is revisioned and is never overwritten by a
model. The owner can start with Standard, Smart or Enhanced, edit the imported
text and save only when ready.

## OCR evidence

The Summary panel shows Immich's stored OCR in a separate compact section under
every summary level. Readings follow image order and suppress repeated fragments
and punctuation noise. This is inspection of existing OCR evidence, not another
OCR run; a clear empty state appears when Immich detected no text.

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

A provider result file is not a generated summary by itself. Preserved Apple
Vision batch proposals can enter the durable summary projection only through
`service/bin/import-apple-smart-proposals.mjs`. The importer is dry-run by
default and admits a proposal only when its manifest mapping and source-content
digest still match the current active Asset revision. It preserves a different
current Smart result, is resumable and idempotent, and requires the dry-run's
two artifact digests and eligible count again before `--execute`. This prevents
an old evaluation artifact from silently becoming current after pixels,
projection identity or a reviewed Smart result changed.

Enhanced requests include owner-confirmed Face and linked-Body geometry as
stable aliases, never display names. Provider output stores
`{{person:person_id}}` tokens; the UI resolves those tokens against the current
Person name. This lets a heavy model describe who is doing what without freezing
a mutable name into model evidence or requiring a rerun after an ordinary rename.
If the model left an unnamed subject as an anonymous phrase, the renderer fills
that phrase only when the current accepted-Person count exactly matches the
model's people estimate; otherwise it appends the still-unmentioned accepted
names without guessing who occupied which position.
Fast Smart output remains identity-neutral, and its conservative people count is
woven together with current accepted names only while rendering.

The current implementation is photo-scoped. Group/event/archive roll-ups should
aggregate current photo facts hierarchically; they should not repeatedly send
all original photos through a large model.

Model selection and archive-speed claims are governed by the
[Smart summary model evaluation](SMART_SUMMARY_MODEL_EVALUATION.md). No model is
a Smart default until it passes that Cimmich-specific truth, throughput and
operational bar on both the accelerated and portable profiles it claims.
