import { readKnownPersonClusterPreviews } from "./known-person-cluster-previews.mjs";

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

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

const previewBatchLimit = 20;

export const normalizePossiblePeoplePreviewClusterIds = (values) => {
  if (!Array.isArray(values)) {
    throw typedError(
      "Possible person cluster IDs are required",
      400,
      "POSSIBLE_PEOPLE_PREVIEW_INPUT_INVALID",
    );
  }
  const ids = [...new Set(values.map((value) => cleanId(value, "Cluster ID")))];
  if (ids.length === 0 || ids.length > previewBatchLimit) {
    throw typedError(
      `Choose between 1 and ${previewBatchLimit} possible person clusters`,
      400,
      "POSSIBLE_PEOPLE_PREVIEW_INPUT_INVALID",
    );
  }
  return ids;
};

export const projectPossiblePeopleRun = (row) =>
  row
    ? {
        classificationState: row.classification_state || "pending",
        classifiedClusterCount: Number(row.classified_cluster_count || 0),
        clusterCount: Number(row.cluster_count),
        completedAt: row.completed_at,
        createdAt: row.created_at,
        edgeCount: Number(row.edge_count),
        errorCode: row.error_code,
        errorMessage: row.error_message,
        processedSeeds: Number(row.processed_seeds),
        runId: row.run_id,
        startedAt: row.started_at,
        state:
          row.state === "completed" && row.classification_state === "failed"
            ? "failed"
            : row.state === "completed" &&
                row.classification_state !== "completed"
              ? "running"
              : row.state,
        totalSeeds: Number(row.total_seeds),
      }
    : null;

export const readLatestPossiblePeopleRuns = async (
  sql,
  algorithmVersion = null,
) => {
  const [completed] = await sql`
    SELECT * FROM possible_person_run
    WHERE state = 'completed' AND classification_state = 'completed'
      AND (${algorithmVersion}::text IS NULL OR algorithm_version = ${algorithmVersion})
    ORDER BY completed_at DESC, run_id DESC LIMIT 1
  `;
  const [active] = await sql`
    SELECT * FROM possible_person_run
    WHERE (state IN ('queued','running','failed')
      OR (state = 'completed' AND classification_state <> 'completed'))
      AND (${algorithmVersion}::text IS NULL OR algorithm_version = ${algorithmVersion})
      AND (${completed?.created_at || null}::timestamptz IS NULL
        OR created_at > ${completed?.created_at || null}::timestamptz)
    ORDER BY created_at DESC, run_id DESC LIMIT 1
  `;
  return { active, completed };
};

export const createPossiblePeopleProjection = (
  sql,
  { algorithmVersion = null, schemaVersion },
) => {
  const snapshot = async () => {
    const { active, completed } = await readLatestPossiblePeopleRuns(
      sql,
      algorithmVersion,
    );
    const rows = completed
      ? await sql`
          SELECT cluster.cluster_id, cluster.status, cluster.linked_person_id,
            cluster.cluster_digest, cluster.source_revision, cluster.evidence,
            cluster.current_decision_id, face.face_id, face.box_x::float8,
            face.box_y::float8, face.box_w::float8, face.box_h::float8,
            asset.width, asset.height,
            projection.immich_asset_id AS source_asset_id
          FROM face_cluster cluster
          JOIN face_observation face ON face.face_id = cluster.representative_face_id
          JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
          LEFT JOIN LATERAL (
            SELECT current_projection.immich_asset_id
            FROM immich_asset_projection current_projection
            WHERE current_projection.cimmich_asset_id = asset.asset_id
              AND current_projection.state = 'active'
            ORDER BY current_projection.last_seen_at DESC, current_projection.source_id
            LIMIT 1
          ) projection ON true
          WHERE cluster.possible_person_run_id = ${completed.run_id}
            AND cluster.suggested_person_id IS NULL
            AND cluster.status IN ('open','closed','linked')
          ORDER BY (cluster.evidence->>'photoCount')::int DESC, cluster.cluster_id
        `
      : [];
    return {
      activeRun: projectPossiblePeopleRun(active),
      clusters: rows
        .filter((row) => row.source_asset_id)
        .map((row) => ({
          evidence: row.evidence,
          faceCount: Number(row.evidence?.faceCount || 0),
          immichPersonId: row.cluster_id,
          representative: {
            assetInputRevision: row.source_revision,
            box: { h: row.box_h, w: row.box_w, x: row.box_x, y: row.box_y },
            faceId: row.face_id,
            height: row.height,
            sourceAssetId: row.source_asset_id,
            width: row.width,
          },
          resolution:
            row.status === "closed"
              ? {
                  action: "later",
                  decisionId: row.current_decision_id,
                  personId: null,
                  resolutionId: row.current_decision_id,
                  state: "later",
                }
              : row.status === "linked"
                ? {
                    action: "existing_person",
                    decisionId: row.current_decision_id,
                    personId: row.linked_person_id,
                    resolutionId: row.current_decision_id,
                    state: "resolved",
                  }
                : { state: "unresolved" },
          snapshotDigest: row.cluster_digest,
          sourceRevision: row.source_revision,
        })),
      completedRun: projectPossiblePeopleRun(completed),
      schemaVersion,
    };
  };

  const knownSuggestions = async ({ personId }) => {
    const selectedPersonId = cleanId(personId, "Person ID");
    const [person] = await sql`
      SELECT person_id FROM current_person
      WHERE person_id = ${selectedPersonId} AND status = 'active' LIMIT 1
    `;
    if (!person)
      throw typedError("Active Person not found", 404, "PERSON_NOT_FOUND");
    const { completed } = await readLatestPossiblePeopleRuns(
      sql,
      algorithmVersion,
    );
    const rows = completed
      ? await sql`
          SELECT cluster.cluster_id, cluster.cluster_digest, cluster.source_revision,
            cluster.evidence, cluster.suggestion_evidence, face.face_id,
            face.box_x::float8, face.box_y::float8,
            face.box_w::float8, face.box_h::float8,
            asset.width, asset.height,
            projection.immich_asset_id AS source_asset_id
          FROM face_cluster cluster
          JOIN face_observation face ON face.face_id = cluster.representative_face_id
          JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
          LEFT JOIN LATERAL (
            SELECT current_projection.immich_asset_id
            FROM immich_asset_projection current_projection
            WHERE current_projection.cimmich_asset_id = asset.asset_id
              AND current_projection.state = 'active'
            ORDER BY current_projection.last_seen_at DESC, current_projection.source_id
            LIMIT 1
          ) projection ON true
          WHERE cluster.possible_person_run_id = ${completed.run_id}
            AND cluster.status = 'open'
            AND cluster.suggested_person_id = ${selectedPersonId}
          ORDER BY (cluster.evidence->>'photoCount')::int DESC, cluster.cluster_id
        `
      : [];
    const previews = await readKnownPersonClusterPreviews(
      sql,
      rows.map((row) => row.cluster_id),
    );
    return {
      items: rows
        .filter((row) => row.source_asset_id)
        .map((row) => ({
          clusterId: row.cluster_id,
          evidence: row.evidence,
          faceCount: Number(row.evidence?.faceCount || 0),
          match: {
            classificationVersion:
              row.suggestion_evidence?.classificationVersion,
            leadScore: Number(row.suggestion_evidence?.leadScore || 0),
            margin:
              row.suggestion_evidence?.margin == null
                ? null
                : Number(row.suggestion_evidence.margin),
            referenceFaceId: row.suggestion_evidence?.referenceFaceId || null,
            runnerPersonId: row.suggestion_evidence?.runnerPersonId || null,
            runnerScore:
              row.suggestion_evidence?.runnerScore == null
                ? null
                : Number(row.suggestion_evidence.runnerScore),
          },
          representative: {
            box: { h: row.box_h, w: row.box_w, x: row.box_x, y: row.box_y },
            faceId: row.face_id,
            height: row.height,
            sourceAssetId: row.source_asset_id,
            width: row.width,
          },
          previews: previews.get(row.cluster_id) || [],
          snapshotDigest: row.cluster_digest,
          sourceRevision: row.source_revision,
        })),
      schemaVersion: "cimmich.known-person-cluster-suggestions.v2",
    };
  };

  const previews = async ({ clusterIds }) => {
    const selectedClusterIds =
      normalizePossiblePeoplePreviewClusterIds(clusterIds);
    const { completed } = await readLatestPossiblePeopleRuns(
      sql,
      algorithmVersion,
    );
    if (!completed) {
      return {
        items: [],
        runId: null,
        schemaVersion: "cimmich.possible-person-previews.v1",
      };
    }
    const rows = await sql`
      SELECT cluster_id
      FROM face_cluster
      WHERE possible_person_run_id = ${completed.run_id}
        AND cluster_id = ANY(${selectedClusterIds}::text[])
        AND suggested_person_id IS NULL
        AND status IN ('open','closed','linked')
      ORDER BY array_position(${selectedClusterIds}::text[], cluster_id)
    `;
    const eligibleClusterIds = rows.map((row) => row.cluster_id);
    const grouped = await readKnownPersonClusterPreviews(
      sql,
      eligibleClusterIds,
    );
    return {
      items: eligibleClusterIds.map((clusterId) => ({
        clusterId,
        previews: grouped.get(clusterId) || [],
      })),
      runId: completed.run_id,
      schemaVersion: "cimmich.possible-person-previews.v1",
    };
  };

  return { knownSuggestions, previews, snapshot };
};

export const possiblePeoplePreviewBatchLimit = previewBatchLimit;
