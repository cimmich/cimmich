import { createHash } from "node:crypto";

export const addressGeocodingSchemaVersion = "cimmich.address-geocoding.v1";

const provider = Object.freeze({
  id: "photon",
  name: "Photon",
  queryDisclosure: "typed_address_sent_to_provider",
});
const attribution = Object.freeze({
  label: "© OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/copyright",
});

const typedError = (message, statusCode, code) =>
  Object.assign(new Error(message), { code, statusCode });

const readBoundedProviderBody = async (response, maximumBytes = 262_144) => {
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw typedError(
      "Address search provider response is unavailable",
      503,
      "ADDRESS_GEOCODING_UNAVAILABLE",
    );
  }
  if (!response?.body?.getReader) {
    const raw = await response.text();
    if (Buffer.byteLength(raw) <= maximumBytes) return raw;
    throw typedError(
      "Address search provider response is unavailable",
      503,
      "ADDRESS_GEOCODING_UNAVAILABLE",
    );
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw typedError(
          "Address search provider response is unavailable",
          503,
          "ADDRESS_GEOCODING_UNAVAILABLE",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, byteLength).toString("utf8");
};

const cleanQuery = (value) => {
  const query = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (
    query.length < 3 ||
    query.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(query)
  ) {
    throw typedError(
      "Address query must contain 3 to 160 characters",
      400,
      "ADDRESS_GEOCODING_QUERY_INVALID",
    );
  }
  return query;
};

const cleanLimit = (value) => {
  const limit = value == null || value === "" ? 5 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw typedError(
      "Address result limit must be between 1 and 5",
      400,
      "ADDRESS_GEOCODING_LIMIT_INVALID",
    );
  }
  return limit;
};

const text = (value) => {
  const result = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return result ? result.slice(0, 240) : null;
};

const australianStates = Object.freeze([
  ["australian capital territory", "Australian Capital Territory"],
  ["new south wales", "New South Wales"],
  ["northern territory", "Northern Territory"],
  ["south australia", "South Australia"],
  ["western australia", "Western Australia"],
  ["queensland", "Queensland"],
  ["tasmania", "Tasmania"],
  ["victoria", "Victoria"],
  ["act", "Australian Capital Territory"],
  ["nsw", "New South Wales"],
  ["nt", "Northern Territory"],
  ["qld", "Queensland"],
  ["sa", "South Australia"],
  ["tas", "Tasmania"],
  ["vic", "Victoria"],
  ["wa", "Western Australia"],
]);
const streetSuffixes = new Map(
  Object.entries({
    avenue: "avenue",
    ave: "avenue",
    boulevard: "boulevard",
    blvd: "boulevard",
    circuit: "circuit",
    cct: "circuit",
    close: "close",
    court: "court",
    ct: "court",
    cres: "crescent",
    crescent: "crescent",
    dr: "drive",
    drive: "drive",
    esplanade: "esplanade",
    highway: "highway",
    hwy: "highway",
    lane: "lane",
    ln: "lane",
    parade: "parade",
    parkway: "parkway",
    pde: "parade",
    pkway: "parkway",
    place: "place",
    pl: "place",
    rd: "road",
    road: "road",
    st: "street",
    street: "street",
    tce: "terrace",
    terrace: "terrace",
    track: "track",
    trail: "trail",
    way: "way",
  }),
);

const normalizedWords = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => streetSuffixes.get(word) || word);

const normalizedPhrase = (value) => normalizedWords(value).join(" ");

const parseNumberedAddress = (query) => {
  let remaining = query.trim();
  let unitNumber = null;
  const unitPrefix = remaining.match(
    /^(?:unit|apartment|apt|suite)\s+([a-z0-9-]+)\s*[,/]?\s+/i,
  );
  if (unitPrefix) {
    unitNumber = unitPrefix[1].toUpperCase();
    remaining = remaining.slice(unitPrefix[0].length);
  }
  const numberPrefix = remaining.match(
    /^([0-9]+[a-z]?(?:-[0-9]+[a-z]?)?|[0-9]+[a-z]?\/[0-9]+[a-z]?)\s*[,]?\s+/i,
  );
  if (!numberPrefix) return null;
  let houseNumber = numberPrefix[1].toUpperCase();
  if (!unitNumber && houseNumber.includes("/")) {
    [unitNumber, houseNumber] = houseNumber.split("/", 2);
  }
  remaining = remaining.slice(numberPrefix[0].length).trim();

  let countrycode = null;
  if (/(?:,|\s)(?:australia|aus|au)$/i.test(remaining)) {
    countrycode = "AU";
    remaining = remaining.replace(/(?:,|\s)(?:australia|aus|au)$/i, "").trim();
  }
  let postcode = null;
  const postcodeMatch = remaining.match(/(?:,|\s)([0-9]{4})$/);
  if (postcodeMatch) {
    postcode = postcodeMatch[1];
    remaining = remaining.slice(0, postcodeMatch.index).trim();
  }
  let state = null;
  const stateInput = remaining.toLowerCase().replace(/[,.\s]+$/g, "");
  for (const [alias, canonical] of australianStates) {
    if (stateInput === alias || stateInput.endsWith(` ${alias}`)) {
      state = canonical;
      countrycode = "AU";
      remaining = remaining
        .slice(0, remaining.length - alias.length)
        .replace(/[,.\s]+$/g, "");
      break;
    }
  }
  const words = remaining
    .replace(/,/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return null;
  let suffixIndex = -1;
  for (let index = 1; index < words.length; index += 1) {
    if (streetSuffixes.has(normalizedPhrase(words[index]))) {
      suffixIndex = index;
      break;
    }
  }
  const streetWords =
    suffixIndex >= 0
      ? words.slice(0, suffixIndex + 1)
      : words.length >= 3
        ? words.slice(0, -1)
        : words;
  const cityWords =
    suffixIndex >= 0
      ? words.slice(suffixIndex + 1)
      : words.length >= 3
        ? words.slice(-1)
        : [];
  const street = streetWords.join(" ");
  if (!normalizedPhrase(street)) return null;
  return Object.freeze({
    city: cityWords.join(" ") || null,
    countrycode,
    houseNumber,
    postcode,
    state,
    street,
    unitNumber,
  });
};

const phraseRelated = (left, right) => {
  const leftWords = normalizedWords(left);
  const rightWords = normalizedWords(right);
  if (!leftWords.length || !rightWords.length) return false;
  const leftPhrase = leftWords.join(" ");
  const rightPhrase = rightWords.join(" ");
  return (
    leftPhrase === rightPhrase ||
    leftPhrase.startsWith(`${rightPhrase} `) ||
    rightPhrase.startsWith(`${leftPhrase} `)
  );
};

const streetAgreement = (requested, returned) => {
  const requestedWords = normalizedWords(requested);
  const returnedWords = normalizedWords(returned);
  if (!requestedWords.length || !returnedWords.length) return "none";
  if (requestedWords.join(" ") === returnedWords.join(" ")) return "exact";
  const requestedMeaningful = requestedWords.filter(
    (word) => ![...streetSuffixes.values()].includes(word) && word !== "the",
  );
  const returnedMeaningful = returnedWords.filter(
    (word) => ![...streetSuffixes.values()].includes(word) && word !== "the",
  );
  const overlap = requestedMeaningful.filter((word) =>
    returnedMeaningful.includes(word),
  ).length;
  return overlap > 0 && overlap / Math.max(requestedMeaningful.length, 1) >= 0.5
    ? "related"
    : "none";
};

const localityAgrees = (query, properties) => {
  if (
    query.postcode &&
    normalizedPhrase(properties.postcode) !== query.postcode
  )
    return false;
  if (query.state && !phraseRelated(query.state, properties.state))
    return false;
  if (query.city) {
    const localities = [
      properties.city,
      properties.locality,
      properties.district,
      properties.county,
    ].filter(Boolean);
    if (!localities.some((value) => phraseRelated(query.city, value)))
      return false;
  }
  return true;
};

const resultId = (feature) =>
  `address_${createHash("sha256")
    .update(
      JSON.stringify({
        coordinates: feature?.geometry?.coordinates,
        osmId: feature?.properties?.osm_id ?? null,
        osmType: feature?.properties?.osm_type ?? null,
        type: feature?.properties?.type ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 32)}`;

const projectFeature = (feature, query) => {
  const coordinates = feature?.geometry?.coordinates;
  const properties = feature?.properties;
  if (
    feature?.type !== "Feature" ||
    !properties ||
    typeof properties !== "object" ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2
  )
    return null;
  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return null;

  const name = text(properties.name);
  const street = text(properties.street || properties.name);
  const houseNumber = text(properties.housenumber);
  const addressLine = text(
    houseNumber && street ? `${houseNumber} ${street}` : street || name,
  );
  const locality = text(
    properties.city ||
      properties.locality ||
      properties.district ||
      properties.county,
  );
  const admin1 = text(properties.state);
  const postcode = text(properties.postcode);
  const country = text(properties.country);
  const layer = String(
    properties.type || properties.osm_value || "",
  ).toLowerCase();
  let precision = houseNumber
    ? "address"
    : layer === "street" || properties.osm_key === "highway"
      ? "street"
      : "place";
  let matchQuality = precision === "place" ? "broad" : "close";
  let matchReason =
    precision === "place" ? "provider_broad_match" : "provider_match";
  if (query) {
    const returnedStreet = street || name;
    const streetMatch = streetAgreement(query.street, returnedStreet);
    const returnedNumber = normalizedPhrase(houseNumber).replace(/\s/g, "");
    const requestedNumber = normalizedPhrase(query.houseNumber).replace(
      /\s/g,
      "",
    );
    const numberMatches =
      returnedNumber && requestedNumber && returnedNumber === requestedNumber;
    if (houseNumber) {
      if (streetMatch !== "exact" || !numberMatches) return null;
      if (
        query.unitNumber &&
        normalizedPhrase(houseNumber).replace(/\s/g, "") !==
          normalizedPhrase(`${query.unitNumber}/${query.houseNumber}`).replace(
            /\s/g,
            "",
          )
      ) {
        matchQuality = "close";
        matchReason = "unit_not_verified";
      } else if (!localityAgrees(query, properties)) {
        matchQuality = "close";
        matchReason = "locality_not_confirmed";
      } else {
        matchQuality = "exact";
        matchReason = "exact_address";
      }
    } else if (precision === "street" && streetMatch !== "none") {
      matchQuality = streetMatch === "exact" ? "close" : "broad";
      matchReason =
        streetMatch === "exact"
          ? "house_number_unavailable"
          : "street_partial_match";
    } else if (
      precision === "place" &&
      query.city &&
      [properties.city, properties.locality, properties.district, name].some(
        (value) => phraseRelated(query.city, value),
      )
    ) {
      matchQuality = "broad";
      matchReason = "locality_match";
    } else {
      return null;
    }
  }
  const label = [
    ...new Set(
      [addressLine, locality, admin1, postcode, country].filter(Boolean),
    ),
  ]
    .join(", ")
    .slice(0, 500);
  if (!label) return null;
  return {
    addressLine,
    admin1,
    country,
    label,
    latitude,
    locality,
    longitude,
    matchQuality,
    matchReason,
    name: name || addressLine || label,
    postcode,
    precision,
    resultId: resultId(feature),
  };
};

export const createAddressGeocoder = ({
  cacheTtlMs = 300_000,
  fetchImpl = globalThis.fetch,
  maximumCacheEntries = 256,
  maximumProviderRequestsPerMinute = 60,
  now = () => Date.now(),
  providerUrl = "https://photon.komoot.io/api/",
  timeoutMs = 4_000,
} = {}) => {
  if (typeof fetchImpl !== "function")
    throw new TypeError("fetchImpl is required");
  const cache = new Map();
  const inFlight = new Map();
  let windowStartedAt = now();
  let windowRequests = 0;

  const search = async ({ limit: rawLimit, query: rawQuery }) => {
    const query = cleanQuery(rawQuery);
    const limit = cleanLimit(rawLimit);
    const key = createHash("sha256")
      .update(`${query}\u001f${limit}`)
      .digest("hex");
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    if (inFlight.has(key)) return inFlight.get(key);
    if (now() - windowStartedAt >= 60_000) {
      windowStartedAt = now();
      windowRequests = 0;
    }
    const operation = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const providerRequest = async (url) => {
          if (now() - windowStartedAt >= 60_000) {
            windowStartedAt = now();
            windowRequests = 0;
          }
          if (windowRequests >= maximumProviderRequestsPerMinute)
            throw typedError(
              "Address search is temporarily unavailable",
              503,
              "ADDRESS_GEOCODING_UNAVAILABLE",
            );
          windowRequests += 1;
          const response = await fetchImpl(url, {
            headers: {
              accept: "application/geo+json, application/json",
              "user-agent": "Cimmich/1 address-geocoding",
            },
            redirect: "error",
            signal: controller.signal,
          });
          if (!response.ok)
            throw typedError(
              "Address search provider is unavailable",
              503,
              "ADDRESS_GEOCODING_UNAVAILABLE",
            );
          const raw = await readBoundedProviderBody(response);
          try {
            return JSON.parse(raw);
          } catch {
            throw typedError(
              "Address search provider response is unavailable",
              503,
              "ADDRESS_GEOCODING_UNAVAILABLE",
            );
          }
        };
        const numbered = parseNumberedAddress(query);
        const payloads = [];
        if (numbered) {
          const structuredUrl = new URL("/structured", providerUrl);
          for (const field of [
            "city",
            "countrycode",
            "housenumber",
            "postcode",
            "state",
            "street",
          ]) {
            const value =
              field === "housenumber" ? numbered.houseNumber : numbered[field];
            if (value) structuredUrl.searchParams.set(field, value);
          }
          structuredUrl.searchParams.set("limit", String(limit));
          structuredUrl.searchParams.set("lang", "en");
          const structured = await providerRequest(structuredUrl);
          payloads.push(structured);
          const structuredItems = (
            Array.isArray(structured?.features) ? structured.features : []
          )
            .map((feature) => projectFeature(feature, numbered))
            .filter(Boolean);
          if (!structuredItems.some((item) => item.matchQuality === "exact")) {
            const freeUrl = new URL(providerUrl);
            freeUrl.searchParams.set("q", query);
            freeUrl.searchParams.set("limit", String(limit));
            freeUrl.searchParams.set("lang", "en");
            for (const layer of [
              "house",
              "street",
              "locality",
              "district",
              "city",
            ])
              freeUrl.searchParams.append("layer", layer);
            payloads.push(await providerRequest(freeUrl));
          }
        } else {
          const freeUrl = new URL(providerUrl);
          freeUrl.searchParams.set("q", query);
          freeUrl.searchParams.set("limit", String(limit));
          freeUrl.searchParams.set("lang", "en");
          for (const layer of [
            "house",
            "street",
            "locality",
            "district",
            "city",
          ])
            freeUrl.searchParams.append("layer", layer);
          payloads.push(await providerRequest(freeUrl));
        }
        const seen = new Set();
        const items = [];
        for (const payload of payloads) {
          for (const feature of Array.isArray(payload?.features)
            ? payload.features
            : []) {
            const item = projectFeature(feature, numbered);
            if (!item || seen.has(item.resultId)) continue;
            seen.add(item.resultId);
            items.push(item);
          }
        }
        const qualityRank = { exact: 0, close: 1, broad: 2 };
        const precisionRank = { address: 0, street: 1, place: 2 };
        items.sort(
          (left, right) =>
            qualityRank[left.matchQuality] - qualityRank[right.matchQuality] ||
            precisionRank[left.precision] - precisionRank[right.precision] ||
            left.label.localeCompare(right.label) ||
            left.resultId.localeCompare(right.resultId),
        );
        items.splice(limit);
        const value = Object.freeze({
          attribution,
          items: Object.freeze(items.map((item) => Object.freeze(item))),
          provider,
          schemaVersion: addressGeocodingSchemaVersion,
        });
        cache.set(key, { expiresAt: now() + cacheTtlMs, value });
        while (cache.size > maximumCacheEntries)
          cache.delete(cache.keys().next().value);
        return value;
      } catch (error) {
        if (error?.name === "AbortError")
          throw typedError(
            "Address search timed out",
            504,
            "ADDRESS_GEOCODING_TIMEOUT",
          );
        if (error?.code) throw error;
        throw typedError(
          "Address search provider is unavailable",
          503,
          "ADDRESS_GEOCODING_UNAVAILABLE",
        );
      } finally {
        clearTimeout(timeout);
      }
    })();
    inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(key);
    }
  };
  return Object.freeze({ search });
};
