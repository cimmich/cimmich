#!/usr/bin/env python3
import json
import sys

import numpy as np


def fail(message):
    raise ValueError(message)


def bounded_text(value, label, maximum=200):
    text = str(value or "").strip()
    if not text or len(text) > maximum or any(ord(char) < 32 for char in text):
        fail(f"invalid {label}")
    return text


def matrix(rows, label):
    values = np.asarray(rows, dtype=np.float32)
    if values.ndim != 2 or values.shape[1] != 512 or not np.isfinite(values).all():
        fail(f"invalid {label} embeddings")
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if np.any(norms <= 0):
        fail(f"invalid {label} embedding norm")
    return values / norms


class Scorer:
    def __init__(self, request):
        gallery = request.get("gallery")
        if not isinstance(gallery, list) or not 1 <= len(gallery) <= 10000:
            fail("invalid gallery")
        self.person_ids = []
        person_index = {}
        self.gallery_person_indexes = []
        self.face_ids = []
        self.asset_ids = []
        self.contexts = []
        embeddings = []
        for row in gallery:
            person_id = bounded_text(row.get("personId"), "personId")
            if person_id not in person_index:
                person_index[person_id] = len(self.person_ids)
                self.person_ids.append(person_id)
            self.gallery_person_indexes.append(person_index[person_id])
            self.face_ids.append(bounded_text(row.get("faceId"), "faceId"))
            self.asset_ids.append(bounded_text(row.get("assetId"), "assetId"))
            contexts = row.get("contextIds") or []
            if not isinstance(contexts, list) or len(contexts) > 64:
                fail("invalid gallery contexts")
            self.contexts.append(frozenset(map(str, contexts)))
            embeddings.append(row.get("embedding"))
        self.gallery = matrix(embeddings, "gallery")
        self.gallery_person_indexes = np.asarray(
            self.gallery_person_indexes, dtype=np.int32
        )
        self.person_count = len(self.person_ids)

    def score(self, request):
        queries = request.get("queries")
        if not isinstance(queries, list) or not 1 <= len(queries) <= 4096:
            fail("invalid query batch")
        score_floor = float(request.get("scoreFloor"))
        margin_floor = float(request.get("marginFloor"))
        if not 0 <= score_floor <= 1 or not 0 <= margin_floor <= 1:
            fail("invalid policy floors")
        query_matrix = matrix([row.get("embedding") for row in queries], "query")
        scores = np.clip(query_matrix @ self.gallery.T, -1.0, 1.0)
        results = []
        for query_index, query in enumerate(queries):
            face_id = bounded_text(query.get("faceId"), "faceId")
            asset_id = bounded_text(query.get("assetId"), "assetId")
            physical_face_id = bounded_text(
                query.get("physicalFaceId"), "physicalFaceId"
            )
            contexts = frozenset(map(str, query.get("contextIds") or []))
            excluded_people = frozenset(map(str, query.get("excludedPersonIds") or []))
            row_scores = scores[query_index]
            valid = np.ones(len(self.face_ids), dtype=bool)
            for gallery_index, gallery_asset_id in enumerate(self.asset_ids):
                if gallery_asset_id == asset_id:
                    valid[gallery_index] = False
                elif contexts and self.contexts[gallery_index] & contexts:
                    valid[gallery_index] = False
                elif self.person_ids[
                    self.gallery_person_indexes[gallery_index]
                ] in excluded_people:
                    valid[gallery_index] = False
            person_scores = np.full(self.person_count, -np.inf, dtype=np.float32)
            np.maximum.at(
                person_scores,
                self.gallery_person_indexes[valid],
                row_scores[valid],
            )
            order = np.argsort(-person_scores, kind="stable")
            if len(order) == 0 or not np.isfinite(person_scores[order[0]]):
                continue
            winner_index = int(order[0])
            winner_score = float(person_scores[winner_index])
            next_score = (
                float(person_scores[order[1]])
                if len(order) > 1 and np.isfinite(person_scores[order[1]])
                else -1.0
            )
            margin = winner_score - next_score
            if winner_score < score_floor or margin < margin_floor:
                continue
            winning_gallery = np.flatnonzero(
                valid & (self.gallery_person_indexes == winner_index)
            )
            reference_index = int(
                winning_gallery[np.argmax(row_scores[winning_gallery])]
            )
            results.append(
                {
                    "assetId": asset_id,
                    "faceId": face_id,
                    "margin": margin,
                    "nextScore": None if next_score == -1.0 else next_score,
                    "personId": self.person_ids[winner_index],
                    "physicalFaceId": physical_face_id,
                    "referenceAssetId": self.asset_ids[reference_index],
                    "referenceFaceId": self.face_ids[reference_index],
                    "score": winner_score,
                }
            )
        return {"kind": "scores", "results": results}


def serve():
    scorer = None
    for line in sys.stdin:
        try:
            request = json.loads(line)
            kind = request.get("kind")
            if kind == "initialize" and scorer is None:
                scorer = Scorer(request)
                response = {"kind": "ready"}
            elif kind == "score" and scorer is not None:
                response = scorer.score(request)
            else:
                fail("invalid request state")
        except Exception as error:
            response = {
                "error": {
                    "code": "SOURCE_PACK_NUMPY_INPUT_INVALID",
                    "reason": str(error)[:120],
                }
            }
        sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    serve()
