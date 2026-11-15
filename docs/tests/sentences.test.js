// Browser tests for the 300-sentence player (docs/sentences.html). Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const API = 'https://api.test/exec';
// Each sentence: Korean 0-1s, English 1-3s of its own 3-second block.
const ITEMS = [1, 2, 3, 4].map(no => ({ no, ko: '한국어 ' + no, en: 'English ' + no, start: (no - 1) * 3, enStart: (no - 1) * 3 + 1, end: no * 3, state: no === 1 ? '외움' : '못외움', memorized: '', plays: 0 }));

let browser, server, base;
before(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(ROOT, new URL(req.url, 'http://x').pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch();
});
after(async () => { await browser.close(); server.close(); });

async function open(context, { prefs } = {}) {
  context = context || await browser.newContext();
  const page = await context.newPage(), calls = [];
  await page.route(API, async route => {
    const body = JSON.parse(route.request().postData());
    calls.push(body);
    const result = body.fn === 'sentenceDeckLoad' ? { items: JSON.parse(JSON.stringify(ITEMS)), audio: { parts: [{ name: 'part-00', size: 3 }, { name: 'part-01', size: 3 }], version: 'v1' } }
      : body.fn === 'sentenceAudioPart' ? Buffer.from('abc').toString('base64')
      : body.fn === 'sentenceDeckMark' ? { no: body.args[0], state: body.args[1], memorized: '2026-11-15' } : true;
    await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, result }) });
  });
  await page.addInitScript(([api, prefs]) => {
    localStorage.setItem('studyApiKey', 'secret'); localStorage.setItem('studyApiUrl', api);
    if (prefs) localStorage.setItem('sentencePrefsV1', JSON.stringify(prefs));
    // Fake media clock: 0.25s of audio every 20ms while playing; records every seek.
    const proto = HTMLMediaElement.prototype, log = window.mediaLog = { seeks: [], playing: false };
    Object.defineProperty(proto, 'currentTime', { get() { return this._t || 0; }, set(v) { this._t = v; log.seeks.push(v); } });
    Object.defineProperty(proto, 'paused', { get() { return !this._timer; } });
    proto.play = function () { if (!this._timer) { this._timer = setInterval(() => { this._t = (this._t || 0) + 0.25; this.dispatchEvent(new Event('timeupdate')); if (this._t >= 12) { this.pause(); this.dispatchEvent(new Event('ended')); } }, 20); this.dispatchEvent(new Event('play')); } return Promise.resolve(); };
    proto.pause = function () { if (this._timer) { clearInterval(this._timer); this._timer = null; this.dispatchEvent(new Event('pause')); } };
  }, [API, prefs || null]);
  await page.goto(base + 'sentences.html');
  await page.waitForFunction(() => /준비 완료/.test(document.getElementById('notice').textContent));
  return { page, calls, context };
}
const now = page => page.$eval('#nowNo', n => parseInt(n.textContent, 10));
async function playedOrder(page, ms) {
  const order = [];
  const end = Date.now() + ms;
  while (Date.now() < end) { const n = await now(page); if (n && order[order.length - 1] !== n) order.push(n); await page.waitForTimeout(25); }
  return order;
}

test('shows progress and downloads the audio parts once', async () => {
  const { page, calls, context } = await open();
  assert.match(await page.textContent('#summary'), /외움 1 \/ 4개/);
  assert.deepStrictEqual(calls.filter(c => c.fn === 'sentenceAudioPart').map(c => c.args[0]), ['part-00', 'part-01']);
  assert.ok(calls.every(c => c.key === 'secret'));
  await page.close();
  const again = await open(context);
  assert.strictEqual(again.calls.filter(c => c.fn === 'sentenceAudioPart').length, 0, 'second visit uses the saved audio');
  await context.close();
});

test('"못 외운 것만" plays only unmemorized sentences and loops', async () => {
  const { page, context } = await open();
  await page.click('#play');
  const order = await playedOrder(page, 900);
  assert.deepStrictEqual(order.slice(0, 4), [2, 3, 4, 2], order.join(','));
  await context.close();
});

test('marking the current sentence 외움 removes it from the loop and saves it', async () => {
  const { page, calls, context } = await open();
  await page.click('#play');
  await page.waitForFunction(() => parseInt(document.getElementById('nowNo').textContent, 10) === 3);
  await page.click('#markNow');
  const order = await playedOrder(page, 900);
  assert.ok(!order.slice(1).includes(3), 'sentence 3 is not played again: ' + order.join(','));
  const mark = calls.find(c => c.fn === 'sentenceDeckMark');
  assert.deepStrictEqual(mark.args, [3, '외움']);
  assert.match(await page.textContent('#summary'), /외움 2 \/ 4개/);
  await context.close();
});

test('"영어만" starts each sentence at its English part', async () => {
  const { page, context } = await open(null, { prefs: { mode: 'en', filter: 'all' } });
  await page.click('#play');
  await page.waitForTimeout(500);
  const seeks = await page.evaluate(() => window.mediaLog.seeks);
  assert.ok(seeks.includes(1) && seeks.includes(4), 'seeks to English starts: ' + seeks.join(','));
  await context.close();
});

test('hiding English shows it only after tapping', async () => {
  const { page, context } = await open(null, { prefs: { hideEn: true } });
  await page.click('#play');
  await page.waitForTimeout(60);
  assert.match(await page.textContent('#nowEn'), /영어 보기/);
  await page.click('#nowEn');
  assert.match(await page.textContent('#nowEn'), /English/);
  assert.ok(!(await page.textContent('#list')).includes('English 2'));
  await context.close();
});

test('range limits the loop to the chosen numbers', async () => {
  const { page, context } = await open(null, { prefs: { from: '3', to: '4', filter: 'all' } });
  await page.click('#play');
  const order = await playedOrder(page, 700);
  assert.ok(order.every(n => n === 3 || n === 4), order.join(','));
  await context.close();
});
