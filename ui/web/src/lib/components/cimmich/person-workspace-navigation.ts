export type CimmichIdentityFilter =
  | 'all'
  | 'appearance'
  | 'body'
  | 'candidates'
  | 'head'
  | 'lq'
  | 'needs_qc'
  | 'overview'
  | 'presentation'
  | 'presence'
  | 'prime'
  | 'references'
  | 'secondary';

export type CimmichPersonMode = 'connections' | 'details' | 'documents' | 'identity' | 'photos' | 'setup' | 'split';

const workspaceUrl = (mode: CimmichPersonMode, identityFilter: CimmichIdentityFilter) => {
  const url = new URL(globalThis.location.href);
  url.searchParams.set('mode', mode);
  if (mode === 'identity' && identityFilter !== 'overview') {
    url.searchParams.set('identityFilter', identityFilter);
  } else {
    url.searchParams.delete('identityFilter');
  }
  return url;
};

export const syncPersonWorkspaceUrl = (mode: CimmichPersonMode, identityFilter: CimmichIdentityFilter) => {
  globalThis.history.replaceState(globalThis.history.state, '', workspaceUrl(mode, identityFilter));
};

export const storePersonWorkspaceReturnScroll = (mode: CimmichPersonMode, identityFilter: CimmichIdentityFilter) => {
  const url = workspaceUrl(mode, identityFilter);
  url.searchParams.set('returnScroll', String(Math.max(0, Math.round(globalThis.scrollY))));
  globalThis.history.replaceState(globalThis.history.state, '', url);
};
