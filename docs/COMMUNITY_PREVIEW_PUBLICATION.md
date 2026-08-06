# Community Preview publication runbook

This runbook publishes one already-certified Cimmich candidate. It does not
authorize publication and it must not be used to promote a dirty or superseded
working tree.

## Required inputs

- the exact candidate commit and tree recorded in `docs/RELEASE_READINESS.md`;
- one release directory whose name ends in that candidate's short commit;
- `cimmich-v1.1.0-community-preview.3.tar.gz`,
  `cimmich-v1.1.0-community-preview.3.zip` and `SHA256SUMS` from that directory;
- a final independent PASS that names those exact hashes; and
- owner approval to publish.

Any other directory under the local release archive is historical evidence,
not a publication source. Never choose a bundle by filename alone.

## Pre-publication verification

1. Confirm `git status --short` is empty and `git rev-parse HEAD` matches the
   certified candidate.
2. Replay `sha256sum -c SHA256SUMS` inside the candidate-suffixed release
   directory.
3. Extract both archives into separate clean temporary directories.
4. Confirm Git, tar and ZIP have identical tracked paths, bytes and executable
   modes, with no AppleDouble members.
5. Run `./tools/install.sh --check` from both extractions and confirm it leaves
   the host state unchanged.
6. Confirm README, FAQ, changelog, `CIMMICH_VERSION`, release notes and the
   release title all name the same Community Preview and exact Immich 3.1.0.
7. Confirm the public repository has no tag with the intended release name.

Any mismatch returns the candidate to HOLD and requires a rebuilt candidate.

## Git and release mechanics

The candidate is developed on a reviewed branch. Publication should advance
`main` through the normal reviewed merge route, then create the annotated tag
`v1.1.0-community-preview.3` at the exact merged candidate commit. If the merge
changes the commit or tree, certification does not carry forward: rebuild and
reverify before tagging.

Create a GitHub pre-release titled **Cimmich v1.1.0 — Community Preview** from
that tag. Attach the two named bundles and `SHA256SUMS`; do not substitute
GitHub's automatic source archives for the beginner install bundles.

## Logged-out verification

After publication, use a signed-out browser to verify the release page, tag,
README, FAQ, all three attachments and both checksums. Download both bundles,
replay their hashes, and run the non-mutating installer check once more.

Record the public URL, tag commit, artifact hashes and verification time in the
project release receipt. If any public asset differs, remove the release from
distribution until a new exact candidate is certified; never replace an asset
under the same published checksum claim.
