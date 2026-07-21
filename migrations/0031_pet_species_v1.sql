BEGIN;

ALTER TABLE person
    ADD COLUMN species_kind text,
    ADD COLUMN species_label text;

ALTER TABLE person
    ADD CONSTRAINT person_species_kind_enum CHECK (
        species_kind IS NULL OR species_kind IN (
            'dog','cat','bird','rabbit','fish','reptile','small_mammal','other'
        )
    ),
    ADD CONSTRAINT person_species_pet_only CHECK (
        subject_kind = 'pet' OR (species_kind IS NULL AND species_label IS NULL)
    ),
    ADD CONSTRAINT person_species_label_other_only CHECK (
        species_label IS NULL OR (
            species_kind = 'other'
            AND length(btrim(species_label)) BETWEEN 1 AND 80
        )
    );

CREATE OR REPLACE VIEW current_person AS
SELECT p.person_id, p.display_name, p.status, p.current_revision,
       COALESCE(array_agg(pa.label ORDER BY pa.created_at)
         FILTER (WHERE pa.state = 'active'), ARRAY[]::text[]) AS aliases,
       p.subject_kind, p.merged_into_person_id, p.description,
       p.cover_asset_id, p.cover_crop, p.species_kind, p.species_label
FROM person p
LEFT JOIN person_alias pa ON pa.person_id = p.person_id
WHERE p.status IN ('active','hidden')
GROUP BY p.person_id;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_pet_species_v1', 'system',
    'cimmich-pet-species', 'v1', now(), now(),
    encode(digest('cimmich-pet-species-v1', 'sha256'), 'hex'), 'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

COMMIT;
