const schemaVersion = "cimmich.smart-search-basic.v2";
const ignoredTerms = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "find",
  "from",
  "i",
  "in",
  "is",
  "media",
  "my",
  "of",
  "on",
  "photo",
  "photos",
  "picture",
  "pictures",
  "show",
  "that",
  "the",
  "video",
  "videos",
  "was",
  "we",
  "were",
  "where",
  "with",
]);

const typedError = (message, statusCode, code, details) =>
  Object.assign(new Error(message), {
    code,
    statusCode,
    ...(details ? { details } : {}),
  });

const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

const tokens = (value) => (normalize(value) ? normalize(value).split(" ") : []);
const projectDate = (value) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value == null
      ? null
      : String(value);

const cleanQuery = (value) => {
  const query = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 500) {
    throw typedError(
      "Smart Search query must contain 2 to 500 characters",
      400,
      "SMART_SEARCH_QUERY_INVALID",
    );
  }
  return query;
};

const cleanLimit = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return 100;
  }
  const limit = Number.parseInt(String(value), 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw typedError(
      "Smart Search limit must be an integer from 1 to 200",
      400,
      "SMART_SEARCH_LIMIT_INVALID",
    );
  }
  return limit;
};

const parseDateRange = (query) => {
  const exact = query.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (exact) {
    const value = `${exact[1]}-${exact[2]}-${exact[3]}`;
    const start = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isFinite(start.getTime()) &&
      start.toISOString().slice(0, 10) === value
    ) {
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return {
        endExclusive: end.toISOString(),
        precision: "day",
        sourceText: exact[0],
        startInclusive: start.toISOString(),
      };
    }
    throw typedError(
      `${value} is not a real ISO calendar date`,
      400,
      "SMART_SEARCH_DATE_INVALID",
      { sourceText: exact[0] },
    );
  }
  const month = query.match(/\b(\d{4})-(\d{2})\b/);
  if (month) {
    const year = Number(month[1]);
    const monthIndex = Number(month[2]) - 1;
    if (monthIndex >= 0 && monthIndex <= 11) {
      return {
        endExclusive: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString(),
        precision: "month",
        sourceText: month[0],
        startInclusive: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
      };
    }
    throw typedError(
      `${month[0]} is not a real ISO calendar month`,
      400,
      "SMART_SEARCH_DATE_INVALID",
      { sourceText: month[0] },
    );
  }
  const yearMatch = query.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return {
      endExclusive: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
      precision: "year",
      sourceText: yearMatch[0],
      startInclusive: new Date(Date.UTC(year, 0, 1)).toISOString(),
    };
  }
  return null;
};

const labelsFor = (candidate) => [
  candidate.display_name,
  ...(candidate.aliases || []),
];

const matchCandidate = (candidate, normalizedQuery, queryTerms) => {
  let best = null;
  for (const label of labelsFor(candidate)) {
    const normalizedLabel = normalize(label);
    const labelTerms = tokens(label);
    if (!normalizedLabel || !labelTerms.length) continue;
    if (
      normalizedQuery === normalizedLabel ||
      normalizedQuery.includes(` ${normalizedLabel} `) ||
      normalizedQuery.startsWith(`${normalizedLabel} `) ||
      normalizedQuery.endsWith(` ${normalizedLabel}`)
    ) {
      const score = 1000 + labelTerms.length * 100 + normalizedLabel.length;
      if (!best || score > best.score) {
        best = {
          coveredTerms: labelTerms,
          label,
          matchKind: "label",
          position: normalizedQuery.indexOf(normalizedLabel),
          score,
        };
      }
      continue;
    }
    if (labelTerms.every((term) => queryTerms.has(term))) {
      const score = 700 + labelTerms.length * 100 + normalizedLabel.length;
      if (!best || score > best.score) {
        best = {
          coveredTerms: labelTerms,
          label,
          matchKind: "label",
          position: Math.min(
            ...labelTerms.map((term) => normalizedQuery.indexOf(` ${term} `)),
          ),
          score,
        };
      }
    }
  }
  const descriptionTerms = tokens(candidate.description).filter((term) =>
    queryTerms.has(term),
  );
  if (!best && descriptionTerms.length) {
    best = {
      coveredTerms: [...new Set(descriptionTerms)],
      label: candidate.display_name,
      matchKind: "description",
      position: Math.min(
        ...descriptionTerms.map((term) => normalizedQuery.indexOf(` ${term} `)),
      ),
      score: 100 + descriptionTerms.length,
    };
  }
  return best;
};

const eliminateNestedLabels = (matches) =>
  matches.filter((candidate, index) => {
    if (candidate.match.matchKind !== "label") return true;
    const candidateTerms = new Set(candidate.match.coveredTerms);
    return !matches.some((other, otherIndex) => {
      if (
        index === otherIndex ||
        other.match.matchKind !== "label" ||
        other.match.coveredTerms.length <= candidate.match.coveredTerms.length
      ) {
        return false;
      }
      return [...candidateTerms].every((term) =>
        other.match.coveredTerms.includes(term),
      );
    });
  });

const DESCRIPTION_KIND_PRIORITY = new Map(
  ["place", "event", "object", "person", "pet", "document"].map(
    (kind, index) => [kind, index],
  ),
);

const selectNonConjunctiveDescriptions = (matches) => {
  const remaining = [...matches];
  const selected = [];
  while (remaining.length) {
    const component = [remaining.shift()];
    const terms = new Set(component[0].match.coveredTerms);
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = remaining.length - 1; index >= 0; index -= 1) {
        const candidate = remaining[index];
        if (!candidate.match.coveredTerms.some((term) => terms.has(term))) {
          continue;
        }
        component.push(candidate);
        for (const term of candidate.match.coveredTerms) terms.add(term);
        remaining.splice(index, 1);
        changed = true;
      }
    }
    const byKind = new Map();
    for (const candidate of component) {
      const group = byKind.get(candidate.entity_kind) || [];
      group.push(candidate);
      byKind.set(candidate.entity_kind, group);
    }
    const [winner] = [...byKind.entries()].sort(
      ([leftKind, left], [rightKind, right]) => {
        const leftTerms = new Set(
          left.flatMap((candidate) => candidate.match.coveredTerms),
        ).size;
        const rightTerms = new Set(
          right.flatMap((candidate) => candidate.match.coveredTerms),
        ).size;
        return (
          rightTerms - leftTerms ||
          (DESCRIPTION_KIND_PRIORITY.get(leftKind) ?? Number.MAX_SAFE_INTEGER) -
            (DESCRIPTION_KIND_PRIORITY.get(rightKind) ??
              Number.MAX_SAFE_INTEGER) ||
          leftKind.localeCompare(rightKind)
        );
      },
    );
    selected.push(...winner[1]);
  }
  return selected;
};

const selectMatches = (matches) => {
  const labelMatches = eliminateNestedLabels(
    matches.filter((candidate) => candidate.match.matchKind === "label"),
  );
  const labelTerms = new Set(
    labelMatches.flatMap((candidate) => candidate.match.coveredTerms),
  );
  const descriptionMatches = selectNonConjunctiveDescriptions(
    matches
      .filter((candidate) => candidate.match.matchKind === "description")
      .map((candidate) => ({
        ...candidate,
        match: {
          ...candidate.match,
          coveredTerms: candidate.match.coveredTerms.filter(
            (term) => !labelTerms.has(term),
          ),
        },
      }))
      .filter((candidate) => candidate.match.coveredTerms.length > 0),
  );
  return { descriptionMatches, labelMatches };
};

const buildSelectors = ({ descriptionMatches, labelMatches }) => {
  const selectors = labelMatches.map((candidate) => ({
    entityKind: candidate.entity_kind,
    ids: [candidate.entity_id],
    label: candidate.match.label,
    matchKind: candidate.match.matchKind,
    selectorKind: ["person", "pet"].includes(candidate.entity_kind)
      ? "subject"
      : candidate.entity_kind === "document"
        ? "document"
        : "context",
  }));
  const descriptionsByKind = new Map();
  for (const candidate of descriptionMatches) {
    const candidates = descriptionsByKind.get(candidate.entity_kind) || [];
    candidates.push(candidate);
    descriptionsByKind.set(candidate.entity_kind, candidates);
  }
  for (const [entityKind, candidates] of descriptionsByKind) {
    selectors.push({
      entityKind,
      ids: candidates.slice(0, 20).map((candidate) => candidate.entity_id),
      label: candidates
        .slice(0, 3)
        .map((candidate) => candidate.display_name)
        .join(" or "),
      matchKind: "description",
      selectorKind: ["person", "pet"].includes(entityKind)
        ? "subject"
        : entityKind === "document"
          ? "document"
          : "context",
    });
  }
  return selectors;
};

const projectCandidate = (row) => ({
  aliases: row.aliases || [],
  description: row.description || "",
  display_name: row.display_name,
  entity_id: row.entity_id,
  entity_kind: row.entity_kind,
});

export const createBasicSmartSearch = (
  sql,
  { bridgeFields = () => ({}), presentationRank = () => 0 } = {},
) => ({
  async search({ limit: requestedLimit, query: requestedQuery }) {
    const query = cleanQuery(requestedQuery);
    const limit = cleanLimit(requestedLimit);
    const normalizedQuery = ` ${normalize(query)} `;
    const queryTerms = new Set(
      tokens(query).filter((term) => !ignoredTerms.has(term)),
    );
    const dateRange = parseDateRange(query);
    if (dateRange) {
      for (const term of tokens(dateRange.sourceText)) queryTerms.delete(term);
    }
    const searchableTerms = [...queryTerms].filter((term) => term.length >= 2);
    let candidates = [];
    let candidateSetTruncated = false;
    if (searchableTerms.length) {
      const patterns = searchableTerms.map((term) => `%${term}%`);
      const rows = await sql`
        SELECT * FROM (
          SELECT person.person_id AS entity_id,
            person.subject_kind AS entity_kind, person.display_name,
            coalesce((SELECT array_agg(alias.label ORDER BY lower(alias.label), alias.alias_id)
              FROM person_alias alias WHERE alias.person_id = person.person_id
                AND alias.state = 'active'), ARRAY[]::text[]) AS aliases,
            person.description
          FROM person
          WHERE person.status = 'active'
            AND person.subject_kind IN ('person','pet')
            AND cimmich_visibility_subject_rank(
              person.subject_kind, person.person_id
            ) <= ${presentationRank()}
            AND (lower(person.display_name) LIKE ANY(${patterns}) OR EXISTS (
              SELECT 1 FROM person_alias alias
              WHERE alias.person_id = person.person_id AND alias.state = 'active'
                AND lower(alias.label) LIKE ANY(${patterns})
            ) OR lower(coalesce(person.description, '')) LIKE ANY(${patterns}))
          UNION ALL
          SELECT entity.entity_id, entity.entity_kind, entity.display_name,
            coalesce((SELECT array_agg(alias.label ORDER BY lower(alias.label), alias.alias_id)
              FROM context_entity_alias alias WHERE alias.entity_id = entity.entity_id
                AND alias.state = 'active'), ARRAY[]::text[]) AS aliases,
            entity.description
          FROM context_entity entity
          WHERE entity.status = 'active'
            AND cimmich_visibility_context_entity_rank(entity.entity_id) <= ${presentationRank()}
            AND (lower(entity.display_name) LIKE ANY(${patterns}) OR EXISTS (
              SELECT 1 FROM context_entity_alias alias
              WHERE alias.entity_id = entity.entity_id AND alias.state = 'active'
                AND lower(alias.label) LIKE ANY(${patterns})
            ) OR lower(coalesce(entity.description, '')) LIKE ANY(${patterns}))
          UNION ALL
          SELECT document.document_id, 'document'::text,
            document.display_title,
            array_remove(ARRAY[
              document.source_filename,
              document.document_label
            ]::text[], NULL) AS aliases,
            document.document_kind AS description
          FROM cimmich_document document
          WHERE document.status = 'active'
            AND cimmich_visibility_document_rank(document.document_id) <= ${presentationRank()}
            AND (
              lower(document.display_title) LIKE ANY(${patterns})
              OR lower(document.source_filename) LIKE ANY(${patterns})
              OR lower(coalesce(document.document_label, '')) LIKE ANY(${patterns})
              OR lower(document.document_kind) LIKE ANY(${patterns})
            )
        ) candidate
        ORDER BY candidate.entity_kind, lower(candidate.display_name), candidate.entity_id
        LIMIT 5001
      `;
      candidates = rows.slice(0, 5000).map(projectCandidate);
      candidateSetTruncated = rows.length > 5000;
    }
    const matches = candidates
      .map((candidate) => ({
        ...candidate,
        match: matchCandidate(candidate, normalizedQuery, queryTerms),
      }))
      .filter((candidate) => candidate.match)
      .sort(
        (left, right) =>
          Number(left.match.matchKind === "description") -
            Number(right.match.matchKind === "description") ||
          left.match.position - right.match.position ||
          right.match.score - left.match.score ||
          left.display_name.localeCompare(right.display_name),
      );
    const selectedMatches = selectMatches(matches);
    const selectors = buildSelectors(selectedMatches);
    const coveredTerms = new Set(
      [
        ...selectedMatches.labelMatches,
        ...selectedMatches.descriptionMatches,
      ].flatMap((candidate) => candidate.match.coveredTerms),
    );
    const unresolvedTerms = searchableTerms.filter(
      (term) => !coveredTerms.has(term),
    );
    if (!selectors.length && !dateRange) {
      return {
        documentHasMore: false,
        documents: [],
        hasMore: false,
        interpretation: {
          dateRange: null,
          candidateSetTruncated: Boolean(candidateSetTruncated),
          mode: "basic",
          selectors: [],
          unresolvedTerms,
        },
        items: [],
        query,
        schemaVersion,
      };
    }
    const visibleRank = presentationRank();
    const assetSelectors = selectors.filter((selector) =>
      ["context", "subject"].includes(selector.selectorKind),
    );
    const documentIds = selectors
      .filter((selector) => selector.selectorKind === "document")
      .flatMap((selector) => selector.ids);
    const selectorJson = sql.json(assetSelectors);
    const rows =
      assetSelectors.length || dateRange
        ? await sql`
      SELECT asset.asset_id, asset.capture_time, asset.height, asset.media_kind,
        asset.mime_type, asset.width
      FROM asset
      WHERE asset.state = 'active'
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
        AND (${dateRange === null} OR (
          asset.capture_time >= ${dateRange?.startInclusive || null}
          AND asset.capture_time < ${dateRange?.endExclusive || null}
        ))
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(${selectorJson}) selector
          WHERE NOT (
            (selector->>'selectorKind' = 'subject' AND EXISTS (
              SELECT 1 FROM person_assets association
              WHERE association.asset_id = asset.asset_id
                AND association.authority_state = 'accepted'
                AND association.person_id IN (
                  SELECT jsonb_array_elements_text(selector->'ids')
                )
            )) OR
            (selector->>'selectorKind' = 'context' AND EXISTS (
              SELECT 1 FROM current_context_asset association
              WHERE association.asset_id = asset.asset_id
                AND association.entity_id IN (
                  SELECT jsonb_array_elements_text(selector->'ids')
                )
            ))
          )
        )
      ORDER BY asset.capture_time DESC NULLS LAST, asset.asset_id
      LIMIT ${limit + 1}
    `
        : [];
    const documentRows = documentIds.length
      ? await sql`
        SELECT document.document_id, document.display_title,
          document.document_kind, document.document_label,
          document.issued_on, document.expires_on, document.source_filename,
          document.source_kind,
          coalesce(visibility.visibility_tier, document.visibility_tier)
            AS effective_visibility_tier,
          (SELECT count(*)::int FROM current_cimmich_document_link link
            WHERE link.document_id = document.document_id
              AND (link.subject_kind NOT IN ('person','pet')
                OR cimmich_visibility_subject_rank(
                  link.subject_kind, link.subject_id
                ) <= ${visibleRank})
              AND (link.subject_kind NOT IN ('place','object','event')
                OR cimmich_visibility_context_entity_rank(link.subject_id)
                  <= ${visibleRank})) AS subject_count
        FROM cimmich_document document
        LEFT JOIN cimmich_visibility_object visibility
          ON visibility.object_scope = 'document'
          AND visibility.object_id = document.document_id
        WHERE document.document_id = ANY(${documentIds})
          AND document.status = 'active'
          AND cimmich_visibility_document_rank(document.document_id) <= ${visibleRank}
        ORDER BY lower(document.display_title), document.document_id
        LIMIT ${limit + 1}
      `
      : [];
    const hasMore = rows.length > limit;
    const documentHasMore = documentRows.length > limit;
    return {
      documentHasMore,
      documents: documentRows.slice(0, limit).map((row) => ({
        displayTitle: row.display_title,
        documentId: row.document_id,
        documentKind: row.document_kind,
        documentLabel: row.document_label || null,
        effectiveVisibilityTier: row.effective_visibility_tier,
        expiresOn: projectDate(row.expires_on),
        issuedOn: projectDate(row.issued_on),
        sourceFilename: row.source_filename,
        sourceKind: row.source_kind,
        subjectCount: Number(row.subject_count || 0),
      })),
      hasMore,
      interpretation: {
        dateRange,
        candidateSetTruncated: Boolean(candidateSetTruncated),
        mode: "basic",
        selectors,
        unresolvedTerms,
      },
      items: rows.slice(0, limit).map((row) => ({
        assetId: row.asset_id,
        captureTime: row.capture_time,
        height: row.height,
        mediaKind: row.media_kind,
        mimeType: row.mime_type,
        ...bridgeFields(row.asset_id),
        width: row.width,
      })),
      query,
      schemaVersion,
    };
  },
});

export const basicSmartSearchContract = Object.freeze({ schemaVersion });
