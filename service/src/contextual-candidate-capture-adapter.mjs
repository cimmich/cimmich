import { recognitionDigest } from "./recognition-provider-contract.mjs";
import {
  projectValidatedCandidateCaptureEvidence,
  projectValidatedVisualCandidateSet,
} from "./visual-candidate-set.mjs";

export const contextualCandidateCaptureAdapterSchemaVersion =
  "cimmich.contextual-candidate-capture-adapter.v1";

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "CONTEXTUAL_CANDIDATE_CAPTURE_ADAPTER_INVALID",
    statusCode: 400,
  });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const adaptCandidateCaptureEvidence = (input) => {
  if (
    input == null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, "candidateEnvelope") ||
    !Object.hasOwn(input, "captureEvidenceEnvelope")
  ) {
    throw typedError(
      "Adapter input must contain exact candidate and capture envelopes",
    );
  }
  const candidateEnvelope = projectValidatedVisualCandidateSet(
    input.candidateEnvelope,
  );
  const captureEnvelope = projectValidatedCandidateCaptureEvidence(
    input.captureEvidenceEnvelope,
  );
  if (
    candidateEnvelope.state !== "available" ||
    captureEnvelope.binding.candidateSetDigest !==
      candidateEnvelope.candidateSetDigest ||
    captureEnvelope.binding.queryRevisionDigest !==
      candidateEnvelope.binding.queryRevisionDigest ||
    captureEnvelope.binding.queryToken !== candidateEnvelope.queryToken
  ) {
    throw typedError(
      "Capture evidence does not bind the exact visual candidate set",
    );
  }
  const candidateTokens = new Set(
    candidateEnvelope.candidates.map(({ candidateToken }) => candidateToken),
  );
  if (
    captureEnvelope.evidence.some(
      ({ candidateToken }) => !candidateTokens.has(candidateToken),
    )
  ) {
    throw typedError("Capture evidence attempts to manufacture a candidate");
  }
  const evidenceByCandidate = new Map(
    captureEnvelope.evidence.map((evidence) => [
      evidence.candidateToken,
      evidence,
    ]),
  );
  const candidates = candidateEnvelope.candidates.map((candidate) => {
    const evidence = evidenceByCandidate.get(candidate.candidateToken);
    if (evidence) {
      return {
        ambiguity: {
          evidenceDigest: recognitionDigest({
            candidateToken: candidate.candidateToken,
            captureReceiptDigest: captureEnvelope.receiptDigest,
            family: "ambiguity",
            state: "none",
          }),
          state: "none",
        },
        candidateToken: candidate.candidateToken,
        captureContext: evidence.captureContext,
        metadata: evidence.metadata,
        visualScore: candidate.visualScore,
      };
    }
    return {
      ambiguity: {
        evidenceDigest: recognitionDigest({
          candidateToken: candidate.candidateToken,
          captureReceiptDigest: captureEnvelope.receiptDigest,
          family: "ambiguity",
          state: captureEnvelope.state,
        }),
        state:
          captureEnvelope.state === "ambiguous" ? "capture_context" : "none",
      },
      candidateToken: candidate.candidateToken,
      captureContext: {
        coappearance: "unavailable",
        confidence: 0,
        contextKind: "none",
        evidenceDigest: recognitionDigest({
          candidateToken: candidate.candidateToken,
          captureReceiptDigest: captureEnvelope.receiptDigest,
          family: "capture",
          state: captureEnvelope.state,
        }),
        reliability: "unavailable",
        state: "unavailable",
        time: "unavailable",
      },
      metadata: {
        errorSeconds: 0,
        evidenceDigest: recognitionDigest({
          candidateToken: candidate.candidateToken,
          captureReceiptDigest: captureEnvelope.receiptDigest,
          family: "metadata",
          state: captureEnvelope.state,
        }),
        reliability: "unavailable",
      },
      visualScore: candidate.visualScore,
    };
  });
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "none",
      training: "none",
    },
    baseline: candidateEnvelope.baseline,
    binding: {
      candidateSetDigest: candidateEnvelope.candidateSetDigest,
      captureEvidenceReceiptDigest: captureEnvelope.receiptDigest,
      providerConfigDigest: candidateEnvelope.binding.providerConfigDigest,
      queryRevisionDigest: candidateEnvelope.binding.queryRevisionDigest,
      queryToken: candidateEnvelope.queryToken,
      vectorSpaceId: candidateEnvelope.binding.vectorSpaceId,
      visualPolicyDigest: candidateEnvelope.binding.visualPolicyDigest,
    },
    boundary: {
      candidateManufacture: "forbidden",
      captureContextIdentityAuthority: "none",
      identityDecision: "none",
      operationalUse: "none",
    },
    candidates,
    nonRepresentative: true,
    operationalUse: "none",
    schemaVersion: contextualCandidateCaptureAdapterSchemaVersion,
  };
  return deepFreeze({ ...core, receiptDigest: recognitionDigest(core) });
};

export const contextualCandidateCaptureAdapterContractDigest =
  recognitionDigest({
    schemaVersion: contextualCandidateCaptureAdapterSchemaVersion,
  });
