// Headless smoke test of the UI in demo mode (no Firebase config): node scripts/smoke.mjs
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1500 });
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle0' });
  await page.click('#btn-sample');
  // Demo engine with local model: explain -> on-device
  await page.click('#btn-run');
  await page.waitForFunction(() => document.getElementById('route').textContent !== '—');
  const r1 = await page.$eval('#route', (e) => e.textContent);
  // Scam check -> cloud with redacted text
  await page.select('#task', 'scam');
  await page.click('#btn-run');
  await page.waitForFunction(() => document.getElementById('route').textContent.includes('Cloud'));
  const egress = await page.$eval('#egress', (e) => e.textContent);
  await page.screenshot({ path: 'docs/screenshot-demo.png', fullPage: true });
  const leaked = ['Juan García López', '12345678Z', 'ES91 2100'].filter((v) => egress.includes(v));
  console.log(JSON.stringify({ r1, cloudRoute: await page.$eval('#route', (e) => e.textContent), leaked, egressSample: egress.slice(0, 160) }, null, 1));
  if (leaked.length) process.exitCode = 1;
} finally { await browser.close(); srv.kill(); }
