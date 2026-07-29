let requestCount = 0;

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
    if (process.stdin.readableEnded) throw new Error("FRAME_TRUNCATED");
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
  const input = await readExact(inputLength);
  requestCount += 1;
  const response =
    input.toString("utf8") === "unreadable-image"
      ? { error: { code: "ULTRALYTICS_BODY_SOURCE_UNREADABLE" } }
      : {
          assetToken: metadata.assetToken,
          bodies: [],
          detectorConfigDigest: "1".repeat(64),
          inputRevision: metadata.inputRevision,
          processRequestCount: requestCount,
          schemaVersion: "cimmich.body-detection-result.v1",
          sourceContentDigest: metadata.sourceContentDigest,
          state: "no_body",
        };
  const payload = Buffer.from(
    JSON.stringify(response),
  );
  const responseHeader = Buffer.alloc(8);
  responseHeader.writeBigUInt64BE(BigInt(payload.length));
  process.stdout.write(Buffer.concat([responseHeader, payload]));
}
