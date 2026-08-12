from __future__ import annotations

import hashlib
import io
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
    xyxy = Tensor([[10.0, 20.0, 70.0, 180.0]])
    conf = Tensor([0.91])
    cls = Tensor([0])


class Keypoints:
    xy = Tensor([[[20.0 + index, 30.0 + index] for index in range(17)]])
    conf = Tensor([[0.9] * 16 + [0.1]])


class Result:
    boxes = Boxes()
    keypoints = Keypoints()
    names = {0: "person"}
    orig_shape = (200, 100)


class Model:
    def __init__(self, path):
        self.path = path

    def predict(self, *args, **kwargs):
        self.kwargs = kwargs
        return [Result()]


class NoisyModel(Model):
    def __init__(self, path):
        print("first-run settings chatter")
        super().__init__(path)

    def predict(self, *args, **kwargs):
        print("prediction chatter")
        return super().predict(*args, **kwargs)


class EdgeBoxes:
    xyxy = Tensor([[0.00019, -0.25, 100.00001, 200.5]])
    conf = Tensor([0.91])
    cls = Tensor([0])


class EdgeResult(Result):
    boxes = EdgeBoxes()


class EdgeModel(Model):
    def predict(self, *args, **kwargs):
        self.kwargs = kwargs
        return [EdgeResult()]


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class ProviderTest(unittest.TestCase):
    def fixture(self):
        root = Path(tempfile.mkdtemp())
        model = root / "pose.pt"
        manifest_path = root / "manifest.json"
        model.write_bytes(b"pose-model")
        core = {
            "execution": {"device": "cpu", "network": "forbidden", "runtimeId": "ultralytics-8.4.92", "threads": 1},
            "licensing": {"code": "declared", "model": "unknown", "trainingData": "unknown"},
            "pose": {
                "artifactDigest": hashlib.sha256(model.read_bytes()).hexdigest(),
                "jointSchema": "coco17",
                "keypointThreshold": 0.2,
                "modelId": "yolo11x-pose",
                "modelVersionId": "operator-supplied",
                "scoreThreshold": 0.2,
                "topologyId": "coco17.v1",
            },
            "preprocessing": {"colorSpace": "rgb", "coordinateSpace": "normalized_image", "inputHeight": 640, "inputWidth": 640, "resizeMode": "letterbox"},
            "privacy": {"externalUpload": "none", "sourceMedia": "local-read-only"},
            "provider": {"providerId": "ultralytics-yolo-pose", "versionId": "v1"},
            "resources": {"maxMemoryMiB": 16384, "maxRuntimeMs": 120000},
            "schemaVersion": "cimmich.body-pose-provider.v1",
        }
        manifest_path.write_text(json.dumps({**core, "poseConfigDigest": digest(core)}))
        request = {
            "assetToken": "a" * 64,
            "inputRevision": "b" * 64,
            "presentationRotationQuarterTurns": 0,
            "schemaVersion": provider.REQUEST_SCHEMA,
            "sourceContentDigest": hashlib.sha256(b"image").hexdigest(),
        }
        return manifest_path, model, request

    def test_exact_replay_and_missing_keypoint(self):
        manifest_path, model, request = self.fixture()
        manifest = provider.load_manifest(manifest_path, model)
        first = provider.execute(request, b"image", manifest, model, Model, lambda _: object())
        second = provider.execute(request, b"image", manifest, model, Model, lambda _: object())
        self.assertEqual(first, second)
        self.assertEqual(first["state"], "poses_detected")
        self.assertEqual(len(first["detections"]), 1)
        self.assertEqual(len(first["detections"][0]["keypoints"]), 17)
        self.assertIsNone(first["detections"][0]["keypoints"][16]["x"])
        self.assertEqual(first["detections"][0]["keypoints"][0]["joint"], "nose")

    def test_edge_box_is_derived_from_clamped_endpoints(self):
        manifest_path, model, request = self.fixture()
        manifest = provider.load_manifest(manifest_path, model)
        result = provider.execute(
            request,
            b"image",
            manifest,
            model,
            EdgeModel,
            lambda _: object(),
        )
        box = result["detections"][0]["box"]
        self.assertLessEqual(box["x"] + box["w"], 1.000001)
        self.assertLessEqual(box["y"] + box["h"], 1.000001)

    def test_manifest_and_source_drift_fail(self):
        manifest_path, model, request = self.fixture()
        model.write_bytes(b"changed")
        with self.assertRaises(provider.ProviderError):
            provider.load_manifest(manifest_path, model)
        model.write_bytes(b"pose-model")
        manifest = json.loads(manifest_path.read_text())
        manifest["pose"]["freeForm"] = "/private/model"
        core = {key: manifest[key] for key in manifest if key != "poseConfigDigest"}
        manifest["poseConfigDigest"] = digest(core)
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaises(provider.ProviderError):
            provider.load_manifest(manifest_path, model)
        manifest_path, model, _ = self.fixture()
        manifest = json.loads(manifest_path.read_text())
        manifest["execution"]["network"] = "allowed"
        core = {key: manifest[key] for key in manifest if key != "poseConfigDigest"}
        manifest["poseConfigDigest"] = digest(core)
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

    def test_presentation_geometry_maps_back_to_source_coordinates(self):
        box = provider.source_box(
            {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}, 1
        )
        self.assertAlmostEqual(box["x"], 0.2)
        self.assertAlmostEqual(box["y"], 0.6)
        self.assertAlmostEqual(box["w"], 0.4)
        self.assertAlmostEqual(box["h"], 0.3)
        x, y = provider.source_point(0.1, 0.2, 1)
        self.assertAlmostEqual(x, 0.2)
        self.assertAlmostEqual(y, 0.9)

    def test_provider_chatter_never_enters_protocol_stdout(self):
        manifest_path, model, request = self.fixture()
        manifest = provider.load_manifest(manifest_path, model)
        protocol = io.StringIO()
        with provider.redirect_stdout(protocol):
            result = provider.execute(
                request,
                b"image",
                manifest,
                model,
                NoisyModel,
                lambda _: object(),
            )
        self.assertEqual(protocol.getvalue(), "")
        self.assertEqual(result["state"], "poses_detected")


if __name__ == "__main__":
    unittest.main()
