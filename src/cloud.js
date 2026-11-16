// Robust cloud calls: per-attempt timeout, overall deadline, model fallback chain and
// a graceful downgrade when Google Search grounding is not available (free-tier quota).
// Engine-agnostic so it can be unit-tested without Firebase.

export class CloudError extends Error {
  constructor(message, cause) { super(message); this.name = 'CloudError'; this.cause = cause; }
}

export function withTimeout(promise, ms, label = 'request') {
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`), { code: 'timeout' })), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

export function classifyError(e) {
  const m = String(e?.message || e);
  if (e?.code === 'timeout' || /timed out|abort/i.test(m)) return 'timeout';
  if (/\b401\b|App ?Check/i.test(m)) return 'appcheck';
  if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(m)) return 'quota';
  if (/\b404\b|not found/i.test(m)) return 'model';
  if (/\b5\d\d\b|high demand|UNAVAILABLE|INTERNAL|overloaded/i.test(m)) return 'busy';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'network';
  return 'other';
}

const FRIENDLY = {
  timeout: 'The cloud model did not answer in time.',
  appcheck: 'The cloud model refused the request because this browser could not pass App Check (reCAPTCHA) verification. Reload the page and try again, or use a browser with the on-device model.',
  quota: 'The free cloud quota is exhausted right now. Try again in a minute.',
  busy: 'The cloud model is overloaded right now. Try again in a minute.',
  model: 'The configured cloud model is not available.',
  network: 'Network error while contacting the cloud model. Check your connection.',
  other: 'The cloud model returned an error.',
};

/**
 * attempt(model, {grounding}) -> Promise<result>
 * Tries each model in order until one answers, never exceeding deadlineMs overall.
 * If grounding fails with a quota error (Search grounding has no free tier), retries ungrounded
 * and flags the result with `groundingUnavailable: true`.
 */
export async function callCloud({ models, attempt, grounding = false, deadlineMs = 20000, perAttemptMs = 12000, now = Date.now }) {
  const start = now();
  const errors = [];
  let useGrounding = grounding;
  let groundingUnavailable = false;
  const chain = [...new Set(models.filter(Boolean))];
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const left = deadlineMs - (now() - start);
    if (left < 1500) break;
    try {
      const r = await withTimeout(attempt(model, { grounding: useGrounding }), Math.min(perAttemptMs, left), `Cloud model ${model}`);
      return { ...r, model, groundingUnavailable, attempts: errors.length + 1 };
    } catch (e) {
      const kind = classifyError(e);
      errors.push({ model, kind, message: String(e?.message || e).slice(0, 300) });
      console.warn(`[airlock] cloud attempt ${model}${useGrounding ? ' (grounded)' : ''} failed: ${kind}`, e);
      if (kind === 'appcheck' || kind === 'network') break; // another model will fail the same way
      if (kind === 'quota' && useGrounding) { useGrounding = false; groundingUnavailable = true; i--; continue; }
    }
  }
  const lastKind = errors.length ? errors[errors.length - 1].kind : 'timeout';
  const kind = (now() - start) >= deadlineMs - 1500 && lastKind !== 'appcheck' ? 'timeout' : lastKind;
  throw Object.assign(new CloudError(`${FRIENDLY[kind]} (${errors.map((x) => `${x.model}: ${x.kind}`).join(', ') || 'no attempt'})`), { kind, errors });
}
