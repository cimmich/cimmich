import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeSourcePackArchiveMatcherOptions,
  sourcePackArchiveMatcherContract,
  sourcePackArchiveMatcherRunawayPolicy,
} from "../src/source-pack-archive-matcher.mjs";

test("archive matcher options are bounded and dry-run by default", () => {
  assert.deepEqual(normalizeSourcePackArchiveMatcherOptions(), {
    execute: false,
    laneCount: 1,
    laneIndex: 0,
    limitFaces: 0,
    packId: "",
  });
  assert.deepEqual(
    normalizeSourcePackArchiveMatcherOptions({
      execute: true,
      laneCount: "4",
      laneIndex: "2",
      limitFaces: "1000",
      packId: "sourcepack_one",
    }),
    {
      execute: true,
      laneCount: 4,
      laneIndex: 2,
      limitFaces: 1000,
      packId: "sourcepack_one",
    },
  );
  assert.throws(() =>
    normalizeSourcePackArchiveMatcherOptions({ laneCount: 2, laneIndex: 2 }),
  );
  assert.throws(() =>
    normalizeSourcePackArchiveMatcherOptions({ packId: "bad\npack" }),
  );
});

test("archive matcher fails closed on catastrophic per-Person suggestion fanout", () => {
  assert.deepEqual(sourcePackArchiveMatcherRunawayPolicy, {
    absoluteSuggestionFloor: 500,
    maximumAcceptedFaceMultiplier: 10,
    policyVersion: "cimmich-source-pack-runaway-fanout-v1",
  });
});

test("archive matcher restores per-Face SourcePack scoring without identity authority", async () => {
  const source = await readFile(
    new URL("../src/source-pack-archive-matcher.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(
    sourcePackArchiveMatcherContract.schemaVersion,
    "cimmich.source-pack-archive-matcher.v2",
  );
  assert.match(source, /current_matchable_physical_face/);
  assert.match(source, /current_physical_face_identity/);
  assert.match(source, /source_pack_reference/);
  assert.match(source, /reference\.bucket_kind = 'prime'/);
  assert.match(source, /reference\.reference_kind = 'face'/);
  assert.match(source, /score >= \$\{Number\(pack\.score_floor\)\}/);
  assert.match(source, /score - coalesce\(next_score, -1\) >=/);
  assert.match(source, /fallback_score_floor/);
  assert.match(source, /fallback_margin_floor/);
  assert.match(source, /'automatic_acceptance', false/);
  assert.match(source, /'automatic_identity_acceptance', false/);
  assert.match(source, /pack\.state !== "active"/);
  assert.doesNotMatch(source, /SET state = 'accepted'/);
  assert.doesNotMatch(source, /UPDATE identity_claim[\s\S]*state = 'accepted'/);
});

test("archive matcher types SourcePack provenance explicitly", async () => {
  const source = await readFile(
    new URL("../src/source-pack-archive-matcher.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /\$\{pack\.pack_id\}::text/);
  assert.match(source, /\$\{pack\.policy_version\}::text/);
  assert.match(source, /'policy_version', \$\{pack\.policy_version\}::text/);
  assert.match(source, /'source_pack_id', \$\{pack\.pack_id\}::text/);
});

test("Mac-local archive scoring is bounded, physical-Face aware and review-only", async () => {
  const [local, scorer, provider] = await Promise.all([
    readFile(
      new URL("../src/source-pack-local-archive-matcher.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/source-pack-numpy-scorer.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../providers/source-pack-numpy/score.py", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(local, /compute: "local_numpy"/);
  assert.match(local, /query\.cursor\(batchSize\)/);
  assert.match(local, /current_matchable_physical_face/);
  assert.match(local, /current_face_physical_member/);
  assert.match(local, /refuses runaway suggestion fanout/);
  assert.match(
    local,
    /least\(1::float8, greatest\(0::float8, result\.score\)\)/,
  );
  assert.match(local, /'automatic_acceptance', false/);
  assert.match(local, /'automatic_identity_acceptance', false/);
  assert.match(scorer, /providerSubprocessEnvironment/);
  assert.match(scorer, /shell: false/);
  assert.match(provider, /query_matrix @ self\.gallery\.T/);
  assert.match(provider, /np\.clip\(/);
  assert.match(provider, /np\.maximum\.at/);
  assert.doesNotMatch(local, /SET state = 'accepted'/);
});
