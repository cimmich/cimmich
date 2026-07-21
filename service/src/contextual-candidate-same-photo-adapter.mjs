import { recognitionDigest } from "./recognition-provider-contract.mjs";
import {
  projectValidatedCandidateSamePhotoEvidence,
  projectValidatedVisualCandidateSet,
} from "./visual-candidate-set.mjs";

export const contextualCandidateSamePhotoAdapterSchemaVersion =
  "cimmich.contextual-candidate-same-photo-adapter.v1";

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "CONTEXTUAL_CANDIDATE_SAME_PHOTO_ADAPTER_INVALID",
    statusCode: 400,
  });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

export const adaptCandidateSamePhotoEvidence = (input) => {
  if (
    input == null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, "candidateEnvelope") ||
    !Object.hasOwn(input, "samePhotoEvidenceEnvelope")
  ) {
    throw typedError(
      "Adapter input must contain exact candidate and same-photo envelopes",
    );
  }
  const candidateEnvelope = projectValidatedVisualCandidateSet(
    input.candidateEnvelope,
  );
  const samePhotoEnvelope = projectValidatedCandidateSamePhotoEvidence(
    input.samePhotoEvidenceEnvelope,
  );
  if (
    candidateEnvelope.state !== "available" ||
    samePhotoEnvelope.binding.candidateSetDigest !==
      candidateEnvelope.candidateSetDigest ||
    samePhotoEnvelope.binding.queryRevisionDigest !==
      candidateEnvelope.binding.queryRevisionDigest ||
    samePhotoEnvelope.binding.queryToken !== candidateEnvelope.queryToken
  ) {
    throw typedError(
      "Same-photo evidence does not bind the exact visual candidate set",
    );
  }
  const candidateTokens = new Set(
    candidateEnvelope.candidates.map(({ candidateToken }) => candidateToken),
  );
  if (
    samePhotoEnvelope.evidence.some(
      ({ candidateToken }) => !candidateTokens.has(candidateToken),
    )
  ) {
    throw typedError("Same-photo evidence attempts to manufacture a candidate");
  }
  const evidenceByCandidate = new Map(
    samePhotoEnvelope.evidence.map((evidence) => [
      evidence.candidateToken,
      evidence,
    ]),
  );
  const candidates = candidateEnvelope.candidates.map((candidate) => ({
    candidateToken: candidate.candidateToken,
    samePhoto: evidenceByCandidate.get(candidate.candidateToken)?.samePhoto || {
      evidenceDigest: recognitionDigest({
        candidateToken: candidate.candidateToken,
        samePhotoReceiptDigest: samePhotoEnvelope.receiptDigest,
        state: "unknown",
      }),
      state: "unknown",
    },
    visualScore: candidate.visualScore,
  }));
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
      providerConfigDigest: candidateEnvelope.binding.providerConfigDigest,
      queryRevisionDigest: candidateEnvelope.binding.queryRevisionDigest,
      queryToken: candidateEnvelope.queryToken,
      samePhotoEvidenceReceiptDigest: samePhotoEnvelope.receiptDigest,
      vectorSpaceId: candidateEnvelope.binding.vectorSpaceId,
      visualPolicyDigest: candidateEnvelope.binding.visualPolicyDigest,
    },
    boundary: {
      candidateManufacture: "forbidden",
      identityDecision: "none",
      operationalUse: "none",
      samePhotoAuthority: "suppress_only",
    },
    candidates,
    nonRepresentative: true,
    operationalUse: "none",
    schemaVersion: contextualCandidateSamePhotoAdapterSchemaVersion,
  };
  return deepFreeze({ ...core, receiptDigest: recognitionDigest(core) });
};

export const contextualCandidateSamePhotoAdapterContractDigest =
  recognitionDigest({
    schemaVersion: contextualCandidateSamePhotoAdapterSchemaVersion,
  });
