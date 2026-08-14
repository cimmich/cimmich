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
  sql,
}) => {
  const refresher = createPersonMatchRefresher({
    cleanActor,
    refreshPrime: (personId) =>
      refreshPrimeAfterCommand(maintenanceSql, personId, {
        throwOnFailure: true,
      }),
    requireVisibleSubject,
    sql,
  });

  return {
    async refreshPersonMatches({ actorId, personId }) {
      const result = await refresher.refresh({ actorId, personId });
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
