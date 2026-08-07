import assert from "node:assert/strict";
import test from "node:test";
import { createCimmichRepository } from "../src/repository.mjs";

test("asset evidence returns persisted candidates without whole-gallery matching", async () => {
  const statements = [];
  const sql = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("FROM asset") && statement.includes("media_kind")) {
      return [
        {
          asset_id: "asset-1",
          capture_time: null,
          height: 800,
          media_kind: "image",
          mime_type: "image/jpeg",
          width: 1200,
        },
      ];
    }
    if (statement.includes("SELECT asset_id FROM asset")) {
      return [{ asset_id: "asset-1" }];
    }
    if (statement.includes("FROM face_observation fo")) {
      return [
        {
          buckets: [],
          candidate_confidence: 0.84,
          candidate_display_name: "Suggested Person",
          candidate_identity_claim_id: "claim-1",
          candidate_person_id: "person-1",
          current_decision_id: "decision-1",
          current_revision: 1,
          detection_confidence: 0.9,
          face_id: "face-1",
          has_active_embedding: true,
          match_eligible: true,
          person_id: null,
          quality_measurements: {},
        },
      ];
    }
    return [];
  };
  const repository = createCimmichRepository(
    sql,
    new Map([
      ["asset-1", { filename: "photo.jpg", sourceAssetId: "source-1" }],
    ]),
  );

  const result = await repository.assetEvidence({ sourceAssetId: "source-1" });

  assert.deepEqual(result.faces[0].candidate_matches, [
    {
      displayEligible: true,
      governedCandidate: true,
      personId: "person-1",
      personName: "Suggested Person",
      rank: 1,
      rawScore: 0.84,
      scoreKind: "cosine_similarity",
      scoreMeaning:
        "Higher means closer in the same recognition space; this is not a probability.",
    },
  ]);
  assert.equal(
    statements.some((statement) =>
      statement.includes("FROM matching_gallery gallery"),
    ),
    false,
  );
});
