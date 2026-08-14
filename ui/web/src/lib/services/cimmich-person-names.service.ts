import { request, type CimmichPersonAlias, type CimmichPersonSetup } from '$lib/services/cimmich.service';

export const getCimmichPersonSetup = (personId: string) =>
  request<CimmichPersonSetup>(`/v1/people/${encodeURIComponent(personId)}/setup`);

export const addCimmichPersonAlias = (
  personId: string,
  label: string,
  aliasKind: 'former_name' | 'imported' | 'nickname',
) =>
  request<{ alias: CimmichPersonAlias; changed: boolean; personId: string }>(
    `/v1/people/${encodeURIComponent(personId)}/aliases`,
    {
      body: JSON.stringify({ aliasKind, label }),
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const removeCimmichPersonAlias = (personId: string, aliasId: string) =>
  request<{ aliasId: string; changed: boolean; personId: string }>(
    `/v1/people/${encodeURIComponent(personId)}/aliases/${encodeURIComponent(aliasId)}/remove`,
    {
      body: '{}',
      headers: { 'x-cimmich-actor': 'local-operator' },
      method: 'POST',
    },
  );

export const setCimmichPersonDisplayName = (personId: string, displayName: string) =>
  request<{
    changed: boolean;
    decisionId?: string;
    displayName: string;
    formerNameAliasId?: string;
    personId: string;
    previousDisplayName: string;
  }>(`/v1/people/${encodeURIComponent(personId)}/display-name`, {
    body: JSON.stringify({ displayName }),
    headers: { 'x-cimmich-actor': 'local-operator' },
    method: 'POST',
  });
