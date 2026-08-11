import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichLocalAiAction from './CimmichLocalAiAction.svelte';

const mocks = vi.hoisted(() => ({
  artifact: vi.fn(),
  cancel: vi.fn(),
  getJob: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/cimmich.service')>()),
  cancelCimmichLocalAiJob: mocks.cancel,
  getCimmichLocalAiArtifact: mocks.artifact,
  getCimmichLocalAiJob: mocks.getJob,
  getCimmichLocalAiStatus: mocks.status,
  startCimmichLocalAiJob: mocks.start,
}));

const completedFaceJob = {
  artifactTokens: [],
  completedAt: '2026-08-11T12:00:00.000Z',
  createdAt: '2026-08-11T11:59:59.000Z',
  error: null,
  jobId: '95e571ab-79a1-4f45-8416-2a3f22ca7f7a',
  operation: 'faces' as const,
  progress: { completedAssets: 1, phase: 'complete', totalAssets: 1 },
  result: {
    assets: [
      {
        assetId: '2af22c3c-e009-42a4-98e8-bb0f790bb25f',
        baselineComparison: { bodies: null, faces: { added: [{}], removed: [] } },
        operations: { faces: { faces: [{}, {}], state: 'faces_detected' } },
      },
    ],
    originalsUnchanged: true,
    state: 'completed',
  },
  schemaVersion: 'cimmich.local-ai-jobs.v1' as const,
  sourceAssetIds: ['2af22c3c-e009-42a4-98e8-bb0f790bb25f'],
  state: 'completed' as const,
};

describe('Cimmich Local AI review action', () => {
  beforeEach(() => {
    mocks.status.mockReset().mockResolvedValue({
      capabilities: { best: true, bodies: false, context: false, faces: true, quick: true, sceneText: false },
      enabled: true,
      limits: {
        maxAssets: 12,
        maxConcurrentJobs: 1,
        maxQueuedJobs: 4,
        maxRetainedRuns: 12,
        maxStoreBytes: 4_294_967_296,
      },
      originals: 'read-only',
      reviewRequired: true,
      schemaVersion: 'cimmich.local-ai-jobs.v1',
      state: 'ready',
    });
    mocks.start.mockReset().mockResolvedValue(completedFaceJob);
    mocks.getJob.mockReset();
    mocks.artifact.mockReset();
    mocks.cancel.mockReset();
  });

  it('makes review-only and unavailable-provider boundaries visible', async () => {
    const rendered = render(CimmichLocalAiAction, {
      sourceAssetIds: ['2af22c3c-e009-42a4-98e8-bb0f790bb25f'],
    });

    await fireEvent.click(rendered.getByRole('button', { name: 'Open Local AI review' }));
    const dialog = await rendered.findByRole('dialog', { name: 'Local AI' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.parentElement).toHaveClass('local-ai-backdrop');
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(rendered.getByText(/Nothing is written into identity or Context data/)).toBeInTheDocument();
    expect(rendered.getByText(/fast, full-photo 2x upscale/i)).toBeInTheDocument();
    expect(rendered.getByRole('radio', { name: /Look for missed Bodies/ })).toBeDisabled();
    expect(rendered.getByText(/high-detail local detector/)).toBeInTheDocument();
  });

  it('shows real tile progress for a running Best upscale', async () => {
    const runningBest = {
      ...completedFaceJob,
      completedAt: null,
      operation: 'best' as const,
      progress: {
        completedAssets: 0,
        model: {
          completedTiles: 7,
          completedUnits: 7,
          operation: 'best' as const,
          stage: 'upscaling',
          totalTiles: 24,
          totalUnits: 26,
        },
        phase: 'running-model',
        totalAssets: 1,
      },
      result: null,
      state: 'running' as const,
    };
    mocks.start.mockResolvedValueOnce(runningBest);
    mocks.getJob.mockResolvedValueOnce(runningBest);
    const rendered = render(CimmichLocalAiAction, {
      sourceAssetIds: ['2af22c3c-e009-42a4-98e8-bb0f790bb25f'],
    });

    await fireEvent.click(rendered.getByRole('button', { name: 'Open Local AI review' }));
    await fireEvent.click(await rendered.findByRole('radio', { name: /Upscale · Best/ }));
    await fireEvent.click(rendered.getByRole('button', { name: 'Run locally' }));

    expect(await rendered.findByText('Upscaling · 7 of 24 tiles')).toBeInTheDocument();
    expect(rendered.getByRole('progressbar', { name: 'Upscaling · 7 of 24 tiles' })).toHaveAttribute('value', '7');
  });

  it('shows the candidate delta and unchanged-original proof after a Face run', async () => {
    const rendered = render(CimmichLocalAiAction, {
      sourceAssetIds: ['2af22c3c-e009-42a4-98e8-bb0f790bb25f'],
    });
    await fireEvent.click(rendered.getByRole('button', { name: 'Open Local AI review' }));
    await fireEvent.click(await rendered.findByRole('radio', { name: /Look for missed Faces/ }));
    await fireEvent.click(rendered.getByRole('button', { name: 'Run locally' }));

    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('faces', completedFaceJob.sourceAssetIds));
    expect(await rendered.findByText('Original verified unchanged')).toBeInTheDocument();
    expect(rendered.getByText('2 detected · 1 not in the saved Face boxes')).toBeInTheDocument();
  });

  it('shows detected and new Body counts for review', async () => {
    mocks.status.mockResolvedValueOnce({
      ...(await mocks.status()),
      capabilities: { best: true, bodies: true, context: false, faces: true, quick: true, sceneText: false },
    });
    mocks.start.mockResolvedValueOnce({
      ...completedFaceJob,
      operation: 'bodies',
      result: {
        ...completedFaceJob.result,
        assets: [
          {
            assetId: completedFaceJob.sourceAssetIds[0],
            baselineComparison: { bodies: { added: [{}, {}], removed: [] }, faces: null },
            operations: { bodies: { bodies: [{}, {}, {}], state: 'bodies_detected' } },
          },
        ],
      },
    });
    const rendered = render(CimmichLocalAiAction, { sourceAssetIds: completedFaceJob.sourceAssetIds });
    await fireEvent.click(rendered.getByRole('button', { name: 'Open Local AI review' }));
    await fireEvent.click(await rendered.findByRole('radio', { name: /Look for missed Bodies/ }));
    await fireEvent.click(rendered.getByRole('button', { name: 'Run locally' }));

    expect(await rendered.findByText('3 detected · 2 not in the saved Body boxes')).toBeInTheDocument();
  });
});
