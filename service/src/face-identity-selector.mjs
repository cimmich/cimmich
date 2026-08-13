export const exactFaceIdentitySelector = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(
      new Error("A typed Face identity selector is required"),
      {
        code: "FACE_IDENTITY_SELECTOR_INVALID",
        statusCode: 400,
      },
    );
  }
  const allowed = new Set(["newPersonName", "personId", "personName"]);
  const keys = Object.keys(value);
  if (keys.length !== 1 || !allowed.has(keys[0])) {
    throw Object.assign(
      new Error(
        "Choose exactly one existing Person selector or one new Person name",
      ),
      {
        code: "FACE_IDENTITY_SELECTOR_INVALID",
        statusCode: 400,
      },
    );
  }
  return { [keys[0]]: value[keys[0]] };
};
