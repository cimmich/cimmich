const policy = Object.freeze({
  clearDistanceCeiling: 0.5,
  clearDistanceMargin: 0.15,
  edgeEvidenceFloor: 0.42,
  minimumGroupSize: 3,
  minimumSamePhotoSeparations: 2,
  pairGroupCohesionFloor: 0.72,
  samePhotoSeparationRatio: 0.05,
  strongInternalMedianFloor: 0.8,
  strongLinkFloor: 0.65,
});

const median = (values) => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
};

const pairKey = (left, right) =>
  left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;

const createUnion = (nodes) => {
  const parent = new Map(
    nodes.map((node) => [node.physicalFaceId, node.physicalFaceId]),
  );
  const members = new Map(
    nodes.map((node) => [node.physicalFaceId, new Set([node.physicalFaceId])]),
  );
  const assets = new Map(
    nodes.map((node) => [node.physicalFaceId, new Set([node.assetId])]),
  );
  const find = (value) => {
    let root = value;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(value) !== value) {
      const next = parent.get(value);
      parent.set(value, root);
      value = next;
    }
    return root;
  };
  const merge = (left, right) => {
    let leftRoot = find(left);
    let rightRoot = find(right);
    if (leftRoot === rightRoot) return true;
    const leftAssets = assets.get(leftRoot);
    const rightAssets = assets.get(rightRoot);
    if ([...leftAssets].some((assetId) => rightAssets.has(assetId)))
      return false;
    if (members.get(leftRoot).size < members.get(rightRoot).size) {
      [leftRoot, rightRoot] = [rightRoot, leftRoot];
    }
    parent.set(rightRoot, leftRoot);
    for (const member of members.get(rightRoot))
      members.get(leftRoot).add(member);
    for (const assetId of assets.get(rightRoot))
      assets.get(leftRoot).add(assetId);
    members.delete(rightRoot);
    assets.delete(rightRoot);
    return true;
  };
  return { find, members, merge };
};

const medoid = (memberIds, similarities) =>
  [...memberIds].sort((left, right) => {
    const score = (candidate) =>
      [...memberIds]
        .filter((memberId) => memberId !== candidate)
        .reduce(
          (sum, memberId) =>
            sum +
            (similarities.get(pairKey(candidate, memberId)) ??
              policy.edgeEvidenceFloor),
          0,
        );
    return score(right) - score(left) || left.localeCompare(right);
  })[0];

export const buildSmartSplitRecommendations = ({
  edges = [],
  nodes = [],
  personId,
}) => {
  const normalizedNodes = nodes
    .map((node) => ({
      assetId: String(node.assetId || ""),
      embedded: node.embedded === true,
      faceIds: [...new Set((node.faceIds || []).map(String))].sort(),
      physicalFaceId: String(node.physicalFaceId || ""),
    }))
    .filter((node) => node.physicalFaceId && node.faceIds.length > 0)
    .sort((left, right) =>
      left.physicalFaceId.localeCompare(right.physicalFaceId),
    );
  const embeddedNodes = normalizedNodes.filter((node) => node.embedded);
  const nodeById = new Map(
    normalizedNodes.map((node) => [node.physicalFaceId, node]),
  );
  const similarities = new Map();
  const sameAssetPairs = new Set();
  for (const edge of edges) {
    const left = String(edge.leftPhysicalFaceId || "");
    const right = String(edge.rightPhysicalFaceId || "");
    if (!nodeById.has(left) || !nodeById.has(right) || left === right) continue;
    const key = pairKey(left, right);
    const similarity = Number(edge.similarity);
    if (Number.isFinite(similarity)) similarities.set(key, similarity);
    if (edge.sameAsset === true) sameAssetPairs.add(key);
  }

  const union = createUnion(embeddedNodes);
  for (const edge of edges
    .filter(
      (row) =>
        Number(row.similarity) >= policy.strongLinkFloor &&
        row.sameAsset !== true,
    )
    .sort(
      (left, right) =>
        Number(right.similarity) - Number(left.similarity) ||
        pairKey(
          left.leftPhysicalFaceId,
          left.rightPhysicalFaceId,
        ).localeCompare(
          pairKey(right.leftPhysicalFaceId, right.rightPhysicalFaceId),
        ),
    )) {
    union.merge(
      String(edge.leftPhysicalFaceId),
      String(edge.rightPhysicalFaceId),
    );
  }

  const componentMembers = new Map();
  for (const node of embeddedNodes) {
    const root = union.find(node.physicalFaceId);
    if (!componentMembers.has(root)) componentMembers.set(root, new Set());
    componentMembers.get(root).add(node.physicalFaceId);
  }
  const components = [...componentMembers.values()].map((memberIds) => {
    const memberArray = [...memberIds];
    const bestInternal = memberArray.map((memberId) =>
      Math.max(
        -1,
        ...memberArray
          .filter((otherId) => otherId !== memberId)
          .map((otherId) => similarities.get(pairKey(memberId, otherId)) ?? -1),
      ),
    );
    const externalIds = embeddedNodes
      .map((node) => node.physicalFaceId)
      .filter((candidateId) => !memberIds.has(candidateId));
    const nearestOtherSimilarity = Math.max(
      -1,
      ...memberArray.flatMap((memberId) =>
        externalIds.map(
          (otherId) => similarities.get(pairKey(memberId, otherId)) ?? -1,
        ),
      ),
    );
    const samePhotoSeparations = memberArray.reduce(
      (count, memberId) =>
        count +
        externalIds.filter((otherId) =>
          sameAssetPairs.has(pairKey(memberId, otherId)),
        ).length,
      0,
    );
    const cohesionFloor = Math.min(...bestInternal);
    const cohesionMedian = median(bestInternal);
    const separationMargin = cohesionFloor - nearestOtherSimilarity;
    const requiredSamePhotoSeparations = Math.max(
      policy.minimumSamePhotoSeparations,
      Math.ceil(memberIds.size * policy.samePhotoSeparationRatio),
    );
    const robustSamePhotoEvidence =
      samePhotoSeparations >= requiredSamePhotoSeparations;
    const enoughMembers =
      memberIds.size >= policy.minimumGroupSize ||
      (memberIds.size === 2 &&
        cohesionFloor >= policy.pairGroupCohesionFloor &&
        robustSamePhotoEvidence);
    const clear =
      enoughMembers &&
      cohesionFloor >= policy.strongLinkFloor &&
      (cohesionMedian >= policy.strongInternalMedianFloor ||
        robustSamePhotoEvidence ||
        (nearestOtherSimilarity < policy.clearDistanceCeiling &&
          separationMargin >= policy.clearDistanceMargin));
    return {
      clear,
      cohesionFloor,
      cohesionMedian,
      memberIds,
      nearestOtherSimilarity,
      representativePhysicalFaceId: medoid(memberIds, similarities),
      samePhotoSeparations,
      separationMargin,
    };
  });

  let clearComponents = components.filter((component) => component.clear);
  const clearPhysicalIds = new Set(
    clearComponents.flatMap((component) => [...component.memberIds]),
  );
  const unclearNodes = normalizedNodes.filter(
    (node) => !clearPhysicalIds.has(node.physicalFaceId),
  );
  if (clearComponents.length === 1 && unclearNodes.length === 0) {
    clearComponents = [];
    unclearNodes.push(...normalizedNodes);
  }
  clearComponents.sort(
    (left, right) =>
      right.memberIds.size - left.memberIds.size ||
      left.representativePhysicalFaceId.localeCompare(
        right.representativePhysicalFaceId,
      ),
  );
  const groups = clearComponents.map((component, index) => {
    const componentNodes = [...component.memberIds].map((physicalFaceId) =>
      nodeById.get(physicalFaceId),
    );
    const representative = nodeById.get(component.representativePhysicalFaceId);
    return {
      cohesionFloor: component.cohesionFloor,
      cohesionMedian: component.cohesionMedian,
      faceIds: componentNodes.flatMap((node) => node.faceIds).sort(),
      groupId: `smart-group-${index + 1}`,
      kind: "clear",
      label: `Suggested group ${index + 1}`,
      nearestOtherSimilarity:
        component.nearestOtherSimilarity < -0.5
          ? null
          : component.nearestOtherSimilarity,
      physicalFaceCount: component.memberIds.size,
      reason:
        component.samePhotoSeparations >=
        Math.max(
          policy.minimumSamePhotoSeparations,
          Math.ceil(component.memberIds.size * policy.samePhotoSeparationRatio),
        )
          ? "same_photo_separation"
          : "embedding_separation",
      representativeFaceId: representative.faceIds[0],
      samePhotoSeparations: component.samePhotoSeparations,
      separationMargin: component.separationMargin,
    };
  });
  const unclearFaceIds = unclearNodes.flatMap((node) => node.faceIds).sort();
  groups.push({
    cohesionFloor: null,
    cohesionMedian: null,
    faceIds: unclearFaceIds,
    groupId: "smart-unclear",
    kind: "unclear",
    label: "Unclear",
    nearestOtherSimilarity: null,
    physicalFaceCount: unclearNodes.length,
    reason: "conservative_abstention",
    representativeFaceId: unclearFaceIds[0] || null,
    samePhotoSeparations: 0,
    separationMargin: null,
  });
  return {
    automaticIdentityAuthority: "none",
    groups,
    personId,
    policy: { ...policy },
    schemaVersion: "cimmich.smart-split-recommendations.v1",
    summary: {
      clearGroupCount: groups.filter((group) => group.kind === "clear").length,
      embeddedPhysicalFaceCount: embeddedNodes.length,
      physicalFaceCount: normalizedNodes.length,
      unclearFaceCount: unclearFaceIds.length,
    },
  };
};

export const createSmartSplitRecommendationStore = (
  sql,
  {
    matchingProvider = null,
    presentationRank = () => 0,
    requireVisibleSubject,
  },
) => ({
  async recommendations({ personId }) {
    await requireVisibleSubject(personId);
    const id = String(personId || "").trim();
    const nodes = await sql`
      SELECT member.physical_face_id, member.canonical_face_id,
        canonical.asset_id,
        array_agg(DISTINCT identity.face_id ORDER BY identity.face_id) AS face_ids
      FROM current_face_identity identity
      JOIN current_face_physical_member member ON member.face_id = identity.face_id
        AND member.reconciliation_state <> 'conflict'
      JOIN face_observation canonical ON canonical.face_id = member.canonical_face_id
        AND canonical.state = 'valid'
      JOIN asset ON asset.asset_id = canonical.asset_id AND asset.state = 'active'
      WHERE identity.person_id = ${id} AND identity.state = 'accepted'
        AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
      GROUP BY member.physical_face_id, member.canonical_face_id, canonical.asset_id
      ORDER BY member.physical_face_id
    `;
    if (!matchingProvider || nodes.length > 1200) {
      return {
        ...buildSmartSplitRecommendations({
          nodes: nodes.map((node) => ({
            assetId: node.asset_id,
            embedded: false,
            faceIds: node.face_ids,
            physicalFaceId: node.physical_face_id,
          })),
          personId: id,
        }),
        available: false,
        unavailableReason: !matchingProvider
          ? "matching_provider_unavailable"
          : "safe_size_limit",
      };
    }
    const lineage = {
      configDigest: matchingProvider.configDigest,
      dimension: 512,
      modelFamily: matchingProvider.modelFamily,
      modelVersion: matchingProvider.modelVersion,
    };
    const embedded = await sql`
      SELECT DISTINCT member.physical_face_id
      FROM current_face_identity identity
      JOIN current_face_physical_member member ON member.face_id = identity.face_id
        AND member.reconciliation_state <> 'conflict'
      JOIN face_embedding embedding ON embedding.face_id = member.canonical_face_id
        AND embedding.state = 'active' AND embedding.dimension = ${lineage.dimension}
        AND embedding.model_family = ${lineage.modelFamily}
        AND embedding.model_version = ${lineage.modelVersion}
        AND embedding.config_digest = ${lineage.configDigest}
      WHERE identity.person_id = ${id} AND identity.state = 'accepted'
      ORDER BY member.physical_face_id
    `;
    const edges = await sql`
      WITH target AS MATERIALIZED (
        SELECT DISTINCT ON (member.physical_face_id)
          member.physical_face_id, canonical.asset_id,
          embedding.embedding::vector(512) AS embedding
        FROM current_face_identity identity
        JOIN current_face_physical_member member ON member.face_id = identity.face_id
          AND member.reconciliation_state <> 'conflict'
        JOIN face_observation canonical ON canonical.face_id = member.canonical_face_id
          AND canonical.state = 'valid'
        JOIN asset ON asset.asset_id = canonical.asset_id AND asset.state = 'active'
        JOIN face_embedding embedding ON embedding.face_id = member.canonical_face_id
          AND embedding.state = 'active' AND embedding.dimension = ${lineage.dimension}
          AND embedding.model_family = ${lineage.modelFamily}
          AND embedding.model_version = ${lineage.modelVersion}
          AND embedding.config_digest = ${lineage.configDigest}
        WHERE identity.person_id = ${id} AND identity.state = 'accepted'
          AND cimmich_visibility_asset_rank(asset.asset_id) <= ${presentationRank()}
        ORDER BY member.physical_face_id, embedding.created_at DESC, embedding.embedding_id
      )
      SELECT left_face.physical_face_id AS left_physical_face_id,
        right_face.physical_face_id AS right_physical_face_id,
        score.similarity, left_face.asset_id = right_face.asset_id AS same_asset
      FROM target left_face
      JOIN target right_face
        ON left_face.physical_face_id < right_face.physical_face_id
      CROSS JOIN LATERAL (
        SELECT (1 - (left_face.embedding <=> right_face.embedding))::float8 AS similarity
      ) score
      WHERE left_face.asset_id = right_face.asset_id
        OR score.similarity >= ${policy.edgeEvidenceFloor}
      ORDER BY left_face.physical_face_id, right_face.physical_face_id
    `;
    const embeddedIds = new Set(embedded.map((row) => row.physical_face_id));
    return {
      ...buildSmartSplitRecommendations({
        edges: edges.map((edge) => ({
          leftPhysicalFaceId: edge.left_physical_face_id,
          rightPhysicalFaceId: edge.right_physical_face_id,
          sameAsset: edge.same_asset === true,
          similarity: Number(edge.similarity),
        })),
        nodes: nodes.map((node) => ({
          assetId: node.asset_id,
          embedded: embeddedIds.has(node.physical_face_id),
          faceIds: node.face_ids,
          physicalFaceId: node.physical_face_id,
        })),
        personId: id,
      }),
      available: true,
      embeddingLineage: lineage,
      unavailableReason: null,
    };
  },
});

export const smartSplitRecommendationPolicy = policy;
