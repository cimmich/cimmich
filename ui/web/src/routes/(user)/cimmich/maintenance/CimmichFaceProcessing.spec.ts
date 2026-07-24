import '@testing-library/jest-dom';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import CimmichFaceProcessing from './CimmichFaceProcessing.svelte';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock('$lib/services/cimmich.service', () => ({
  runCimmichFaceRecognition: mocks.run,
}));

const result = (
  recognitions: number,
  { pending = 0, state = 'completed' }: { pending?: number; state?: 'budget_exhausted' | 'completed' } = {},
) => ({
  automaticIdentityAuthority: 'none',
  commandId: 'processing.fixture',
  inventory: null,
  queue: { failed: 0, paused: 0, pending, processing: 0 },
  replayed: false,
  schemaVersion: 'cimmich.face-matching-operator.v1',
  state,
  work: { detections: 0, inventoryPages: 0, recognitions },
});

describe('Cimmich Face processing session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('separates completed analysis from usable embeddings and resumes durably', async () => {
    mocks.run.mockResolvedValue(result(4));
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { getByRole, getByText } = render(CimmichFaceProcessing, {
      props: {
        acceptedFaces: 26,
        analysedFaces: 22,
        canRun: true,
        eligibleFaces: 24,
        onRefresh,
        providerEmbeddings: 18,
      },
    });

    expect(getByText('22 of 24 eligible accepted Faces processed')).toBeInTheDocument();
    expect(getByText('18 currently usable matching embeddings')).toBeInTheDocument();
    expect(getByText(/2 accepted Faces are outside this session's current viewing\/source scope/)).toBeInTheDocument();
    await fireEvent.click(getByRole('button', { name: 'Resume processing' }));

    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith(25));
    await waitFor(() =>
      expect(getByText('Cimmich reached the currently available end of this library.')).toBeInTheDocument(),
    );
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(getByText('4 Faces analysed · 1 batch')).toBeInTheDocument();
  });

  it('stops only after an in-flight durable batch completes', async () => {
    let finishBatch: (value: ReturnType<typeof result>) => void = () => {};
    mocks.run.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishBatch = resolve;
        }),
    );
    const { getByRole, getByText } = render(CimmichFaceProcessing, {
      props: {
        acceptedFaces: 100,
        analysedFaces: 0,
        canRun: true,
        eligibleFaces: 100,
        onRefresh: vi.fn().mockResolvedValue(undefined),
        providerEmbeddings: 0,
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Start processing' }));
    await fireEvent.click(getByRole('button', { name: 'Stop after this batch' }));
    expect(getByRole('button', { name: 'Stopping after this batch…' })).toBeDisabled();
    finishBatch(result(25));

    await waitFor(() =>
      expect(getByText('Stopped safely after the current batch. Completed work is preserved.')).toBeInTheDocument(),
    );
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it('continues across productive server time-budget boundaries', async () => {
    mocks.run
      .mockResolvedValueOnce(result(8, { pending: 1, state: 'budget_exhausted' }))
      .mockResolvedValueOnce(result(2));
    const { getByRole, getByText } = render(CimmichFaceProcessing, {
      props: {
        acceptedFaces: 20,
        analysedFaces: 0,
        canRun: true,
        eligibleFaces: 20,
        onRefresh: vi.fn().mockResolvedValue(undefined),
        providerEmbeddings: 0,
      },
    });

    await fireEvent.click(getByRole('button', { name: '25 Faces' }));
    await fireEvent.click(getByRole('button', { name: 'Start processing' }));

    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
    expect(mocks.run).toHaveBeenNthCalledWith(1, 25);
    expect(mocks.run).toHaveBeenNthCalledWith(2, 17);
    await waitFor(() =>
      expect(getByText('Cimmich reached the currently available end of this library.')).toBeInTheDocument(),
    );
  });
});
