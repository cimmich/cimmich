import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CIMMICH_BULK_PHOTO_SORTER_RECEIPT_KEY,
  CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY,
  currentCimmichUndoReceiptContext,
} from './cimmich-undo-receipt-context.svelte';

const mocks = vi.hoisted(() => ({
  auth: { authenticated: true, user: { id: 'owner-1' } },
  handlers: undefined as
    | {
        AuthLogin: () => void;
        AuthLogout: () => void;
        AuthUserLoaded: (user: { id: string }) => void;
      }
    | undefined,
  visibility: { viewingMode: 'private' as 'personal' | 'private' | 'standard' },
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mocks.auth }));
vi.mock('$lib/managers/cimmich-visibility-manager.svelte', () => ({
  cimmichVisibilityManager: mocks.visibility,
}));
vi.mock('$lib/managers/event-manager.svelte', () => ({
  eventManager: { on: vi.fn((handlers) => (mocks.handlers = handlers)) },
}));

const sessionKey = 'cimmich.undo-receipt.session.v1';

describe('Cimmich Undo receipt session context', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.auth.authenticated = true;
    mocks.auth.user.id = 'owner-1';
    mocks.visibility.viewingMode = 'private';
  });

  it('returns no receipt authority before authentication', () => {
    mocks.auth.authenticated = false;
    expect(currentCimmichUndoReceiptContext()).toBeNull();
    expect(sessionStorage.getItem(sessionKey)).toBeNull();
  });

  it('creates and reuses one owner-bound browser-session ID', () => {
    localStorage.setItem(CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY, 'stale');
    const first = currentCimmichUndoReceiptContext();
    const second = currentCimmichUndoReceiptContext();

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ownerId: 'owner-1', viewingMode: 'private' });
    expect(first?.sessionId).toMatch(/^undo\./u);
    expect(localStorage.getItem(CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(sessionKey) || 'null')).toEqual({
      ownerId: 'owner-1',
      sessionId: first?.sessionId,
    });
  });

  it('rotates the session and removes both receipt families after an owner switch or corrupt binding', () => {
    sessionStorage.setItem(sessionKey, '{bad json');
    localStorage.setItem(CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY, 'entity');
    localStorage.setItem(CIMMICH_BULK_PHOTO_SORTER_RECEIPT_KEY, 'bulk');
    const first = currentCimmichUndoReceiptContext();

    expect(localStorage.length).toBe(0);
    mocks.auth.user.id = 'owner-2';
    localStorage.setItem(CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY, 'entity-2');
    const second = currentCimmichUndoReceiptContext();

    expect(second?.ownerId).toBe('owner-2');
    expect(second?.sessionId).not.toBe(first?.sessionId);
    expect(localStorage.length).toBe(0);
  });

  it('clears persisted authority on login/logout and pre-binds the loaded owner', () => {
    expect(mocks.handlers).toBeDefined();
    void currentCimmichUndoReceiptContext();
    localStorage.setItem(CIMMICH_ENTITY_MEDIA_ACTION_RECEIPT_KEY, 'entity');
    localStorage.setItem(CIMMICH_BULK_PHOTO_SORTER_RECEIPT_KEY, 'bulk');

    mocks.handlers!.AuthLogout();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.getItem(sessionKey)).toBeNull();

    mocks.handlers!.AuthUserLoaded({ id: 'owner-3' });
    expect(JSON.parse(sessionStorage.getItem(sessionKey) || 'null')).toMatchObject({ ownerId: 'owner-3' });
    mocks.handlers!.AuthLogin();
    expect(sessionStorage.getItem(sessionKey)).toBeNull();
  });
});
