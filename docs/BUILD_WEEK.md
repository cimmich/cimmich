# Cimmich — OpenAI Build Week

For a privacy-cleared mapping from dated claims to public source, tests,
contracts and reproduction paths, see the
[Build Week evidence index](BUILD_WEEK_EVIDENCE.md).

## Ten-second promise

Teach your archive who matters—with the fewest possible decisions.

Cimmich is a local-first Memory Steward. Local computer-vision machinery finds
and compares faces; Cimmich deterministically narrows the work; an optional
user-chosen Guided client can help plan difficult review. The archive owner
remains the only identity authority.

## Current verified build

The tagged Build Week release remains preserved on schema 75. Post-submission
Public Beta development continues on schema 77 without rewriting that release.

The schema 75 source retains exact, human-review-only machine ranking while
its representative 3,985-asset cold review request falls from 4.459 seconds to
1.188–1.221 seconds; an immediate repeat is 4.4 ms. The optimization evaluates
visibility and accepted same-photo truth once per asset and reads vectors only
for the fixed 48-Face frontier. It does not change ranking, thresholds, cache
duration or automatic identity authority. Service 595/595, migration acceptance
through migration-ledger schema 75, the full disposable synthetic journey and
three independent fresh stock-Immich installation lifecycles pass. The
public-demo operator additionally passes an immutable cold run: stop, restart
and down preserve exact state; confirmation-scoped reset/destroy alone remove
it; and a checksummed schema-74 backup is preflighted and migrated forward to
75 before replacement. The preserved recording runtime has now completed that
restore-backed integration and runs schema 75/patch 1.

## Why Codex is in the Build Week story

Face models are good at producing local observations and similarity scores.
They are not entitled to decide who a person is, and a list of every uncertain
observation is not a useful product.

Codex is the first tested external recipe because it is also helping build the
product. Guided V1 remains a privacy-minimized Standard-only compatibility
surface. Through Guided V2, any compatible hosted or capable local client may:

- understand the review goal;
- inspect aggregate library state;
- inspect anonymous, machine-derived review opportunities;
- inspect anonymous Person evidence health;
- return a structured plan containing no more than three face checks;
- when explicitly granted `operate`, call the same replay-safe canonical product
  actions available to the owner within the token's visibility ceiling;
- discover and drive the owner-derived provider, recognition and first
  SourcePack setup state without source-code knowledge, while provider,
  vector-space and reviewed matcher policy remain server/gate-derived.

Guided V1 cannot return a photo, name, filename, path or biometric vector, and
it exposes no match acceptance, merge or write action. Guided V2 publishes
machine-readable schemas, typed errors, replay/conflict/Undo laws and UI
verification links for canonical operations; it is not a parallel mutation
layer. Cimmich does not call the client: the operator points chosen software at
the local endpoint.

The Build Week use is concrete on both sides of the product. Codex powered by
GPT-5.6 Sol helped Benji turn product direction, North Stars and definitions of
done into architecture, migrations, service/UI implementation, tests, audits,
operators and release documentation. It also used Guided V2 as a real client:
from machine-readable discovery alone, it added the six-photo Space Trip
extension, admitted it into Cimmich, created truthful typed evidence and
Event/Place/Thing context, set visibility, proved replay and Undo, and routed
contract defects while continuing the owner journey. GPT-5.6 is not a hidden
biometric authority and is not required to run Basic Cimmich.

## Runtime boundary

```text
Source media (read-only)
        |
        v
Local detection + corrected embeddings ----> Cimmich PostgreSQL / pgvector
                                                   |
                                                   v
                                  Deterministic local plan / canonical API
                                                   |
                            optional authenticated Guided client request
                                                   |
                       operator-owned local or hosted software may process it
                                                   |
                                                   v
                                  Human sees local photo + names
                                                   |
                                                   v
                              Append-only user identity decision
```

Cimmich holds no model-provider key and sends no biometric or model-processing
request outward. The optional, owner-invoked Photon address search is the one
disclosed network lookup made by the Cimmich service. The separate Guided token
authorizes only the local capability surface. A hosted client is not local or
private merely because Cimmich runs locally; the connected client and operator
own any disclosure.

## Three cumulative product layers

Cimmich extends a supported Immich installation and must remain useful without
an OpenAI account, API key, private operator infrastructure, hosted Cimmich service or
private fixture. The supported capability ladder is explicit:

1. **Core — useful without a model:** Cimmich manages, corrects, sorts and reviews
   the tags and model output a user already has. It does not require a detector,
   recognizer or embedding migration.
2. **Enhanced — optional local intelligence:** Cimmich adds recommended
   local detection, matching, SourcePack learning and deterministic review on
   the user's own server. It remains complete and offline-capable.
3. **Guided — opt-in agent assistance:** Cimmich's target contract exposes a model-neutral local
   endpoint and versioned instruction pack that may be run by Codex, another
   hosted agent or a capable local model. The agent orchestrates local work,
   advanced QC, difficult-match diagnosis and customization; it is not a cloud
   biometric processor or required API.

Codex is the first tested external Guided recipe because this product is being
built with Codex; it is not a Cimmich runtime dependency. The source contract is
provider-neutral and separately authenticated. V1 is forced Standard and
read/propose-only. V2 has an explicit `read|operate` grant and a
Standard/Personal/Private ceiling; it delegates only catalogued canonical API
actions and grants no ambient filesystem, database or provider authority.

The Cimmich server holds no OpenAI or other model-provider credential and makes
no model-provider request. Apart from the disclosed optional Photon address
search, Cimmich itself transmits nothing outward; a connected hosted client may
disclose what it retrieves, and its operator owns that decision. Media upload
remains a direct client→Immich action using a separate
user-issued Immich credential; Cimmich does not proxy those bytes or reveal the
credential.

Current source and the isolated schema-75 demo prove the endpoint/instruction
contract, token/authority/visibility enforcement and one complete external
Codex Space Trip operation journey. Broad client interoperability remains a
separate claim.

## Build Week extension boundary

Cimmich began from Rimmich, a small private Immich-derived fork/seed Benji had
explored for several months before Build Week. That work contributed the
original problem, early local/cloud-model and semantic-search experiments, and
a basic working UI shell for a roughly 600 GB, 15-year personal archive. It is
disclosed and is not claimed as new competition work.

The dated [Build Week extension ledger](BUILD_WEEK_CHANGELOG.md) distinguishes
that small inherited seed from the Cimmich service, data model, complete product
experience, operators, Guided interface, synthetic demonstration and proof
program completed during the Submission Period. It is the public equivalent
evidence for a multi-task Codex workflow; the single majority-core `/feedback`
identifier is supplied privately through Devpost.

Meaningful work built after the July 13, 2026 Build Week start includes:

- the separate local Cimmich Intelligence schema and localhost companion service;
- `cimmich.immich-companion.v1`: read-only Immich 3 compatibility/principal
  checks plus exact and explicit-visibility asset projections that exclude
  upstream paths, profiles, People, tags and EXIF payloads;
- `cimmich.immich-inventory.v1`: separate-database four-lane cursors,
  transactional page receipts, stable asset upsert, deterministic media-job
  enqueue and conservative two-complete-run missing/re-entry handling;
- `cimmich.document.v1`: model-free stable visible Immich-asset references or
  bounded atomic content-addressed local imports, explicit editions, typed
  Person/Pet/Place/Object/Event links, replay/Undo, safe integrity-checked
  content and visibility-first retrieval from Cimmich's separate data plane;
- `cimmich.face-detector.v1` and schema-33 detection persistence: bounded
  original-image reads through the supported Immich API, operation-specific
  leases, deterministic normalized FaceObservations, durable terminal
  `no_face`, transactional receipts and retry/replay with no identity authority;
- typed Person, Face, Head, Body and Presence evidence;
- dynamic Prime, Secondary and condition-routed LQ reference policy;
- correction-aware body linkage, merge/split, aliases, pets and people groups;
- machine-crop failure diagnosis and the target-centric corrected embedding lane;
- a source-faithful Standard-versus-Cimmich benchmark with identical evidence,
  capture-context isolation, identity-disjoint unknowns and same-sequence
  reference accumulation;
- a provider-neutral local recognition contract with vector-space validation,
  explicit abstention and idempotent checkpoints;
- immutable SourcePack human-review gates, activation, successor switch,
  rollback and immediate invalidation after human identity correction;
- machine-derived review with stable Person-ID acceptance and matcher-contract-scoped Unknown/restore;
- the provider-neutral Guided V1 access/instruction contract and external-client
  recipe, with the server-side provider broker retired;
- the focused Memory Steward product journey and competition packaging.

Private media, real names, embeddings, model weights, database dumps and fixture
bridges remain outside the source repository.

## Public demonstration archive

The Cedar House Archive is a wholly synthetic 51-asset product fixture generated
with Codex/OpenAI image generation. It demonstrates People, Pets, Places,
Things, Trips, Events, Activities, linked Documents, visibility and truthful
Face/Head/Body/Presence correction states without exposing a private library.

Its source-controlled bootstrap validates the complete hashes, prompts,
synthetic/visual-QA declarations and rights/attribution digest before binding
supported Immich API upload results to fresh schema-75 Cimmich state. Reset proof
destroys and recreates only disposable demo infrastructure and requires the
semantic receipt and display bridge to replay byte-for-byte.

This fixture demonstrates product behavior. It is not evidence of recognition
accuracy, demographic fairness or suitability for another user's archive. It
activates no SourcePack and grants no automatic identity authority. Dedicated
Immich upload plus signed-in browser/video acceptance remains a separate gate.

## Guided compatibility and current machine-access contract

Guided is disabled by default. When enabled, Cimmich requires a strong dedicated
capability token that is not a provider credential. The token is accepted only
in the Authorization header; query/body transport is forbidden. Guided V1 runs
on an internally forced Standard surface, so caller headers cannot inherit or
raise Personal/Private access. Guided V2 uses a separate explicit authority and
visibility ceiling described below.

Read/propose actions:

| Tool                        | Returns                                               | Explicitly withheld                      |
| :-------------------------- | :---------------------------------------------------- | :--------------------------------------- |
| `library_overview`          | aggregate counts                                      | media, names, paths                      |
| `list_review_opportunities` | anonymous face/Person IDs, scores, margins, reason    | names, images, filenames, paths, vectors |
| `inspect_person_evidence`   | anonymous evidence counts and workflow flags          | display name and media                   |
| `present_review_plan`       | up to three anonymous review targets and concise copy | all write authority                      |

Identity acceptance and Unknown remain separate HTTP user-command endpoints.
Mutation-shaped Guided actions return approval-required without repository
dispatch. Capabilities and instructions are static/versioned and contain no
library-derived state.

That is the retained V1 compatibility contract. The current product contract is
Guided V2: `GET /v1/guided/v2/bootstrap` returns a provider-neutral connection
and route catalogue for an external client. Its dedicated token has an explicit
`read|operate` authority and `Standard|Personal|Private` ceiling. V2 calls the
existing canonical APIs with `x-cimmich-surface: guided`; the server derives the
actor, applies the current principal/device/private session and refuses routes
outside the exact catalogue. Each operation publishes JSON Schemas,
replay/conflict/no-change semantics, typed error families, Undo law and a UI
verification link.

Media upload is direct client→connected Immich with a separate user-issued
Immich credential. Guided exposes the public connection and acquisition rules,
never the credential, then points the client to bounded inventory admission and
visibility-safe source-ID→Cimmich-asset readback. Cimmich does not broker a
model/provider, autoaccept identity, activate SourcePacks or train weights. A
connected client may transmit anything it retrieves; the user/operator accepts
that disclosure risk.

## Proof

- Service tests cover V1 privacy minimization/forced-Standard isolation and V2
  dedicated authentication, exact route delegation, server-derived actor,
  authority/visibility ceilings, schema-complete discovery and hidden-route
  refusal.
- The Svelte route passes framework diagnostics and TypeScript checks.
- The corrected face lane emits a private receipt with exact-pair compatibility
  and photo-disjoint identification metrics before guarded live import.
- On the deterministic strong user-supplied provider, selected Cimmich Prime
  uses 1,223 references and reaches 80.250% correct known coverage at 98.950%
  precision and 1.562% FAR versus all-trusted's 75.993%, 98.674% and equal FAR
  with 7,701 references. All-trusted still wins forced closed-set top-1 95.553%
  to 93.156%. This is an offline human-review operating-point win, not automatic
  authority or a claim that the policy currently serves the UI. These
  private-archive measurements are recorded development evidence and cannot be
  reproduced from the synthetic public demo.
- Schema 26 reduced the overlap-safe limit-24 review read to 4.31 seconds cold
  and 2 ms reused; concurrent review and Steward planning share one snapshot.
- Schema 27 and a restored disposable clone pass a 4,085-reference exact-pack
  gate, activation, user-change successor, atomic switch, rollback and
  post-activation correction retirement. Stale reactivation fails closed.
- The provider contract passed one actual 24-observation local run with 18
  embeddings, six abstentions and identical replay; mixed-space, dimension and
  conflicting-replay faults were rejected.
- The full synthetic acceptance suite remains the clean-schema privacy/release
  gate; current personal media is never a distributable fixture.
- Current migration-ledger source passes the full service suite plus migration-order/fault and
  full fresh-schema SQL/service/privacy/restart/performance acceptance. Typed
  tags, new-Person-from-Face and Detailed correction remain Cimmich-only; no
  source-media or Immich database write is used.
- Schema 62 closes the existing-Face recognition provenance boundary: the
  operator derives one current asset/source binding through Cimmich and the
  read-only companion, freezes Face geometry/origin, requires two matching
  provider runs and rechecks current observations before commit. Its public
  receipt contains no source path, vector or provider-result digest.
- The corrected condition-consensus policy is rejected: after accepted-Face
  same-asset overlap was excluded, its untouched cohort changed no winner and
  earned no rescue. Main therefore retains zero active SourcePacks. A narrower
  all-trusted hard-face shortlist is now a default-off isolated-lab review
  experiment with exact evaluation binding and bounded fan-out. Authoritative
  visual QC plus fresh replay produced zero rank-four additions at about 4.3
  seconds, so it remains held; it is not a Golden Loop or matching claim.
- Guided privacy, token transport, authority/visibility ceilings, closed route
  discovery and a non-Codex local runner are source-proven. The isolated public
  demo additionally completed the external Codex Space Trip operation journey.
  Guided remains disabled by default and broad client interoperability is not
  claimed.
- Summary and Steward now share one fixed-frontier ready-suggestion authority;
  smaller output limits are stable truncation rather than eligibility changes.

## Codex collaboration

Codex was used as the primary engineering and product-design collaborator:

- auditing the prior matching pipeline and finding a bimodal corrupted-vector lane;
- tracing the failure to target selection on tight crops;
- implementing and testing the corrected embedding builder;
- designing authority boundaries between local matching, optional Guided planning and human truth;
- building the service contracts, tests and focused Svelte review experience;
- operating Guided V2 through the complete six-photo Space Trip workflow and
  routing the contract gaps it found to the appropriate implementation task;
- maintaining project decisions, privacy boundaries and competition proof.

The submission will include the core Codex Session ID through Devpost's
`/feedback` requirement. This document describes what Codex changed; it does not
claim inherited UI work as Build Week output.
