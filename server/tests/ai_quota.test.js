import { describe, it, expect } from 'vitest';
import { consumeAnonQuota, ANON_AI_LIMIT } from '../src/aiQuota.js';

const d = (s) => new Date(s);

// El módulo tiene estado compartido; los tests se apoyan en el orden del
// archivo y en IPs/días distintos para no pisarse.
describe('aiQuota', () => {
  it('permite el límite diario y rechaza la consulta siguiente', () => {
    const now = d('2026-07-19T10:00:00Z');
    for (let i = 0; i < ANON_AI_LIMIT; i++) {
      expect(consumeAnonQuota('1.1.1.1', now)).toBe(true);
    }
    expect(consumeAnonQuota('1.1.1.1', now)).toBe(false);
  });

  it('cada IP tiene su propio cupo', () => {
    const now = d('2026-07-19T11:00:00Z');
    expect(consumeAnonQuota('2.2.2.2', now)).toBe(true);
  });

  it('el cupo se renueva al cambiar el día', () => {
    expect(consumeAnonQuota('1.1.1.1', d('2026-07-20T00:10:00Z'))).toBe(true);
  });
});
