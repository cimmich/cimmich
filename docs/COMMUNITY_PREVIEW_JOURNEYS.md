# Community Preview user journeys

Updated: 2026-08-06
Candidate: `v1.1.0-community-preview.5`
Compatibility target: exact Immich 3.1.0

This is the user-facing acceptance map for the bounded Community Preview. A
journey is complete only when its ordinary path, honest empty state and useful
recovery path agree in the signed-in product and in the named automated proof.

## Product journeys

| Area                   | A newcomer should be able to                                                                                                                                              | Empty, edge and recovery behavior                                                                                                                                                                          | Proof surface                                                                                                               |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| Home                   | Understand what Cimmich adds, see a featured memory and move into the library without learning the data model first.                                                      | Counts and previews follow the current Viewing mode; unavailable optional features do not block the page.                                                                                                  | `home-presentation.spec.ts`; signed-in desktop and phone walkthrough.                                                       |
| Photos and Organise    | Open one familiar Photos surface, then switch its organisation mode between Timeline, Folders, Tags, Albums and Bulk.                                                     | The first mode opens by default; switching does not create a second navigation hierarchy. Empty folders or tags explain what will make them appear.                                                        | `organise-human-first.spec.ts`; signed-in mode-switch walkthrough.                                                          |
| Tags                   | Start in Cimmich Tags, search, select several tags and see the intersection of their matching photos; switch to Normal Tags when wanted.                                  | No-result searches and a library with no Normal Tags say so directly and retain the mode/search controls.                                                                                                  | `tag-browser.spec.ts`; signed-in multi-select walkthrough.                                                                  |
| People                 | Browse people visually, open one person, understand Face/Head/Body/Presence evidence and make owner-controlled corrections.                                               | Unnamed imported people remain held for review; ambiguous or conflicting identity operations fail without inventing a match and can be retried after correction.                                           | `people-*.spec.ts`; `run_synthetic_acceptance.sh`; signed-in collection/detail walkthrough.                                 |
| Pets                   | Browse pets separately from people, open a pet profile and see linked media and documents.                                                                                | Unknown pets remain review work; same-species suggestions never become automatic identity; rejected decisions have a visible history.                                                                      | `pet-*.spec.ts`; `pet-manual-journey.mjs`; `pet-document-journey.mjs`.                                                      |
| Places                 | Browse places, open mapped and unmapped place records, and see children and related media.                                                                                | No-GPS libraries retain manual Place creation and selection; unavailable geometry does not erase a named place.                                                                                            | `gps-place-discovery.spec.ts`; `place-*.spec.ts`; `context-search-journey.mjs`.                                             |
| Things                 | Browse named objects and open the photos connected to one object.                                                                                                         | A missing or archived object returns an honest not-found state; manual context remains available without a provider.                                                                                       | `context-search-journey.mjs`; signed-in collection/detail walkthrough.                                                      |
| Events                 | Create an Event, Trip, Activity or Life period; add several folders; connect parent, child and related events; copy an event; and save another without leaving the flow.  | The folder picker hides Immich-managed storage paths, includes external-library subfolders and supports several choices. Missing targets, invalid nesting and cycles fail closed without losing the draft. | `event-folder-graph.spec.ts`; `context-search-journey.mjs`; signed-in create/detail/folder walkthrough.                     |
| Documents              | Browse documents, open one, follow links to people, pets or events and understand its visibility.                                                                         | Missing content, quota limits, interrupted writes and stale Undo return bounded errors; backup, restore, export and purge retain receipts.                                                                 | `CimmichDocuments.spec.ts`; `document-journey.mjs`; `document-digest-repair-journey.mjs`.                                   |
| Smart Search           | Search the shared memory graph with names, places, dates and combinations such as a person in a place.                                                                    | Invalid dates are explained; zero results preserve the query; an unavailable API presents Retry and Edit search, then recovers without retyping when service returns.                                      | `smart-search-presentation.spec.ts`; `basic-smart-search.test.mjs`; live outage/recovery walkthrough.                       |
| Library setup          | Inspect and start the root Compose definition or use the guarded installer, connect to Immich, preview the exact scope, import it and understand what still needs review. | Compose and installer both reject an unsupported Immich version before the Cimmich API starts. Credentials are not shown again; permission rejection stays before import; interrupted import resumes.      | `install-operator.test.mjs`; `CimmichImmichSetup.spec.ts`; `immich-onboarding-journey.mjs`; companion lifecycle acceptance. |
| Models & Guided        | Understand that models and Guided clients are optional, inspect their state and configure one deliberately.                                                               | Core remains usable with both disabled; unsupported or unavailable providers abstain rather than manufacturing evidence.                                                                                   | maintenance component tests; synthetic and stock-Immich lifecycle acceptance.                                               |
| Maintenance and backup | Inspect processing state, pause or resume work, create a backup and recover from an interrupted or rejected operation.                                                    | Destructive actions require exact confirmation; rejected backup inputs preserve the running installation and its counts.                                                                                   | media-operator journey; companion and public-demo lifecycle acceptance.                                                     |

## Cross-product gates

- **Navigation and language:** every top-level section has one clear page title,
  one primary task and English-first Community Preview copy.
- **Keyboard:** skip-to-content, primary navigation, tabs, search, mode switches,
  dialogs and the main submit/retry actions are reachable and operable without
  a pointer.
- **Reflow:** the primary journeys remain usable at phone width and at 200%
  browser zoom without hiding the next action behind horizontal page scroll.
- **Motion:** required understanding does not depend on animation, and motion
  is reduced when the operating system requests it.
- **Viewing truth:** Standard, Personal and Private affect counts, covers,
  previews and search consistently; a Guided client cannot raise that ceiling.
- **Failures:** permission rejection, no GPS, no tags, zero search results,
  unreachable API, interrupted import, stale commands and destructive-action
  rejection each leave a next step instead of a dead end.
- **Lifecycle:** fresh install, schema-75 Patch-6 upgrade, current-schema
  refresh, backup/restore, restart, disable and removal are tested against exact
  Immich 3.1.0 while Cimmich state remains separate.

This matrix defines Preview acceptance; it is not a claim of stable support for
other Immich versions, native Windows, Internet-facing deployment or automatic
identity acceptance.
