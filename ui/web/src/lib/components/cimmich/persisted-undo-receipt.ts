export type CimmichUndoReceiptContext = {
  ownerId: string;
  sessionId: string;
  viewingMode: 'personal' | 'private' | 'standard';
};

export const PERSISTED_UNDO_RECEIPT_TTL_MS = 30 * 60_000;

type ReceiptStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

type PersistedUndoReceiptEnvelope = {
  binding: CimmichUndoReceiptContext & { expiresAt: number };
  receipt: unknown;
  version: 2;
};

const validContext = (value: unknown): value is CimmichUndoReceiptContext => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const context = value as Record<string, unknown>;
  return (
    typeof context.ownerId === 'string' &&
    context.ownerId.length > 0 &&
    typeof context.sessionId === 'string' &&
    context.sessionId.length > 0 &&
    ['personal', 'private', 'standard'].includes(String(context.viewingMode))
  );
};

export const sameCimmichUndoReceiptContext = (
  left: CimmichUndoReceiptContext | null,
  right: CimmichUndoReceiptContext | null,
) =>
  left?.ownerId === right?.ownerId && left?.sessionId === right?.sessionId && left?.viewingMode === right?.viewingMode;

export const loadPersistedUndoReceipt = <T>(
  storage: Pick<ReceiptStorage, 'getItem' | 'removeItem'>,
  key: string,
  context: CimmichUndoReceiptContext | null,
  isReceipt: (value: unknown) => value is T,
  now = Date.now(),
): T | null => {
  try {
    const serialized = storage.getItem(key);
    if (!serialized) {
      return null;
    }
    const parsed = JSON.parse(serialized) as Partial<PersistedUndoReceiptEnvelope>;
    const binding = parsed?.binding;
    if (
      parsed?.version === 2 &&
      context &&
      validContext(binding) &&
      Number.isFinite(binding.expiresAt) &&
      Number(binding.expiresAt) > now &&
      sameCimmichUndoReceiptContext(binding, context) &&
      isReceipt(parsed.receipt)
    ) {
      return parsed.receipt;
    }
    storage.removeItem(key);
  } catch {
    storage.removeItem(key);
  }
  return null;
};

export const savePersistedUndoReceipt = <T>(
  storage: Pick<ReceiptStorage, 'removeItem' | 'setItem'>,
  key: string,
  receipt: T | null,
  context: CimmichUndoReceiptContext | null,
  now = Date.now(),
) => {
  try {
    if (!receipt || !context || !validContext(context)) {
      storage.removeItem(key);
      return;
    }
    const envelope: PersistedUndoReceiptEnvelope = {
      binding: {
        ...context,
        expiresAt: now + PERSISTED_UNDO_RECEIPT_TTL_MS,
      },
      receipt,
      version: 2,
    };
    storage.setItem(key, JSON.stringify(envelope));
  } catch {
    // The in-memory receipt remains usable when browser storage is blocked.
  }
};
