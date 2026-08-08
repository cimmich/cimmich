import {
  getCimmichFaceMatches,
  type CimmichFaceOwnerReviewMatch,
  type CimmichPerson,
} from '$lib/services/cimmich.service';
import { personAuditDecision } from './person-audit-decision';
import type { CimmichPersonReviewItem } from './same-photo-collision-review';

export class CimmichIdentityAuditCorrectionController {
  faceId = $state('');
  matches = $state<Record<string, CimmichFaceOwnerReviewMatch[]>>({});
  matchesLoading = $state<Record<string, boolean>>({});
  queries = $state<Record<string, string>>({});
  targetPersonIds = $state<Record<string, string>>({});

  constructor(
    private readonly people: () => CimmichPerson[],
    private readonly currentPersonId: () => string,
    private readonly onError: (message: string) => void,
  ) {}

  decision(item: CimmichPersonReviewItem) {
    return personAuditDecision(item, this.targetPersonIds, this.matches, this.people());
  }

  loading(item: CimmichPersonReviewItem) {
    return Boolean(this.matchesLoading[item.faceId]);
  }

  options(item: CimmichPersonReviewItem) {
    const options = [
      {
        label: `${item.suggestedPerson.displayName} · likely match`,
        personId: item.suggestedPerson.personId,
      },
      ...(item.assignedPerson
        ? [
            {
              label: `${item.assignedPerson.displayName} · current`,
              personId: item.assignedPerson.personId,
            },
          ]
        : []),
      ...this.decision(item).alternativeMatches.map((match) => ({
        label: `${match.display_name}${match.current_identity ? ' · current' : ''}`,
        personId: match.person_id,
      })),
    ];
    return options.filter(
      ({ personId }, index) => options.findIndex((option) => option.personId === personId) === index,
    );
  }

  query(item: CimmichPersonReviewItem) {
    return this.queries[item.faceId] ?? '';
  }

  searchResults(item: CimmichPersonReviewItem) {
    const query = this.query(item).trim().toLocaleLowerCase();
    if (!query) {
      return [];
    }
    return this.people()
      .filter(
        (person) =>
          person.subject_kind === 'person' &&
          person.person_id !== this.currentPersonId() &&
          [person.display_name, ...person.aliases].join(' ').toLocaleLowerCase().includes(query),
      )
      .slice(0, 5);
  }

  selectSearchResult(item: CimmichPersonReviewItem, personId: string, displayName: string) {
    this.targetPersonIds = { ...this.targetPersonIds, [item.faceId]: personId };
    this.queries = { ...this.queries, [item.faceId]: displayName };
  }

  setQuery(item: CimmichPersonReviewItem, query: string) {
    this.queries = { ...this.queries, [item.faceId]: query };
    this.targetPersonIds = { ...this.targetPersonIds, [item.faceId]: '' };
  }

  setTarget(item: CimmichPersonReviewItem, personId: string) {
    this.targetPersonIds = { ...this.targetPersonIds, [item.faceId]: personId };
    this.queries = { ...this.queries, [item.faceId]: '' };
  }

  toggle(item: CimmichPersonReviewItem) {
    const opening = this.faceId !== item.faceId;
    this.faceId = opening ? item.faceId : '';
    if (!opening) {
      return;
    }
    this.targetPersonIds = { ...this.targetPersonIds, [item.faceId]: item.suggestedPerson.personId };
    this.queries = { ...this.queries, [item.faceId]: '' };
    void this.loadMatches(item);
  }

  finish(item: CimmichPersonReviewItem) {
    this.targetPersonIds = Object.fromEntries(
      Object.entries(this.targetPersonIds).filter(([faceId]) => faceId !== item.faceId),
    );
    this.faceId = this.faceId === item.faceId ? '' : this.faceId;
    this.queries = Object.fromEntries(Object.entries(this.queries).filter(([faceId]) => faceId !== item.faceId));
  }

  reset() {
    this.faceId = '';
    this.matches = {};
    this.matchesLoading = {};
    this.queries = {};
    this.targetPersonIds = {};
  }

  private async loadMatches(item: CimmichPersonReviewItem) {
    if (this.matches[item.faceId] || this.matchesLoading[item.faceId]) {
      return;
    }
    this.matchesLoading = { ...this.matchesLoading, [item.faceId]: true };
    try {
      this.matches = { ...this.matches, [item.faceId]: await getCimmichFaceMatches(item.faceId, 5) };
    } catch (error) {
      this.onError(error instanceof Error ? error.message : 'Unable to load the closest People');
    } finally {
      this.matchesLoading = { ...this.matchesLoading, [item.faceId]: false };
    }
  }
}
