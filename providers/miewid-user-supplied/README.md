# Community MiewID Pet matching

This weight-free adapter runs the community-used MiewID-msv3 animal
re-identification model locally. Cimmich does not bundle model files. Each
operator chooses and downloads their own model from its publisher.

MiewID produces a 2,152-dimensional embedding for an animal crop. Cimmich can
compare incoming Pet embeddings against several confirmed photos of each known
Pet. A nearest neighbour is evidence, not an identity decision: a useful
installation must retain a minimum score, a top-two margin and an Unknown Pet
outcome.

## Install

Create a dedicated environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

Download the publisher's current snapshot to a private model directory:

```sh
python -c 'from huggingface_hub import snapshot_download; snapshot_download(
    repo_id="conservationxlabs/miewid-msv3",
    local_dir="/private/models/miewid-msv3"
)'
```

Model page:
<https://huggingface.co/conservationxlabs/miewid-msv3>

> [!IMPORTANT]
> The publisher's current model card does not declare a model licence. This
> Cimmich adapter does not redistribute the model or grant rights to use it.
> Verify the publisher's current terms or obtain permission before downloading
> or deploying the checkpoint, especially for commercial use.

The adapter forces the generic timm backbone constructor offline because the
complete MiewID checkpoint is already present. After the snapshot has been
downloaded, embedding does not require network access.

## Private evaluation

Prepare a JSON file containing confirmed examples. Geometry is normalized
`x/y/w/h`; omit `box` to use the complete image.

```json
{
  "records": [
    {
      "id": "pet-a-01",
      "identity": "pet-a",
      "image": "/private/photos/pet-a-01.jpg",
      "box": {"x": 0.2, "y": 0.1, "w": 0.5, "h": 0.7},
      "cropContext": 4
    },
    {
      "id": "pet-a-02",
      "identity": "pet-a",
      "image": "/private/photos/pet-a-02.jpg"
    }
  ]
}
```

Generate embeddings and a leave-one-out report:

```sh
python provider.py \
  --model /private/models/miewid-msv3 \
  --input /private/evaluation/records.json \
  --output /private/evaluation/embeddings.json

python evaluate.py \
  --embeddings /private/evaluation/embeddings.json \
  --output /private/evaluation/report.json
```

Start with `--crop-context 4`. Use a larger value for a tiny face or head box
when coat pattern and body shape are useful. Calibrate cats and dogs
independently, and do not infer a production threshold from a two-Pet sample.
