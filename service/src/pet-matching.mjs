import { createHash, randomUUID } from "node:crypto";

export const petMatchingSchemaVersion = "cimmich.pet-matching.v1";

const receiptId = "receipt_cimmich_pet_matching_v1";
const lanes = new Set(["face", "whole_animal"]);
const speciesKinds = new Set([
  "bird",
  "cat",
  "dog",
  "fish",
  "other",
  "rabbit",
  "reptile",
  "small_mammal",
]);
const sha256Pattern = /^[0-9a-f]{64}$/;
const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,191}$/;

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor of 1 to 120 characters is required",
      400,
      "PET_MATCH_ACTOR_REQUIRED",
    );
  }
  return actor;
};

const cleanSafeId = (value, field, maximum = 192) => {
  const id = String(value || "").trim();
  if (
    id.length > maximum ||
    !safeIdPattern.test(id) ||
    id.length < 8
  ) {
    throw typedError(
      `${field} must be a stable safe ID of 8 to ${maximum} characters`,
      400,
      "PET_MATCH_ID_INVALID",
      { field },
    );
  }
  return id;
};

const cleanProviderValue = (value, field, maximum = 160) => {
  const normalized = String(value || "").trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    throw typedError(
      `provider.${field} is invalid`,
      400,
      "PET_MATCH_PROVIDER_INVALID",
      { field },
    );
  }
  return normalized;
};

const cleanDigest = (value, field) => {
  const normalized = String(value || "").trim();
  if (!sha256Pattern.test(normalized)) {
    throw typedError(
      `${field} must be a lowercase SHA-256 digest`,
      400,
      "PET_MATCH_DIGEST_INVALID",
      { field },
    );
  }
  return normalized;
};

const cleanFiniteNumber = (value, field, minimum, maximum) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw typedError(
      `${field} must be between ${minimum} and ${maximum}`,
      400,
      "PET_MATCH_NUMBER_INVALID",
      { field },
    );
  }
  return Object.is(value, -0) ? 0 : value;
};

const cleanBox = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "box must be a normalized region",
      400,
      "PET_MATCH_BOX_INVALID",
    );
  }
  const box = {
    h: cleanFiniteNumber(value.h, "box.h", 0, 1),
    w: cleanFiniteNumber(value.w, "box.w", 0, 1),
    x: cleanFiniteNumber(value.x, "box.x", 0, 1),
    y: cleanFiniteNumber(value.y, "box.y", 0, 1),
  };
  if (box.w <= 0 || box.h <= 0 || box.x + box.w > 1 || box.y + box.h > 1) {
    throw typedError(
      "box must have positive size and remain inside the image",
      400,
      "PET_MATCH_BOX_INVALID",
    );
  }
  return box;
};

export const validatePetMatchImport = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(
      "A Pet matching import packet is required",
      400,
      "PET_MATCH_PACKET_INVALID",
    );
  }
  if (value.schemaVersion !== petMatchingSchemaVersion) {
    throw typedError(
      `schemaVersion must be ${petMatchingSchemaVersion}`,
      400,
      "PET_MATCH_SCHEMA_UNSUPPORTED",
    );
  }
  const runId = cleanSafeId(value.runId, "runId");
  const providerInput = value.provider;
  if (!providerInput || typeof providerInput !== "object") {
    throw typedError(
      "provider metadata is required",
      400,
      "PET_MATCH_PROVIDER_INVALID",
    );
  }
  const lane = String(providerInput.lane || "").trim();
  if (!lanes.has(lane)) {
    throw typedError(
      "provider.lane must be face or whole_animal",
      400,
      "PET_MATCH_LANE_INVALID",
    );
  }
  const provider = {
    configDigest: cleanDigest(providerInput.configDigest, "provider.configDigest"),
    lane,
    modelFamily: cleanProviderValue(providerInput.modelFamily, "modelFamily"),
    modelVersion: cleanProviderValue(providerInput.modelVersion, "modelVersion"),
    providerId: cleanProviderValue(providerInput.providerId, "providerId"),
    speciesKind: String(providerInput.speciesKind || "").trim(),
    vectorSpaceId: cleanProviderValue(
      providerInput.vectorSpaceId,
      "vectorSpaceId",
      192,
    ),
  };
  if (!speciesKinds.has(provider.speciesKind)) {
    throw typedError(
      "provider.speciesKind is not supported",
      400,
      "PET_MATCH_SPECIES_INVALID",
    );
  }
  if (
    !Array.isArray(value.observations) ||
    value.observations.length < 1 ||
    value.observations.length > 500
  ) {
    throw typedError(
      "observations must contain 1 to 500 items",
      400,
      "PET_MATCH_OBSERVATIONS_INVALID",
    );
  }
  const observations = value.observations.map((item, observationIndex) => {
    const speciesKind = String(item?.speciesKind || "").trim();
    if (!speciesKinds.has(speciesKind)) {
      throw typedError(
        "speciesKind is not supported",
        400,
        "PET_MATCH_SPECIES_INVALID",
        { observationIndex },
      );
    }
    if (
      !Array.isArray(item?.candidates) ||
      item.candidates.length > 5
    ) {
      throw typedError(
        "candidates must contain no more than 5 ranked Pets",
        400,
        "PET_MATCH_CANDIDATES_INVALID",
        { observationIndex },
      );
    }
    const candidates = item.candidates.map((candidate, candidateIndex) => ({
      galleryCount: Math.trunc(
        cleanFiniteNumber(
          candidate?.galleryCount,
          "candidate.galleryCount",
          1,
          1_000_000,
        ),
      ),
      petId: cleanSafeId(candidate?.petId, "candidate.petId"),
      rank: candidateIndex + 1,
      score: cleanFiniteNumber(candidate?.score, "candidate.score", -1, 1),
    }));
    if (
      new Set(candidates.map((candidate) => candidate.petId)).size !==
      candidates.length
    ) {
      throw typedError(
        "Each observation candidate Pet must be unique",
        400,
        "PET_MATCH_CANDIDATES_INVALID",
        { observationIndex },
      );
    }
    return {
      assetId: cleanSafeId(item?.assetId, "assetId"),
      box: cleanBox(item?.box),
      candidates,
      detectionConfidence: cleanFiniteNumber(
        item?.detectionConfidence,
        "detectionConfidence",
        0,
        1,
      ),
      embeddingDigest: cleanDigest(
        item?.embeddingDigest,
        "embeddingDigest",
      ),
      observationId: cleanSafeId(item?.observationId, "observationId"),
      speciesKind,
    };
  });
  if (
    new Set(observations.map((item) => item.observationId)).size !==
    observations.length
  ) {
    throw typedError(
      "observationId values must be unique",
      400,
      "PET_MATCH_OBSERVATIONS_INVALID",
    );
  }
  if (observations.some((item) => item.speciesKind !== provider.speciesKind)) {
    throw typedError(
      "Every observation in a run must share its provider species and vector space",
      400,
      "PET_MATCH_RUN_SPECIES_CONFLICT",
    );
  }
  return {
    observations,
    provider,
    runId,
    schemaVersion: petMatchingSchemaVersion,
  };
};

const cleanLimit = (value, fallback = 50, maximum = 200) =>
  Math.min(
    maximum,
    Math.max(1, Number.parseInt(String(value || fallback), 10) || fallback),
  );

const projectSuggestion = (row, bridgeFields) => ({
  assetId: row.asset_id,
  box: {
    h: Number(row.box_h),
    w: Number(row.box_w),
    x: Number(row.box_x),
    y: Number(row.box_y),
  },
  createdAt: row.created_at,
  detectionConfidence: Number(row.detection_confidence),
  galleryCount: Number(row.gallery_count),
  lane: row.lane,
  modelFamily: row.model_family,
  modelVersion: row.model_version,
  observationId: row.observation_id,
  petId: row.pet_id,
  petName: row.display_name,
  providerId: row.provider_id,
  rank: Number(row.rank),
  score: Number(row.score),
  speciesKind: row.species_kind,
  state: row.suggestion_state,
  suggestionId: row.suggestion_id,
  vectorSpaceId: row.vector_space_id,
  ...bridgeFields(row.asset_id),
});

const suggestionSelect = (executor, where, value, limit, rank) =>
  executor`
    SELECT suggestion.suggestion_id, suggestion.pet_id, suggestion.score,
      suggestion.rank, suggestion.gallery_count,
      suggestion.state AS suggestion_state, observation.observation_id,
      observation.asset_id, observation.species_kind, observation.box_x,
      observation.box_y, observation.box_w, observation.box_h,
      observation.detection_confidence, observation.created_at,
      run.provider_id, run.model_family, run.model_version,
      run.vector_space_id, run.lane, pet.display_name
    FROM pet_match_suggestion suggestion
    JOIN pet_match_observation observation
      ON observation.observation_id = suggestion.observation_id
    JOIN pet_match_run run ON run.run_id = observation.run_id
    JOIN asset ON asset.asset_id = observation.asset_id
      AND asset.state = 'active'
    JOIN current_person pet ON pet.person_id = suggestion.pet_id
      AND pet.subject_kind = 'pet'
      AND pet.status = 'active'
    WHERE ${where} = ${value}
      AND suggestion.state = 'pending'
      AND observation.state = 'pending'
      AND run.state = 'complete'
      AND cimmich_visibility_pet_rank(pet.person_id) <= ${rank}
      AND cimmich_visibility_asset_rank(observation.asset_id) <= ${rank}
    ORDER BY observation.created_at DESC, suggestion.rank, suggestion.suggestion_id
    LIMIT ${limit}
  `;

export const createPetMatchingStore = (
  sql,
  { bridgeFields = () => ({}), presentationRank = () => 0 } = {},
) => {
  const beginCommand = async (
    tx,
    { actorId, commandId, commandKind, suggestionId },
  ) => {
    const id = cleanSafeId(commandId, "commandId", 120);
    const requestDigest = digest({ commandKind, suggestionId });
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
    const [existing] = await tx`
      SELECT command_kind, actor_id, request_digest, response
      FROM pet_match_command WHERE command_id = ${id}
    `;
    if (existing) {
      if (
        existing.command_kind !== commandKind ||
        existing.actor_id !== actorId ||
        existing.request_digest !== requestDigest
      ) {
        throw typedError(
          "commandId was already used for a different Pet matching decision",
          409,
          "PET_MATCH_COMMAND_CONFLICT",
        );
      }
      return { id, replay: { ...existing.response, replayed: true } };
    }
    return { id, replay: null, requestDigest };
  };

  const completeCommand = async (
    tx,
    { actorId, command, commandKind, decisionId, response },
  ) => {
    await tx`
      INSERT INTO pet_match_command (
        command_id, command_kind, actor_id, request_digest, decision_id,
        response, producer_receipt_id
      ) VALUES (
        ${command.id}, ${commandKind}, ${actorId}, ${command.requestDigest},
        ${decisionId}, ${tx.json(response)}, ${receiptId}
      )
    `;
    return response;
  };

  return {
    async importBatch({ actorId, packet }) {
      const actor = cleanActor(actorId);
      const input = validatePetMatchImport(packet);
      const requestDigest = digest(input);
      return sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.runId}, 0))`;
        const [existing] = await tx`
          SELECT request_digest, observation_count
          FROM pet_match_run WHERE run_id = ${input.runId}
        `;
        if (existing) {
          if (existing.request_digest !== requestDigest) {
            throw typedError(
              "runId was already used for a different Pet matching import",
              409,
              "PET_MATCH_RUN_CONFLICT",
            );
          }
          return {
            imported: false,
            observationCount: Number(existing.observation_count),
            replayed: true,
            runId: input.runId,
            schemaVersion: petMatchingSchemaVersion,
          };
        }
        const assetIds = input.observations.map((item) => item.assetId);
        const assets = await tx`
          SELECT asset_id FROM asset
          WHERE asset_id = ANY(${assetIds}) AND state = 'active'
          FOR SHARE
        `;
        const foundAssets = new Set(assets.map((row) => row.asset_id));
        const missingAssetIds = [...new Set(assetIds)].filter(
          (assetId) => !foundAssets.has(assetId),
        );
        if (missingAssetIds.length) {
          throw typedError(
            "One or more active Cimmich assets were not found",
            404,
            "PET_MATCH_ASSET_NOT_FOUND",
            { missingAssetIds },
          );
        }
        const petIds = [
          ...new Set(
            input.observations.flatMap((item) =>
              item.candidates.map((candidate) => candidate.petId),
            ),
          ),
        ];
        if (petIds.length) {
          const pets = await tx`
            SELECT person_id, species_kind FROM person
            WHERE person_id = ANY(${petIds}) AND subject_kind = 'pet'
              AND status IN ('active','hidden')
            FOR SHARE
          `;
          const petsById = new Map(
            pets.map((row) => [row.person_id, row.species_kind]),
          );
          const missingPetIds = petIds.filter((petId) => !petsById.has(petId));
          if (missingPetIds.length) {
            throw typedError(
              "One or more candidate Pets were not found",
              404,
              "PET_MATCH_PET_NOT_FOUND",
              { missingPetIds },
            );
          }
          for (const observation of input.observations) {
            const mismatched = observation.candidates.find(
              (candidate) =>
                petsById.get(candidate.petId) !== observation.speciesKind,
            );
            if (mismatched) {
              throw typedError(
                "Pet matching candidates must use the observation species",
                409,
                "PET_MATCH_SPECIES_CONFLICT",
                {
                  observationId: observation.observationId,
                  petId: mismatched.petId,
                },
              );
            }
          }
        }
        await tx`
          INSERT INTO pet_match_run (
            run_id, request_digest, provider_id, model_family, model_version,
            vector_space_id, config_digest, lane, species_kind,
            observation_count, imported_by, producer_receipt_id
          ) VALUES (
            ${input.runId}, ${requestDigest}, ${input.provider.providerId},
            ${input.provider.modelFamily}, ${input.provider.modelVersion},
            ${input.provider.vectorSpaceId}, ${input.provider.configDigest},
            ${input.provider.lane}, ${input.provider.speciesKind},
            ${input.observations.length}, ${actor}, ${receiptId}
          )
        `;
        for (const observation of input.observations) {
          await tx`
            INSERT INTO pet_match_observation (
              observation_id, run_id, asset_id, species_kind,
              box_x, box_y, box_w, box_h, detection_confidence,
              embedding_digest, state, producer_receipt_id
            ) VALUES (
              ${observation.observationId}, ${input.runId},
              ${observation.assetId}, ${observation.speciesKind},
              ${observation.box.x}, ${observation.box.y},
              ${observation.box.w}, ${observation.box.h},
              ${observation.detectionConfidence},
              ${observation.embeddingDigest},
              ${observation.candidates.length ? "pending" : "unknown"},
              ${receiptId}
            )
          `;
          for (const candidate of observation.candidates) {
            await tx`
              INSERT INTO pet_match_suggestion (
                suggestion_id, observation_id, pet_id, score, rank,
                gallery_count, producer_receipt_id
              ) VALUES (
                ${`petsuggestion_${randomUUID().replaceAll("-", "")}`},
                ${observation.observationId}, ${candidate.petId},
                ${candidate.score}, ${candidate.rank},
                ${candidate.galleryCount}, ${receiptId}
              )
            `;
          }
        }
        return {
          imported: true,
          observationCount: input.observations.length,
          replayed: false,
          runId: input.runId,
          schemaVersion: petMatchingSchemaVersion,
        };
      });
    },

    async status() {
      // Counts must share the list queries' run.state = 'complete' scope so
      // the badge numbers agree with what the lists actually show.
      const [counts] = await sql`
        SELECT
          count(*) FILTER (WHERE observation.state = 'pending')::int AS pending,
          count(*) FILTER (WHERE observation.state = 'unknown')::int AS unknown,
          count(*) FILTER (WHERE observation.state = 'confirmed')::int AS confirmed,
          count(*) FILTER (WHERE observation.state = 'rejected')::int AS rejected,
          count(DISTINCT run.run_id) FILTER (WHERE run.state = 'complete')::int AS runs
        FROM pet_match_observation observation
        JOIN pet_match_run run ON run.run_id = observation.run_id
          AND run.state = 'complete'
        JOIN asset ON asset.asset_id = observation.asset_id
          AND asset.state = 'active'
        WHERE cimmich_visibility_asset_rank(observation.asset_id)
          <= ${presentationRank()}
      `;
      return {
        confirmed: Number(counts?.confirmed || 0),
        pending: Number(counts?.pending || 0),
        rejected: Number(counts?.rejected || 0),
        runs: Number(counts?.runs || 0),
        schemaVersion: petMatchingSchemaVersion,
        unknown: Number(counts?.unknown || 0),
      };
    },

    async suggestions({ petId, limit }) {
      const id = cleanSafeId(petId, "petId");
      const rows = await suggestionSelect(
        sql,
        sql` suggestion.pet_id `,
        id,
        cleanLimit(limit),
        presentationRank(),
      );
      return {
        items: rows.map((row) => projectSuggestion(row, bridgeFields)),
        petId: id,
        schemaVersion: petMatchingSchemaVersion,
      };
    },

    async unknown({ limit }) {
      const rows = await sql`
        SELECT observation.observation_id, observation.asset_id,
          observation.species_kind, observation.box_x, observation.box_y,
          observation.box_w, observation.box_h,
          observation.detection_confidence, observation.created_at,
          run.provider_id, run.model_family, run.model_version,
          run.vector_space_id, run.lane
        FROM pet_match_observation observation
        JOIN pet_match_run run ON run.run_id = observation.run_id
        JOIN asset ON asset.asset_id = observation.asset_id
          AND asset.state = 'active'
        WHERE observation.state = 'unknown' AND run.state = 'complete'
          AND cimmich_visibility_asset_rank(observation.asset_id)
            <= ${presentationRank()}
        ORDER BY observation.created_at DESC, observation.observation_id
        LIMIT ${cleanLimit(limit)}
      `;
      return {
        items: rows.map((row) => ({
          assetId: row.asset_id,
          box: {
            h: Number(row.box_h),
            w: Number(row.box_w),
            x: Number(row.box_x),
            y: Number(row.box_y),
          },
          createdAt: row.created_at,
          detectionConfidence: Number(row.detection_confidence),
          lane: row.lane,
          modelFamily: row.model_family,
          modelVersion: row.model_version,
          observationId: row.observation_id,
          providerId: row.provider_id,
          speciesKind: row.species_kind,
          vectorSpaceId: row.vector_space_id,
          ...bridgeFields(row.asset_id),
        })),
        schemaVersion: petMatchingSchemaVersion,
      };
    },

    async resolveUnknown({
      action,
      actorId,
      commandId,
      observationId,
      petId,
    }) {
      const actor = cleanActor(actorId);
      const id = cleanSafeId(observationId, "observationId");
      if (!["assign", "reject"].includes(action)) {
        throw typedError(
          "action must be assign or reject",
          400,
          "PET_MATCH_UNKNOWN_ACTION_INVALID",
        );
      }
      const selectedPetId =
        action === "assign" ? cleanSafeId(petId, "petId") : null;
      const commandKind = action === "assign" ? "confirm" : "reject";
      return sql.begin(async (tx) => {
        const command = await beginCommand(tx, {
          actorId: actor,
          commandId,
          commandKind,
          suggestionId: `${id}:${selectedPetId || "not-pet"}`,
        });
        if (command.replay) return command.replay;
        const [observation] = await tx`
          SELECT observation.observation_id, observation.asset_id,
            observation.species_kind, observation.box_x, observation.box_y,
            observation.box_w, observation.box_h,
            observation.detection_confidence, observation.state,
            run.lane, run.provider_id, run.model_family, run.model_version
          FROM pet_match_observation observation
          JOIN pet_match_run run ON run.run_id = observation.run_id
          WHERE observation.observation_id = ${id}
          FOR UPDATE OF observation
        `;
        if (!observation) {
          throw typedError(
            "Unknown Pet observation not found",
            404,
            "PET_MATCH_UNKNOWN_NOT_FOUND",
          );
        }
        if (observation.state !== "unknown") {
          throw typedError(
            "Unknown Pet observation has already been reviewed",
            409,
            "PET_MATCH_ALREADY_REVIEWED",
          );
        }

        let pet = null;
        if (action === "assign") {
          [pet] = await tx`
            SELECT person_id, display_name, species_kind
            FROM current_person
            WHERE person_id = ${selectedPetId}
              AND subject_kind = 'pet'
              AND status IN ('active','hidden')
          `;
          if (!pet) {
            throw typedError(
              "Selected Pet not found",
              404,
              "PET_MATCH_PET_NOT_FOUND",
            );
          }
          if (pet.species_kind !== observation.species_kind) {
            throw typedError(
              "Selected Pet must use the observation species",
              409,
              "PET_MATCH_SPECIES_CONFLICT",
            );
          }
          const [asset] = await tx`
            SELECT asset_id FROM asset
            WHERE asset_id = ${observation.asset_id} AND state = 'active'
            FOR SHARE
          `;
          if (!asset) {
            throw typedError(
              "One or more active Cimmich assets were not found",
              404,
              "PET_MATCH_ASSET_NOT_FOUND",
              { missingAssetIds: [observation.asset_id] },
            );
          }
        }

        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, producer_receipt_id, privacy_class
          ) VALUES (
            ${decisionId}, 'pet_match_observation', ${id},
            ${action === "assign" ? "accept" : "reject"}, 'user', ${actor},
            ${action === "assign" ? "unknown_pet_assigned" : "not_a_pet"},
            ${action === "assign" ? "Assigned Unknown Pet" : "Not a Pet"},
            ${receiptId}, 'private'
          )
        `;

        if (action === "reject") {
          await tx`
            UPDATE pet_match_observation SET state = 'rejected'
            WHERE observation_id = ${id}
          `;
          const response = {
            action,
            changed: true,
            decisionId,
            observationId: id,
            schemaVersion: petMatchingSchemaVersion,
          };
          return completeCommand(tx, {
            actorId: actor,
            command,
            commandKind,
            decisionId,
            response,
          });
        }

        let realizedObservationId;
        let realizedAssociationId;
        if (observation.lane === "face") {
          realizedObservationId = `petface_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO face_observation (
              face_id, asset_id, box_x, box_y, box_w, box_h,
              detection_confidence, quality_measurements, state,
              producer_receipt_id, privacy_class
            ) VALUES (
              ${realizedObservationId}, ${observation.asset_id},
              ${observation.box_x}, ${observation.box_y},
              ${observation.box_w}, ${observation.box_h},
              ${observation.detection_confidence},
              ${tx.json({
                petMatching: {
                  lane: "face",
                  observationId: id,
                  ownerClassified: true,
                },
              })},
              'valid', ${receiptId}, 'sensitive-biometric'
            )
          `;
          realizedAssociationId = `claim_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO identity_claim (
              identity_claim_id, face_id, person_id, origin, state,
              evidence_refs, decision_id, producer_receipt_id, privacy_class
            ) VALUES (
              ${realizedAssociationId}, ${realizedObservationId},
              ${selectedPetId}, 'user', 'accepted',
              ${tx.json([
                {
                  observationId: id,
                  type: "owner_classified_unknown_pet",
                },
              ])},
              ${decisionId}, ${receiptId}, 'sensitive-biometric'
            )
          `;
        } else {
          realizedObservationId = `petbody_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO body_observation (
              body_id, asset_id, box_x, box_y, box_w, box_h,
              quality_measurements, state, producer_receipt_id, privacy_class
            ) VALUES (
              ${realizedObservationId}, ${observation.asset_id},
              ${observation.box_x}, ${observation.box_y},
              ${observation.box_w}, ${observation.box_h},
              ${tx.json({
                detectionConfidence: Number(observation.detection_confidence),
                petMatching: {
                  lane: "whole_animal",
                  observationId: id,
                  ownerClassified: true,
                },
              })},
              'valid', ${receiptId}, 'private'
            )
          `;
          realizedAssociationId = `body_tag_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO body_tag (
              body_tag_id, person_id, body_id, origin, state, confidence,
              decision_id, producer_receipt_id, privacy_class
            ) VALUES (
              ${realizedAssociationId}, ${selectedPetId},
              ${realizedObservationId}, 'user', 'accepted', NULL,
              ${decisionId}, ${receiptId}, 'private'
            )
          `;
        }
        await tx`
          UPDATE pet_match_observation
          SET state = 'confirmed',
            realized_observation_id = ${realizedObservationId},
            realized_association_id = ${realizedAssociationId}
          WHERE observation_id = ${id}
        `;
        const response = {
          action,
          changed: true,
          decisionId,
          lane: observation.lane,
          observationId: id,
          petId: selectedPetId,
          petName: pet.display_name,
          realizedAssociationId,
          realizedObservationId,
          schemaVersion: petMatchingSchemaVersion,
        };
        return completeCommand(tx, {
          actorId: actor,
          command,
          commandKind,
          decisionId,
          response,
        });
      });
    },

    async review({ action, actorId, commandId, suggestionId }) {
      const actor = cleanActor(actorId);
      const id = cleanSafeId(suggestionId, "suggestionId");
      if (!["confirm", "reject"].includes(action)) {
        throw typedError(
          "action must be confirm or reject",
          400,
          "PET_MATCH_ACTION_INVALID",
        );
      }
      return sql.begin(async (tx) => {
        const command = await beginCommand(tx, {
          actorId: actor,
          commandId,
          commandKind: action,
          suggestionId: id,
        });
        if (command.replay) return command.replay;
        const [suggestion] = await tx`
          SELECT suggestion.suggestion_id, suggestion.pet_id,
            suggestion.score, suggestion.state AS suggestion_state,
            observation.observation_id, observation.asset_id,
            observation.species_kind, observation.box_x, observation.box_y,
            observation.box_w, observation.box_h,
            observation.detection_confidence,
            observation.state AS observation_state, run.lane,
            pet.display_name
          FROM pet_match_suggestion suggestion
          JOIN pet_match_observation observation
            ON observation.observation_id = suggestion.observation_id
          JOIN pet_match_run run ON run.run_id = observation.run_id
          JOIN person pet ON pet.person_id = suggestion.pet_id
            AND pet.subject_kind = 'pet'
            AND pet.status IN ('active','hidden')
          WHERE suggestion.suggestion_id = ${id}
          FOR UPDATE OF suggestion, observation
        `;
        if (!suggestion) {
          throw typedError(
            "Pet matching suggestion not found",
            404,
            "PET_MATCH_SUGGESTION_NOT_FOUND",
          );
        }
        if (
          suggestion.suggestion_state !== "pending" ||
          suggestion.observation_state !== "pending"
        ) {
          throw typedError(
            "Pet matching suggestion has already been reviewed",
            409,
            "PET_MATCH_ALREADY_REVIEWED",
          );
        }
        if (action === "confirm") {
          const [asset] = await tx`
            SELECT asset_id FROM asset
            WHERE asset_id = ${suggestion.asset_id} AND state = 'active'
            FOR SHARE
          `;
          if (!asset) {
            throw typedError(
              "One or more active Cimmich assets were not found",
              404,
              "PET_MATCH_ASSET_NOT_FOUND",
              { missingAssetIds: [suggestion.asset_id] },
            );
          }
        }
        const decisionId = `decision_${randomUUID().replaceAll("-", "")}`;
        await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, producer_receipt_id, privacy_class
          ) VALUES (
            ${decisionId}, 'pet_match_suggestion', ${id},
            ${action === "confirm" ? "accept" : "reject"}, 'user', ${actor},
            ${action === "confirm" ? "pet_match_confirmed" : "pet_match_rejected"},
            ${action === "confirm" ? "Confirmed Pet match" : "Not this Pet"},
            ${receiptId}, 'private'
          )
        `;
        if (action === "reject") {
          await tx`
            UPDATE pet_match_suggestion
            SET state = 'rejected', decision_id = ${decisionId}
            WHERE suggestion_id = ${id}
          `;
          const [remaining] = await tx`
            SELECT count(*)::int AS count
            FROM pet_match_suggestion
            WHERE observation_id = ${suggestion.observation_id}
              AND state = 'pending'
          `;
          if (Number(remaining.count) === 0) {
            await tx`
              UPDATE pet_match_observation SET state = 'unknown'
              WHERE observation_id = ${suggestion.observation_id}
            `;
          }
          const response = {
            action,
            changed: true,
            decisionId,
            observationId: suggestion.observation_id,
            petId: suggestion.pet_id,
            schemaVersion: petMatchingSchemaVersion,
            suggestionId: id,
          };
          return completeCommand(tx, {
            actorId: actor,
            command,
            commandKind: action,
            decisionId,
            response,
          });
        }

        let realizedObservationId;
        let realizedAssociationId;
        if (suggestion.lane === "face") {
          realizedObservationId = `petface_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO face_observation (
              face_id, asset_id, box_x, box_y, box_w, box_h,
              detection_confidence, quality_measurements, state,
              producer_receipt_id, privacy_class
            ) VALUES (
              ${realizedObservationId}, ${suggestion.asset_id},
              ${suggestion.box_x}, ${suggestion.box_y},
              ${suggestion.box_w}, ${suggestion.box_h},
              ${suggestion.detection_confidence},
              ${tx.json({
                petMatching: {
                  lane: "face",
                  score: Number(suggestion.score),
                  suggestionId: id,
                },
              })},
              'valid', ${receiptId}, 'sensitive-biometric'
            )
          `;
          realizedAssociationId = `claim_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO identity_claim (
              identity_claim_id, face_id, person_id, origin, state,
              evidence_refs, decision_id, producer_receipt_id, privacy_class
            ) VALUES (
              ${realizedAssociationId}, ${realizedObservationId},
              ${suggestion.pet_id}, 'user', 'accepted',
              ${tx.json([
                {
                  score: Number(suggestion.score),
                  suggestionId: id,
                  type: "user_confirmed_pet_match",
                },
              ])},
              ${decisionId}, ${receiptId}, 'sensitive-biometric'
            )
          `;
        } else {
          realizedObservationId = `petbody_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO body_observation (
              body_id, asset_id, box_x, box_y, box_w, box_h,
              quality_measurements, state, producer_receipt_id, privacy_class
            ) VALUES (
              ${realizedObservationId}, ${suggestion.asset_id},
              ${suggestion.box_x}, ${suggestion.box_y},
              ${suggestion.box_w}, ${suggestion.box_h},
              ${tx.json({
                detectionConfidence: Number(suggestion.detection_confidence),
                petMatching: {
                  lane: "whole_animal",
                  score: Number(suggestion.score),
                  suggestionId: id,
                },
              })},
              'valid', ${receiptId}, 'private'
            )
          `;
          realizedAssociationId = `body_tag_${randomUUID().replaceAll("-", "")}`;
          await tx`
            INSERT INTO body_tag (
              body_tag_id, person_id, body_id, origin, state, confidence,
              decision_id, producer_receipt_id, privacy_class
            ) VALUES (
              ${realizedAssociationId}, ${suggestion.pet_id},
              ${realizedObservationId}, 'user', 'accepted', NULL,
              ${decisionId}, ${receiptId}, 'private'
            )
          `;
        }
        await tx`
          UPDATE pet_match_suggestion
          SET state = CASE WHEN suggestion_id = ${id}
            THEN 'confirmed' ELSE 'superseded' END,
            decision_id = CASE WHEN suggestion_id = ${id}
              THEN ${decisionId} ELSE decision_id END
          WHERE observation_id = ${suggestion.observation_id}
            AND state = 'pending'
        `;
        await tx`
          UPDATE pet_match_observation
          SET state = 'confirmed',
            realized_observation_id = ${realizedObservationId},
            realized_association_id = ${realizedAssociationId}
          WHERE observation_id = ${suggestion.observation_id}
        `;
        const response = {
          action,
          changed: true,
          decisionId,
          lane: suggestion.lane,
          observationId: suggestion.observation_id,
          petId: suggestion.pet_id,
          petName: suggestion.display_name,
          realizedAssociationId,
          realizedObservationId,
          schemaVersion: petMatchingSchemaVersion,
          suggestionId: id,
        };
        return completeCommand(tx, {
          actorId: actor,
          command,
          commandKind: action,
          decisionId,
          response,
        });
      });
    },
  };
};
