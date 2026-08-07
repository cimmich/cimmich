import type { CimmichFaceOwnerReviewMatch, CimmichIdentityAuditItem } from '$lib/services/cimmich.service';

type AuditItem = Pick<CimmichIdentityAuditItem, 'assignedPerson' | 'faceId' | 'suggestedPerson'>;
type PersonOption = { display_name: string; person_id: string };

export const personAuditDecision = (
  item: AuditItem,
  targetPersonIds: Record<string, string>,
  matchesByFace: Record<string, CimmichFaceOwnerReviewMatch[]>,
  people: PersonOption[],
) => {
  const targetPersonId =
    targetPersonIds[item.faceId] === undefined ? item.suggestedPerson.personId : targetPersonIds[item.faceId];
  const matches = matchesByFace[item.faceId] ?? [];
  const target =
    matches.find(({ person_id }) => person_id === targetPersonId) ??
    people.find(({ person_id }) => person_id === targetPersonId) ??
    (targetPersonId === item.suggestedPerson.personId
      ? { display_name: item.suggestedPerson.displayName }
      : targetPersonId === item.assignedPerson?.personId
        ? { display_name: item.assignedPerson.displayName }
        : undefined);
  return {
    alternativeMatches: matches.filter(
      ({ person_id }, index) =>
        person_id !== item.suggestedPerson.personId &&
        matches.findIndex((candidate) => candidate.person_id === person_id) === index,
    ),
    label: target
      ? `${targetPersonId === item.assignedPerson?.personId ? 'Leave as' : 'Change to'} ${target.display_name}`
      : 'Choose a person',
    target,
    targetPersonId,
  };
};
