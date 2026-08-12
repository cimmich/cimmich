import assert from "node:assert/strict";
import test from "node:test";
import {
  createExploreFacetStore,
  normalizeExploreFilters,
} from "../src/explore-facets.mjs";

test("Explore filters normalize stable URL selections deterministically", () => {
  assert.deepEqual(
    normalizeExploreFilters({
      eventIds: ["event-two", "event-one", "event-one"],
      labelIds: ["label-two"],
      privacyTiers: ["private"],
    }),
    {
      eventIds: ["event-one", "event-two"],
      futureDates: false,
      labelIds: ["label-two"],
      placeIds: [],
      privacyTiers: ["private"],
      thingIds: [],
    },
  );
  assert.equal(
    normalizeExploreFilters({ futureDates: true }).futureDates,
    true,
  );
  assert.throws(
    () => normalizeExploreFilters({ privacyTiers: ["most-private"] }),
    (error) => error.code === "EXPLORE_FILTER_PRIVACY_INVALID",
  );
});

test("Explore facets return exact counts and bounded Person matches", async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    calls.push({ statement: strings.join("?"), values });
    return [
      {
        availableAssets: 10,
        events: [{ count: "3", displayName: "Birthday", id: "event-one" }],
        labels: [{ count: "4", displayName: "Restricted", id: "label-one" }],
        people: [{ assetCount: "2", personId: "person-one" }],
        places: [{ count: "5", displayName: "Sydney", id: "place-one" }],
        privacy: [{ count: "6", displayName: "Private", id: "private" }],
        things: [{ count: "1", displayName: "Cake", id: "thing-one" }],
        totalAssets: 2,
      },
    ];
  };
  const store = createExploreFacetStore(sql, {
    presentationRank: () => 2,
    requireVisibleSubject: async () => ({
      person_id: "person-one",
      subject_kind: "person",
    }),
  });
  const result = await store.exploreFacets({
    filters: { privacyTiers: ["private"] },
    scope: { kind: "person", personId: "person-one" },
  });
  assert.equal(result.schemaVersion, "cimmich.explore-facets.v1");
  assert.equal(result.totalAssets, 2);
  assert.deepEqual(result.people, [{ assetCount: 2, personId: "person-one" }]);
  assert.deepEqual(result.facets.labels, [
    { count: 4, displayName: "Restricted", id: "label-one" },
  ]);
  assert.match(calls[0].statement, /privacy_tier = ANY/);
  assert.match(
    calls[0].statement,
    /capture_time > now\(\) \+ interval '24 hours'/,
  );
  assert.match(calls[0].statement, /membership\.entity_kind = 'event'/);
  await store.exploreFacets({
    filters: { privacyTiers: ["private"] },
    scope: { kind: "person", personId: "person-one" },
  });
  assert.equal(calls.length, 1);
  store.clearExploreFacetSnapshot();
  await store.exploreFacets({
    filters: { privacyTiers: ["private"] },
    scope: { kind: "person", personId: "person-one" },
  });
  assert.equal(calls.length, 2);
});

test("Person Explore scope refuses a pet subject", async () => {
  const store = createExploreFacetStore(async () => [], {
    presentationRank: () => 2,
    requireVisibleSubject: async () => ({ subject_kind: "pet" }),
  });
  await assert.rejects(
    store.exploreFacets({ scope: { kind: "person", personId: "pet-one" } }),
    (error) => error.code === "PERSON_NOT_FOUND" && error.statusCode === 404,
  );
});
