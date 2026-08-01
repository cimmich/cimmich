import '@testing-library/jest-dom';
import { fireEvent, render } from '@testing-library/svelte';
import CimmichPlaceCollectionControls from './CimmichPlaceCollectionControls.svelte';

describe('Cimmich Place collection controls', () => {
  it('keeps all four Places views in the top control and reveals real group and sort selects', async () => {
    const onGroupModeChange = vi.fn();
    const onSortModeChange = vi.fn();
    const onViewChange = vi.fn();
    const { getByLabelText, getByRole } = render(CimmichPlaceCollectionControls, {
      duplicateNameCount: 2,
      groupMode: 'country',
      onGroupModeChange,
      onSortModeChange,
      onViewChange,
      sortMode: 'name',
      view: 'geography',
    });

    for (const name of ['Map', 'Locations', 'Geography', 'GPS']) {
      expect(getByRole('button', { name })).toBeInTheDocument();
    }
    expect(getByRole('button', { name: 'Geography' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(getByRole('button', { name: 'Map' }));
    expect(onViewChange).toHaveBeenCalledWith('atlas');

    await fireEvent.click(getByRole('button', { name: 'Group and sort' }));
    await fireEvent.change(getByLabelText('Group places'), { target: { value: 'duplicates' } });
    await fireEvent.change(getByLabelText('Sort places'), { target: { value: 'photos-desc' } });
    expect(getByRole('option', { name: 'Repeated names (2)' })).toBeInTheDocument();
    expect(onGroupModeChange).toHaveBeenCalledWith('duplicates');
    expect(onSortModeChange).toHaveBeenCalledWith('photos-desc');
  });
});
