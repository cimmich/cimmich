#!/usr/bin/env node

import { runGuidedLocalClientConformance } from "../src/guided-local-client.mjs";

try {
  const receipt = await runGuidedLocalClientConformance({
    accessToken: process.env.CIMMICH_GUIDED_ACCESS_TOKEN,
    baseUrl: process.env.CIMMICH_GUIDED_BASE_URL || "http://127.0.0.1:3101",
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ code: error?.code || "GUIDED_LOCAL_CLIENT_FAILED", status: "failed" })}\n`,
  );
  process.exitCode = 1;
}
