const chunks = [];
const limitIndex = process.argv.indexOf("--max-input-bytes");
if (limitIndex < 0 || Number(process.argv[limitIndex + 1]) < 1024 * 1024) {
  process.exit(2);
}
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = Buffer.concat(chunks).toString("utf8");
const faces = input.includes("face")
  ? [{ box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, confidence: 0.95 }]
  : [];
process.stdout.write(
  `${JSON.stringify({ faces, state: faces.length ? "faces_detected" : "no_face" })}\n`,
);
