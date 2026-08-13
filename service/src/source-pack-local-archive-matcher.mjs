import { randomUUID } from "node:crypto";
import { parseVector } from "./prime-curator.mjs";
import {
  normalizeSourcePackArchiveMatcherOptions,
  sourcePackArchiveMatcherContract,
  sourcePackArchiveMatcherRunawayPolicy,
} from "./source-pack-archive-matcher.mjs";
import { createSourcePackNumpyScorer } from "./source-pack-numpy-scorer.mjs";

const boundedBatchSize = (value) => {
  const parsed = value == null || value === "" ? 1_000 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 32 || parsed > 4_096) {
    throw new Error("Archive matcher batchSize must be from 32 to 4096");
  }
  return parsed;
};

const cleanRunId = (value) => {
  const normalized = String(value || "").trim();
  if (normalized.length > 200 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error("Archive matcher Possible people run ID is invalid");
  }
  return normalized;
};

const embedding = (value) => [...parseVector(value)];

export const runLocalSourcePackArchiveMatcher = async (sql, input = {}) => {
  if (typeof sql !== "function")
    throw new TypeError("Archive matcher requires a database connection");
  const options = normalizeSourcePackArchiveMatcherOptions(input);
  const batchSize = boundedBatchSize(input.batchSize);
  const possibleRunId = cleanRunId(input.possibleRunId);
  const referenceMode = new Set(["current_all", "current_prime"]).has(
    input.referenceMode,
  )
    ? input.referenceMode
    : "source_pack";
  if (options.execute && possibleRunId) {
    throw new Error(
      "A Possible people scoped replay is diagnostic-only and cannot persist proposals",
    );
  }
  if (options.execute && referenceMode !== "source_pack") {
    throw new Error(
      "Current-Prime archive scoring is diagnostic-only until a successor SourcePack passes evaluation",
    );
  }
  const scorer = createSourcePackNumpyScorer({
    pythonPath: input.pythonPath,
    scriptPath: input.scriptPath,
    timeoutMs: input.timeoutMs == null ? 300_000 : Number(input.timeoutMs),
  });
  const {
    matcherPolicyVersion,
    schemaVersion,
    scorer: scorerName,
  } = sourcePackArchiveMatcherContract;
  const startedAt = Date.now();
  try {
    return await sql.begin(async (tx) => {
      await tx`
        SELECT set_config('statement_timeout', '3600000', true),
          set_config('transaction_timeout', '3660000', true)
      `;
      const packs = await tx`
        SELECT pack.pack_id, pack.state, pack.evaluation_status,
          pack.model_family, pack.model_version, pack.config_digest,
          (pack.evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8 AS score_floor,
          (pack.evaluation_summary->'matcherPolicy'->>'marginFloor')::float8 AS margin_floor,
          (pack.evaluation_summary->'matcherPolicy'->>'fallbackScoreFloor')::float8 AS fallback_score_floor,
          (pack.evaluation_summary->'matcherPolicy'->>'fallbackMarginFloor')::float8 AS fallback_margin_floor,
          pack.evaluation_summary->'matcherPolicy'->>'policyVersion' AS policy_version,
          pack.evaluation_summary->'matcherPolicy'->>'scorer' AS scorer
        FROM source_pack pack
        WHERE (${options.packId}::text = '' OR pack.pack_id = ${options.packId})
          AND (${options.packId}::text <> '' OR pack.state = 'active')
          AND pack.evaluation_status = 'passed'
          AND pack.evaluation_summary->'matcherPolicy'->>'policyVersion' = ${matcherPolicyVersion}
          AND pack.evaluation_summary->'matcherPolicy'->>'scorer' = ${scorerName}
          AND jsonb_typeof(pack.evaluation_summary->'matcherPolicy'->'scoreFloor') = 'number'
          AND jsonb_typeof(pack.evaluation_summary->'matcherPolicy'->'marginFloor') = 'number'
        ORDER BY pack.pack_id
        ${options.execute ? tx`FOR SHARE` : tx``}
      `;
      if (packs.length !== 1) {
        throw new Error(
          `Archive matcher requires exactly one ${options.packId ? "selected" : "active"} passed SourcePack; found ${packs.length}`,
        );
      }
      const pack = packs[0];
      if (options.execute && pack.state !== "active") {
        throw new Error(
          "Archive matcher can only persist proposals from the active SourcePack",
        );
      }
      const galleryRows =
        referenceMode !== "source_pack"
          ? await tx`
        SELECT DISTINCT ON (gallery.person_id, physical.physical_face_id)
          gallery.person_id, physical.canonical_face_id AS face_id,
          reference_face.asset_id, embedding.embedding::text AS embedding,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
        FROM current_reference_gallery gallery
        JOIN current_person person ON person.person_id = gallery.person_id
          AND person.status = 'active' AND person.subject_kind = 'person'
        JOIN current_face_physical_member physical ON physical.face_id = gallery.face_id
          AND physical.reconciliation_state <> 'conflict'
        JOIN face_observation reference_face
          ON reference_face.face_id = physical.canonical_face_id
          AND reference_face.state = 'valid'
        JOIN face_embedding embedding ON embedding.face_id = physical.canonical_face_id
          AND embedding.state = 'active'
          AND embedding.model_family = ${pack.model_family}
          AND embedding.model_version = ${pack.model_version}
          AND embedding.config_digest = ${pack.config_digest}
        LEFT JOIN LATERAL (
          SELECT array_agg(capture.context_id ORDER BY capture.context_id) AS context_ids
          FROM current_face_capture_context capture
          WHERE capture.face_id = physical.canonical_face_id
        ) context ON true
        WHERE gallery.membership_state = 'active'
          AND gallery.bucket_kind = ANY (
            ${
              referenceMode === "current_all"
                ? ["prime", "secondary", "lq", "head"]
                : ["prime"]
            }::text[]
          )
          AND NOT EXISTS (
            SELECT 1 FROM current_person_category category
            WHERE category.person_id = person.person_id
              AND category.slug IN ('sort', 'holding')
          )
        ORDER BY gallery.person_id, physical.physical_face_id, gallery.face_id
      `
          : await tx`
        SELECT reference.person_id, reference.face_id, reference_face.asset_id,
          reference.embedding::text AS embedding,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
        FROM source_pack_reference reference
        JOIN current_person person ON person.person_id = reference.person_id
          AND person.status = 'active' AND person.subject_kind = 'person'
        JOIN face_observation reference_face ON reference_face.face_id = reference.face_id
          AND reference_face.state = 'valid'
        LEFT JOIN LATERAL (
          SELECT array_agg(capture.context_id ORDER BY capture.context_id) AS context_ids
          FROM current_face_capture_context capture
          WHERE capture.face_id = reference.face_id
        ) context ON true
        WHERE reference.pack_id = ${pack.pack_id}
          AND reference.bucket_kind = 'prime'
          AND reference.reference_kind = 'face'
          AND reference.routing_state = 'eligible'
          AND NOT EXISTS (
            SELECT 1 FROM current_person_category category
            WHERE category.person_id = person.person_id
              AND category.slug IN ('sort', 'holding')
          )
        ORDER BY reference.person_id, reference.face_id
      `;
      const scoreFloor =
        referenceMode !== "source_pack"
          ? 0.55
          : Math.min(
              Number(pack.score_floor),
              Number(pack.fallback_score_floor ?? pack.score_floor),
            );
      const marginFloor = referenceMode !== "source_pack" ? 0.1 : 0;
      await scorer.initialize(
        galleryRows.map((row) => ({
          assetId: row.asset_id,
          contextIds: row.context_ids,
          embedding: embedding(row.embedding),
          faceId: row.face_id,
          personId: row.person_id,
        })),
      );
      const matches = [];
      let queriedFaces = 0;
      const query = tx`
        WITH scoped_faces AS MATERIALIZED (
          SELECT DISTINCT member.face_id
          FROM face_cluster cluster
          JOIN face_cluster_member member ON member.cluster_id = cluster.cluster_id
          WHERE ${possibleRunId}::text <> ''
            AND cluster.possible_person_run_id = ${possibleRunId}
            AND cluster.status = 'open'
            AND mod(
              abs(hashtextextended(member.face_id, 0)), ${options.laneCount}
            ) = ${options.laneIndex}
          ORDER BY member.face_id
          ${possibleRunId && options.limitFaces > 0 ? tx`LIMIT ${options.limitFaces}` : tx``}
        ), accepted_physical_faces AS MATERIALIZED (
          SELECT DISTINCT member.physical_face_id
          FROM current_face_physical_member member
          JOIN identity_claim accepted ON accepted.face_id = member.face_id
            AND accepted.state = 'accepted'
          WHERE ${possibleRunId}::text = ''
        ), latest_face_reviews AS MATERIALIZED (
          SELECT DISTINCT ON (review.subject_id)
            review.subject_id AS face_id, review.reason_code
          FROM decision review
          WHERE ${possibleRunId}::text = ''
            AND review.subject_type = 'face_review'
          ORDER BY review.subject_id, review.created_at DESC, review.decision_id DESC
        ), latest_machine_suggestion_decisions AS MATERIALIZED (
          SELECT DISTINCT ON (review.subject_id)
            review.subject_id, review.action
          FROM decision review
          WHERE ${possibleRunId}::text = ''
            AND review.subject_type = 'machine_suggestion'
            AND review.actor_kind = 'user'
          ORDER BY review.subject_id, review.created_at DESC, review.decision_id DESC
        ), face_contexts AS MATERIALIZED (
          SELECT capture.face_id,
            array_agg(capture.context_id ORDER BY capture.context_id) AS context_ids
          FROM current_face_capture_context capture
          GROUP BY capture.face_id
        ), accepted_people_by_asset AS MATERIALIZED (
          SELECT accepted_face.asset_id,
            array_agg(DISTINCT accepted.person_id ORDER BY accepted.person_id) AS person_ids
          FROM identity_claim accepted
          JOIN current_face_physical_member accepted_member
            ON accepted_member.face_id = accepted.face_id
          JOIN face_observation accepted_face
            ON accepted_face.face_id = accepted_member.canonical_face_id
            AND accepted_face.state = 'valid'
          WHERE ${possibleRunId}::text = '' AND accepted.state = 'accepted'
          GROUP BY accepted_face.asset_id
        ), bounded AS MATERIALIZED (
          SELECT face.face_id, face.physical_face_id, face.asset_id,
            embedding.embedding::text AS embedding
          FROM current_matchable_physical_face face
          ${possibleRunId ? tx`JOIN scoped_faces scope ON scope.face_id = face.face_id` : tx``}
          JOIN face_embedding embedding ON embedding.face_id = face.face_id
            AND embedding.state = 'active'
            AND embedding.model_family = ${pack.model_family}
            AND embedding.model_version = ${pack.model_version}
            AND embedding.config_digest = ${pack.config_digest}
          JOIN asset ON asset.asset_id = face.asset_id
            AND asset.state = 'active' AND asset.media_kind = 'image'
          LEFT JOIN accepted_physical_faces accepted_physical
            ON accepted_physical.physical_face_id = face.physical_face_id
          LEFT JOIN latest_face_reviews face_review
            ON face_review.face_id = face.face_id
          LEFT JOIN latest_machine_suggestion_decisions dismissed
            ON dismissed.subject_id = face.face_id || ':' ||
              ${pack.model_version} || ':' || ${pack.config_digest} || ':' ||
              ${pack.policy_version}
          WHERE cimmich_face_match_eligible(
              face.detection_confidence, face.box_w, face.box_h
            )
            ${
              possibleRunId
                ? tx``
                : tx`AND accepted_physical.physical_face_id IS NULL
            AND coalesce(face_review.reason_code, '') NOT IN (
              'face_review_unknown', 'face_review_later', 'face_review_geometry'
            )
            AND coalesce(dismissed.action, '') <> 'ignore'
            `
            }
            AND (
              ${possibleRunId}::text <> ''
              OR mod(
                abs(hashtextextended(face.face_id, 0)), ${options.laneCount}
              ) = ${options.laneIndex}
            )
          ORDER BY face.face_id
          ${!possibleRunId && options.limitFaces > 0 ? tx`LIMIT ${options.limitFaces}` : tx``}
        )
        SELECT bounded.*,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids,
          ${
            possibleRunId
              ? tx`ARRAY[]::text[]`
              : tx`coalesce(same_photo.person_ids, ARRAY[]::text[])`
          } AS excluded_person_ids
        FROM bounded
        LEFT JOIN face_contexts context ON context.face_id = bounded.face_id
        ${
          possibleRunId
            ? tx``
            : tx`LEFT JOIN accepted_people_by_asset same_photo
          ON same_photo.asset_id = bounded.asset_id
        `
        }
        ORDER BY bounded.face_id
      `;
      for await (const rows of query.cursor(batchSize)) {
        queriedFaces += rows.length;
        matches.push(
          ...(await scorer.score({
            marginFloor,
            queries: rows.map((row) => ({
              assetId: row.asset_id,
              contextIds: row.context_ids,
              embedding: embedding(row.embedding),
              excludedPersonIds: row.excluded_person_ids,
              faceId: row.face_id,
              physicalFaceId: row.physical_face_id,
            })),
            scoreFloor,
          })),
        );
      }
      await tx`
        CREATE TEMP TABLE cimmich_local_archive_match_result (
          face_id text PRIMARY KEY, physical_face_id text NOT NULL,
          asset_id text NOT NULL, person_id text NOT NULL,
          score float8 NOT NULL, next_score float8, margin float8 NOT NULL,
          reference_face_id text NOT NULL, reference_asset_id text NOT NULL
        ) ON COMMIT DROP
      `;
      for (let offset = 0; offset < matches.length; offset += 1_000) {
        const rows = matches.slice(offset, offset + 1_000).map((row) => ({
          asset_id: row.assetId,
          face_id: row.faceId,
          margin: row.margin,
          next_score: row.nextScore,
          person_id: row.personId,
          physical_face_id: row.physicalFaceId,
          reference_asset_id: row.referenceAssetId,
          reference_face_id: row.referenceFaceId,
          score: row.score,
        }));
        if (rows.length)
          await tx`INSERT INTO cimmich_local_archive_match_result ${tx(rows)}`;
      }
      if (referenceMode === "source_pack")
        await tx`
        DELETE FROM cimmich_local_archive_match_result result
        WHERE NOT (
          (result.score >= ${Number(pack.score_floor)}
            AND result.margin >= ${Number(pack.margin_floor)})
          OR (result.score >= ${Number(pack.fallback_score_floor ?? pack.score_floor)}
            AND result.margin >= ${Number(pack.fallback_margin_floor ?? pack.margin_floor)})
        ) OR cimmich_probable_same_photo_derivative(
            ${pack.pack_id}, result.asset_id, result.reference_asset_id
          )
      `;
      const [scored] = await tx`
        SELECT count(*)::int AS qualified_faces,
          count(DISTINCT physical_face_id)::int AS qualified_physical_faces,
          count(DISTINCT asset_id)::int AS qualified_assets,
          count(DISTINCT person_id)::int AS suggested_people,
          min(score)::float8 AS minimum_score, max(score)::float8 AS maximum_score,
          avg(score)::float8 AS average_score, min(margin)::float8 AS minimum_margin,
          max(margin)::float8 AS maximum_margin
        FROM cimmich_local_archive_match_result
      `;
      const runawayPeople = possibleRunId
        ? []
        : await tx`
            WITH accepted AS (
              SELECT person_id,
                count(DISTINCT physical_face_id)::int AS face_count
              FROM current_physical_face_identity
              WHERE state = 'accepted'
              GROUP BY person_id
            )
            SELECT result.person_id, person.display_name,
              count(*)::int AS suggestion_count,
              coalesce(accepted.face_count, 0)::int AS accepted_face_count
            FROM cimmich_local_archive_match_result result
            JOIN current_person person ON person.person_id = result.person_id
            LEFT JOIN accepted ON accepted.person_id = result.person_id
            GROUP BY result.person_id, person.display_name, accepted.face_count
            HAVING count(*) > greatest(
              ${sourcePackArchiveMatcherRunawayPolicy.absoluteSuggestionFloor},
              coalesce(accepted.face_count, 0) *
                ${sourcePackArchiveMatcherRunawayPolicy.maximumAcceptedFaceMultiplier}
            )
            ORDER BY suggestion_count DESC, result.person_id
          `;
      const people = await tx`
        SELECT result.person_id, person.display_name, count(*)::int AS face_count
        FROM cimmich_local_archive_match_result result
        JOIN current_person person ON person.person_id = result.person_id
        GROUP BY result.person_id, person.display_name
        ORDER BY face_count DESC, person.display_name, result.person_id
        LIMIT 25
      `;
      const clusters = possibleRunId
        ? await tx`
            WITH votes AS MATERIALIZED (
              SELECT member.cluster_id, result.person_id,
                count(*)::int AS matching_faces,
                avg(result.score)::float8 AS average_score,
                max(result.score)::float8 AS best_score
              FROM cimmich_local_archive_match_result result
              JOIN face_cluster_member member ON member.face_id = result.face_id
              JOIN face_cluster cluster ON cluster.cluster_id = member.cluster_id
                AND cluster.possible_person_run_id = ${possibleRunId}
              GROUP BY member.cluster_id, result.person_id
            ), ranked AS (
              SELECT votes.*,
                row_number() OVER (
                  PARTITION BY votes.cluster_id
                  ORDER BY votes.matching_faces DESC, votes.best_score DESC,
                    votes.person_id
                ) AS vote_rank
              FROM votes
            )
            SELECT ranked.cluster_id, cluster.member_count,
              ranked.person_id, person.display_name, ranked.matching_faces,
              (ranked.matching_faces::float8 / cluster.member_count)::float8
                AS matching_fraction,
              ranked.average_score, ranked.best_score,
              (SELECT count(*)::int FROM ranked alternative
                WHERE alternative.cluster_id = ranked.cluster_id
                  AND alternative.vote_rank > 1) AS alternative_people
            FROM ranked
            JOIN face_cluster cluster ON cluster.cluster_id = ranked.cluster_id
            JOIN current_person person ON person.person_id = ranked.person_id
            WHERE ranked.vote_rank = 1 AND ranked.matching_faces >= 2
            ORDER BY ranked.matching_faces DESC, ranked.best_score DESC,
              ranked.cluster_id
            LIMIT 100
          `
        : [];
      const consensusClusters = possibleRunId
        ? await tx`
            WITH tiled_members AS MATERIALIZED (
              SELECT cluster.cluster_id, cluster.representative_face_id,
                member.face_id, member.rank,
                ntile(12) OVER (
                  PARTITION BY cluster.cluster_id ORDER BY member.rank
                ) AS sample_tile
              FROM face_cluster cluster
              JOIN face_cluster_member member ON member.cluster_id = cluster.cluster_id
              WHERE cluster.possible_person_run_id = ${possibleRunId}
                AND cluster.status = 'open'
            ), sampled_members AS MATERIALIZED (
              SELECT DISTINCT ON (cluster_id, sample_tile)
                cluster_id, face_id
              FROM tiled_members
              ORDER BY cluster_id, sample_tile,
                (face_id = representative_face_id) DESC, rank, face_id
            ), sample_counts AS MATERIALIZED (
              SELECT cluster_id, count(*)::int AS sampled_face_count
              FROM sampled_members GROUP BY cluster_id
            ), votes AS MATERIALIZED (
              SELECT sample.cluster_id, result.person_id,
                count(*)::int AS matching_faces,
                avg(result.score)::float8 AS average_score,
                max(result.score)::float8 AS best_score
              FROM sampled_members sample
              JOIN cimmich_local_archive_match_result result
                ON result.face_id = sample.face_id
              GROUP BY sample.cluster_id, result.person_id
            ), ranked AS MATERIALIZED (
              SELECT votes.*,
                row_number() OVER (
                  PARTITION BY votes.cluster_id
                  ORDER BY votes.matching_faces DESC, votes.best_score DESC,
                    votes.person_id
                ) AS vote_rank,
                count(*) OVER (PARTITION BY votes.cluster_id)::int AS eligible_people
              FROM votes
            )
            SELECT ranked.cluster_id, cluster.member_count,
              ranked.person_id, person.display_name, ranked.matching_faces,
              sample.sampled_face_count,
              (ranked.matching_faces::float8 / sample.sampled_face_count)::float8
                AS matching_fraction,
              ranked.average_score, ranked.best_score, ranked.eligible_people
            FROM ranked
            JOIN sample_counts sample ON sample.cluster_id = ranked.cluster_id
            JOIN face_cluster cluster ON cluster.cluster_id = ranked.cluster_id
            JOIN current_person person ON person.person_id = ranked.person_id
            WHERE ranked.vote_rank = 1 AND ranked.eligible_people = 1
              AND ranked.matching_faces >= 2
              AND ranked.matching_faces::float8 / sample.sampled_face_count >= 0.5
            ORDER BY ranked.matching_faces DESC, ranked.best_score DESC,
              ranked.cluster_id
            LIMIT 100
          `
        : [];
      const base = {
        acceptedIdentityDelta: 0,
        automaticIdentityWrites: 0,
        compute: "local_numpy",
        clusters,
        consensusClusters,
        elapsedMilliseconds: Date.now() - startedAt,
        execute: options.execute,
        laneCount: options.laneCount,
        laneIndex: options.laneIndex,
        matcher: {
          marginFloor:
            referenceMode === "source_pack"
              ? Number(pack.margin_floor)
              : marginFloor,
          fallbackMarginFloor:
            pack.fallback_margin_floor == null
              ? null
              : Number(pack.fallback_margin_floor),
          fallbackScoreFloor:
            pack.fallback_score_floor == null
              ? null
              : Number(pack.fallback_score_floor),
          packId: pack.pack_id,
          packState: pack.state,
          policyVersion: pack.policy_version,
          referenceMode,
          scoreFloor:
            referenceMode === "source_pack"
              ? Number(pack.score_floor)
              : scoreFloor,
          scorer: pack.scorer,
        },
        people,
        possibleRunId: possibleRunId || null,
        referenceCount: galleryRows.length,
        queriedFaces,
        queryLimit: options.limitFaces || null,
        runawayPeople,
        runawayPolicy: sourcePackArchiveMatcherRunawayPolicy,
        schemaVersion,
        scored,
        sourceMediaWrite: "none",
      };
      if (!options.execute) {
        return {
          ...base,
          candidatesInserted: 0,
          nextStep:
            "activate_successor_then_persist_before_possible_people_refresh",
          state: "dry_run_complete",
        };
      }
      if (runawayPeople.length > 0) {
        throw new Error(
          `Archive matcher refuses runaway suggestion fanout for ${runawayPeople.map((row) => row.person_id).join(", ")}`,
        );
      }
      const receiptId = `receipt_sourcepack_archive_match_${randomUUID().replaceAll("-", "")}`;
      await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name, producer_version,
          config_digest, started_at, completed_at, privacy_class
        ) VALUES (
          ${receiptId}, 'model', 'cimmich-sourcepack-archive-matcher-local',
          ${pack.policy_version}, ${pack.config_digest}, now(), now(),
          'sensitive-biometric'
        )
      `;
      const inserted = await tx`
        INSERT INTO identity_claim (
          identity_claim_id, face_id, person_id, origin, state,
          calibrated_confidence, evidence_refs, producer_receipt_id, privacy_class
        )
        SELECT 'claim_spmatch_' || encode(digest(
            ${pack.pack_id}::text || ':' || result.face_id || ':' ||
              result.person_id || ':' || ${pack.policy_version}::text,
            'sha256'
          ), 'hex'),
          result.face_id, result.person_id, 'prime_match', 'candidate',
          least(1::float8, greatest(0::float8, result.score)),
          jsonb_build_object(
            'algorithm', ${scorerName}::text,
            'assignment_decision', 'source_pack_prime_match',
            'authority', 'human_review_only',
            'automatic_acceptance', false,
            'automatic_identity_acceptance', false,
            'best_score', least(1::float8, greatest(-1::float8, result.score)),
            'margin', result.margin,
            'physical_face_id', result.physical_face_id,
            'policy_version', ${pack.policy_version}::text,
            'reference_asset_id', result.reference_asset_id,
            'reference_face_id', result.reference_face_id,
            'second_best_score', result.next_score,
            'source_pack_id', ${pack.pack_id}::text
          ),
          ${receiptId}, 'sensitive-biometric'
        FROM cimmich_local_archive_match_result result
        ON CONFLICT (identity_claim_id) DO NOTHING
        RETURNING identity_claim_id
      `;
      return {
        ...base,
        candidatesInserted: inserted.length,
        nextStep: "refresh_possible_people_after_all_match_lanes_complete",
        producerReceiptId: receiptId,
        state: "archive_match_complete",
      };
    });
  } finally {
    scorer.stop();
  }
};
