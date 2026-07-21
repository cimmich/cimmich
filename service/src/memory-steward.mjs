const localPlan = async (repository) => {
  // Match the UI's first-page request so simultaneous plan + review loads can
  // share one bounded repository snapshot without creating a second authority.
  const suggestions = await repository.machineSuggestions({ limit: 24 });
  const close = suggestions.filter(
    (item) => item.review_reason === "close_alternatives",
  );
  const focus = (close.length > 0 ? close : suggestions).slice(0, 3);
  const reviewHeadline =
    focus.length === 1
      ? "One useful check, then reassess"
      : focus.length === 2
        ? "Two useful checks, then reassess"
        : "Three useful checks, then reassess";
  return {
    caution:
      "You decide every identity. Cimmich will not apply this plan automatically.",
    focusFaceIds: focus.map((item) => item.face_id),
    focusPersonIds: [
      ...new Set(
        focus.flatMap((item) =>
          item.candidates.slice(0, 2).map((candidate) => candidate.person_id),
        ),
      ),
    ],
    headline:
      focus.length > 0 ? reviewHeadline : "No machine review is ready yet",
    mode: "local",
    model: null,
    nextAction:
      focus.length > 0
        ? "Compare the leading identity with the nearest alternative and accept only what is visually clear."
        : "Wait for new local evidence, then ask the Steward again.",
    notice: "",
    privacy:
      "The Memory Steward runs inside Cimmich and makes no outbound request. Connected Guided clients are separate and may disclose retrieved data under their operator's responsibility.",
    reasons: focus.map((item) =>
      item.review_reason === "close_alternatives"
        ? "Two identities are close enough that one human decision has high value."
        : item.review_reason === "weak_face"
          ? "The face is weak, so an explicit human check prevents noisy learning."
          : "The local matcher has a clear lead that should be quick to confirm.",
    ),
    summary:
      focus.length > 0
        ? "The local matcher selected a small review set instead of turning every detected face into a task."
        : "Cimmich is staying quiet because the local matching lane has not produced a useful review set.",
  };
};

export const createMemorySteward = ({ repository }) => ({
  async plan() {
    return localPlan(repository);
  },
});
