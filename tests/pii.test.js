import { describe, it, expect } from 'vitest';
import { detectPII, redact, rehydrate, reRedact, assertNoLeak, validIban, validDniNie, validLuhn, spansFromModel } from '../src/pii.js';
import { SAMPLES } from '../src/samples.js';

describe('validators', () => {
  it('IBAN mod-97', () => { expect(validIban('ES91 2100 0418 4502 0005 1332')).toBe(true); expect(validIban('ES91 2100 0418 4502 0005 1333')).toBe(false); });
  it('DNI/NIE letter', () => { expect(validDniNie('12345678Z')).toBe(true); expect(validDniNie('12345678A')).toBe(false); expect(validDniNie('X1234567L')).toBe(true); });
  it('Luhn', () => { expect(validLuhn('4111 1111 1111 1111')).toBe(true); expect(validLuhn('4111 1111 1111 1112')).toBe(false); });
});

describe('detect + redact', () => {
  it('finds all identifiers in the Spanish bank letter', () => {
    const spans = detectPII(SAMPLES[0]);
    const types = spans.map((s) => s.type);
    for (const t of ['PERSON', 'IBAN', 'ID', 'PHONE', 'EMAIL', 'ADDRESS']) expect(types).toContain(t);
    const { redacted, vault } = redact(SAMPLES[0], spans);
    for (const v of ['Juan García López', '12345678Z', 'clientes@banco-ejemplo.es', '912 345 678']) expect(redacted).not.toContain(v);
    expect(redacted).toContain('347,20 €'); // amounts are kept: the cloud needs them
    expect(redacted).toContain('15/12/2026'); // deadlines are kept
    expect(rehydrate(redacted, vault)).toBe(SAMPLES[0]);
    expect(() => assertNoLeak(redacted, vault)).not.toThrow();
    expect(() => assertNoLeak(SAMPLES[0], vault)).toThrow();
  });
  it('finds card, phone and name in the English scam SMS', () => {
    const { redacted } = redact(SAMPLES[1], detectPII(SAMPLES[1]));
    expect(redacted).not.toContain('4111 1111 1111 1111');
    expect(redacted).not.toContain('Mary Johnson');
    expect(redacted).not.toContain('7700 900123');
    expect(redacted).toContain('parcel-fee-release.top'); // the scam domain must stay for verification
  });
  it('uses stable placeholders for repeated values', () => {
    const t = 'Dear Ana Ruiz, ... Ana Ruiz';
    const { redacted, vault } = redact(t, [...detectPII(t), ...spansFromModel(t, [{ text: 'Ana Ruiz', type: 'PERSON' }])]);
    expect(redacted).toBe('Dear [PERSON_1], ... [PERSON_1]');
    expect(vault.size).toBe(1);
  });
  it('re-redacts answers before storage', () => {
    const { vault } = redact('Dear Ana Ruiz', detectPII('Dear Ana Ruiz'));
    expect(reRedact('Hello Ana Ruiz!', vault)).toBe('Hello [PERSON_1]!');
  });
});
