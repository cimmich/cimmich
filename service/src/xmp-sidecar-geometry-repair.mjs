import { createHash } from "node:crypto";

export const xmpSidecarRepairReceiptId =
  "receipt_cimmich_xmp_sidecar_face_import_v3";

const stableId = (prefix, ...parts) =>
  `${prefix}${createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 40)}`;
const sameNumber = (left, right) =>
  Math.abs(Number(left) - Number(right)) <= 0.000000001;
const sameBox = (row, box, prefix = "box_") =>
  sameNumber(row[`${prefix}x`], box.x) &&
  sameNumber(row[`${prefix}y`], box.y) &&
  sameNumber(row[`${prefix}w`], box.w) &&
  sameNumber(row[`${prefix}h`], box.h);
const sameStoredBox = (left, right) =>
  sameNumber(left.box_x, right.box_x) &&
  sameNumber(left.box_y, right.box_y) &&
  sameNumber(left.box_w, right.box_w) &&
  sameNumber(left.box_h, right.box_h);
const correctionId = (evidenceId, oldBox, newBox) =>
  stableId(
    "xmp_geometry_correction_",
    evidenceId,
    JSON.stringify(oldBox),
    JSON.stringify(newBox),
  );
const replayConflict = (message) =>
  Object.assign(new Error(message), { code: "XMP_EVIDENCE_REPLAY_CONFLICT" });

export const recordXmpCoordinateFrame = async (sql, { current, outcome }) => {
  const sourceDimensions = outcome.face.sourceDimensions;
  const sourceBoxRecorded = current.source_box_x != null;
  const sourceBoxMatches = sourceBoxRecorded
    ? sameBox(current, outcome.face.sourceBox, "source_box_")
    : sameBox(current, outcome.face.sourceBox);
  if (!sourceBoxMatches) {
    throw replayConflict("XMP source geometry replay conflicts");
  }

  const geometryChanged = !sameBox(current, outcome.face.box);
  if (
    geometryChanged &&
    (outcome.face.exifOrientation === 1 || !sourceDimensions)
  ) {
    throw replayConflict("XMP display geometry replay conflicts");
  }

  if (geometryChanged) {
    const [observation] = await sql`
      SELECT face_id, observation_origin, box_x, box_y, box_w, box_h
      FROM face_observation
      WHERE face_id = ${current.face_id} AND state = 'valid'
      FOR UPDATE
    `;
    if (!observation) {
      throw replayConflict("XMP Face observation is unavailable");
    }
    if (current.resolution_state.startsWith("created_")) {
      if (observation.observation_origin !== "xmp_sidecar_import") {
        throw replayConflict(
          "Created XMP evidence does not own its Face region",
        );
      }
      if (!sameStoredBox(observation, current)) {
        throw replayConflict(
          "XMP Face geometry changed outside sidecar repair",
        );
      }
      const oldBox = Object.freeze({
        h: Number(current.box_h),
        w: Number(current.box_w),
        x: Number(current.box_x),
        y: Number(current.box_y),
      });
      const id = correctionId(current.evidence_id, oldBox, outcome.face.box);
      await sql`
        INSERT INTO xmp_sidecar_geometry_correction (
          correction_id, evidence_id, face_id,
          old_box_x, old_box_y, old_box_w, old_box_h,
          new_box_x, new_box_y, new_box_w, new_box_h, exif_orientation
        ) VALUES (
          ${id}, ${current.evidence_id}, ${current.face_id},
          ${oldBox.x}, ${oldBox.y}, ${oldBox.w}, ${oldBox.h},
          ${outcome.face.box.x}, ${outcome.face.box.y},
          ${outcome.face.box.w}, ${outcome.face.box.h},
          ${outcome.face.exifOrientation}
        )
        ON CONFLICT (correction_id) DO NOTHING
      `;
      await sql`
        SELECT enqueue_source_pack_rebuild(
          identity.person_id, 'xmp_geometry_corrected',
          'face_observation', ${current.face_id},
          embedding.model_family, embedding.model_version,
          embedding.config_digest
        )
        FROM current_face_identity identity
        JOIN face_embedding embedding ON embedding.face_id = identity.face_id
          AND embedding.state = 'active'
        WHERE identity.face_id = ${current.face_id}
          AND identity.state = 'accepted'
      `;
      await sql`
        UPDATE face_embedding SET state = 'superseded'
        WHERE face_id = ${current.face_id} AND state = 'active'
      `;
      const candidates = await sql`
        SELECT identity_claim_id FROM identity_claim
        WHERE face_id = ${current.face_id} AND state = 'candidate'
        FOR UPDATE
      `;
      for (const candidate of candidates) {
        const decisionId = stableId(
          "decision_xmp_geometry_",
          id,
          candidate.identity_claim_id,
        );
        await sql`
          INSERT INTO decision (
            decision_id, subject_type, subject_id, action, actor_kind,
            actor_id, reason_code, note, producer_receipt_id, privacy_class
          ) VALUES (
            ${decisionId}, 'identity_claim', ${candidate.identity_claim_id},
            'ignore', 'policy', 'cimmich-xmp-orientation-repair',
            'source_geometry_corrected',
            'Superseded because the XMP region moved from its encoded source frame to the displayed EXIF-transposed frame.',
            ${xmpSidecarRepairReceiptId}, 'sensitive-biometric'
          ) ON CONFLICT (decision_id) DO NOTHING
        `;
        await sql`
          UPDATE identity_claim SET state = 'superseded',
            decision_id = ${decisionId}
          WHERE identity_claim_id = ${candidate.identity_claim_id}
            AND state = 'candidate'
        `;
      }
      await sql`
        UPDATE identity_audit_item SET review_state = 'dismissed',
          reviewed_at = now(), reviewed_by = 'cimmich-xmp-orientation-repair'
        WHERE face_id = ${current.face_id} AND review_state = 'open'
      `;
      await sql`
        UPDATE face_observation SET
          box_x = ${outcome.face.box.x}, box_y = ${outcome.face.box.y},
          box_w = ${outcome.face.box.w}, box_h = ${outcome.face.box.h},
          quality_measurements = quality_measurements || ${sql.json({
            coordinateTransform: "exif_transposed_top_left",
            exifOrientation: outcome.face.exifOrientation,
            sourceKind: "xmp_sidecar",
          })}
        WHERE face_id = ${current.face_id}
      `;
    }
  }

  await sql`
    UPDATE xmp_sidecar_face_evidence SET
      box_x = ${outcome.face.box.x}, box_y = ${outcome.face.box.y},
      box_w = ${outcome.face.box.w}, box_h = ${outcome.face.box.h},
      source_box_x = ${outcome.face.sourceBox.x},
      source_box_y = ${outcome.face.sourceBox.y},
      source_box_w = ${outcome.face.sourceBox.w},
      source_box_h = ${outcome.face.sourceBox.h},
      exif_orientation = ${outcome.face.exifOrientation},
      source_pixel_width = ${sourceDimensions?.width ?? null},
      source_pixel_height = ${sourceDimensions?.height ?? null},
      coordinate_transform = ${
        outcome.face.exifOrientation === 1
          ? "identity"
          : "exif_transposed_top_left"
      },
      producer_receipt_id = ${xmpSidecarRepairReceiptId}, schema_version = 2
    WHERE evidence_id = ${current.evidence_id}
  `;
  return geometryChanged && current.resolution_state.startsWith("created_")
    ? 1
    : 0;
};
