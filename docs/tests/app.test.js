// Browser tests for the GitHub Pages study app (docs/index.html). Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const API = 'https://api.test/exec';
const fileId = (text, voice = 'am_fenrir') => crypto.createHash('sha1').update('kokoro-' + voice + '|' + text).digest('hex').slice(0, 20);
const CARDS = [
  { id: 'a1', book: 'general', type: 'word', row: 5, date: '2026-10-01', month: '2026-10', week: '1주차', english: 'compost', meaning: '퇴비', count: 2, status: '모름', reviewed: '', memo: '', unknownStreak: 0, unknownSince: '', unknownTotal: 0 },
  { id: 'a2', book: 'general', type: 'word', row: 6, date: '2026-10-01', month: '2026-10', week: '1주차', english: 'manure', meaning: '분뇨', count: 0, status: '미평가', reviewed: '', memo: '', unknownStreak: 0, unknownSince: '', unknownTotal: 0 }
];

let browser, server, base;
before(async () => {
  // Serve docs/ over http so fetch('audio/manifest.json') works; the manifest only lists "compost".
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/audio/manifest.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ files: { 'kokoro-am_fenrir': [fileId('compost')], 'kokoro-am_puck': [fileId('compost', 'am_puck')], 'kokoro-am_liam': [], 'kokoro-am_adam': [], 'kokoro-bm_daniel': [] } })); }
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch();
});
after(async () => { await browser.close(); server.close(); });

async function open(query = '', { key = 'secret', apiReply } = {}) {
  const page = await browser.newPage();
  const calls = [];
  await page.route(/unpkg\.com/, route => route.fulfill({ body: '' }));
  await page.route(API, async route => {
    const body = JSON.parse(route.request().postData());
    calls.push(body);
    const custom = apiReply && apiReply(body);
    const result = custom !== undefined ? custom : body.key !== 'secret' ? { ok: false, auth: false, error: '연결 키가 맞지 않습니다.' }
      : body.fn === 'mobileStudyPreferences' ? { ok: true, result: {} }
      : body.fn === 'mobileStudyLoad' ? { ok: true, result: { book: 'general', title: '영어 통합 학습장', cards: JSON.parse(JSON.stringify(CARDS)), sheetUrl: '#', today: '2026-10-12' } }
      : body.fn === 'mobileStudyReview' ? { ok: true, result: { count: 3, status: body.args[1], reviewed: '2026-10-12', unknownStreak: 0, unknownSince: '', unknownTotal: 0 } }
      : { ok: true, result: true };
    await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  });
  await page.addInitScript(([api, key]) => {
    if (key) localStorage.setItem('studyApiKey', key);
    localStorage.setItem('studyApiUrl', api);
    const log = window.speechLog = { files: [], spoken: [] };
    window.Audio = class { constructor() { this.src = ''; } play() { log.files.push({ src: this.src, rate: this.playbackRate, at: performance.now() }); this.timer = setTimeout(() => this.onended && this.onended(), 100); return Promise.resolve(); } pause() { clearTimeout(this.timer); } };
    const voices = [{ name: 'Microsoft David', lang: 'en-US', voiceURI: 'David' }];
    Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => voices, addEventListener() {}, cancel() {}, speak(u) { log.spoken.push({ text: u.text, voice: u.voice && u.voice.name }); setTimeout(() => u.onend && u.onend(), 50); } } });
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  }, [API, key]);
  await page.goto(base + query);
  return { page, calls };
}
const log = page => page.evaluate(() => window.speechLog);
async function ready(page) { await page.waitForSelector('.study-card'); await page.waitForTimeout(150); }

test('asks for the connection key on first visit', async () => {
  const { page } = await open('', { key: '' });
  await page.waitForSelector('#setupKey');
  assert.match(await page.textContent('#content'), /연결 키/);
  await page.close();
});

test('setup link stores the key, removes it from the address and loads the sheet data', async () => {
  const { page, calls } = await open('?key=secret', { key: '' });
  await ready(page);
  assert.ok(!page.url().includes('key='), page.url());
  assert.deepStrictEqual(calls.map(c => c.fn).slice(0, 2), ['mobileStudyPreferences', 'mobileStudyLoad']);
  assert.ok(calls.every(c => c.key === 'secret'));
  assert.match(await page.textContent('.term'), /compost/);
  await page.close();
});

test('wrong key shows the setup form again', async () => {
  const { page } = await open('', { key: 'wrong' });
  await page.waitForSelector('#setupKey');
  assert.match(await page.textContent('#content'), /맞지 않습니다/);
  await page.close();
});

test('plays the Fenrir voice file by default when one exists', async () => {
  const { page } = await open();
  await ready(page);
  assert.match(await page.textContent('#speechVoice option'), /Fenrir · 모든 기기/);
  await page.click('text=발음 듣기');
  await page.waitForTimeout(50);
  const { files, spoken } = await log(page);
  assert.strictEqual(files.length, 1);
  assert.ok(files[0].src.endsWith('audio/' + fileId('compost') + '.mp3'), files[0].src);
  assert.strictEqual(spoken.length, 0);
  await page.close();
});

test('falls back to the device male voice when the file is not made yet', async () => {
  const { page } = await open();
  await ready(page);
  await page.click('text=다음');
  await page.click('text=발음 듣기');
  await page.waitForTimeout(50);
  const { files, spoken } = await log(page);
  assert.strictEqual(files.length, 0);
  assert.deepStrictEqual(spoken[0], { text: 'manure', voice: 'Microsoft David' });
  await page.close();
});

test('5x repeat replays the file with a 0.5s gap and stops on another action', async () => {
  const { page } = await open();
  await ready(page);
  await page.click('text=5회 반복');
  await page.waitForTimeout(1400);
  const { files } = await log(page);
  assert.ok(files.length >= 2);
  const gap = files[1].at - files[0].at;
  assert.ok(gap >= 580 && gap < 900, 'gap ' + gap);
  await page.click('.face');
  const count = (await log(page)).files.length;
  await page.waitForTimeout(1500);
  assert.strictEqual((await log(page)).files.length, count);
  await page.close();
});

test('slow speed plays the file at 0.75x', async () => {
  const { page } = await open();
  await ready(page);
  await page.click('#audioSettings summary');
  await page.selectOption('#speechRate', '0.75');
  await page.click('text=발음 듣기');
  await page.waitForTimeout(50);
  assert.strictEqual((await log(page)).files[0].rate, 0.75);
  await page.close();
});

test('rating a card saves it to the sheet through the API', async () => {
  const { page, calls } = await open();
  await ready(page);
  await page.click('.state-buttons button:has-text("외움")');
  await page.waitForTimeout(200);
  const review = calls.find(c => c.fn === 'mobileStudyReview');
  assert.ok(review, 'review call sent');
  assert.strictEqual(review.args[0].id, 'a1');
  assert.strictEqual(review.args[1], '기억남');
  await page.close();
});

test('the voice menu offers the chosen file voices and plays the picked one', async () => {
  const { page, calls } = await open();
  await ready(page);
  const labels = await page.$$eval('#speechVoice option', l => l.map(o => o.textContent));
  assert.deepStrictEqual(labels.slice(0, 5), ['Fenrir · 모든 기기 같은 목소리 (자동)', 'Fenrir · 모든 기기 같은 목소리', 'Puck · 모든 기기 같은 목소리', 'Liam · 모든 기기 같은 목소리 (만드는 중)', 'Adam · 모든 기기 같은 목소리 (만드는 중)']);
  await page.selectOption('#speechVoice', 'file:kokoro-am_puck');
  await page.click('text=발음 듣기');
  await page.waitForTimeout(50);
  const { files } = await log(page);
  assert.ok(files.at(-1).src.endsWith(fileId('compost', 'am_puck') + '.mp3'));
  await page.waitForTimeout(700);
  const saved = calls.filter(c => c.fn === 'mobileStudySavePreferences').at(-1);
  assert.strictEqual(saved.args[0].audio.voice, 'file:kokoro-am_puck');
  await page.close();
});

test('British accent offers Daniel', async () => {
  const { page } = await open();
  await ready(page);
  await page.click('#audioSettings summary');
  await page.selectOption('#speechAccent', 'en-GB');
  const labels = await page.$$eval('#speechVoice option', l => l.map(o => o.textContent));
  assert.ok(labels.includes('Daniel · 모든 기기 같은 목소리 (만드는 중)'), labels.join(' | '));
  assert.ok(!labels.some(l => /Fenrir|Puck/.test(l)));
  await page.close();
});
