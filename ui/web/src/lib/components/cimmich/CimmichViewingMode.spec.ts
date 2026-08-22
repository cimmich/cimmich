import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichViewingMode from './CimmichViewingMode.svelte';
import { CIMMICH_VIEWING_MODE_PREFERENCE_KEY } from './cimmich-viewing-mode-preference';

const service = vi.hoisted(() => {
  let sequence = Date.now();
  const status = (viewingMode: 'personal' | 'private' | 'standard', privateAuthorized = true) => ({
    capabilities: {
      album: false,
      asset: true,
      collection: false,
      contextEntity: true,
      document: true,
      entityProfile: true,
    },
    forcedStandard: false,
    inactivitySeconds: 900,
    maxPrivateSessionSeconds: 3600,
    principalBound: true,
    principalId: 'owner-1',
    privateAuthorized,
    privateConfigured: true,
    privateLockMode: 'none' as const,
    schemaVersion: 'cimmich.visibility.v1' as const,
    surface: 'interactive' as const,
    viewingMode,
  });
  return {
    createIntent: vi.fn(() => ++sequence),
    getStatus: vi.fn(() => Promise.resolve(status('standard'))),
    lock: vi.fn(() => Promise.resolve(status('standard', false))),
    setMode: vi.fn((viewingMode: 'personal' | 'private' | 'standard', intentSequence: number) =>
      Promise.resolve({ ...status(viewingMode), applied: true, intentSequence }),
    ),
    status,
    unlock: vi.fn(() =>
      Promise.resolve({
        expiresAt: '2026-08-11T13:00:00.000Z',
        schemaVersion: 'cimmich.visibility.v1' as const,
        viewingMode: 'private' as const,
      }),
    ),
  };
});

vi.mock('$lib/services/cimmich.service', () => ({
  createCimmichViewingModeIntentSequence: service.createIntent,
  getCimmichVisibilityStatus: service.getStatus,
  lockCimmichPrivateMode: service.lock,
  setCimmichViewingMode: service.setMode,
  unlockCimmichPrivateMode: service.unlock,
}));

describe('CimmichViewingMode preference restoration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    service.getStatus.mockResolvedValue(service.status('standard'));
  });

  it('makes Private the first-use default on a passwordless installation', async () => {
    const { findByRole } = render(CimmichViewingMode);

    expect(await findByRole('button', { name: 'Viewing mode: Private' })).toBeVisible();
    expect(service.setMode).toHaveBeenCalledWith('private', expect.any(Number));
  });

  it('restores a saved explicit preference', async () => {
    localStorage.setItem(CIMMICH_VIEWING_MODE_PREFERENCE_KEY, 'personal');
    const { findByRole } = render(CimmichViewingMode);

    expect(await findByRole('button', { name: 'Viewing mode: Personal' })).toBeVisible();
    expect(service.setMode).toHaveBeenCalledWith('personal', expect.any(Number));
  });

  it('does not bypass a password-protected Private boundary', async () => {
    service.getStatus.mockResolvedValue(service.status('standard', false));
    const { findByRole } = render(CimmichViewingMode);

    expect(await findByRole('button', { name: 'Viewing mode: Standard' })).toBeVisible();
    await waitFor(() => expect(service.setMode).not.toHaveBeenCalled());
  });

  it('saves a deliberate mode change for the next load', async () => {
    localStorage.setItem(CIMMICH_VIEWING_MODE_PREFERENCE_KEY, 'standard');
    const { findByRole, getByRole } = render(CimmichViewingMode);
    await findByRole('button', { name: 'Viewing mode: Standard' });

    await fireEvent.click(getByRole('button', { name: 'Viewing mode: Standard' }));
    await fireEvent.click(getByRole('button', { name: 'Personal' }));

    await waitFor(() => expect(localStorage.getItem(CIMMICH_VIEWING_MODE_PREFERENCE_KEY)).toBe('personal'));
  });

  it('refreshes from server truth when another tab changes the viewing mode preference', async () => {
    const { findByRole } = render(CimmichViewingMode);
    await findByRole('button', { name: 'Viewing mode: Private' });
    service.getStatus.mockResolvedValue(service.status('personal'));
    localStorage.setItem(CIMMICH_VIEWING_MODE_PREFERENCE_KEY, 'personal');

    globalThis.dispatchEvent(
      new StorageEvent('storage', {
        key: CIMMICH_VIEWING_MODE_PREFERENCE_KEY,
        newValue: 'personal',
      }),
    );

    expect(await findByRole('button', { name: 'Viewing mode: Personal' })).toBeVisible();
  });
});
