const iou = (left, right) => {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.w, right.x + right.w);
  const y2 = Math.min(left.y + left.h, right.y + right.h);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.w * left.h + right.w * right.h - intersection;
  return union > 0 ? intersection / union : 0;
};

export const diffObservations = (
  previous = [],
  current = [],
  threshold = 0.7,
) => {
  const matches = [];
  const usedPrevious = new Set();
  for (const [currentIndex, item] of current.entries()) {
    let best = null;
    for (const [previousIndex, candidate] of previous.entries()) {
      if (usedPrevious.has(previousIndex)) continue;
      const score = iou(candidate.box, item.box);
      if (score >= threshold && (!best || score > best.score))
        best = { currentIndex, previousIndex, score };
    }
    if (best) {
      matches.push(best);
      usedPrevious.add(best.previousIndex);
    }
  }
  const matchedCurrent = new Set(matches.map((item) => item.currentIndex));
  return {
    added: current.filter((_, index) => !matchedCurrent.has(index)),
    matched: matches.length,
    removed: previous.filter((_, index) => !usedPrevious.has(index)),
  };
};

export const diffRunResults = (previous, current) => {
  if (!previous) return { previousRunId: null, state: "first_run", assets: [] };
  const previousAssets = new Map(
    previous.assets.map((asset) => [asset.assetId, asset]),
  );
  const assets = current.assets.map((asset) => {
    const before = previousAssets.get(asset.assetId);
    return {
      assetId: asset.assetId,
      bodies: diffObservations(
        before?.operations?.bodies?.bodies,
        asset.operations?.bodies?.bodies,
      ),
      faces: diffObservations(
        before?.operations?.faces?.faces,
        asset.operations?.faces?.faces,
      ),
      sceneTextChanged:
        JSON.stringify(before?.operations?.sceneText?.proposal ?? null) !==
        JSON.stringify(asset.operations?.sceneText?.proposal ?? null),
      sourceChanged: before?.sourceContentDigest !== asset.sourceContentDigest,
    };
  });
  return { assets, previousRunId: previous.runId, state: "compared" };
};

export { iou };
