import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import type { CimmichPrivateCredentialStatus } from '$lib/services/cimmich.service';
import CimmichPrivateViewSettings from './CimmichPrivateViewSettings.svelte';

const renderPanel = () => render(TestWrapper, { component: CimmichPrivateViewSettings, componentProps: {} });

const { clearCredential, getCredential, setCredential } = vi.hoisted(() => ({
  clearCredential: vi.fn(),
  getCredential: vi.fn(),
  setCredential: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', () => ({
  clearCimmichPrivateCredential: clearCredential,
  getCimmichPrivateCredentialStatus: getCredential,
  setCimmichPrivateCredential: setCredential,
}));

const status = (overrides: Partial<CimmichPrivateCredentialStatus> = {}): CimmichPrivateCredentialStatus => ({
  algorithm: 'scrypt-v1',
  configured: true,
  principalId: 'local-primary',
  privateLockMode: 'password',
  protectionKind: 'presentation_filter',
  schemaVersion: 'cimmich.visibility.v1',
  updatedAt: '2026-07-01T10:00:00.000Z',
  ...overrides,
});

describe('CimmichPrivateViewSettings', () => {
  beforeEach(() => {
    clearCredential.mockReset();
    getCredential.mockReset();
    setCredential.mockReset();
  });

  it('names the boundary: the password filters what is shown, Immich controls access', async () => {
    getCredential.mockResolvedValue(status());
    const { getByText } = renderPanel();

    await waitFor(() => expect(getByText('This password filters what is shown.')).toBeVisible());
    expect(getByText(/Immich does that, with your Immich account/)).toBeVisible();
    expect(getByText(/Switching to Immich shows everything, by design/)).toBeVisible();
  });

  it('offers a single button to set the password when none exists', async () => {
    getCredential.mockResolvedValue(status({ configured: false, updatedAt: null }));
    setCredential.mockResolvedValue(status());
    const { getByRole, getByLabelText, queryByLabelText } = renderPanel();

    await waitFor(() => expect(getByRole('button', { name: 'Set password' })).toBeVisible());
    await fireEvent.click(getByRole('button', { name: 'Set password' }));

    expect(queryByLabelText(/current/i)).toBeNull();
    await fireEvent.input(getByLabelText('Password'), { target: { value: 'tv night' } });
    await fireEvent.click(getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(setCredential).toHaveBeenCalledWith('tv night'));
    expect(getByRole('status')).toHaveTextContent('Any open Private session has been closed.');
  });

  it('resets an existing password without asking for the old one', async () => {
    getCredential.mockResolvedValue(status());
    setCredential.mockResolvedValue(status({ updatedAt: '2026-07-23T09:00:00.000Z' }));
    const { getByRole, getByLabelText, queryByLabelText } = renderPanel();

    await waitFor(() => expect(getByRole('button', { name: 'Reset password' })).toBeVisible());
    await fireEvent.click(getByRole('button', { name: 'Reset password' }));

    expect(queryByLabelText('Password')).toBeNull();
    await fireEvent.input(getByLabelText('New password'), { target: { value: 'something new' } });
    await fireEvent.click(getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(setCredential).toHaveBeenCalledWith('something new'));
  });

  it('turns the filter off and says what that means', async () => {
    getCredential.mockResolvedValue(status());
    clearCredential.mockResolvedValue(status({ algorithm: null, configured: false, updatedAt: null }));
    const { getByRole } = renderPanel();

    await waitFor(() => expect(getByRole('button', { name: 'Turn off' })).toBeVisible());
    await fireEvent.click(getByRole('button', { name: 'Turn off' }));

    await waitFor(() => expect(clearCredential).toHaveBeenCalled());
    expect(getByRole('status')).toHaveTextContent('Private view is unavailable until you set one again.');
    expect(getByRole('button', { name: 'Set password' })).toBeVisible();
  });

  it('does not offer a password when the installation is intentionally passwordless', async () => {
    getCredential.mockResolvedValue(status({ configured: false, privateLockMode: 'none', updatedAt: null }));
    const { getByText, queryByRole } = renderPanel();

    await waitFor(() => expect(getByText(/passwordless Private view/)).toBeVisible());
    expect(queryByRole('button', { name: 'Set password' })).toBeNull();
  });

  it('surfaces a retry when Cimmich is unreachable rather than implying the filter is off', async () => {
    getCredential.mockRejectedValueOnce(new Error('Cimmich service is unavailable'));
    getCredential.mockResolvedValue(status());
    const { getByRole, getByText } = renderPanel();

    await waitFor(() => expect(getByText('Cimmich service is unavailable')).toBeVisible());
    await fireEvent.click(getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(getByRole('button', { name: 'Reset password' })).toBeVisible());
  });
});
