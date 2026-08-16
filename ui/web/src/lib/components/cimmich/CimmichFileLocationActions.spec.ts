import '@testing-library/jest-dom';
import { fireEvent, render } from '@testing-library/svelte';
import CimmichFileLocationActions from './CimmichFileLocationActions.svelte';

const asset = {
  id: '8156f9c7-2e50-403d-a1ce-adbcc69cf981',
  originalFileName: '3151_1129695250736_4472755_n.jpg',
  originalPath: '/archive/Benji/B_Archive/Photos/2009 - Ben/3151_1129695250736_4472755_n.jpg',
};

describe('CimmichFileLocationActions', () => {
  it('explains the remote filesystem and offers the real folder grid', async () => {
    const rendered = render(CimmichFileLocationActions, { asset, variant: 'overlay' });

    await fireEvent.click(rendered.getByRole('button', { name: `Open folder options for ${asset.originalFileName}` }));

    expect(rendered.getByRole('dialog', { name: 'Open this location in Cimmich?' })).toBeInTheDocument();
    expect(rendered.getByText(/browser cannot open the file manager on another machine/i)).toBeInTheDocument();
    expect(rendered.getByText('/archive/Benji/B_Archive/Photos/2009 - Ben')).toBeInTheDocument();
    expect(rendered.getByRole('link', { name: 'Open folder view' })).toHaveAttribute(
      'href',
      '/folders?organise=1&path=%2Farchive%2FBenji%2FB_Archive%2FPhotos%2F2009%20-%20Ben',
    );
  });

  it('closes without navigating', async () => {
    const rendered = render(CimmichFileLocationActions, { asset, variant: 'overlay' });
    const trigger = rendered.getByRole('button', { name: `Open folder options for ${asset.originalFileName}` });

    await fireEvent.click(trigger);
    await fireEvent.click(rendered.getByRole('button', { name: 'Close' }));

    expect(rendered.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
