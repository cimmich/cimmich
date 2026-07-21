import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import provider


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


class ProviderTest(unittest.TestCase):
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
                "provider": {"providerId": "ultralytics-yolo-body", "versionId": "v2"},
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

    def test_request_rejects_extra_fields_and_source_drift(self):
        base = {
            "assetToken": "a" * 64,
            "imagePath": "/tmp/image",
            "inputRevision": "b" * 64,
            "manifestPath": "/tmp/manifest",
            "modelPath": "/tmp/model",
            "schemaVersion": provider.REQUEST_SCHEMA,
            "sourceContentDigest": "c" * 64,
        }
        provider.load_request(json.dumps(base).encode())
        with self.assertRaises(provider.ProviderError):
            provider.load_request(json.dumps({**base, "name": "private"}).encode())


if __name__ == "__main__":
    unittest.main()
