import { describe, expect, it } from 'vitest';
import { generateSecurePassword } from './generate-secure-password';

describe('generateSecurePassword', () => {
  it('returns a cryptographically generated password of the requested length', () => {
    expect(generateSecurePassword()).toHaveLength(16);
    expect(generateSecurePassword(32)).toHaveLength(32);
  });

  it('only uses characters accepted by the password reset flow', () => {
    const allowedCharacters = new Set('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,.-{}+!#$%/()=?');

    expect([...generateSecurePassword(128)].every((character) => allowedCharacters.has(character))).toBe(true);
  });
});
