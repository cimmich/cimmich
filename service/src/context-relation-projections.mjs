// Reciprocal context projections keep one durable edge while making it
// navigable from either endpoint. They are reads only: no inverse fact is
// persisted and no relationship is inferred.
export const loadContextRelationProjections = async ({
  entity,
  executor,
  presentationRank,
}) => {
  const incomingContextRelations = await executor`
    SELECT link.link_id, source.entity_kind AS target_kind,
      source.entity_id AS target_id, link.relation_kind,
      link.created_at, link.sort_order, source.display_name AS target_name
    FROM current_context_relation link
    JOIN context_entity source ON source.entity_id = link.entity_id
      AND source.status IN ('active','hidden')
    WHERE link.target_kind = ${entity.entity_kind}
      AND link.target_id = ${entity.entity_id}
      AND link.relation_kind = 'related'
      AND cimmich_visibility_context_entity_rank(source.entity_id) <= ${presentationRank}
    ORDER BY source.entity_kind, lower(source.display_name), source.entity_id
  `;

  const incomingPersonFacts =
    entity.entity_kind === "place" || entity.entity_kind === "object"
      ? await executor`
          SELECT fact.fact_id AS link_id, 'person'::text AS target_kind,
            fact.source_id AS target_id, 'related'::text AS relation_kind,
            fact.created_at, NULL::int AS sort_order,
            person.display_name AS target_name,
            CASE
              WHEN fact.validity = 'past' AND NOT coalesce(modifiers.has_historical, false)
                THEN coalesce(type.past_label, type.label)
              ELSE type.label
            END || CASE WHEN modifiers.labels IS NULL THEN ''
              ELSE ' (' || modifiers.labels || ')' END AS relationship_label
          FROM current_connection_fact fact
          JOIN connection_type type ON type.type_id = fact.type_id AND type.state = 'active'
          JOIN current_person person ON person.person_id = fact.source_id
            AND person.subject_kind = 'person' AND person.status = 'active'
          LEFT JOIN LATERAL (
            SELECT string_agg(modifier.label, ', ' ORDER BY
                (modifier.behavior = 'historical') DESC, lower(modifier.label), modifier.modifier_id) AS labels,
              bool_or(modifier.behavior = 'historical') AS has_historical
            FROM connection_fact_event_modifier event_modifier
            JOIN connection_modifier modifier USING (modifier_id)
            WHERE event_modifier.event_id = fact.event_id AND modifier.state = 'active'
          ) modifiers ON true
          WHERE fact.target_kind = ${entity.entity_kind}
            AND fact.target_id = ${entity.entity_id}
            AND cimmich_visibility_person_rank(person.person_id) <= ${presentationRank}
          ORDER BY lower(person.display_name), lower(type.label), fact.fact_id
        `
      : [];

  const relationshipContextFacts = await executor`
    SELECT fact_context.context_event_id || ':' || endpoint.direction AS link_id,
      'person'::text AS target_kind, endpoint.person_id AS target_id,
      'related'::text AS relation_kind, fact_context.created_at,
      NULL::int AS sort_order, endpoint.display_name AS target_name,
      (CASE WHEN endpoint.direction = 'incoming'
        THEN type.inverse_label ELSE type.label END)
        || CASE
          WHEN fact.validity = 'past' AND NOT coalesce(modifiers.has_historical, false)
            THEN ' (Former' || CASE WHEN modifiers.qualifier_labels IS NULL
              THEN '' ELSE ', ' || modifiers.qualifier_labels END || ')'
          WHEN modifiers.labels IS NULL THEN ''
          ELSE ' (' || modifiers.labels || ')'
        END || ' with ' || endpoint.other_name AS relationship_label
    FROM current_connection_fact_context fact_context
    JOIN current_connection_fact fact ON fact.fact_id = fact_context.fact_id
      AND fact.target_kind = 'person'
    JOIN connection_type type ON type.type_id = fact.type_id AND type.state = 'active'
    JOIN current_person source ON source.person_id = fact.source_id
      AND source.subject_kind = 'person' AND source.status = 'active'
    JOIN current_person target ON target.person_id = fact.target_id
      AND target.subject_kind = 'person' AND target.status = 'active'
    CROSS JOIN LATERAL (VALUES
      (source.person_id, source.display_name, target.display_name, 'outgoing'::text),
      (target.person_id, target.display_name, source.display_name, 'incoming'::text)
    ) endpoint(person_id, display_name, other_name, direction)
    LEFT JOIN LATERAL (
      SELECT string_agg(modifier.label, ', ' ORDER BY
          (modifier.behavior = 'historical') DESC, lower(modifier.label), modifier.modifier_id) AS labels,
        string_agg(modifier.label, ', ' ORDER BY lower(modifier.label), modifier.modifier_id)
          FILTER (WHERE modifier.behavior = 'qualifier') AS qualifier_labels,
        bool_or(modifier.behavior = 'historical') AS has_historical
      FROM connection_fact_event_modifier event_modifier
      JOIN connection_modifier modifier USING (modifier_id)
      WHERE event_modifier.event_id = fact.event_id AND modifier.state = 'active'
    ) modifiers ON true
    WHERE fact_context.context_entity_id = ${entity.entity_id}
      AND cimmich_visibility_person_rank(source.person_id) <= ${presentationRank}
      AND cimmich_visibility_person_rank(target.person_id) <= ${presentationRank}
    ORDER BY lower(endpoint.display_name), lower(type.label), fact.fact_id
  `;

  return [
    ...incomingContextRelations.map((row) => ({
      ...row,
      direction: "incoming",
      relation_origin: "context_relation",
    })),
    ...incomingPersonFacts.map((row) => ({
      ...row,
      direction: "incoming",
      relation_origin: "connection_fact",
    })),
    ...relationshipContextFacts.map((row) => ({
      ...row,
      direction: "incoming",
      relation_origin: "relationship_context",
    })),
  ];
};
