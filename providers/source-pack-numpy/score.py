#!/usr/bin/env python3
import json
import sys

import numpy as np


OWN_CLUSTER_MINIMUM_SUPPORT = 5
OWN_CLUSTER_LOW_TAIL_QUANTILE = 0.25
OWN_CLUSTER_LOW_TAIL_GAP = 0.12
OWN_CLUSTER_ABSOLUTE_CEILING = 0.20
OWN_CLUSTER_CHUNK_SIZE = 512


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
        self.support_entries_by_person = {}
        self.support_count = 0
        self.support_finalized = False
        if "supportGallery" in request:
            self.append_support(request.get("supportGallery") or [])
            self.finalize_support()

    def append_support(self, support_gallery):
        if not isinstance(support_gallery, list) or len(support_gallery) > 4096:
            fail("invalid support gallery")
        if self.support_finalized or self.support_count + len(support_gallery) > 250000:
            fail("invalid support state")
        for row in support_gallery:
            person_id = bounded_text(row.get("personId"), "support personId")
            entry = {
                "asset_id": bounded_text(row.get("assetId"), "support assetId"),
                "contexts": frozenset(map(str, row.get("contextIds") or [])),
                "embedding": row.get("embedding"),
                "face_id": bounded_text(row.get("faceId"), "support faceId"),
            }
            if len(entry["contexts"]) > 64:
                fail("invalid support contexts")
            self.support_entries_by_person.setdefault(person_id, []).append(entry)
        self.support_count += len(support_gallery)

    def finalize_support(self):
        if self.support_finalized:
            fail("invalid support state")
        self.support_by_person = {}
        self.own_cluster_floors = {}
        for person_id, entries in self.support_entries_by_person.items():
            embeddings = matrix(
                [entry["embedding"] for entry in entries], "support"
            )
            support = {
                "asset_ids": np.asarray(
                    [entry["asset_id"] for entry in entries], dtype=object
                ),
                "contexts": [entry["contexts"] for entry in entries],
                "embeddings": embeddings,
                "face_ids": np.asarray(
                    [entry["face_id"] for entry in entries], dtype=object
                ),
            }
            self.support_by_person[person_id] = support
            floor = self._own_cluster_floor(support)
            if floor is not None:
                self.own_cluster_floors[person_id] = floor
        self.support_entries_by_person = {}
        self.support_finalized = True
        return {
            "ownClusterPeople": len(self.own_cluster_floors),
            "supportFaces": self.support_count,
        }

    @staticmethod
    def _valid_support(support, face_id, asset_id, contexts):
        valid = (support["face_ids"] != face_id) & (
            support["asset_ids"] != asset_id
        )
        if contexts:
            valid &= np.fromiter(
                (not bool(contexts & value) for value in support["contexts"]),
                dtype=bool,
                count=len(support["contexts"]),
            )
        return valid

    def _own_cluster_floor(self, support):
        count = len(support["face_ids"])
        if count < OWN_CLUSTER_MINIMUM_SUPPORT:
            return None
        nearest = np.full(count, -np.inf, dtype=np.float32)
        for start in range(0, count, OWN_CLUSTER_CHUNK_SIZE):
            stop = min(count, start + OWN_CLUSTER_CHUNK_SIZE)
            scores = np.clip(
                support["embeddings"][start:stop] @ support["embeddings"].T,
                -1.0,
                1.0,
            )
            for local_index, support_index in enumerate(range(start, stop)):
                valid = self._valid_support(
                    support,
                    support["face_ids"][support_index],
                    support["asset_ids"][support_index],
                    support["contexts"][support_index],
                )
                if np.count_nonzero(valid) >= OWN_CLUSTER_MINIMUM_SUPPORT - 1:
                    nearest[support_index] = np.max(scores[local_index, valid])
        finite = nearest[np.isfinite(nearest)]
        if len(finite) < OWN_CLUSTER_MINIMUM_SUPPORT:
            return None
        low_tail = float(
            np.quantile(finite, OWN_CLUSTER_LOW_TAIL_QUANTILE, method="linear")
        )
        return min(
            OWN_CLUSTER_ABSOLUTE_CEILING,
            low_tail - OWN_CLUSTER_LOW_TAIL_GAP,
        )

    def _own_cluster_matches(self, queries, query_matrix):
        matches = [None] * len(queries)
        grouped = {}
        for query_index, query in enumerate(queries):
            person_id = str(query.get("assignedPersonId") or "").strip()
            if person_id in self.own_cluster_floors:
                grouped.setdefault(person_id, []).append(query_index)
        for person_id, query_indexes in grouped.items():
            support = self.support_by_person[person_id]
            floor = self.own_cluster_floors[person_id]
            group_scores = np.clip(
                query_matrix[query_indexes] @ support["embeddings"].T,
                -1.0,
                1.0,
            )
            for local_index, query_index in enumerate(query_indexes):
                query = queries[query_index]
                valid = self._valid_support(
                    support,
                    str(query.get("faceId") or "").strip(),
                    str(query.get("assetId") or "").strip(),
                    frozenset(map(str, query.get("contextIds") or [])),
                )
                if np.count_nonzero(valid) < OWN_CLUSTER_MINIMUM_SUPPORT - 1:
                    continue
                valid_indexes = np.flatnonzero(valid)
                reference_index = int(
                    valid_indexes[np.argmax(group_scores[local_index, valid_indexes])]
                )
                score = float(group_scores[local_index, reference_index])
                if score < floor:
                    matches[query_index] = {
                        "floor": floor,
                        "referenceAssetId": str(
                            support["asset_ids"][reference_index]
                        ),
                        "score": score,
                    }
        return matches

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

    def audit(self, request):
        queries = request.get("queries")
        if not isinstance(queries, list) or not 1 <= len(queries) <= 4096:
            fail("invalid audit query batch")
        audit_kind = request.get("auditKind")
        if audit_kind not in ("untagged_match", "accepted_contradiction"):
            fail("invalid audit kind")
        query_matrix = matrix([row.get("embedding") for row in queries], "query")
        scores = np.clip(query_matrix @ self.gallery.T, -1.0, 1.0)
        own_cluster_matches = (
            self._own_cluster_matches(queries, query_matrix)
            if audit_kind == "accepted_contradiction"
            else [None] * len(queries)
        )
        results = []
        comparable_queries = 0
        for query_index, query in enumerate(queries):
            face_id = bounded_text(query.get("faceId"), "faceId")
            asset_id = bounded_text(query.get("assetId"), "assetId")
            contexts = frozenset(map(str, query.get("contextIds") or []))
            excluded_people = frozenset(map(str, query.get("excludedPersonIds") or []))
            assigned_person_id = str(query.get("assignedPersonId") or "").strip()
            row_scores = scores[query_index]
            valid = np.ones(len(self.face_ids), dtype=bool)
            for gallery_index, gallery_asset_id in enumerate(self.asset_ids):
                person_id = self.person_ids[self.gallery_person_indexes[gallery_index]]
                if self.face_ids[gallery_index] == face_id:
                    valid[gallery_index] = False
                elif gallery_asset_id == asset_id:
                    valid[gallery_index] = False
                elif contexts and self.contexts[gallery_index] & contexts:
                    valid[gallery_index] = False
                elif person_id in excluded_people:
                    valid[gallery_index] = False
            person_scores = np.full(self.person_count, -np.inf, dtype=np.float32)
            np.maximum.at(
                person_scores,
                self.gallery_person_indexes[valid],
                row_scores[valid],
            )

            if audit_kind == "untagged_match":
                order = np.argsort(-person_scores, kind="stable")
                finite = order[np.isfinite(person_scores[order])]
                if len(finite) == 0:
                    continue
                winner_index = int(finite[0])
                winner_score = float(person_scores[winner_index])
                next_score = (
                    float(person_scores[int(finite[1])]) if len(finite) > 1 else -1.0
                )
                margin = winner_score - next_score
                if winner_score < 0 or margin < 0.25:
                    continue
            else:
                winner_index = None
                evidence_route = "cross_person_match"
                if assigned_person_id and assigned_person_id in self.person_ids:
                    assigned_index = self.person_ids.index(assigned_person_id)
                    assigned_score = float(person_scores[assigned_index])
                    if np.isfinite(assigned_score):
                        comparable_queries += 1
                        alternatives = np.arange(self.person_count)
                        alternatives = alternatives[alternatives != assigned_index]
                        alternatives = alternatives[
                            np.isfinite(person_scores[alternatives])
                        ]
                        if len(alternatives) > 0:
                            alternative_index = int(
                                alternatives[np.argmax(person_scores[alternatives])]
                            )
                            alternative_score = float(
                                person_scores[alternative_index]
                            )
                            alternative_margin = alternative_score - assigned_score
                            if alternative_score >= 0.35 and alternative_margin >= 0.21:
                                winner_index = alternative_index
                                winner_score = alternative_score
                                next_score = assigned_score
                                margin = alternative_margin
                if winner_index is None:
                    outlier = own_cluster_matches[query_index]
                    if outlier is None:
                        continue
                    evidence_route = "own_cluster_outlier"
                    winner_score = outlier["score"]
                    next_score = outlier["floor"]
                    margin = next_score - winner_score
                    results.append(
                        {
                            "assetId": asset_id,
                            "assignedPersonId": assigned_person_id,
                            "comparisonScore": next_score,
                            "evidenceRoute": evidence_route,
                            "faceId": face_id,
                            "margin": margin,
                            "personId": assigned_person_id,
                            "referenceAssetId": outlier["referenceAssetId"],
                            "score": winner_score,
                        }
                    )
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
                    "assignedPersonId": assigned_person_id or None,
                    "comparisonScore": None if next_score == -1.0 else next_score,
                    "evidenceRoute": evidence_route if audit_kind == "accepted_contradiction" else "cross_person_match",
                    "faceId": face_id,
                    "margin": margin,
                    "personId": self.person_ids[winner_index],
                    "referenceAssetId": self.asset_ids[reference_index],
                    "score": winner_score,
                }
            )
        return {
            "kind": "audit_scores",
            "comparableQueries": comparable_queries,
            "results": results,
        }


def serve():
    scorer = None
    for line in sys.stdin:
        try:
            request = json.loads(line)
            kind = request.get("kind")
            if kind == "initialize" and scorer is None:
                scorer = Scorer(request)
                response = {"kind": "gallery_ready"}
            elif kind == "support_chunk" and scorer is not None:
                scorer.append_support(request.get("rows"))
                response = {"kind": "support_received"}
            elif kind == "support_finalize" and scorer is not None:
                response = {
                    "kind": "ready",
                    "diagnostics": scorer.finalize_support(),
                }
            elif kind == "score" and scorer is not None and scorer.support_finalized:
                response = scorer.score(request)
            elif kind == "audit" and scorer is not None and scorer.support_finalized:
                response = scorer.audit(request)
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
