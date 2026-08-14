import unittest

import numpy as np

from score import Scorer


def vector(*components):
    value = np.zeros(512, dtype=np.float32)
    for index, component in components:
        value[index] = component
    value /= np.linalg.norm(value)
    return value.tolist()


def face(person_id, face_id, embedding):
    return {
        "assetId": f"asset-{face_id}",
        "contextIds": [],
        "embedding": embedding,
        "faceId": face_id,
        "personId": person_id,
    }


class IdentityAuditOwnClusterTest(unittest.TestCase):
    def setUp(self):
        self.prime_a = vector((0, 1))
        self.low_quality_a = vector((0, 0.3), (1, 0.954))
        support = [
            self.prime_a,
            vector((0, 0.999), (4, 0.04)),
            vector((0, 0.998), (5, 0.06)),
            vector((0, 0.997), (6, 0.08)),
            self.low_quality_a,
        ]
        self.scorer = Scorer(
            {
                "gallery": [
                    face("person-a", "prime-a", self.prime_a),
                    face("person-b", "prime-b", vector((3, 1))),
                ],
                "supportGallery": [
                    face("person-a", f"support-{index}", embedding)
                    for index, embedding in enumerate(support)
                ],
            }
        )

    def audit(self, face_id, embedding):
        return self.scorer.audit(
            {
                "auditKind": "accepted_contradiction",
                "queries": [
                    {
                        "assetId": f"query-asset-{face_id}",
                        "assignedPersonId": "person-a",
                        "contextIds": [],
                        "embedding": embedding,
                        "excludedPersonIds": [],
                        "faceId": face_id,
                    }
                ],
            }
        )["results"]

    def test_flags_face_that_matches_neither_primes_nor_low_quality_support(self):
        results = self.audit("obvious-outlier", vector((2, 1)))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["evidenceRoute"], "own_cluster_outlier")
        self.assertEqual(results[0]["personId"], "person-a")

    def test_keeps_difficult_face_that_matches_low_quality_support(self):
        self.assertEqual(self.audit("difficult-but-supported", self.low_quality_a), [])


if __name__ == "__main__":
    unittest.main()
