import puppeteer from 'puppeteer-core';
// Live end-to-end check (headless Chrome): node scripts/live-check.mjs [url] [task] [timeoutMs]
const url = process.argv[2] || 'https://airlock-hybrid-fdadf.web.app';
const task = process.argv[3] || 'explain';
const wait = Number(process.argv[4] || 60000);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const t0 = Date.now(); const ts = () => ((Date.now()-t0)/1000).toFixed(1)+'s';
page.on('console', (m) => console.log(ts(), 'CONSOLE', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log(ts(), 'PAGEERROR', e.message));
page.on('response', async (r) => { const u = r.url(); if (/googleapis|recaptcha|firebase|favicon/.test(u)) { let b=''; if (r.status()>=400) { try { b=(await r.text()).slice(0,400);} catch{} } console.log(ts(), 'RESP', r.status(), r.request().method(), u.replace(/key=[^&]+/,'key=XXX').slice(0,160), b.replace(/\s+/g,' ')); } });
page.on('requestfailed', (r) => console.log(ts(), 'REQFAIL', r.url().slice(0,160), r.failure()?.errorText));
await page.goto(url, { waitUntil: 'networkidle2' });
await page.click('#btn-sample');
await page.select('#task', task);
await page.click('#btn-run');
try { await page.waitForFunction(() => !/Working/.test(document.getElementById('out').textContent), { timeout: wait }); } catch { console.log(ts(), 'TIMEOUT still Working'); }
console.log(ts(), 'ROUTE', await page.$eval('#route', e=>e.textContent));
console.log(ts(), 'OUT', (await page.$eval('#out', e=>e.textContent)).replace(/\s+/g,' ').slice(0,400));
console.log(ts(), 'SRC', await page.$eval('#src', e=>e.textContent));
await page.screenshot({ path: '/workspace/airlock-debug/live.png', fullPage: true });
await browser.close();
