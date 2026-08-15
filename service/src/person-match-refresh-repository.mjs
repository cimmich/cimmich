import { bulkReassignFaceIdentities as reassignFaceIdentities } from "./bulk-face-identity-reassignment.mjs";
import { createPersonMatchRefresher } from "./person-match-refresh.mjs";
import {
  refreshPrimeAfterCommand,
  waitForMaintenanceIdle,
} from "./repository-maintenance.mjs";

export const createPersonMatchRefreshStore = ({
  cleanActor,
  invalidateMachineSuggestions,
  maintenanceSql,
  reassign,
  requireVisibleSubject,
}) => {
  const refresher = createPersonMatchRefresher({
    cleanActor,
    refreshPrime: (personId) =>
      refreshPrimeAfterCommand(maintenanceSql, personId, {
        throwOnFailure: true,
      }),
    requireVisibleSubject,
    // A refresh can scan the full face embedding frontier. Keep that work on
    // the single-connection maintenance lane so Person/People reads retain
    // the interactive pool while the refresh is running.
    sql: maintenanceSql,
  });
  const reviewFaces = async (personId) => {
    const id = String(personId || "").trim();
    const rows = await maintenanceSql`
      WITH latest_run AS MATERIALIZED (
        SELECT audit_run_id
        FROM identity_audit_run
        WHERE state = 'completed'
        ORDER BY started_at DESC, audit_run_id DESC
        LIMIT 1
      )
      SELECT DISTINCT ON (candidate.face_id) candidate.face_id,
        candidate.scope_kind
      FROM (
        SELECT physical.canonical_face_id AS face_id, 'head' AS scope_kind,
          1 AS scope_priority
        FROM current_reference_gallery head
        JOIN current_face_physical_member physical
          ON physical.face_id = head.face_id
          AND physical.reconciliation_state <> 'conflict'
        WHERE head.person_id = ${id}
          AND head.bucket_kind = 'head'
          AND head.membership_state = 'active'
        UNION ALL
        SELECT physical.canonical_face_id AS face_id,
          'mistag' AS scope_kind, 0 AS scope_priority
        FROM current_physical_identity_audit_item item
        JOIN latest_run run ON run.audit_run_id = item.audit_run_id
        JOIN current_face_physical_member physical
          ON physical.face_id = item.face_id
          AND physical.reconciliation_state <> 'conflict'
        WHERE item.audit_kind = 'accepted_contradiction'
          AND item.review_state = 'open'
          AND item.assigned_person_id = ${id}
      ) candidate
      ORDER BY candidate.face_id, candidate.scope_priority
    `;
    return rows.map((row) => ({
      faceId: String(row.face_id),
      scopeKind: String(row.scope_kind),
    }));
  };

  return {
    async refreshPersonMatches({ actorId, personId }) {
      const scopedReviewFaces = await reviewFaces(personId);
      const result = await refresher.refresh({
        actorId,
        personId,
        reviewFaces: scopedReviewFaces,
      });
      invalidateMachineSuggestions();
      return result;
    },

    async bulkReassignFaceIdentities({ actorId, items }) {
      const actor = cleanActor(actorId);
      if (!actor) {
        throw Object.assign(new Error("Missing Cimmich actor"), {
          statusCode: 400,
        });
      }
      const result = await reassignFaceIdentities({
        actorId: actor,
        items,
        reassign,
      });
      const createdPersonIds = [
        ...new Set(
          result.assigned
            .filter((assignment) => assignment.createdPerson)
            .map((assignment) => assignment.personId),
        ),
      ];
      const matcherRefreshes = [];
      const matcherRefreshFailures = [];
      if (createdPersonIds.length > 0) {
        await waitForMaintenanceIdle(maintenanceSql);
      }
      for (const personId of createdPersonIds) {
        try {
          matcherRefreshes.push(
            await refresher.refresh({ actorId: actor, personId }),
          );
        } catch (error) {
          matcherRefreshFailures.push({
            code: error?.code || null,
            error: String(error?.message || error).slice(0, 300),
            personId,
          });
        }
      }
      if (matcherRefreshes.length > 0) invalidateMachineSuggestions();
      return { ...result, matcherRefreshes, matcherRefreshFailures };
    },
  };
};
