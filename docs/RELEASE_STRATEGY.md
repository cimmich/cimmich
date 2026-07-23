# Cimmich release and branch strategy

Cimmich uses one canonical repository. The OpenAI Build Week submission is a
permanent release inside that repository, not a separate fork or disposable
competition repository.

## Build Week freeze

The exact judged revision is preserved in three ways:

1. the annotated tag `v1.0.0-build-week` permanently identifies the submitted
   commit;
2. the matching GitHub Release records its source archive, demo-package
   checksums, verification summary and submitted video link.
3. the Devpost entry and README link directly to that immutable release.

The tag, release, release assets, submitted links and free judge-testing route
remain unchanged and available through at least **2026-08-05 17:00 PT**.
`main` is the living product branch and may advance without rewriting that
submission history.

## Continued development

Development does not stop after submission:

- make post-submission work through small feature/fix branches and reviewed
  pull requests into `main`;
- label post-submission changes explicitly and never imply that they were part
  of the judged revision;
- never move, replace or delete the submitted tag, release, assets or judge
  links; and
- publish the first maintained-product milestone as the GitHub pre-release
  **Cimmich v1.0.1 — Public Beta**, tagged `v1.0.1-beta.1`.

Further beta corrections may use `v1.0.1-beta.2` and later prerelease numbers.
A stable release comes only after the installation, compatibility, usability
and real-library boundaries are strong enough for wider promotion.

## Public-beta roadmap

- Polish the Details page of the People area.

## Release identity

`v1.0.0-build-week` means “the exact Cimmich Build Week edition.” It does not
claim that inherited Immich/Rimmich work was created during the competition.
The [Build Week evidence index](BUILD_WEEK_EVIDENCE.md) records that boundary.

`v1.0.1-beta.1` means “the first maintained Cimmich public beta after Build
Week.” It does not replace or revise the submitted edition. The human-facing
release title is **Cimmich v1.0.1 — Public Beta**; GitHub marks it as a
pre-release so the Build Week release remains the latest stable release.

Do not create a second Cimmich repository for later development. A second
repository would split issues, stars, contributors, documentation and
provenance while giving judges and users two competing sources of truth.

## Initial publication sequence

1. Import only the final privacy-cleared publication tree into the empty private
   `cimmich/cimmich` repository.
2. Run clean-clone installation, tests, rights, secret and private-data checks.
3. Commit the frozen result to `main` with the approved public noreply identity.
4. Create the annotated `v1.0.0-build-week` tag from that exact commit.
5. Push `main` and the tag, create the matching GitHub Release and verify all
   submitted links from a logged-out context.
6. Create `post-build-week` from the tag only after the submitted state is
   recorded and verified.

The `v1.0.0-build-week` release also carries the canonical Cedar House archive
`cimmich-cedar-house-v1.tar.gz`, SHA-256
`937b5859635af6f1b775dcbab1e28411b2e6f4a6182b72e003e3ccdda455347f`.
The release and repository must remain private until that exact attachment is
present; after publication, verify its stable URL and checksum from a logged-out
context before submitting any judge-facing link.

Repository visibility, publication, release creation and submitted-link changes
remain explicit owner actions.
