import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).with_name("score.py")
SPEC = importlib.util.spec_from_file_location("pet_match_scorer", MODULE_PATH)
SCORER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCORER)


class PetMatchScorerTest(unittest.TestCase):
    def test_scores_only_same_species_and_keeps_unknown(self):
        embeddings = {
            "records": [
                {"id": "cafe-1", "identity": "person_cafe_0001", "role": "gallery", "species": "dog", "embedding": [1, 0]},
                {"id": "petquery_dog_0001", "identity": "unknown", "role": "query", "species": "dog", "embedding": [0.9, 0.1]},
                {"id": "petquery_dog_unknown", "identity": "unknown", "role": "query", "species": "dog", "embedding": [0, 1]},
            ]
        }
        plan = {
            "candidateFloor": 0.5,
            "lane": "face",
            "maxCandidates": 3,
            "provider": {
                "modelFamily": "petface-arcface",
                "modelVersion": "test-v1",
                "providerId": "local.petface",
                "vectorSpaceId": "petface-dog-512",
            },
            "queries": [
                {"assetId": "asset_dog_0001", "box": {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5}, "detectionConfidence": 0.9, "id": "petquery_dog_0001"},
                {"assetId": "asset_dog_0002", "box": {"x": 0.2, "y": 0.2, "w": 0.5, "h": 0.5}, "detectionConfidence": 0.8, "id": "petquery_dog_unknown"},
            ],
            "runId": "petmatchrun_test_0001",
            "schemaVersion": "cimmich.pet-match-query.v1",
            "speciesKind": "dog",
        }
        packet = SCORER.build_packet(embeddings, plan)
        self.assertEqual(
            packet["observations"][0]["candidates"][0]["petId"],
            "person_cafe_0001",
        )
        self.assertEqual(packet["observations"][1]["candidates"], [])
        self.assertEqual(packet["provider"]["lane"], "face")

    def test_uses_closest_confirmed_photo_but_reports_gallery_size(self):
        embeddings = {
            "records": [
                {"id": "cafe-1", "identity": "person_cafe_0001", "role": "gallery", "species": "dog", "embedding": [1, 0]},
                {"id": "cafe-2", "identity": "person_cafe_0001", "role": "gallery", "species": "dog", "embedding": [0, 1]},
                {"id": "petquery_dog_0001", "identity": "unknown", "role": "query", "species": "dog", "embedding": [0, 1]},
            ]
        }
        plan = {
            "candidateFloor": 0.2,
            "lane": "face",
            "maxCandidates": 5,
            "provider": {
                "modelFamily": "petface-arcface",
                "modelVersion": "test-v1",
                "providerId": "local.petface",
                "vectorSpaceId": "petface-dog-512",
            },
            "queries": [
                {"assetId": "asset_dog_0001", "box": {"x": 0, "y": 0, "w": 1, "h": 1}, "detectionConfidence": 1, "id": "petquery_dog_0001"},
            ],
            "runId": "petmatchrun_test_0002",
            "schemaVersion": "cimmich.pet-match-query.v1",
            "speciesKind": "dog",
        }
        candidate = SCORER.build_packet(embeddings, plan)["observations"][0]["candidates"][0]
        self.assertEqual(candidate["galleryCount"], 2)
        self.assertEqual(candidate["score"], 1)


if __name__ == "__main__":
    unittest.main()
