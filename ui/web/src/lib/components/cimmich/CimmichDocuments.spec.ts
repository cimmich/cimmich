import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cimmichVisibilityManager } from '$lib/managers/cimmich-visibility-manager.svelte';
import { CimmichServiceError } from '$lib/services/cimmich.service';
import CimmichDocuments from './CimmichDocuments.svelte';

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
  getAssetEvidence: vi.fn(),
  getDocumentContent: vi.fn(),
  getDocument: vi.fn(),
  getDocuments: vi.fn(),
  importDocument: vi.fn(),
  searchAssets: vi.fn(),
  setVisibility: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal()),
  searchAssets: mocks.searchAssets,
}));

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal()),
  attachCimmichDocumentLinks: vi.fn(),
  detachCimmichDocumentLinks: vi.fn(),
  getCimmichAssetEvidence: mocks.getAssetEvidence,
  getCimmichDocument: mocks.getDocument,
  getCimmichDocumentContent: mocks.getDocumentContent,
  getCimmichDocuments: mocks.getDocuments,
  importCimmichDocument: mocks.importDocument,
  referenceCimmichDocument: vi.fn(),
  setCimmichVisibilityObject: mocks.setVisibility,
  undoCimmichDocumentDecision: vi.fn(),
  updateCimmichDocument: mocks.updateDocument,
}));

const listDocument = {
  displayTitle: 'Synthetic certificate',
  documentId: 'document_00000000000000000000000000000001',
  documentKind: 'certificate',
  documentLabel: null,
  effectiveVisibilityTier: 'standard',
  expiresOn: null,
  issuedOn: '2026-01-02',
  preview: { available: true, disposition: 'inline', mimeType: 'application/pdf' },
  revision: 1,
  source: {
    assetId: null,
    byteSize: 4,
    contentSha256: 'a'.repeat(64),
    filename: 'synthetic.pdf',
    kind: 'cimmich_file',
    mimeType: 'application/pdf',
    sourceContentHash: null,
  },
  status: 'active',
  subjectCount: 1,
  supersededByDocumentId: null,
  supersedesDocumentId: null,
  updatedAt: '2026-07-17T00:00:00.000Z',
  visibilityTier: 'standard',
} as const;

describe('CimmichDocuments', () => {
  beforeEach(() => {
    mocks.getDocuments.mockReset().mockResolvedValue({ items: [], schemaVersion: 'cimmich.document.v1' });
    mocks.importDocument.mockReset();
    mocks.getDocument.mockReset();
    mocks.getDocumentContent.mockReset();
    mocks.getAssetEvidence.mockReset();
    mocks.searchAssets.mockReset().mockResolvedValue({ assets: { items: [] } });
    mocks.setVisibility.mockReset();
    mocks.updateDocument.mockReset();
  });

  it('renders an honest entity-scoped empty state and keeps existing-link discovery visible', async () => {
    const { findByText, getByRole, queryByRole } = render(CimmichDocuments, {
      heading: 'Documents for Test Person',
      subject: { id: 'person_1', kind: 'person', name: 'Test Person' },
    });

    expect(await findByText('No documents linked to Test Person')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Link existing' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Add document' })).toBeInTheDocument();
    expect(queryByRole('search')).not.toBeInTheDocument();
    expect(mocks.getDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 'person_1', subjectKind: 'person' }),
    );
  });

  it('starts from an exact Smart Search title when opened from a Document result', async () => {
    const { findByText } = render(CimmichDocuments, { initialQuery: 'Audit Plain Document' });

    expect(await findByText('No documents match')).toBeInTheDocument();
    expect(mocks.getDocuments).toHaveBeenCalledWith(expect.objectContaining({ query: 'Audit Plain Document' }));
  });

  it('renders referenced Documents as visual cards without redundant subject copy', async () => {
    const sourceAssetId = '4b789ca4-8bf8-4a7a-b6bb-7ab74a5365fd';
    mocks.getDocuments.mockResolvedValueOnce({
      items: [
        {
          ...listDocument,
          source: {
            ...listDocument.source,
            assetId: sourceAssetId,
            filename: 'synthetic-artwork.png',
            kind: 'immich_asset' as const,
            mimeType: 'image/png',
          },
        },
      ],
      schemaVersion: 'cimmich.document.v1',
    });

    const { findByRole, queryByText } = render(CimmichDocuments, {
      heading: 'Documents for Test Person',
      subject: { id: 'person_1', kind: 'person', name: 'Test Person' },
    });

    expect(await findByRole('img', { name: 'Preview of Synthetic certificate' })).toHaveAttribute(
      'src',
      expect.stringContaining(sourceAssetId),
    );
    expect(queryByText('Records linked to Test Person.')).not.toBeInTheDocument();
    expect(await findByRole('search')).toBeInTheDocument();
  });

  it('offers import and photo-library reference as source choices without implying OCR', async () => {
    const { findByText, getByRole, queryByText } = render(CimmichDocuments);
    await findByText('No documents yet');
    await fireEvent.click(getByRole('button', { name: 'Add document' }));

    expect(getByRole('dialog', { name: 'Add a document' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Import file' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Photo library' })).toBeInTheDocument();
    expect(queryByText(/OCR/i)).not.toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: 'Photo library' }));
    await waitFor(() => expect(mocks.searchAssets).toHaveBeenCalledOnce());
  });

  it('contains keyboard focus and restores it when the editor closes', async () => {
    const { findByText, getByRole, queryByRole } = render(CimmichDocuments);
    const user = userEvent.setup();
    await findByText('No documents yet');
    const trigger = getByRole('button', { name: 'Add document' });

    await user.click(trigger);
    expect(getByRole('dialog', { name: 'Add a document' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('shows exact projected metadata and links only after loading detail', async () => {
    mocks.getDocuments.mockResolvedValueOnce({ items: [listDocument], schemaVersion: 'cimmich.document.v1' });
    mocks.getDocument.mockResolvedValueOnce({
      ...listDocument,
      links: [{ displayName: 'Test Place', relationKind: 'applies_to', subjectId: 'place_1', subjectKind: 'place' }],
      schemaVersion: 'cimmich.document.v1',
    });
    const { findByRole, findByText } = render(CimmichDocuments);

    await fireEvent.click(await findByRole('button', { name: /Synthetic certificate/ }));
    const subjectLink = await findByRole('link', { name: /Test Place/ });
    expect(subjectLink).toHaveTextContent('Place · Applies to');
    expect(subjectLink).toHaveAttribute('href', '/cimmich/places?family=places&entityId=place_1');
    expect(await findByText('Imported · 4 B')).toBeInTheDocument();
  });

  it('restores a URL-selected Document and reports Back to its route owner', async () => {
    mocks.getDocuments.mockResolvedValue({ items: [listDocument], schemaVersion: 'cimmich.document.v1' });
    mocks.getDocument.mockResolvedValue(listDocument);
    const onDocumentChange = vi.fn();
    const { findByRole, getByRole } = render(CimmichDocuments, {
      initialDocumentId: listDocument.documentId,
      onDocumentChange,
    });

    expect(await findByRole('heading', { name: 'Synthetic certificate' })).toBeInTheDocument();
    expect(onDocumentChange).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Back' }));
    expect(onDocumentChange).toHaveBeenCalledWith(null);
  });

  it('reports an opened Document so direct and Back navigation can remain stable', async () => {
    mocks.getDocuments.mockResolvedValue({ items: [listDocument], schemaVersion: 'cimmich.document.v1' });
    mocks.getDocument.mockResolvedValue(listDocument);
    const onDocumentChange = vi.fn();
    const { findByRole } = render(CimmichDocuments, { onDocumentChange });

    await fireEvent.click(await findByRole('button', { name: /Synthetic certificate/ }));
    await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith(listDocument.documentId));
  });

  it('previews an audited Immich source asset in place without losing the Document', async () => {
    const sourceAssetId = '4b789ca4-8bf8-4a7a-b6bb-7ab74a5365fd';
    const seededDocument = {
      ...listDocument,
      source: {
        ...listDocument.source,
        assetId: sourceAssetId,
        kind: 'immich_asset' as const,
        mimeType: 'image/png',
      },
    };
    mocks.getDocuments.mockResolvedValueOnce({ items: [seededDocument], schemaVersion: 'cimmich.document.v1' });
    mocks.getDocument.mockResolvedValueOnce(seededDocument);
    mocks.getDocumentContent.mockResolvedValueOnce({ assetId: sourceAssetId, kind: 'immich_asset' });

    const { findByRole, getByRole } = render(CimmichDocuments);
    await fireEvent.click(await findByRole('button', { name: /Synthetic certificate/ }));
    await fireEvent.click(getByRole('button', { name: 'Preview' }));

    expect(await findByRole('img', { name: 'Preview of Synthetic certificate' })).toHaveAttribute(
      'src',
      expect.stringContaining(sourceAssetId),
    );
    expect(getByRole('heading', { name: 'Synthetic certificate' })).toBeInTheDocument();
    expect(mocks.getAssetEvidence).not.toHaveBeenCalled();
  });

  it('opens a referenced photo in a new tab while retaining the Document view', async () => {
    const sourceAssetId = '4b789ca4-8bf8-4a7a-b6bb-7ab74a5365fd';
    const seededDocument = {
      ...listDocument,
      source: {
        ...listDocument.source,
        assetId: sourceAssetId,
        kind: 'immich_asset' as const,
        mimeType: 'image/png',
      },
    };
    mocks.getDocuments.mockResolvedValueOnce({ items: [seededDocument], schemaVersion: 'cimmich.document.v1' });
    mocks.getDocument.mockResolvedValueOnce(seededDocument);
    const open = vi.spyOn(globalThis, 'open').mockImplementation(() => null);

    const { findByRole, getByRole } = render(CimmichDocuments);
    await fireEvent.click(await findByRole('button', { name: /Synthetic certificate/ }));
    await fireEvent.click(getByRole('button', { name: 'Open in new tab' }));

    expect(open).toHaveBeenCalledWith(`/photos/${sourceAssetId}`, '_blank', 'noopener,noreferrer');
    expect(getByRole('heading', { name: 'Synthetic certificate' })).toBeInTheDocument();
    open.mockRestore();
  });

  it('updates metadata without sending the unchanged visibility tier', async () => {
    mocks.getDocuments.mockResolvedValue({ items: [listDocument], schemaVersion: 'cimmich.document.v1' });
    mocks.getDocument.mockResolvedValue(listDocument);
    mocks.updateDocument.mockResolvedValue({ decisionId: 'document-decision-1' });
    const { findByRole, getByLabelText, getByRole } = render(CimmichDocuments);

    await fireEvent.click(await findByRole('button', { name: /Synthetic certificate/ }));
    await fireEvent.click(getByRole('button', { name: 'Edit' }));
    await fireEvent.input(getByLabelText('Issued'), { target: { value: '2026-07-08' } });
    await fireEvent.click(getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.updateDocument).toHaveBeenCalledOnce());
    expect(mocks.updateDocument).toHaveBeenCalledWith(
      listDocument.documentId,
      expect.objectContaining({ issuedOn: '2026-07-08' }),
    );
    expect(mocks.updateDocument.mock.calls[0]?.[1]).not.toHaveProperty('visibilityTier');
    expect(mocks.setVisibility).not.toHaveBeenCalled();
  });

  it('keeps a visibility change on its separate decision path', async () => {
    mocks.getDocuments.mockResolvedValue({ items: [listDocument], schemaVersion: 'cimmich.document.v1' });
    mocks.getDocument.mockResolvedValueOnce(listDocument).mockResolvedValueOnce({
      ...listDocument,
      effectiveVisibilityTier: 'private',
      visibilityTier: 'private',
    });
    mocks.updateDocument.mockResolvedValue({ decisionId: 'document-decision-2' });
    mocks.setVisibility.mockResolvedValue({ decisionId: 'visibility-decision-1' });
    const { findByRole, getByLabelText, getByRole } = render(CimmichDocuments);
    const user = userEvent.setup();

    await fireEvent.click(await findByRole('button', { name: /Synthetic certificate/ }));
    await fireEvent.click(getByRole('button', { name: 'Edit' }));
    const visibility = getByLabelText('Visibility');
    await user.selectOptions(visibility, 'private');
    expect(visibility).toHaveValue('private');
    await fireEvent.click(getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.setVisibility).toHaveBeenCalledOnce());
    expect(mocks.updateDocument.mock.calls[0]?.[1]).not.toHaveProperty('visibilityTier');
    expect(mocks.setVisibility).toHaveBeenCalledWith(
      'document',
      listDocument.documentId,
      'private',
      expect.any(String),
    );
    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledTimes(2));
    expect(getByRole('article')).toHaveTextContent('private');
  });

  it('keeps an open edit bound to its document across a visibility refresh', async () => {
    mocks.getDocuments.mockResolvedValue({ items: [listDocument], schemaVersion: 'cimmich.document.v1' });
    mocks.getDocument.mockResolvedValue(listDocument);
    mocks.updateDocument.mockResolvedValue({ decisionId: 'document-decision-refresh' });
    const { findByRole, getByLabelText, getByRole } = render(CimmichDocuments);

    await fireEvent.click(await findByRole('button', { name: /Synthetic certificate/ }));
    await fireEvent.click(getByRole('button', { name: 'Edit' }));
    await fireEvent.input(getByLabelText('Issued'), { target: { value: '2026-07-08' } });

    cimmichVisibilityManager.notify();
    await waitFor(() => expect(mocks.getDocuments).toHaveBeenCalledTimes(2));
    await fireEvent.click(getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.updateDocument).toHaveBeenCalledOnce());
    expect(mocks.updateDocument).toHaveBeenCalledWith(
      listDocument.documentId,
      expect.objectContaining({ issuedOn: '2026-07-08' }),
    );
    expect(mocks.importDocument).not.toHaveBeenCalled();
  });

  it('presents the typed metadata error without attempting visibility', async () => {
    mocks.getDocuments.mockResolvedValue({ items: [listDocument], schemaVersion: 'cimmich.document.v1' });
    mocks.getDocument.mockResolvedValue(listDocument);
    mocks.updateDocument.mockRejectedValue(
      new CimmichServiceError('visibilityTier is not allowed', { code: 'DOCUMENT_FIELD_INVALID', status: 400 }),
    );
    const { findByRole, findByText, getByRole } = render(CimmichDocuments);

    await fireEvent.click(await findByRole('button', { name: /Synthetic certificate/ }));
    await fireEvent.click(getByRole('button', { name: 'Edit' }));
    await fireEvent.click(getByRole('button', { name: 'Save' }));

    expect(await findByText('Check the title and Document details.')).toBeInTheDocument();
    expect(mocks.setVisibility).not.toHaveBeenCalled();
  });
});
