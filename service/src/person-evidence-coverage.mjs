export const personEvidenceCoverageSchemaVersion =
  "cimmich.person-evidence-coverage.v1";

const immutableAuthority = Object.freeze({
  automaticIdentityAuthority: "none",
  inference: "none",
  repositoryWrites: "none",
  sourceMutation: "none",
});

const number = (value) => Number(value || 0);
const array = (value) => (Array.isArray(value) ? value : []);

const projectContext = (items, kind) =>
  array(items)
    .filter((item) => item.entityKind === kind)
    .map((item) => ({
      assetCount: number(item.assetCount),
      displayName: String(item.displayName || ""),
      entityId: String(item.entityId || ""),
    }));

export const projectPersonEvidenceCoverage = (row) => ({
  assets: {
    body: number(row.body_asset_count),
    bodyOnly: number(row.body_only_asset_count),
    dated: number(row.dated_asset_count),
    face: number(row.face_asset_count),
    head: number(row.head_asset_count),
    presence: number(row.presence_asset_count),
    total: number(row.total_asset_count),
  },
  authority: immutableAuthority,
  context: {
    events: projectContext(row.contexts, "event"),
    places: projectContext(row.contexts, "place"),
    things: projectContext(row.contexts, "object"),
  },
  observations: {
    body: number(row.body_observation_count),
    face: number(row.face_observation_count),
    head: number(row.head_observation_count),
    pose: number(row.pose_observation_count),
    presence: number(row.presence_observation_count),
  },
  person: {
    displayName: String(row.display_name || ""),
    personId: String(row.person_id || ""),
  },
  references: {
    head: number(row.head_reference_count),
    lowQuality: number(row.low_quality_reference_count),
    prime: number(row.prime_reference_count),
    secondary: number(row.secondary_reference_count),
  },
  review: {
    bodyWithoutPose: number(row.body_without_pose_count),
    candidateFaces: number(row.candidate_face_count),
    futureDates: number(row.future_date_count),
  },
  schemaVersion: personEvidenceCoverageSchemaVersion,
  sourceSuggestions: array(row.source_suggestions).map((item) => ({
    box: {
      h: Number(item.boxH),
      w: Number(item.boxW),
      x: Number(item.boxX),
      y: Number(item.boxY),
    },
    bucketKind: item.bucketKind || null,
    captureTime: item.captureTime || null,
    faceId: String(item.faceId || ""),
    filename: String(item.filename || ""),
    height: number(item.height),
    qualityScore:
      item.qualityScore === null || item.qualityScore === undefined
        ? null
        : Number(item.qualityScore),
    sourceAssetId: String(item.sourceAssetId || ""),
    width: number(item.width),
  })),
  time: {
    firstCaptureTime: row.first_capture_time || null,
    lastCaptureTime: row.last_capture_time || null,
    years: array(row.years).map((item) => ({
      assetCount: number(item.assetCount),
      year: number(item.year),
    })),
  },
});

export const createPersonEvidenceCoverageStore = (
  sql,
  { presentationRank, requireVisibleSubject },
) => {
  if (
    typeof sql !== "function" ||
    typeof presentationRank !== "function" ||
    typeof requireVisibleSubject !== "function"
  ) {
    throw new TypeError(
      "Person evidence coverage requires SQL, visibility, and a Person gate",
    );
  }

  return Object.freeze({
    async read({ personId }) {
      const id = String(personId || "").trim();
      const subject = await requireVisibleSubject(id);
      if (subject.subject_kind !== "person") {
        throw Object.assign(
          new Error("Evidence & coverage is currently available for People"),
          { code: "PERSON_EVIDENCE_COVERAGE_KIND_INVALID", statusCode: 400 },
        );
      }
      const visibleRank = presentationRank();
      const [row] = await sql`
        WITH target_person AS MATERIALIZED (
          SELECT person_id, display_name
          FROM current_person
          WHERE person_id = ${id} AND status = 'active'
            AND subject_kind = 'person'
        ), accepted_faces AS MATERIALIZED (
          SELECT identity.face_id, face.asset_id, face.box_x, face.box_y,
            face.box_w, face.box_h, face.quality_measurements
          FROM current_face_identity identity
          JOIN target_person person ON person.person_id = identity.person_id
          JOIN face_observation face ON face.face_id = identity.face_id
            AND face.state = 'valid'
          JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
          WHERE identity.state = 'accepted'
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
        ), accepted_bodies AS MATERIALIZED (
          SELECT tag.body_tag_id, body.body_id, body.asset_id,
            (pose.body_id IS NOT NULL) AS has_pose
          FROM current_body_tag tag
          JOIN target_person person ON person.person_id = tag.person_id
          JOIN body_observation body ON body.body_id = tag.body_id
            AND body.state = 'valid'
          JOIN asset ON asset.asset_id = body.asset_id AND asset.state = 'active'
          LEFT JOIN body_pose_evidence pose ON pose.body_id = body.body_id
            AND pose.state = 'valid'
          WHERE tag.state = 'accepted'
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
        ), accepted_heads AS MATERIALIZED (
          SELECT tag.head_id, head.asset_id
          FROM current_manual_head_tag tag
          JOIN target_person person ON person.person_id = tag.subject_id
          JOIN manual_head_observation head ON head.head_id = tag.head_id
            AND head.state = 'valid'
          JOIN asset ON asset.asset_id = head.asset_id AND asset.state = 'active'
          WHERE cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
        ), accepted_presence AS MATERIALIZED (
          SELECT presence.presence_tag_id, presence.asset_id
          FROM current_presence_tag presence
          JOIN target_person person ON person.person_id = presence.person_id
          JOIN asset ON asset.asset_id = presence.asset_id AND asset.state = 'active'
          WHERE presence.state = 'accepted'
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
        ), evidence_rows AS MATERIALIZED (
          SELECT asset_id, 'face'::text AS kind FROM accepted_faces
          UNION ALL SELECT asset_id, 'body' FROM accepted_bodies
          UNION ALL SELECT asset_id, 'head' FROM accepted_heads
          UNION ALL SELECT asset_id, 'presence' FROM accepted_presence
        ), evidence_assets AS MATERIALIZED (
          SELECT evidence.asset_id,
            bool_or(evidence.kind = 'face') AS has_face,
            bool_or(evidence.kind = 'body') AS has_body,
            bool_or(evidence.kind = 'head') AS has_head,
            bool_or(evidence.kind = 'presence') AS has_presence
          FROM evidence_rows evidence
          GROUP BY evidence.asset_id
        ), visible_assets AS MATERIALIZED (
          SELECT evidence.*, asset.capture_time
          FROM evidence_assets evidence
          JOIN asset ON asset.asset_id = evidence.asset_id
            AND asset.state = 'active'
        ), reference_counts AS MATERIALIZED (
          SELECT gallery.bucket_kind, count(DISTINCT gallery.face_id)::int AS count
          FROM current_reference_gallery gallery
          JOIN accepted_faces face ON face.face_id = gallery.face_id
          WHERE gallery.person_id = ${id}
            AND gallery.membership_state = 'active'
            AND gallery.bucket_kind IN ('prime','secondary','lq','head')
          GROUP BY gallery.bucket_kind
        ), context_counts AS MATERIALIZED (
          SELECT entity.entity_id, entity.entity_kind,
            entity.display_name, count(DISTINCT link.asset_id)::int AS asset_count
          FROM visible_assets asset
          JOIN current_context_asset link ON link.asset_id = asset.asset_id
          JOIN context_entity entity ON entity.entity_id = link.entity_id
            AND entity.status = 'active'
          WHERE cimmich_visibility_context_entity_rank(entity.entity_id)
              <= ${visibleRank}
          GROUP BY entity.entity_id, entity.entity_kind, entity.display_name
        ), ranked_contexts AS MATERIALIZED (
          SELECT context.*,
            row_number() OVER (
              PARTITION BY context.entity_kind
              ORDER BY context.asset_count DESC, lower(context.display_name),
                context.entity_id
            ) AS position
          FROM context_counts context
        ), source_faces AS MATERIALIZED (
          SELECT DISTINCT ON (face.asset_id)
            face.face_id, face.asset_id, face.box_x, face.box_y,
            face.box_w, face.box_h, asset.capture_time, asset.width, asset.height,
            projection.immich_asset_id AS source_asset_id,
            projection.original_file_name AS filename,
            (face.quality_measurements->>'quality_score')::float8 AS quality_score,
            bucket.bucket_kind,
            CASE bucket.bucket_kind
              WHEN 'prime' THEN 0 WHEN 'secondary' THEN 1
              WHEN 'lq' THEN 3 WHEN 'head' THEN 4 ELSE 2
            END AS bucket_rank
          FROM accepted_faces face
          JOIN asset ON asset.asset_id = face.asset_id
          JOIN immich_asset_projection projection
            ON projection.cimmich_asset_id = face.asset_id
            AND projection.state = 'active'
          LEFT JOIN LATERAL (
            SELECT gallery.bucket_kind
            FROM current_reference_gallery gallery
            WHERE gallery.person_id = ${id}
              AND gallery.face_id = face.face_id
              AND gallery.membership_state = 'active'
              AND gallery.bucket_kind IN ('prime','secondary','lq','head')
            ORDER BY CASE gallery.bucket_kind
              WHEN 'prime' THEN 0 WHEN 'secondary' THEN 1
              WHEN 'lq' THEN 3 ELSE 4 END
            LIMIT 1
          ) bucket ON true
          ORDER BY face.asset_id, bucket_rank,
            quality_score DESC NULLS LAST, face.box_w * face.box_h DESC,
            face.face_id
        ), diverse_sources AS MATERIALIZED (
          SELECT source.*,
            row_number() OVER (
              PARTITION BY extract(year FROM source.capture_time)
              ORDER BY source.bucket_rank, source.quality_score DESC NULLS LAST,
                source.box_w * source.box_h DESC, source.face_id
            ) AS year_position
          FROM source_faces source
          WHERE source.source_asset_id IS NOT NULL
        ), source_suggestions AS MATERIALIZED (
          SELECT * FROM diverse_sources
          WHERE year_position = 1
          ORDER BY (capture_time > now() + interval '24 hours'), bucket_rank,
            quality_score DESC NULLS LAST, capture_time DESC NULLS LAST, face_id
          LIMIT 6
        ), year_counts AS MATERIALIZED (
          SELECT extract(year FROM capture_time)::int AS year,
            count(*)::int AS asset_count
          FROM visible_assets
          WHERE capture_time IS NOT NULL
          GROUP BY extract(year FROM capture_time)::int
        ), candidate_faces AS MATERIALIZED (
          SELECT count(*)::int AS count
          FROM identity_claim claim
          JOIN face_observation face ON face.face_id = claim.face_id
            AND face.state = 'valid'
          JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
          WHERE claim.person_id = ${id} AND claim.state = 'candidate'
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
        )
        SELECT person.person_id, person.display_name,
          (SELECT count(*)::int FROM visible_assets) AS total_asset_count,
          (SELECT count(*)::int FROM visible_assets WHERE has_face) AS face_asset_count,
          (SELECT count(*)::int FROM visible_assets WHERE has_head) AS head_asset_count,
          (SELECT count(*)::int FROM visible_assets WHERE has_body) AS body_asset_count,
          (SELECT count(*)::int FROM visible_assets WHERE has_presence) AS presence_asset_count,
          (SELECT count(*)::int FROM visible_assets
            WHERE has_body AND NOT has_face AND NOT has_head) AS body_only_asset_count,
          (SELECT count(*)::int FROM visible_assets
            WHERE capture_time IS NOT NULL) AS dated_asset_count,
          (SELECT count(*)::int FROM accepted_faces) AS face_observation_count,
          (SELECT count(*)::int FROM accepted_heads) AS head_observation_count,
          (SELECT count(*)::int FROM accepted_bodies) AS body_observation_count,
          (SELECT count(*)::int FROM accepted_bodies WHERE has_pose) AS pose_observation_count,
          (SELECT count(*)::int FROM accepted_presence) AS presence_observation_count,
          (SELECT count(*)::int FROM accepted_bodies WHERE NOT has_pose) AS body_without_pose_count,
          (SELECT count FROM candidate_faces) AS candidate_face_count,
          (SELECT count(*)::int FROM visible_assets
            WHERE capture_time > now() + interval '24 hours') AS future_date_count,
          (SELECT min(capture_time) FROM visible_assets) AS first_capture_time,
          (SELECT max(capture_time) FROM visible_assets) AS last_capture_time,
          coalesce((SELECT count FROM reference_counts WHERE bucket_kind = 'prime'), 0)::int
            AS prime_reference_count,
          coalesce((SELECT count FROM reference_counts WHERE bucket_kind = 'secondary'), 0)::int
            AS secondary_reference_count,
          coalesce((SELECT count FROM reference_counts WHERE bucket_kind = 'lq'), 0)::int
            AS low_quality_reference_count,
          coalesce((SELECT count FROM reference_counts WHERE bucket_kind = 'head'), 0)::int
            AS head_reference_count,
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'assetCount', year.asset_count, 'year', year.year
            ) ORDER BY year.year)
            FROM year_counts year
          ), '[]'::jsonb) AS years,
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'assetCount', context.asset_count,
              'displayName', context.display_name,
              'entityId', context.entity_id,
              'entityKind', context.entity_kind
            ) ORDER BY context.entity_kind, context.position)
            FROM ranked_contexts context WHERE context.position <= 6
          ), '[]'::jsonb) AS contexts,
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'boxH', source.box_h, 'boxW', source.box_w,
              'boxX', source.box_x, 'boxY', source.box_y,
              'bucketKind', source.bucket_kind,
              'captureTime', source.capture_time,
              'faceId', source.face_id, 'filename', source.filename,
              'height', source.height,
              'qualityScore', source.quality_score,
              'sourceAssetId', source.source_asset_id,
              'width', source.width
            ) ORDER BY (source.capture_time > now() + interval '24 hours'),
              source.bucket_rank, source.quality_score DESC NULLS LAST,
              source.capture_time DESC NULLS LAST, source.face_id)
            FROM source_suggestions source
          ), '[]'::jsonb) AS source_suggestions
        FROM target_person person
      `;
      if (!row) {
        throw Object.assign(new Error("Person evidence was not found"), {
          code: "PERSON_EVIDENCE_COVERAGE_NOT_FOUND",
          statusCode: 404,
        });
      }
      return Object.freeze(projectPersonEvidenceCoverage(row));
    },
  });
};
