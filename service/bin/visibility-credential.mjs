#!/usr/bin/env node

import process from "node:process";
import postgres from "postgres";
import {
  configurePrivateCredential,
  privateCredentialStatus,
  removePrivateCredential,
} from "../src/visibility.mjs";

const usage = `Usage:
  npm run visibility-credential -- status [--principal ID]
  secret-command | npm run visibility-credential -- configure --password-stdin [--principal ID] [--actor ID]
  secret-command | npm run visibility-credential -- rotate --password-stdin [--principal ID] [--actor ID]
  npm run visibility-credential -- remove --confirm-remove [--principal ID] [--actor ID]

The password may be any non-empty string selected by the operator. It is
accepted only from standard input, never from an argument or environment
variable, and is never printed. Passwordless viewing is configured separately
with CIMMICH_VISIBILITY_PRIVATE_LOCK_MODE=none.`;

const args = process.argv.slice(2);
const action = args.shift() || "";
const option = (name, fallback = "") => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
};
const has = (name) => args.includes(name);
const readPassword = async () => {
  if (!has("--password-stdin")) {
    throw new Error("configure and rotate require --password-stdin");
  }
  if (process.stdin.isTTY) {
    throw new Error(
      "pipe the password through standard input; interactive echo is refused",
    );
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 2048) throw new Error("password input is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
};

if (!["configure", "rotate", "remove", "status"].includes(action)) {
  console.error(usage);
  process.exitCode = 2;
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exitCode = 2;
  } else {
    const principalId = option("--principal", "local-primary");
    const actorId = option("--actor", "local-operator");
    const sql = postgres(databaseUrl, { max: 1, prepare: true });
    try {
      let result;
      if (action === "status") {
        result = await privateCredentialStatus({ principalId, sql });
      } else if (action === "remove") {
        if (!has("--confirm-remove")) {
          throw new Error("remove requires --confirm-remove");
        }
        result = await removePrivateCredential({ actorId, principalId, sql });
      } else {
        const password = await readPassword();
        result = await configurePrivateCredential({
          actorId,
          password,
          principalId,
          source: `operator_cli_${action}`,
          sql,
        });
      }
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(
        JSON.stringify({
          code: error?.code || "VISIBILITY_CREDENTIAL_OPERATION_FAILED",
          error: error?.message || "Private credential operation failed",
        }),
      );
      process.exitCode = 1;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}
