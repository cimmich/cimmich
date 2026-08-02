import { describe, expect, it, vi } from 'vitest';
import { handleCimmichMediaCardClick } from './media-card-selection';

describe('Cimmich media card selection', () => {
  it('leaves the card link alone before bulk selection begins', () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent;
    const toggleSelection = vi.fn();

    expect(handleCimmichMediaCardClick(event, false, toggleSelection)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(toggleSelection).not.toHaveBeenCalled();
  });

  it('turns the whole photo into a selection target once bulk selection is active', () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent;
    const toggleSelection = vi.fn();

    expect(handleCimmichMediaCardClick(event, true, toggleSelection)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(toggleSelection).toHaveBeenCalledOnce();
  });
});
