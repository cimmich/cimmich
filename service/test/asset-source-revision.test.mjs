import assert from "node:assert/strict";
import test from "node:test";
import {
  assetSourceRevisionReceiptSchemaVersion,
  commitValidatedAssetSourceRead,
  completeAssetSourceRead,
  createAssetSourceRevisionReceipt,
  createAssetSourceRevisionRepository,
} from "../src/asset-source-revision.mjs";

const digest = (character) => character.repeat(64);
const assetId = "asset-source-revision-fixture";

const harness = ({ currentRevisionId = null, visible = true } = {}) => {
  const statements = [];
  let head = currentRevisionId;
  const revisions = new Map();
  const query = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push({ statement, values });
    if (statement.includes("LEFT JOIN asset_source_revision_head")) {
      return visible ? [{ asset_id: assetId, revision_id: head }] : [];
    }
    if (statement.includes("SELECT asset_id FROM asset")) {
      return visible ? [{ asset_id: assetId }] : [];
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
      const row = revisions.get(values[0]);
      return row ? [row] : [];
    }
    if (statement.includes("INSERT INTO asset_source_revision_head")) {
      head = values[3];
      return [];
    }
    return [];
  };
  return {
    commit: (sourceRead) =>
      commitValidatedAssetSourceRead(query, {
        presentationRank: () => 0,
        sourceRead,
      }),
    head: () => head,
    repository: createAssetSourceRevisionRepository(query, {
      presentationRank: () => 0,
    }),
    setHead: (value) => {
      head = value;
    },
    statements,
  };
};

const prepareRead = async (state, bytes = Buffer.from("source bytes")) => {
  const prepared = await state.repository.prepare({
    assetId,
    sourceAccess: "operator_local_read_only",
    sourceBindingDigest: digest("a"),
  });
  return completeAssetSourceRead({ bytes, prepared });
};

test("validated bytes issue a minimized exact source-revision envelope", async () => {
  const state = harness();
  const read = await prepareRead(state);
  const receipt = createAssetSourceRevisionReceipt(read);
  assert.equal(receipt.schemaVersion, assetSourceRevisionReceiptSchemaVersion);
  assert.equal(
    receipt.boundary.currentStateMeaning,
    "current_at_last_validated_read",
  );
  assert.equal(receipt.boundary.mediaWrite, "none");
  assert.match(read.inputRevision, /^[0-9a-f]{64}$/);
  assert.match(read.revisionId, /^source_revision_[0-9a-f]{40}$/);
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /asset-source-revision-fixture|source bytes|sourceContentDigest|sourceBindingDigest/,
  );
  assert.throws(
    () => createAssetSourceRevisionReceipt(Object.freeze({ ...read })),
    (error) => error.code === "ASSET_SOURCE_REVISION_ENVELOPE_INVALID",
  );
});

test("commit advances one scoped head and exact replay is write-stable", async () => {
  const state = harness();
  const read = await prepareRead(state);
  await state.commit(read);
  assert.equal(state.head(), read.revisionId);
  const headWrites = () =>
    state.statements.filter(({ statement }) =>
      statement.includes("INSERT INTO asset_source_revision_head"),
    ).length;
  assert.equal(headWrites(), 1);
  await state.commit(read);
  assert.equal(headWrites(), 1);
});

test("changed bytes advance deterministically while stale heads fail closed", async () => {
  const state = harness();
  const first = await prepareRead(state, Buffer.from("first"));
  await state.commit(first);
  const second = await prepareRead(state, Buffer.from("second"));
  assert.notEqual(second.inputRevision, first.inputRevision);
  state.setHead("source_revision_" + "f".repeat(40));
  const insertsBefore = state.statements.filter(({ statement }) =>
    statement.includes("INSERT INTO"),
  ).length;
  await assert.rejects(
    state.commit(second),
    (error) => error.code === "ASSET_SOURCE_REVISION_STALE",
  );
  const insertsAfter = state.statements.filter(({ statement }) =>
    statement.includes("INSERT INTO"),
  ).length;
  assert.equal(insertsAfter, insertsBefore);
});

test("visibility, scalar bytes, copied preparation and open source kinds abstain", async () => {
  await assert.rejects(
    harness({ visible: false }).repository.prepare({
      assetId,
      sourceAccess: "operator_local_read_only",
      sourceBindingDigest: digest("a"),
    }),
    (error) => error.code === "ASSET_SOURCE_REVISION_UNAVAILABLE",
  );
  const state = harness();
  const prepared = await state.repository.prepare({
    assetId,
    sourceAccess: "operator_local_read_only",
    sourceBindingDigest: digest("a"),
  });
  assert.throws(
    () =>
      completeAssetSourceRead({
        bytes: Buffer.from("x"),
        prepared: Object.freeze({ ...prepared }),
      }),
    (error) => error.code === "ASSET_SOURCE_REVISION_ENVELOPE_INVALID",
  );
  assert.throws(
    () => completeAssetSourceRead({ bytes: "not-bytes", prepared }),
    (error) => error.code === "ASSET_SOURCE_REVISION_INPUT_INVALID",
  );
  await assert.rejects(
    state.repository.prepare({
      assetId,
      sourceAccess: "network",
      sourceBindingDigest: digest("a"),
    }),
    (error) => error.code === "ASSET_SOURCE_REVISION_INPUT_INVALID",
  );
});
