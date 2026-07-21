import type { CimmichVisibilityStatus } from '$lib/services/cimmich.service';

export const shouldApplyViewingModeResponse = (responseIntentSequence: number, latestIntentSequence: number) =>
  responseIntentSequence === latestIntentSequence;

export const isViewingModeStatus = (value: unknown): value is CimmichVisibilityStatus => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const status = value as Record<string, unknown>;
  return (
    ['standard', 'personal', 'private'].includes(String(status.viewingMode)) &&
    typeof status.privateAuthorized === 'boolean' &&
    typeof status.privateConfigured === 'boolean'
  );
};
