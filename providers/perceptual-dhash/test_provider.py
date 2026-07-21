from io import BytesIO
import unittest

from PIL import Image

from provider import difference_hash, similarity


def image_bytes(reverse: bool = False) -> bytes:
    image = Image.new("L", (32, 24))
    for y in range(image.height):
        for x in range(image.width):
            value = 255 - x * 7 if reverse else x * 7
            image.putpixel((x, y), max(0, min(255, value)))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class ProviderTest(unittest.TestCase):
    def test_identical_images_are_exact(self) -> None:
        encoded = image_bytes()
        self.assertEqual(similarity(encoded, encoded), 1.0)

    def test_opposite_gradients_are_distinct_and_symmetric(self) -> None:
        left = image_bytes()
        right = image_bytes(reverse=True)
        self.assertEqual(similarity(left, right), similarity(right, left))
        self.assertLess(similarity(left, right), 0.2)

    def test_hash_is_bounded(self) -> None:
        value = difference_hash(image_bytes())
        self.assertGreaterEqual(value, 0)
        self.assertLess(value, 2**64)


if __name__ == "__main__":
    unittest.main()
