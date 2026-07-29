import { describe, expect, it, vi } from 'vitest';
import { createCimmichUuid } from './cimmich-uuid';

describe('createCimmichUuid', () => {
  it('uses the native secure-context implementation when available', () => {
    const randomUUID = vi.fn(() => '12345678-1234-4123-8123-123456789abc');
    const getRandomValues = vi.fn();
    const source = { getRandomValues, randomUUID } as unknown as Crypto;

    expect(createCimmichUuid(source)).toBe('12345678-1234-4123-8123-123456789abc');
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('creates a valid v4 UUID when randomUUID is unavailable on plain HTTP', () => {
    const sourceBytes = Uint8Array.from([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
    ]);
    const source = {
      getRandomValues: (target: Uint8Array) => {
        target.set(sourceBytes);
        return target;
      },
    } as unknown as Crypto;

    expect(createCimmichUuid(source)).toBe('00112233-4455-4677-8899-aabbccddeeff');
  });
});
