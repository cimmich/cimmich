import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CimmichPersonNamesEditor from './CimmichPersonNamesEditor.svelte';

const mocks = vi.hoisted(() => ({
  addAlias: vi.fn(),
  removeAlias: vi.fn(),
  setDisplayName: vi.fn(),
}));

vi.mock('$lib/services/cimmich-person-names.service', () => ({
  addCimmichPersonAlias: mocks.addAlias,
  removeCimmichPersonAlias: mocks.removeAlias,
  setCimmichPersonDisplayName: mocks.setDisplayName,
}));

const setup = {
  alias_items: [],
  aliases: [],
  categories: [],
  category_catalog: [],
  current_revision: 4,
  display_name: 'Imported Label',
  merges: [],
  person_id: 'person.one',
  status: 'active',
  subject_kind: 'person',
} as const;

describe('CimmichPersonNamesEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setDisplayName.mockResolvedValue({
      changed: true,
      displayName: 'Desired Name',
      personId: 'person.one',
      previousDisplayName: 'Imported Label',
    });
  });

  it('offers the canonical display name and saves it through the owner command', async () => {
    const onchanged = vi.fn();
    const rendered = render(CimmichPersonNamesEditor, {
      onchanged,
      personId: 'person.one',
      setup,
    });
    const user = userEvent.setup();

    expect(rendered.getByRole('option', { name: 'Display name (recorded)' })).toBeVisible();
    await fireEvent.click(rendered.getByRole('button', { name: 'Change display name' }));
    const input = rendered.getByRole('textbox', { name: 'Recorded display name' });
    await user.clear(input);
    await user.type(input, 'Desired Name');
    await fireEvent.click(rendered.getByRole('button', { name: 'Change' }));

    await waitFor(() => expect(mocks.setDisplayName).toHaveBeenCalledWith('person.one', 'Desired Name'));
    expect(onchanged).toHaveBeenCalledWith('Desired Name');
    expect(mocks.addAlias).not.toHaveBeenCalled();
  });
});
