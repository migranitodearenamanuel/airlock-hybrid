import { describe, it, expect } from 'vitest';
import { runAirlock } from '../src/airlock.js';
import { SAMPLES } from '../src/samples.js';

function fakeEngine({ local }) {
  const sent = [];
  return {
    sent,
    async localAvailable() { return local; },
    async local(prompt, { schema } = {}) {
      if (schema) return { text: JSON.stringify({ docType: 'bank letter', entities: [{ text: 'Banco Ejemplo', type: 'OTHER' }] }), source: 'on_device' };
      return { text: 'Local answer for Juan García López', source: 'on_device' };
    },
    async cloud(prompt) { sent.push(prompt); return { text: 'Pay before 15/12/2026, [PERSON_1].', source: 'in_cloud' }; },
  };
}

describe('runAirlock', () => {
  it('cloud fallback only receives redacted text and answer is rehydrated', async () => {
    const e = fakeEngine({ local: false });
    const r = await runAirlock({ text: SAMPLES[0], task: 'actions', engine: e });
    expect(r.route).toBe('cloud-redacted');
    expect(e.sent[0]).not.toContain('Juan García López');
    expect(e.sent[0]).not.toContain('12345678Z');
    expect(r.output).toContain('Juan García López');
    expect(r.storable).not.toContain('Juan García López');
  });
  it('on-device route sends nothing to the cloud', async () => {
    const e = fakeEngine({ local: true });
    const r = await runAirlock({ text: SAMPLES[0], task: 'explain', engine: e });
    expect(r.route).toBe('local-raw');
    expect(e.sent.length).toBe(0);
    expect(r.egress).toBe('');
    expect(r.storable).not.toContain('Juan García López');
    expect(r.docType).toBe('bank letter');
  });
  it('images are refused when no on-device model exists', async () => {
    const r = await runAirlock({ image: { type: 'image/png' }, engine: fakeEngine({ local: false }) });
    expect(r.route).toBe('blocked');
  });
});
