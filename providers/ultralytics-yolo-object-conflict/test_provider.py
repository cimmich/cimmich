from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import provider


class Tensor:
    def __init__(self, value):
        self.value = value

    def cpu(self):
        return self

    def tolist(self):
        return self.value


class Boxes:
    xyxy = Tensor([[10.0, 20.0, 70.0, 180.0], [50.0, 40.0, 90.0, 140.0]])
    conf = Tensor([0.91, 0.88])
    cls = Tensor([15, 16])


class Result:
    boxes = Boxes()
    names = {15: "cat", 16: "dog"}
    orig_shape = (200, 100)


class Model:
    def __init__(self, path):
        self.path = path

    def predict(self, *args, **kwargs):
        self.kwargs = kwargs
        return [Result()]


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class ProviderTest(unittest.TestCase):
    def fixture(self):
        root = Path(tempfile.mkdtemp())
        model = root / "objects.pt"
        manifest_path = root / "manifest.json"
        model.write_bytes(b"object-model")
        core = {
            "detector": {
                "artifactDigest": hashlib.sha256(model.read_bytes()).hexdigest(),
                "classes": ["cat", "dog"],
                "modelId": "yolo11x",
                "modelVersionId": "operator-supplied",
                "scoreThreshold": 0.25,
            },
            "execution": {"device": "cpu", "network": "forbidden", "runtimeId": "ultralytics-8.4.92", "threads": 1},
            "licensing": {"code": "declared", "model": "unknown", "trainingData": "unknown"},
            "preprocessing": {"colorSpace": "rgb", "coordinateSpace": "normalized_image", "inputHeight": 640, "inputWidth": 640, "resizeMode": "letterbox"},
            "privacy": {"externalUpload": "none", "sourceMedia": "local-read-only"},
            "provider": {"providerId": "ultralytics-yolo-object-conflict", "versionId": "v1"},
            "resources": {"maxMemoryMiB": 16384, "maxRuntimeMs": 120000},
            "schemaVersion": "cimmich.body-object-conflict-provider.v1",
        }
        manifest_path.write_text(json.dumps({**core, "objectConfigDigest": digest(core)}))
        request = {
            "assetToken": "a" * 64,
            "inputRevision": "b" * 64,
            "schemaVersion": provider.REQUEST_SCHEMA,
            "sourceContentDigest": hashlib.sha256(b"image").hexdigest(),
        }
        return manifest_path, model, request

    def test_exact_replay_and_bounded_categories(self):
        manifest_path, model, request = self.fixture()
        manifest = provider.load_manifest(manifest_path, model)
        first = provider.execute(request, b"image", manifest, model, Model, lambda _: object())
        second = provider.execute(request, b"image", manifest, model, Model, lambda _: object())
        self.assertEqual(first, second)
        self.assertEqual(first["state"], "objects_detected")
        self.assertEqual({item["category"] for item in first["objects"]}, {"cat", "dog"})
        self.assertEqual(len(first["objects"]), 2)

    def test_manifest_and_source_drift_fail(self):
        manifest_path, model, request = self.fixture()
        model.write_bytes(b"changed")
        with self.assertRaises(provider.ProviderError):
            provider.load_manifest(manifest_path, model)
        manifest_path, model, _ = self.fixture()
        manifest = json.loads(manifest_path.read_text())
        manifest["detector"]["classes"] = ["person"]
        core = {key: manifest[key] for key in manifest if key != "objectConfigDigest"}
        manifest["objectConfigDigest"] = digest(core)
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaises(provider.ProviderError):
            provider.load_manifest(manifest_path, model)
        manifest_path, model, _ = self.fixture()
        manifest = json.loads(manifest_path.read_text())
        manifest["execution"]["network"] = "allowed"
        core = {key: manifest[key] for key in manifest if key != "objectConfigDigest"}
        manifest["objectConfigDigest"] = digest(core)
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaises(provider.ProviderError):
            provider.load_manifest(manifest_path, model)

    def test_packet_is_in_memory_and_digest_bound(self):
        _, _, request = self.fixture()
        header = json.dumps(request, sort_keys=True, separators=(",", ":")).encode()
        packet = len(header).to_bytes(4, "big") + header + b"image"
        decoded, image = provider.load_packet(packet, 1024)
        self.assertEqual(decoded, request)
        self.assertEqual(image, b"image")
        with self.assertRaises(provider.ProviderError):
            provider.load_packet(packet[:-1] + b"x", 1024)


if __name__ == "__main__":
    unittest.main()
