import importlib.util
from contextlib import redirect_stdout
from io import StringIO
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image


MODULE_PATH = Path(__file__).with_name("image_tools.py")
SPEC = importlib.util.spec_from_file_location("image_tools", MODULE_PATH)
image_tools = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(image_tools)


class OverlayPresentationTest(unittest.TestCase):
    def test_saved_quarter_turn_rotates_only_the_derived_overlay(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.png"
            data = root / "boxes.json"
            output = root / "overlay.png"
            Image.new("RGB", (80, 40), "black").save(source)
            data.write_text(
                json.dumps(
                    {
                        "bodies": [
                            {"box": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}}
                        ],
                        "faces": [],
                    }
                )
            )

            with redirect_stdout(StringIO()):
                image_tools.overlay(
                    SimpleNamespace(
                        data=str(data),
                        input=str(source),
                        output=str(output),
                        rotate_quarter_turns=1,
                    )
                )

            with Image.open(output) as rendered:
                self.assertEqual(rendered.size, (40, 80))
            with Image.open(source) as unchanged:
                self.assertEqual(unchanged.size, (80, 40))


if __name__ == "__main__":
    unittest.main()
