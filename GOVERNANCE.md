# Project governance

Cimmich is an independent open-source project with one accountable product and
release authority. This document explains how decisions are made, how
AI-assisted implementation is handled, and how authorship is attributed.

## Authority and roles

**Benji** holds product direction, prioritisation, acceptance and release
authority for Cimmich. That includes deciding:

- which user problem and compatibility target a release serves;
- what Cimmich may read, store, change or expose;
- when model output must abstain or require owner confirmation;
- which limitations are stated publicly;
- whether evidence is sufficient to merge, tag or release; and
- whether an external contribution fits the product.

Benji framed the product problem, set the privacy, identity, compatibility and
release contracts, translated them into acceptance gates, reviewed the
resulting evidence and authorises releases. Living Cimmich development uses
substantial AI assistance coordinated and accepted under that authority. Exact
tooling is recorded where it is historically or release-relevant; the inherited
Immich-derived web foundation and all upstream work are separately attributed
in the repository's lineage records.

This records the operating model directly: human product judgment coordinates
agentic implementation, with inspectable technical and release gates. Product
authority does not transfer to a model.

## How the operating model is inspectable

These public artifacts make the project's decision and acceptance model
inspectable:

| Decision area | Public receipt |
| :--- | :--- |
| What Cimmich may read, store and change | [Privacy boundary](docs/PRIVACY_BOUNDARY.md) and [source-media immutability](docs/SOURCE_MEDIA_IMMUTABILITY.md) |
| What a user must be able to complete safely | [Community Preview acceptance journeys](docs/COMMUNITY_PREVIEW_JOURNEYS.md) |
| How identity suggestions defer to the owner | [Walkthrough](docs/WALKTHROUGH.md#4-review-a-suggestion-before-it-becomes-a-decision) and the acceptance journeys |
| Compatibility, lifecycle and release judgment | [Release strategy](docs/RELEASE_STRATEGY.md) and [release-readiness record](docs/RELEASE_READINESS.md) |
| What is allowed into a public artifact | [Publication scan](tools/run_publication_scan.sh) and [contribution boundaries](CONTRIBUTING.md#non-negotiable-product-boundaries) |
| Whether public demonstrations are inspectable and rights-cleared | [Cedar House demo contract](demo/cedar-house-v1/README.md) |

Together they show how product direction becomes bounded, testable and
releasable work while keeping implementation authorship and inherited lineage
distinct.

## Decision order

When two goals conflict, Cimmich uses this order:

1. protect the archive owner's data and authority;
2. preserve Immich and original-media integrity;
3. tell the truth about supported versions, behavior and evidence;
4. prefer understandable, reversible product behavior;
5. keep changes reviewable and maintainable; and
6. improve convenience or performance only inside those boundaries.

A test result, model score or implementation shortcut cannot override a higher
rule.

## How changes are accepted

A consequential change should identify:

1. the user problem;
2. the authority and privacy boundary;
3. data, API or migration contracts affected;
4. failure, replay, conflict and Undo behavior;
5. focused and regression proof; and
6. limitations or claims deliberately left open.

Identity and matching changes require particular restraint. Calibration is not
acceptance proof; an aggregate accuracy number is not authority to activate a
model; and missing or conflicting evidence must fail closed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the public contribution workflow and
[DEVELOPMENT.md](DEVELOPMENT.md) for local checks.

## AI-assisted development policy

AI assistance is permitted, but it does not receive lower standards or hidden
authority.

- Material code-writing assistance must be disclosed accurately when authorship
  or provenance is discussed.
- A `Co-authored-by` trailer requires an identifiable author who made a real
  authorship contribution and explicit maintainer approval. Automated model,
  tool or vendor trailers are not accepted.
- Agent-produced changes must pass the same privacy, licensing, testing,
  reviewability and release gates as any other contribution.
- Generated code is not accepted merely because it compiles or produces a
  plausible interface.
- Private media, credentials, internal paths and private operational systems
  must not be disclosed to a hosted model or public artifact.

Attribution should describe actual authorship and be corrected at its source
when inaccurate.

## Contributions and review

Focused documentation, test and defect fixes may be proposed directly. Broad
product, schema, privacy, matching or compatibility changes should begin with
an issue so the boundary can be agreed before implementation.

Review considers more than whether the happy path works. Depending on scope, it
may include:

- empty, error and recovery states;
- keyboard, zoom, mobile and reduced-motion behavior;
- migration interruption, replay and checksum drift;
- backup, restore and Cimmich-only removal;
- synthetic privacy and publication scanning;
- dependency and licence review; and
- source-shape or maintainability impact.

The maintainer may decline a technically functional change when it expands
authority, weakens the privacy boundary, obscures failure, or increases
long-term maintenance without enough user value.

## Releases

`main` is living development. Supported installation comes from a named release
with its own compatibility statement, bundles, checksums and verification. A
green `main` commit is not automatically a supported release.

The exact `v1.0.0-build-week` release is preserved as project history. Later
development and releases must not rewrite that tag or imply that post-event
work formed part of the submission.

Only the maintainer may authorize a public tag or release. Release procedure is
recorded in [docs/RELEASE_STRATEGY.md](docs/RELEASE_STRATEGY.md).

## Licensing and upstream lineage

Cimmich is AGPL-3.0-only and contains an adapted Immich web foundation under
preserved upstream terms. Changes must retain applicable notices and must not
imply Immich endorsement.

See [NOTICE.md](NOTICE.md), [LICENSE](LICENSE) and
[ui/CIMMICH_FORK.md](ui/CIMMICH_FORK.md).
