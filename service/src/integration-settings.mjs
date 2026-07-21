export const integrationSettingsSchemaVersion =
  "cimmich.integration-settings.v1";

const providerPack = Object.freeze({
  bodyDetection: {
    accepts: "cimmich.body-detection-result.v1",
    adapterContract: "cimmich.body-detector.v1",
    automaticIdentityAuthority: "none",
    bundledModels: false,
    conformance: "two_canonical_runs_required",
    evidenceIntake: {
      commitContract: "cimmich.body-detection-operator-receipt.v1",
      operatorEntrypoint: "service/bin/body-detection-operator.mjs",
      providerOutputIsIdentityTruth: false,
      replayRunsRequired: 2,
    },
    examples: [
      {
        adapter: "ultralytics-yolo-body",
        licence: "AGPL-3.0_or_separate_upstream_terms",
        modelSource: "https://docs.ultralytics.com/models/yolo11/",
        providerSource: "https://github.com/ultralytics/ultralytics",
        role: "optional_example",
        testedSettings: {
          device: "cpu",
          imageSize: 640,
          maximumRuntimeMs: 120000,
          modelId: "yolo11n",
          threshold: 0.3,
        },
      },
      {
        adapter: "custom-provider",
        licence: "operator_declared",
        modelSource: null,
        providerSource: null,
        role: "contract_compatible",
        testedSettings: null,
      },
    ],
    modelAcquisition: "operator_or_connected_client",
    sourceMedia: "local_read_only",
  },
  faceRecognition: {
    accepts: "cimmich.recognition-result.v1",
    adapterContract: "cimmich.recognition-provider.v1",
    automaticIdentityAuthority: "none",
    bundledModels: false,
    enablement: {
      basicIdentityTruthRetainedWhenDisabled: true,
      environment: {
        provider: "CIMMICH_LOCAL_MEDIA_PROVIDER",
        python: "CIMMICH_LOCAL_PYTHON_PATH",
        yunetModel: "CIMMICH_OPENCV_DETECTOR_MODEL_PATH",
        sfaceModel: "CIMMICH_OPENCV_RECOGNIZER_MODEL_PATH",
      },
      providerValue: "opencv-yunet-sface-cpu",
      stateEndpoint: "/v1/integrations/status",
    },
    evidenceLifecycle: {
      activation: "operator_reviewed_passed_source_pack_only",
      compileEntrypoint: "service/bin/compile-source-pack.mjs",
      evaluateEntrypoint: "service/bin/evaluate-source-pack.mjs",
      lifecycleEntrypoint: "service/bin/source-pack-lifecycle.mjs",
      matcher: "best_individual_prime",
      operatorApi: {
        activate:
          "POST /v1/operator/face-matching/source-packs/{packId}/activate",
        compile: "POST /v1/operator/face-matching/source-packs",
        evaluate:
          "POST /v1/operator/face-matching/source-packs/{packId}/evaluate",
        read: "GET /v1/operator/face-matching/source-packs/{packId}",
        recognition: "POST /v1/operator/face-matching/recognition",
        review: "POST /v1/operator/face-matching/source-packs/{packId}/review",
        rollback:
          "POST /v1/operator/face-matching/source-packs/{packId}/rollback",
        status: "GET /v1/operator/face-matching",
      },
      reviewPolicyThresholds: "human_reviewed_gate_receipt",
      suggestionAuthority: "review_only",
    },
    modelAcquisition: "operator_or_connected_client",
    examples: [
      {
        adapter: "opencv-yunet-sface-cpu",
        installEntrypoint: "providers/opencv-sface/install-models.sh",
        licenceNotes: "providers/opencv-sface/THIRD_PARTY.md",
        models: [
          {
            id: "yunet-2023mar",
            licence: "MIT",
            sha256:
              "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
            source:
              "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
          },
          {
            id: "sface-2021dec",
            licence: "Apache-2.0",
            sha256:
              "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
            source:
              "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
          },
        ],
        modelSource:
          "https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface",
        providerSource: "https://github.com/opencv/opencv_zoo",
        role: "optional_example",
        testedSettings: {
          detectorInput: [320, 320],
          detectorThreshold: 0.8,
          device: "cpu",
          embeddingDimension: 128,
          metric: "cosine",
          normalized: true,
          opencv: "4.11.x",
          threads: 1,
        },
      },
      {
        adapter: "custom-provider",
        modelSource: null,
        providerSource: null,
        role: "contract_compatible",
      },
    ],
  },
  policy: {
    cimmichDownloadsModelsAutomatically: false,
    cimmichSelectsProvider: false,
    modelArtifactsInRepository: false,
    operatorOwnsLicenceAndDisclosureDecision: true,
    statement:
      "Cimmich publishes governed evidence contracts and tested settings. The operator or connected client obtains model artifacts from their chosen official source.",
  },
  schemaVersion: integrationSettingsSchemaVersion,
});

export const integrationSettingsPack = () => structuredClone(providerPack);
