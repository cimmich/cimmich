import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const enhancedComponentSchemaVersion =
  "cimmich.enhanced-component.v1";
export const enhancedCoreInterfaceVersion = "cimmich.core-enhanced.v1";
const receiptId = "receipt_cimmich_enhanced_component_v1";
const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
const typedError = (code, message, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const exactKeys = (value, keys, label) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) {
    throw typedError(
      "ENHANCED_ARTIFACT_INVALID",
      `${label} is not an exact supported object`,
    );
  }
};
const semverParts = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ""));
  if (!match) {
    throw typedError(
      "ENHANCED_ARTIFACT_INVALID",
      "Enhanced version is invalid",
    );
  }
  return match.slice(1).map(Number);
};
const compareVersions = (left, right) => {
  const a = semverParts(left);
  const b = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};
export const validateEnhancedArtifact = (raw, bytes) => {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > 65_536) {
    throw typedError(
      "ENHANCED_ARTIFACT_INVALID",
      "Enhanced artifact size is invalid",
    );
  }
  exactKeys(
    raw,
    [
      "authority",
      "component",
      "interfaceVersion",
      "matcherPolicy",
      "schemaVersion",
      "version",
    ],
    "artifact",
  );
  exactKeys(
    raw.authority,
    ["automaticIdentity", "sourcePackActivation", "training"],
    "authority",
  );
  exactKeys(
    raw.matcherPolicy,
    ["policyVersion", "scorer"],
    "matcherPolicy",
  );
  if (
    raw.schemaVersion !== "cimmich.enhanced-artifact.v1" ||
    raw.component !== "cimmich-enhanced" ||
    raw.interfaceVersion !== enhancedCoreInterfaceVersion ||
    raw.matcherPolicy.policyVersion !== "cimmich-best-prime-v1" ||
    raw.matcherPolicy.scorer !== "best_individual_prime" ||
    raw.authority.automaticIdentity !== "none" ||
    raw.authority.sourcePackActivation !==
      "governed_operator_review_only" ||
    raw.authority.training !== "none"
  ) {
    throw typedError(
      "ENHANCED_ARTIFACT_INCOMPATIBLE",
      "Enhanced artifact is not compatible with this Core interface",
      409,
    );
  }
  semverParts(raw.version);
  const artifactDigest = sha256(bytes);
  return Object.freeze({
    artifactDigest,
    componentVersion: raw.version,
    interfaceVersion: raw.interfaceVersion,
    matcherPolicyVersion: raw.matcherPolicy.policyVersion,
    scorer: raw.matcherPolicy.scorer,
  });
};

export const loadEnhancedArtifactCatalogue = async (directory) => {
  let names;
  try {
    names = (await readdir(directory))
      .filter((name) => /^cimmich-enhanced-\d+\.\d+\.\d+\.json$/.test(name))
      .sort();
  } catch {
    throw typedError(
      "ENHANCED_CATALOGUE_UNAVAILABLE",
      "Enhanced artifact catalogue is unavailable",
      503,
    );
  }
  const artifacts = [];
  for (const name of names.slice(0, 32)) {
    let bytes;
    try {
      bytes = await readFile(path.join(directory, name));
    } catch {
      throw typedError(
        "ENHANCED_CATALOGUE_UNAVAILABLE",
        "Enhanced artifact could not be read",
        503,
      );
    }
    let raw;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw typedError(
        "ENHANCED_ARTIFACT_INVALID",
        "Enhanced artifact JSON is invalid",
      );
    }
    artifacts.push(validateEnhancedArtifact(raw, bytes));
  }
  return artifacts.sort((a, b) =>
    compareVersions(a.componentVersion, b.componentVersion),
  );
};

const boundedId = (value, label) => {
  const result = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(result)) {
    throw typedError("ENHANCED_INPUT_INVALID", `${label} is invalid`);
  }
  return result;
};

export const createEnhancedComponent = ({
  artifactDirectory = fileURLToPath(new URL("../enhanced", import.meta.url)),
  sql,
}) => {
  const catalogue = () => loadEnhancedArtifactCatalogue(artifactDirectory);
  const project = (head, available) => {
    const active = available.find(
      (item) => item.artifactDigest === head?.artifact_digest,
    );
    const latest = available.at(-1) || null;
    return {
      schemaVersion: enhancedComponentSchemaVersion,
      coreAvailable: true,
      enabled: head?.enabled === true,
      state:
        head?.enabled !== true
          ? "disabled"
          : active
            ? "ready"
            : "incompatible",
      currentRevision: Number(head?.current_revision || 1),
      active: active
        ? {
            artifactDigest: active.artifactDigest,
            interfaceVersion: active.interfaceVersion,
            version: active.componentVersion,
          }
        : null,
      available: latest
        ? {
            artifactDigest: latest.artifactDigest,
            version: latest.componentVersion,
          }
        : null,
      updateAvailable:
        Boolean(active && latest) &&
        compareVersions(latest.componentVersion, active.componentVersion) > 0,
      rollbackAvailable: Boolean(head?.previous_release_id),
      authority: {
        automaticIdentity: "none",
        sourcePackActivation: "governed_operator_review_only",
        training: "none",
      },
    };
  };
  const status = async () => {
    const available = await catalogue();
    const [head] = await sql`
      SELECT head.enabled, head.current_revision, head.previous_release_id,
        release.artifact_digest
      FROM enhanced_component_head head
      LEFT JOIN enhanced_component_release release
        ON release.release_id = head.active_release_id
      WHERE head.singleton = true
    `;
    return project(head, available);
  };
  const isEnabled = async () => (await status()).state === "ready";
  const execute = async ({
    action: inputAction,
    actorId,
    commandId,
    expectedRevision,
    targetVersion = null,
  }) => {
    const action = String(inputAction || "");
    if (!["enable", "disable", "update", "rollback"].includes(action)) {
      throw typedError("ENHANCED_INPUT_INVALID", "Enhanced action is invalid");
    }
    const actor = boundedId(actorId, "actorId");
    const command = boundedId(commandId, "commandId");
    const revision = Number(expectedRevision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw typedError(
        "ENHANCED_INPUT_INVALID",
        "expectedRevision is invalid",
      );
    }
    if (targetVersion != null) semverParts(targetVersion);
    const requestDigest = sha256(
      JSON.stringify({ action, expectedRevision: revision, targetVersion }),
    );
    const available = await catalogue();
    return sql.begin(async (tx) => {
      const [replay] = await tx`
        SELECT actor_id, request_digest, response
        FROM enhanced_component_command WHERE command_id = ${command}
        FOR UPDATE
      `;
      if (replay) {
        if (
          replay.actor_id !== actor ||
          replay.request_digest !== requestDigest
        ) {
          throw typedError(
            "ENHANCED_COMMAND_CONFLICT",
            "commandId was already used for another Enhanced action",
            409,
          );
        }
        return { ...replay.response, replayed: true };
      }
      const [head] = await tx`
        SELECT * FROM enhanced_component_head WHERE singleton = true FOR UPDATE
      `;
      if (Number(head.current_revision) !== revision) {
        throw typedError(
          "ENHANCED_REVISION_STALE",
          "Enhanced state changed after it was read",
          409,
        );
      }
      let selected = null;
      let activeReleaseId = head.active_release_id;
      let previousReleaseId = head.previous_release_id;
      let enabled = head.enabled;
      if (action === "enable" || action === "update") {
        selected = targetVersion
          ? available.find((item) => item.componentVersion === targetVersion)
          : available.at(-1);
        if (!selected) {
          throw typedError(
            "ENHANCED_RELEASE_UNAVAILABLE",
            "Requested Enhanced release is unavailable",
            404,
          );
        }
        const [release] = await tx`
          INSERT INTO enhanced_component_release (
            release_id, component_version, interface_version, artifact_digest,
            matcher_policy_version, scorer, state, producer_receipt_id
          ) VALUES (
            ${`enhanced_release_${selected.artifactDigest}`},
            ${selected.componentVersion}, ${selected.interfaceVersion},
            ${selected.artifactDigest}, ${selected.matcherPolicyVersion},
            ${selected.scorer}, 'installed', ${receiptId}
          ) ON CONFLICT (artifact_digest) DO UPDATE SET
            component_version = excluded.component_version
          RETURNING release_id
        `;
        if (head.active_release_id === release.release_id && head.enabled) {
          enabled = true;
        } else {
          previousReleaseId =
            head.previous_release_id === release.release_id
              ? null
              : head.active_release_id;
          activeReleaseId = release.release_id;
          enabled = true;
        }
      } else if (action === "disable") {
        previousReleaseId = head.active_release_id || head.previous_release_id;
        activeReleaseId = null;
        enabled = false;
      } else {
        if (!head.previous_release_id) {
          throw typedError(
            "ENHANCED_ROLLBACK_UNAVAILABLE",
            "No previous Enhanced release is available",
            409,
          );
        }
        activeReleaseId = head.previous_release_id;
        previousReleaseId = head.active_release_id;
        enabled = true;
      }
      const [shadow] = await tx`
        SELECT count(*) FILTER (WHERE state = 'active')::int AS active_packs,
          count(*) FILTER (
            WHERE state = 'active' AND (
              evaluation_status <> 'passed'
              OR evaluation_summary->'matcherPolicy'->>'policyVersion'
                <> 'cimmich-best-prime-v1'
              OR evaluation_summary->'matcherPolicy'->>'scorer'
                <> 'best_individual_prime'
            )
          )::int AS incompatible_packs
        FROM source_pack
      `;
      if (enabled && Number(shadow.incompatible_packs) > 0) {
        throw typedError(
          "ENHANCED_SHADOW_REPLAY_FAILED",
          "Current SourcePack evidence is incompatible with this Enhanced release",
          409,
        );
      }
      const changed =
        enabled !== head.enabled ||
        activeReleaseId !== head.active_release_id ||
        previousReleaseId !== head.previous_release_id;
      const nextRevision = changed ? revision + 1 : revision;
      if (changed) {
        await tx`
          UPDATE enhanced_component_head SET
            enabled = ${enabled}, active_release_id = ${activeReleaseId},
            previous_release_id = ${previousReleaseId},
            current_revision = ${nextRevision}, updated_at = now()
          WHERE singleton = true
        `;
      }
      const [nextHead] = await tx`
        SELECT head.enabled, head.current_revision, head.previous_release_id,
          release.artifact_digest
        FROM enhanced_component_head head
        LEFT JOIN enhanced_component_release release
          ON release.release_id = head.active_release_id
        WHERE head.singleton = true
      `;
      const response = {
        ...project(nextHead, available),
        changed,
        commandId: command,
        replayed: false,
        shadowReplay: {
          compatible: true,
          identityTruthChanged: false,
          sourcePacksChecked: Number(shadow.active_packs || 0),
          sourcePackActivationPerformed: false,
        },
      };
      await tx`
        INSERT INTO enhanced_component_command (
          command_id, actor_id, action, request_digest, response,
          producer_receipt_id
        ) VALUES (
          ${command}, ${actor}, ${action}, ${requestDigest},
          ${tx.json(response)}, ${receiptId}
        )
      `;
      return response;
    });
  };
  return { execute, isEnabled, status };
};
