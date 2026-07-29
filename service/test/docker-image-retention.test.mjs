import assert from "node:assert/strict";
import test from "node:test";
import {
  dockerImageRetentionPlanDigest,
  planCimmichImageRetention,
} from "../src/docker-image-retention.mjs";

const image = (repository, tag, id, hour, sizeBytes = 100) => ({
  createdAt: `2026-07-26T${String(hour).padStart(2, "0")}:00:00.000Z`,
  id,
  repository,
  sizeBytes,
  tag,
});

test("retention protects all container images and two deployment rollbacks", () => {
  const plan = planCimmichImageRetention({
    activeImageIds: ["sha256:active"],
    containerImageIds: ["sha256:active", "sha256:stopped"],
    images: [
      image("cimmich-archive-ui", "current", "sha256:active", 8),
      image("cimmich-archive-ui", "stopped", "sha256:stopped", 7),
      image("cimmich-archive-ui", "rollback-2", "sha256:r2", 6),
      image("cimmich-archive-ui", "rollback-1", "sha256:r1", 5),
      image("cimmich-archive-ui", "expired", "sha256:old", 4),
    ],
  });

  assert.deepEqual(
    plan.retained.map(({ reason, tag }) => [tag, reason]),
    [
      ["current", "running_container"],
      ["stopped", "stopped_container"],
      ["rollback-2", "rollback_retention"],
      ["rollback-1", "rollback_retention"],
    ],
  );
  assert.deepEqual(
    plan.candidates.map(({ reason, tag }) => [tag, reason]),
    [["expired", "retention_expired"]],
  );
});

test("disposable images are candidates while unknown repositories fail closed", () => {
  const plan = planCimmichImageRetention({
    images: [
      image("cimmich-service-acceptance", "123", "sha256:test", 3),
      image(
        "cimmich-companion-acceptance-123-api",
        "current-source",
        "sha256:companion",
        2,
      ),
      image("cimmich-experimental-model", "only", "sha256:unknown", 1),
      image("unrelated-product", "latest", "sha256:other", 0),
    ],
  });

  assert.equal(plan.summary.cimmichReferences, 3);
  assert.deepEqual(
    plan.candidates.map(({ reason }) => reason),
    ["disposable_build", "disposable_build"],
  );
  assert.deepEqual(
    plan.retained.map(({ reason }) => reason),
    ["unclassified_fail_closed"],
  );
});

test("a shared image ID retained anywhere is not counted as physically deletable", () => {
  const plan = planCimmichImageRetention({
    activeImageIds: ["sha256:shared"],
    containerImageIds: ["sha256:shared"],
    images: [
      image(
        "cimmich-companion-acceptance-123-api",
        "current-source",
        "sha256:shared",
        2,
        900,
      ),
      image("cimmich-archive-api", "current", "sha256:shared", 1, 900),
    ],
  });

  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.summary.deletableImageIds, 0);
  assert.equal(plan.summary.virtualCandidateBytes, 0);
});

test("review digest binds candidates, retained protections and policy", () => {
  const plan = planCimmichImageRetention({
    images: [
      image("cimmich-archive-api", "new", "sha256:new", 2),
      image("cimmich-archive-api", "old", "sha256:old", 1),
    ],
    rollbackImagesPerRepository: 0,
  });
  const digest = dockerImageRetentionPlanDigest(plan);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, dockerImageRetentionPlanDigest(plan));
  assert.notEqual(
    digest,
    dockerImageRetentionPlanDigest({
      ...plan,
      candidates: plan.candidates.slice(1),
    }),
  );
});
