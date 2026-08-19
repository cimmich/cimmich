# Community Preview publication runbook

This runbook publishes one already-certified Cimmich candidate. It does not
authorize publication and it must not be used to promote a dirty or superseded
working tree.

## Required inputs

- the exact candidate commit and tree recorded in `docs/RELEASE_READINESS.md`;
- the exact `<release-tag>` recorded in `CIMMICH_VERSION` and the matching
  human-readable release title;
- one release directory whose name ends in that candidate's short commit;
- `cimmich-<release-tag>.tar.gz`, `cimmich-<release-tag>.zip` and
  `SHA256SUMS` from that directory;
- a final independent PASS that names those exact hashes; and
- owner approval to publish.

Any other directory under the local release archive is historical evidence,
not a publication source. Never choose a bundle by filename alone.

## Pre-publication verification

1. Confirm `git status --short` is empty and `git rev-parse HEAD` matches the
   certified candidate.
2. Replay `tools/sha256.sh verify SHA256SUMS` inside the candidate-suffixed
   release directory using the platform's available checksum implementation.
3. Extract both archives into separate clean temporary directories.
4. Confirm Git, tar and ZIP have identical tracked paths, bytes and executable
   modes, with no AppleDouble members.
5. Run `./tools/install.sh --check` from both extractions and confirm it leaves
   the host state unchanged.
6. Confirm README, FAQ, changelog, `CIMMICH_VERSION`, release notes and the
   release title all name the same Community Preview and exact Immich 3.1.0.
7. In a directory containing only one named bundle plus `SHA256SUMS`, replay the
   documented user checksum command and require an `OK` exit without treating
   the absent alternative archive as a failure.
8. Confirm the README and release notes link to the current product site and
   Guide, name Cimmich as the matcher and describe platform claims as tested or
   untested rather than proven failure.
9. Confirm the public repository has no tag with the intended release name.
10. From both extracted bundles, confirm Compose renders with local Cimmich image
    names and build both checked-in API/UI Dockerfiles successfully.
11. Run `tools/run_install_docs_acceptance.sh` from the clean candidate. It must
    verify each named archive alone and render the database-backup override with
    the guided project and generated runtime environment.

Any mismatch returns the candidate to HOLD and requires a rebuilt candidate.

## Git and release mechanics

The candidate is certified on canonical public `main`. Do not introduce a
release-only product branch. Create the annotated tag
`<release-tag>` at the exact certified `main` commit. If the
commit or tree changes, certification does not carry forward: rebuild and
reverify before tagging.

Create a full GitHub release whose title matches the candidate named in
`CIMMICH_VERSION`. Attach the two named bundles and `SHA256SUMS`; do not
substitute GitHub's automatic source archives for the beginner install bundles.

Container images are optional distribution artifacts, not a public-install
gate. Do not reference a registry package in the Compose defaults, README or
release notes unless a fresh logged-out pull proves that exact package is
public. Advanced operators may still use explicit
`CIMMICH_API_IMAGE=name@sha256:...` and
`CIMMICH_UI_IMAGE=name@sha256:...` overrides for an accessible trusted registry.

## Logged-out verification

After publication, use a signed-out browser to verify the release page, tag,
README, FAQ, all three attachments and both checksums. Download both bundles,
replay their hashes, and run the non-mutating installer check once more.

Record the public URL, tag commit, artifact hashes and verification time in the
project release receipt. If any public asset differs, remove the release from
distribution until a new exact candidate is certified; never replace an asset
under the same published checksum claim.
