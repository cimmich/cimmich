import { createHash, randomUUID } from "node:crypto";
import {
  curatePrimeSet,
  parseVector,
  primeCuratorPolicyVersion as policyVersion,
  vectorText,
} from "./prime-curator.mjs";
import {
  isLowQualityEvidence,
  lowQualityPolicyVersion,
} from "./low-quality-policy.mjs";
import { applyBiometricAuthority } from "./biometric-authority.mjs";

const receiptId = "receipt_cimmich_prime_biometric_curator_v1";
const eventId = () => `membership_${randomUUID().replaceAll("-", "")}`;
const prototypeId = (curation, memberFaceIds) =>
  `prototype_${createHash("sha256")
    .update(
      [
        policyVersion,
        curation.personId,
        curation.modelFamily,
        curation.modelVersion,
        curation.configDigest,
        curation.dimension,
        memberFaceIds.join(","),
        vectorText(curation.prototype),
      ].join("\u001f"),
    )
    .digest("hex")
    .slice(0, 32)}`;

export const loadPrimeCuratorFaces = async (sql, personId = "") => {
  const rows = await sql`
    SELECT cfi.person_id, fo.face_id, fo.asset_id,
      round(a.width * fo.box_w)::int AS face_pixel_width,
      round(a.height * fo.box_h)::int AS face_pixel_height,
      fo.detection_confidence::float8 AS detection,
      coalesce((fo.quality_measurements->>'quality_score')::float8, 0) AS quality,
      coalesce(fo.quality_measurements->>'effective_gallery_permission', 'unknown') AS gallery_permission,
      coalesce(fo.quality_measurements->>'source_instance_suffix', '') AS source_instance_suffix,
      fe.model_family, fe.model_version, fe.config_digest, fe.dimension, fe.embedding::text AS embedding,
      competitor.max_other_prime_similarity,
      coalesce(prime_pin.pinned, false) AS pinned_prime,
      coalesce(user_override.blocked, false) AS blocked_prime,
      current_main.bucket_kind AS current_bucket_kind,
      current_main.actor_kind AS current_bucket_actor_kind,
      coalesce(user_main_override.present, false) AS user_main_override
    FROM current_face_identity cfi
    JOIN current_person subject ON subject.person_id = cfi.person_id AND subject.subject_kind = 'person'
    JOIN face_observation fo ON fo.face_id = cfi.face_id AND fo.state = 'valid'
    JOIN asset a ON a.asset_id = fo.asset_id
    JOIN face_embedding fe ON fe.face_id = fo.face_id AND fe.state = 'active'
    LEFT JOIN LATERAL (
      SELECT max(1 - (fe.embedding <=> other.embedding))::float8 AS max_other_prime_similarity
      FROM current_reference_prototype other
      WHERE other.person_id <> cfi.person_id
        AND other.model_family = fe.model_family
        AND other.model_version = fe.model_version
        AND other.config_digest = fe.config_digest
    ) competitor ON true
    LEFT JOIN LATERAL (
      SELECT g.bucket_kind, g.actor_kind, g.latest_action
      FROM current_reference_gallery g
      WHERE g.person_id = cfi.person_id AND g.face_id = fo.face_id
        AND g.bucket_kind IN ('prime','secondary','lq','head')
        AND g.membership_state = 'active'
      ORDER BY CASE g.bucket_kind WHEN 'prime' THEN 0 WHEN 'secondary' THEN 1 WHEN 'lq' THEN 2 ELSE 3 END
      LIMIT 1
    ) current_main ON true
    LEFT JOIN LATERAL (
      SELECT true AS pinned
      FROM current_reference_gallery g
      WHERE g.person_id = cfi.person_id AND g.face_id = fo.face_id
        AND g.bucket_kind = 'prime' AND g.membership_state = 'active'
        AND g.actor_kind = 'user' AND g.latest_action = 'pin'
      LIMIT 1
    ) prime_pin ON true
    LEFT JOIN LATERAL (
      SELECT true AS blocked
      WHERE NOT coalesce(prime_pin.pinned, false)
        AND (
          EXISTS (
            SELECT 1
            FROM bucket_membership_event e
            JOIN reference_bucket b ON b.bucket_id = e.bucket_id
            WHERE b.person_id = cfi.person_id AND e.face_id = fo.face_id
              AND b.bucket_kind IN ('prime','secondary','lq','head') AND e.actor_kind = 'user'
          )
          OR EXISTS (
            SELECT 1
            FROM current_reference_gallery head
            WHERE head.person_id = cfi.person_id AND head.face_id = fo.face_id
              AND head.bucket_kind = 'head' AND head.membership_state = 'active'
          )
        )
      LIMIT 1
    ) user_override ON true
    LEFT JOIN LATERAL (
      SELECT true AS present
      FROM bucket_membership_event e
      JOIN reference_bucket b ON b.bucket_id = e.bucket_id
      WHERE b.person_id = cfi.person_id AND e.face_id = fo.face_id
        AND b.bucket_kind IN ('prime','secondary','lq','head') AND e.actor_kind = 'user'
      LIMIT 1
    ) user_main_override ON true
    WHERE cfi.state = 'accepted'
      AND fo.observation_origin <> 'manual_user'
      AND NOT EXISTS (
        SELECT 1 FROM current_person_category category
        WHERE category.person_id = cfi.person_id AND category.slug = 'holding'
      )
      AND (${String(personId || "")} = '' OR cfi.person_id = ${String(personId || "")})
    ORDER BY cfi.person_id, fe.model_family, fe.model_version, fe.config_digest, fo.face_id
  `;
  return rows.map((row) => {
    const autoLowQuality = isLowQualityEvidence({
      detection: row.detection,
      facePixelHeight: row.face_pixel_height,
      facePixelWidth: row.face_pixel_width,
      quality: row.quality,
    });
    return {
      assetId: row.asset_id,
      autoLowQuality,
      blockedPrime: row.blocked_prime,
      configDigest: row.config_digest,
      currentBucketActorKind: row.current_bucket_actor_kind,
      currentBucketKind: row.current_bucket_kind,
      detection: row.detection,
      dimension: row.dimension,
      faceId: row.face_id,
      facePixelHeight: row.face_pixel_height,
      facePixelWidth: row.face_pixel_width,
      galleryPermission: row.gallery_permission,
      modelFamily: row.model_family,
      modelVersion: row.model_version,
      maxOtherPrimeSimilarity: row.max_other_prime_similarity,
      personId: row.person_id,
      pinnedPrime: row.pinned_prime,
      quality: row.quality,
      sourceTierHint:
        row.source_instance_suffix === "" ||
        row.source_instance_suffix === "blank"
          ? "prime"
          : row.source_instance_suffix === "1"
            ? "secondary"
            : row.source_instance_suffix === "2"
              ? "body_presence"
              : "unknown",
      userMainOverride: row.user_main_override === true,
      vector: parseVector(row.embedding),
    };
  });
};

export const buildPrimeCurations = (faces, options = {}) => {
  faces = applyBiometricAuthority(faces, options.biometricAuthority);
  const groups = new Map();
  const configsByPerson = new Map();
  for (const face of faces) {
    const config = [
      face.modelFamily,
      face.modelVersion,
      face.configDigest,
      face.dimension,
    ].join("\u001f");
    const configs = configsByPerson.get(face.personId) || new Set();
    configs.add(config);
    configsByPerson.set(face.personId, configs);
    const key = [face.personId, config].join("\u001f");
    const group = groups.get(key) || [];
    group.push(face);
    groups.set(key, group);
  }
  const ambiguous = [...configsByPerson]
    .filter(([, configs]) => configs.size > 1)
    .map(([personId]) => personId)
    .sort();
  if (ambiguous.length > 0) {
    throw new Error(
      `Prime curator refuses model-ambiguous People until galleries are model-scoped: ${ambiguous.join(", ")}`,
    );
  }
  return [...groups.values()].map((group) => {
    const automaticLowQuality = group.filter(
      (face) => face.autoLowQuality && !face.userMainOverride,
    );
    const hasGeneralAnchor = group.some(
      (face) =>
        !face.autoLowQuality &&
        !face.blockedPrime &&
        face.primeEligible !== false &&
        face.galleryPermission !== "never",
    );
    const automaticLowQualityFallback =
      !hasGeneralAnchor && automaticLowQuality.length > 0;
    // An all-LQ gallery still needs one retrieval foothold, but embedding
    // centrality is especially unreliable when every crop is noisy. Prefer
    // usable face pixels without allowing size to erase severe quality loss.
    // This is a temporary anchor, not a claim that the crop is Prime quality.
    const temporaryLowQualityAnchor = automaticLowQualityFallback
      ? [...automaticLowQuality].sort((left, right) => {
          const usablePixels = (face) =>
            Math.max(
              0,
              Math.min(
                Number(face.facePixelWidth) || 0,
                Number(face.facePixelHeight) || 0,
              ),
            );
          const score = (face) =>
            Math.min(1, usablePixels(face) / 80) * 0.55 +
            Math.max(0, Math.min(1, Number(face.quality) || 0)) * 0.3 +
            Math.max(0, Math.min(1, Number(face.detection) || 0)) * 0.15;
          return (
            score(right) - score(left) ||
            usablePixels(right) - usablePixels(left) ||
            Number(right.quality || 0) - Number(left.quality || 0) ||
            Number(right.detection || 0) - Number(left.detection || 0) ||
            left.faceId.localeCompare(right.faceId)
          );
        })[0]
      : undefined;
    const curatedGroup = group.map((face) => ({
      ...face,
      blockedPrime:
        face.blockedPrime ||
        ((hasGeneralAnchor ||
          (automaticLowQualityFallback &&
            face.faceId !== temporaryLowQualityAnchor?.faceId)) &&
          face.autoLowQuality &&
          !face.userMainOverride),
      galleryPermission:
        !hasGeneralAnchor && face.autoLowQuality && !face.userMainOverride
          ? "allowed"
          : face.galleryPermission,
      primeEligible:
        automaticLowQualityFallback &&
        face.autoLowQuality &&
        !face.userMainOverride
          ? face.faceId === temporaryLowQualityAnchor?.faceId
          : face.primeEligible,
      preservedPrime:
        automaticLowQualityFallback &&
        face.autoLowQuality &&
        !face.userMainOverride
          ? face.faceId === temporaryLowQualityAnchor?.faceId &&
            face.preservedPrime
          : face.preservedPrime,
    }));
    // When every usable observation is objectively low quality, Prime is only
    // a temporary retrieval foothold. Multiple weak faces can appear to add
    // coverage by explaining their own noise (or duplicate exports of one
    // photo), while pulling the prototype away from the least-noisy anchor.
    // Keep the remaining evidence available in LQ instead. Explicit user pins
    // are still all preserved by curatePrimeSet before this cap is applied.
    const selection = curatePrimeSet(
      curatedGroup,
      automaticLowQualityFallback
        ? { ...options, maxPrime: 1, minPrime: 1 }
        : options,
    );
    const selectedIds = new Set(selection.selected.map((face) => face.faceId));
    return {
      configDigest: group[0].configDigest,
      dimension: group[0].dimension,
      lowQualityFaces: automaticLowQuality.filter(
        (face) => !selectedIds.has(face.faceId),
      ),
      modelFamily: group[0].modelFamily,
      modelVersion: group[0].modelVersion,
      personId: group[0].personId,
      ...selection,
    };
  });
};

export const mainMembershipsToRemoveBeforePrime = (memberships = []) => {
  const active = memberships.filter(
    (membership) => membership.membership_state === "active",
  );
  const head = active.find((membership) => membership.bucket_kind === "head");
  if (head) {
    throw new Error(
      `Prime curator refuses to promote ${head.face_id || "a face"} while Head evidence is active`,
    );
  }
  return active.filter((membership) =>
    ["secondary", "lq"].includes(membership.bucket_kind),
  );
};

export const applyPrimeCurations = async (
  sql,
  curations,
  { execute = false } = {},
) => {
  const summary = {
    activated: 0,
    demoted: 0,
    lowQualityRouted: 0,
    people: curations.length,
    prototypesChanged: 0,
    selected: curations.reduce((total, row) => total + row.selected.length, 0),
  };
  if (!execute) {
    return summary;
  }

  await sql.begin(async (tx) => {
    const now = new Date();
    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, privacy_class
      ) VALUES (
        ${receiptId}, 'system', 'cimmich-prime-biometric-curator', 'v1',
        ${now}, ${now}, 'private'
      ) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at
    `;

    for (const curation of curations) {
      // A newly split Person has identity evidence before it has ever had a
      // biometric gallery. Establish the two main buckets here so every
      // curator caller gets the same invariant, including post-command
      // refreshes that run after the identity transaction commits.
      for (const bucketKind of ["prime", "secondary", "lq"]) {
        await tx`
          INSERT INTO reference_bucket (
            bucket_id, person_id, bucket_kind, name, activation_hints,
            created_by, policy_version, state, producer_receipt_id, privacy_class
          ) VALUES (
            ${`bucket_${randomUUID().replaceAll("-", "")}`}, ${curation.personId}, ${bucketKind}, NULL, NULL,
            'system', ${bucketKind === "lq" ? lowQualityPolicyVersion : policyVersion}, 'active', ${receiptId}, 'sensitive-biometric'
          ) ON CONFLICT DO NOTHING
        `;
      }
      const [buckets] = await tx`
        SELECT
          max(bucket_id) FILTER (WHERE bucket_kind = 'prime') AS prime_bucket_id,
          max(bucket_id) FILTER (WHERE bucket_kind = 'secondary') AS secondary_bucket_id,
          max(bucket_id) FILTER (WHERE bucket_kind = 'lq') AS lq_bucket_id
        FROM reference_bucket
        WHERE person_id = ${curation.personId} AND state = 'active' AND bucket_kind IN ('prime','secondary','lq')
      `;
      if (
        !buckets?.prime_bucket_id ||
        !buckets?.secondary_bucket_id ||
        !buckets?.lq_bucket_id
      ) {
        throw new Error(
          `Prime/Secondary/LQ buckets could not be established for ${curation.personId}`,
        );
      }
      const current = await tx`
        SELECT bucket_id, bucket_kind, face_id, actor_kind, latest_action, membership_state
        FROM current_reference_gallery
        WHERE person_id = ${curation.personId} AND bucket_kind IN ('prime','secondary','lq','head')
      `;
      const currentByFace = new Map();
      for (const row of current) {
        const rows = currentByFace.get(row.face_id) || [];
        rows.push(row);
        currentByFace.set(row.face_id, rows);
      }
      const selectedIds = new Set(curation.selected.map((face) => face.faceId));
      const lowQualityIds = new Set(
        (curation.lowQualityFaces || []).map((face) => face.faceId),
      );

      for (const face of curation.lowQualityFaces || []) {
        const memberships = currentByFace.get(face.faceId) || [];
        if (
          memberships.some(
            (row) =>
              row.bucket_kind === "lq" && row.membership_state === "active",
          )
        ) {
          continue;
        }
        for (const row of memberships.filter(
          (membership) =>
            ["prime", "secondary"].includes(membership.bucket_kind) &&
            membership.membership_state === "active",
        )) {
          await tx`
            INSERT INTO bucket_membership_event (
              membership_event_id, bucket_id, face_id, action, actor_kind, reason_code,
              reason_text, policy_version, producer_receipt_id, privacy_class
            ) VALUES (
              ${eventId()}, ${row.bucket_id}, ${face.faceId}, 'remove', 'policy',
              'low_quality_condition_router', 'Moved out of general matching evidence', ${lowQualityPolicyVersion},
              ${receiptId}, 'sensitive-biometric'
            )
          `;
        }
        await tx`
          INSERT INTO bucket_membership_event (
            membership_event_id, bucket_id, face_id, action, actor_kind, reason_code,
            reason_text, policy_version, score_snapshot, producer_receipt_id, privacy_class
          ) VALUES (
            ${eventId()}, ${buckets.lq_bucket_id}, ${face.faceId}, 'activate', 'policy',
            'low_quality_condition_router', 'Retained for low-quality query matching only', ${lowQualityPolicyVersion},
            ${tx.json({ detection: face.detection, face_pixel_height: face.facePixelHeight, face_pixel_width: face.facePixelWidth, quality: face.quality })},
            ${receiptId}, 'sensitive-biometric'
          )
        `;
        summary.lowQualityRouted += 1;
      }

      for (const face of curation.selected) {
        const memberships = currentByFace.get(face.faceId) || [];
        const prime = memberships.find(
          (row) =>
            row.bucket_kind === "prime" && row.membership_state === "active",
        );
        if (prime) {
          continue;
        }
        // LQ is a main tier too. A corrected embedding can make a previously
        // policy-routed LQ face become the best available temporary anchor, so
        // retire every movable main-tier membership before activating Prime.
        // Head remains an explicit review classification and fails closed.
        for (const prior of mainMembershipsToRemoveBeforePrime(memberships)) {
          await tx`
            INSERT INTO bucket_membership_event (
              membership_event_id, bucket_id, face_id, action, actor_kind, reason_code,
              reason_text, policy_version, score_snapshot, producer_receipt_id, privacy_class
            ) VALUES (
              ${eventId()}, ${prior.bucket_id}, ${face.faceId}, 'remove', 'policy',
              'prime_biometric_curator', 'Promoted into the clean biometric gallery', ${policyVersion},
              ${tx.json({ clean_score: face.cleanScore, coverage_gain: face.coverageGain, reason: face.reason })},
              ${receiptId}, 'sensitive-biometric'
            )
          `;
        }
        await tx`
          INSERT INTO bucket_membership_event (
            membership_event_id, bucket_id, face_id, action, actor_kind, reason_code,
            reason_text, policy_version, score_snapshot, producer_receipt_id, privacy_class
          ) VALUES (
            ${eventId()}, ${buckets.prime_bucket_id}, ${face.faceId}, 'activate', 'policy',
            'prime_biometric_curator', 'Selected for matching coverage and prototype purity', ${policyVersion},
            ${tx.json({ centrality: face.centrality, clean_score: face.cleanScore, coverage_gain: face.coverageGain, reason: face.reason })},
            ${receiptId}, 'sensitive-biometric'
          )
        `;
        summary.activated += 1;
      }

      for (const row of current.filter(
        (membership) =>
          membership.bucket_kind === "prime" &&
          membership.membership_state === "active" &&
          !selectedIds.has(membership.face_id) &&
          !(
            membership.actor_kind === "user" &&
            membership.latest_action === "pin"
          ),
      )) {
        await tx`
          INSERT INTO bucket_membership_event (
            membership_event_id, bucket_id, face_id, action, actor_kind, reason_code,
            reason_text, policy_version, producer_receipt_id, privacy_class
          ) VALUES (
            ${eventId()}, ${row.bucket_id}, ${row.face_id}, 'demote', 'policy',
            'prime_biometric_curator', 'Excluded from the clean biometric prototype', ${policyVersion},
            ${receiptId}, 'sensitive-biometric'
          )
        `;
        const secondary = (currentByFace.get(row.face_id) || []).find(
          (membership) =>
            membership.bucket_kind === "secondary" &&
            membership.membership_state === "active",
        );
        if (!secondary && !lowQualityIds.has(row.face_id)) {
          await tx`
            INSERT INTO bucket_membership_event (
              membership_event_id, bucket_id, face_id, action, actor_kind, reason_code,
              reason_text, policy_version, producer_receipt_id, privacy_class
            ) VALUES (
              ${eventId()}, ${buckets.secondary_bucket_id}, ${row.face_id}, 'activate', 'policy',
              'prime_biometric_curator', 'Retained as controlled secondary evidence', ${policyVersion},
              ${receiptId}, 'sensitive-biometric'
            )
          `;
        }
        summary.demoted += 1;
      }

      if (!curation.prototype || curation.selected.length === 0) {
        const [currentPrototype] = await tx`
          SELECT prototype_id
          FROM current_reference_prototype
          WHERE bucket_id = ${buckets.prime_bucket_id}
            AND model_family = ${curation.modelFamily}
            AND model_version = ${curation.modelVersion}
            AND config_digest = ${curation.configDigest}
          LIMIT 1
          FOR UPDATE
        `;
        if (currentPrototype) {
          await tx`UPDATE reference_prototype SET state = 'retired' WHERE prototype_id = ${currentPrototype.prototype_id}`;
          summary.prototypesChanged += 1;
        }
        continue;
      }

      const memberFaceIds = curation.selected.map((face) => face.faceId).sort();
      const nextPrototypeId = prototypeId(curation, memberFaceIds);
      const [currentPrototype] = await tx`
        SELECT prototype_id, member_face_ids
        FROM current_reference_prototype
        WHERE bucket_id = ${buckets.prime_bucket_id}
          AND model_family = ${curation.modelFamily}
          AND model_version = ${curation.modelVersion}
          AND config_digest = ${curation.configDigest}
        LIMIT 1
        FOR UPDATE
      `;
      if (currentPrototype?.prototype_id === nextPrototypeId) {
        continue;
      }
      if (currentPrototype) {
        await tx`UPDATE reference_prototype SET state = 'superseded' WHERE prototype_id = ${currentPrototype.prototype_id}`;
      }
      await tx`
        INSERT INTO reference_prototype (
          prototype_id, person_id, bucket_id, model_family, model_version, config_digest,
          dimension, normalized, embedding, member_face_ids, member_count, selection_metrics,
          policy_version, state, supersedes_prototype_id, producer_receipt_id, privacy_class
        ) VALUES (
          ${nextPrototypeId}, ${curation.personId}, ${buckets.prime_bucket_id}, ${curation.modelFamily},
          ${curation.modelVersion}, ${curation.configDigest}, ${curation.dimension}, true,
          ${vectorText(curation.prototype)}::vector, ${memberFaceIds}, ${memberFaceIds.length},
          ${tx.json(curation.metrics)}, ${policyVersion}, 'active', ${currentPrototype?.prototype_id || null},
          ${receiptId}, 'sensitive-biometric'
        )
      `;
      summary.prototypesChanged += 1;
    }
  });
  return summary;
};

export { policyVersion as primeCuratorPolicyVersion };
