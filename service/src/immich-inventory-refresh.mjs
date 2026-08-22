import { randomUUID } from "node:crypto";

export const createImmichInventoryRefresh = ({
  freshnessMs = 5 * 60_000,
  inventory,
}) => {
  let operation = null;
  let scan = {
    completedAt: null,
    error: null,
    scanId: null,
    startedAt: null,
    state: "idle",
  };
  const status = () => ({ ...scan });

  return {
    start() {
      if (!inventory?.synchronize) {
        throw Object.assign(
          new Error("Immich catalogue check is unavailable"),
          {
            code: "IMMICH_INVENTORY_REFRESH_UNAVAILABLE",
            statusCode: 503,
          },
        );
      }
      if (operation) return { scan: status(), replayed: true };
      if (
        scan.state === "complete" &&
        scan.completedAt &&
        Date.now() - Date.parse(scan.completedAt) < freshnessMs
      ) {
        return { scan: status(), replayed: true };
      }

      scan = {
        completedAt: null,
        error: null,
        scanId: `missing-file-scan-${randomUUID()}`,
        startedAt: new Date().toISOString(),
        state: "running",
      };
      const current = Promise.resolve()
        .then(() =>
          inventory.synchronize({
            cataloguePresenceOnly: true,
            visibilities: ["timeline", "archive", "hidden"],
          }),
        )
        .then((result) => {
          scan = {
            ...scan,
            completedAt: new Date().toISOString(),
            error: null,
            result: {
              activeAssets: Number(result?.source?.activeAssets || 0),
              missingAssets: Number(result?.source?.missingAssets || 0),
              runId: result?.run?.runId || null,
              suspectedMissingAssets: Number(
                result?.source?.suspectedMissingAssets || 0,
              ),
            },
            state: "complete",
          };
        })
        .catch((error) => {
          scan = {
            ...scan,
            completedAt: new Date().toISOString(),
            error: {
              code: String(error?.code || "IMMICH_INVENTORY_REFRESH_FAILED"),
              message: String(
                error?.message || "Immich catalogue check failed",
              ),
            },
            state: "failed",
          };
        })
        .finally(() => {
          if (operation === current) operation = null;
        });
      operation = current;
      return { scan: status(), replayed: false };
    },
    status,
  };
};
