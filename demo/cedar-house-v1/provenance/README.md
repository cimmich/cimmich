# Provenance

## Generation

- Date: 2026-07-18
- System: OpenAI image generation invoked through Codex
- Recorded model family: `gpt-image-2`
- Inputs: human-authored shot ledger, prompts, and the two wholly synthetic
  reference boards in `../references/`
- Real source photographs: none
- Private media: none
- Material post-generation edits to admitted assets: none; accepted files were
  copied byte-for-byte from their generated outputs

## Records

- `manifest.csv` binds every admitted asset to its SHA-256, byte size,
  dimensions, chapter, subjects, contexts, references and QA state.
- `prompts.md` is the durable canonical prompt catalogue. It records the
  intended prompt semantics; it does not pretend transient execution strings
  are a byte-stable API.
- `../shot-ledger.csv` records the product-demonstration role and planned
  visibility tier.
- `../references/qa-contact-sheet-v1.png` is a derived visual-review sheet,
  excluded from the 51-asset media count.

Rejected or superseded generations are not part of the archive and receive no
asset ID. Admission required a visual check for cast identity/count, anatomy,
context, unintended people/animals, document text, obvious brand material and
the intended Face/Head/Body/Presence evidence role.

## Mapping corrections

- 2026-07-20: the accepted byte payloads for `CHA-030` and `CHA-031` were
  swapped under their semantic filenames after visual review found the table
  scene labelled as the Bluewater overlook and the coast scene labelled as
  birthday preparation. Neither image was regenerated or altered. The
  manifest and checksum catalogue bind each unchanged payload to its corrected
  filename, prompt, chapter, subjects and contexts.
- 2026-07-20: cast-sheet comparison corrected `CHA-021` from Maya to Samira
  and `CHA-029` from Theo to Nora. Their accepted image payloads, filenames and
  image checksums remain unchanged.
