import { describe, it, expect, vi } from 'vitest';
import { callCloud, classifyError, withTimeout } from '../src/cloud.js';

const err = (m) => new Error(m);

describe('callCloud', () => {
  it('falls back to the next model when the first is overloaded', async () => {
    const attempt = vi.fn(async (m) => { if (m === 'a') throw err('[500 ] This model is currently experiencing high demand'); return { text: 'ok', source: 'in_cloud' }; });
    const r = await callCloud({ models: ['a', 'b'], attempt });
    expect(r.model).toBe('b');
    expect(r.text).toBe('ok');
  });
  it('never hangs: a stuck request times out and the next model answers', async () => {
    const attempt = (m) => (m === 'slow' ? new Promise(() => {}) : Promise.resolve({ text: 'fast', source: 'in_cloud' }));
    const r = await callCloud({ models: ['slow', 'fast'], attempt, perAttemptMs: 50, deadlineMs: 5000 });
    expect(r.model).toBe('fast');
  });
  it('gives a clear error when everything hangs, within the deadline', async () => {
    const t = Date.now();
    await expect(callCloud({ models: ['x', 'y'], attempt: () => new Promise(() => {}), perAttemptMs: 100, deadlineMs: 1700 })).rejects.toThrow(/did not answer in time/);
    expect(Date.now() - t).toBeLessThan(1700);
  });
  it('retries without grounding when Search grounding has no quota', async () => {
    const attempt = vi.fn(async (m, { grounding }) => { if (grounding) throw err('[429 ] You exceeded your current quota'); return { text: 'plain', source: 'in_cloud' }; });
    const r = await callCloud({ models: ['a'], attempt, grounding: true });
    expect(r.groundingUnavailable).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
  it('stops early with an App Check message on 401', async () => {
    const attempt = vi.fn(async () => { throw err('[401 ] Firebase App Check token is invalid.'); });
    await expect(callCloud({ models: ['a', 'b'], attempt })).rejects.toThrow(/App Check/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('classifies errors', () => {
    expect(classifyError(err('[429 ] quota'))).toBe('quota');
    expect(classifyError(err('[404 ] model not found'))).toBe('model');
    expect(classifyError(err('[503 ] UNAVAILABLE'))).toBe('busy');
  });
  it('withTimeout rejects', async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow(/timed out/);
  });
});
