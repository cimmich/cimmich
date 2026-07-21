#!/usr/bin/env node
import { compileShadowSourcePack } from "../src/source-pack-shadow.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const faces = (payload.faces || []).map((face) => {
  if (!face.vectorBase64) return face;
  const bytes = Buffer.from(face.vectorBase64, "base64");
  if (bytes.length % 4 !== 0) {
    throw new Error(`Invalid float32 vector payload for ${face.faceId}`);
  }
  const vector = new Float32Array(bytes.length / 4);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = bytes.readFloatLE(index * 4);
  }
  const { vectorBase64, ...rest } = face;
  return { ...rest, vector };
});
const { receipt } = compileShadowSourcePack(faces, payload.options || {}, {
  expectedAnchoredPersonIds: payload.expectedAnchoredPersonIds || [],
  expectedPrimeFaceIds: payload.expectedPrimeFaceIds || [],
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
