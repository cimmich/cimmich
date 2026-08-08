export type CimmichIdentityMoveUndo = {
  bodyId?: string;
  destinationPersonId: string;
  faceId: string;
  moveBody: boolean;
  originalPersonId: string;
};

const identityMoveUndoKey = (personId: string) => `cimmich.identity-move-undo.v1.${personId}`;

export const storeIdentityMoveUndo = (personId: string, receipt: CimmichIdentityMoveUndo | null) => {
  try {
    const key = identityMoveUndoKey(personId);
    if (!receipt) {
      globalThis.localStorage.removeItem(key);
      return;
    }
    globalThis.localStorage.setItem(key, JSON.stringify({ receipt, savedAt: Date.now() }));
  } catch {
    // The move remains durable even when this browser refuses local storage;
    // only the convenience affordance is unavailable after a reload.
  }
};

export const restoreIdentityMoveUndo = (personId: string): CimmichIdentityMoveUndo | null => {
  try {
    const raw = globalThis.localStorage.getItem(identityMoveUndoKey(personId));
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as { receipt?: Partial<CimmichIdentityMoveUndo>; savedAt?: number };
    const receipt = value.receipt;
    if (
      !Number.isFinite(value.savedAt) ||
      Date.now() - Number(value.savedAt) > 24 * 60 * 60 * 1000 ||
      !receipt ||
      !receipt.destinationPersonId ||
      !receipt.faceId ||
      receipt.originalPersonId !== personId ||
      typeof receipt.moveBody !== 'boolean'
    ) {
      storeIdentityMoveUndo(personId, null);
      return null;
    }
    return receipt as CimmichIdentityMoveUndo;
  } catch {
    storeIdentityMoveUndo(personId, null);
    return null;
  }
};
