BEGIN;

CREATE INDEX media_pipeline_run_detection_job_lookup
ON media_pipeline_run (detection_job_id)
WHERE detection_job_id IS NOT NULL;

COMMIT;
