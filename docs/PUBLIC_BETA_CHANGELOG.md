# Cimmich Public Beta changelog

This changelog records maintained-product work after the immutable
`v1.0.0-build-week` submission. It does not revise or expand what was submitted
for OpenAI Build Week.

## v1.1.0-community-preview.19: Final V1 closeout

- Discover and Person memory webs are now explicitly Experimental and off by
  default. An owner can opt in from Cimmich experience settings, turn the
  surfaces off without losing recorded facts, or follow an honest enable prompt
  from a direct Discover URL. Local AI remains a separate opt-in experiment.
- Privacy-projected Home, Context detail, Visual Search and Tags state clears
  synchronously on a viewing-mode generation change and only publishes a
  successful response for the current generation.
- Schema 156 binds consequential relationship commands to actor, operation and
  canonical payload, stores exact replay responses and makes relationship event
  histories append-only.
- Optional provider subprocesses use bounded execution and decoded-image
  limits. The user-supplied MiewID adapter no longer executes unpinned remote
  publisher code.
- The guided lifecycle durably reuses its configured Compose project, rejects
  mismatches and collisions, and takes a quiesced database-plus-Documents
  snapshot with content-digest verification.
- Release CI exercises exact Preview 18 upgrade and rollback plus migration,
  synthetic, stock-Immich, companion and public-demo lifecycles from extracted
  tar and ZIP payloads before exact-tag container publication.
- Oversized UI and service responsibilities were extracted into focused
  modules without raising source-shape ceilings. Publication scanning covers
  tracked names and paths as well as textual contents.
- Compatibility remains exact Immich 3.1.0. The guided path remains tested on
  macOS and Linux; Windows, Internet-facing and multi-user operation remain
  outside the Community Preview boundary.

## v1.1.0-community-preview.18: Exact Refresh and repository launch truth

- Person Refresh is described as rebuilding that Person's Core matching set
  from current confirmed Face evidence, then searching again with the current
  calibrated matching policy. SourcePack proposal and activation remain a
  separate governed lifecycle.
- The user guide names the primary Person tabs shown by the product: Photos,
  Identity, Details, Connections and Documents.
- First-run guidance follows Settings, Library connection and Connect your
  existing Immich library. Installer output and release readiness say tested
  platform rather than implying a broader support commitment.
- The FAQ states the exact boundary: core organisation does not require a
  model, People matching requires compatible local face-analysis evidence, and
  Cimmich remains the matcher and owner-governed decision system.
- Publication instructions now derive archive names, tag and title from the
  release identity instead of hard-coding the previous preview.
- Product behavior, schema 142 and exact Immich 3.1.0 compatibility are
  unchanged.

## v1.1.0-community-preview.17: Verified beginner installation and matching guide

- A user who downloads either the tar bundle or the ZIP can now verify that
  single archive without the absent alternative causing a false checksum
  failure. The publication gate replays this exact one-bundle case on macOS and
  GNU/Linux.
- The database-backup Compose example now extends the installer-managed
  project with its generated `runtime.env`, so required guided configuration is
  retained instead of starting an unrelated or incomplete stack.
- The public README, walkthrough, FAQ and guides lead with Cimmich's matcher,
  the Confirm and Refresh loop, tested or untested platform truth, and direct
  product-site and Guide routes.
- Five fictional Cedar House product captures show new matches, possible
  mistags, evidence correction and the resulting Person review state. No
  private archive media, settings or evaluation results are included.
- Product behavior, schema 142 and exact Immich 3.1.0 compatibility are
  unchanged.

## v1.1.0-community-preview.16: Exact public product and operator truth

- Cimmich is named as the matcher across README, installation, FAQ, guide,
  installer and signed-in setup copy. Optional local face-analysis providers
  extract observations and embeddings; they do not own matching or identity.
- Native Windows PowerShell and WSL2 are described as untested rather than
  unsupported. The guided path has been exercised on macOS and Linux Docker
  hosts.
- Immich Smart Search, Duplicate Detection and OCR are presented as optional
  sources for visual leads, native duplicate groups and text. None is described
  as Cimmich face-matching preparation.
- The independent photo backup override now extends the configured guided
  installation with its exact Compose project and generated `runtime.env`.
  Release tests reject the superseded claims and require the complete command.
- Product behavior, schema 142 and exact Immich 3.1.0 compatibility are
  unchanged.

## v1.1.0-community-preview.15: Compact photo toolbar access

- At widths below 640 px, the photo viewer uses one horizontally scrollable
  action row. Cimmich People and Context remain clickable instead of sitting
  beneath the parent toolbar.
- The 320 px Face bulk-edit journey now opens an explicit Cimmich photo context,
  requires the People action to be visible, and completes within the normal
  30-second test limit.
- Product source remains shared between public `main` and private deployments.
  Schema 142 and the supported exact Immich 3.1.0 boundary are unchanged.

## v1.1.0-community-preview.14: Browser acceptance reliability

- The 320 px Face bulk-edit reflow journey now has a 60-second test budget so
  its cleanup is not forced to share the default 30-second limit with several
  full-page navigations and signed-in mode changes.
- The CI label now reports all browser journeys instead of the stale seven-test
  count. The suite currently contains eight journeys.
- Product behavior, schema 142 and the one-product-line boundary introduced in
  Preview 13 are unchanged.

## v1.1.0-community-preview.13: One current product line

- Public `main` and the private production deployment now use the same product
  source. Deployment defaults, local configuration and owner data remain
  external to the shared code.
- Person Checks includes a visible `Refresh matches` action that reruns the
  normal bounded matcher for that Person after owner corrections.
- Smart Search now treats accepted photo-level Person evidence as presence.
  A Person connection to an Event, Place or Thing no longer makes every photo
  in that context appear to contain the Person.
- Archive Health now shares one compact command bar across Exact copies,
  Possible duplicates, Folder check, Rotation review and Backup check. Expensive
  categories and detailed evidence load only when selected.
- Folder check ranks high-impact folders, compares aligned copies, exposes full
  paths and metadata differences, and recommends a review candidate without
  granting deletion authority.
- Rotation review uses Immich visual leads with fitted magnification, bounded
  backlog counts, immediate progression and explicit confirm actions.
- Backup check separates Photos from the Cimmich database. Database policy,
  retention, checksummed PostgreSQL artifacts and latest-backup verification
  remain owner-configured and require an independent destination.
- Standard, Smart, Enhanced and Custom summaries keep accepted Cimmich facts
  authoritative. Optional local providers remain off by default in the public
  configuration.
- Production API images include the local SourcePack refit scorer. Release
  acceptance now rebuilds and activates a bounded candidate pack before it
  verifies matching, restart persistence and provider disablement.
- Schema 142 safely converges the exact public Preview 12 schema-131 history
  and the exact private schema-131 history, then preserves both feature sets.
  Compatibility remains exact Immich 3.1.0.

## v1.1.0-community-preview.12: Read-only Immich boundary and matching continuity

- Cimmich organisation writes only to Cimmich-owned state. Folder manifests
  create collections, and bulk or selected-photo tags, favourites and archive
  choices use append-only Cimmich decisions with exact Undo. No Cimmich path
  mutates Immich albums, memberships, tags or asset metadata.
- Schema 131 adds first-class collection, favourite and archive organisation
  kinds. Pre-131 browser Undo receipts are rejected so they cannot replay an
  old Immich mutation; existing Immich data is left untouched.
- Opening `/cimmich` or `/cimmich/` in the isolated public demo reaches the
  Cimmich application directly instead of colliding with its asset folder.
- Newly eligible Faces take priority over a held or pending reference pack.
  Switching to a wider viewing mode therefore offers missing analysis before
  SourcePack review or rebuilding continues.
- The public demo face-provider installer exits successfully after its
  checksum-verified model install, API restart and health check.
- Public demo Guided tokens use owner-only `0600` permissions, and the API uses
  the invoking host identity without widening access.
- People distinguishes directory membership from photos visible in the current
  viewing mode. Stale review hints appear as a check in progress.

## v1.1.0-community-preview.11: Clearer People and Archive Health review

- The People directory keeps its title, result count, review modes, search,
  sort, filters and grid size in one compact top bar. The obsolete Identity
  checks overlay link is removed.
- People and Explore controls provide useful tooltips. Explore calls its
  privacy filter Privacy bucket and removes ambiguous empty-scope copy.
- Folder Check opens with the selected folder, path and essential actions in
  one compact command bar, with results immediately below it.
- Duplicate copies align horizontally with balanced previews. Full paths,
  exact bytes, resolution, capture and modified times, location, camera and
  secondary Immich metadata make each difference inspectable.
- Folder overlaps are capped initially, possible duplicate groups load in
  small batches, and detailed evidence loads only for the selected comparison.

## v1.1.0-community-preview.10: Demand-loaded Archive Health checks

- Archive Health is a first-class navigation destination for exact copies,
  possible duplicates, Folder Check and independent backup status.
- Folder Check ranks folders by duplicate impact, compares one selected folder
  with the rest of the archive, and separates shared, internal-only and
  currently unmatched files.
- The backup checker scans one configured independent destination read-only and
  reports exact matches, changed files, archive-only files and backup-only
  files. It refuses arbitrary paths and symlinks.
- Archive Health categories load only when selected. Folder ranking creates one
  cached native duplicate index, and selecting a folder scopes detailed source
  evidence instead of rerunning every category.

## v1.1.0-community-preview.9: Photo navigation and matching continuity

- The exact Cimmich photo viewer again moves through its projected collection
  with previous/next controls, pointer input and Left/Right arrow keys while
  preserving collection and presentation context.
- Archive-wide SourcePack matching scores each eligible Face against the active
  qualified Prime reference set with frozen score/margin floors, same-photo and
  shared-context guards and local-only scoring.
- Possible People suggestions sample a recurring group rather than trusting one
  representative Face. Mixed or opposed groups stay unresolved.
- Matching remains dry-run-first and may produce review candidates only. It
  never accepts identity or writes source media.
- The release includes the schema-129 single-owner boundary, schema-130 audit
  frontier, Familiar community navigation default and optional experimental
  Local AI surface accumulated after Preview 8.
- Compatibility remains exact Immich 3.1.0; the release schema is 130/patch 1.

## v1.1.0-community-preview.8: Photo privacy and portable operations

- Standard and Personal now exclude higher-ranked photos before inherited
  Folder/gallery thumbnails, Timeline buckets, direct photo/video renderers,
  preloads and viewer actions mount. A direct protected URL shows a bounded
  hidden-photo state with only Back and the viewing-mode control available.
- Private remains active while moving between Cimmich and ordinary Folder,
  Timeline or viewer routes. Explicit Exit Private, device lock and background
  lock retain their existing behavior.
- Photo presentation checks are bounded to 500 unique source IDs, batched,
  serialised, cached by viewing-mode version and fail closed on lookup errors.
- Backup, restore, portable export and portable restore use one checked-in
  SHA-256 operator that supports either GNU `sha256sum` or macOS `shasum`; the
  installer preflights the complete lifecycle dependency.
- Public documentation now leads with the product, one supported lifecycle,
  practical privacy, inspectable governance and rights-cleared Cedar House
  captures while retaining Preview 7's Labels, folder albums and People
  filters.
- Schema remains 128/patch 1 and compatibility remains exact Immich 3.1.0.

## v1.1.0-community-preview.7 - Faster review and archive organisation

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

## v1.1.0-community-preview.6 - Self-contained public installation

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

## v1.1.0-community-preview.5 - Unpublished operability candidate

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

## v1.1.0-community-preview.4 - Repository trust and conventional installation

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

## v1.1.0-community-preview.3 - Projected-photo viewer repair

This hotfix prevents the photo viewer from entering a Svelte reactive loop
when it opens a photo from a Cimmich Person, Pet or other projected collection.
The Info panel still closes when navigation changes the viewed photo, but its
lifecycle check now uses a deliberately non-reactive asset identifier instead
of subscribing the route loader to the state it writes. Preview `.2` remains
immutable and is superseded by this release. The Build Week release remains
unchanged.

## v1.1.0-community-preview.2 - Filming-findings repair

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

## v1.1.0-community-preview.1 - Complete memory companion preview

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

## v1.0.1-beta.6 - People review, real matching operations and Pets

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
