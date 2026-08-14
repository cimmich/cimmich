import { createHash, randomUUID } from "node:crypto";

import { sourcePackArchiveMatcherContract } from "./source-pack-archive-matcher.mjs";

export const personMatchRefreshContract = Object.freeze({
  nearestPerReference: 500,
  policyVersion: "cimmich-person-match-refresh-v1",
  schemaVersion: "cimmich.person-match-refresh.v1",
});

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

const calibratedMatcher = async (sql) => {
  const { matcherPolicyVersion, scorer } = sourcePackArchiveMatcherContract;
  const [pack] = await sql`
    SELECT pack_id, model_family, model_version, config_digest, dimension,
      (evaluation_summary->'matcherPolicy'->>'scoreFloor')::float8
        AS score_floor,
      (evaluation_summary->'matcherPolicy'->>'marginFloor')::float8
        AS margin_floor
    FROM source_pack
    WHERE evaluation_status = 'passed'
      AND evaluation_summary->'matcherPolicy'->>'policyVersion' =
        ${matcherPolicyVersion}
      AND evaluation_summary->'matcherPolicy'->>'scorer' = ${scorer}
      AND jsonb_typeof(
        evaluation_summary->'matcherPolicy'->'scoreFloor'
      ) = 'number'
      AND jsonb_typeof(
        evaluation_summary->'matcherPolicy'->'marginFloor'
      ) = 'number'
    ORDER BY (state = 'active') DESC, created_at DESC, pack_id DESC
    LIMIT 1
  `;
  return pack;
};

export const createPersonMatchRefresher = ({
  cleanActor,
  refreshPrime,
  requireVisibleSubject,
  sql,
}) => ({
  async refresh({ actorId, personId }) {
    const actor = cleanActor(actorId);
    if (!actor) {
      throw typedError("Missing Cimmich actor", 400, "CIMMICH_ACTOR_REQUIRED");
    }
    const id = String(personId || "").trim();
    const subject = await requireVisibleSubject(id);
    if (subject.subject_kind !== "person") {
      throw typedError(
        "Matcher-photo refresh is available only for People",
        409,
        "PERSON_MATCH_REFRESH_SUBJECT_KIND",
      );
    }

    // A Person refresh builds a fresh target reference set and persists its
    // own freshness proof. A retired SourcePack therefore remains valid as the
    // immutable calibrated model/policy contract; its stale identity members
    // are never reused below. Check this cheap contract before doing derived
    // Prime maintenance so an unavailable matcher fails immediately.
    const pack = await calibratedMatcher(sql);
    if (!pack) {
      throw typedError(
        "The calibrated matcher is not ready",
        503,
        "PERSON_MATCH_REFRESH_MATCHER_UNAVAILABLE",
      );
    }
    if (Number(pack.dimension) !== 512) {
      throw typedError(
        "Person matcher refresh requires the production 512-dimension face space",
        503,
        "PERSON_MATCH_REFRESH_DIMENSION_UNAVAILABLE",
      );
    }
    await refreshPrime(id);
    const runId = `personmatch_${randomUUID().replaceAll("-", "")}`;
    const receiptId = `receipt_${runId}`;
    const result = await sql.begin(async (tx) => {
      await tx`
        SELECT set_config('statement_timeout', '60000', true),
          set_config('transaction_timeout', '65000', true),
          set_config('ivfflat.probes', '8', true),
          pg_advisory_xact_lock(hashtextextended(${"person-match-refresh:" + id}, 0))
      `;
      const [person] = await tx`
        SELECT person_id, display_name
        FROM current_person
        WHERE person_id = ${id} AND status = 'active'
          AND subject_kind = 'person'
      `;
      if (!person) {
        throw typedError("Active Person not found", 404, "PERSON_NOT_FOUND");
      }
      const references = await tx`
        SELECT DISTINCT ON (physical.physical_face_id)
          physical.canonical_face_id AS face_id, face.asset_id,
          embedding.vector_digest, embedding.embedding::text AS embedding
        FROM current_reference_gallery gallery
        JOIN current_face_physical_member physical
          ON physical.face_id = gallery.face_id
          AND physical.reconciliation_state <> 'conflict'
        JOIN face_observation face
          ON face.face_id = physical.canonical_face_id
          AND face.state = 'valid'
        JOIN face_embedding embedding
          ON embedding.face_id = physical.canonical_face_id
          AND embedding.state = 'active'
          AND embedding.model_family = ${pack.model_family}
          AND embedding.model_version = ${pack.model_version}
          AND embedding.config_digest = ${pack.config_digest}
        WHERE gallery.person_id = ${id}
          AND gallery.membership_state = 'active'
          AND gallery.bucket_kind = 'prime'
          AND EXISTS (
            SELECT 1
            FROM current_face_physical_member identity_member
            JOIN identity_claim accepted
              ON accepted.face_id = identity_member.face_id
              AND accepted.state = 'accepted'
              AND accepted.person_id = ${id}
            WHERE identity_member.physical_face_id = physical.physical_face_id
          )
        ORDER BY physical.physical_face_id, physical.canonical_face_id
      `;
      const referenceSetDigest = createHash("sha256")
        .update(
          references
            .map((reference) =>
              [
                reference.face_id,
                reference.asset_id,
                reference.vector_digest,
              ].join(":"),
            )
            .sort()
            .join("\n"),
        )
        .digest("hex");

      await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name,
          producer_version, config_digest, started_at, completed_at,
          privacy_class
        ) VALUES (
          ${receiptId}, 'model', 'cimmich-person-match-refresh',
          ${personMatchRefreshContract.policyVersion}, ${pack.config_digest},
          now(), now(), 'sensitive-biometric'
        )
      `;
      await tx`
        INSERT INTO person_match_refresh_run (
          run_id, person_id, state, model_family, model_version,
          config_digest, policy_version, score_floor, margin_floor,
          reference_set_digest, reference_count, actor_id,
          producer_receipt_id
        ) VALUES (
          ${runId}, ${id}, 'processing', ${pack.model_family},
          ${pack.model_version}, ${pack.config_digest},
          ${personMatchRefreshContract.policyVersion},
          ${Number(pack.score_floor)}, ${Number(pack.margin_floor)},
          ${referenceSetDigest}, ${references.length}, ${actor}, ${receiptId}
        )
      `;
      if (references.length > 0) {
        await tx`
          INSERT INTO person_match_refresh_reference (
            run_id, face_id, asset_id, vector_digest
          )
          SELECT ${runId}, reference.face_id, reference.asset_id,
            reference.vector_digest
          FROM jsonb_to_recordset(${tx.json(references)}::jsonb)
            AS reference(face_id text, asset_id text, vector_digest text)
        `;
      }
      const frontierByFace = new Map();
      for (const reference of references) {
        const nearest = await tx`
          SELECT query_embedding.face_id,
            (1 - (query_embedding.embedding::vector(512) <=>
              ${reference.embedding}::vector(512)))::float8 AS target_score
          FROM face_embedding query_embedding
          WHERE query_embedding.state = 'active'
            AND query_embedding.dimension = 512
            AND query_embedding.model_family = ${pack.model_family}
            AND query_embedding.model_version = ${pack.model_version}
            AND query_embedding.config_digest = ${pack.config_digest}
          ORDER BY query_embedding.embedding::vector(512) <=>
            ${reference.embedding}::vector(512)
          LIMIT ${personMatchRefreshContract.nearestPerReference}
        `;
        for (const candidate of nearest) {
          const current = frontierByFace.get(candidate.face_id);
          if (
            !current ||
            Number(candidate.target_score) > Number(current.target_score) ||
            (Number(candidate.target_score) === Number(current.target_score) &&
              reference.face_id < current.reference_face_id)
          ) {
            frontierByFace.set(candidate.face_id, {
              face_id: candidate.face_id,
              reference_face_id: reference.face_id,
              target_score: Number(candidate.target_score),
            });
          }
        }
      }
      const frontier = [...frontierByFace.values()];
      await tx`
        CREATE TEMP TABLE cimmich_person_match_refresh_frontier (
          face_id text PRIMARY KEY,
          reference_face_id text NOT NULL,
          target_score float8 NOT NULL
        ) ON COMMIT DROP
      `;
      if (frontier.length > 0) {
        await tx`
          INSERT INTO cimmich_person_match_refresh_frontier (
            face_id, reference_face_id, target_score
          )
          SELECT row.face_id, row.reference_face_id, row.target_score
          FROM jsonb_to_recordset(${tx.json(frontier)}::jsonb)
            AS row(
              face_id text, reference_face_id text, target_score float8
            )
        `;
      }
      await tx`
        CREATE TEMP TABLE cimmich_person_match_refresh_competitor
        ON COMMIT DROP AS
        SELECT gallery.person_id, gallery.face_id,
          reference_face.asset_id,
          reference_embedding.embedding::vector(512) AS embedding,
          coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
        FROM current_reference_gallery gallery
        JOIN current_person other_person
          ON other_person.person_id = gallery.person_id
          AND other_person.status = 'active'
          AND other_person.subject_kind = 'person'
        JOIN face_observation reference_face
          ON reference_face.face_id = gallery.face_id
          AND reference_face.state = 'valid'
        JOIN face_embedding reference_embedding
          ON reference_embedding.face_id = gallery.face_id
          AND reference_embedding.state = 'active'
          AND reference_embedding.model_family = ${pack.model_family}
          AND reference_embedding.model_version = ${pack.model_version}
          AND reference_embedding.config_digest = ${pack.config_digest}
        JOIN current_face_identity accepted
          ON accepted.face_id = gallery.face_id
          AND accepted.person_id = gallery.person_id
          AND accepted.state = 'accepted'
        LEFT JOIN LATERAL (
          SELECT array_agg(capture.context_id ORDER BY capture.context_id)
            AS context_ids
          FROM current_face_capture_context capture
          WHERE capture.face_id = gallery.face_id
        ) context ON true
        WHERE gallery.person_id <> ${id}
          AND gallery.membership_state = 'active'
          AND gallery.bucket_kind = 'prime'
          AND NOT EXISTS (
            SELECT 1 FROM current_person_category category
            WHERE category.person_id = gallery.person_id
              AND category.slug IN ('sort', 'holding')
          )
      `;
      await tx`
        CREATE INDEX cimmich_person_match_refresh_competitor_vector
        ON cimmich_person_match_refresh_competitor
        USING ivfflat (embedding vector_cosine_ops) WITH (lists = 64)
      `;
      await tx`ANALYZE cimmich_person_match_refresh_competitor`;

      const [before] = await tx`
        SELECT count(*) FILTER (WHERE state = 'accepted')::int
          AS accepted_identities
        FROM identity_claim
      `;
      await tx`
        CREATE TEMP TABLE cimmich_person_match_refresh_target
        ON COMMIT DROP AS
        WITH reference_contexts AS MATERIALIZED (
          SELECT reference.face_id,
            coalesce(array_agg(context.context_id ORDER BY context.context_id)
              FILTER (WHERE context.context_id IS NOT NULL), ARRAY[]::text[])
              AS context_ids
          FROM person_match_refresh_reference reference
          LEFT JOIN current_face_capture_context context
            ON context.face_id = reference.face_id
          WHERE reference.run_id = ${runId}
          GROUP BY reference.face_id
        ), nearest_raw AS MATERIALIZED (
          SELECT frontier.reference_face_id,
            reference.asset_id AS reference_asset_id,
            reference_context.context_ids AS reference_context_ids,
            query_face.face_id, query_face.physical_face_id,
            query_face.asset_id,
            candidate_embedding.embedding::vector(512) AS embedding,
            coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids,
            frontier.target_score
          FROM cimmich_person_match_refresh_frontier frontier
          JOIN person_match_refresh_reference reference
            ON reference.run_id = ${runId}
            AND reference.face_id = frontier.reference_face_id
          JOIN reference_contexts reference_context
            ON reference_context.face_id = frontier.reference_face_id
          JOIN current_matchable_physical_face query_face
            ON query_face.face_id = frontier.face_id
          JOIN face_embedding candidate_embedding
            ON candidate_embedding.face_id = query_face.face_id
            AND candidate_embedding.state = 'active'
            AND candidate_embedding.model_family = ${pack.model_family}
            AND candidate_embedding.model_version = ${pack.model_version}
            AND candidate_embedding.config_digest = ${pack.config_digest}
          JOIN face_observation face ON face.face_id = query_face.face_id
            AND face.state = 'valid'
          JOIN asset ON asset.asset_id = query_face.asset_id
            AND asset.state = 'active' AND asset.media_kind = 'image'
          LEFT JOIN LATERAL (
            SELECT array_agg(capture.context_id ORDER BY capture.context_id)
              AS context_ids
            FROM current_face_capture_context capture
            WHERE capture.face_id = query_face.face_id
          ) context ON true
          WHERE query_face.asset_id <> reference.asset_id
            AND NOT (coalesce(context.context_ids, ARRAY[]::text[])
              && reference_context.context_ids)
            AND cimmich_face_match_eligible(
              face.detection_confidence, face.box_w, face.box_h
            )
            AND NOT EXISTS (
              SELECT 1 FROM current_physical_face_identity target_identity
              WHERE target_identity.physical_face_id =
                  query_face.physical_face_id
                AND target_identity.person_id = ${id}
                AND target_identity.state = 'accepted'
            )
            AND (
              NOT EXISTS (
                SELECT 1 FROM current_physical_face_identity accepted
                WHERE accepted.physical_face_id = query_face.physical_face_id
                  AND accepted.state = 'accepted'
              )
              OR EXISTS (
                SELECT 1
                FROM current_physical_face_identity accepted
                JOIN current_person_category attention
                  ON attention.person_id = accepted.person_id
                  AND attention.slug = 'sort'
                WHERE accepted.physical_face_id = query_face.physical_face_id
                  AND accepted.state = 'accepted'
              )
            )
        )
          SELECT DISTINCT ON (nearest.face_id)
            nearest.face_id, nearest.physical_face_id, nearest.asset_id,
            nearest.embedding, nearest.context_ids,
            nearest.reference_face_id, nearest.reference_asset_id,
            nearest.target_score
          FROM nearest_raw nearest
          JOIN face_observation face ON face.face_id = nearest.face_id
          WHERE nearest.target_score >= ${Number(pack.score_floor)}
            AND coalesce((
              SELECT review.reason_code
              FROM decision review
              WHERE review.subject_type = 'face_review'
                AND review.subject_id = nearest.face_id
              ORDER BY review.created_at DESC, review.decision_id DESC
              LIMIT 1
            ), '') NOT IN (
              'face_review_unknown','face_review_later','face_review_geometry'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM identity_claim rejected
              JOIN current_face_physical_member rejected_member
                ON rejected_member.face_id = rejected.face_id
              WHERE rejected.person_id = ${id}
                AND rejected.state = 'rejected'
                AND rejected_member.physical_face_id = nearest.physical_face_id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM identity_claim existing
              JOIN current_face_physical_member existing_member
                ON existing_member.face_id = existing.face_id
              WHERE existing.person_id = ${id}
                AND existing.state = 'candidate'
                AND existing.origin <> 'person_refresh_match'
                AND existing_member.physical_face_id = nearest.physical_face_id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM current_physical_face_identity same_photo
              JOIN current_matchable_physical_face accepted_face
                ON accepted_face.physical_face_id = same_photo.physical_face_id
              WHERE same_photo.person_id = ${id}
                AND same_photo.state = 'accepted'
                AND accepted_face.asset_id = nearest.asset_id
            )
          ORDER BY nearest.face_id, nearest.target_score DESC,
            nearest.reference_face_id
      `;
      await tx`ANALYZE cimmich_person_match_refresh_target`;
      await tx`
        CREATE TEMP TABLE cimmich_person_match_refresh_accepted_asset
        ON COMMIT DROP AS
        SELECT DISTINCT face.asset_id, identity.person_id
        FROM cimmich_person_match_refresh_target target
        JOIN face_observation face ON face.asset_id = target.asset_id
          AND face.state = 'valid'
        JOIN current_face_identity identity ON identity.face_id = face.face_id
          AND identity.state = 'accepted'
      `;
      await tx`
        CREATE UNIQUE INDEX cimmich_person_match_refresh_accepted_asset_key
        ON cimmich_person_match_refresh_accepted_asset (asset_id, person_id)
      `;
      await tx`ANALYZE cimmich_person_match_refresh_accepted_asset`;
      await tx`
        CREATE TEMP TABLE cimmich_person_match_refresh_result
        ON COMMIT DROP AS
        WITH scored AS MATERIALIZED (
          SELECT target.*,
            coalesce(competitor.next_score, -1)::float8 AS next_score,
            (target.target_score - coalesce(competitor.next_score, -1))::float8
              AS margin
          FROM cimmich_person_match_refresh_target target
          LEFT JOIN LATERAL (
            SELECT max(1 - (other.embedding <=> target.embedding))::float8
              AS next_score
            FROM (
              SELECT gallery.person_id, gallery.asset_id,
                gallery.embedding, gallery.context_ids
              FROM cimmich_person_match_refresh_competitor gallery
              ORDER BY gallery.embedding <=> target.embedding
              LIMIT 64
            ) other
            WHERE other.asset_id <> target.asset_id
              AND NOT (other.context_ids && target.context_ids)
                AND NOT EXISTS (
                  SELECT 1
                  FROM cimmich_person_match_refresh_accepted_asset same_photo
                  WHERE same_photo.person_id = other.person_id
                    AND same_photo.asset_id = target.asset_id
                )
          ) competitor ON true
        )
        SELECT face_id, physical_face_id, asset_id, target_score AS score,
          next_score, margin, reference_face_id, reference_asset_id
        FROM scored
        WHERE margin >= ${Number(pack.margin_floor)}
      `;

      const [fanout] = await tx`
        SELECT count(*)::int AS candidate_count,
          greatest(500, accepted.face_count * 10)::int AS maximum_count
        FROM cimmich_person_match_refresh_result result
        CROSS JOIN LATERAL (
          SELECT count(DISTINCT physical_face_id)::int AS face_count
          FROM current_physical_face_identity
          WHERE person_id = ${id} AND state = 'accepted'
        ) accepted
        GROUP BY accepted.face_count
      `;
      if (
        Number(fanout?.candidate_count || 0) >
        Number(fanout?.maximum_count || 500)
      ) {
        throw typedError(
          `Matcher refresh refused ${fanout.candidate_count} suggestions for ${person.display_name}`,
          409,
          "PERSON_MATCH_REFRESH_RUNAWAY",
        );
      }

      await tx`
        UPDATE person_match_refresh_run
        SET state = 'superseded', completed_at = now()
        WHERE person_id = ${id} AND state = 'active'
      `;
      const inserted = await tx`
        INSERT INTO identity_claim (
          identity_claim_id, face_id, person_id, origin, state,
          calibrated_confidence, evidence_refs, producer_receipt_id,
          privacy_class
        )
        SELECT 'claim_personrefresh_' || encode(digest(
            ${runId} || ':' || result.face_id || ':' || ${id}, 'sha256'
          ), 'hex'),
          result.face_id, ${id}, 'person_refresh_match', 'candidate',
          least(1::float8, greatest(0::float8, result.score)),
          jsonb_build_object(
            'algorithm', 'best_individual_prime',
            'assignment_decision', 'person_refresh_prime_match',
            'authority', 'human_review_only',
            'automatic_acceptance', false,
            'automatic_identity_acceptance', false,
            'best_score', result.score,
            'margin', result.margin,
            'matcher_photo_count', ${references.length}::int,
            'search_pool', 'unassigned_or_needs_attention',
            'next_score', result.next_score,
            'person_id', ${id}::text,
            'physical_face_id', result.physical_face_id,
            'policy_version', ${personMatchRefreshContract.policyVersion}::text,
            'reference_asset_id', result.reference_asset_id,
            'reference_face_id', result.reference_face_id,
            'reference_set_digest', ${referenceSetDigest}::text,
            'refresh_run_id', ${runId}::text
          ),
          ${receiptId}, 'sensitive-biometric'
        FROM cimmich_person_match_refresh_result result
        RETURNING identity_claim_id
      `;
      await tx`
        UPDATE person_match_refresh_run
        SET state = 'active', candidate_count = ${inserted.length},
          completed_at = now()
        WHERE run_id = ${runId} AND state = 'processing'
      `;
      await tx`
        UPDATE producer_receipt
        SET completed_at = now(), result_digest = encode(digest(
          ${runId} || ':' || ${referenceSetDigest} || ':' ||
          ${String(inserted.length)}, 'sha256'
        ), 'hex')
        WHERE producer_receipt_id = ${receiptId}
      `;
      const [after] = await tx`
        SELECT count(*) FILTER (WHERE state = 'accepted')::int
          AS accepted_identities
        FROM identity_claim
      `;
      const acceptedIdentityDelta =
        Number(after.accepted_identities) - Number(before.accepted_identities);
      if (acceptedIdentityDelta !== 0) {
        throw new Error(
          "Person matcher refresh changed accepted identity truth",
        );
      }
      return {
        acceptedIdentityDelta,
        automaticIdentityWrites: 0,
        candidateCount: inserted.length,
        matcherPhotoCount: references.length,
        personId: id,
        personName: person.display_name,
        referenceSetDigest,
        runId,
        schemaVersion: personMatchRefreshContract.schemaVersion,
        state: "complete",
      };
    });
    return result;
  },
});
