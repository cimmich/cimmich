import { fileURLToPath } from "node:url";
import { loadMigrations } from "../src/migration-runner.mjs";

export const currentSchemaVersion = async () => {
  const migrations = await loadMigrations(
    fileURLToPath(new URL("../../migrations", import.meta.url)),
  );
  return migrations.at(-1)?.version || 0;
};
