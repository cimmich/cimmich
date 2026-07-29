import importlib.util
from pathlib import Path
import unittest

import numpy as np


MODULE_PATH = Path(__file__).with_name("provider.py")
SPEC = importlib.util.spec_from_file_location("cimmich_insightface_user_supplied", MODULE_PATH)
provider = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provider)


def synthetic_manifest():
    manifest = {
        "schemaVersion": provider.PROVIDER_SCHEMA,
        "detector": {
            "artifactSha256": "1" * 64,
            "inputSize": [640, 640],
            "model": "synthetic-detector",
            "modelVersion": "synthetic-v1",
            "scoreThreshold": 0.5,
        },
        "recognizer": {
            "artifactSha256": "2" * 64,
            "model": "synthetic-recognizer",
            "modelVersion": "synthetic-v1",
        },
        "embedding": {"dimension": 512, "metric": "cosine", "normalized": True},
        "preprocessing": {
            "alignment": "insightface-five-point-norm-crop",
            "colorSpace": "bgr-source-rgb-recognizer",
            "inputSize": [112, 112],
            "pipelineVersion": "synthetic-pipeline-v1",
        },
        "provider": {"name": "insightface-user-supplied-cpu", "version": "1"},
        "execution": {
            "device": "cpu",
            "network": "forbidden",
            "runtime": "synthetic",
            "threads": 1,
        },
        "licensing": {
            "code": "MIT",
            "model": "user-supplied; redistribution prohibited",
            "trainingData": "operator-declared",
        },
        "privacy": {"externalUpload": "none", "sourceMedia": "local-read-only"},
    }
    manifest["vectorSpaceId"], manifest["providerConfigDigest"] = provider.derive_manifest_ids(manifest)
    return manifest


class ProviderContractTest(unittest.TestCase):
    def test_execution_provider_is_explicit_and_fails_closed(self):
        self.assertEqual(
            provider.execution_providers("cpu"), ["CPUExecutionProvider"]
        )
        with self.assertRaises(ValueError):
            provider.execution_providers("cuda")

    def test_target_selection_prefers_geometry_over_confidence(self):
        boxes = np.asarray(
            [[80, 80, 120, 120, 0.82], [5, 5, 45, 45, 0.99]],
            dtype=np.float32,
        )
        self.assertEqual(provider.select_target_face(boxes, (100, 100), (200, 200, 3)), 0)

    def test_ambiguous_target_abstains(self):
        boxes = np.asarray(
            [[70, 80, 110, 120, 0.90], [90, 80, 130, 120, 0.90]],
            dtype=np.float32,
        )
        self.assertIsNone(provider.select_target_face(boxes, (100, 100), (200, 200, 3)))

    def test_media_root_confinement_rejects_escape(self):
        with self.assertRaises(ValueError):
            provider.confined_path(Path(__file__).parent, "/private/tmp")

    def test_target_box_clamps_float_noise_at_image_boundary(self):
        clamped = provider.validate_box(
            {
                "coordinateSpace": "normalized",
                "x": 0.97981785,
                "y": 0.2249345,
                "w": 0.0201823,
                "h": 0.148763,
            }
        )
        for actual, expected in zip(
            clamped, (0.97981785, 0.2249345, 0.02018215, 0.148763)
        ):
            self.assertAlmostEqual(actual, expected)
        with self.assertRaises(ValueError):
            provider.validate_box(
                {
                    "coordinateSpace": "normalized",
                    "x": 0.98,
                    "y": 0.2,
                    "w": 0.03,
                    "h": 0.2,
                }
            )

    def test_failed_packet_redacts_unexpected_provider_error(self):
        packet = provider.failed_packet(
            {"assetToken": "asset", "observationId": "face"},
            "vector-space",
            "config-digest",
            RuntimeError("/private/source/name.jpg"),
        )
        self.assertEqual(packet["state"], "failed")
        self.assertEqual(packet["reason"], "provider-inference-failed")
        self.assertNotIn("/private/source", str(packet))

    def test_private_path_is_redacted(self):
        secret = "/private/library/people/example-person.jpg"
        reason = provider.public_failure_reason(FileNotFoundError(secret))
        self.assertEqual(reason, "source-read-failed")
        self.assertNotIn(secret, reason)

    def test_threshold_and_user_supplied_licence_are_bound(self):
        manifest = synthetic_manifest()
        _, original = provider.validate_manifest(manifest)
        manifest["detector"]["scoreThreshold"] = 0.6
        manifest["vectorSpaceId"], manifest["providerConfigDigest"] = provider.derive_manifest_ids(manifest)
        _, changed = provider.validate_manifest(manifest)
        self.assertNotEqual(original, changed)
        manifest["licensing"]["model"] = "redistributable"
        manifest["vectorSpaceId"], manifest["providerConfigDigest"] = provider.derive_manifest_ids(manifest)
        with self.assertRaises(ValueError):
            provider.validate_manifest(manifest)

    def test_execution_device_is_bound_and_validated(self):
        manifest = synthetic_manifest()
        _, cpu_digest = provider.validate_manifest(manifest)
        manifest["execution"]["device"] = "coreml"
        manifest["provider"]["name"] = "insightface-user-supplied-coreml"
        manifest["vectorSpaceId"], manifest["providerConfigDigest"] = (
            provider.derive_manifest_ids(manifest)
        )
        _, coreml_digest = provider.validate_manifest(manifest)
        self.assertNotEqual(cpu_digest, coreml_digest)
        manifest["execution"]["device"] = "cuda"
        manifest["vectorSpaceId"], manifest["providerConfigDigest"] = (
            provider.derive_manifest_ids(manifest)
        )
        with self.assertRaises(ValueError):
            provider.validate_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
