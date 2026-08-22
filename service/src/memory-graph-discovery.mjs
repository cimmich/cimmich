import { bridgeFields } from "./bridge-fields.mjs";

const boundedEdgeLimit = (value) =>
  Math.min(120, Math.max(24, Number.parseInt(String(value || 72), 10) || 72));

const nodeId = (kind, id) => `${kind}:${id}`;

export const createMemoryGraphDiscovery = ({
  bridge,
  presentationRank,
  sql,
}) => ({
  async read({ edgeLimit = 72 } = {}) {
    const limit = boundedEdgeLimit(edgeLimit);
    const rank = presentationRank();
    const personPairLimit = Math.max(8, Math.floor(limit * 0.25));
    const personContextLimit = Math.max(12, Math.floor(limit * 0.42));
    const contextMediaLimit = Math.max(6, Math.floor(limit * 0.12));
    const hierarchyLimit = Math.max(6, Math.floor(limit * 0.12));
    const explicitLimit = Math.max(8, Math.floor(limit * 0.15));
    const connectionFactLimit = Math.max(12, Math.floor(limit * 0.25));
    const rows = await sql`
      WITH visible_person_assets AS MATERIALIZED (
        SELECT DISTINCT association.person_id, association.asset_id
        FROM person_assets association
        JOIN person subject ON subject.person_id = association.person_id
          AND subject.subject_kind = 'person' AND subject.status = 'active'
        JOIN asset ON asset.asset_id = association.asset_id
          AND asset.state = 'active'
        WHERE association.authority_state = 'accepted'
          AND cimmich_visibility_person_rank(association.person_id) <= ${rank}
          AND cimmich_visibility_asset_rank(association.asset_id) <= ${rank}
      ), visible_context_assets AS MATERIALIZED (
        SELECT DISTINCT association.entity_id, association.asset_id
        FROM current_context_asset association
        JOIN context_entity entity ON entity.entity_id = association.entity_id
          AND entity.status = 'active'
        JOIN asset ON asset.asset_id = association.asset_id
          AND asset.state = 'active'
        WHERE cimmich_visibility_context_entity_rank(association.entity_id) <= ${rank}
          AND cimmich_visibility_asset_rank(association.asset_id) <= ${rank}
      ), person_pair_candidates AS (
        SELECT left_person.person_id AS source_id, 'person'::text AS source_kind,
          source.display_name AS source_name, NULL::text AS source_type_kind,
          right_person.person_id AS target_id, 'person'::text AS target_kind,
          target.display_name AS target_name, NULL::text AS target_type_kind,
          'coappears'::text AS relation_kind, count(*)::int AS photo_count,
          (array_agg(left_person.asset_id ORDER BY asset.capture_time DESC NULLS LAST,
            left_person.asset_id))[1] AS cover_asset_id
        FROM visible_person_assets left_person
        JOIN visible_person_assets right_person
          ON right_person.asset_id = left_person.asset_id
          AND right_person.person_id > left_person.person_id
        JOIN person source ON source.person_id = left_person.person_id
        JOIN person target ON target.person_id = right_person.person_id
        JOIN asset ON asset.asset_id = left_person.asset_id
        GROUP BY left_person.person_id, source.display_name,
          right_person.person_id, target.display_name
        ORDER BY count(*) DESC, lower(source.display_name), lower(target.display_name)
        LIMIT ${personPairLimit}
      ), person_context_media_candidates AS (
        SELECT person_asset.person_id AS source_id, 'person'::text AS source_kind,
          subject.display_name AS source_name, NULL::text AS source_type_kind,
          context_asset.entity_id AS target_id, entity.entity_kind AS target_kind,
          entity.display_name AS target_name,
          CASE entity.entity_kind WHEN 'place' THEN entity.place_kind
            WHEN 'object' THEN entity.object_kind WHEN 'event' THEN entity.event_kind END AS target_type_kind,
          'shared_media'::text AS relation_kind, count(*)::int AS photo_count,
          (array_agg(person_asset.asset_id ORDER BY asset.capture_time DESC NULLS LAST,
            person_asset.asset_id))[1] AS cover_asset_id,
          row_number() OVER (PARTITION BY context_asset.entity_id
            ORDER BY count(*) DESC, lower(subject.display_name), person_asset.person_id) AS context_position
        FROM visible_person_assets person_asset
        JOIN visible_context_assets context_asset
          ON context_asset.asset_id = person_asset.asset_id
        JOIN person subject ON subject.person_id = person_asset.person_id
        JOIN context_entity entity ON entity.entity_id = context_asset.entity_id
        JOIN asset ON asset.asset_id = person_asset.asset_id
        GROUP BY person_asset.person_id, subject.display_name,
          context_asset.entity_id, entity.entity_kind, entity.display_name,
          entity.place_kind, entity.object_kind, entity.event_kind
      ), person_context_media AS (
        SELECT source_id, source_kind, source_name, source_type_kind,
          target_id, target_kind, target_name, target_type_kind,
          relation_kind, photo_count, cover_asset_id
        FROM person_context_media_candidates
        WHERE context_position <= 4
        ORDER BY photo_count DESC, lower(target_name), lower(source_name)
        LIMIT ${personContextLimit}
      ), context_media_candidates AS (
        SELECT left_context.entity_id AS source_id, source.entity_kind AS source_kind,
          source.display_name AS source_name,
          CASE source.entity_kind WHEN 'place' THEN source.place_kind
            WHEN 'object' THEN source.object_kind WHEN 'event' THEN source.event_kind END AS source_type_kind,
          right_context.entity_id AS target_id, target.entity_kind AS target_kind,
          target.display_name AS target_name,
          CASE target.entity_kind WHEN 'place' THEN target.place_kind
            WHEN 'object' THEN target.object_kind WHEN 'event' THEN target.event_kind END AS target_type_kind,
          'shared_media'::text AS relation_kind, count(*)::int AS photo_count,
          (array_agg(left_context.asset_id ORDER BY asset.capture_time DESC NULLS LAST,
            left_context.asset_id))[1] AS cover_asset_id
        FROM visible_context_assets left_context
        JOIN visible_context_assets right_context
          ON right_context.asset_id = left_context.asset_id
          AND right_context.entity_id > left_context.entity_id
        JOIN context_entity source ON source.entity_id = left_context.entity_id
        JOIN context_entity target ON target.entity_id = right_context.entity_id
        JOIN asset ON asset.asset_id = left_context.asset_id
        GROUP BY left_context.entity_id, source.entity_kind, source.display_name,
          source.place_kind, source.object_kind, source.event_kind,
          right_context.entity_id, target.entity_kind, target.display_name,
          target.place_kind, target.object_kind, target.event_kind
        ORDER BY count(*) DESC, lower(source.display_name), lower(target.display_name)
        LIMIT ${contextMediaLimit}
      ), explicit_relations AS (
        SELECT source.entity_id AS source_id, source.entity_kind AS source_kind,
          source.display_name AS source_name,
          CASE source.entity_kind WHEN 'place' THEN source.place_kind
            WHEN 'object' THEN source.object_kind WHEN 'event' THEN source.event_kind END AS source_type_kind,
          relation.target_id, relation.target_kind,
          coalesce(subject.display_name, target.display_name) AS target_name,
          CASE relation.target_kind WHEN 'place' THEN target.place_kind
            WHEN 'object' THEN target.object_kind WHEN 'event' THEN target.event_kind END AS target_type_kind,
          relation.relation_kind, 0::int AS photo_count,
          NULL::text AS cover_asset_id
        FROM current_context_relation relation
        JOIN context_entity source ON source.entity_id = relation.entity_id
          AND source.status = 'active'
        LEFT JOIN person subject ON relation.target_kind IN ('person', 'pet')
          AND subject.person_id = relation.target_id AND subject.status = 'active'
          AND subject.subject_kind = relation.target_kind
        LEFT JOIN context_entity target ON relation.target_kind IN ('place', 'object', 'event')
          AND target.entity_id = relation.target_id AND target.status = 'active'
        WHERE cimmich_visibility_context_entity_rank(source.entity_id) <= ${rank}
          AND ((relation.target_kind IN ('person', 'pet') AND subject.person_id IS NOT NULL
              AND cimmich_visibility_subject_rank(subject.subject_kind, subject.person_id) <= ${rank})
            OR (relation.target_kind IN ('place', 'object', 'event') AND target.entity_id IS NOT NULL
              AND cimmich_visibility_context_entity_rank(target.entity_id) <= ${rank}))
        ORDER BY relation.created_at DESC, relation.link_id
        LIMIT ${explicitLimit}
      ), connection_facts AS (
        SELECT source.person_id AS source_id, 'person'::text AS source_kind,
          source.display_name AS source_name, NULL::text AS source_type_kind,
          fact.target_id, fact.target_kind,
          coalesce(target_person.display_name, target_context.display_name) AS target_name,
          coalesce(target_context.place_kind, target_context.object_kind) AS target_type_kind,
          CASE WHEN fact.validity = 'past' AND fact.target_kind <> 'person'
            THEN coalesce(type.past_label, type.label) ELSE type.label END
            || CASE
              WHEN fact.validity = 'past' AND fact.target_kind = 'person'
                THEN ' (Former' || CASE WHEN qualifiers.labels IS NULL
                  THEN '' ELSE ', ' || qualifiers.labels END || ')'
              WHEN qualifiers.labels IS NULL THEN ''
              ELSE ' (' || qualifiers.labels || ')'
            END AS relation_kind,
          CASE WHEN fact_contexts.labels IS NULL THEN ''
            ELSE ' @ ' || fact_contexts.labels END AS context_suffix,
          0::int AS photo_count, NULL::text AS cover_asset_id
        FROM current_connection_fact fact
        JOIN connection_type type ON type.type_id = fact.type_id AND type.state = 'active'
        JOIN current_person source ON source.person_id = fact.source_id
          AND source.subject_kind = 'person' AND source.status = 'active'
        LEFT JOIN current_person target_person ON fact.target_kind = 'person'
          AND target_person.person_id = fact.target_id
          AND target_person.subject_kind = 'person' AND target_person.status = 'active'
        LEFT JOIN context_entity target_context ON fact.target_kind IN ('place','object')
          AND target_context.entity_id = fact.target_id
          AND target_context.entity_kind = fact.target_kind AND target_context.status = 'active'
        LEFT JOIN LATERAL (
          SELECT string_agg(modifier.label, ', ' ORDER BY lower(modifier.label), modifier.modifier_id) AS labels
          FROM connection_fact_event_modifier event_modifier
          JOIN connection_modifier modifier USING (modifier_id)
          WHERE event_modifier.event_id = fact.event_id
            AND modifier.state = 'active' AND modifier.behavior = 'qualifier'
        ) qualifiers ON true
        LEFT JOIN LATERAL (
          SELECT string_agg(context.display_name, ', ' ORDER BY
              context.entity_kind, lower(context.display_name), context.entity_id) AS labels
          FROM current_connection_fact_context fact_context
          JOIN context_entity context ON context.entity_id = fact_context.context_entity_id
            AND context.status = 'active'
          WHERE fact_context.fact_id = fact.fact_id
            AND cimmich_visibility_context_entity_rank(context.entity_id) <= ${rank}
        ) fact_contexts ON true
        WHERE cimmich_visibility_person_rank(source.person_id) <= ${rank}
          AND ((fact.target_kind = 'person' AND target_person.person_id IS NOT NULL
              AND cimmich_visibility_person_rank(target_person.person_id) <= ${rank})
            OR (fact.target_kind IN ('place','object') AND target_context.entity_id IS NOT NULL
              AND cimmich_visibility_context_entity_rank(target_context.entity_id) <= ${rank}))
        ORDER BY fact.created_at DESC, fact.fact_id
        LIMIT ${connectionFactLimit}
      ), relationship_contexts AS (
        SELECT endpoint.person_id AS source_id, 'person'::text AS source_kind,
          endpoint.display_name AS source_name, NULL::text AS source_type_kind,
          context.entity_id AS target_id, context.entity_kind AS target_kind,
          context.display_name AS target_name,
          coalesce(context.place_kind, context.object_kind, context.event_kind) AS target_type_kind,
          (CASE WHEN endpoint.direction = 'incoming' THEN type.inverse_label ELSE type.label END)
            || CASE WHEN fact.validity = 'past'
              THEN ' (Former' || CASE WHEN qualifiers.labels IS NULL
                THEN '' ELSE ', ' || qualifiers.labels END || ')'
              WHEN qualifiers.labels IS NULL THEN ''
              ELSE ' (' || qualifiers.labels || ')'
            END AS relation_kind,
          ''::text AS context_suffix,
          0::int AS photo_count, NULL::text AS cover_asset_id
        FROM current_connection_fact_context fact_context
        JOIN current_connection_fact fact ON fact.fact_id = fact_context.fact_id
          AND fact.target_kind = 'person'
        JOIN connection_type type ON type.type_id = fact.type_id AND type.state = 'active'
        JOIN current_person source ON source.person_id = fact.source_id
          AND source.subject_kind = 'person' AND source.status = 'active'
        JOIN current_person target ON target.person_id = fact.target_id
          AND target.subject_kind = 'person' AND target.status = 'active'
        JOIN context_entity context ON context.entity_id = fact_context.context_entity_id
          AND context.status = 'active'
        CROSS JOIN LATERAL (VALUES
          (source.person_id, source.display_name, 'outgoing'::text),
          (target.person_id, target.display_name, 'incoming'::text)
        ) endpoint(person_id, display_name, direction)
        LEFT JOIN LATERAL (
          SELECT string_agg(modifier.label, ', ' ORDER BY lower(modifier.label), modifier.modifier_id) AS labels
          FROM connection_fact_event_modifier event_modifier
          JOIN connection_modifier modifier USING (modifier_id)
          WHERE event_modifier.event_id = fact.event_id
            AND modifier.state = 'active' AND modifier.behavior = 'qualifier'
        ) qualifiers ON true
        WHERE cimmich_visibility_person_rank(source.person_id) <= ${rank}
          AND cimmich_visibility_person_rank(target.person_id) <= ${rank}
          AND cimmich_visibility_context_entity_rank(context.entity_id) <= ${rank}
        ORDER BY fact.created_at DESC, fact.fact_id, endpoint.person_id
        LIMIT ${connectionFactLimit}
      ), hierarchy_relations AS (
        SELECT child.entity_id AS source_id, child.entity_kind AS source_kind,
          child.display_name AS source_name,
          CASE child.entity_kind WHEN 'place' THEN child.place_kind
            WHEN 'event' THEN child.event_kind END AS source_type_kind,
          parent.entity_id AS target_id, parent.entity_kind AS target_kind,
          parent.display_name AS target_name,
          CASE parent.entity_kind WHEN 'place' THEN parent.place_kind
            WHEN 'event' THEN parent.event_kind END AS target_type_kind,
          'parent'::text AS relation_kind, 0::int AS photo_count,
          NULL::text AS cover_asset_id
        FROM context_entity child
        JOIN context_entity parent ON parent.entity_id = child.parent_entity_id
          AND parent.status = 'active'
        WHERE child.status = 'active'
          AND cimmich_visibility_context_entity_rank(child.entity_id) <= ${rank}
          AND cimmich_visibility_context_entity_rank(parent.entity_id) <= ${rank}
        ORDER BY child.updated_at DESC, child.entity_id
        LIMIT ${hierarchyLimit}
      )
      SELECT * FROM person_pair_candidates
      UNION ALL SELECT * FROM person_context_media
      UNION ALL SELECT * FROM context_media_candidates
      UNION ALL SELECT * FROM explicit_relations
      UNION ALL SELECT source_id, source_kind, source_name, source_type_kind,
        target_id, target_kind, target_name, target_type_kind,
        relation_kind || context_suffix AS relation_kind, photo_count, cover_asset_id
        FROM connection_facts
      UNION ALL SELECT source_id, source_kind, source_name, source_type_kind,
        target_id, target_kind, target_name, target_type_kind,
        relation_kind || context_suffix AS relation_kind, photo_count, cover_asset_id
        FROM relationship_contexts
      UNION ALL SELECT * FROM hierarchy_relations
    `;
    const nodes = new Map();
    const edges = new Map();
    for (const row of rows) {
      const sourceNodeId = nodeId(row.source_kind, row.source_id);
      const targetNodeId = nodeId(row.target_kind, row.target_id);
      if (sourceNodeId === targetNodeId) continue;
      const coverAssetId = row.cover_asset_id
        ? bridgeFields(bridge, row.cover_asset_id).sourceAssetId || null
        : null;
      for (const [id, kind, displayName, typeKind] of [
        [row.source_id, row.source_kind, row.source_name, row.source_type_kind],
        [row.target_id, row.target_kind, row.target_name, row.target_type_kind],
      ]) {
        const graphNodeId = nodeId(kind, id);
        const existing = nodes.get(graphNodeId);
        if (!existing) {
          nodes.set(graphNodeId, {
            connectionCount: 0,
            coverAssetId,
            displayName: displayName || "",
            entityId: id,
            kind,
            nodeId: graphNodeId,
            typeKind: typeKind || null,
          });
        } else if (!existing.coverAssetId && coverAssetId) {
          existing.coverAssetId = coverAssetId;
        }
      }
      const pair = [sourceNodeId, targetNodeId].sort();
      const edgeId = `${pair[0]}--${pair[1]}`;
      const edge = edges.get(edgeId) || {
        coverAssetId,
        edgeId,
        photoCount: 0,
        relationKinds: [],
        sourceNodeId,
        targetNodeId,
        weight: 1,
      };
      edge.photoCount = Math.max(edge.photoCount, Number(row.photo_count || 0));
      if (!edge.relationKinds.includes(row.relation_kind)) {
        edge.relationKinds.push(row.relation_kind);
      }
      if (!edge.coverAssetId && coverAssetId) edge.coverAssetId = coverAssetId;
      edge.weight = Math.max(
        edge.weight,
        1 + Math.log2(edge.photoCount + 1) + edge.relationKinds.length * 0.75,
      );
      edges.set(edgeId, edge);
    }
    const isRecordedRelationship = (edge) =>
      edge.relationKinds.some(
        (kind) => kind !== "coappears" && kind !== "shared_media",
      );
    const projectedEdges = [...edges.values()]
      .sort(
        (left, right) =>
          Number(isRecordedRelationship(right)) -
            Number(isRecordedRelationship(left)) ||
          right.weight - left.weight ||
          left.edgeId.localeCompare(right.edgeId),
      )
      .slice(0, limit);
    const projectedNodeIds = new Set();
    for (const edge of projectedEdges) {
      projectedNodeIds.add(edge.sourceNodeId);
      projectedNodeIds.add(edge.targetNodeId);
      nodes.get(edge.sourceNodeId).connectionCount += 1;
      nodes.get(edge.targetNodeId).connectionCount += 1;
      edge.relationKinds.sort();
    }
    const projectedNodes = [...nodes.values()]
      .filter((node) => projectedNodeIds.has(node.nodeId))
      .sort(
        (left, right) =>
          right.connectionCount - left.connectionCount ||
          left.kind.localeCompare(right.kind) ||
          left.displayName.localeCompare(right.displayName) ||
          left.nodeId.localeCompare(right.nodeId),
      );
    const countsByKind = Object.fromEntries(
      ["event", "object", "person", "pet", "place"].map((kind) => [
        kind,
        projectedNodes.filter((node) => node.kind === kind).length,
      ]),
    );
    return {
      countsByKind,
      edges: projectedEdges,
      nodes: projectedNodes,
      scope: { edgeLimit: limit },
    };
  },
});
