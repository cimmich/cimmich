import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationSettingsPack,
  integrationSettingsSchemaVersion,
} from "../src/integration-settings.mjs";

test("integration settings publish contracts and links without bundling a model", () => {
  const pack = integrationSettingsPack();
  assert.equal(pack.schemaVersion, integrationSettingsSchemaVersion);
  assert.equal(pack.bodyDetection.bundledModels, false);
  assert.equal(pack.bodyDetection.evidenceIntake.replayRunsRequired, 2);
  assert.equal(pack.bodyDetection.examples[0].testedSettings.imageSize, 640);
  assert.equal(pack.faceRecognition.bundledModels, false);
  assert.equal(
    pack.faceRecognition.examples[0].adapter,
    "opencv-yunet-sface-cpu",
  );
  assert.equal(
    pack.faceRecognition.examples[0].testedSettings.detectorThreshold,
    0.8,
  );
  assert.equal(pack.faceRecognition.examples[0].models.length, 2);
  assert.equal(
    pack.faceRecognition.evidenceLifecycle.activation,
    "operator_reviewed_passed_source_pack_only",
  );
  assert.equal(
    pack.faceRecognition.evidenceLifecycle.operatorApi.status,
    "GET /v1/operator/face-matching",
  );
  assert.equal(
    pack.faceRecognition.evidenceLifecycle.operatorApi.recognition,
    "POST /v1/operator/face-matching/recognition",
  );
  assert.equal(
    pack.faceRecognition.enablement.basicIdentityTruthRetainedWhenDisabled,
    true,
  );
  assert.equal(pack.policy.modelArtifactsInRepository, false);
  assert.equal(pack.policy.cimmichSelectsProvider, false);
  assert.match(pack.bodyDetection.examples[0].modelSource, /^https:\/\//);
  const workstationPathPrefix = ["", "Users", ""].join("/");
  assert.equal(JSON.stringify(pack).includes(workstationPathPrefix), false);
  assert.equal(JSON.stringify(pack).includes("checkpoint"), false);
});

test("callers receive independent settings objects", () => {
  const first = integrationSettingsPack();
  first.bodyDetection.examples[0].adapter = "changed";
  assert.equal(
    integrationSettingsPack().bodyDetection.examples[0].adapter,
    "ultralytics-yolo-body",
  );
});
