import { authManager } from '$lib/managers/auth-manager.svelte';
import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import type { CimmichUndoReceiptContext } from './persisted-undo-receipt';

export const CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY = 'cimmich.entity-media-action.receipt.v1';
export const CIMMICH_BULK_PHOTO_SORTER_RECEIPT_KEY = 'cimmich.bulk-photo-sorter.receipt.v1';
const undoSessionKey = 'cimmich.undo-receipt.session.v1';
const receiptKeys = [CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY, CIMMICH_BULK_PHOTO_SORTER_RECEIPT_KEY];
let undoReceiptSessionVersion = $state(0);

const clearPersistedUndoSession = () => {
  if (globalThis.localStorage !== undefined) {
    for (const key of receiptKeys) {
      globalThis.localStorage.removeItem(key);
    }
  }
  globalThis.sessionStorage?.removeItem(undoSessionKey);
  undoReceiptSessionVersion += 1;
};

const createSessionId = () =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? `undo.${globalThis.crypto.randomUUID()}`
    : `undo.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;

const sessionIdForOwner = (ownerId: string) => {
  const storage = globalThis.sessionStorage;
  if (!storage) {
    return '';
  }
  try {
    const stored = JSON.parse(storage.getItem(undoSessionKey) || 'null') as {
      ownerId?: string;
      sessionId?: string;
    } | null;
    if (stored?.ownerId === ownerId && stored.sessionId) {
      return stored.sessionId;
    }
  } catch {
    // Replace a corrupt or legacy session binding below.
  }
  for (const key of receiptKeys) {
    globalThis.localStorage?.removeItem(key);
  }
  const sessionId = createSessionId();
  storage.setItem(undoSessionKey, JSON.stringify({ ownerId, sessionId }));
  return sessionId;
};

eventManager.on({
  AuthLogin: clearPersistedUndoSession,
  AuthLogout: clearPersistedUndoSession,
  AuthUserLoaded: (user) => void sessionIdForOwner(user.id),
});

export const currentCimmichUndoReceiptContext = (): CimmichUndoReceiptContext | null => {
  void undoReceiptSessionVersion;
  if (!authManager.authenticated) {
    return null;
  }
  const ownerId = authManager.user.id;
  const sessionId = sessionIdForOwner(ownerId);
  return sessionId
    ? {
        ownerId,
        sessionId,
        viewingMode: cimmichVisibilityManager.viewingMode,
      }
    : null;
};
