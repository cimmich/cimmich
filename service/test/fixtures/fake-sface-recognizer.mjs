import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const manifestPath = args[args.indexOf("--manifest") + 1];
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const framed = Buffer.concat(chunks);
const length = Number(framed.readBigUInt64BE(0));
const metadata = JSON.parse(framed.subarray(8, 8 + length).toString("utf8"));
const vector = Array.from(
  { length: manifest.embedding.dimension },
  (_, index) => (index === 0 ? 1 : 0),
);
const packets = metadata.requests.map((request) => ({
  assetToken: request.assetToken,
  cropDigest: "c".repeat(64),
  observationId: request.observationId,
  providerConfigDigest: manifest.providerConfigDigest,
  route: "synthetic-process",
  state: "embedded",
  vector,
  vectorSpaceId: manifest.vectorSpaceId,
}));
process.stdout.write(`${JSON.stringify({ packets })}\n`);
