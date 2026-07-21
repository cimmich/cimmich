#!/usr/bin/env node
import {
  bodyDetectionDigest,
  projectValidatedBodyResultToLinker,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import {
  faceBodyLinkPolicyVersion,
  linkAssetFacesToBodies,
} from "../src/face-body-linker.mjs";

const maximumInputBytes = 1024 * 1024;
const tokenPattern = /^[a-z0-9][a-z0-9_]{2,95}$/;

const fail = (code) => {
  process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
  process.exitCode = 1;
};

const exactObject = (value, keys) =>
  value != null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const normalizeFace = (value) => {
  if (!exactObject(value, ["boxH", "boxW", "boxX", "boxY", "faceId"])) {
    throw new Error("face input is invalid");
  }
  const geometry = [value.boxH, value.boxW, value.boxX, value.boxY];
  if (
    typeof value.faceId !== "string" ||
    !tokenPattern.test(value.faceId) ||
    geometry.some((item) => !Number.isFinite(item) || item < 0 || item > 1) ||
    value.boxH <= 0 ||
    value.boxW <= 0 ||
    value.boxX + value.boxW > 1.000001 ||
    value.boxY + value.boxH > 1.000001
  ) {
    throw new Error("face input is invalid");
  }
  return value;
};

const main = async () => {
  let raw = "";
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maximumInputBytes) {
      fail("LOCAL_BODY_LINK_INPUT_TOO_LARGE");
      return;
    }
    raw += chunk;
  }
  try {
    const input = JSON.parse(raw);
    if (!exactObject(input, ["faces", "manifest", "result"])) {
      throw new Error("input is invalid");
    }
    if (!Array.isArray(input.faces) || input.faces.length > 1000) {
      throw new Error("faces are invalid");
    }
    const faces = input.faces
      .map(normalizeFace)
      .sort((left, right) => left.faceId.localeCompare(right.faceId));
    if (new Set(faces.map(({ faceId }) => faceId)).size !== faces.length) {
      throw new Error("faces are duplicated");
    }
    const validation = validateBodyDetectionResult(
      input.result,
      input.manifest,
    );
    const projected = projectValidatedBodyResultToLinker(validation);
    const linkage = linkAssetFacesToBodies({
      assetId: projected.assetId,
      bodies: projected.bodies,
      faces,
    });
    const core = {
      authority: {
        automaticIdentityAuthority: "none",
        persistence: "none",
        recommendation: "none",
        training: "none",
      },
      boundary: {
        databaseWrites: "none",
        identityWrites: "none",
        sourceMediaWrites: "none",
      },
      counts: {
        acceptedLinks: linkage.accepted.length,
        abstainedLinks: linkage.abstained.length,
        bodies: projected.bodies.length,
        candidateEdges: linkage.candidateEdgeCount,
        faces: faces.length,
        unmatchedBodies: linkage.unmatchedBodies,
        unmatchedFaces: linkage.unmatchedFaces,
      },
      detectorResultDigest: validation.resultDigest,
      linkerPolicyVersion: faceBodyLinkPolicyVersion,
      schemaVersion: "cimmich.local-body-link-slice.v1",
    };
    process.stdout.write(
      `${JSON.stringify({ ...core, receiptDigest: bodyDetectionDigest(core) })}\n`,
    );
  } catch {
    fail("LOCAL_BODY_LINK_INPUT_INVALID");
  }
};

await main();
