BEGIN;

DO $$
DECLARE
  v_failed boolean := false;
BEGIN
  IF to_regclass('cimmich_document') IS NULL
     OR to_regclass('cimmich_document_link') IS NULL
     OR to_regclass('cimmich_document_command') IS NULL
     OR to_regclass('cimmich_document_operation') IS NULL
     OR to_regprocedure('cimmich_visibility_document_rank(text)') IS NULL THEN
    RAISE EXCEPTION 'Document V1 schema is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cimmich_visibility_projection_surface
    WHERE surface_key = 'documents' AND coverage_state = 'enforced'
      AND reason_code IS NULL
  ) THEN
    RAISE EXCEPTION 'Document visibility projection is not enforced';
  END IF;

  INSERT INTO person (
    person_id, display_name, status, created_by_receipt_id, subject_kind
  ) VALUES (
    'person_document_pet_fixture', 'Synthetic Pet', 'active',
    'receipt_service_fixture', 'pet'
  );

  INSERT INTO context_entity (
    entity_id, entity_kind, place_kind, display_name, date_precision, status
  ) VALUES (
    'place_00000000000000000000000000000047', 'place', 'unlocated',
    'Synthetic Place', 'unknown', 'active'
  );

  INSERT INTO decision (
    decision_id, subject_type, subject_id, action, actor_kind, actor_id,
    reason_code, note, producer_receipt_id, privacy_class
  ) VALUES (
    'decision_document_fixture', 'document',
    'document_00000000000000000000000000000047', 'create', 'user',
    'synthetic-document-test', 'document_manual', 'Create fixture',
    'receipt_cimmich_document_v1', 'private'
  );

  INSERT INTO cimmich_document (
    document_id, source_kind, storage_key, source_filename, mime_type,
    byte_size, content_sha256, display_title, document_kind, status,
    visibility_tier, created_by
  ) VALUES (
    'document_00000000000000000000000000000047', 'cimmich_file',
    'aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'synthetic-certificate.pdf', 'application/pdf', 128,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Synthetic certificate', 'certificate', 'active', 'standard',
    'synthetic-document-test'
  );

  INSERT INTO cimmich_document (
    document_id, source_kind, storage_key, source_filename, mime_type,
    byte_size, content_sha256, display_title, document_kind, status,
    visibility_tier, created_by, supersedes_document_id
  ) VALUES (
    'document_00000000000000000000000000000048', 'cimmich_file',
    'bb/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'synthetic-certificate-renewal.pdf', 'application/pdf', 128,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'Synthetic certificate renewal', 'certificate', 'active', 'standard',
    'synthetic-document-test',
    'document_00000000000000000000000000000047'
  );
  IF (SELECT supersedes_document_id FROM cimmich_document
      WHERE document_id = 'document_00000000000000000000000000000048')
      <> 'document_00000000000000000000000000000047' THEN
    RAISE EXCEPTION 'Document version predecessor was not preserved';
  END IF;

  v_failed := false;
  BEGIN
    INSERT INTO cimmich_document (
      document_id, source_kind, storage_key, source_filename, mime_type,
      byte_size, content_sha256, display_title, document_kind, status,
      visibility_tier, created_by, supersedes_document_id
    ) VALUES (
      'document_00000000000000000000000000000049', 'cimmich_file',
      'cc/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'synthetic-certificate-branch.pdf', 'application/pdf', 128,
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'Synthetic certificate branch', 'certificate', 'active', 'standard',
      'synthetic-document-test',
      'document_00000000000000000000000000000047'
    );
  EXCEPTION WHEN unique_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Document version branch guard failed open';
  END IF;

  INSERT INTO cimmich_document_link (
    link_id, document_id, subject_kind, subject_id, relation_kind,
    state, decision_id
  ) VALUES
    ('document_link_00000000000000000000000000000001',
      'document_00000000000000000000000000000047', 'person',
      'person_service_fixture', 'issued_to', 'current', 'decision_document_fixture'),
    ('document_link_00000000000000000000000000000002',
      'document_00000000000000000000000000000047', 'pet',
      'person_document_pet_fixture', 'about', 'current', 'decision_document_fixture'),
    ('document_link_00000000000000000000000000000003',
      'document_00000000000000000000000000000047', 'place',
      'place_00000000000000000000000000000047', 'applies_to', 'current',
      'decision_document_fixture');

  BEGIN
    INSERT INTO cimmich_document_link (
      link_id, document_id, subject_kind, subject_id, relation_kind,
      state, decision_id
    ) VALUES (
      'document_link_00000000000000000000000000000004',
      'document_00000000000000000000000000000047', 'person',
      'person_document_pet_fixture', 'about', 'current', 'decision_document_fixture'
    );
  EXCEPTION WHEN check_violation THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Person/Pet Document link isolation failed open';
  END IF;

  INSERT INTO cimmich_visibility_decision (
    decision_id, actor_id, principal_id, device_id, decision_kind,
    before_state, after_state, state
  ) VALUES (
    'visibility_decision_document_fixture', 'synthetic-document-test',
    'local-primary', 'synthetic-device', 'set', '[]'::jsonb, '[]'::jsonb,
    'active'
  );
  INSERT INTO cimmich_visibility_object (
    object_scope, object_id, visibility_tier, revision, decision_id
  ) VALUES (
    'document', 'document_00000000000000000000000000000047',
    'private', 1, 'visibility_decision_document_fixture'
  );
  IF cimmich_visibility_document_rank(
      'document_00000000000000000000000000000047'
    ) <> 2 THEN
    RAISE EXCEPTION 'Document visibility rank did not become Private';
  END IF;

  IF (SELECT count(*) FROM current_cimmich_document_link
      WHERE document_id = 'document_00000000000000000000000000000047') <> 3 THEN
    RAISE EXCEPTION 'Document current-link projection is incorrect';
  END IF;

  DELETE FROM cimmich_visibility_object
    WHERE object_scope = 'document'
      AND object_id = 'document_00000000000000000000000000000047';
  DELETE FROM cimmich_visibility_decision
    WHERE decision_id = 'visibility_decision_document_fixture';
  DELETE FROM cimmich_document_link
    WHERE document_id = 'document_00000000000000000000000000000047';
  DELETE FROM cimmich_document
    WHERE document_id = 'document_00000000000000000000000000000048';
  DELETE FROM cimmich_document
    WHERE document_id = 'document_00000000000000000000000000000047';
  DELETE FROM decision WHERE decision_id = 'decision_document_fixture';
  DELETE FROM context_entity
    WHERE entity_id = 'place_00000000000000000000000000000047';
  DELETE FROM person WHERE person_id = 'person_document_pet_fixture';
END;
$$;

COMMIT;
