import assert from "node:assert/strict";
import test from "node:test";

import { createAddressGeocoder } from "../src/address-geocoding.mjs";

const feature = (overrides = {}) => ({
  geometry: { coordinates: [153.12, -29.47], type: "Point" },
  properties: {
    city: "Gulmarrad",
    country: "Australia",
    housenumber: "12",
    name: "River Street",
    osm_id: 42,
    osm_key: "place",
    osm_type: "N",
    postcode: "2463",
    state: "New South Wales",
    street: "River Street",
    type: "house",
    ...overrides,
  },
  type: "Feature",
});

test("Photon results are bounded, attributed, deterministic and cached by digest", async () => {
  const calls = [];
  const geocoder = createAddressGeocoder({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ features: [feature(), feature()] }));
    },
  });
  const first = await geocoder.search({
    limit: 5,
    query: "  12  River Street ",
  });
  const second = await geocoder.search({ limit: 5, query: "12 River Street" });
  assert.deepEqual(first, second);
  assert.equal(calls.length, 1);
  assert.equal(first.schemaVersion, "cimmich.address-geocoding.v1");
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].precision, "address");
  assert.equal(first.items[0].matchQuality, "exact");
  assert.equal(first.items[0].matchReason, "exact_address");
  assert.equal(first.items[0].addressLine, "12 River Street");
  assert.equal(first.attribution.label, "© OpenStreetMap contributors");
  assert.match(calls[0], /photon\.komoot\.io/);
  assert.match(calls[0], /\/structured\?/);
  assert.match(calls[0], /housenumber=12/);
  assert.match(calls[0], /street=River\+Street/);
});

test("structured-first exactness rejects the Bennelong false positive", async () => {
  const calls = [];
  const geocoder = createAddressGeocoder({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (new URL(url).pathname === "/structured") {
        return new Response(
          JSON.stringify({
            features: [
              feature({
                city: "Sydney",
                housenumber: undefined,
                name: "Bennelong Parkway",
                osm_id: 100,
                osm_key: "highway",
                postcode: "2127",
                street: undefined,
                type: "street",
              }),
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          features: [
            feature({
              city: "Sydney",
              housenumber: "1",
              name: "Macquarie Street",
              osm_id: 101,
              postcode: "2000",
              street: "Macquarie Street",
            }),
            feature({
              city: "Sydney",
              housenumber: undefined,
              name: "Sydney",
              osm_id: 102,
              osm_key: "place",
              postcode: "2000",
              street: undefined,
              type: "city",
            }),
          ],
        }),
      );
    },
  });
  const result = await geocoder.search({
    limit: 5,
    query: "1 Bennelong Point Sydney NSW",
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/structured\?/);
  assert.match(calls[0], /street=Bennelong\+Point/);
  assert.match(calls[0], /city=Sydney/);
  assert.equal(
    result.items.some((item) => item.matchQuality === "exact"),
    false,
  );
  assert.equal(
    result.items.some((item) => item.addressLine === "1 Macquarie Street"),
    false,
  );
  assert.equal(result.items[0].precision, "street");
  assert.equal(result.items[0].matchReason, "street_partial_match");
});

test("the Epping control resolves once as a query-consistent exact address", async () => {
  const calls = [];
  const geocoder = createAddressGeocoder({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          features: [
            feature({
              city: "Sydney",
              district: "Lane Cove North",
              housenumber: "15",
              name: "Epping Road",
              postcode: "2066",
              street: "Epping Road",
            }),
          ],
        }),
      );
    },
  });
  const result = await geocoder.search({
    query: "15 Epping Road Lane Cove NSW 2066",
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/structured\?/);
  assert.match(calls[0], /postcode=2066/);
  assert.equal(result.items[0].matchQuality, "exact");
  assert.equal(result.items[0].precision, "address");
});

test("unit, range, alphanumeric and comma forms retain conservative exactness", async () => {
  const queryCases = [
    {
      expectedQuality: "close",
      expectedReason: "unit_not_verified",
      providerNumber: "15",
      query: "Unit 5, 15 Epping Road, Lane Cove, NSW 2066",
    },
    {
      expectedQuality: "exact",
      expectedReason: "exact_address",
      providerNumber: "15-17",
      query: "15-17 Epping Road Lane Cove NSW 2066",
    },
    {
      expectedQuality: "exact",
      expectedReason: "exact_address",
      providerNumber: "15A",
      query: "15A Epping Road, Lane Cove NSW 2066",
    },
  ];
  for (const entry of queryCases) {
    const geocoder = createAddressGeocoder({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            features: [
              feature({
                city: "Sydney",
                district: "Lane Cove",
                housenumber: entry.providerNumber,
                name: "Epping Road",
                postcode: "2066",
                street: "Epping Road",
              }),
            ],
          }),
        ),
    });
    const result = await geocoder.search({ query: entry.query });
    assert.equal(result.items[0].matchQuality, entry.expectedQuality);
    assert.equal(result.items[0].matchReason, entry.expectedReason);
  }
});

test("a missing numbered point falls back only to honest street evidence", async () => {
  let calls = 0;
  const street = feature({
    city: "Sydney",
    district: "Lane Cove",
    housenumber: undefined,
    name: "Epping Road",
    osm_id: 201,
    osm_key: "highway",
    postcode: "2066",
    street: undefined,
    type: "street",
  });
  const geocoder = createAddressGeocoder({
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ features: [street] }));
    },
  });
  const result = await geocoder.search({
    query: "99 Epping Road Lane Cove NSW 2066",
  });
  assert.equal(calls, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].precision, "street");
  assert.equal(result.items[0].matchQuality, "close");
  assert.equal(result.items[0].matchReason, "house_number_unavailable");
});

test("query, result count, timeout, provider failure and rate are closed", async () => {
  const geocoder = createAddressGeocoder({
    fetchImpl: async () => new Response("no", { status: 503 }),
    maximumProviderRequestsPerMinute: 1,
  });
  await assert.rejects(() => geocoder.search({ query: "ab" }), {
    code: "ADDRESS_GEOCODING_QUERY_INVALID",
  });
  await assert.rejects(
    () => geocoder.search({ limit: 6, query: "valid query" }),
    {
      code: "ADDRESS_GEOCODING_LIMIT_INVALID",
    },
  );
  await assert.rejects(() => geocoder.search({ query: "first query" }), {
    code: "ADDRESS_GEOCODING_UNAVAILABLE",
  });
  await assert.rejects(() => geocoder.search({ query: "second query" }), {
    code: "ADDRESS_GEOCODING_UNAVAILABLE",
  });

  const timed = createAddressGeocoder({
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error(), { name: "AbortError" })),
        ),
      ),
    timeoutMs: 5,
  });
  await assert.rejects(() => timed.search({ query: "timeout query" }), {
    code: "ADDRESS_GEOCODING_TIMEOUT",
  });
});
