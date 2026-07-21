# Cimmich Space Trip V1

Space Trip V1 is an optional six-image extension for the 51-image
[Cedar House V1](../cedar-house-v1/README.md) demo. Together they form the
57-asset release-candidate library used to prove that a compatible Guided V2
client can add and organise a new album inside an already established archive.

All six images are wholly synthetic and depict the fictional Cedar House
subject Maya Chen on a fictional, unbranded civilian space trip. They do not
depict a real person, mission, agency or spacecraft.

## What the extension demonstrates

| ID     | Intended owner truth                                    |
| :----- | :------------------------------------------------------ |
| ST-001 | Full Body and Head; Face unsuitable behind a dark visor |
| ST-002 | Clear Face plus Body                                    |
| ST-003 | Head; reflected visor makes Face evidence weaker        |
| ST-004 | Rear-view Body; no Face                                 |
| ST-005 | Presence only; no honest local region                   |
| ST-006 | Clear Face in ordinary trip context                     |

The completed reference workflow also creates:

- Event: `Space Trip`;
- Place: `Low Earth Orbit`;
- Thing: `Orbital Capsule`;
- Standard/Personal/Private media examples;
- replay and decision-scoped Undo proof.

No automatic identity, SourcePack, model training or provider activation is
part of the extension.

## Use

1. Start the Cedar House base with `tools/public_demo.sh up`.
2. Point a compatible client at Guided V2's
   `GET /v1/guided/v2/bootstrap` using the separately provisioned Cimmich
   Guided credential and authority ceiling.
3. Give that client these six files and ask it to add and organise the album.
4. Verify the final product through the UI. The accepted reference state adds
   six assets, three contexts and eight typed tags to the completed Cedar House
   owner state.

Direct Immich upload uses a separate user-issued Immich upload credential.
Cimmich never returns that credential or proxies the media bytes. A hosted
client may disclose anything it retrieves or receives; its operator accepts
that risk.

## Integrity and provenance

- `manifest.csv` binds each admitted asset to its filename, dimensions,
  SHA-256, scene and intended evidence role.
- `prompts.md` records the durable generation intent.
- `qa/space-trip-contact-sheet-v1.jpg` is a derived review surface and is not a
  seventh demo asset.
- The generation-only composition and identity references are deliberately not
  part of this distributable extension. Maya's fictional identity belongs to
  the separately licensed Cedar House base.

Keep `LICENSE.md`, `NOTICE.md`, `ATTRIBUTION.md`, `manifest.csv` and
`provenance/README.md` with every copy or video-source bundle.

This pack demonstrates product workflow. It is not a face-matching accuracy,
fairness or real-person biometric benchmark.
