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
const joints = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];
process.stdout.write(
  JSON.stringify({
    assetToken: header.assetToken,
    detections: [
      {
        box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
        confidence: 0.9,
        keypoints: joints.map((joint, index) => ({
          confidence: 0.8,
          joint,
          x: Number((0.2 + index * 0.01).toFixed(6)),
          y: Number((0.2 + index * 0.01).toFixed(6)),
        })),
      },
    ],
    inputRevision: header.inputRevision,
    poseConfigDigest: manifest.poseConfigDigest,
    schemaVersion: "cimmich.body-pose-result.v1",
    sourceContentDigest: header.sourceContentDigest,
    state: "poses_detected",
  }),
);
