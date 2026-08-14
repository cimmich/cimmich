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
  if (action !== "assign") return "Not a Pet";
  return species.speciesCorrected
    ? `Assigned Unknown Pet; corrected detector species ${species.detectedSpeciesKind} to ${species.assignedSpeciesKind}`
    : "Assigned Unknown Pet";
};

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
