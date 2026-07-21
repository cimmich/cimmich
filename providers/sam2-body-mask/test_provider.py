#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import hashlib
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("provider.py")
SPEC = importlib.util.spec_from_file_location("sam2_body_mask_provider", MODULE_PATH)
PROVIDER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(PROVIDER)


class ProviderPolicyTest(unittest.TestCase):
    def test_digest_matches_node_json_for_integral_floats(self):
        expected = hashlib.sha256(b'{"box":{"h":1,"w":0.5}}').hexdigest()
        self.assertEqual(
            PROVIDER.digest({"box": {"h": 1.0, "w": 0.5}}),
            expected,
        )

    def test_mask_payload_digest_uses_language_neutral_fixed_box_numbers(self):
        value = {
            "box": {"h": 1.0, "w": 0.5, "x": 0.000001, "y": 0.0},
            "height": 2,
            "originX": 0,
            "originY": 0,
            "runs": [0, 4],
            "width": 2,
        }
        expected = hashlib.sha256(
            b'{"box":{"h":"1.000000","w":"0.500000","x":"0.000001","y":"0.000000"},"height":2,"originX":0,"originY":0,"runs":[0,4],"width":2}'
        ).hexdigest()
        self.assertEqual(PROVIDER.mask_payload_digest(value), expected)

    def test_pixel_rounding_matches_node_half_up_contract(self):
        self.assertEqual(PROVIDER.round_pixel(2.5), 3)
        self.assertEqual(PROVIDER.round_ratio6(1, 2_000_000), 0.000001)

    def test_frozen_policy_dispositions(self):
        thresholds = {
            "expandedFraction": 0.08,
            "rejectMaxAreaRatio": 1.35,
            "rejectMinAreaRatio": 0.05,
            "rejectMinInside": 0.62,
            "validMaxAreaRatio": 0.92,
            "validMinInside": 0.78,
            "validMinScore": 0.35,
        }
        self.assertEqual(
            PROVIDER.classify(
                {"maskArea": 100, "maskAreaRatioToPrompt": 0.8, "insideExpandedRatio": 0.9, "score": 0.8},
                thresholds,
            ),
            ("geometry_valid", "geometry_valid_semantics_unverified"),
        )
        self.assertEqual(
            PROVIDER.classify(
                {"maskArea": 100, "maskAreaRatioToPrompt": 0.8, "insideExpandedRatio": 0.7, "score": 0.8},
                thresholds,
            )[0],
            "review",
        )
        self.assertEqual(
            PROVIDER.classify(
                {"maskArea": 100, "maskAreaRatioToPrompt": 1.5, "insideExpandedRatio": 0.9, "score": 0.8},
                thresholds,
            )[0],
            "abstained",
        )

    def test_rle_is_row_major_and_complete(self):
        import numpy as np

        mask = np.asarray([[1, 1], [0, 1]], dtype=bool)
        runs = PROVIDER.rle(mask)
        self.assertEqual(runs, [0, 2, 1, 1])
        self.assertEqual(sum(runs), 4)

    def test_normalized_boxes_fail_closed(self):
        with self.assertRaises(PROVIDER.ProviderError):
            PROVIDER.normalized_box({"x": 0.9, "y": 0.1, "w": 0.2, "h": 0.2}, "box")


if __name__ == "__main__":
    unittest.main()
