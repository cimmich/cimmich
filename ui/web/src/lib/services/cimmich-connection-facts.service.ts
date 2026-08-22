import { request } from './cimmich.service';

export type CimmichConnectionTargetKind = 'object' | 'person' | 'place';

export type CimmichConnectionModifier = {
  behavior: 'historical' | 'qualifier';
  label: string;
  modifierId: string;
  ownerCreated: boolean;
};

export type CimmichConnectionType = {
  inverseLabel: string;
  inversePastLabel: string | null;
  label: string;
  ownerCreated: boolean;
  pastLabel: string | null;
  semanticKind: string;
  sourceKind: 'person';
  symmetric: boolean;
  targetKind: CimmichConnectionTargetKind;
  temporalMode: 'none' | 'current_or_past';
  typeId: string;
};

export type CimmichConnectionFact = {
  contexts?: Array<{
    displayName: string;
    id: string;
    kind: 'event' | 'object' | 'place';
    typeKind: string;
  }>;
  dateEnd: string | null;
  dateStart: string | null;
  direction: 'incoming' | 'outgoing';
  displayLabel: string;
  factId: string;
  modifiers: CimmichConnectionModifier[];
  note: string | null;
  other: {
    displayName: string;
    id: string;
    kind: CimmichConnectionTargetKind;
    typeKind: string | null;
  };
  semanticKind: string;
  typeId: string;
  validity: 'current' | 'past' | 'timeless';
};

export type CimmichConnectionSuggestion = {
  candidate: {
    dateEnd: string | null;
    dateStart: string | null;
    targetId: string;
    targetKind: 'place';
    typeId: string;
    validity: 'current' | 'past';
  };
  confidence: 'possible' | 'stronger';
  displayLabel: string;
  evidence: {
    coworkerFactId: string;
    coworkerId: string;
    coworkerName: string;
    workplaceFactId: string;
  };
  explanation: string;
  suggestionKey: string;
  target: { displayName: string; id: string; kind: 'place' };
};

export type CimmichPersonConnectionFacts = {
  facts: CimmichConnectionFact[];
  schemaVersion: 'cimmich.connection-facts.v4';
  suggestions: CimmichConnectionSuggestion[];
};

export const getCimmichConnectionTypes = async (targetKind?: CimmichConnectionTargetKind) => {
  const search = targetKind ? `?targetKind=${encodeURIComponent(targetKind)}` : '';
  const result = await request<{
    items: CimmichConnectionType[];
    schemaVersion: 'cimmich.connection-facts.v4';
  }>(`/v1/connection-types${search}`);
  return result.items;
};

export const createCimmichConnectionType = (
  input: Pick<CimmichConnectionType, 'inverseLabel' | 'label' | 'symmetric' | 'targetKind' | 'temporalMode'> & {
    commandId: string;
    inversePastLabel?: string;
    pastLabel?: string;
  },
) =>
  request<{ replayed: boolean; schemaVersion: 'cimmich.connection-facts.v4'; type: CimmichConnectionType }>(
    '/v1/connection-types',
    {
      body: JSON.stringify(input),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const getCimmichConnectionModifiers = async () => {
  const result = await request<{
    items: CimmichConnectionModifier[];
    schemaVersion: 'cimmich.connection-facts.v4';
  }>('/v1/connection-modifiers');
  return result.items;
};

export const createCimmichConnectionModifier = (input: { commandId: string; label: string }) =>
  request<{
    modifier: CimmichConnectionModifier;
    replayed: boolean;
    schemaVersion: 'cimmich.connection-facts.v4';
  }>('/v1/connection-modifiers', {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const getCimmichPersonConnectionFacts = (personId: string) =>
  request<CimmichPersonConnectionFacts>(`/v1/people/${encodeURIComponent(personId)}/connection-facts`);

export const recordCimmichConnectionFact = (
  personId: string,
  input: {
    commandId: string;
    contextIds?: string[];
    dateEnd?: string | null;
    dateStart?: string | null;
    note?: string;
    modifierIds?: string[];
    suggestionKey?: string;
    targetId: string;
    targetKind: CimmichConnectionTargetKind;
    typeId: string;
    validity?: 'current' | 'past';
  },
) =>
  request<{
    fact: CimmichConnectionFact | null;
    replayed: boolean;
    schemaVersion: 'cimmich.connection-facts.v4';
  }>(`/v1/people/${encodeURIComponent(personId)}/connection-facts`, {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });

export const retractCimmichConnectionFact = (personId: string, factId: string, commandId: string) =>
  request<{ factId: string; replayed: boolean; schemaVersion: 'cimmich.connection-facts.v4' }>(
    `/v1/people/${encodeURIComponent(personId)}/connection-facts/${encodeURIComponent(factId)}:retract`,
    {
      body: JSON.stringify({ commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const dismissCimmichConnectionSuggestion = (personId: string, suggestionKey: string, commandId: string) =>
  request<{ replayed: boolean; schemaVersion: 'cimmich.connection-facts.v4'; suggestionKey: string }>(
    `/v1/people/${encodeURIComponent(personId)}/connection-suggestions/${encodeURIComponent(suggestionKey)}:dismiss`,
    {
      body: JSON.stringify({ commandId }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export type CimmichConnectionHubKind = 'employer' | 'group' | 'home';

export type CimmichConnectionHubMemberInput = {
  dateEnd?: string | null;
  dateStart?: string | null;
  modifierIds?: string[];
  note?: string;
  personId: string;
  typeId: string;
  validity?: 'current' | 'past';
};

export const recordCimmichConnectionHub = (input: {
  commandId: string;
  displayName?: string;
  hubEntityId?: string;
  hubKind: CimmichConnectionHubKind;
  members: CimmichConnectionHubMemberInput[];
}) =>
  request<{
    createdHub: boolean;
    hub: { displayName: string; entityId: string; entityKind: 'object' | 'place'; typeKind: string };
    members: Array<{
      displayName: string;
      factId: string;
      personId: string;
      typeId: string;
      validity: 'current' | 'past' | 'timeless';
    }>;
    replayed: boolean;
    schemaVersion: 'cimmich.connection-facts.v4';
  }>('/v1/connection-hubs:record', {
    body: JSON.stringify(input),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });
