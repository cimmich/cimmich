# Cimmich Body Pose V1

`cimmich.body-pose.v1` is an additive, read-only BodyObservation evidence
projection. It allows a client to draw the pose skeleton produced by the body
model without reconstructing joints from a bounding box.

## Boundary

- Pose is stored only in Cimmich's separate local database.
- It does not mutate source media, Immich rows or Immich metadata.
- Pose belongs to one BodyObservation and grants no Person, Face, identity,
  matching, training or acceptance authority.
- The asset-evidence route remains visibility-filtered before its response is
  returned.
- A missing or invalid pose is explicit. Clients must not synthesize a
  skeleton from body or head boxes.

## Projection

Each item in `GET /v1/assets/evidence?sourceAssetId=...` now includes `pose`.

An available pose is:

```json
{
  "schemaVersion": "cimmich.body-pose.v1",
  "state": "available",
  "coordinateSpace": "normalized_image",
  "jointSchema": "coco17",
  "topologyId": "coco17.v1",
  "keypoints": [
    {
      "index": 0,
      "joint": "nose",
      "position": { "x": 0.5, "y": 0.25 },
      "confidence": 0.98
    }
  ],
  "skeleton": [[0, 1]],
  "provenance": {
    "provider": "provider-id",
    "modelFamily": "model-family",
    "modelName": "model-name",
    "modelVersion": "model-version",
    "modelDigest": "sha256:...",
    "sourceSchemaVersion": "producer.schema.v1"
  }
}
```

The real response always contains all 17 stable COCO joint entries and the
complete `coco17.v1` topology. When the provider emitted confidence but no
usable coordinate for one joint, `position` is `null`; its confidence remains
present. The service does not invent a confidence threshold.

Typed absence is:

```json
{
  "schemaVersion": "cimmich.body-pose.v1",
  "state": "unavailable",
  "reasonCode": "POSE_NOT_RETAINED"
}
```

`POSE_INVALIDATED` and `POSE_PROJECTION_INVALID` are the other V1 absence
reasons.

## Database contract

Schema 42 adds a one-to-one `body_pose_evidence` row keyed by `body_id`. A
database validator requires exact COCO-17 order, normalized coordinates,
bounded confidence, paired nullable coordinates, stable topology, provider and
model provenance, and SHA-256 model/source-artifact digests. The table has no
Person, Face or identity foreign key.
