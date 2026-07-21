# Cimmich release and branch strategy

Cimmich uses one canonical repository. The OpenAI Build Week submission is a
permanent release inside that repository, not a separate fork or disposable
competition repository.

## Build Week freeze

The exact judged revision will be preserved in three ways:

1. `main` points to the submitted revision throughout the judging period;
2. the annotated tag `v1.0.0-build-week` permanently identifies that commit;
3. the matching GitHub Release records its source archive, demo-package
   checksums, verification summary and submitted video link.

The Devpost entry and README will identify the exact tag and commit SHA. The
tag, release and free judge-testing route remain unchanged and available
through at least **2026-08-05 17:00 PT**.

## Continued development

Development does not stop after submission:

- create `post-build-week` directly from `v1.0.0-build-week`;
- make post-submission work there through small feature/fix branches and pull
  requests;
- do not merge those changes into `main` during judging unless an eligibility,
  access or critical safety issue requires it;
- identify any unavoidable correction explicitly without moving or replacing
  the submitted tag; and
- after judging closes, merge the accepted continuation into `main` and publish
  the next semantic release, expected to be `v1.1.0` for compatible additions
  or `v1.0.1` for a narrowly scoped correction release.

This temporary two-branch shape protects submission reproducibility. After the
judging freeze, `main` returns to being the normal stable public branch; ongoing
changes arrive through short-lived branches and reviewed pull requests.

## Release identity

`v1.0.0-build-week` means “the exact Cimmich Build Week edition.” It does not
claim that inherited Immich/Rimmich work was created during the competition.
The [Build Week evidence index](BUILD_WEEK_EVIDENCE.md) records that boundary.

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
