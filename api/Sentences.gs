// Listening decks for docs/sentences.html, one sheet tab each (columns: 번호, 뜻, 영어, 시작, 영어 시작, 끝,
// 상태, 외운 날, 들은 횟수, 예문, 예문 뜻, 묶음). Timings are seconds in the deck's single audio track.
// 300문장 audio stays private in Drive, split into parts the app downloads once with the connection key.
// A deck with audioUrl instead plays a track published with the app.
const SENTENCE_BOOK = '1QREAKTTImJvP90EmE8fLjAxF2Z-Tb8jcqU1cxe-Vs8Q';
const SENTENCE_DECKS = {
  s300: { sheet: '300문장' }
};
const SENTENCE_STATES = ['못외움', '외움'];

function sentenceDeck_(deck) {
  const config = SENTENCE_DECKS[deck || 's300'];
  if (!config) throw new Error('알 수 없는 단어장입니다: ' + deck);
  return config;
}

function sentenceSheet_(deck) {
  const name = sentenceDeck_(deck).sheet, sheet = SpreadsheetApp.openById(SENTENCE_BOOK).getSheetByName(name);
  if (!sheet) throw new Error("'" + name + "' 시트를 찾을 수 없습니다.");
  return sheet;
}

function sentenceAudioParts_() {
  const folderId = PropertiesService.getScriptProperties().getProperty('SENTENCE_AUDIO_FOLDER');
  if (!folderId) return [];
  const parts = [], files = DriveApp.getFolderById(folderId).getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (!file.isTrashed() && /^part-\d+$/.test(file.getName())) parts.push({ id: file.getId(), name: file.getName(), size: file.getSize() });
  }
  return parts.sort((a, b) => a.name < b.name ? -1 : 1);
}

function sentenceDeckLoad(deck) {
  const config = sentenceDeck_(deck), sheet = sentenceSheet_(deck), timeZone = sheet.getParent().getSpreadsheetTimeZone(), count = sheet.getLastRow() - 1;
  const items = count < 1 ? [] : sheet.getRange(2, 1, count, 12).getValues().filter(row => row[0] !== '').map(row => ({
    no: Number(row[0]), ko: String(row[1]), en: String(row[2]), start: Number(row[3]), enStart: Number(row[4]), end: Number(row[5]),
    state: SENTENCE_STATES.includes(row[6]) ? row[6] : '못외움', memorized: mobileStudyDate_(row[7], timeZone), plays: Number(row[8]) || 0,
    example: String(row[9] || ''), exampleKo: String(row[10] || ''), group: String(row[11] || '')
  }));
  if (config.audioUrl) return { items: items, audio: { url: config.audioUrl, parts: [], version: config.audioUrl } };
  const parts = sentenceAudioParts_();
  return { items: items, audio: { parts: parts.map(p => ({ name: p.name, size: p.size })), version: parts.map(p => p.id + ':' + p.size).join('|') } };
}

// One audio part (about 4 MB) as base64; the app joins the parts in order.
function sentenceAudioPart(name) {
  const part = sentenceAudioParts_().find(p => p.name === name);
  if (!part) throw new Error('음성 파일 조각을 찾을 수 없습니다: ' + name);
  return Utilities.base64Encode(DriveApp.getFileById(part.id).getBlob().getBytes());
}

function sentenceDeckMark(no, state, deck) {
  if (!SENTENCE_STATES.includes(state)) throw new Error('암기 상태가 올바르지 않습니다.');
  const sheet = sentenceSheet_(deck), lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const numbers = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1).getValues().map(r => Number(r[0]));
    const index = numbers.indexOf(Number(no));
    if (index < 0) throw new Error(no + '번 문장을 찾을 수 없습니다.');
    const today = Utilities.formatDate(new Date(), sheet.getParent().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    sheet.getRange(index + 2, 7, 1, 2).setValues([[state, state === '외움' ? today : '']]);
    return { no: Number(no), state: state, memorized: state === '외움' ? today : '' };
  } finally { lock.releaseLock(); }
}

// Adds how many times each sentence was played, e.g. {"12": 3}.
function sentenceDeckPlays(counts, deck) {
  if (!counts || typeof counts !== 'object') return true;
  const sheet = sentenceSheet_(deck), lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const range = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 9), rows = range.getValues();
    const plays = rows.map(row => [(Number(row[8]) || 0) + (Number(counts[String(row[0])]) || 0)]);
    sheet.getRange(2, 9, plays.length, 1).setValues(plays);
    return true;
  } finally { lock.releaseLock(); }
}

// Run once from the editor after uploading the .m4a to the private Drive folder:
// splits it into ~4 MB parts (part-00, part-01, ...) that the app downloads one by one.
function setupSentenceAudio() {
  const folderId = '1YBuwldVa1c8t_P4T0TAe5Oab-cXYh-Xx', folder = DriveApp.getFolderById(folderId);
  PropertiesService.getScriptProperties().setProperty('SENTENCE_AUDIO_FOLDER', folderId);
  const files = folder.getFiles(); let source = null;
  while (files.hasNext()) { const file = files.next(); if (/\.(m4a|mp4|aac)$/i.test(file.getName())) source = file; }
  if (!source) throw new Error('폴더에 .m4a 음성 파일이 없습니다. sentences300.m4a를 먼저 올려 주세요.');
  sentenceAudioParts_().forEach(part => DriveApp.getFileById(part.id).setTrashed(true));
  const bytes = source.getBlob().getBytes(), size = 4000000;
  for (let i = 0, n = 0; i < bytes.length; i += size, n++) {
    folder.createFile(Utilities.newBlob(bytes.slice(i, i + size), 'application/octet-stream', 'part-' + String(n).padStart(2, '0')));
  }
  console.log('음성 조각 ' + sentenceAudioParts_().length + '개 준비 완료 (' + source.getName() + ')');
}
