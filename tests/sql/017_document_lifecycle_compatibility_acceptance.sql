BEGIN;

DO $$
DECLARE
  v_constraint_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM producer_receipt
    WHERE producer_receipt_id = 'receipt_cimmich_document_lifecycle_compatibility_v1'
  ) THEN
    RAISE EXCEPTION 'Document lifecycle/compatibility receipt is missing';
  END IF;

  SELECT count(*)::int INTO v_constraint_count
  FROM pg_constraint
  WHERE conrelid IN (
    'cimmich_document_legacy_pet_command'::regclass,
    'cimmich_document_legacy_pet_adoption'::regclass,
    'cimmich_document_purge_receipt'::regclass,
    'cimmich_document_digest_repair_receipt'::regclass
  ) AND contype IN ('c','f','p','u');
  IF v_constraint_count < 29 THEN
    RAISE EXCEPTION 'Document lifecycle constraint surface is unexpectedly small: %',
      v_constraint_count;
  END IF;

  BEGIN
    INSERT INTO cimmich_document_purge_receipt (
      purge_receipt_id, document_token_digest, deleted_counts, content_deleted
    ) VALUES (
      'document_purge_00000000000000000000000000000001',
      'not-a-digest', '{}'::jsonb, false
    );
    RAISE EXCEPTION 'Invalid purge digest was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO cimmich_document_digest_repair_receipt (
      repair_receipt_id, prior_token_digest,
      repaired_document_count, repaired_blob_count
    ) VALUES (
      'document_digest_repair_00000000000000000000000000000001',
      repeat('0', 64), 0, 1
    );
    RAISE EXCEPTION 'Zero-document digest repair receipt was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

COMMIT;
