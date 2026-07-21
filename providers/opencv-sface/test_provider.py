import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np


MODULE_PATH = Path(__file__).with_name("provider.py")
SPEC = importlib.util.spec_from_file_location("cimmich_opencv_sface", MODULE_PATH)
provider = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provider)


class ProviderContractTest(unittest.TestCase):
    def test_general_detection_normalizes_all_faces_without_identity(self):
        class FakeDetector:
            def setInputSize(self, size):
                self.size = size

            def detect(self, _image):
                return None, np.asarray(
                    [
                        [20, 10, 30, 40, 21, 11, 40, 11, 30, 20, 24, 40, 38, 40, 0.96],
                        [60, 20, 20, 20, 61, 21, 75, 21, 68, 28, 63, 38, 76, 38, 0.91],
                    ],
                    dtype=np.float32,
                )

        instance = provider.OpenCvSFaceProvider.__new__(provider.OpenCvSFaceProvider)
        instance.detector = FakeDetector()
        observations = instance.detect_all(np.zeros((100, 100, 3), dtype=np.uint8))
        self.assertEqual(instance.detector.size, (100, 100))
        self.assertEqual(len(observations), 2)
        self.assertEqual(observations[0]["quality"], {"detector": "YuNet"})
        self.assertNotIn("personId", observations[0])
        self.assertTrue(all(0 <= value <= 1 for value in observations[0]["box"].values()))

    def test_target_selection_prefers_geometry_over_detector_confidence(self):
        faces = np.asarray(
            [
                [80, 80, 40, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.82],
                [5, 5, 40, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.99],
            ],
            dtype=np.float32,
        )
        selected = provider.select_target_face(faces, (100, 100), (200, 200, 3))
        self.assertAlmostEqual(float(selected[0]), 80.0)

    def test_ambiguous_target_abstains(self):
        faces = np.asarray(
            [
                [70, 80, 40, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.90],
                [90, 80, 40, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.90],
            ],
            dtype=np.float32,
        )
        self.assertIsNone(
            provider.select_target_face(faces, (100, 100), (200, 200, 3))
        )

    def test_media_root_confinement_rejects_escape(self):
        with self.assertRaises(ValueError):
            provider.confined_path(Path(__file__).parent, "/private/tmp")

    def test_operating_system_error_cannot_leak_a_private_path(self):
        secret_path = "/private/library/people/example-person.jpg"
        reason = provider.public_failure_reason(FileNotFoundError(secret_path))
        self.assertEqual(reason, "source-read-failed")
        self.assertNotIn(secret_path, reason)

    def test_detector_threshold_is_bound_into_the_provider_configuration(self):
        manifest = json.loads(Path(__file__).with_name("provider-manifest.json").read_text())
        _, original_digest = provider.validate_manifest(manifest)
        manifest["detector"]["scoreThreshold"] = 0.8
        manifest["providerConfigDigest"] = provider.digest(
            {
                **provider.normalized_manifest_core(manifest),
                "execution": manifest["execution"],
                "licensing": manifest["licensing"],
                "privacy": manifest["privacy"],
            }
        )
        _, changed_digest = provider.validate_manifest(manifest)
        self.assertNotEqual(original_digest, changed_digest)


if __name__ == "__main__":
    unittest.main()
