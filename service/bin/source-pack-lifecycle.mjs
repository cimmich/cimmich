#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  activateSourcePack,
  persistSourcePackGateReceipt,
  retireRejectedConditionPolicy,
  rollbackSourcePack,
} from "../src/source-pack-lifecycle.mjs";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const value = (name, fallback = "") =>
  args
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) || fallback;
const action = value("action");
const packId = value("pack-id");
if (!action) throw new Error("source-pack-lifecycle requires --action");
const sql = postgres(
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich",
  {
    max: 1,
    prepare: true,
  },
);
try {
  let result;
  if (action === "record-evaluation") {
    const receiptPath = value("receipt");
    if (!receiptPath) throw new Error("record-evaluation requires --receipt");
    result = await persistSourcePackGateReceipt(
      sql,
      JSON.parse(await readFile(receiptPath, "utf8")),
      { execute },
    );
  } else if (action === "retire-rejected-condition") {
    const receiptPath = value("receipt");
    if (!receiptPath) {
      throw new Error("retire-rejected-condition requires --receipt");
    }
    result = await retireRejectedConditionPolicy(
      sql,
      JSON.parse(await readFile(receiptPath, "utf8")),
      { execute },
    );
  } else if (action === "activate") {
    if (!packId) throw new Error("activate requires --pack-id");
    result = await activateSourcePack(sql, packId, { execute });
  } else if (action === "rollback") {
    if (!packId) throw new Error("rollback requires --pack-id");
    result = await rollbackSourcePack(sql, packId, { execute });
  } else {
    throw new Error(`Unknown SourcePack lifecycle action: ${action}`);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
