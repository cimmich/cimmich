import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyDetectionDigest,
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import {
  bodyDetectionResultRepositoryVersion,
  createBodyDetectionResultRepository,
  deriveRepositoryBodyAssetToken,
} from "../src/body-detection-result-repository.mjs";
import {
  completeAssetSourceRead,
  createAssetSourceRevisionRepository,
} from "../src/asset-source-revision.mjs";

const digest = (character) => character.repeat(64);
const assetId = "asset-body-result-fixture";

const manifest = () => {
  const value = {
    detector: {
      artifactDigest: digest("a"),
      modelId: "synthetic-body-detector",
      modelVersionId: "v1",
      scoreThreshold: 0.5,
    },
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      inputHeight: 640,
      inputWidth: 640,
      resizeMode: "letterbox",
    },
    privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
    provider: { providerId: "synthetic-provider", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
    schemaVersion: bodyDetectorSchemaVersion,
  };
  return {
    ...value,
    detectorConfigDigest: deriveBodyDetectorConfigDigest(value),
  };
};

const validation = ({
  inputRevision = digest("b"),
  sourceContentDigest = digest("c"),
} = {}) => {
  const provider = manifest();
  return validateBodyDetectionResult(
    {
      assetToken: deriveRepositoryBodyAssetToken({
        assetId,
        detectorConfigDigest: provider.detectorConfigDigest,
        inputRevision,
      }),
      bodies: [
        {
          box: { h: 0.8, w: 0.4, x: 0.1, y: 0.1 },
          confidence: 0.9,
          quality: { occlusion: 0.1, visibility: 0.95 },
        },
      ],
      detectorConfigDigest: provider.detectorConfigDigest,
      inputRevision,
      schemaVersion: bodyDetectionResultSchemaVersion,
      sourceContentDigest,
      state: "bodies_detected",
    },
    provider,
  );
};

const sourceDatabase = () => {
  const statements = [];
  let head = null;
  const revisions = new Map();
  const query = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push({ statement, values });
    if (statement.includes("LEFT JOIN asset_source_revision_head")) {
      return [{ asset_id: assetId, revision_id: head }];
    }
    if (statement.includes("SELECT asset_id FROM asset")) {
      return [{ asset_id: assetId }];
    }
    if (
      statement.includes("SELECT revision_id FROM asset_source_revision_head")
    ) {
      return head ? [{ revision_id: head }] : [];
    }
    if (statement.includes("INSERT INTO asset_source_revision (")) {
      revisions.set(values[0], {
        asset_id: values[1],
        source_access: values[2],
        source_binding_digest: values[3],
        input_revision: values[4],
        source_content_digest: values[5],
        byte_length: values[6],
      });
      return [];
    }
    if (statement.includes("FROM asset_source_revision WHERE revision_id")) {
      return [revisions.get(values[0])];
    }
    if (statement.includes("INSERT INTO asset_source_revision_head")) {
      head = values[3];
      return [];
    }
    if (statement.includes("FROM body_detection_result\n")) return [];
    if (statement.includes("FROM body_observation")) return [];
    return [];
  };
  query.json = (value) => value;
  const sql = Object.assign(query, {
    begin: async (handler) => handler(query),
  });
  return {
    bodyRepository: createBodyDetectionResultRepository(sql, {
      presentationRank: () => 0,
    }),
    head: () => head,
    sourceRepository: createAssetSourceRevisionRepository(sql, {
      presentationRank: () => 0,
    }),
    statements,
  };
};

const database = ({ current = true, existing = [] } = {}) => {
  const statements = [];
  const tx = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push({ statement, values });
    if (statement.includes("SELECT projection.input_revision")) {
      return current ? [{ input_revision: digest("b") }] : [];
    }
    if (statement.includes("FROM body_detection_result\n")) return existing;
    if (statement.includes("FROM body_observation")) return [];
    return [];
  };
  tx.json = (value) => value;
  const sql = Object.assign(async () => [], {
    begin: async (handler) => handler(tx),
  });
  return {
    repository: createBodyDetectionResultRepository(sql, {
      presentationRank: () => 0,
    }),
    statements,
  };
};

test("exact validated Body result commits one minimized provenance receipt", async () => {
  const { repository, statements } = database();
  const receipt = await repository.commit({
    assetId,
    validation: validation(),
  });
  assert.equal(receipt.schemaVersion, bodyDetectionResultRepositoryVersion);
  assert.equal(receipt.changed, true);
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.bodyCount, 1);
  assert.equal(receipt.providerExecutionProof, "none");
  assert.equal(receipt.sourceMediaRead, "none");
  assert.equal(receipt.automaticIdentityAuthority, "none");
  assert.equal(
    statements.some(({ statement }) =>
      statement.includes("INSERT INTO body_detection_result_observation"),
    ),
    true,
  );
});

test("stale projection and crossed anonymous asset token fail before writes", async () => {
  const stale = database({ current: false });
  await assert.rejects(
    stale.repository.commit({ assetId, validation: validation() }),
    (error) => error.code === "BODY_DETECTION_RESULT_STALE",
  );
  assert.equal(
    stale.statements.some(({ statement }) => statement.includes("INSERT INTO")),
    false,
  );

  const crossed = validation();
  await assert.rejects(
    database().repository.commit({
      assetId: "asset-other",
      validation: crossed,
    }),
    (error) => error.code === "BODY_DETECTION_RESULT_ASSET_CONFLICT",
  );
});

test("copied validation cannot commit and exact replay writes nothing", async () => {
  const exact = validation();
  await assert.rejects(
    database().repository.commit({ assetId, validation: { ...exact } }),
  );
  const detectionResultId = `body_detection_${bodyDetectionDigest({
    assetId,
    detectorConfigDigest: exact.result.detectorConfigDigest,
    inputRevision: exact.result.inputRevision,
  }).slice(0, 40)}`;
  const replay = database({
    existing: [
      {
        body_count: 1,
        detection_result_id: detectionResultId,
        result_digest: exact.resultDigest,
      },
    ],
  });
  const receipt = await replay.repository.commit({
    assetId,
    validation: exact,
  });
  assert.equal(receipt.changed, false);
  assert.equal(receipt.replayed, true);
  assert.equal(receipt.repositoryWrites, "none");
});

test("validated local source revision commits atomically with its Body result", async () => {
  const database = sourceDatabase();
  const sourceRead = completeAssetSourceRead({
    bytes: Buffer.from("body source bytes"),
    prepared: await database.sourceRepository.prepare({
      assetId,
      sourceAccess: "operator_local_read_only",
      sourceBindingDigest: digest("e"),
    }),
  });
  const receipt = await database.bodyRepository.commit({
    assetId,
    sourceRead,
    validation: validation({
      inputRevision: sourceRead.inputRevision,
      sourceContentDigest: sourceRead.sourceContentDigest,
    }),
  });
  assert.equal(receipt.repositoryWrites, "source_revision_and_body_result");
  assert.equal(database.head(), sourceRead.revisionId);
  const resultInsert = database.statements.find(({ statement }) =>
    statement.includes("INSERT INTO body_detection_result ("),
  );
  assert.equal(resultInsert.values.at(-1), sourceRead.revisionId);
  assert.equal(
    database.statements.some(({ statement }) =>
      statement.includes("SELECT projection.input_revision"),
    ),
    false,
  );
  await assert.rejects(
    database.bodyRepository.commit({
      assetId,
      sourceRead: Object.freeze({ ...sourceRead }),
      validation: validation({
        inputRevision: sourceRead.inputRevision,
        sourceContentDigest: sourceRead.sourceContentDigest,
      }),
    }),
    (error) => error.code === "ASSET_SOURCE_REVISION_ENVELOPE_INVALID",
  );
});
