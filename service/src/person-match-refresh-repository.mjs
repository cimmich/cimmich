import { bulkReassignFaceIdentities as reassignFaceIdentities } from "./bulk-face-identity-reassignment.mjs";
import { createPersonMatchRefresher } from "./person-match-refresh.mjs";
import { createPersonMistagRefresher } from "./person-mistag-refresh.mjs";
import {
  refreshPrimeAfterCommand,
  waitForMaintenanceIdle,
} from "./repository-maintenance.mjs";

export const createPersonMatchRefreshStore = ({
  cleanActor,
  invalidateMachineSuggestions,
  maintenanceSql,
  reassign,
  rescanHeads,
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
  const mistagRefresher = createPersonMistagRefresher({
    requireVisibleSubject,
    sql: maintenanceSql,
  });
  const scopes = async (personId) => {
    const id = String(personId || "").trim();
    const [row] = await maintenanceSql`
      WITH latest_run AS MATERIALIZED (
        SELECT audit_run_id, pack_id
        FROM identity_audit_run
        WHERE state = 'completed'
        ORDER BY started_at DESC, audit_run_id DESC
        LIMIT 1
      )
      SELECT (
          SELECT count(*)::int
          FROM current_reference_gallery head
          WHERE head.person_id = ${id}
            AND head.bucket_kind = 'head'
            AND head.membership_state = 'active'
        ) AS head_count,
        (
          SELECT count(*)::int
          FROM current_physical_identity_audit_item item
          JOIN latest_run run ON run.audit_run_id = item.audit_run_id
          JOIN source_pack pack ON pack.pack_id = run.pack_id
          JOIN face_observation face ON face.face_id = item.face_id
            AND face.state = 'valid'
          JOIN asset ON asset.asset_id = item.asset_id
            AND asset.state = 'active'
          JOIN face_embedding embedding
            ON embedding.face_id = item.face_id
            AND embedding.state = 'active'
            AND embedding.model_family = pack.model_family
            AND embedding.model_version = pack.model_version
            AND embedding.config_digest = pack.config_digest
          WHERE item.audit_kind = 'accepted_contradiction'
            AND item.review_state = 'open'
            AND (
              item.assigned_person_id = ${id}
              OR item.suggested_person_id = ${id}
            )
            AND EXISTS (
              SELECT 1
              FROM current_physical_face_identity accepted
              WHERE accepted.physical_face_id = item.physical_face_id
                AND accepted.person_id = item.assigned_person_id
                AND accepted.state = 'accepted'
            )
        ) AS mistag_count
    `;
    return {
      headCount: Number(row?.head_count || 0),
      mistagCount: Number(row?.mistag_count || 0),
    };
  };

  return {
    async refreshPersonMatches({ actorId, personId }) {
      const scope = await scopes(personId);
      const headRescan = scope.headCount
        ? await rescanHeads({ actorId, personId })
        : {
            evaluatedCount: 0,
            items: [],
            maintenancePending: false,
            movedCount: 0,
            retainedCount: 0,
            schemaVersion: "cimmich.head-rescan.v1",
            tierCounts: { lq: 0, prime: 0, secondary: 0 },
            totalCount: 0,
          };
      const result = await refresher.refresh({ actorId, personId });
      const mistagRefresh = scope.mistagCount
        ? await mistagRefresher.refresh({ personId })
        : {
            personId: String(personId || "").trim(),
            reevaluatedCount: 0,
            remainingCount: 0,
            resolvedCount: 0,
            routeChangedCount: 0,
            schemaVersion: "cimmich.person-mistag-refresh.v1",
          };
      invalidateMachineSuggestions();
      return { ...result, headRescan, mistagRefresh };
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
