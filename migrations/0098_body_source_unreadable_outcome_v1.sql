BEGIN;

ALTER TABLE body_detection_result
    DROP CONSTRAINT body_detection_result_outcome_check,
    DROP CONSTRAINT body_detection_result_check;

ALTER TABLE body_detection_result
    ADD CONSTRAINT body_detection_result_outcome_check
      CHECK (outcome IN ('bodies_detected', 'no_body', 'source_unreadable')),
    ADD CONSTRAINT body_detection_result_check CHECK (
        (outcome IN ('no_body', 'source_unreadable') AND body_count = 0)
        OR (outcome = 'bodies_detected' AND body_count > 0)
    );

COMMIT;
