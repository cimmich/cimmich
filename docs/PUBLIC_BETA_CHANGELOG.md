# Cimmich Public Beta changelog

This changelog records maintained-product work after the immutable
`v1.0.0-build-week` submission. It does not revise or expand what was submitted
for OpenAI Build Week.

## v1.1.0-community-preview.7 — Faster review and archive organisation

- People and Person share URL-backed filters for exact privacy, Cimmich-owned
  tags and labels, Places, Events and Things. Protected results remain behind
  the existing viewing-mode boundary and are discoverable from Standard
  without exposing their contents.
- Bulk Organise can apply first-class Cimmich labels without writing source
  sidecars, and can turn media-bearing folders into a reviewed album manifest
  with editable names, collision blocking, idempotent batching and exact Undo.
- Person review retains known waiting counts across navigation, loads expensive
  Identity work only when needed and keeps filter changes scoped to facets and
  assets rather than rebuilding the complete workspace.
- Face review keeps legitimate repeated appearances in collages, compares each
  physical region with ranked known People, supports inline manual correction
  and offers a large pannable context preview without mounting the full photo
  viewer.
- Read paths use bounded projections, short rebuildable caches, request
  coalescing and operation-specific diagnostics. Review writes remain ordered,
  owner-controlled and separately auditable.
- Schema 128/patch 1, exact Immich 3.1.0, the source-readonly boundary and the
  immutable Build Week release remain explicit.

## v1.1.0-community-preview.6 — Self-contained public installation

- The ordinary Compose and guarded-installer paths now build the API and UI
  from the exact checked-in Dockerfiles. A newcomer no longer depends on
  separate GHCR package visibility to install the public release.
- Root Compose defaults use local versioned image names and contain no Cimmich
  registry reference. Optional image overrides remain available for advanced
  operators who deliberately provide an accessible trusted registry.
- README, `.env.example`, `INSTALL.md` and installer progress copy all describe
  the same build-first route. Contract tests reject a return to inaccessible
  default package references.
- Product behavior, database schema, exact Immich 3.1.0 compatibility and the
  immutable Build Week evidence remain unchanged.

## v1.1.0-community-preview.5 — Unpublished operability candidate

- Five real-browser journeys cover fictional-demo start, photo navigation,
  pointer use of the Viewing mode menu, all four Organise modes and true
  two-tag intersection against the isolated Cedar House product.
- A freshly generated fictional demo now completes Immich's own admin and user
  onboarding flags, so the first browser login lands in the populated product
  instead of an unrelated setup wizard.
- GitHub Actions built versioned amd64/arm64 API and UI images with an SBOM,
  BuildKit provenance and GitHub build-provenance attestation from immutable
  action revisions. GHCR kept the organization packages private, so this
  candidate was not released and is superseded by Preview 6's self-contained
  source-build path.
- `./tools/companion.sh doctor` emits a redacted configuration, container,
  schema, compatibility and disk report without credentials, origins, paths,
  filenames, media or private identity data.
- Tag-intersection storage/query logic moved from `repository.mjs` into a
  dedicated 253-line domain module; its focused tests remain green and the
  grandfathered repository ceiling is 242 lines lower.
- README and install entry points now lead with product truth, a concise
  five-minute Compose route, privacy, limitations and deeper references.
- Identity language now states explicitly that native Immich manual face
  assignments do not train or damage Immich's recognition model. Cimmich's
  separate evidence types govern Cimmich behavior rather than correcting a
  claimed Immich model defect.
- Database schema and exact Immich compatibility remain unchanged.

## v1.1.0-community-preview.4 — Repository trust and conventional installation

- The production Docker Compose definition now lives at root `compose.yaml`;
  experienced operators can inspect, render and start it without running a
  project shell script.
- Root `.env.example` documents only the required database password and
  credential-free Immich URLs. Compose performs the exact-Immich-3.1.0
  preflight before the Cimmich API starts.
- Installation documentation presents manual Docker Compose first, the guarded
  lifecycle installer second and local AI assistance only as an optional route.
- `DEVELOPMENT.md` explains why the independent service uses npm while the
  Immich-derived UI retains pnpm, and distinguishes the checked-in seven-file
  `@immich/sdk` source workspace from ignored dependency output.
- CI records the existing oversized production files as explicit debt, blocks
  them from growing and rejects new production source files over 1,000 lines.
  No claim is made that the accumulated source concentration is already fixed.
- Database schema, stored data, source-media boundaries and exact Immich
  compatibility are unchanged.

## v1.1.0-community-preview.3 — Projected-photo viewer repair

This hotfix prevents the photo viewer from entering a Svelte reactive loop
when it opens a photo from a Cimmich Person, Pet or other projected collection.
The Info panel still closes when navigation changes the viewed photo, but its
lifecycle check now uses a deliberately non-reactive asset identifier instead
of subscribing the route loader to the state it writes. Preview `.2` remains
immutable and is superseded by this release. The Build Week release remains
unchanged.

## v1.1.0-community-preview.2 — Filming-findings repair

This repair release closes ten product problems exposed while recording the
Community Preview walkthrough without changing the schema or supported Immich
version.

- Identity tagging no longer appears to save when the photo has not been
  imported into Cimmich; unavailable-photo states now explain whether to import
  the photo or change viewing mode.
- Home stories keep their title and imagery on the same Event, context chips
  name the right kind, Body terminology is consistent and collection counts
  follow the active filter.
- Photo Info state no longer carries into a different photo, Organise links use
  their visible labels as accessible names and the portaled visibility menu is
  operable with a pointer as well as a keyboard.
- Decision-history responses explicitly declare that their projection follows
  the current viewing mode, preventing a filtered count from being mistaken for
  a whole-archive audit total.
- Web and service transitive dependencies are pinned above the advisories
  disclosed during candidate CI, and the provider confinement contract uses a
  cross-platform outside-root fixture instead of a macOS-only path.
- The immutable Build Week release and Community Preview `.1` remain unchanged.

## v1.1.0-community-preview.1 — Complete memory companion preview

This bounded Community Preview advances the maintained product from identity
review into a complete local memory companion for exact Immich 3.1.0.

- Organise opens on Timeline and keeps human Folders, searchable multi-select
  Cimmich/Normal Tags, Albums and Bulk one switch away.
- Events support folder admission, Needs check review, copying, rapid multiple
  creation, recurrence, containment, connected stories and ordered trip stops.
- People, Pets, Places, Things and Documents have distinct, photo-led homes,
  typed relationships, durable decisions and visible Undo where applicable.
- Smart Search preserves query state and offers bounded failure recovery.
- Guided install, backup, update, restore, disable and removal remain scoped to
  a separate Cimmich project and database; original media is not modified.
- The release is intentionally bounded to macOS/Linux, single-owner local use,
  English-first UI and exactly Immich 3.1.0.

## v1.0.1-beta.6 — People review, real matching operations and Pets

This is a substantial public-beta update focused on making the product's
identity machinery understandable and operable by an archive owner.

### People and identity review

- People opens on the People directory rather than Suggestions.
- Category filtering is single-choice; People and workflow controls are
  visually separated.
- Sorting is explicit: photo count or name, with direction and active-state
  indicators.
- Person profiles use a dossier-style Details view and a clearer Identity
  workspace split into confirmed Face evidence, Head/Body/Presence appearance,
  Display photos and Review.
- Display Face, Body and Hero images are selected and reframed in place. Saved
  framing is reused by profile and directory consumers.
- New-match review shows only the unresolved face, supports bulk selection and
  offers explicit confirm or reassignment. `Not <name>` opens a bounded
  replacement picker instead of silently discarding the face.
- Possible mistags can be confirmed, marked as non-matching Head evidence or
  reassigned to a closest or typed Person.
- The People Suggestions page separates suggestions for known People from
  recurring unnamed-face groups. Possible People are ordered by recurrence and
  retain time/location context without being presented as already tagged.

### Matching machinery and maintenance

- Full-library identity audits are durable, resumable and provenance-bound.
  Untagged candidates and accepted identities worth checking remain separate
  review queues.
- Same-photo derivatives cannot masquerade as independent reference evidence.
- SourcePack rebuilds expose safety and coverage results; a worse successor is
  held inactive rather than replacing the known pack.
- Imported `Name 2`-style metadata retains its source locator as unresolved
  owner work instead of being silently converted to Presence. Saving the
  owner's Face, Head, Body or Presence correction resolves that locator
  atomically.
- Maintenance now reports the actual provider, processing and SourcePack state
  and keeps model output separate from identity authority.

### Pets

- Pet Display Face, Body and Hero framing now uses the same saved crop in
  editors, cards and profile heroes.
- Optional PetFace and MiewID adapters are supplied as weight-free,
  user-configured provider examples. Their model weights and licences remain
  the operator's responsibility.
- Pet matching is species- and vector-space-bound, review-only and allowed to
  abstain.
- The Pets index has a global Unknown Pets workspace. It shows the exact
  detector region and lets the owner assign a known same-species Pet or reject
  only the incorrect species observation. A model proposal never creates Pet
  identity evidence by itself.

### Installation and safety

- Guided installation, agent-led setup and maintenance wording are clearer for
  operators who are not Docker or model experts.
- The Build Week tag, release, assets and evaluation route remain unchanged.
- Cimmich still writes only its separate database; it does not directly write
  Immich's database or original media.
- No model weights, private archive data, active private SourcePack or claimed
  representative biometric-accuracy result are included.

## Earlier public-beta patches

- `v1.0.1-beta.5`: beginner install bundle and guided setup documentation.
- `v1.0.1-beta.4`: one-time historical embedding repair.
- `v1.0.1-beta.3`: truthful face-processing progress.
- `v1.0.1-beta.2`: restored public-beta face processing.
- `v1.0.1-beta.1`: first maintained Public Beta after Build Week.
