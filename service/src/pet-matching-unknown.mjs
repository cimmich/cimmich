const supportedSpecies = new Set([
  "bird",
  "cat",
  "dog",
  "fish",
  "other",
  "rabbit",
  "reptile",
  "small_mammal",
]);

export const cleanUnknownAssignmentSpecies = (value) => {
  const normalized = String(value || "").trim();
  if (!supportedSpecies.has(normalized)) {
    throw Object.assign(
      new Error("speciesKind must be a supported Pet species"),
      {
        code: "PET_MATCH_SPECIES_INVALID",
        details: { field: "speciesKind" },
        statusCode: 400,
      },
    );
  }
  return normalized;
};

export const cleanUnknownReviewState = (value) => {
  const state = String(value || "unknown").trim();
  if (!["ignored", "unknown"].includes(state)) {
    throw Object.assign(new Error("state must be unknown or ignored"), {
      code: "PET_MATCH_REVIEW_STATE_INVALID",
      statusCode: 400,
    });
  }
  return state;
};

export const classifyUnknownAssignmentSpecies = (
  detectedSpeciesKind,
  selectedSpeciesKind,
) => ({
  assignedSpeciesKind: selectedSpeciesKind || detectedSpeciesKind,
  detectedSpeciesKind,
  speciesCorrected:
    Boolean(selectedSpeciesKind) && selectedSpeciesKind !== detectedSpeciesKind,
});

export const unknownAssignmentDecisionNote = (action, species) => {
  if (action === "ignore") return "Ignored unknown Pet detection";
  if (action === "restore") return "Restored ignored Pet detection";
  if (action === "reject") return "False Pet match";
  return species.speciesCorrected
    ? `Assigned Unknown Pet; corrected detector species ${species.detectedSpeciesKind} to ${species.assignedSpeciesKind}`
    : "Assigned Unknown Pet";
};

export const unknownReviewDecision = (action) => ({
  decisionAction: {
    assign: "accept",
    ignore: "ignore",
    reject: "reject",
    restore: "restore",
  }[action],
  reasonCode: {
    assign: "unknown_pet_assigned",
    ignore: "unknown_pet_ignored",
    reject: "pet_match_false_match",
    restore: "unknown_pet_restored",
  }[action],
  state: { ignore: "ignored", reject: "rejected", restore: "unknown" }[action],
});

export const unknownAssignmentMetadata = (lane, observationId, species) => ({
  ...species,
  lane,
  observationId,
  ownerClassified: true,
});

export const unknownAssignmentEvidence = (observationId, species) => [
  {
    ...species,
    observationId,
    type: "owner_classified_unknown_pet",
  },
];

export const loadUnknownAssignmentTarget = async ({
  assetId,
  matchablePetStatuses,
  petId,
  species,
  tx,
}) => {
  const [pet] = await tx`
    SELECT person_id, display_name, species_kind
    FROM current_person
    WHERE person_id = ${petId}
      AND subject_kind = 'pet'
      AND status = ANY(${matchablePetStatuses})
  `;
  if (!pet) {
    throw Object.assign(new Error("Selected Pet not found"), {
      code: "PET_MATCH_PET_NOT_FOUND",
      statusCode: 404,
    });
  }
  if (pet.species_kind !== species.assignedSpeciesKind) {
    throw Object.assign(
      new Error("Selected Pet must use the owner-selected species"),
      { code: "PET_MATCH_SPECIES_CONFLICT", statusCode: 409 },
    );
  }
  const [asset] = await tx`
    SELECT asset_id FROM asset
    WHERE asset_id = ${assetId} AND state = 'active'
    FOR SHARE
  `;
  if (!asset) {
    throw Object.assign(
      new Error("One or more active Cimmich assets were not found"),
      {
        code: "PET_MATCH_ASSET_NOT_FOUND",
        details: { missingAssetIds: [assetId] },
        statusCode: 404,
      },
    );
  }
  return pet;
};
