import { resolveCimmichExperienceDefault, resolveCimmichExperimentDefault } from './cimmich-experience.store';

describe('Cimmich experience deployment defaults', () => {
  it('keeps the familiar companion experience as the public fallback', () => {
    expect(resolveCimmichExperienceDefault(undefined)).toBe('companion');
    expect(resolveCimmichExperienceDefault('companion')).toBe('companion');
    expect(resolveCimmichExperienceDefault('unexpected')).toBe('companion');
  });

  it('allows a deployment to start in Frontier Workspace deliberately', () => {
    expect(resolveCimmichExperienceDefault('frontier')).toBe('frontier');
  });

  it('keeps optional experiments off unless the deployment explicitly opts in', () => {
    expect(resolveCimmichExperimentDefault(undefined)).toBe(false);
    expect(resolveCimmichExperimentDefault('false')).toBe(false);
    expect(resolveCimmichExperimentDefault('true')).toBe(true);
  });
});
