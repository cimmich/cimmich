import { readFile } from "node:fs/promises";

const argument = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
};

const manifest = JSON.parse(await readFile(argument("manifest"), "utf8"));

const readExact = async (length) => {
  const chunks = [];
  let size = 0;
  while (size < length) {
    const chunk = process.stdin.read(length - size);
    if (chunk) {
      chunks.push(Buffer.from(chunk));
      size += chunk.length;
      continue;
    }
    if (process.stdin.readableEnded) {
      throw new Error("fixture input ended early");
    }
    await new Promise((resolve) => process.stdin.once("readable", resolve));
  }
  return Buffer.concat(chunks, size);
};

while (true) {
  let header;
  try {
    header = await readExact(16);
  } catch {
    break;
  }
  const metadataLength = Number(header.readBigUInt64BE(0));
  const inputLength = Number(header.readBigUInt64BE(8));
  const metadata = JSON.parse(
    (await readExact(metadataLength)).toString("utf8"),
  );
  await readExact(inputLength);
  if (metadata.operation === "detect") {
    const payload = Buffer.from(
      JSON.stringify({
        faces: [
          {
            box: { h: 0.4, w: 0.3, x: 0.1, y: 0.2 },
            confidence: 0.95,
            landmarkDigest: "d".repeat(64),
            quality: { detector: "synthetic-resident" },
          },
        ],
        processId: process.pid,
        state: "faces_detected",
      }),
    );
    const outputHeader = Buffer.alloc(8);
    outputHeader.writeBigUInt64BE(BigInt(payload.length));
    process.stdout.write(Buffer.concat([outputHeader, payload]));
    continue;
  }
  const vector = Array.from(
    { length: manifest.embedding.dimension },
    (_, index) => (index === 0 ? 1 : 0),
  );
  const packets = metadata.requests.map((request) => ({
    assetToken: request.assetToken,
    cropDigest: "c".repeat(64),
    observationId: request.observationId,
    processId: process.pid,
    providerConfigDigest: manifest.providerConfigDigest,
    route: "synthetic-resident-process",
    state: "embedded",
    vector,
    vectorSpaceId: manifest.vectorSpaceId,
  }));
  const payload = Buffer.from(JSON.stringify({ packets }));
  const outputHeader = Buffer.alloc(8);
  outputHeader.writeBigUInt64BE(BigInt(payload.length));
  process.stdout.write(Buffer.concat([outputHeader, payload]));
}
