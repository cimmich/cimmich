const schemaVersion = "cimmich.explore-facets.v1";
const privacyTiers = new Set(["standard", "personal", "private"]);

const typedError = (message, code) =>
  Object.assign(new Error(message), { code, statusCode: 400 });

const cleanIds = (value, field) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 12) {
    throw typedError(
      `${field} must contain no more than 12 values`,
      "EXPLORE_FILTER_SELECTION_INVALID",
    );
  }
  const values = value.map((item) => String(item || "").trim());
  if (values.some((item) => !item || item.length > 240)) {
    throw typedError(
      `${field} contains an invalid value`,
      "EXPLORE_FILTER_SELECTION_INVALID",
    );
  }
  return [...new Set(values)].sort();
};

export const normalizeExploreFilters = (value = {}) => {
  const privacy = cleanIds(value.privacyTiers, "privacyTiers");
  if (privacy.some((tier) => !privacyTiers.has(tier))) {
    throw typedError(
      "privacyTiers must contain standard, personal, or private",
      "EXPLORE_FILTER_PRIVACY_INVALID",
    );
  }
  return {
    eventIds: cleanIds(value.eventIds, "eventIds"),
    labelIds: cleanIds(value.labelIds, "labelIds"),
    placeIds: cleanIds(value.placeIds, "placeIds"),
    privacyTiers: privacy,
    thingIds: cleanIds(value.thingIds, "thingIds"),
  };
};

const cleanScope = (value = {}) => {
  const kind = String(value.kind || "people").trim();
  if (!new Set(["people", "person"]).has(kind)) {
    throw typedError(
      "Explore scope must be people or person",
      "EXPLORE_FILTER_SCOPE_INVALID",
    );
  }
  const personId = String(value.personId || "").trim();
  if (kind === "person" && (!personId || personId.length > 240)) {
    throw typedError(
      "Person Explore scope needs a stable Person ID",
      "EXPLORE_FILTER_SCOPE_INVALID",
    );
  }
  return { kind, personId: kind === "person" ? personId : "" };
};

const projectFacet = (row) => ({
  count: Number(row.count || 0),
  displayName: row.displayName,
  id: row.id,
});

export const createExploreFacetStore = (
  sql,
  { presentationRank, requireVisibleSubject },
) => {
  const snapshots = new Map();
  const snapshotTtlMs = 10_000;
  const loadExploreFacets = async ({
    filters: rawFilters,
    scope: rawScope,
  }) => {
    const filters = normalizeExploreFilters(rawFilters);
    const scope = cleanScope(rawScope);
    if (scope.kind === "person") {
      const subject = await requireVisibleSubject(scope.personId);
      if (subject.subject_kind !== "person") {
        throw Object.assign(new Error("Cimmich person not found"), {
          code: "PERSON_NOT_FOUND",
          statusCode: 404,
        });
      }
    }
    const visibleRank = presentationRank();
    const [projection] = await sql`
      WITH visible_people AS MATERIALIZED (
        SELECT person.person_id
        FROM current_person person
        WHERE person.status = 'active' AND person.subject_kind = 'person'
          AND cimmich_visibility_subject_rank(
            person.subject_kind, person.person_id
          ) <= ${visibleRank}
      ), scoped_person_assets AS MATERIALIZED (
        SELECT DISTINCT association.person_id, association.asset_id
        FROM person_assets association
        JOIN visible_people person ON person.person_id = association.person_id
        JOIN asset ON asset.asset_id = association.asset_id
          AND asset.state = 'active'
        WHERE association.authority_state = 'accepted'
          AND (${scope.personId} = '' OR association.person_id = ${scope.personId})
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
      ), scoped_assets AS MATERIALIZED (
        SELECT DISTINCT asset_id FROM scoped_person_assets
      ), asset_facts AS MATERIALIZED (
        SELECT scoped.asset_id,
          coalesce(visibility.visibility_tier, 'standard') AS privacy_tier
        FROM scoped_assets scoped
        LEFT JOIN cimmich_visibility_object visibility
          ON visibility.object_scope = 'asset'
          AND visibility.object_id = scoped.asset_id
      ), label_memberships AS MATERIALIZED (
        SELECT membership.asset_id, membership.label_id
        FROM current_asset_label_membership membership
        JOIN asset_facts facts ON facts.asset_id = membership.asset_id
        JOIN asset_label label ON label.label_id = membership.label_id
          AND label.status = 'active'
      ), context_memberships AS MATERIALIZED (
        SELECT link.asset_id, entity.entity_id, entity.entity_kind,
          entity.display_name
        FROM current_context_asset link
        JOIN asset_facts facts ON facts.asset_id = link.asset_id
        JOIN context_entity entity ON entity.entity_id = link.entity_id
          AND entity.status = 'active'
          AND entity.entity_kind IN ('place', 'event', 'object')
        WHERE cimmich_visibility_context_entity_rank(entity.entity_id)
          <= ${visibleRank}
      ), asset_flags AS MATERIALIZED (
        SELECT facts.*,
          (
            cardinality(${filters.privacyTiers}::text[]) = 0
            OR facts.privacy_tier = ANY(${filters.privacyTiers}::text[])
          ) AS privacy_match,
          (
            cardinality(${filters.labelIds}::text[]) = 0
            OR EXISTS (SELECT 1 FROM label_memberships membership
              WHERE membership.asset_id = facts.asset_id
                AND membership.label_id = ANY(${filters.labelIds}::text[]))
          ) AS label_match,
          (
            cardinality(${filters.placeIds}::text[]) = 0
            OR EXISTS (SELECT 1 FROM context_memberships membership
              WHERE membership.asset_id = facts.asset_id
                AND membership.entity_kind = 'place'
                AND membership.entity_id = ANY(${filters.placeIds}::text[]))
          ) AS place_match,
          (
            cardinality(${filters.eventIds}::text[]) = 0
            OR EXISTS (SELECT 1 FROM context_memberships membership
              WHERE membership.asset_id = facts.asset_id
                AND membership.entity_kind = 'event'
                AND membership.entity_id = ANY(${filters.eventIds}::text[]))
          ) AS event_match,
          (
            cardinality(${filters.thingIds}::text[]) = 0
            OR EXISTS (SELECT 1 FROM context_memberships membership
              WHERE membership.asset_id = facts.asset_id
                AND membership.entity_kind = 'object'
                AND membership.entity_id = ANY(${filters.thingIds}::text[]))
          ) AS thing_match
        FROM asset_facts facts
      ), matching_assets AS MATERIALIZED (
        SELECT asset_id FROM asset_flags
        WHERE privacy_match AND label_match AND place_match
          AND event_match AND thing_match
      ), privacy_rows AS (
        SELECT tier.id, tier.display_name AS "displayName",
          count(flags.asset_id) FILTER (WHERE flags.label_match
            AND flags.place_match AND flags.event_match
            AND flags.thing_match)::int AS count
        FROM (VALUES
          ('standard', 'Standard', 0),
          ('personal', 'Personal', 1),
          ('private', 'Private', 2)
        ) tier(id, display_name, position)
        LEFT JOIN asset_flags flags ON flags.privacy_tier = tier.id
        GROUP BY tier.id, tier.display_name, tier.position
        ORDER BY tier.position
      ), label_rows AS (
        SELECT label.label_id AS id, label.display_name AS "displayName",
          count(DISTINCT flags.asset_id) FILTER (WHERE flags.privacy_match
            AND flags.place_match AND flags.event_match
            AND flags.thing_match)::int AS count
        FROM asset_label label
        JOIN label_memberships membership
          ON membership.label_id = label.label_id
        JOIN asset_flags flags ON flags.asset_id = membership.asset_id
        WHERE label.status = 'active'
        GROUP BY label.label_id
        HAVING count(DISTINCT flags.asset_id) > 0
        ORDER BY count DESC, lower(label.display_name), label.label_id
        LIMIT 80
      ), context_counts AS (
        SELECT membership.entity_id AS id, membership.entity_kind,
          membership.display_name AS "displayName",
          count(DISTINCT flags.asset_id) FILTER (
            WHERE flags.privacy_match AND flags.label_match
              AND (membership.entity_kind = 'place' OR flags.place_match)
              AND (membership.entity_kind = 'event' OR flags.event_match)
              AND (membership.entity_kind = 'object' OR flags.thing_match)
          )::int AS count
        FROM context_memberships membership
        JOIN asset_flags flags ON flags.asset_id = membership.asset_id
        GROUP BY membership.entity_id, membership.entity_kind,
          membership.display_name
      ), context_rows AS (
        SELECT id, entity_kind, "displayName", count
        FROM (
          SELECT context_counts.*,
            row_number() OVER (PARTITION BY entity_kind
              ORDER BY count DESC, lower("displayName"), id) AS position
          FROM context_counts
        ) ranked
        WHERE position <= 80
      ), people_rows AS (
        SELECT association.person_id AS "personId",
          count(DISTINCT association.asset_id)::int AS "assetCount"
        FROM scoped_person_assets association
        JOIN matching_assets match ON match.asset_id = association.asset_id
        GROUP BY association.person_id
        ORDER BY "assetCount" DESC, association.person_id
        LIMIT 500
      )
      SELECT
        (SELECT count(*)::int FROM scoped_assets) AS "availableAssets",
        (SELECT count(*)::int FROM matching_assets) AS "totalAssets",
        coalesce((SELECT jsonb_agg(privacy_rows) FROM privacy_rows), '[]'::jsonb)
          AS privacy,
        coalesce((SELECT jsonb_agg(label_rows) FROM label_rows), '[]'::jsonb)
          AS labels,
        coalesce((SELECT jsonb_agg(context_rows) FILTER (
          WHERE context_rows.entity_kind = 'place'
        ) FROM context_rows), '[]'::jsonb) AS places,
        coalesce((SELECT jsonb_agg(context_rows) FILTER (
          WHERE context_rows.entity_kind = 'event'
        ) FROM context_rows), '[]'::jsonb) AS events,
        coalesce((SELECT jsonb_agg(context_rows) FILTER (
          WHERE context_rows.entity_kind = 'object'
        ) FROM context_rows), '[]'::jsonb) AS things,
        coalesce((SELECT jsonb_agg(people_rows) FROM people_rows), '[]'::jsonb)
          AS people
    `;
    const facetRows = (value) =>
      (Array.isArray(value) ? value : []).map(projectFacet);
    return {
      availableAssets: Number(projection?.availableAssets || 0),
      facets: {
        events: facetRows(projection?.events),
        labels: facetRows(projection?.labels),
        places: facetRows(projection?.places),
        privacy: facetRows(projection?.privacy),
        things: facetRows(projection?.things),
      },
      filters,
      people: Array.isArray(projection?.people)
        ? projection.people.map((row) => ({
            assetCount: Number(row.assetCount || 0),
            personId: row.personId,
          }))
        : [],
      schemaVersion,
      scope,
      totalAssets: Number(projection?.totalAssets || 0),
    };
  };
  return {
    clearExploreFacetSnapshot() {
      snapshots.clear();
    },
    async exploreFacets(input) {
      const filters = normalizeExploreFilters(input?.filters);
      const scope = cleanScope(input?.scope);
      const key = JSON.stringify({
        filters,
        scope,
        visibleRank: presentationRank(),
      });
      const cached = snapshots.get(key);
      if (cached && Date.now() - cached.refreshedAt < snapshotTtlMs) {
        return cached.result;
      }
      const result = await loadExploreFacets({ filters, scope });
      if (snapshots.size >= 48) {
        const oldestKey = snapshots.keys().next().value;
        if (oldestKey) snapshots.delete(oldestKey);
      }
      snapshots.set(key, { refreshedAt: Date.now(), result });
      return result;
    },
  };
};

export { schemaVersion as exploreFacetSchemaVersion };
