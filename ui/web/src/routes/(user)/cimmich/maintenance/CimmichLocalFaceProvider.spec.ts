import '@testing-library/jest-dom';
import { fireEvent, render } from '@testing-library/svelte';
import CimmichLocalFaceProvider from './CimmichLocalFaceProvider.svelte';

const settings = {
  bodyDetection: {
    examples: [],
  },
  faceRecognition: {
    examples: [
      {
        adapter: 'opencv-yunet-sface-cpu',
        modelSource: 'https://example.test/models',
        providerSource: 'https://example.test/provider',
        role: 'optional_example',
      },
    ],
  },
  policy: {
    statement: 'Human review only.',
  },
  schemaVersion: 'cimmich.integration-settings.v1',
};

describe('Cimmich local Face provider setup', () => {
  it('gives an unconfigured newcomer one verified install path before advanced options', () => {
    const { getByRole, getByText } = render(CimmichLocalFaceProvider, {
      props: {
        onRefresh: vi.fn(),
        provider: { state: 'disabled' },
        settings,
      },
    });

    expect(getByRole('heading', { name: 'Set up local matching' })).toBeInTheDocument();
    expect(getByText('./tools/companion.sh face-provider install-recommended')).toBeInTheDocument();
    expect(getByText('Runs locally on CPU')).toBeInTheDocument();
    expect(getByText('Never uploads photos or confirms an identity')).toBeInTheDocument();
    expect(getByText('Advanced provider options').closest('details')).not.toHaveAttribute('open');
  });

  it('shows exact connected-provider truth and keeps advanced detail secondary', async () => {
    const onRefresh = vi.fn();
    const { getByRole, getByText } = render(CimmichLocalFaceProvider, {
      props: {
        onRefresh,
        provider: {
          modelFamily: 'opencv-sface',
          modelVersion: '2021dec',
          providerId: 'opencv-yunet-sface-cpu',
          state: 'ready',
          vectorSpaceId: 'fixture-space',
        },
        settings,
      },
    });

    expect(getByRole('heading', { name: 'Local provider connected' })).toBeInTheDocument();
    expect(getByText('opencv-yunet-sface-cpu')).toBeInTheDocument();
    expect(getByText('opencv-sface · 2021dec')).toBeInTheDocument();
    expect(getByText(/Review Enhanced and the current processing state below/)).toBeInTheDocument();

    await fireEvent.click(getByText('Advanced provider options'));
    expect(getByText('OpenCV model source')).toBeInTheDocument();
  });
});
