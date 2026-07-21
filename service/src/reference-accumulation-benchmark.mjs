import { createHash } from "node:crypto";
import { curatePrimeSet } from "./prime-curator.mjs";

const stableOrder = (face, seed) =>
  createHash("sha256")
    .update(`${seed}\u001f${face.personId}\u001f${face.faceId}`)
    .digest("hex");

export const buildReferenceAccumulationGalleries = (
  faces,
  {
    budgets = [1, 2, 3, 5, 10, "all"],
    primeOptions = {},
    seed = "cimmich-reference-accumulation-v1",
  } = {},
) => {
  const byPerson = Map.groupBy(faces, (face) => face.personId);
  const orderedByPerson = new Map(
    [...byPerson.entries()].map(([personId, rows]) => [
      personId,
      [...rows].sort(
        (left, right) =>
          stableOrder(left, seed).localeCompare(stableOrder(right, seed)) ||
          left.faceId.localeCompare(right.faceId),
      ),
    ]),
  );
  return budgets.map((budget) => {
    const standardFaceIds = [];
    const cimmichFaceIds = [];
    let acceptedFaces = 0;
    for (const [personId, ordered] of [...orderedByPerson.entries()].sort(
      ([left], [right]) => left.localeCompare(right),
    )) {
      const available =
        budget === "all"
          ? ordered
          : ordered.slice(0, Math.max(0, Number(budget)));
      acceptedFaces += available.length;
      standardFaceIds.push(...available.map((face) => face.faceId));
      if (available.length === 0) continue;
      const curation = curatePrimeSet(available, primeOptions);
      cimmichFaceIds.push(...curation.selected.map((face) => face.faceId));
    }
    return {
      acceptedFaces,
      budget,
      cimmichFaceIds: cimmichFaceIds.sort(),
      standardFaceIds: standardFaceIds.sort(),
    };
  });
};

export const buildProviderPrimePolicyGalleries = (
  faces,
  { policies = [], seed = "cimmich-provider-prime-calibration-v1" } = {},
) =>
  policies.map((policy) => {
    const [gallery] = buildReferenceAccumulationGalleries(faces, {
      budgets: ["all"],
      primeOptions: policy.primeOptions || {},
      seed,
    });
    return {
      faceIds: gallery.cimmichFaceIds,
      policyId: String(policy.policyId),
      primeOptions: policy.primeOptions || {},
      referenceCount: gallery.cimmichFaceIds.length,
    };
  });
