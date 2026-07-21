const inheritedKeys = ["LANG", "LC_ALL", "PATH", "TMPDIR"];

export const providerSubprocessEnvironment = (environment = process.env) => {
  const child = {
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
  };
  for (const key of inheritedKeys) {
    const value = String(environment[key] || "").trim();
    if (value) child[key] = value;
  }
  return child;
};
