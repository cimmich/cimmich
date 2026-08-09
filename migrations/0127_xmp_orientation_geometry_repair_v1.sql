BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_xmp_sidecar_face_import_v3', 'trusted_import',
    'cimmich-xmp-sidecar-face-import', 'v3', now(), now(),
    encode(digest('cimmich.xmp-sidecar-face-import.v3', 'sha256'), 'hex'),
    'sensitive-biometric'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE xmp_sidecar_import_run
    ALTER COLUMN producer_receipt_id SET DEFAULT
        'receipt_cimmich_xmp_sidecar_face_import_v3';
ALTER TABLE xmp_sidecar_import_item
    ALTER COLUMN producer_receipt_id SET DEFAULT
        'receipt_cimmich_xmp_sidecar_face_import_v3';
ALTER TABLE xmp_sidecar_face_evidence
    ALTER COLUMN producer_receipt_id SET DEFAULT
        'receipt_cimmich_xmp_sidecar_face_import_v3';
ALTER TABLE xmp_sidecar_face_source
    ALTER COLUMN producer_receipt_id SET DEFAULT
        'receipt_cimmich_xmp_sidecar_face_import_v3';

ALTER TABLE xmp_sidecar_face_evidence
    ADD COLUMN source_box_x numeric,
    ADD COLUMN source_box_y numeric,
    ADD COLUMN source_box_w numeric,
    ADD COLUMN source_box_h numeric,
    ADD COLUMN exif_orientation smallint,
    ADD COLUMN source_pixel_width integer,
    ADD COLUMN source_pixel_height integer,
    ADD COLUMN coordinate_transform text;

ALTER TABLE xmp_sidecar_face_evidence
    ADD CONSTRAINT xmp_sidecar_face_evidence_source_box_check CHECK (
      (source_box_x IS NULL AND source_box_y IS NULL
        AND source_box_w IS NULL AND source_box_h IS NULL)
      OR
      (source_box_x BETWEEN 0 AND 1 AND source_box_y BETWEEN 0 AND 1
        AND source_box_w > 0 AND source_box_w <= 1
        AND source_box_h > 0 AND source_box_h <= 1
        AND source_box_x + source_box_w <= 1.000001
        AND source_box_y + source_box_h <= 1.000001)
    ),
    ADD CONSTRAINT xmp_sidecar_face_evidence_orientation_check CHECK (
      exif_orientation IS NULL OR exif_orientation BETWEEN 1 AND 8
    ),
    ADD CONSTRAINT xmp_sidecar_face_evidence_source_dimensions_check CHECK (
      (source_pixel_width IS NULL AND source_pixel_height IS NULL)
      OR
      (source_pixel_width > 0 AND source_pixel_height > 0)
    ),
    ADD CONSTRAINT xmp_sidecar_face_evidence_transform_check CHECK (
      coordinate_transform IS NULL OR coordinate_transform IN (
        'identity', 'exif_transposed_top_left'
      )
    );

CREATE TABLE xmp_sidecar_geometry_correction (
    correction_id text PRIMARY KEY CHECK (
      correction_id ~ '^xmp_geometry_correction_[0-9a-f]{40}$'
    ),
    evidence_id text NOT NULL REFERENCES xmp_sidecar_face_evidence(evidence_id)
      ON DELETE CASCADE,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    old_box_x numeric NOT NULL,
    old_box_y numeric NOT NULL,
    old_box_w numeric NOT NULL,
    old_box_h numeric NOT NULL,
    new_box_x numeric NOT NULL,
    new_box_y numeric NOT NULL,
    new_box_w numeric NOT NULL,
    new_box_h numeric NOT NULL,
    exif_orientation smallint NOT NULL CHECK (exif_orientation BETWEEN 2 AND 8),
    recognition_state text NOT NULL DEFAULT 'pending' CHECK (
      recognition_state IN ('pending','recognized','abstained')
    ),
    corrected_at timestamptz NOT NULL DEFAULT now(),
    producer_receipt_id text NOT NULL DEFAULT
      'receipt_cimmich_xmp_sidecar_face_import_v3'
      REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    UNIQUE (evidence_id, old_box_x, old_box_y, old_box_w, old_box_h,
      new_box_x, new_box_y, new_box_w, new_box_h),
    CHECK (old_box_x BETWEEN 0 AND 1 AND old_box_y BETWEEN 0 AND 1
      AND old_box_w > 0 AND old_box_h > 0
      AND old_box_x + old_box_w <= 1.000001
      AND old_box_y + old_box_h <= 1.000001),
    CHECK (new_box_x BETWEEN 0 AND 1 AND new_box_y BETWEEN 0 AND 1
      AND new_box_w > 0 AND new_box_h > 0
      AND new_box_x + new_box_w <= 1.000001
      AND new_box_y + new_box_h <= 1.000001)
);

CREATE INDEX xmp_sidecar_geometry_correction_pending
    ON xmp_sidecar_geometry_correction(recognition_state, corrected_at, face_id);

COMMIT;
