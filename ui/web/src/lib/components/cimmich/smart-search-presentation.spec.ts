import { describe, expect, it } from 'vitest';
import { smartSearchEntityLabel, smartSearchMatchLabel } from './smart-search-presentation';

describe('Smart Search presentation', () => {
  it('uses owner-facing names instead of repository nouns', () => {
    expect(smartSearchEntityLabel('object')).toBe('Thing');
    expect(smartSearchEntityLabel('person')).toBe('Person');
    expect(smartSearchMatchLabel('exact_display_name')).toBe('Exact name');
    expect(smartSearchMatchLabel('exact_alias')).toBe('Exact alias');
    expect(smartSearchMatchLabel('label')).toBe('Exact name or alias');
  });

  it('keeps unknown implementation values quiet', () => {
    expect(smartSearchEntityLabel('future_kind')).toBe('Recorded detail');
    expect(smartSearchMatchLabel('future_match')).toBe('Recorded detail');
  });
});
