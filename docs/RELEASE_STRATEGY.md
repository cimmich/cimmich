# Cimmich release and branch strategy

Cimmich uses one canonical repository. The OpenAI Build Week submission is a
permanent release inside that repository, not a separate fork or disposable
competition repository.

## Build Week freeze

The exact submitted revision is preserved in three ways:

1. the annotated tag `v1.0.0-build-week` permanently identifies the submitted
   commit;
2. the matching GitHub Release records its source archive, demo-package
   checksums, verification summary and submitted video link.
3. the Devpost entry and README link directly to that immutable release.

The tag, release, release assets, submitted links and free evaluation route
remain permanently available. `main` is the living product branch and may
advance without rewriting that submission history.

## Continued development

Development does not stop after submission:

- make post-submission work through small feature/fix branches and reviewed
  pull requests into `main`;
- label post-submission changes explicitly and never imply that they were part
  of the submitted revision;
- never move, replace or delete the submitted tag, release, assets or evaluation
  links; and
- publish later maintained-product milestones as new named releases with their
  own exact commits, artifacts and verification.

The current maintained release is `v1.1.0-community-preview.6` on schema
120/patch 1. Later preview numbers must never move or replace an existing tag.
A stable release comes only after the installation, compatibility, usability
and real-library boundaries are strong enough for wider promotion.

Every public-beta release intended for newcomers must include three named
assets in addition to GitHub's automatic source archives:

- `cimmich-<version>.tar.gz`;
- `cimmich-<version>.zip`; and
- `SHA256SUMS` covering both bundles.

Build them from the exact release working tree with:

```sh
./tools/build_install_bundle.sh <version> /absolute/output/directory
```

The builder refuses a dirty tree and runs `tools/run_publication_scan.sh`
before packaging tracked files.

The exact merge, tag, attachment and logged-out verification sequence is in
[the Community Preview publication runbook](COMMUNITY_PREVIEW_PUBLICATION.md).

Extract both formats into clean directories and run
`./tools/install.sh --check` from each before publication. The extracted folder
name, executable installer mode, checksum and tag commit must agree with the
release notes. Automatic GitHub source archives remain useful source access,
but they are not the documented beginner download.

## Public-beta roadmap

- Polish the Details page of the People area.

## Release identity

`v1.0.0-build-week` means “the exact Cimmich Build Week edition.” It does not
claim that inherited Immich/Rimmich work was created during the competition.
The [Build Week evidence index](BUILD_WEEK_EVIDENCE.md) records that boundary.

`v1.1.0-community-preview.6` means the exact current self-contained Community
Preview. It does not replace or revise the submitted edition. Its named tar,
ZIP and checksum assets remain bound to that tag while `main` continues through
reviewed pull requests.

Do not create a second Cimmich repository for later development. A second
repository would split issues, stars, contributors, documentation and
provenance while giving reviewers and users two competing sources of truth.

## Historical initial publication sequence

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
The release and repository remained private until that exact attachment was
present. The stable URL and checksum were then verified from a logged-out
context before the Build Week evaluation link was submitted.

Repository visibility, publication, release creation and submitted-link changes
remain explicit owner actions.
