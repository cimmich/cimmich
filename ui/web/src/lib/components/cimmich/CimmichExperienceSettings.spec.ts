import { fireEvent, render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { cimmichExperience, cimmichLocalAiExperiment } from '$lib/stores/cimmich-experience.store';
import CimmichExperienceSettings from './CimmichExperienceSettings.svelte';

describe('Cimmich experience settings', () => {
  beforeEach(() => {
    localStorage.clear();
    cimmichExperience.set('companion');
    cimmichLocalAiExperiment.set(false);
  });

  it('prominently offers Frontier Workspace without forcing it', async () => {
    const rendered = render(CimmichExperienceSettings);

    await fireEvent.click(rendered.getByRole('button', { name: 'Use Frontier Workspace' }));

    expect(get(cimmichExperience)).toBe('frontier');
    expect(rendered.getByText('On')).toBeVisible();
    expect(rendered.getByRole('button', { name: 'Use familiar sidebar' })).toBeVisible();
  });

  it('keeps Local AI controls as a separate experimental choice', async () => {
    const rendered = render(CimmichExperienceSettings);
    const button = rendered.getByRole('button', { name: 'Show Local AI controls' });

    await fireEvent.click(button);

    expect(get(cimmichExperience)).toBe('companion');
    expect(get(cimmichLocalAiExperiment)).toBe(true);
    expect(rendered.getByRole('button', { name: 'Hide Local AI controls' })).toHaveAttribute('aria-pressed', 'true');
  });
});
