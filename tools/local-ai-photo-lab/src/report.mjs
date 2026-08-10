const count = (value) => (Array.isArray(value) ? value.length : 0);

const operationLine = (label, result, noun) => {
  if (!result) return `- ${label}: not run`;
  const observations = result[noun];
  const reviewCount = Array.isArray(observations)
    ? observations.filter((item) => item.quality?.reviewReasons?.length).length
    : 0;
  return `- ${label}: ${result.state}${Array.isArray(observations) ? ` (${observations.length}${reviewCount ? `; ${reviewCount} review` : ""})` : ""}${Number.isInteger(result.durationMs) ? ` · ${result.durationMs} ms` : ""}`;
};

const safeCell = (value) =>
  String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

export const renderReport = ({ result, diff }) => {
  const lines = [
    `# Local AI photo lab — ${result.set.setId}`,
    "",
    `Run \`${result.runId}\` completed with state **${result.state}**.`,
    "",
    `- Ordered scope: ${result.assets.length} explicit photo${result.assets.length === 1 ? "" : "s"}`,
    `- Requested operations: ${result.requestedOperations.join(", ")}`,
    `- Executed operations: ${result.executedOperations.join(", ")}`,
    `- Originals unchanged: ${result.originalsUnchanged ? "yes" : "NO"}`,
    `- Previous run: ${diff.previousRunId ?? "none"}`,
    "",
    "## Set summary proposal",
    "",
    result.summary.text,
    "",
    "## Photos",
    "",
  ];

  for (const asset of result.assets) {
    lines.push(`### ${asset.assetId} — ${asset.basename}`, "");
    lines.push(
      operationLine("Face candidates", asset.operations.faces, "faces"),
    );
    lines.push(
      operationLine("Body candidates", asset.operations.bodies, "bodies"),
    );
    lines.push(
      operationLine("Scene/Text", asset.operations.sceneText, "proposal"),
    );
    lines.push(
      operationLine(
        "Quick enhancement",
        asset.operations.enhancePreview,
        "artifact",
      ),
    );
    lines.push(operationLine("Enhance", asset.operations.enhance, "artifact"));
    if (asset.operations.sceneText?.proposal) {
      const proposal = asset.operations.sceneText.proposal;
      lines.push(`- Summary proposal: ${proposal.summary || "—"}`);
      lines.push(
        `- Visible text: ${proposal.visibleText?.length ? proposal.visibleText.join(" · ") : "none proposed"}`,
      );
    }
    if (asset.artifacts.overlay)
      lines.push(`- Review overlay: \`${asset.artifacts.overlay.path}\``);
    if (asset.operations.enhance?.artifact)
      lines.push(
        `- Derived enhancement: \`${asset.operations.enhance.artifact.path}\``,
      );
    if (asset.operations.enhancePreview?.artifact)
      lines.push(
        `- Progressive enhancement: \`${asset.operations.enhancePreview.artifact.path}\``,
      );
    if (asset.baselineComparison) {
      const faceComparison = asset.baselineComparison.faces;
      const bodyComparison = asset.baselineComparison.bodies;
      lines.push(
        `- Baseline faces: ${faceComparison ? `${faceComparison.added.length} new candidate(s), ${faceComparison.matched} matched, ${faceComparison.removed.length} not redetected` : "model not rerun"}`,
      );
      lines.push(
        `- Baseline bodies: ${bodyComparison ? `${bodyComparison.added.length} new candidate(s), ${bodyComparison.matched} matched, ${bodyComparison.removed.length} not redetected` : "model not rerun"}`,
      );
    }
    if (asset.crossModelChecks.state === "review") {
      lines.push(
        `- Candidate review: ${asset.crossModelChecks.reasonCodes.join(", ")}`,
      );
    }
    lines.push("");
  }

  lines.push("## Cross-photo context", "");
  if (!result.context || !result.context.candidates.length) {
    lines.push(
      `No context candidates (${result.context?.state ?? "not run"}).`,
      "",
    );
  } else {
    lines.push(
      "| Photo | Candidate | Subject | State | Similarity | Evidence |",
      "|---|---|---|---:|---:|---|",
    );
    for (const candidate of result.context.candidates) {
      lines.push(
        `| ${safeCell(candidate.assetId)} | ${safeCell(candidate.kind)} | ${safeCell(candidate.subject)} | ${safeCell(candidate.state)} | ${safeCell(candidate.evidence.similarity)} | ${safeCell(candidate.evidence.reasonCodes.join(", "))} |`,
      );
    }
    lines.push(
      "",
      "Candidates are review evidence only; they do not activate identity or overwrite accepted observations.",
      "",
    );
  }

  lines.push("## Rerun diff", "");
  if (diff.state === "first_run") {
    lines.push("This is the first run for the ordered set.", "");
  } else {
    lines.push(
      "| Photo | Faces + / − | Bodies + / − | Scene/Text changed | Source changed |",
      "|---|---:|---:|---:|---:|",
    );
    for (const asset of diff.assets) {
      lines.push(
        `| ${safeCell(asset.assetId)} | ${count(asset.faces.added)} / ${count(asset.faces.removed)} | ${count(asset.bodies.added)} / ${count(asset.bodies.removed)} | ${asset.sceneTextChanged ? "yes" : "no"} | ${asset.sourceChanged ? "YES" : "no"} |`,
      );
    }
    lines.push("");
  }

  const failures = result.assets.flatMap((asset) =>
    Object.values(asset.operations)
      .filter((operation) => operation?.state === "failed")
      .map(
        (operation) =>
          `${asset.assetId}/${operation.operation}: ${operation.errorCode}`,
      ),
  );
  lines.push(
    "## Provider status",
    "",
    failures.length
      ? failures.map((failure) => `- ${failure}`).join("\n")
      : "All executed provider lanes returned without a typed failure.",
    "",
  );
  lines.push(
    "Raw appearance vectors and absolute source paths are deliberately absent from this receipt.",
    "",
  );
  return `${lines.join("\n")}\n`;
};
