import assert from "node:assert/strict";
import test from "node:test";
import { createBasicSmartSearch } from "../src/basic-smart-search.mjs";

const fakeSql = ({ assets = [], candidates = [], documents = [] } = {}) => {
  const calls = [];
  const sql = async (strings, ...values) => {
    const statement = strings.join("?");
    calls.push({ statement, values });
    if (statement.includes("SELECT * FROM (")) return candidates;
    if (statement.includes("FROM cimmich_document document")) return documents;
    if (statement.includes("FROM asset")) return assets;
    throw new Error(`Unexpected SQL: ${statement}`);
  };
  sql.json = (value) => value;
  return { calls, sql };
};

test("Basic Smart Search recognizes named subjects, context and year without private fields", async () => {
  const { calls, sql } = fakeSql({
    assets: [
      {
        asset_id: "asset-one",
        capture_time: new Date("2025-06-01T12:00:00Z"),
        height: 800,
        media_kind: "image",
        mime_type: "image/jpeg",
        width: 1200,
      },
    ],
    candidates: [
      {
        aliases: ["Jane"],
        description: "",
        display_name: "Jane Doe",
        entity_id: "person-jane",
        entity_kind: "person",
      },
      {
        aliases: ["Greek beach"],
        description: "Mojitos by the water",
        display_name: "Naxos beach",
        entity_id: "place-naxos",
        entity_kind: "place",
      },
    ],
  });
  const search = createBasicSmartSearch(sql, {
    bridgeFields: () => ({ filename: "safe.jpg", sourceAssetId: "source-one" }),
    presentationRank: () => 1,
  });
  const result = await search.search({
    limit: 20,
    query:
      "That photo with Jane Doe drinking mojitos on the Greek beach in 2025",
  });
  assert.equal(result.schemaVersion, "cimmich.smart-search-basic.v2");
  assert.deepEqual(result.documents, []);
  assert.deepEqual(
    result.interpretation.selectors.map((selector) => [
      selector.entityKind,
      selector.ids,
    ]),
    [
      ["person", ["person-jane"]],
      ["place", ["place-naxos"]],
    ],
  );
  assert.equal(result.interpretation.dateRange.precision, "year");
  assert.deepEqual(result.interpretation.unresolvedTerms, [
    "drinking",
    "mojitos",
  ]);
  assert.equal(result.items[0].assetId, "asset-one");
  assert.equal(result.items[0].filename, "safe.jpg");
  assert.equal(calls.length, 2);
  assert.match(
    calls[0].statement,
    /cimmich_visibility_context_entity_rank\(entity\.entity_id\) <=/,
  );
  assert.match(calls[1].statement, /cimmich_visibility_asset_rank/);
  assert.doesNotMatch(calls[0].statement, /person_profile|private_notes/i);
});

test("Basic Smart Search lets exact labels and aliases dominate same-term descriptions", async () => {
  const exactCases = [
    { entityKind: "person", label: "Maya Chen", query: "Maya Chen" },
    { entityKind: "pet", label: "Pixel", query: "Pip", aliases: ["Pip"] },
    {
      entityKind: "place",
      label: "Bluewater Reserve",
      query: "Bluewater",
      aliases: ["Bluewater"],
    },
    { entityKind: "object", label: "Star Quilt", query: "Star Quilt" },
    { entityKind: "event", label: "Lantern Night", query: "Lantern Night" },
  ];

  for (const [index, exact] of exactCases.entries()) {
    const { sql } = fakeSql({
      assets: [
        {
          asset_id: `asset-${index}`,
          capture_time: new Date("2026-07-01T00:00:00Z"),
          height: 800,
          media_kind: "image",
          mime_type: "image/jpeg",
          width: 1200,
        },
      ],
      candidates: [
        {
          aliases: exact.aliases || [],
          description: "",
          display_name: exact.label,
          entity_id: `exact-${index}`,
          entity_kind: exact.entityKind,
        },
        {
          aliases: [],
          description: `${exact.query} appears in this owner-authored description`,
          display_name: `Description collision ${index}`,
          entity_id: `collision-${index}`,
          entity_kind: exact.entityKind === "person" ? "place" : "person",
        },
      ],
    });

    const result = await createBasicSmartSearch(sql).search({
      query: exact.query,
    });
    assert.deepEqual(result.interpretation.selectors, [
      {
        entityKind: exact.entityKind,
        ids: [`exact-${index}`],
        label: exact.aliases?.[0] || exact.label,
        matchKind: "label",
        selectorKind: ["person", "pet"].includes(exact.entityKind)
          ? "subject"
          : "context",
      },
    ]);
    assert.equal(result.items.length, 1);
  }
});

test("Basic Smart Search keeps AND semantics across distinct matched terms", async () => {
  const { calls, sql } = fakeSql({
    assets: [
      {
        asset_id: "asset-maya-garden",
        capture_time: new Date("2026-07-01T00:00:00Z"),
        height: 800,
        media_kind: "image",
        mime_type: "image/jpeg",
        width: 1200,
      },
    ],
    candidates: [
      {
        aliases: ["Maya"],
        description: "",
        display_name: "Maya Chen",
        entity_id: "person-maya",
        entity_kind: "person",
      },
      {
        aliases: [],
        description: "Maya volunteers here",
        display_name: "Willow Community Garden",
        entity_id: "place-willow",
        entity_kind: "place",
      },
      {
        aliases: [],
        description: "A garden with raised beds",
        display_name: "Cedar House",
        entity_id: "place-cedar",
        entity_kind: "place",
      },
    ],
  });

  const result = await createBasicSmartSearch(sql).search({
    query: "Maya garden",
  });
  assert.deepEqual(
    result.interpretation.selectors.map((selector) => [
      selector.entityKind,
      selector.ids,
      selector.matchKind,
    ]),
    [
      ["person", ["person-maya"], "label"],
      ["place", ["place-cedar"], "description"],
    ],
  );
  assert.deepEqual(result.interpretation.unresolvedTerms, []);
  assert.deepEqual(
    calls[1].values.find((value) => Array.isArray(value)),
    [
      {
        entityKind: "person",
        ids: ["person-maya"],
        label: "Maya",
        matchKind: "label",
        selectorKind: "subject",
      },
      {
        entityKind: "place",
        ids: ["place-cedar"],
        label: "Cedar House",
        matchKind: "description",
        selectorKind: "context",
      },
    ],
  );
});

test("Basic Smart Search does not AND description-only collisions onto an exact subject and place intent", async () => {
  const search = async ({ candidates, query }) => {
    const { sql } = fakeSql({
      assets: [
        {
          asset_id: `asset-${query}`,
          capture_time: new Date("2026-07-01T00:00:00Z"),
          height: 800,
          media_kind: "image",
          mime_type: "image/jpeg",
          width: 1200,
        },
      ],
      candidates,
    });
    return createBasicSmartSearch(sql).search({ query });
  };

  const juniper = await search({
    candidates: [
      {
        aliases: [],
        description: "",
        display_name: "Juniper",
        entity_id: "pet-juniper",
        entity_kind: "pet",
      },
      {
        aliases: [],
        description: "Juniper visits the garden",
        display_name: "Willow Community Garden",
        entity_id: "place-willow",
        entity_kind: "place",
      },
      {
        aliases: [],
        description: "Juniper rides beside the garden beds",
        display_name: "Moss",
        entity_id: "object-moss",
        entity_kind: "object",
      },
      {
        aliases: [],
        description: "Juniper joins the garden crew",
        display_name: "Saturday Garden Crew",
        entity_id: "event-garden-crew",
        entity_kind: "event",
      },
    ],
    query: "Juniper at the garden",
  });
  assert.deepEqual(
    juniper.interpretation.selectors.map((selector) => [
      selector.entityKind,
      selector.ids,
      selector.matchKind,
    ]),
    [
      ["pet", ["pet-juniper"], "label"],
      ["place", ["place-willow"], "description"],
    ],
  );
  assert.deepEqual(juniper.interpretation.unresolvedTerms, []);
  assert.equal(juniper.items.length, 1);

  const maya = await search({
    candidates: [
      {
        aliases: ["Maya"],
        description: "",
        display_name: "Maya Chen",
        entity_id: "person-maya",
        entity_kind: "person",
      },
      {
        aliases: [],
        description: "",
        display_name: "Cedar House",
        entity_id: "place-cedar",
        entity_kind: "place",
      },
      {
        aliases: [],
        description: "Maya visits Cedar House",
        display_name: "Cedar House Years",
        entity_id: "event-cedar-years",
        entity_kind: "event",
      },
    ],
    query: "Maya at Cedar House",
  });
  assert.deepEqual(
    maya.interpretation.selectors.map((selector) => [
      selector.entityKind,
      selector.ids,
      selector.matchKind,
    ]),
    [
      ["person", ["person-maya"], "label"],
      ["place", ["place-cedar"], "label"],
    ],
  );
  assert.equal(maya.items.length, 1);
});

test("Basic Smart Search keeps the longest exact label for one nested span", async () => {
  const { sql } = fakeSql({
    assets: [
      {
        asset_id: "asset-bluewater-weekend",
        capture_time: new Date("2026-07-01T00:00:00Z"),
        height: 800,
        media_kind: "image",
        mime_type: "image/jpeg",
        width: 1200,
      },
    ],
    candidates: [
      {
        aliases: ["Bluewater"],
        description: "",
        display_name: "Bluewater Reserve",
        entity_id: "place-bluewater",
        entity_kind: "place",
      },
      {
        aliases: [],
        description: "",
        display_name: "Bluewater Weekend",
        entity_id: "event-bluewater-weekend",
        entity_kind: "event",
      },
    ],
  });

  const result = await createBasicSmartSearch(sql).search({
    query: "Bluewater Weekend",
  });
  assert.deepEqual(result.interpretation.selectors, [
    {
      entityKind: "event",
      ids: ["event-bluewater-weekend"],
      label: "Bluewater Weekend",
      matchKind: "label",
      selectorKind: "context",
    },
  ]);
  assert.equal(result.items.length, 1);
});

test("Basic Smart Search returns only visible active Documents without manufacturing photo results", async () => {
  const { calls, sql } = fakeSql({
    candidates: [
      {
        aliases: ["audit-plain.txt", "Plain note"],
        description: "manual",
        display_name: "Audit Plain Document",
        entity_id: "document-audit-plain",
        entity_kind: "document",
      },
    ],
    documents: [
      {
        display_title: "Audit Plain Document",
        document_id: "document-audit-plain",
        document_kind: "manual",
        document_label: "Plain note",
        effective_visibility_tier: "personal",
        expires_on: null,
        issued_on: new Date("2026-07-19T00:00:00.000Z"),
        source_filename: "audit-plain.txt",
        source_kind: "cimmich_file",
        subject_count: 2,
      },
    ],
  });
  const result = await createBasicSmartSearch(sql, {
    presentationRank: () => 1,
  }).search({ query: "Audit Plain Document" });
  assert.deepEqual(result.items, []);
  assert.equal(result.documents.length, 1);
  assert.deepEqual(result.documents[0], {
    displayTitle: "Audit Plain Document",
    documentId: "document-audit-plain",
    documentKind: "manual",
    documentLabel: "Plain note",
    effectiveVisibilityTier: "personal",
    expiresOn: null,
    issuedOn: "2026-07-19",
    sourceFilename: "audit-plain.txt",
    sourceKind: "cimmich_file",
    subjectCount: 2,
  });
  assert.equal(result.documentHasMore, false);
  assert.deepEqual(result.interpretation.selectors, [
    {
      entityKind: "document",
      ids: ["document-audit-plain"],
      label: "Audit Plain Document",
      matchKind: "label",
      selectorKind: "document",
    },
  ]);
  assert.equal(
    calls.some((call) => call.statement.includes("FROM asset")),
    false,
  );
  assert.match(
    calls[0].statement,
    /cimmich_visibility_document_rank\(document\.document_id\) <=/,
  );
  assert.match(
    calls[1].statement,
    /cimmich_visibility_document_rank\(document\.document_id\) <=/,
  );
  assert.match(
    calls[1].statement,
    /cimmich_visibility_subject_rank\([\s\S]*link\.subject_kind,[\s\S]*link\.subject_id[\s\S]*<=/,
  );
  assert.match(
    calls[1].statement,
    /cimmich_visibility_context_entity_rank\(link\.subject_id\)\s*<=/,
  );
});

test("Basic Smart Search abstains honestly when no local selector or date resolves", async () => {
  const { calls, sql } = fakeSql({ candidates: [] });
  const search = createBasicSmartSearch(sql);
  const result = await search.search({ query: "purple invisible unicorn" });
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.documents, []);
  assert.deepEqual(result.interpretation.unresolvedTerms, [
    "purple",
    "invisible",
    "unicorn",
  ]);
  assert.equal(calls.length, 1);
});

test("Basic Smart Search rejects unbounded queries and result requests", async () => {
  const { sql } = fakeSql();
  const search = createBasicSmartSearch(sql);
  await assert.rejects(() => search.search({ query: "x" }), {
    code: "SMART_SEARCH_QUERY_INVALID",
  });
  await assert.rejects(
    () => search.search({ limit: 201, query: "valid query" }),
    {
      code: "SMART_SEARCH_LIMIT_INVALID",
    },
  );
  await assert.rejects(() => search.search({ query: "photos in 2025-99-99" }), {
    code: "SMART_SEARCH_DATE_INVALID",
  });
});

test("Basic Smart Search reports deterministic candidate truncation", async () => {
  const candidates = Array.from({ length: 5001 }, (_, index) => ({
    aliases: [],
    description: "blue",
    display_name: `Synthetic ${String(index).padStart(4, "0")}`,
    entity_id: `place-${index}`,
    entity_kind: "place",
  }));
  const { sql } = fakeSql({ candidates });
  const result = await createBasicSmartSearch(sql).search({ query: "blue" });
  assert.equal(result.interpretation.candidateSetTruncated, true);
  assert.equal(result.interpretation.selectors[0].ids.length, 20);
});
