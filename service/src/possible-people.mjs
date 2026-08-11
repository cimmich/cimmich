import { createHash, randomUUID } from "node:crypto";
import {
  classifyPossiblePeopleRun,
  possiblePeopleClassificationContract,
} from "./possible-people-classifier.mjs";
import { processPossiblePeopleBatches } from "./possible-people-batch.mjs";
import {
  createPossiblePeopleProjection,
  projectPossiblePeopleRun as projectRun,
} from "./possible-people-projection.mjs";
import {
  dropPossiblePeopleCandidateScope,
  seedPossiblePeopleRun,
} from "./possible-people-seed.mjs";
import { PossiblePeopleUnionFind } from "./possible-people-union-find.mjs";
import {
  releaseReservedConnection,
  withReservedTransaction,
} from "./postgres-reserved.mjs";

const receiptId = "receipt_cimmich_possible_people_v1";
const algorithmVersion = "cimmich-possible-people-graph-v2";
const schemaVersion = "cimmich.possible-people-snapshot.v1";
const seedLimit = 100_000;
const neighbourLimit = 12;
const similarityFloor = 0.55;
const strongOneWayFloor = 0.68;
const { classificationVersion, knownPersonMarginFloor, knownPersonScoreFloor } =
  possiblePeopleClassificationContract;

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const stableId = (prefix, ...parts) =>
  `${prefix}${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32)}`;

const cleanCommandId = (value) => {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(normalized)) {
    throw typedError(
      "A stable commandId of 8 to 120 safe characters is required",
      400,
      "POSSIBLE_PEOPLE_COMMAND_INVALID",
    );
  }
  return normalized;
};

const cleanActor = (value) => {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 120) {
    throw typedError(
      "A Cimmich actor is required",
      400,
      "POSSIBLE_PEOPLE_ACTOR_REQUIRED",
    );
  }
  return actor;
};

const cleanId = (value, label) => {
  const normalized = String(value || "").trim();
  if (
    !normalized ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw typedError(
      `${label} is invalid`,
      400,
      "POSSIBLE_PEOPLE_INPUT_INVALID",
    );
  }
  return normalized;
};

const beginCommand = async (
  tx,
  { actorId, commandId, commandKind, requestDigest },
) => {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${commandId}, 123))`;
  const [existing] = await tx`
    SELECT actor_id, command_kind, request_digest, response_body, state
    FROM possible_person_command WHERE command_id = ${commandId} FOR UPDATE
  `;
  if (existing) {
    if (
      existing.actor_id !== actorId ||
      existing.command_kind !== commandKind ||
      existing.request_digest !== requestDigest
    ) {
      throw typedError(
        "commandId was already used for a different Possible people action",
        409,
        "POSSIBLE_PEOPLE_COMMAND_CONFLICT",
      );
    }
    if (existing.state === "completed")
      return { replay: { ...existing.response_body, replayed: true } };
    throw typedError(
      "This Possible people action is already in progress",
      409,
      "POSSIBLE_PEOPLE_COMMAND_CONFLICT",
    );
  }
  await tx`
    INSERT INTO possible_person_command (
      command_id, actor_id, command_kind, request_digest, state
    ) VALUES (${commandId}, ${actorId}, ${commandKind}, ${requestDigest}, 'started')
  `;
  return { replay: null };
};

const completeCommand = async (tx, commandId, response) => {
  await tx`
    UPDATE possible_person_command
    SET response_body = ${tx.json(response)}, state = 'completed', completed_at = now()
    WHERE command_id = ${commandId}
  `;
  return response;
};

const seedRun = async (sql, runId, presentationRank) => {
  const space = await seedPossiblePeopleRun({ sql, runId, presentationRank });
  if (!space) {
    throw typedError(
      "No active Cimmich face embeddings are available for Possible people",
      409,
      "POSSIBLE_PEOPLE_VECTOR_SPACE_EMPTY",
    );
  }
  return space;
};

const finalizeRun = async (sql, run) => {
  const edges = await sql`
    SELECT left_face_id, right_face_id, similarity::float8, support_count
    FROM possible_person_edge
    WHERE run_id = ${run.run_id}
      AND (support_count = 2 OR similarity >= ${strongOneWayFloor})
    ORDER BY left_face_id, right_face_id
  `;
  const union = new PossiblePeopleUnionFind();
  const memberScore = new Map();
  for (const edge of edges) {
    union.union(edge.left_face_id, edge.right_face_id);
    memberScore.set(
      edge.left_face_id,
      Math.max(memberScore.get(edge.left_face_id) || -1, edge.similarity),
    );
    memberScore.set(
      edge.right_face_id,
      Math.max(memberScore.get(edge.right_face_id) || -1, edge.similarity),
    );
  }
  const components = new Map();
  for (const faceId of union.parent.keys()) {
    const root = union.find(faceId);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(faceId);
  }
  const metadata = await sql`
    SELECT face.face_id, face.asset_id, face.box_x::float8, face.box_y::float8,
      face.box_w::float8, face.box_h::float8, face.detection_confidence::float8,
      asset.width, asset.height, asset.capture_time,
      projection.immich_asset_id AS source_asset_id,
      coalesce(place.locations, ARRAY[]::text[]) AS locations
    FROM current_matchable_physical_face face
    JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
    LEFT JOIN LATERAL (
      SELECT current_projection.immich_asset_id
      FROM immich_asset_projection current_projection
      WHERE current_projection.cimmich_asset_id = asset.asset_id
        AND current_projection.state = 'active'
      ORDER BY current_projection.last_seen_at DESC, current_projection.source_id
      LIMIT 1
    ) projection ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT entity.display_name ORDER BY entity.display_name) AS locations
      FROM current_context_asset link
      JOIN context_entity entity ON entity.entity_id = link.entity_id
        AND entity.entity_kind = 'place' AND entity.status = 'active'
      WHERE link.asset_id = asset.asset_id
    ) place ON true
    WHERE face.face_id IN (
      SELECT left_face_id FROM possible_person_edge WHERE run_id = ${run.run_id}
      UNION
      SELECT right_face_id FROM possible_person_edge WHERE run_id = ${run.run_id}
    )
      AND NOT EXISTS (
        SELECT 1 FROM identity_claim accepted
        WHERE accepted.face_id = face.face_id AND accepted.state = 'accepted'
      )
      AND NOT EXISTS (
        SELECT 1 FROM identity_claim suggested
        WHERE suggested.face_id = face.face_id AND suggested.state = 'candidate'
      )
  `;
  const byFace = new Map(metadata.map((row) => [row.face_id, row]));
  const clusters = [];
  for (const members of components.values()) {
    const rows = members.map((faceId) => byFace.get(faceId)).filter(Boolean);
    const assetIds = new Set(rows.map((row) => row.asset_id));
    if (assetIds.size < 3) continue;
    const captures = rows
      .map((row) => row.capture_time)
      .filter(Boolean)
      .map((value) => new Date(value));
    const years = new Set(captures.map((value) => value.getUTCFullYear()));
    const locations = [
      ...new Set(rows.flatMap((row) => row.locations || [])),
    ].sort();
    if (assetIds.size < 5 && years.size < 2 && locations.length < 2) continue;
    const sortedMembers = rows.map((row) => row.face_id).sort();
    const clusterDigest = digest({ algorithmVersion, members: sortedMembers });
    const representative = [...rows].sort(
      (left, right) =>
        Number(right.detection_confidence || 0) *
          Number(right.box_w) *
          Number(right.box_h) -
          Number(left.detection_confidence || 0) *
            Number(left.box_w) *
            Number(left.box_h) || left.face_id.localeCompare(right.face_id),
    )[0];
    const first = captures.length
      ? new Date(Math.min(...captures.map(Number)))
      : null;
    const last = captures.length
      ? new Date(Math.max(...captures.map(Number)))
      : null;
    clusters.push({
      clusterDigest,
      clusterId: stableId("cluster_", run.run_id, clusterDigest),
      evidence: {
        distinctYears: years.size,
        faceCount: rows.length,
        firstCaptureTime: first?.toISOString() || null,
        lastCaptureTime: last?.toISOString() || null,
        locationCount: locations.length,
        locations,
        photoCount: assetIds.size,
        timeSpanDays:
          first && last ? Math.floor((last - first) / 86_400_000) : 0,
      },
      members: rows,
      representative,
    });
  }
  clusters.sort(
    (left, right) =>
      right.evidence.photoCount - left.evidence.photoCount ||
      left.clusterDigest.localeCompare(right.clusterDigest),
  );
  await sql.begin(async (tx) => {
    for (const cluster of clusters) {
      const [previous] = await tx`
        SELECT status, linked_person_id, current_decision_id,
          suggestion_evidence
        FROM face_cluster
        WHERE cluster_digest = ${cluster.clusterDigest}
          AND possible_person_run_id IS NOT NULL
        ORDER BY created_at DESC, cluster_id DESC LIMIT 1
      `;
      await tx`
        INSERT INTO face_cluster (
          cluster_id, producer_receipt_id, status, linked_person_id, member_count,
          privacy_class, possible_person_run_id, cluster_digest,
          representative_face_id, evidence, source_revision, current_decision_id,
          suggestion_evidence
        ) VALUES (
          ${cluster.clusterId}, ${receiptId}, ${previous?.status || "open"},
          ${previous?.linked_person_id || null}, ${cluster.members.length},
          'sensitive-biometric', ${run.run_id}, ${cluster.clusterDigest},
          ${cluster.representative.face_id}, ${tx.json(cluster.evidence)},
          ${cluster.clusterDigest}, ${previous?.current_decision_id || null},
          ${tx.json(previous?.suggestion_evidence || {})}
        )
      `;
      const memberRows = cluster.members
        .sort((left, right) => left.face_id.localeCompare(right.face_id))
        .map((member, index) => ({
          cluster_id: cluster.clusterId,
          face_id: member.face_id,
          membership_score: memberScore.get(member.face_id) ?? null,
          rank: index + 1,
        }));
      for (let offset = 0; offset < memberRows.length; offset += 1_000) {
        await tx`
          INSERT INTO face_cluster_member ${tx(
            memberRows.slice(offset, offset + 1_000),
            "cluster_id",
            "face_id",
            "membership_score",
            "rank",
          )}
        `;
      }
    }
    await tx`
      UPDATE possible_person_run
      SET edge_count = (SELECT count(*)::int FROM possible_person_edge WHERE run_id = ${run.run_id}),
        cluster_count = ${clusters.length}
      WHERE run_id = ${run.run_id} AND state = 'running'
    `;
  });
  await classifyPossiblePeopleRun(sql, run.run_id);
  await sql`
    UPDATE possible_person_run SET state = 'completed', completed_at = now()
    WHERE run_id = ${run.run_id} AND state = 'running'
      AND classification_state = 'completed'
  `;
};

export const createPossiblePeopleStore = (
  sql,
  {
    createPerson,
    presentationRank = () => 0,
    reconcilePhysicalFaces = () =>
      sql`SELECT cimmich_refresh_physical_face_reconciliation()`,
  } = {},
) => {
  let worker = null;
  let classificationWorker = null;
  const projection = createPossiblePeopleProjection(sql, {
    algorithmVersion,
    schemaVersion,
  });

  const runWorker = (runId) => {
    if (worker) return worker;
    worker = (async () => {
      let workSql = sql;
      let reserved = false;
      try {
        if (typeof sql.reserve === "function") {
          workSql = await sql.reserve();
          reserved = true;
        }
        const claimed = await withReservedTransaction(workSql, async (tx) => {
          const [run] = await tx`
            SELECT state FROM possible_person_run
            WHERE run_id = ${runId} FOR UPDATE
          `;
          if (!run || run.state === "failed" || run.state === "completed")
            return false;
          if (run.state === "running") {
            await tx`
              UPDATE possible_person_run SET state = 'failed',
                error_code = 'POSSIBLE_PEOPLE_PROCESS_INTERRUPTED',
                error_message = 'The service stopped before this explicit refresh completed.'
              WHERE run_id = ${runId} AND state = 'running'
            `;
            return false;
          }
          return true;
        });
        if (!claimed) return;
        await reconcilePhysicalFaces();
        const space = await seedRun(workSql, runId, presentationRank);
        const [run] =
          await workSql`SELECT * FROM possible_person_run WHERE run_id = ${runId}`;
        if (!run || run.state !== "running") return;
        await processPossiblePeopleBatches({
          sql,
          coordinatorSql: workSql,
          run,
          space,
          presentationRank,
        });
        if (reserved) {
          await dropPossiblePeopleCandidateScope(workSql).catch(() => {});
          await releaseReservedConnection(workSql);
          reserved = false;
          workSql = sql;
        }
        const [completedRun] =
          await workSql`SELECT * FROM possible_person_run WHERE run_id = ${runId}`;
        if (!completedRun || completedRun.state !== "running") return;
        await finalizeRun(workSql, completedRun);
      } catch (error) {
        await withReservedTransaction(workSql, async (tx) => {
          await tx`DELETE FROM possible_person_edge WHERE run_id = ${runId}`;
          await tx`DELETE FROM possible_person_seed WHERE run_id = ${runId}`;
          await tx`
            UPDATE possible_person_run SET state = 'failed', total_seeds = 0,
              processed_seeds = 0, edge_count = 0, cluster_count = 0,
              error_code = ${String(error?.code || "POSSIBLE_PEOPLE_REFRESH_FAILED").slice(0, 120)},
              error_message = ${String(error?.message || error).slice(0, 500)},
              classification_state = CASE
                WHEN classification_state = 'running' THEN 'failed'
                ELSE classification_state
              END,
              classification_error_code = CASE
                WHEN classification_state = 'running'
                  THEN ${String(error?.code || "POSSIBLE_PEOPLE_CLASSIFICATION_FAILED").slice(0, 120)}
                ELSE classification_error_code
              END,
              classification_error_message = CASE
                WHEN classification_state = 'running'
                  THEN ${String(error?.message || error).slice(0, 500)}
                ELSE classification_error_message
              END
            WHERE run_id = ${runId} AND state IN ('queued','running')
          `;
        }).catch(() => {});
      } finally {
        await dropPossiblePeopleCandidateScope(workSql).catch(() => {});
        if (reserved) await releaseReservedConnection(workSql);
        worker = null;
      }
    })();
    return worker;
  };

  const runClassificationWorker = (runId) => {
    if (classificationWorker) return classificationWorker;
    classificationWorker = (async () => {
      try {
        await classifyPossiblePeopleRun(sql, runId);
      } catch (error) {
        await sql`
          UPDATE possible_person_run
          SET classification_state = 'failed',
            classification_error_code = ${String(error?.code || "POSSIBLE_PEOPLE_CLASSIFICATION_FAILED").slice(0, 120)},
            classification_error_message = ${String(error?.message || error).slice(0, 500)}
          WHERE run_id = ${runId} AND state = 'completed'
            AND classification_state <> 'completed'
        `.catch(() => {});
      } finally {
        classificationWorker = null;
      }
    })();
    return classificationWorker;
  };

  const classifyLatest = async ({ actorId, commandId }) => {
    const actor = cleanActor(actorId);
    const stableCommandId = cleanCommandId(commandId);
    const requestDigest = digest({ classificationVersion, kind: "classify" });
    const result = await sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId: stableCommandId,
        commandKind: "classify",
        requestDigest,
      });
      if (command.replay) return command.replay;
      const [run] = await tx`
        SELECT * FROM possible_person_run
        WHERE state = 'completed' AND algorithm_version = ${algorithmVersion}
        ORDER BY completed_at DESC, run_id DESC LIMIT 1 FOR UPDATE
      `;
      if (!run)
        throw typedError(
          "No completed Possible people snapshot is available",
          409,
          "POSSIBLE_PEOPLE_SNAPSHOT_EMPTY",
        );
      if (run.classification_state === "completed") {
        return completeCommand(tx, stableCommandId, {
          changed: false,
          replayed: false,
          run: projectRun(run),
          schemaVersion,
        });
      }
      await tx`
        UPDATE possible_person_run
        SET classification_state = 'pending',
          classification_error_code = NULL, classification_error_message = NULL
        WHERE run_id = ${run.run_id}
      `;
      return completeCommand(tx, stableCommandId, {
        changed: true,
        replayed: false,
        run: projectRun({ ...run, classification_state: "pending" }),
        schemaVersion,
      });
    });
    if (result.changed) void runClassificationWorker(result.run.runId);
    return result;
  };

  const refresh = async ({ actorId, commandId }) => {
    const actor = cleanActor(actorId);
    const stableCommandId = cleanCommandId(commandId);
    const requestDigest = digest({ algorithmVersion, kind: "refresh" });
    const result = await sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId: stableCommandId,
        commandKind: "refresh",
        requestDigest,
      });
      if (command.replay) return command.replay;
      const [active] = await tx`
        SELECT * FROM possible_person_run
        WHERE state IN ('queued','running')
        ORDER BY created_at DESC, run_id DESC LIMIT 1
      `;
      if (active) {
        return completeCommand(tx, stableCommandId, {
          changed: false,
          replayed: false,
          run: projectRun(active),
          schemaVersion,
        });
      }
      const runId = `possible_run_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO possible_person_run (
          run_id, command_id, state, algorithm_version, seed_limit,
          neighbour_limit, similarity_floor
        ) VALUES (
          ${runId}, ${stableCommandId}, 'queued', ${algorithmVersion}, ${seedLimit},
          ${neighbourLimit}, ${similarityFloor}
        )
      `;
      return completeCommand(tx, stableCommandId, {
        changed: true,
        replayed: false,
        run: {
          clusterCount: 0,
          completedAt: null,
          createdAt: new Date().toISOString(),
          edgeCount: 0,
          errorCode: null,
          errorMessage: null,
          processedSeeds: 0,
          runId,
          startedAt: null,
          state: "queued",
          totalSeeds: 0,
        },
        schemaVersion,
      });
    });
    if (["queued", "running"].includes(result.run?.state))
      void runWorker(result.run.runId);
    return result;
  };

  const resolve = async ({
    action,
    actorId,
    clusterId,
    commandId,
    newPersonName,
    personId,
    snapshotDigest,
  }) => {
    const actor = cleanActor(actorId);
    const stableCommandId = cleanCommandId(commandId);
    const stableClusterId = cleanId(clusterId, "Possible person cluster ID");
    if (
      !new Set([
        "later",
        "existing_person",
        "create_person",
        "not_suggested_person",
        "ungroup",
      ]).has(action)
    ) {
      throw typedError(
        "Possible person action is invalid",
        400,
        "POSSIBLE_PEOPLE_INPUT_INVALID",
      );
    }
    let selectedPersonId = personId ? cleanId(personId, "Person ID") : null;
    let createdPerson = false;
    if (action === "create_person") {
      if (!createPerson)
        throw typedError(
          "Person creation is unavailable",
          503,
          "POSSIBLE_PEOPLE_CREATE_UNAVAILABLE",
        );
      const created = await createPerson({
        actorId: actor,
        commandId: `${stableCommandId}.person`.slice(0, 120),
        newPersonName,
      });
      selectedPersonId = created.personId;
      createdPerson = created.createdPerson === true;
    }
    const requestDigest = digest({
      action,
      clusterId: stableClusterId,
      selectedPersonId,
      snapshotDigest,
    });
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId: stableCommandId,
        commandKind: "resolve",
        requestDigest,
      });
      if (command.replay) return command.replay;
      const [cluster] = await tx`
        SELECT cluster_id, cluster_digest, status, possible_person_run_id,
          suggested_person_id, suggestion_evidence
        FROM face_cluster WHERE cluster_id = ${stableClusterId} FOR UPDATE
      `;
      if (!cluster || cluster.cluster_digest !== String(snapshotDigest || "")) {
        throw typedError(
          "Possible person snapshot changed; refresh the page and try again",
          409,
          "POSSIBLE_PEOPLE_SNAPSHOT_STALE",
        );
      }
      if (action === "ungroup") {
        if (cluster.status !== "open") {
          throw typedError(
            "This recurring group is no longer open for review",
            409,
            "POSSIBLE_PEOPLE_SNAPSHOT_STALE",
          );
        }
        const decisionId = stableId("decision_possible_", stableCommandId);
        await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, producer_receipt_id, privacy_class
          ) VALUES (
            ${decisionId}, 'face_cluster', ${cluster.cluster_id}, 'split',
            'user', ${actor}, 'possible_person_group_rejected',
            'Reject this exact recurring Face grouping without assigning identity',
            ${receiptId}, 'sensitive-biometric'
          )
        `;
        await tx`
          UPDATE face_cluster
          SET status = 'split', linked_person_id = NULL,
            suggested_person_id = NULL, current_decision_id = ${decisionId}
          WHERE cluster_id = ${cluster.cluster_id}
        `;
        return completeCommand(tx, stableCommandId, {
          changed: true,
          decisionId,
          replayed: false,
          resolution: null,
          schemaVersion,
          state: "ungrouped",
        });
      }
      if (action === "not_suggested_person") {
        if (!cluster.suggested_person_id) {
          throw typedError(
            "This recurring group no longer has a known-Person suggestion",
            409,
            "POSSIBLE_PEOPLE_SNAPSHOT_STALE",
          );
        }
        const decisionId = stableId("decision_possible_", stableCommandId);
        await tx`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind, actor_id,
            reason_code, note, producer_receipt_id, privacy_class
          ) VALUES (
            ${decisionId}, 'face_cluster', ${cluster.cluster_id}, 'reject',
            'user', ${actor}, 'possible_person_known_match_rejected',
            ${`Reject grouped suggestion for ${cluster.suggested_person_id}`},
            ${receiptId}, 'sensitive-biometric'
          )
        `;
        await tx`
          UPDATE face_cluster
          SET suggested_person_id = NULL,
            suggestion_evidence = jsonb_set(
              suggestion_evidence,
              '{rejectedPersonIds}',
              coalesce(suggestion_evidence->'rejectedPersonIds', '[]'::jsonb)
                || to_jsonb(${cluster.suggested_person_id}::text),
              true
            ),
            current_decision_id = ${decisionId}
          WHERE cluster_id = ${cluster.cluster_id}
        `;
        return completeCommand(tx, stableCommandId, {
          changed: true,
          decisionId,
          replayed: false,
          resolution: null,
          schemaVersion,
          state: "rejected_known_match",
        });
      }
      if (action !== "later") {
        const [person] = await tx`
          SELECT person_id FROM person
          WHERE person_id = ${selectedPersonId} AND status = 'active' AND subject_kind = 'person'
        `;
        if (!person)
          throw typedError("Active Person not found", 404, "PERSON_NOT_FOUND");
      }
      const decisionId = stableId("decision_possible_", stableCommandId);
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, producer_receipt_id, privacy_class
        ) VALUES (
          ${decisionId}, 'face_cluster', ${cluster.cluster_id},
          ${action === "later" ? "ignore" : "promote"}, 'user', ${actor},
          ${action === "later" ? "possible_person_later" : "possible_person_candidate_link"},
          ${action === "later" ? "Hide recurring unnamed face group" : "Link recurring group as reviewable Person candidates"},
          ${receiptId}, 'sensitive-biometric'
        )
      `;
      await tx`
        UPDATE face_cluster SET status = ${action === "later" ? "closed" : "linked"},
          linked_person_id = ${action === "later" ? null : selectedPersonId},
          current_decision_id = ${decisionId}
        WHERE cluster_id = ${cluster.cluster_id}
      `;
      let candidateCount = 0;
      if (action !== "later") {
        const inserted = await tx`
          INSERT INTO identity_claim (
            identity_claim_id, face_id, person_id, origin, state,
            calibrated_confidence, evidence_refs, producer_receipt_id, privacy_class
          )
          SELECT
            'claim_cluster_' || encode(digest(
              ${cluster.cluster_id} || ':' || member.face_id || ':' || ${selectedPersonId}, 'sha256'
            ), 'hex'),
            member.face_id, ${selectedPersonId}, 'cluster_propagation', 'candidate',
            greatest(0, least(1, member.membership_score)),
            jsonb_build_object(
              'assignment_decision', 'cluster_propagation_candidate',
              'automatic_acceptance', 'false',
              'best_score', member.membership_score,
              'cluster_id', ${cluster.cluster_id}::text,
              'policy_version', ${algorithmVersion}::text,
              'run_id', ${cluster.possible_person_run_id}::text
            ),
            ${receiptId}, 'sensitive-biometric'
          FROM face_cluster_member member
          JOIN face_observation face ON face.face_id = member.face_id AND face.state = 'valid'
          JOIN current_face_physical_member member_physical
            ON member_physical.face_id = member.face_id
          WHERE member.cluster_id = ${cluster.cluster_id}
            AND NOT EXISTS (
              SELECT 1
              FROM current_face_physical_member accepted_member
              JOIN identity_claim accepted ON accepted.face_id = accepted_member.face_id
                AND accepted.state = 'accepted'
                AND accepted.person_id = ${selectedPersonId}
              WHERE accepted_member.physical_face_id = member_physical.physical_face_id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM current_face_physical_member candidate_member
              JOIN identity_claim duplicate ON duplicate.face_id = candidate_member.face_id
                AND duplicate.person_id = ${selectedPersonId}
                AND duplicate.state = 'candidate'
              WHERE candidate_member.physical_face_id = member_physical.physical_face_id
            )
          ON CONFLICT (identity_claim_id) DO NOTHING
          RETURNING identity_claim_id
        `;
        candidateCount = inserted.length;
      }
      return completeCommand(tx, stableCommandId, {
        candidateCount,
        changed: true,
        createdPerson,
        decisionId,
        replayed: false,
        resolution: {
          action,
          decisionId,
          personId: action === "later" ? null : selectedPersonId,
          resolutionId: decisionId,
          state: action === "later" ? "later" : "resolved",
        },
        schemaVersion,
      });
    });
  };

  const undo = async ({ actorId, commandId, decisionId }) => {
    const actor = cleanActor(actorId);
    const stableCommandId = cleanCommandId(commandId);
    const stableDecisionId = cleanId(decisionId, "Decision ID");
    const requestDigest = digest({ decisionId: stableDecisionId });
    return sql.begin(async (tx) => {
      const command = await beginCommand(tx, {
        actorId: actor,
        commandId: stableCommandId,
        commandKind: "undo",
        requestDigest,
      });
      if (command.replay) return command.replay;
      const [decision] = await tx`
        SELECT decision_id, subject_id FROM decision
        WHERE decision_id = ${stableDecisionId}
          AND subject_type = 'face_cluster' AND reason_code = 'possible_person_later'
      `;
      if (!decision)
        throw typedError(
          "Possible person decision not found",
          404,
          "POSSIBLE_PEOPLE_DECISION_NOT_FOUND",
        );
      const undoDecisionId = stableId("decision_possible_", stableCommandId);
      await tx`
        INSERT INTO decision (
          decision_id, subject_type, subject_id, action, actor_kind, actor_id,
          reason_code, note, supersedes_decision_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${undoDecisionId}, 'face_cluster', ${decision.subject_id}, 'restore',
          'user', ${actor}, 'possible_person_restore', 'Restore recurring unnamed face group',
          ${decision.decision_id}, ${receiptId}, 'sensitive-biometric'
        )
      `;
      await tx`
        UPDATE face_cluster SET status = 'open', linked_person_id = NULL,
          current_decision_id = ${undoDecisionId}
        WHERE cluster_id = ${decision.subject_id} AND current_decision_id = ${decision.decision_id}
      `;
      return completeCommand(tx, stableCommandId, {
        changed: true,
        replayed: false,
        schemaVersion,
        state: "reverted",
      });
    });
  };

  const waitForIdle = async () => {
    while (worker || classificationWorker) {
      await (worker || classificationWorker);
    }
  };

  return {
    classifyLatest,
    knownSuggestions: projection.knownSuggestions,
    refresh,
    resolve,
    snapshot: projection.snapshot,
    undo,
    waitForIdle,
  };
};

export const possiblePeopleContract = Object.freeze({
  algorithmVersion,
  classificationVersion,
  knownPersonMarginFloor,
  knownPersonScoreFloor,
  neighbourLimit,
  schemaVersion,
  seedLimit,
  similarityFloor,
});
