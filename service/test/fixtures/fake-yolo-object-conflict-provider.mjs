import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const packet = Buffer.concat(chunks);
const size = packet.readUInt32BE(0);
const header = JSON.parse(packet.subarray(4, 4 + size).toString("utf8"));
const bytes = packet.subarray(4 + size);
const manifest = JSON.parse(
  readFileSync(process.argv[process.argv.indexOf("--manifest") + 1], "utf8"),
);
if (
  createHash("sha256").update(bytes).digest("hex") !==
  header.sourceContentDigest
)
  process.exit(2);
process.stdout.write(
  JSON.stringify({
    assetToken: header.assetToken,
    inputRevision: header.inputRevision,
    objectConfigDigest: manifest.objectConfigDigest,
    objects: [
      {
        box: { h: 0.7, w: 0.4, x: 0.1, y: 0.2 },
        category: "cat",
        confidence: 0.91,
      },
    ],
    schemaVersion: "cimmich.body-object-conflict-result.v1",
    sourceContentDigest: header.sourceContentDigest,
    state: "objects_detected",
  }),
);
