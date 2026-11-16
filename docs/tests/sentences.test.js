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
const ITEMS = [1, 2, 3, 4].map(no => ({ no, ko: '한국어 ' + no, en: 'English ' + no, start: (no - 1) * 3, enStart: (no - 1) * 3 + 1, end: no * 3, state: no === 1 ? '외움' : '못외움', memorized: '', plays: 0, example: '', exampleKo: '', group: '' }));

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

async function open(context, { prefs, query = '', items = ITEMS } = {}) {
  context = context || await browser.newContext();
  const page = await context.newPage(), calls = [];
  await page.route(API, async route => {
    const body = JSON.parse(route.request().postData());
    calls.push(body);
    const result = body.fn === 'sentenceDeckLoad' ? { items: JSON.parse(JSON.stringify(items)), audio: { parts: [{ name: 'part-00', size: 3 }, { name: 'part-01', size: 3 }], version: 'v1' } }
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
    Object.defineProperty(proto, 'readyState', { get() { return 4; } });
    Object.defineProperty(proto, 'paused', { get() { return !this._timer; } });
    proto.play = function () { if (!this._timer) { this._timer = setInterval(() => { this._t = (this._t || 0) + 0.25; this.dispatchEvent(new Event('timeupdate')); if (this._t >= (window.mediaEnd || 12)) { this.pause(); this.dispatchEvent(new Event('ended')); } }, 20); this.dispatchEvent(new Event('play')); } return Promise.resolve(); };
    proto.pause = function () { if (this._timer) { clearInterval(this._timer); this._timer = null; this.dispatchEvent(new Event('pause')); } };
  }, [API, prefs || null]);
  await page.goto(base + 'sentences.html' + query);
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
  assert.deepStrictEqual(mark.args, [3, '외움', 's300']);
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
  const { page, context } = await open(null, { prefs: { hide: true } });
  await page.click('#play');
  await page.waitForTimeout(60);
  assert.match(await page.textContent('#nowSub'), /영어 보기/);
  await page.click('#nowSub');
  assert.match(await page.textContent('#nowSub'), /English/);
  assert.ok(!(await page.textContent('#list')).includes('English 2'));
  await context.close();
});

test('range limits the loop to the chosen numbers', async () => {
  const { page, context } = await open(null, { prefs: { from: '3', to: '4', filter: 'all', week: 'all' } });
  await page.click('#play');
  const order = await playedOrder(page, 700);
  assert.ok(order.every(n => n === 3 || n === 4), order.join(','));
  await context.close();
});

test('only one deck: the tab bar is hidden', async () => {
  const { page, context } = await open();
  assert.ok(await page.$eval('#tabs', n => n.hidden));
  assert.strictEqual(await page.textContent('#title'), '300문장');
  await context.close();
});

const MANY = Array.from({ length: 40 }, (_, i) => ({ ...ITEMS[1], no: i + 1, ko: '한국어 ' + (i + 1), en: 'English ' + (i + 1), start: i * 3, enStart: i * 3 + 1, end: (i + 1) * 3, state: '못외움' }));
const inView = (page, no) => page.$eval('[data-no="' + no + '"]', el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });

test('the list follows the sentence being played', async () => {
  const { page, context } = await open(null, { items: MANY, prefs: { filter: 'all' } });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(() => { window.mediaEnd = 120; });
  await page.click('#play');
  await page.waitForFunction(() => parseInt(document.getElementById('nowNo').textContent, 10) >= 6);
  await page.click('#play');
  await page.waitForTimeout(800);
  const no = await page.$eval('#nowNo', n => parseInt(n.textContent, 10));
  assert.ok(await inView(page, no), 'row ' + no + ' is on screen');
  await context.close();
});

test('after the audio moved on without the page, the player jumps to the sentence under the playhead', async () => {
  const { page, context } = await open(null, { items: MANY, prefs: { filter: 'all' } });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(() => { window.mediaEnd = 120; });
  await page.click('#play');
  await page.waitForTimeout(100);
  await page.evaluate(() => { const a = document.getElementById('audio'); a._t = 34 * 3 + 0.5; a.dispatchEvent(new Event('timeupdate')); a.pause(); });
  await page.waitForTimeout(800);
  const no = await page.$eval('#nowNo', n => parseInt(n.textContent, 10));
  assert.ok(no >= 35 && no <= 36, 'now at ' + no);
  assert.ok(await inView(page, no));
  await context.close();
});

const WEEKS = Array.from({ length: 120 }, (_, i) => ({ ...ITEMS[1], no: i + 1, ko: '한국어 ' + (i + 1), en: 'English ' + (i + 1), start: i * 3, enStart: i * 3 + 1, end: (i + 1) * 3, state: i + 1 === 7 ? '외움' : '못외움' }));
const daysAgo = n => { const d = new Date(Date.now() - n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const listed = page => page.$$eval('#list [data-no]', rows => rows.map(r => Number(r.dataset.no)));

test('weekly plan: the start date picks this week (50 sentences) and adds earlier unmemorized ones', async () => {
  const { page, context } = await open(null, { items: WEEKS, prefs: { startDate: daysAgo(8) } });
  assert.match(await page.textContent('#week'), /이번 주 \(자동 · 2주차\)/);
  const rows = await listed(page);
  assert.ok(rows.includes(51) && rows.includes(100) && !rows.includes(101), 'week 2 is 51-100');
  assert.ok(rows.includes(1) && !rows.includes(7), 'week 1 unmemorized included, memorized #7 left out');
  assert.match(await page.textContent('#summary'), /2주차\(51–100\) 0 \/ 50개/);
  await page.uncheck('#review');
  const only = await listed(page);
  assert.strictEqual(only[0], 51); assert.strictEqual(only.length, 50);
  await context.close();
});

test('weekly plan: picking a week by hand, and the last week holds the remainder', async () => {
  const { page, context } = await open(null, { items: WEEKS, prefs: { review: false } });
  assert.deepStrictEqual(await page.$$eval('#week option', o => o.map(x => x.textContent)).then(l => l.slice(2)), ['1주차 (1–50)', '2주차 (51–100)', '3주차 (101–120)']);
  await page.selectOption('#week', '3');
  const rows = await listed(page);
  assert.strictEqual(rows.length, 20); assert.strictEqual(rows[0], 101);
  assert.ok(await page.$eval('#startLabel', n => n.hidden));
  await context.close();
});

test('never plays the opening talk: a dropped seek is re-applied and gaps jump back to the sentence', async () => {
  const late = MANY.map(item => ({ ...item, start: item.start + 90, enStart: item.enStart + 90, end: item.end + 90 }));
  const { page, context } = await open(null, { items: late, prefs: { filter: 'all' } });
  await page.evaluate(() => { window.mediaEnd = 400; });
  await page.click('#play');
  // Simulate iOS ignoring the seek: playhead is back at the start of the file.
  await page.evaluate(() => { const a = document.getElementById('audio'); a._t = 0.5; a.dispatchEvent(new Event('timeupdate')); a.pause(); });
  const t = await page.evaluate(() => document.getElementById('audio').currentTime);
  assert.ok(t >= 90, 'playhead moved to the first sentence, got ' + t);
  await context.close();
});
