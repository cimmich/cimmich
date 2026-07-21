import { recognitionDigest } from "./recognition-provider-contract.mjs";
import {
  projectValidatedCandidateBodyEvidence,
  projectValidatedVisualCandidateSet,
} from "./visual-candidate-set.mjs";

export const contextualCandidateBodyAdapterSchemaVersion =
  "cimmich.contextual-candidate-body-adapter.v1";

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "CONTEXTUAL_CANDIDATE_BODY_ADAPTER_INVALID",
    statusCode: 400,
  });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const adaptCandidateBodyEvidence = (input) => {
  if (
    input == null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, "bodyEvidenceEnvelope") ||
    !Object.hasOwn(input, "candidateEnvelope")
  ) {
    throw typedError(
      "Adapter input must contain exact candidate and Body envelopes",
    );
  }
  const candidateEnvelope = projectValidatedVisualCandidateSet(
    input.candidateEnvelope,
  );
  const bodyEnvelope = projectValidatedCandidateBodyEvidence(
    input.bodyEvidenceEnvelope,
  );
  if (
    candidateEnvelope.state !== "available" ||
    bodyEnvelope.binding.candidateSetDigest !==
      candidateEnvelope.candidateSetDigest ||
    bodyEnvelope.binding.queryToken !== candidateEnvelope.queryToken
  ) {
    throw typedError(
      "Body evidence does not bind the exact visual candidate set",
    );
  }
  const candidateTokens = new Set(
    candidateEnvelope.candidates.map(({ candidateToken }) => candidateToken),
  );
  if (
    bodyEnvelope.evidence.some(
      ({ candidateToken }) => !candidateTokens.has(candidateToken),
    )
  ) {
    throw typedError("Body evidence attempts to manufacture a candidate");
  }
  const evidenceByCandidate = new Map(
    bodyEnvelope.evidence.map((evidence) => [
      evidence.candidateToken,
      evidence,
    ]),
  );
  const fallbackState =
    bodyEnvelope.state === "ambiguous"
      ? "ambiguous"
      : bodyEnvelope.state === "unsupported"
        ? "unsupported"
        : "unavailable";
  const candidates = candidateEnvelope.candidates.map((candidate) => {
    const evidence = evidenceByCandidate.get(candidate.candidateToken);
    return {
      bodyContinuity: evidence
        ? {
            evidenceDigest: evidence.evidenceDigest,
            margin: evidence.margin,
            score: evidence.score,
            state: "supported",
          }
        : {
            evidenceDigest: recognitionDigest({
              bodyReceiptDigest: bodyEnvelope.receiptDigest,
              candidateToken: candidate.candidateToken,
              state: fallbackState,
            }),
            margin: 0,
            score: 0,
            state: fallbackState,
          },
      candidateToken: candidate.candidateToken,
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
      bodyEvidenceReceiptDigest: bodyEnvelope.receiptDigest,
      candidateSetDigest: candidateEnvelope.candidateSetDigest,
      providerConfigDigest: candidateEnvelope.binding.providerConfigDigest,
      queryToken: candidateEnvelope.queryToken,
      vectorSpaceId: candidateEnvelope.binding.vectorSpaceId,
      visualPolicyDigest: candidateEnvelope.binding.visualPolicyDigest,
    },
    boundary: {
      candidateManufacture: "forbidden",
      identityDecision: "none",
      operationalUse: "none",
    },
    candidates,
    nonRepresentative: true,
    operationalUse: "none",
    schemaVersion: contextualCandidateBodyAdapterSchemaVersion,
  };
  return deepFreeze({ ...core, receiptDigest: recognitionDigest(core) });
};

export const contextualCandidateBodyAdapterContractDigest = recognitionDigest({
  schemaVersion: contextualCandidateBodyAdapterSchemaVersion,
});
