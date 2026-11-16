// Routing policy for hybrid inference. Pure and unit-tested.
export const DEFAULT_CONFIG = {
  maxLocalTokens: 6000, // Chrome on-device limit is 9216 tokens incl. output
  cloudModel: 'gemini-3.8-flash',
  strictLocalDefault: false,
};

export const TASKS = {
  explain: { label: 'Explain it in plain language', needsWeb: false },
  actions: { label: 'Deadlines, amounts & what I must do', needsWeb: false },
  reply: { label: 'Draft a reply', needsWeb: false },
  scam: { label: 'Is this legit or a scam? (web check)', needsWeb: true },
};

export const estimateTokens = (chars) => Math.ceil(chars / 3.5);

/**
 * @returns {{route:'local-raw'|'cloud-redacted'|'blocked', reasons:string[]}}
 * local-raw      = full original text, on-device model only, nothing leaves.
 * cloud-redacted = only the redacted text is sent to the cloud model.
 */
export function decideRoute({ chars, task, online, localAvailable, strictLocal, config = DEFAULT_CONFIG }) {
  const reasons = [];
  const t = TASKS[task] || TASKS.explain;
  const tokens = estimateTokens(chars);
  const tooLong = tokens > config.maxLocalTokens;

  if (strictLocal) {
    if (!localAvailable) return { route: 'blocked', reasons: ['Strict on-device mode is on, but no on-device model is available on this device.'] };
    if (t.needsWeb) return { route: 'blocked', reasons: ['Web verification needs the cloud model; strict on-device mode forbids it.'] };
    if (tooLong) return { route: 'blocked', reasons: [`~${tokens} tokens exceeds the on-device budget (${config.maxLocalTokens}).`] };
    return { route: 'local-raw', reasons: ['Strict on-device mode: everything stays on this device.'] };
  }
  if (!online) {
    if (localAvailable && !tooLong && !t.needsWeb) return { route: 'local-raw', reasons: ['Offline: answered by the on-device model.'] };
    return { route: 'blocked', reasons: ['Offline and this request cannot run on-device.'] };
  }
  if (t.needsWeb) reasons.push('Web verification (Grounding with Google Search) is cloud-only.');
  if (tooLong) reasons.push(`~${tokens} tokens exceeds the on-device budget (${config.maxLocalTokens}).`);
  if (!localAvailable) reasons.push('No on-device model available on this device/browser.');
  if (reasons.length) return { route: 'cloud-redacted', reasons: [...reasons, 'Only the redacted text leaves the device.'] };
  return { route: 'local-raw', reasons: ['Fits on-device: private, free and works offline.'] };
}
