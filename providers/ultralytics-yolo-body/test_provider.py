import hashlib
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import provider
import numpy as np


class Tensor:
    def __init__(self, value):
        self.value = value

    def cpu(self):
        return self

    def tolist(self):
        return self.value


class Model:
    calls = []

    def __init__(self, _path):
        pass

    def predict(self, *_args, **_kwargs):
        self.calls.append(_kwargs)
        boxes = SimpleNamespace(
            xyxy=Tensor(
                [[10.0, 20.0, 60.0, 180.0], [0.0, 0.0, 10.0, 10.0]]
            ),
            conf=Tensor([0.9123454, 0.1]),
            cls=Tensor([0.0, 0.0]),
        )
        return [
            SimpleNamespace(
                boxes=boxes,
                names={0: "person"},
                orig_shape=(200, 100),
            )
        ]


class TorchRuntime:
    threads = None
    interop_threads = None

    @classmethod
    def set_num_threads(cls, value):
        cls.threads = value

    @classmethod
    def set_num_interop_threads(cls, value):
        cls.interop_threads = value


class NoisyModel(Model):
    def __init__(self, path):
        print("provider boot chatter")
        super().__init__(path)

    def predict(self, *args, **kwargs):
        print("provider prediction chatter")
        return super().predict(*args, **kwargs)


class ProviderTest(unittest.TestCase):
    def test_runtime_enforces_the_manifest_thread_budget(self):
        manifest = {"execution": {"threads": 6}}
        provider.configure_runtime(manifest, torch_module=TorchRuntime)
        self.assertEqual(TorchRuntime.threads, 6)
        self.assertEqual(TorchRuntime.interop_threads, 4)

    def test_result_is_minimized_and_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "private image.jpg"
            image.write_bytes(b"image")
            model = root / "model.pt"
            model.write_bytes(b"model")
            core = {
                "detector": {
                    "artifactDigest": hashlib.sha256(b"model").hexdigest(),
                    "modelId": "test-model",
                    "modelVersionId": "v1",
                    "scoreThreshold": 0.3,
                },
                "execution": {
                    "device": "cpu",
                    "network": "forbidden",
                    "runtimeId": "test-runtime",
                    "threads": 1,
                },
                "licensing": {"code": "declared", "model": "unknown", "trainingData": "unknown"},
                "preprocessing": {
                    "colorSpace": "rgb",
                    "coordinateSpace": "normalized_image",
                    "inputHeight": 640,
                    "inputWidth": 640,
                    "resizeMode": "letterbox",
                },
                "privacy": {"externalUpload": "none", "sourceMedia": "local-read-only"},
                "provider": {"providerId": "ultralytics-yolo-body", "versionId": "v3"},
                "resources": {"maxMemoryMiB": 1024, "maxRuntimeMs": 60000},
                "schemaVersion": "cimmich.body-detector.v1",
            }
            manifest = {**core, "detectorConfigDigest": provider.canonical_digest(core)}
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest))
            request = {
                "assetToken": "a" * 64,
                "imagePath": str(image),
                "inputRevision": "b" * 64,
                "manifestPath": str(manifest_path),
                "modelPath": str(model),
                "presentationRotationQuarterTurns": 0,
                "schemaVersion": provider.REQUEST_SCHEMA,
                "sourceContentDigest": hashlib.sha256(b"image").hexdigest(),
            }
            result = provider.execute(request, model_factory=Model)
            self.assertEqual(result["state"], "bodies_detected")
            self.assertEqual(len(result["bodies"]), 1)
            self.assertEqual(result["bodies"][0]["confidence"], 0.912345)
            self.assertEqual(result["bodies"][0]["box"], {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.8})
            self.assertNotIn(str(image), json.dumps(result))
            self.assertEqual(Model.calls[-1]["conf"], provider.RAW_CONFIDENCE_FLOOR)
            self.assertEqual(Model.calls[-1]["classes"], [0])
            self.assertEqual(Model.calls[-1]["max_det"], provider.MAX_RAW_DETECTIONS)

            core["execution"]["threads"] = 0
            invalid_manifest = {
                **core,
                "detectorConfigDigest": provider.canonical_digest(core),
            }
            manifest_path.write_text(json.dumps(invalid_manifest))
            with self.assertRaises(provider.ProviderError):
                provider.load_manifest(manifest_path, model)

    def test_provider_chatter_cannot_pollute_the_stdout_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "image.jpg"
            image.write_bytes(b"image")
            model = root / "model.pt"
            model.write_bytes(b"model")
            core = {
                "detector": {
                    "artifactDigest": hashlib.sha256(b"model").hexdigest(),
                    "modelId": "test-model",
                    "modelVersionId": "v1",
                    "scoreThreshold": 0.3,
                },
                "execution": {
                    "device": "cpu",
                    "network": "forbidden",
                    "runtimeId": "test-runtime",
                    "threads": 1,
                },
                "licensing": {"code": "declared", "model": "unknown", "trainingData": "unknown"},
                "preprocessing": {
                    "colorSpace": "rgb",
                    "coordinateSpace": "normalized_image",
                    "inputHeight": 640,
                    "inputWidth": 640,
                    "resizeMode": "letterbox",
                },
                "privacy": {"externalUpload": "none", "sourceMedia": "local-read-only"},
                "provider": {"providerId": "ultralytics-yolo-body", "versionId": "v3"},
                "resources": {"maxMemoryMiB": 1024, "maxRuntimeMs": 60000},
                "schemaVersion": "cimmich.body-detector.v1",
            }
            manifest = {**core, "detectorConfigDigest": provider.canonical_digest(core)}
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest))
            request = {
                "assetToken": "a" * 64,
                "imagePath": str(image),
                "inputRevision": "b" * 64,
                "manifestPath": str(manifest_path),
                "modelPath": str(model),
                "presentationRotationQuarterTurns": 0,
                "schemaVersion": provider.REQUEST_SCHEMA,
                "sourceContentDigest": hashlib.sha256(b"image").hexdigest(),
            }
            stdout = StringIO()
            stderr = StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                result = provider.execute(request, model_factory=NoisyModel)
            self.assertEqual(result["state"], "bodies_detected")
            self.assertEqual(stdout.getvalue(), "")
            self.assertIn("provider boot chatter", stderr.getvalue())
            self.assertIn("provider prediction chatter", stderr.getvalue())

    def test_request_rejects_extra_fields_and_source_drift(self):
        base = {
            "assetToken": "a" * 64,
            "imagePath": "/tmp/image",
            "inputRevision": "b" * 64,
            "manifestPath": "/tmp/manifest",
            "modelPath": "/tmp/model",
            "presentationRotationQuarterTurns": 0,
            "schemaVersion": provider.REQUEST_SCHEMA,
            "sourceContentDigest": "c" * 64,
        }
        provider.load_request(json.dumps(base).encode())
        with self.assertRaises(provider.ProviderError):
            provider.load_request(json.dumps({**base, "name": "private"}).encode())

    def test_corrected_presentation_boxes_map_back_to_source_coordinates(self):
        presented = {"x": 0.2, "y": 0.1, "w": 0.3, "h": 0.4}
        self.assertEqual(
            provider.source_box(presented, 1),
            {"x": 0.1, "y": 0.5, "w": 0.4, "h": 0.3},
        )
        self.assertEqual(
            provider.source_box(presented, 2),
            {"x": 0.5, "y": 0.5, "w": 0.3, "h": 0.4},
        )
        self.assertEqual(
            provider.source_box(presented, 3),
            {"x": 0.5, "y": 0.2, "w": 0.4, "h": 0.3},
        )
        with self.assertRaises(provider.ProviderError):
            provider.validate_quarter_turns(4)
        image = np.zeros((20, 40, 3), dtype=np.uint8)
        self.assertEqual(provider.presentation_image(image, 1).shape, (40, 20, 3))


if __name__ == "__main__":
    unittest.main()
