import importlib.util
from pathlib import Path
import tempfile
import unittest

from PIL import Image


MODULE_PATH = Path(__file__).with_name("provider.py")
SPEC = importlib.util.spec_from_file_location("cimmich_miewid_provider", MODULE_PATH)
provider = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(provider)


class ProviderTest(unittest.TestCase):
    def test_box_validation_rejects_escape(self):
        with self.assertRaises(ValueError):
            provider.validate_box({"x": 0.8, "y": 0.2, "w": 0.3, "h": 0.2})

    def test_context_crop_is_larger_than_target(self):
        image = Image.new("RGB", (1000, 500))
        crop = provider.pet_crop(
            image,
            (0.4, 0.3, 0.1, 0.2),
            context=4.0,
        )
        self.assertGreater(crop.width, 100)
        self.assertGreater(crop.height, 100)

    def test_full_image_is_preserved_without_geometry(self):
        image = Image.new("RGB", (1000, 500))
        crop = provider.pet_crop(image, None, context=4.0)
        self.assertEqual(crop.size, image.size)

    def test_model_loading_fails_closed_before_remote_code_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "does not execute remote model code"):
                provider.load_local_model(Path(directory), None)


if __name__ == "__main__":
    unittest.main()
