// Browser tests for StudyPage pronunciation. Run: npm test (needs Playwright + Chromium).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'StudyPage.html'), 'utf8');
const VOICES = {
  desktop: [
    { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
    { name: 'Microsoft Guy Online (Natural) - English (United States)', lang: 'en-US' },
    { name: 'Microsoft David - English (United States)', lang: 'en-US' },
    { name: 'Microsoft Mark - English (United States)', lang: 'en-US' },
    { name: 'Microsoft Christopher Online (Natural) - English (United States)', lang: 'en-US' },
    { name: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', lang: 'en-GB' },
    { name: 'Google US English', lang: 'en-US' }
  ],
  iphoneNoMale: [{ name: 'Samantha', lang: 'en-US' }, { name: 'Daniel', lang: 'en-GB' }]
};

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

// Opens the single-card listen page with fake device voices and a fake google.script.run.
async function open(voices, preferences = {}) {
  const boot = { listen: true, book: 'general', type: 'word', row: 5, preferences };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'study-')), 'page.html');
  fs.writeFileSync(file, source.replace('<?!= bootJson ?>', JSON.stringify(boot)).replace(/<script src="https:\/\/unpkg[^>]*><\/script>/, ''));
  const page = await browser.newPage();
  await page.addInitScript(list => {
    const voices = list.map(v => ({ ...v, voiceURI: v.name, localService: true, default: false }));
    const log = window.speechLog = { spoken: [], cancels: 0, saved: [] };
    let timers = [];
    const synth = {
      getVoices: () => voices, addEventListener() {},
      cancel() { log.cancels++; timers.forEach(clearTimeout); timers = []; },
      speak(u) {
        log.spoken.push({ text: u.text, voice: u.voice && u.voice.name, lang: u.lang, rate: u.rate, at: performance.now() });
        timers.push(setTimeout(() => u.onstart && u.onstart(), 5), setTimeout(() => u.onend && u.onend(), 100));
      }
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth });
    // The real utterance only accepts native SpeechSynthesisVoice objects.
    window.SpeechSynthesisUtterance = function (text) { this.text = text; this.rate = 1; this.pitch = 1; };
    const server = {
      mobileStudyPronunciation: () => ({ english: 'compost', meaning: '퇴비', title: '테스트', sheetUrl: '#' }),
      mobileStudySavePreferences: value => { log.saved.push(value); return true; }
    };
    const runner = (ok, fail) => new Proxy({}, { get: (_, name) =>
      name === 'withSuccessHandler' ? f => runner(f, fail) : name === 'withFailureHandler' ? f => runner(ok, f) :
      (...args) => setTimeout(() => { try { ok && ok(server[name](...args)); } catch (e) { fail && fail(e); } }, 10) });
    window.google = { script: { run: runner() } };
  }, voices);
  await page.goto('file://' + file);
  await page.waitForSelector('.speech-control');
  return page;
}
const log = page => page.evaluate(() => window.speechLog);
const options = page => page.$$eval('#speechVoice option', list => list.map(o => o.textContent));

test('shows only male en-US voices, at most 3, natural voices first', async () => {
  const page = await open(VOICES.desktop);
  const list = await options(page);
  assert.strictEqual(list[0], '미국식 남성 음성 자동');
  assert.strictEqual(list.length, 4);
  assert.match(list[1], /Guy|Christopher/);
  assert.ok(list.every(o => !/Aria|Google US English|United Kingdom/.test(o)), list.join(' | '));
  await page.close();
});

test('plays with an American male voice by default', async () => {
  const page = await open(VOICES.desktop);
  await page.click('text=발음 듣기');
  await page.waitForTimeout(200);
  const { spoken } = await log(page);
  assert.strictEqual(spoken.length, 1);
  assert.strictEqual(spoken[0].lang, 'en-US');
  assert.match(spoken[0].voice, /Guy|Christopher/);
  await page.close();
});

test('does not substitute a female voice when no male voice exists', async () => {
  const page = await open(VOICES.iphoneNoMale);
  assert.deepStrictEqual(await options(page), ['사용 가능한 미국식 남성 음성이 없습니다']);
  await page.click('text=발음 듣기');
  await page.waitForTimeout(150);
  assert.strictEqual((await log(page)).spoken.length, 0);
  assert.match(await page.textContent('#speechStatus'), /사용 가능한 미국식 남성 음성이 없습니다/);
  await page.close();
});

test('5x repeat waits 0.5s between rounds and stops on another action', async () => {
  const page = await open(VOICES.desktop);
  await page.click('text=5회 반복');
  await page.waitForTimeout(1500);
  let { spoken } = await log(page);
  assert.ok(spoken.length >= 2, 'at least two rounds played');
  const gap = spoken[1].at - spoken[0].at;
  assert.ok(gap >= 580 && gap < 900, 'round gap ~0.1s speech + 0.5s pause, got ' + gap);
  await page.click('.term');
  const count = (await log(page)).spoken.length;
  await page.waitForTimeout(1500);
  ({ spoken } = await log(page));
  assert.strictEqual(spoken.length, count, 'no more rounds after another action');
  assert.ok(count < 5);
  await page.close();
});

test('pressing another play button cancels the current one', async () => {
  const page = await open(VOICES.desktop);
  await page.click('text=5회 반복');
  await page.waitForTimeout(50);
  await page.click('text=발음 듣기');
  await page.waitForTimeout(1500);
  const { spoken, cancels } = await log(page);
  assert.ok(cancels >= 2);
  assert.strictEqual(spoken.length, 2, 'one from the repeat, then a single play');
  await page.close();
});

test('saves accent, voice and rate and restores them on next open', async () => {
  let page = await open(VOICES.desktop);
  await page.selectOption('#speechRate', '0.75');
  const voice = (await page.$$eval('#speechVoice option', l => l.map(o => o.value)))[2];
  await page.selectOption('#speechVoice', voice);
  await page.waitForTimeout(100);
  const saved = (await log(page)).saved.at(-1);
  assert.strictEqual(saved.audio.rate, '0.75');
  assert.strictEqual(saved.audio.voice, voice);
  assert.strictEqual(saved.audio.accent, 'en-US');
  await page.close();
  page = await open(VOICES.desktop, saved);
  assert.strictEqual(await page.inputValue('#speechRate'), '0.75');
  assert.strictEqual(await page.inputValue('#speechVoice'), voice);
  await page.click('text=발음 듣기');
  await page.waitForTimeout(150);
  const { spoken } = await log(page);
  assert.strictEqual(spoken[0].voice, voice);
  assert.strictEqual(spoken[0].rate, 0.75);
  await page.close();
});

test('a voice saved on another device falls back to this device male voice', async () => {
  const page = await open(VOICES.desktop, { audio: { accent: 'en-US', rate: '1', voice: 'Aaron', voiceName: 'Aaron', voiceLang: 'en-US' } });
  await page.click('text=발음 듣기');
  await page.waitForTimeout(150);
  const { spoken } = await log(page);
  assert.match(spoken[0].voice, /Guy|Christopher/);
  await page.close();
});
