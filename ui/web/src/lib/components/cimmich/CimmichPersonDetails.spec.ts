import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichPersonDetails from './CimmichPersonDetails.svelte';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});

const mocks = vi.hoisted(() => ({
  patchDetailsDefaults: vi.fn(),
  patchDetailsDisplay: vi.fn(),
  patchDefaults: vi.fn(),
  patchDisplay: vi.fn(),
  patchProfile: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', () => ({
  CimmichServiceError: class CimmichServiceError extends Error {
    code = 'TEST';
  },
  createCimmichPersonProfileCommandId: () => 'profile.test.00000000-0000-4000-8000-000000000000',
  createCimmichPersonProfileItemId: () => 'profile-item.00000000-0000-4000-8000-000000000000',
  patchCimmichPersonDetailsDisplay: mocks.patchDetailsDisplay,
  patchCimmichPersonDetailsDisplayDefaults: mocks.patchDetailsDefaults,
  patchCimmichPersonProfile: mocks.patchProfile,
  patchCimmichPersonProfileDisplay: mocks.patchDisplay,
  patchCimmichPersonProfileDisplayDefaults: mocks.patchDefaults,
}));

const profile = {
  items: [],
  person: { displayName: 'Maya Chen', personId: 'person_1', status: 'active' as const },
  profile: {
    about: null,
    genderIdentityKind: null,
    genderIdentityLabel: null,
    privateNotes: null,
    pronounsLabel: null,
    revision: 1,
  },
  relationshipCatalog: [
    { categoryId: 'relationship_me', name: 'Me', slug: 'me', sortOrder: 1 },
    { categoryId: 'relationship_family', name: 'Family', slug: 'family', sortOrder: 2 },
  ],
  relationships: [{ categoryId: 'relationship_me', name: 'Me', slug: 'me', sortOrder: 1 }],
  schemaVersion: 'cimmich.person-profile.v1' as const,
};

const display = {
  fields: [
    {
      defaultVisible: true,
      effectiveVisible: true,
      fieldKey: 'about' as const,
      order: 1,
      visibility: 'inherit' as const,
    },
  ],
  owner: { ownerId: 'local-primary' as const, ownerKind: 'local_library' as const },
  personId: 'person_1',
  schemaVersion: 'cimmich.person-profile.v1' as const,
};

const defaults = {
  fields: [{ fieldKey: 'about' as const, order: 1, visible: true }],
  owner: { ownerId: 'local-primary' as const, ownerKind: 'local_library' as const },
  schemaVersion: 'cimmich.person-profile.v1' as const,
};

const detailsSectionKeys = [
  'about',
  'at_a_glance',
  'identity_summary',
  'important_dates',
  'work',
  'contact_details',
  'social',
  'address',
  'private_notes',
] as const;

const detailsDefaults = {
  owner: { ownerId: 'local-primary' as const, ownerKind: 'local_library' as const },
  schemaVersion: 'cimmich.person-details-display.v1' as const,
  sections: detailsSectionKeys.map((sectionKey, order) => ({ order, sectionKey, visible: true })),
};

const detailsDisplay = {
  owner: { ownerId: 'local-primary' as const, ownerKind: 'local_library' as const },
  personId: 'person_1',
  schemaVersion: 'cimmich.person-details-display.v1' as const,
  sections: detailsSectionKeys.map((sectionKey, order) => ({
    defaultVisible: true,
    effectiveVisible: true,
    order,
    sectionKey,
    visibility: 'inherit' as const,
  })),
};

const renderDetails = (startInEdit = false, compact = false) =>
  render(CimmichPersonDetails, {
    aliases: [],
    compact,
    defaults,
    detailsDefaults,
    detailsDisplay,
    display,
    ondefaultschange: vi.fn(),
    ondetailsdefaultschange: vi.fn(),
    ondetailsdisplaychange: vi.fn(),
    ondisplaychange: vi.fn(),
    onopenidentitysettings: vi.fn(),
    onprofilechange: vi.fn(),
    profile,
    startInEdit,
  });

describe('CimmichPersonDetails', () => {
  beforeEach(() => {
    mocks.patchDetailsDefaults.mockReset();
    mocks.patchDetailsDisplay.mockReset();
    mocks.patchDefaults.mockReset();
    mocks.patchDisplay.mockReset();
    mocks.patchProfile.mockReset();
  });

  it('persists one Person Details visibility override without changing People defaults', async () => {
    mocks.patchDetailsDisplay.mockResolvedValueOnce({
      display: {
        ...detailsDisplay,
        sections: detailsDisplay.sections.map((section) =>
          section.sectionKey === 'private_notes'
            ? { ...section, effectiveVisible: false, visibility: 'hide' as const }
            : section,
        ),
      },
      replayed: false,
    });
    const { getByRole } = renderDetails();

    await fireEvent.click(getByRole('button', { name: 'Choose visible Details sections' }));
    await fireEvent.click(getByRole('button', { name: 'Notes: Hide' }));
    await fireEvent.click(getByRole('button', { name: 'Save for this person' }));

    await waitFor(() => expect(mocks.patchDetailsDisplay).toHaveBeenCalledOnce());
    expect(mocks.patchDetailsDefaults).not.toHaveBeenCalled();
    expect(mocks.patchDetailsDisplay.mock.calls[0]?.[2]).toContainEqual({
      sectionKey: 'private_notes',
      visibility: 'hide',
    });
  });

  it('persists all nine People Details defaults with their stable order', async () => {
    mocks.patchDetailsDefaults.mockResolvedValueOnce({ defaults: detailsDefaults, replayed: false });
    const { getByRole } = renderDetails();

    await fireEvent.click(getByRole('button', { name: 'Choose visible Details sections' }));
    await fireEvent.click(getByRole('tab', { name: 'People defaults' }));
    await fireEvent.click(getByRole('checkbox', { name: 'Social profiles shown by default' }));
    await fireEvent.click(getByRole('button', { name: 'Save People defaults' }));

    await waitFor(() => expect(mocks.patchDetailsDefaults).toHaveBeenCalledOnce());
    expect(mocks.patchDetailsDefaults.mock.calls[0]?.[1]).toHaveLength(9);
    expect(mocks.patchDetailsDefaults.mock.calls[0]?.[1]).toContainEqual({
      order: 6,
      sectionKey: 'social',
      visible: false,
    });
  });

  it('keeps a quick-added detail in the draft and makes Cancel truthful', async () => {
    const { getByRole, getByText, queryByText } = renderDetails();

    await fireEvent.click(getByRole('button', { name: 'Add Contact details' }));
    await fireEvent.input(getByRole('textbox', { name: 'Phone number' }), { target: { value: '0400 000 000' } });
    await fireEvent.click(getByRole('button', { name: 'Add detail' }));

    expect(getByText('0400 000 000')).toBeInTheDocument();
    expect(mocks.patchProfile).not.toHaveBeenCalled();

    await fireEvent.click(getByRole('button', { name: 'Cancel' }));
    expect(queryByText('0400 000 000')).not.toBeInTheDocument();
    expect(mocks.patchProfile).not.toHaveBeenCalled();
  });

  it('commits only the edited detail section', async () => {
    mocks.patchProfile.mockResolvedValueOnce({ profile, replayed: false });
    const { getByRole } = renderDetails();

    await fireEvent.click(getByRole('button', { name: 'Add Contact details' }));
    expect(getByRole('button', { name: 'Phone' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Website' })).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Email' }));
    await fireEvent.input(getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'maya@example.test' },
    });
    await fireEvent.click(getByRole('button', { name: 'Save Contact details' }));

    await waitFor(() => expect(mocks.patchProfile).toHaveBeenCalledOnce());
    expect(mocks.patchProfile.mock.calls[0]?.[1]).toEqual({
      commandId: 'profile.test.00000000-0000-4000-8000-000000000000',
      itemCommands: [
        {
          action: 'add',
          item: {
            dateValue: null,
            itemId: 'profile-item.00000000-0000-4000-8000-000000000000',
            kind: 'email',
            label: 'Personal',
            secondaryValue: null,
            value: 'maya@example.test',
          },
        },
      ],
    });
  });

  it('saves only this Person from Shown in hero', async () => {
    mocks.patchDisplay.mockResolvedValueOnce({
      display: { ...display, fields: [{ ...display.fields[0], visibility: 'hide' }] },
    });
    const { getByRole } = renderDetails(true);

    await fireEvent.click(getByRole('tab', { name: 'Shown in hero' }));
    await fireEvent.click(getByRole('button', { name: 'Hide' }));
    await fireEvent.click(getByRole('button', { name: 'Save display' }));

    await waitFor(() => expect(mocks.patchDisplay).toHaveBeenCalledOnce());
    expect(mocks.patchDefaults).not.toHaveBeenCalled();
  });

  it('shows discoverable empty sections, identity and aliases without opening settings', () => {
    const { getByRole, getByText, queryByRole } = renderDetails();

    for (const heading of [
      'About',
      'At a glance',
      'Identity',
      'Important dates',
      'Work and organisations',
      'Contact details',
      'Social profiles',
      'Addresses',
      'Notes',
    ]) {
      expect(getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(getByText('Maya Chen')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Edit Identity' })).toBeInTheDocument();
    for (const removedHeading of ['Email', 'Phone', 'Websites', 'Other details']) {
      expect(queryByRole('heading', { name: removedHeading })).not.toBeInTheDocument();
    }
    expect(queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
  });

  it('keeps every useful compact detail discoverable without empty-card clutter', () => {
    const { getAllByText, getByRole, getByText, queryByRole } = renderDetails(false, true);

    expect(getByRole('heading', { name: 'At a glance' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Identity' })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Add details' })).not.toBeInTheDocument();
    expect(queryByRole('heading', { name: 'About' })).not.toBeInTheDocument();
    expect(getByRole('heading', { name: 'Add to Maya Chen' })).toBeInTheDocument();
    for (const detail of ['Important date', 'Work', 'Contact', 'Social profile', 'Address', 'Note']) {
      expect(getByRole('button', { name: detail })).toBeInTheDocument();
    }
    for (const emptySection of [
      'Important dates',
      'Work and organisations',
      'Contact details',
      'Social profiles',
      'Addresses',
      'Notes',
    ]) {
      expect(queryByRole('heading', { name: emptySection })).not.toBeInTheDocument();
    }
    expect(getByText('Pronouns')).toBeInTheDocument();
    expect(getByText('Gender identity')).toBeInTheDocument();
    expect(getAllByText('Not set')).toHaveLength(3);
  });

  it('uses a real Birthday selection and places required-date feedback at the date field', async () => {
    const { getByRole } = renderDetails();

    await fireEvent.click(getByRole('button', { name: 'Add Important dates' }));
    expect(getByRole('textbox', { name: 'Occasion' })).toHaveValue('Birthday');
    expect(getByRole('textbox', { name: 'Occasion' })).toHaveFocus();

    await fireEvent.click(getByRole('button', { name: 'Add detail' }));
    expect(getByRole('alert')).toHaveTextContent('Choose a date.');
    expect(getByRole('textbox', { name: 'Occasion' })).not.toHaveAttribute('aria-invalid', 'true');
    expect(getByRole('textbox', { name: 'Occasion' }).nextElementSibling).toBeNull();
    expect(document.querySelector('input[type="date"]')).toHaveAttribute('aria-invalid', 'true');
  });

  it('offers social-platform presets and names the profile field in human terms', async () => {
    const { getByRole } = renderDetails();

    await fireEvent.click(getByRole('button', { name: 'Add Social profiles' }));

    expect(getByRole('textbox', { name: 'Platform' })).toHaveValue('Instagram');
    expect(getByRole('textbox', { name: 'Profile URL or @username' })).toBeInTheDocument();
    for (const platform of ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'X', 'Mastodon', 'Other']) {
      expect(getByRole('button', { name: platform })).toBeInTheDocument();
    }
  });

  it('opens About directly from its card pencil and focuses the field', async () => {
    const { getByRole, queryByRole } = renderDetails();

    await fireEvent.click(getByRole('button', { name: 'Edit About' }));

    expect(getByRole('textbox', { name: 'About' })).toHaveFocus();
    expect(getByRole('heading', { name: 'Identity' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Contact details' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Save About' })).toBeInTheDocument();
    expect(queryByRole('tablist', { name: 'Profile editor' })).not.toBeInTheDocument();
  });

  it('saves only About from the About card', async () => {
    mocks.patchProfile.mockResolvedValueOnce({ profile, replayed: false });
    const { getByRole } = renderDetails();

    await fireEvent.click(getByRole('button', { name: 'Edit About' }));
    await fireEvent.input(getByRole('textbox', { name: 'About' }), { target: { value: 'A trusted friend.' } });
    await fireEvent.click(getByRole('button', { name: 'Save About' }));

    await waitFor(() => expect(mocks.patchProfile).toHaveBeenCalledOnce());
    expect(mocks.patchProfile.mock.calls[0]?.[1]).toEqual({
      about: 'A trusted friend.',
      commandId: 'profile.test.00000000-0000-4000-8000-000000000000',
    });
  });

  it('saves only At a glance fields', async () => {
    mocks.patchProfile.mockResolvedValueOnce({ profile, replayed: false });
    const { getByRole } = renderDetails();

    await fireEvent.click(getByRole('button', { name: 'Edit At a glance' }));
    await fireEvent.click(getByRole('button', { name: 'Family' }));
    await fireEvent.input(getByRole('textbox', { name: 'Pronouns' }), { target: { value: 'he/him' } });
    await fireEvent.click(getByRole('button', { name: 'Save At a glance' }));

    await waitFor(() => expect(mocks.patchProfile).toHaveBeenCalledOnce());
    expect(mocks.patchProfile.mock.calls[0]?.[1]).toEqual({
      commandId: 'profile.test.00000000-0000-4000-8000-000000000000',
      genderIdentityKind: null,
      genderIdentityLabel: null,
      pronounsLabel: 'he/him',
      relationshipCategoryIds: ['relationship_me', 'relationship_family'],
    });
  });
});
