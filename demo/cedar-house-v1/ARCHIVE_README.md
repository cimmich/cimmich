# The Cedar House Archive V1

Production state: accepted 51-asset media archive with deterministic Cimmich
demo/bootstrap state

This directory is the production source for Cimmich's wholly synthetic,
51-image public demo archive. It contains no real-person or private source
media.

## Structure

- `references/` — approved recurring-character, Pet, Place and Thing references
- `media/` — final 51 demo image assets only
- `provenance/` — prompts, generation chain, hashes, rights and transformations
- `shot-ledger.csv` — exact content and Cimmich demonstration role per asset
- `ATTRIBUTION.md`, `NOTICE.md` and `LICENSE.md` — distribution notices

The accepted media set contains exactly 51 PNG assets (128 MiB total). The
visual QA sheet is `references/qa-contact-sheet-v1.png`; it is proof material,
not a media asset.

The image set demonstrates product experience, not representative recognition
accuracy. Provider evaluation remains a separate test lane.

## Visual law

- believable family phone/consumer-camera archive, not stock photography;
- stable fictional identities and recurring context across years;
- mixed landscape/portrait framing, ordinary clutter and plausible imperfection;
- no brands, public figures, real addresses or copied source photographs;
- no text generated inside ordinary photographs;
- document text is created separately from fictional structured content and
  verified before inclusion;
- final media must be visually inspected before manifest acceptance.

## Rights law

Every final asset has a provenance row with generator/model, canonical prompt
record, reference ancestry, creation date, SHA-256, dimensions, synthetic
declaration, material edits and visual-review state. Distribution must keep
`LICENSE.md`, `NOTICE.md`, `ATTRIBUTION.md`, `shot-ledger.csv` and the
`provenance/` directory with the media.
