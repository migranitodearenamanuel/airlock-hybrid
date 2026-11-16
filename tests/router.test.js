import { describe, it, expect } from 'vitest';
import { decideRoute } from '../src/router.js';

const base = { chars: 1000, task: 'explain', online: true, localAvailable: true, strictLocal: false };
describe('decideRoute', () => {
  it('short + local available => on-device raw', () => expect(decideRoute(base).route).toBe('local-raw'));
  it('no local model => cloud redacted', () => expect(decideRoute({ ...base, localAvailable: false }).route).toBe('cloud-redacted'));
  it('too long => cloud redacted', () => expect(decideRoute({ ...base, chars: 60000 }).route).toBe('cloud-redacted'));
  it('web check => cloud redacted', () => expect(decideRoute({ ...base, task: 'scam' }).route).toBe('cloud-redacted'));
  it('offline with local => local', () => expect(decideRoute({ ...base, online: false }).route).toBe('local-raw'));
  it('offline without local => blocked', () => expect(decideRoute({ ...base, online: false, localAvailable: false }).route).toBe('blocked'));
  it('strict never goes to cloud', () => {
    expect(decideRoute({ ...base, strictLocal: true, task: 'scam' }).route).toBe('blocked');
    expect(decideRoute({ ...base, strictLocal: true, localAvailable: false }).route).toBe('blocked');
    expect(decideRoute({ ...base, strictLocal: true }).route).toBe('local-raw');
  });
});
