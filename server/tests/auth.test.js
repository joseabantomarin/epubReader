import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../src/auth.js';

process.env.NODE_ENV = 'test';

describe('jwt helpers', () => {
  it('signs and verifies a payload round-trip', () => {
    const token = signJwt({ sub: 42, email: 'x@y.com' });
    expect(typeof token).toBe('string');
    const decoded = verifyJwt(token);
    expect(decoded.sub).toBe(42);
    expect(decoded.email).toBe('x@y.com');
  });

  it('rejects a tampered token', () => {
    const token = signJwt({ sub: 1 });
    expect(() => verifyJwt(token + 'x')).toThrow();
  });
});
