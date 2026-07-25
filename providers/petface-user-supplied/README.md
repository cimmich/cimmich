# Community PetFace matching

This weight-free adapter runs operator-supplied PetFace ArcFace checkpoints for
cat and dog faces. Cimmich does not bundle or download the checkpoints.

Publisher code and setup:
<https://github.com/mapooon/PetFace>

Publisher checkpoint folder:
<https://drive.google.com/drive/folders/1XZHxlvRUZSQeFrztz0GaKgyVUSCh1lT6>

> [!IMPORTANT]
> The PetFace publisher states that its dataset, repository code and pretrained
> models are for **non-commercial research only**. This Cimmich adapter does not
> redistribute those materials or grant additional rights. Review the upstream
> terms before downloading or using a checkpoint; do not configure PetFace for
> commercial use without separate permission from its rights holders.

Install the adapter requirements, download `arcface/cat.pt` and
`arcface/dog.pt` from the publisher, then run:

```sh
python provider.py \
  --cat-weight /private/models/petface/arcface/cat.pt \
  --dog-weight /private/models/petface/arcface/dog.pt \
  --input /private/evaluation/pet-faces.json \
  --output /private/evaluation/petface-embeddings.json
```

The input format is the same as the MiewID community adapter, with an
additional `species` field of `cat` or `dog`. PetFace is a face lane, so use
the tight Pet head geometry and start with `cropContext: 1.35`. The publisher's
five-landmark alignment can be added when a compatible Pet landmark detector is
configured; Cimmich must not treat unaligned scores as equivalent to aligned
scores.
