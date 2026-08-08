import { describe, expect, it, vi } from 'vitest';
import { createCoalescedReload } from './coalesced-reload';

describe('coalesced reload', () => {
  it('turns a burst into one latest load', async () => {
    vi.useFakeTimers();
    const load = vi.fn((value: number) => Promise.resolve(value));
    const onResult = vi.fn();
    const reload = createCoalescedReload({ delayMs: 100, load, onError: vi.fn(), onResult });

    reload.schedule(1);
    reload.schedule(2);
    reload.schedule(3);
    await vi.advanceTimersByTimeAsync(100);

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(3);
    expect(onResult).toHaveBeenCalledWith(3, 3);
    reload.dispose();
    vi.useRealTimers();
  });

  it('never overlaps loads and runs only the latest pending refresh next', async () => {
    vi.useFakeTimers();
    let finishFirst: ((value: number) => void) | undefined;
    const load = vi
      .fn<(value: number) => Promise<number>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockImplementation((value) => Promise.resolve(value));
    const onResult = vi.fn();
    const reload = createCoalescedReload({ delayMs: 100, load, onError: vi.fn(), onResult });

    reload.schedule(1);
    await vi.advanceTimersByTimeAsync(100);
    reload.schedule(2);
    reload.schedule(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledOnce();

    finishFirst?.(1);
    await vi.runAllTimersAsync();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith(3);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(3, 3);
    reload.dispose();
    vi.useRealTimers();
  });
});
