import { createCoalescingMaintenanceLane } from "./coalescing-maintenance-lane.mjs";
import {
  applyFaceBodyLinks,
  buildFaceBodyLinks,
  loadFaceBodyLinkAssets,
} from "./face-body-linker-repository.mjs";
import {
  applyPrimeCurations,
  buildPrimeCurations,
  loadPrimeCuratorFaces,
} from "./prime-curator-repository.mjs";

// Identity transactions are authoritative. Derived maintenance must remain
// bounded and retryable without making a committed owner correction fail.
export const refreshPrimeAfterCommand = async (
  sql,
  personId,
  { throwOnFailure = false } = {},
) => {
  if (!personId) return false;
  try {
    const faces = await loadPrimeCuratorFaces(sql, personId);
    const curations = buildPrimeCurations(faces, {
      evidenceCutoff: new Date().toISOString(),
    });
    if (curations.length > 0) {
      await applyPrimeCurations(sql, curations, { execute: true });
    } else {
      await sql`UPDATE reference_prototype SET state = 'retired' WHERE person_id = ${personId} AND state = 'active'`;
    }
    return false;
  } catch (error) {
    if (throwOnFailure) throw error;
    console.error(
      "Cimmich Prime maintenance deferred after committed identity command",
      {
        error: error instanceof Error ? error.message : String(error),
        personId,
      },
    );
    return true;
  }
};

const maintenanceEvent = (event) => {
  if (event.kind === "retrying") {
    console.warn(
      JSON.stringify({ code: "CIMMICH_MAINTENANCE_RETRYING", ...event }),
    );
    return;
  }
  if (event.kind === "failed") {
    console.error(
      JSON.stringify({ code: "CIMMICH_MAINTENANCE_FAILED", ...event }),
    );
    return;
  }
  if (event.kind === "completed" && event.durationMs >= 500) {
    console.info(
      JSON.stringify({ code: "CIMMICH_MAINTENANCE_SLOW", ...event }),
    );
  }
};

const primeMaintenanceLanes = new WeakMap();
const primeMaintenanceLane = (sql) => {
  let lane = primeMaintenanceLanes.get(sql);
  if (!lane) {
    lane = createCoalescingMaintenanceLane({
      concurrency: 1,
      maxAttempts: 3,
      name: "prime_projection",
      onEvent: maintenanceEvent,
      retryDelayMs: 250,
      worker: (personId) =>
        refreshPrimeAfterCommand(sql, personId, { throwOnFailure: true }),
    });
    primeMaintenanceLanes.set(sql, lane);
  }
  return lane;
};

export const deferPrimeAfterCommand = (sql, personId) => {
  if (!personId) return false;
  return primeMaintenanceLane(sql).schedule(personId, { priority: 20 });
};

export const refreshPrimeForPeople = async (sql, personIds) => {
  let maintenancePending = false;
  for (const personId of [...new Set(personIds.filter(Boolean))]) {
    maintenancePending =
      (await refreshPrimeAfterCommand(sql, personId)) || maintenancePending;
  }
  return maintenancePending;
};

export const deferPrimeForPeople = (sql, personIds) =>
  [...new Set(personIds.filter(Boolean))]
    .map((personId) => deferPrimeAfterCommand(sql, personId))
    .some(Boolean);

export const refreshBodyLinksAfterCommand = async (
  sql,
  assetId,
  { throwOnFailure = false } = {},
) => {
  if (!assetId) return { maintenancePending: false };
  try {
    const assets = await loadFaceBodyLinkAssets(sql, assetId);
    const proposal = buildFaceBodyLinks(assets);
    const summary = await applyFaceBodyLinks(sql, proposal, { execute: true });
    return { ...summary, maintenancePending: false };
  } catch (error) {
    if (throwOnFailure) throw error;
    console.error(
      "Cimmich Body linkage maintenance deferred after committed identity command",
      {
        assetId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return { maintenancePending: true };
  }
};

const bodyLinkMaintenanceLanes = new WeakMap();
const bodyLinkMaintenanceLane = (sql) => {
  let lane = bodyLinkMaintenanceLanes.get(sql);
  if (!lane) {
    lane = createCoalescingMaintenanceLane({
      concurrency: 1,
      maxAttempts: 3,
      name: "body_link_projection",
      onEvent: maintenanceEvent,
      retryDelayMs: 250,
      worker: (assetId) =>
        refreshBodyLinksAfterCommand(sql, assetId, { throwOnFailure: true }),
    });
    bodyLinkMaintenanceLanes.set(sql, lane);
  }
  return lane;
};

export const deferBodyLinksAfterCommand = (sql, assetId) => {
  if (!assetId) return false;
  return bodyLinkMaintenanceLane(sql).schedule(assetId, { priority: 10 });
};

export const waitForMaintenanceIdle = (sql) =>
  Promise.all([
    primeMaintenanceLane(sql).whenIdle(),
    bodyLinkMaintenanceLane(sql).whenIdle(),
  ]);
