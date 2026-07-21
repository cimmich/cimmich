#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrate } from "../src/migration-runner.mjs";

const args = process.argv.slice(2);
const action = args.shift() || "apply";
const option = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] || "";
};
if (action !== "apply") {
  console.error("Usage: npm run migrate -- apply [--adopt-existing 48]");
  process.exitCode = 2;
} else if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exitCode = 2;
} else {
  const serviceDirectory = path.dirname(
    path.dirname(fileURLToPath(import.meta.url)),
  );
  const migrationsDirectory = path.resolve(
    process.env.CIMMICH_MIGRATIONS_DIRECTORY ||
      path.join(serviceDirectory, "../migrations"),
  );
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: true });
  try {
    const result = await migrate({
      adoptExisting: option("--adopt-existing", "0"),
      migrationsDirectory,
      sql,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        code: error?.code || "MIGRATION_FAILED",
        details: error?.details,
        error: error?.message || "Migration failed",
      }),
    );
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
