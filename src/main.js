import { runAirlock } from './airlock.js';
import { TASKS } from './router.js';
import { SAMPLES } from './samples.js';
import { createDemoEngine } from './engine-demo.js';

const $ = (id) => document.getElementById(id);
const env = import.meta.env;
let engine;
let last = null;
let sampleIdx = 0;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const highlight = (s) => esc(s).replace(/\[[A-Z_]+_\d+\]/g, (t) => `<mark>${t}</mark>`);

async function refreshStatus() {
  const a = await engine.availability();
  const ready = await engine.localAvailable();
  $('st-device').textContent = ready ? 'ready (Gemini Nano)' : a === 'available' ? 'available — click Enable' : a;
  $('dot-device').className = 'dot ' + (ready ? 'ok' : a === 'unavailable' ? 'bad' : 'warn');
  $('st-net').textContent = navigator.onLine ? 'online' : 'offline';
  $('dot-net').className = 'dot ' + (navigator.onLine ? 'ok' : 'bad');
  $('btn-init').classList.toggle('hidden', ready || a === 'unavailable');
}

async function loadHistory() {
  try {
    const items = await engine.history();
    $('hist').innerHTML = items.map((h) => `<li><span class="badge ${h.source}">${h.source}</span> <b>${esc(h.task)}</b> — ${highlight(h.text.slice(0, 220))}</li>`).join('') || '<li class="muted">Empty</li>';
  } catch (e) { $('hist').innerHTML = `<li class="muted">History unavailable: ${esc(e.message)}</li>`; }
}

async function run() {
  $('btn-run').disabled = true;
  $('out').textContent = 'Working…';
  $('out').className = 'out muted';
  const started = Date.now();
  const tick = setInterval(() => { $('out').textContent = `Working… ${Math.round((Date.now() - started) / 1000)} s`; }, 1000);
  try {
    const res = await runAirlock({
      text: $('doc').value,
      image: $('img').files[0] || null,
      task: $('task').value,
      engine,
      online: navigator.onLine,
      strictLocal: $('strict').checked,
      config: engine.config,
    });
    last = { ...res, task: $('task').value };
    const label = { 'local-raw': '🔒 On-device — nothing left this device', 'cloud-redacted': '☁️ Cloud with redacted text', blocked: '⛔ Blocked' }[res.route];
    $('route').textContent = label;
    $('route').className = 'route ' + res.route;
    $('reasons').innerHTML = res.reasons.map((r) => `<li>${esc(r)}</li>`).join('');
    $('steps').innerHTML = (res.steps || []).map((s) => `<li>${esc(s.step)} <span class="badge ${s.source}">${esc(s.source)}</span></li>`).join('');
    $('egress').innerHTML = res.egress ? highlight(res.egress) : (res.route === 'local-raw' ? '0 bytes. The whole request was answered by the on-device model.' : 'Nothing.');
    $('n-ent').textContent = (res.spans || []).length;
    $('ents').innerHTML = (res.spans || []).map((s) => `<tr><td>${esc(s.type)}</td><td>${esc(s.value)}</td><td>${esc(s.by)}</td></tr>`).join('');
    if (res.output) {
      $('out').textContent = res.output;
      $('out').className = 'out';
      $('src').textContent = res.source;
      $('src').className = 'badge ' + res.source;
      $('cites').innerHTML = (res.sources || []).map((c) => `<li><a href="${esc(c.uri)}" target="_blank" rel="noopener">${esc(c.title || c.uri)}</a></li>`).join('');
      $('btn-save').classList.remove('hidden');
    } else {
      $('out').textContent = '—';
      $('src').textContent = '';
      $('btn-save').classList.add('hidden');
    }
  } catch (e) {
    console.error('[airlock] run failed', e);
    $('out').textContent = '⚠️ ' + (e.message || String(e));
    $('out').className = 'out error';
    $('src').textContent = '';
    $('btn-save').classList.add('hidden');
  } finally {
    clearInterval(tick);
    $('btn-run').disabled = false;
  }
}

async function boot() {
  for (const [k, v] of Object.entries(TASKS)) $('task').insertAdjacentHTML('beforeend', `<option value="${k}">${v.label}</option>`);
  if (env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID) {
    const { createFirebaseEngine } = await import('./engine-firebase.js');
    engine = await createFirebaseEngine(env);
  } else {
    engine = createDemoEngine();
    $('mode-banner').textContent = 'Demo mode: no Firebase config found, answers are simulated. See README to connect Firebase AI Logic.';
    $('mode-banner').classList.remove('hidden');
  }
  $('strict').checked = !!engine.config.strictLocalDefault;
  $('btn-init').onclick = async () => {
    $('dl').classList.remove('hidden');
    try { await engine.initDevice((p) => { $('dl').value = p; }); } catch (e) { alert('On-device model unavailable: ' + e.message); }
    $('dl').classList.add('hidden');
    refreshStatus();
  };
  $('btn-sample').onclick = () => { $('doc').value = SAMPLES[sampleIdx++ % SAMPLES.length]; };
  $('btn-run').onclick = run;
  $('btn-save').onclick = async () => {
    if (!last) return;
    await engine.save({ task: last.task, route: last.route, source: last.source, docType: last.docType || '', text: last.storable });
    loadHistory();
  };
  window.addEventListener('online', refreshStatus);
  window.addEventListener('offline', refreshStatus);
  refreshStatus();
  loadHistory();
}
boot();
