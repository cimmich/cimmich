import {
  getCimmichFaceMatchesBatch,
  type CimmichFaceOwnerReviewMatch,
  type CimmichPerson,
} from '$lib/services/cimmich.service';
import { personAuditDecision } from './person-audit-decision';
import type { CimmichPersonReviewItem } from './same-photo-collision-review';

export class CimmichIdentityAuditCorrectionController {
  comparisonFaceId = $state('');
  faceId = $state('');
  matches = $state<Record<string, CimmichFaceOwnerReviewMatch[]>>({});
  matchesLoading = $state<Record<string, boolean>>({});
  queries = $state<Record<string, string>>({});
  targetPersonIds = $state<Record<string, string>>({});
  private generation = 0;

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

  matchesFor(item: CimmichPersonReviewItem) {
    return this.matches[item.faceId] ?? [];
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

  comparisonSelected(item: CimmichPersonReviewItem, personId: string) {
    return this.comparisonFaceId === item.faceId && this.decision(item).targetPersonId === personId;
  }

  toggleComparison(item: CimmichPersonReviewItem, personId: string) {
    if (this.comparisonSelected(item, personId)) {
      this.comparisonFaceId = '';
      return;
    }
    this.comparisonFaceId = item.faceId;
    this.faceId = '';
    this.setTarget(item, personId);
  }

  closeComparison(item: CimmichPersonReviewItem) {
    if (this.comparisonFaceId === item.faceId) {
      this.comparisonFaceId = '';
    }
  }

  toggle(item: CimmichPersonReviewItem) {
    const opening = this.faceId !== item.faceId;
    this.comparisonFaceId = '';
    this.faceId = opening ? item.faceId : '';
    if (!opening) {
      return;
    }
    this.open(item);
  }

  open(
    item: CimmichPersonReviewItem,
    targetPersonId = item.evidenceRoute === 'own_cluster_outlier' ? '' : item.suggestedPerson.personId,
  ) {
    this.faceId = item.faceId;
    this.targetPersonIds = { ...this.targetPersonIds, [item.faceId]: targetPersonId };
    this.queries = { ...this.queries, [item.faceId]: '' };
    void this.preload([item]);
  }

  async preload(items: CimmichPersonReviewItem[]) {
    const pending = items.filter((item, index) => {
      const first = items.findIndex(({ faceId }) => faceId === item.faceId) === index;
      return first && !this.matches[item.faceId] && !this.matchesLoading[item.faceId];
    });
    if (pending.length === 0) {
      return;
    }
    const generation = this.generation;
    this.matchesLoading = {
      ...this.matchesLoading,
      ...Object.fromEntries(pending.map(({ faceId }) => [faceId, true])),
    };
    try {
      for (let offset = 0; offset < pending.length; offset += 24) {
        const chunk = pending.slice(offset, offset + 24);
        const result = await getCimmichFaceMatchesBatch(
          chunk.map(({ faceId }) => faceId),
          5,
        );
        if (generation !== this.generation) {
          return;
        }
        this.matches = {
          ...this.matches,
          ...Object.fromEntries(result.items.map(({ faceId, matches }) => [faceId, matches])),
        };
      }
    } catch (error) {
      if (generation === this.generation) {
        this.onError(error instanceof Error ? error.message : 'Unable to compare the competing Faces');
      }
    } finally {
      if (generation === this.generation) {
        this.matchesLoading = Object.fromEntries(
          Object.entries(this.matchesLoading).filter(([faceId]) => !pending.some((item) => item.faceId === faceId)),
        );
      }
    }
  }

  finish(item: CimmichPersonReviewItem) {
    this.closeComparison(item);
    this.targetPersonIds = Object.fromEntries(
      Object.entries(this.targetPersonIds).filter(([faceId]) => faceId !== item.faceId),
    );
    this.faceId = this.faceId === item.faceId ? '' : this.faceId;
    this.queries = Object.fromEntries(Object.entries(this.queries).filter(([faceId]) => faceId !== item.faceId));
  }

  reset() {
    this.generation += 1;
    this.comparisonFaceId = '';
    this.faceId = '';
    this.matches = {};
    this.matchesLoading = {};
    this.queries = {};
    this.targetPersonIds = {};
  }
}
