import { describe, expect, it } from 'vitest';
import { formatCimmichConnectionFactLabel } from './connection-fact-label';

describe('formatCimmichConnectionFactLabel', () => {
  it('groups multiple qualifiers inside one modifier suffix', () => {
    expect(
      formatCimmichConnectionFactLabel({
        label: 'Friend',
        modifiers: [
          { behavior: 'qualifier', label: 'Childhood' },
          { behavior: 'qualifier', label: 'School' },
        ],
        pastLabel: 'Friend (Former)',
        validity: 'current',
      }),
    ).toBe('Friend (Childhood, School)');
  });

  it('keeps Former in the same modifier suffix', () => {
    expect(
      formatCimmichConnectionFactLabel({
        label: 'Friend',
        modifiers: [
          { behavior: 'historical', label: 'Former' },
          { behavior: 'qualifier', label: 'Childhood' },
        ],
        pastLabel: 'Friend (Former)',
        validity: 'past',
      }),
    ).toBe('Friend (Former, Childhood)');
  });

  it('uses the authored past-tense label for a historical place fact', () => {
    expect(
      formatCimmichConnectionFactLabel({
        label: 'Lives here',
        modifiers: [],
        pastLabel: 'Lived here',
        validity: 'past',
      }),
    ).toBe('Lived here');
  });
});
