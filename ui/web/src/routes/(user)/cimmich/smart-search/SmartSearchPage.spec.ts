import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SmartSearchPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  replaceState: vi.fn(),
  searchSmart: vi.fn(),
}));

vi.mock('$app/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app/navigation')>()),
  replaceState: mocks.replaceState,
}));

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  return await import('@test-data/mocks/UserPageLayout.mock.svelte');
});

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/cimmich.service')>()),
  getCimmichDocuments: mocks.getDocuments,
  searchCimmichSmart: mocks.searchSmart,
}));

describe('Smart Search lens continuity', () => {
  beforeEach(() => {
    mocks.getDocuments.mockReset().mockResolvedValue({ items: [], schemaVersion: 'cimmich.document.v1' });
    mocks.replaceState.mockReset();
    mocks.searchSmart.mockReset();
  });

  it('keeps submitted Document state isolated while switching lenses', async () => {
    const user = userEvent.setup();
    const rendered = render(SmartSearchPage, {
      data: {
        initialLens: 'documents',
        initialQuery: 'Passport',
        meta: { title: 'Smart Search' },
      },
    });

    const documentInput = await rendered.findByRole('textbox', { name: 'Search documents' });
    expect(documentInput).toHaveValue('Passport');
    await waitFor(() =>
      expect(mocks.getDocuments).toHaveBeenCalledWith(expect.objectContaining({ query: 'Passport' })),
    );
    expect(mocks.searchSmart).not.toHaveBeenCalled();

    await user.clear(documentInput);
    await user.type(documentInput, '  Updated passport  ');
    await fireEvent.submit(rendered.getByRole('search'));

    await waitFor(() =>
      expect((mocks.replaceState.mock.lastCall?.[0] as URL).searchParams.get('q')).toBe('Updated passport'),
    );
    expect(mocks.getDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Updated passport' }));

    await user.click(rendered.getByRole('tab', { name: 'Photos' }));
    expect((mocks.replaceState.mock.lastCall?.[0] as URL).searchParams.get('q')).toBeNull();
    expect(rendered.getByRole('textbox', { name: 'Search your Cimmich library' })).toHaveValue('');
    expect(mocks.searchSmart).not.toHaveBeenCalled();

    await user.click(rendered.getByRole('tab', { name: 'All documents' }));
    expect(await rendered.findByRole('textbox', { name: 'Search documents' })).toHaveValue('Updated passport');
    expect((mocks.replaceState.mock.lastCall?.[0] as URL).searchParams.get('q')).toBe('Updated passport');
  });
});
