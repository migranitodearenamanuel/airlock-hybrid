// Deterministic PII detectors. Pure functions: no network, no Firebase.
// These run on every device (even when no on-device LLM is present) so that
// the cloud fallback can never receive raw identifiers.

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function validDniNie(raw) {
  const v = raw.toUpperCase().replace(/[\s-]/g, '');
  let m = v.match(/^(\d{8})([A-Z])$/);
  if (m) return DNI_LETTERS[Number(m[1]) % 23] === m[2];
  m = v.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (m) {
    const n = Number('XYZ'.indexOf(m[1]) + m[2]);
    return DNI_LETTERS[n % 23] === m[3];
  }
  return false;
}

export function validIban(raw) {
  const v = raw.toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const re = v.slice(4) + v.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const code = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export function validLuhn(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

const DETECTORS = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, check: validIban },
  { type: 'CARD', re: /\b(?:\d[ -]?){12,18}\d\b/g, check: validLuhn },
  { type: 'ID', re: /\b(?:\d{8}|[XYZxyz]\d{7})[ -]?[A-Za-z]\b/g, check: validDniNie },
  { type: 'ID', re: /\b\d{3}-\d{2}-\d{4}\b/g }, // US SSN format
  { type: 'PHONE', re: /(?:\+\d{1,3}[ .-]?)?\(?\d{2,4}\)?(?:[ .-]?\d{2,4}){2,4}/g,
    check: (s) => { const n = s.replace(/\D/g, ''); return n.length >= 9 && n.length <= 15; } },
  { type: 'ADDRESS', re: /\b(?:C\/|Calle|Avda\.?|Avenida|Plaza|Paseo|Camino|Street|St\.|Avenue|Ave\.|Road|Rd\.)\s+[^\n,;]{2,40}(?:,?\s*(?:n[ºo°]\.?\s*)?\d+[A-Za-zº°ª]?)?/g },
  { type: 'POSTCODE_CITY', re: /\b\d{5}\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?\b/g },
  { type: 'PERSON', group: 1,
    re: /(?:\b(?:Mr|Mrs|Ms|Dr|Sr|Sra|Srta|Dña|Dª|D)\.?|\b(?:Don|Doña|Dear|Estimado|Estimada|Titular|Nombre|Name|Patient|Paciente)\b:?)\s+((?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ'-]+)(?:\s+(?:de\s+|del\s+|la\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ'-]+){0,3})/g },
];

/** Returns [{type, value, start, end, by:'rule'}] sorted, non-overlapping. */
export function detectPII(text) {
  const found = [];
  for (const d of DETECTORS) {
    d.re.lastIndex = 0;
    let m;
    while ((m = d.re.exec(text)) !== null) {
      let value = m[0];
      let start = m.index;
      if (d.group) { value = m[d.group]; start = m.index + m[0].lastIndexOf(value); }
      value = value.trim().replace(/[.,;:]+$/, '');
      if (!value || (d.check && !d.check(value))) continue;
      found.push({ type: d.type, value, start, end: start + value.length, by: 'rule' });
    }
  }
  return dedupe(found);
}

/** Merge entity strings proposed by the on-device model ({text,type}) into spans. */
export function spansFromModel(text, modelEntities = []) {
  const out = [];
  for (const e of modelEntities) {
    const v = (e && e.text ? String(e.text) : '').trim();
    if (v.length < 2) continue;
    let i = text.indexOf(v);
    while (i !== -1) {
      out.push({ type: String(e.type || 'PII').toUpperCase(), value: v, start: i, end: i + v.length, by: 'on-device' });
      i = text.indexOf(v, i + v.length);
    }
  }
  return out;
}

export function dedupe(spans) {
  // Prefer longer spans; drop overlaps.
  const sorted = [...spans].sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept = [];
  for (const s of sorted) {
    if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * Replace spans by stable placeholders. The vault (placeholder -> original)
 * only lives in memory on the user's device.
 */
export function redact(text, spans) {
  const vault = new Map();
  const byValue = new Map();
  const counters = {};
  let out = '';
  let pos = 0;
  for (const s of dedupe(spans)) {
    out += text.slice(pos, s.start);
    let token = byValue.get(s.value);
    if (!token) {
      counters[s.type] = (counters[s.type] || 0) + 1;
      token = `[${s.type}_${counters[s.type]}]`;
      byValue.set(s.value, token);
      vault.set(token, s.value);
    }
    out += token;
    pos = s.end;
  }
  out += text.slice(pos);
  return { redacted: out, vault };
}

export function rehydrate(text, vault) {
  let out = text;
  for (const [token, original] of vault) out = out.split(token).join(original);
  return out;
}

/** Re-redact a text (e.g. a model answer) with an existing vault before persisting it. */
export function reRedact(text, vault) {
  let out = text;
  const entries = [...vault].sort((a, b) => b[1].length - a[1].length);
  for (const [token, original] of entries) out = out.split(original).join(token);
  return out;
}

/** Throws if any original value from the vault is present in an outgoing payload. */
export function assertNoLeak(payload, vault) {
  for (const original of vault.values()) {
    if (original.length >= 3 && payload.includes(original)) {
      throw new Error('Airlock leak guard: a protected value was about to leave the device.');
    }
  }
  return true;
}
