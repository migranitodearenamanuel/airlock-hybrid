// The Airlock pipeline: engine-agnostic so it can be unit-tested with a fake engine.
import { detectPII, spansFromModel, redact, rehydrate, reRedact, assertNoLeak, dedupe } from './pii.js';
import { decideRoute, TASKS, DEFAULT_CONFIG } from './router.js';

export const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    docType: { type: 'string' },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, type: { type: 'string', enum: ['PERSON', 'ADDRESS', 'ID', 'ACCOUNT', 'HEALTH', 'OTHER'] } },
        required: ['text', 'type'],
      },
    },
  },
  required: ['docType', 'entities'],
};

export function detectPrompt(text) {
  return `You are a privacy filter. List every piece of personal data in the document: people's names, home addresses, ID/account/policy/case numbers, and health conditions. Copy each item EXACTLY as written. Also give a short docType (e.g. "bank letter", "medical report", "tax notice", "SMS").\n\nDOCUMENT:\n${text}`;
}

export function taskPrompt(task, text, lang) {
  const answerLang = lang ? `Answer in ${lang}.` : 'Answer in the same language as the document.';
  const keep = 'Placeholders like [PERSON_1] or [IBAN_1] stand for private data: keep them exactly as they are.';
  const p = {
    explain: 'Explain this document in plain, friendly language for a non-expert: what it is, what it means for me, and whether I need to do anything. Max 150 words.',
    actions: 'Extract every deadline, amount of money and required action as a short checklist: "- [date] action (amount)". If there are none, say so.',
    reply: 'Draft a short, polite reply to this message that I can send. Keep it under 120 words.',
    scam: 'Assess whether this message/letter is legitimate or a likely scam. Use web search to check the sender, phone numbers, domains and the procedure described. Give a verdict (Likely legit / Suspicious / Likely scam), 3 reasons, and the safe next step.',
  }[task] || 'Summarise this document.';
  return `${p}\n${keep}\n${answerLang}\n\nDOCUMENT:\n${text}`;
}

export const TRANSCRIBE_PROMPT = 'Transcribe all the text in this image exactly, preserving line breaks. Output only the text.';

/**
 * engine = {
 *   localAvailable(): Promise<boolean>,
 *   local(prompt, {schema?, image?}): Promise<{text, source}>,
 *   cloud(prompt, {grounding}): Promise<{text, source, sources?}>
 * }
 */
export async function runAirlock({ text = '', image = null, task = 'explain', engine, online = true, strictLocal = false, config = DEFAULT_CONFIG, lang = '' }) {
  const steps = [];
  const localAvailable = await engine.localAvailable();
  let docText = text;

  if (image) {
    if (!localAvailable) {
      return { route: 'blocked', reasons: ['Images are only read on-device, and no on-device model is available. Paste the text instead.'], steps };
    }
    const t = await engine.local(TRANSCRIBE_PROMPT, { image });
    steps.push({ step: 'transcribe image', source: t.source });
    docText = (docText ? docText + '\n\n' : '') + t.text;
  }
  if (!docText.trim()) return { route: 'blocked', reasons: ['Nothing to process.'], steps };

  // 1. Detect PII: deterministic rules everywhere + on-device model when present.
  let spans = detectPII(docText);
  let docType = '';
  if (localAvailable) {
    try {
      const d = await engine.local(detectPrompt(docText), { schema: ENTITY_SCHEMA });
      const parsed = JSON.parse(d.text);
      docType = parsed.docType || '';
      spans = dedupe([...spans, ...spansFromModel(docText, parsed.entities)]);
      steps.push({ step: 'detect personal data', source: d.source });
    } catch (e) {
      steps.push({ step: 'detect personal data (model failed, rules only)', source: 'rules' });
    }
  } else {
    steps.push({ step: 'detect personal data (rules only)', source: 'rules' });
  }
  const { redacted, vault } = redact(docText, spans);

  // 2. Route.
  const decision = decideRoute({ chars: docText.length, task, online, localAvailable, strictLocal, config });
  const base = { route: decision.route, reasons: decision.reasons, spans, redacted, docType, steps, vaultSize: vault.size };
  if (decision.route === 'blocked') return base;

  // 3. Execute.
  if (decision.route === 'local-raw') {
    const r = await engine.local(taskPrompt(task, docText, lang));
    steps.push({ step: TASKS[task].label, source: r.source });
    return { ...base, output: r.text, source: r.source, egress: '', storable: reRedact(r.text, vault) };
  }
  const prompt = taskPrompt(task, redacted, lang);
  assertNoLeak(prompt, vault);
  const r = await engine.cloud(prompt, { grounding: TASKS[task].needsWeb });
  steps.push({ step: TASKS[task].label, source: r.source });
  return { ...base, output: rehydrate(r.text, vault), source: r.source, sources: r.sources || [], egress: prompt, storable: r.text };
}
