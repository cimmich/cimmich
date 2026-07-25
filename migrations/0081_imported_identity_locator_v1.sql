BEGIN;

CREATE TABLE imported_identity_locator (
  locator_id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
  intended_tag_type text NOT NULL CHECK (intended_tag_type IN ('body', 'head')),
  geometry_role text NOT NULL CHECK (geometry_role IN ('head_locator')),
  box_x numeric NOT NULL CHECK (box_x >= 0 AND box_x <= 1),
  box_y numeric NOT NULL CHECK (box_y >= 0 AND box_y <= 1),
  box_w numeric NOT NULL CHECK (box_w > 0 AND box_w <= 1),
  box_h numeric NOT NULL CHECK (box_h > 0 AND box_h <= 1),
  source_instance_suffix text,
  source_kind text NOT NULL,
  state text NOT NULL CHECK (state IN ('unresolved', 'resolved', 'ignored')),
  producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
  privacy_class text NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (box_x + box_w <= 1.000001 AND box_y + box_h <= 1.000001)
);

CREATE UNIQUE INDEX imported_identity_locator_source_geometry
  ON imported_identity_locator (
    person_id, asset_id, intended_tag_type, geometry_role,
    box_x, box_y, box_w, box_h
  );

CREATE INDEX imported_identity_locator_asset_unresolved
  ON imported_identity_locator (asset_id, person_id)
  WHERE state = 'unresolved';

COMMENT ON TABLE imported_identity_locator
IS 'Spatial source metadata retained for owner resolution when it is not safe to claim a Face, Head, or Body association automatically.';

COMMENT ON COLUMN imported_identity_locator.geometry_role
IS 'What the stored source box localises. A head_locator may support resolving an intended Body tag without pretending the box is itself a Body.';

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_imported_identity_locator_v1', 'system',
  'cimmich-imported-identity-locator', 'v1', now(), now(),
  encode(digest('cimmich.imported-identity-locator.v1', 'sha256'), 'hex'),
  'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
