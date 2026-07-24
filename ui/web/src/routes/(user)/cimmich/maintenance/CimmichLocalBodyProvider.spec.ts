import '@testing-library/jest-dom';
import { render } from '@testing-library/svelte';
import CimmichLocalBodyProvider from './CimmichLocalBodyProvider.svelte';

const settings = {
  bodyDetection: {
    accepts: 'cimmich.body-detection-result.v1',
    adapterContract: 'cimmich.body-detector.v1',
    automaticIdentityAuthority: 'none',
    bundledModels: false,
    conformance: 'two_canonical_runs_required',
    evidenceIntake: {
      commitContract: 'cimmich.body-detection-operator-receipt.v1',
      operatorEntrypoint: 'service/bin/body-detection-operator.mjs',
      providerOutputIsIdentityTruth: false,
      replayRunsRequired: 2,
    },
    examples: [
      {
        adapter: 'ultralytics-yolo-body',
        licence: 'AGPL-3.0_or_separate_upstream_terms',
        modelSource: 'https://example.test/yolo11',
        providerSource: 'https://example.test/ultralytics',
        role: 'optional_example',
        testedSettings: {
          device: 'cpu',
          imageSize: 640,
          maximumRuntimeMs: 120_000,
          modelId: 'yolo11n',
          threshold: 0.3,
        },
      },
    ],
    modelAcquisition: 'operator_or_connected_client',
    sourceMedia: 'local_read_only',
  },
  faceRecognition: {
    examples: [],
  },
  policy: {
    cimmichDownloadsModelsAutomatically: false,
    cimmichSelectsProvider: false,
    modelArtifactsInRepository: false,
    operatorOwnsLicenceAndDisclosureDecision: true,
    statement: 'Provider evidence never becomes identity truth.',
  },
  schemaVersion: 'cimmich.integration-settings.v1',
};

describe('Cimmich local Body provider', () => {
  it('connects persisted Body evidence to its real provider and tested settings', () => {
    const { getByRole, getByText } = render(CimmichLocalBodyProvider, {
      props: {
        settings,
        status: {
          activeConfigurations: 1,
          analyzedAssets: 32,
          assets: 39,
          bodyObservations: 56,
          detectedAssets: 31,
          linkedBodies: 56,
          noBodyAssets: 8,
          state: 'partial',
        },
      },
    });

    expect(getByRole('heading', { name: 'Body evidence' })).toBeInTheDocument();
    expect(getByText('Partly analysed')).toBeInTheDocument();
    expect(getByText('Evidence connected')).toBeInTheDocument();
    expect(getByText(/Current evidence comes from 1 validated configuration/)).toBeInTheDocument();
    expect(getByText(/7 supported assets remain to analyse/)).toBeInTheDocument();
    expect(getByText('ultralytics-yolo-body')).toBeInTheDocument();
    expect(getByText('yolo11n')).toBeInTheDocument();
    expect(getByText('CPU · 640px · 0.3 threshold')).toBeInTheDocument();
    expect(getByRole('link', { name: 'Model source' })).toHaveAttribute('href', 'https://example.test/yolo11');
    expect(getByRole('link', { name: 'Provider source' })).toHaveAttribute('href', 'https://example.test/ultralytics');
    expect(getByRole('button', { name: 'Download Body contract' })).toBeEnabled();
  });

  it('distinguishes a configured provider contract from evidence that has not run', () => {
    const { getByText } = render(CimmichLocalBodyProvider, {
      props: {
        settings,
        status: {
          activeConfigurations: 0,
          analyzedAssets: 0,
          assets: 39,
          bodyObservations: 0,
          detectedAssets: 0,
          linkedBodies: 0,
          noBodyAssets: 0,
          state: 'not_started',
        },
      },
    });

    expect(getByText('Not started')).toBeInTheDocument();
    expect(getByText('Ready to configure')).toBeInTheDocument();
    expect(getByText(/No Body evidence has been recorded yet/)).toBeInTheDocument();
  });
});
