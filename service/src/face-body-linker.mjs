export const faceBodyLinkPolicyVersion = "cimmich-face-body-linker-v1";

const defaultOptions = Object.freeze({
  bodyExpansion: 1.04,
  expectedFaceY: 0.24,
  headExpansion: 1.35,
  maxCost: 0.65,
  maxFaceY: 0.55,
  maxFaceWidthRatio: 1.6,
  minimumContainedHeadIou: 0.03,
  minimumHeadIou: 0.05,
  minMargin: 0.12,
  verticalWeight: 0.35,
});

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));
const pairKey = (faceId, bodyId) => `${faceId}\u001f${bodyId}`;

const validatedPolicy = (options = {}) => {
  const policy = { ...defaultOptions, ...options };
  const positive = [
    "bodyExpansion",
    "headExpansion",
    "maxCost",
    "maxFaceWidthRatio",
  ];
  const nonNegative = [
    "expectedFaceY",
    "maxFaceY",
    "minimumContainedHeadIou",
    "minimumHeadIou",
    "minMargin",
    "verticalWeight",
  ];
  for (const key of positive) {
    if (!Number.isFinite(policy[key]) || policy[key] <= 0)
      throw new TypeError(`${key} must be a positive finite number`);
  }
  for (const key of nonNegative) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0)
      throw new TypeError(`${key} must be a non-negative finite number`);
  }
  if (policy.maxFaceY > 1) throw new TypeError("maxFaceY must be at most 1");
  return policy;
};

const expandBox = (box, factor) => {
  const centerX = box.boxX + box.boxW / 2;
  const centerY = box.boxY + box.boxH / 2;
  const width = box.boxW * factor;
  const height = box.boxH * factor;
  const boxX = clamp(centerX - width / 2, 0, 1);
  const boxY = clamp(centerY - height / 2, 0, 1);
  return {
    boxH: Math.min(height, 1 - boxY),
    boxW: Math.min(width, 1 - boxX),
    boxX,
    boxY,
  };
};

const contains = (box, x, y) =>
  x >= box.boxX &&
  x <= box.boxX + box.boxW &&
  y >= box.boxY &&
  y <= box.boxY + box.boxH;

const intersectionOverUnion = (left, right) => {
  const x1 = Math.max(left.boxX, right.boxX);
  const y1 = Math.max(left.boxY, right.boxY);
  const x2 = Math.min(left.boxX + left.boxW, right.boxX + right.boxW);
  const y2 = Math.min(left.boxY + left.boxH, right.boxY + right.boxH);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection === 0) return 0;
  const union = left.boxW * left.boxH + right.boxW * right.boxH - intersection;
  return union > 0 ? intersection / union : 0;
};

export const faceBodyGeometry = (face, body, options = {}) => {
  const policy = validatedPolicy(options);
  const faceCenterX = face.boxX + face.boxW / 2;
  const faceCenterY = face.boxY + face.boxH / 2;
  const relativeX = (faceCenterX - body.boxX) / body.boxW;
  const relativeY = (faceCenterY - body.boxY) / body.boxH;
  const faceWidthRatio = face.boxW / body.boxW;
  const expandedBody = expandBox(body, policy.bodyExpansion);
  const insideBody = contains(expandedBody, faceCenterX, faceCenterY);
  const upperBody = relativeY >= 0 && relativeY <= policy.maxFaceY;
  if (body.headBox) {
    const expandedHead = expandBox(body.headBox, policy.headExpansion);
    const insideHead = contains(expandedHead, faceCenterX, faceCenterY);
    const headIou = intersectionOverUnion(face, expandedHead);
    const headSupported =
      headIou >= policy.minimumHeadIou ||
      (insideHead && headIou >= policy.minimumContainedHeadIou);
    const horizontalScore = Math.max(
      0,
      1 - Math.abs(faceCenterX - (body.boxX + body.boxW / 2)) / body.boxW,
    );
    const associationScore =
      0.55 * Math.min(1, headIou * 3) + 0.3 * horizontalScore + 0.15;
    return {
      associationScore,
      cost: 1 - associationScore,
      eligible: insideBody && upperBody && headSupported,
      faceWidthRatio,
      headIou,
      horizontalCost: 1 - horizontalScore,
      insideHead,
      relativeX,
      relativeY,
      verticalCost: 0,
    };
  }
  const eligible =
    insideBody && upperBody && faceWidthRatio <= policy.maxFaceWidthRatio;
  const horizontalCost = Math.abs(relativeX - 0.5);
  const verticalCost = Math.abs(relativeY - policy.expectedFaceY);
  return {
    cost: horizontalCost + policy.verticalWeight * verticalCost,
    eligible,
    faceWidthRatio,
    horizontalCost,
    relativeX,
    relativeY,
    verticalCost,
  };
};

const addResidualEdge = (
  graph,
  from,
  to,
  capacity,
  cost,
  metadata = undefined,
) => {
  const forward = { capacity, cost, metadata, reverse: graph[to].length, to };
  const reverse = {
    capacity: 0,
    cost: -cost,
    metadata: undefined,
    reverse: graph[from].length,
    to: from,
  };
  graph[from].push(forward);
  graph[to].push(reverse);
};

const minCostMaximumMatching = (
  faces,
  bodies,
  candidateEdges,
  excludedKey = "",
) => {
  const source = 0;
  const faceOffset = 1;
  const bodyOffset = faceOffset + faces.length;
  const sink = bodyOffset + bodies.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const faceIndex = new Map(faces.map((face, index) => [face.faceId, index]));
  const bodyIndex = new Map(bodies.map((body, index) => [body.bodyId, index]));

  for (let index = 0; index < faces.length; index += 1)
    addResidualEdge(graph, source, faceOffset + index, 1, 0);
  for (let index = 0; index < bodies.length; index += 1)
    addResidualEdge(graph, bodyOffset + index, sink, 1, 0);
  for (const edge of candidateEdges) {
    if (edge.key === excludedKey) continue;
    addResidualEdge(
      graph,
      faceOffset + faceIndex.get(edge.face.faceId),
      bodyOffset + bodyIndex.get(edge.body.bodyId),
      1,
      edge.cost,
      edge,
    );
  }

  let cardinality = 0;
  let cost = 0;
  while (true) {
    const distance = Array(graph.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array(graph.length).fill(-1);
    const previousEdge = Array(graph.length).fill(-1);
    const queued = Array(graph.length).fill(false);
    const queue = [source];
    distance[source] = 0;
    queued[source] = true;

    while (queue.length > 0) {
      const node = queue.shift();
      queued[node] = false;
      for (let index = 0; index < graph[node].length; index += 1) {
        const edge = graph[node][index];
        if (
          edge.capacity <= 0 ||
          distance[edge.to] <= distance[node] + edge.cost + 1e-12
        )
          continue;
        distance[edge.to] = distance[node] + edge.cost;
        previousNode[edge.to] = node;
        previousEdge[edge.to] = index;
        if (!queued[edge.to]) {
          queue.push(edge.to);
          queued[edge.to] = true;
        }
      }
    }
    if (!Number.isFinite(distance[sink])) break;

    let node = sink;
    while (node !== source) {
      const parent = previousNode[node];
      const edgeIndex = previousEdge[node];
      const edge = graph[parent][edgeIndex];
      edge.capacity -= 1;
      graph[node][edge.reverse].capacity += 1;
      node = parent;
    }
    cardinality += 1;
    cost += distance[sink];
  }

  const pairs = [];
  for (let index = 0; index < faces.length; index += 1) {
    for (const edge of graph[faceOffset + index]) {
      if (edge.metadata && edge.capacity === 0) pairs.push(edge.metadata);
    }
  }
  pairs.sort((left, right) =>
    left.face.faceId.localeCompare(right.face.faceId),
  );
  return { cardinality, cost, pairs };
};

export const linkAssetFacesToBodies = (asset, options = {}) => {
  const policy = validatedPolicy(options);
  const faces = [...(asset.faces || [])].sort((left, right) =>
    left.faceId.localeCompare(right.faceId),
  );
  const bodies = [...(asset.bodies || [])].sort((left, right) =>
    left.bodyId.localeCompare(right.bodyId),
  );
  const candidateEdges = [];
  for (const face of faces) {
    for (const body of bodies) {
      const geometry = faceBodyGeometry(face, body, policy);
      if (!geometry.eligible || geometry.cost > policy.maxCost) continue;
      candidateEdges.push({
        ...geometry,
        body,
        face,
        key: pairKey(face.faceId, body.bodyId),
      });
    }
  }

  const best = minCostMaximumMatching(faces, bodies, candidateEdges);
  const accepted = [];
  const abstained = [];
  for (const pair of best.pairs) {
    const alternative = minCostMaximumMatching(
      faces,
      bodies,
      candidateEdges,
      pair.key,
    );
    const structurallyRequired = alternative.cardinality < best.cardinality;
    const margin = structurallyRequired
      ? Number.POSITIVE_INFINITY
      : Math.max(0, alternative.cost - best.cost);
    const reason =
      !structurallyRequired && margin < policy.minMargin
        ? "ambiguous_assignment"
        : "";
    const report = {
      assetId: asset.assetId,
      bodyId: pair.body.bodyId,
      confidence: clamp(
        0.5 +
          0.25 * (1 - Math.min(1, pair.cost / policy.maxCost)) +
          0.25 *
            (structurallyRequired
              ? 1
              : Math.min(1, margin / (policy.minMargin * 3))),
        0,
        1,
      ),
      cost: pair.cost,
      faceId: pair.face.faceId,
      identityClaimId: pair.face.identityClaimId,
      margin: structurallyRequired ? null : margin,
      personId: pair.face.personId,
      reason:
        reason ||
        (structurallyRequired
          ? "unique_maximum_cardinality_assignment"
          : "separated_minimum_cost_assignment"),
    };
    (reason ? abstained : accepted).push(report);
  }

  return {
    accepted,
    assetId: asset.assetId,
    abstained,
    candidateEdgeCount: candidateEdges.length,
    matchedCount: best.cardinality,
    unmatchedBodies: bodies.length - best.cardinality,
    unmatchedFaces: faces.length - best.cardinality,
  };
};

export const linkFacesToBodies = (assets, options = {}) => {
  const policy = validatedPolicy(options);
  const results = assets.map((asset) => linkAssetFacesToBodies(asset, options));
  return {
    accepted: results.flatMap((result) => result.accepted),
    assets: results,
    abstained: results.flatMap((result) => result.abstained),
    policy,
  };
};

export const projectAssetFaceBodyLinks = (asset, options = {}) => {
  const bodies = asset.bodies || [];
  const fixedFaceIds = new Set(
    bodies.map((body) => body.supportingFaceId).filter(Boolean),
  );
  const availableFaces = (asset.faces || []).filter(
    (face) => !fixedFaceIds.has(face.faceId),
  );
  // Standalone accepted Body ownership and Face↔Body geometry are independent
  // truths. A Person-bound Body may still have one clear unresolved Face inside
  // it; projecting that physical relation must not require or create a Face
  // identity claim. Only a Body with an already-fixed supporting Face is removed
  // from the geometry assignment frontier.
  const availableBodies = bodies.filter((body) => !body.supportingFaceId);
  const proposal = linkAssetFacesToBodies(
    {
      assetId: asset.assetId,
      bodies: availableBodies,
      faces: availableFaces,
    },
    options,
  );
  const geometryByBodyId = new Map(
    proposal.accepted.map((link) => [link.bodyId, link]),
  );

  return bodies.map((body) => {
    const geometry = geometryByBodyId.get(body.bodyId);
    return {
      ...body,
      faceLinkConfidence: geometry?.confidence ?? null,
      faceLinkId: body.supportingFaceId || geometry?.faceId || null,
      faceLinkState: body.supportingFaceId
        ? "accepted_identity"
        : geometry
          ? "geometry"
          : null,
    };
  });
};
