const MANAGED_DEPLOYMENT_REPOSITORIES = new Set([
  "cimmich-archive-api",
  "cimmich-archive-ui",
  "cimmich-background-lab-api",
  "cimmich-local-api",
  "cimmich-local-ui",
  "cimmich-public-demo-api",
  "cimmich-public-demo-ui",
  "cimmich-release-api",
  "cimmich-release-ui",
]);

const EPHEMERAL_REPOSITORY_PATTERNS = [
  /^cimmich-service-acceptance$/,
  /^cimmich-companion-acceptance(?:-|$)/,
  /^cimmich_beta_install_proof-(?:api|ui)$/,
  /^cimmich-(?:fresh-install-a-plus|onboarding-audit|provider-acceptance)-(?:api|ui)$/,
  /^cimmich-real-library-final-audit-\d+-api$/,
];

const requiredText = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new TypeError(`${label} is required`);
  }
  return normalized;
};

const normalizedImage = (image) => {
  const repository = requiredText(image?.repository, "image repository");
  const tag = requiredText(image?.tag, "image tag");
  const id = requiredText(image?.id, "image id");
  const createdAt = new Date(image?.createdAt);
  if (Number.isNaN(createdAt.valueOf())) {
    throw new TypeError("image createdAt must be a valid date");
  }
  const sizeBytes = Number(image?.sizeBytes || 0);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new TypeError("image sizeBytes must be a non-negative safe integer");
  }
  return {
    createdAt: createdAt.toISOString(),
    id,
    reference: `${repository}:${tag}`,
    repository,
    sizeBytes,
    tag,
  };
};

const isEphemeralRepository = (repository) =>
  EPHEMERAL_REPOSITORY_PATTERNS.some((pattern) => pattern.test(repository));

const sumUniqueImageBytes = (rows) => {
  const sizes = new Map();
  for (const row of rows) {
    sizes.set(row.id, Math.max(sizes.get(row.id) || 0, row.sizeBytes));
  }
  return [...sizes.values()].reduce((total, size) => total + size, 0);
};

export const planCimmichImageRetention = ({
  activeImageIds = [],
  containerImageIds = [],
  images,
  rollbackImagesPerRepository = 2,
}) => {
  if (!Array.isArray(images)) {
    throw new TypeError("images must be an array");
  }
  if (
    !Number.isSafeInteger(rollbackImagesPerRepository) ||
    rollbackImagesPerRepository < 0 ||
    rollbackImagesPerRepository > 20
  ) {
    throw new TypeError(
      "rollbackImagesPerRepository must be an integer between 0 and 20",
    );
  }

  const normalized = images
    .map(normalizedImage)
    .filter(({ repository }) => repository.startsWith("cimmich"))
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        left.reference.localeCompare(right.reference),
    );
  const referenced = new Set(containerImageIds.map(String));
  const active = new Set(activeImageIds.map(String));
  const rollbackIds = new Set();
  const managedByRepository = new Map();

  for (const image of normalized) {
    if (!MANAGED_DEPLOYMENT_REPOSITORIES.has(image.repository)) {
      continue;
    }
    const rows = managedByRepository.get(image.repository) || [];
    rows.push(image);
    managedByRepository.set(image.repository, rows);
  }

  for (const rows of managedByRepository.values()) {
    const eligibleIds = [];
    for (const row of rows) {
      if (
        !referenced.has(row.id) &&
        !eligibleIds.includes(row.id) &&
        eligibleIds.length < rollbackImagesPerRepository
      ) {
        eligibleIds.push(row.id);
      }
    }
    eligibleIds.forEach((id) => rollbackIds.add(id));
  }

  const candidates = [];
  const retained = [];
  for (const image of normalized) {
    if (referenced.has(image.id)) {
      retained.push({
        ...image,
        reason: active.has(image.id)
          ? "running_container"
          : "stopped_container",
      });
      continue;
    }
    if (rollbackIds.has(image.id)) {
      retained.push({ ...image, reason: "rollback_retention" });
      continue;
    }
    if (isEphemeralRepository(image.repository)) {
      candidates.push({ ...image, reason: "disposable_build" });
      continue;
    }
    if (MANAGED_DEPLOYMENT_REPOSITORIES.has(image.repository)) {
      candidates.push({ ...image, reason: "retention_expired" });
      continue;
    }
    retained.push({ ...image, reason: "unclassified_fail_closed" });
  }

  const deletableIds = new Set(
    candidates
      .map(({ id }) => id)
      .filter((id) => !retained.some((row) => row.id === id)),
  );

  return {
    candidates,
    contractVersion: "cimmich.docker-image-retention.v1",
    policy: {
      containerProtection: "all_running_and_stopped",
      rollbackImagesPerRepository,
      unknownRepositoryAction: "retain",
    },
    retained,
    summary: {
      candidateReferences: candidates.length,
      cimmichReferences: normalized.length,
      deletableImageIds: deletableIds.size,
      retainedReferences: retained.length,
      unclassifiedReferences: retained.filter(
        ({ reason }) => reason === "unclassified_fail_closed",
      ).length,
      virtualCandidateBytes: sumUniqueImageBytes(
        candidates.filter(({ id }) => deletableIds.has(id)),
      ),
    },
  };
};

export const cimmichImageRetentionPolicy = Object.freeze({
  ephemeralRepositoryPatterns: EPHEMERAL_REPOSITORY_PATTERNS.map(
    (pattern) => pattern.source,
  ),
  managedDeploymentRepositories: [...MANAGED_DEPLOYMENT_REPOSITORIES].sort(),
});

export const dockerImageRetentionPlanDigest = (plan) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        candidates: plan.candidates.map(({ id, reason, reference }) => ({
          id,
          reason,
          reference,
        })),
        policy: plan.policy,
        retained: plan.retained.map(({ id, reason, reference }) => ({
          id,
          reason,
          reference,
        })),
      }),
    )
    .digest("hex");
import { createHash } from "node:crypto";
