BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_generated_asset_summary_v1', 'system',
    'cimmich.generated-asset-summary', 'v1', now(), now(),
    encode(digest('cimmich.generated-asset-summary.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE TABLE generated_asset_summary_analysis (
    summary_analysis_id text PRIMARY KEY CHECK (
        summary_analysis_id ~ '^summaryanalysis_[0-9a-f]{32}$'
    ),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    asset_input_revision text NOT NULL CHECK (
        asset_input_revision ~ '^[0-9a-f]{64}$'
    ),
    tier text NOT NULL CHECK (tier IN ('smart','enhanced')),
    visual_facts jsonb NOT NULL CHECK (jsonb_typeof(visual_facts) = 'object'),
    source_content_digest text NOT NULL CHECK (
        source_content_digest ~ '^[0-9a-f]{64}$'
    ),
    provider_id text NOT NULL CHECK (
        provider_id = btrim(provider_id) AND length(provider_id) BETWEEN 1 AND 160
    ),
    model_name text NOT NULL CHECK (
        model_name = btrim(model_name) AND length(model_name) BETWEEN 1 AND 240
    ),
    model_digest text NOT NULL CHECK (
        model_digest = btrim(model_digest) AND length(model_digest) BETWEEN 1 AND 240
    ),
    config_digest text NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
    proposal_digest text NOT NULL CHECK (proposal_digest ~ '^[0-9a-f]{64}$'),
    provenance text NOT NULL CHECK (provenance = 'local_model'),
    state text NOT NULL CHECK (state IN ('current','superseded')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX generated_asset_summary_one_current_tier
    ON generated_asset_summary_analysis(asset_id, tier)
    WHERE state = 'current';
CREATE INDEX generated_asset_summary_asset_history
    ON generated_asset_summary_analysis(asset_id, tier, created_at DESC);

CREATE FUNCTION enforce_generated_asset_summary_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM asset
        JOIN immich_asset_projection projection
          ON projection.cimmich_asset_id = asset.asset_id
          AND projection.state = 'active'
        WHERE asset.asset_id = NEW.asset_id
          AND asset.state = 'active'
          AND projection.input_revision = NEW.asset_input_revision
    ) THEN
        RAISE EXCEPTION 'GENERATED_ASSET_SUMMARY_REVISION_STALE_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER generated_asset_summary_scope
BEFORE INSERT OR UPDATE OF asset_id, asset_input_revision
ON generated_asset_summary_analysis
FOR EACH ROW EXECUTE FUNCTION enforce_generated_asset_summary_scope();

CREATE VIEW current_generated_asset_summary_analysis AS
SELECT summary_analysis_id, asset_id, asset_input_revision, tier, visual_facts,
  source_content_digest, provider_id, model_name, model_digest, config_digest,
  proposal_digest, provenance, created_at
FROM generated_asset_summary_analysis
WHERE state = 'current';

COMMENT ON TABLE generated_asset_summary_analysis IS
  'Revision-bound Smart and Enhanced visual facts. Display prose is compiled from these facts plus current owner-approved entity labels; it is not stored here.';

UPDATE cimmich_visibility_projection_surface
SET producer_receipt_id = 'receipt_cimmich_generated_asset_summary_v1',
    coverage_state = 'enforced', reason_code = NULL, updated_at = now()
WHERE surface_key = 'asset_evidence';

COMMIT;
