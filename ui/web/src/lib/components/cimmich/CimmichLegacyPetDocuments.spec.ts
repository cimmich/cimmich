import '@testing-library/jest-dom';
import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CimmichLegacyPetDocuments from './CimmichLegacyPetDocuments.svelte';

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
  adopt: vi.fn(),
  getLinks: vi.fn(),
  undo: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal()),
  adoptCimmichLegacyPetDocument: mocks.adopt,
  getCimmichLegacyPetDocumentLinks: mocks.getLinks,
  undoCimmichLegacyPetDocumentAdoption: mocks.undo,
}));

const candidate = {
  adoptedDocumentId: null,
  adoptionId: null,
  assetId: 'asset_1',
  documentKind: 'vaccination',
  documentLabel: 'Annual vaccination',
  legacyAssociationId: 'petdoc_1',
  linkedAt: '2026-07-17T00:00:00.000Z',
  mediaKind: 'image',
  mimeType: 'image/jpeg',
  petId: 'pet_1',
  petName: 'Test Pet',
  state: 'available',
} as const;

describe('CimmichLegacyPetDocuments', () => {
  beforeEach(() => {
    mocks.getLinks.mockReset().mockResolvedValue({ items: [], schemaVersion: 'cimmich.document-legacy-pet.v1' });
    mocks.adopt.mockReset();
    mocks.undo.mockReset();
  });

  it('stays visually absent when a Pet has no schema-43 compatibility candidates', async () => {
    const { container, queryByText } = render(CimmichLegacyPetDocuments, {
      petId: 'pet_1',
      petName: 'Test Pet',
    });

    await waitFor(() => expect(mocks.getLinks).toHaveBeenCalledWith({ petId: 'pet_1' }));
    expect(queryByText('Add photo-linked records to Documents')).not.toBeInTheDocument();
    expect(container.querySelector('section')).toBeNull();
  });

  it('presents title and visibility before adoption, then offers decision-scoped Undo', async () => {
    const onchanged = vi.fn();
    mocks.getLinks
      .mockResolvedValueOnce({ items: [candidate], schemaVersion: 'cimmich.document-legacy-pet.v1' })
      .mockResolvedValueOnce({ items: [], schemaVersion: 'cimmich.document-legacy-pet.v1' })
      .mockResolvedValueOnce({ items: [candidate], schemaVersion: 'cimmich.document-legacy-pet.v1' });
    mocks.adopt.mockResolvedValue({
      adoptionId: 'adoption_1',
      changed: true,
      createdDocument: true,
      createdLink: true,
      decisionId: 'decision_1',
      documentId: 'document_1',
      legacyAssociationId: candidate.legacyAssociationId,
      reactivatedDocument: false,
      replayed: false,
      schemaVersion: 'cimmich.document-legacy-pet.v1',
    });
    mocks.undo.mockResolvedValue({
      adoptionId: 'adoption_1',
      changed: true,
      createdDocument: true,
      createdLink: true,
      decisionId: 'decision_2',
      documentId: 'document_1',
      legacyAssociationId: candidate.legacyAssociationId,
      reactivatedDocument: false,
      replayed: false,
      schemaVersion: 'cimmich.document-legacy-pet.v1',
      undoneDecisionId: 'decision_1',
    });
    const { findByRole, findByText, getByLabelText, getByRole } = render(CimmichLegacyPetDocuments, {
      onchanged,
      petId: 'pet_1',
      petName: 'Test Pet',
    });

    await findByText('Add photo-linked records to Documents');
    await fireEvent.click(getByRole('button', { name: 'Add to Documents' }));
    const dialog = getByRole('dialog', { name: 'Add to Documents' });
    expect(dialog).toBeInTheDocument();
    expect(getByLabelText('Title')).toHaveValue('Annual vaccination');
    expect(getByLabelText('Visibility')).toHaveValue('standard');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Add to Documents' }));

    await waitFor(() =>
      expect(mocks.adopt).toHaveBeenCalledWith(
        candidate.legacyAssociationId,
        expect.objectContaining({ displayTitle: 'Annual vaccination', visibilityTier: 'standard' }),
      ),
    );
    expect(await findByText(/is now in Documents/)).toBeInTheDocument();
    expect(onchanged).toHaveBeenCalledOnce();

    await fireEvent.click(getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(mocks.undo).toHaveBeenCalledWith('decision_1', expect.any(String)));
    expect(onchanged).toHaveBeenCalledTimes(2);
    expect(await findByRole('button', { name: 'Add to Documents' })).toBeInTheDocument();
  });
});
