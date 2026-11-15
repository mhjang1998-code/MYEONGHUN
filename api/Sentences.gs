// 300-sentence listening deck for docs/sentences.html.
// Text and timings live in the '300문장' sheet. The audio stays private in Drive, split into parts
// that the app downloads once (with the connection key) and keeps on the device.
const SENTENCE_BOOK = '1QREAKTTImJvP90EmE8fLjAxF2Z-Tb8jcqU1cxe-Vs8Q';
const SENTENCE_SHEET = '300문장';
const SENTENCE_STATES = ['못외움', '외움'];

function sentenceSheet_() {
  const sheet = SpreadsheetApp.openById(SENTENCE_BOOK).getSheetByName(SENTENCE_SHEET);
  if (!sheet) throw new Error("'300문장' 시트를 찾을 수 없습니다.");
  return sheet;
}

function sentenceAudioParts_() {
  const folderId = PropertiesService.getScriptProperties().getProperty('SENTENCE_AUDIO_FOLDER');
  if (!folderId) return [];
  const parts = [], files = DriveApp.getFolderById(folderId).getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (/^part-\d+$/.test(file.getName())) parts.push({ id: file.getId(), name: file.getName(), size: file.getSize() });
  }
  return parts.sort((a, b) => a.name < b.name ? -1 : 1);
}

function sentenceDeckLoad() {
  const sheet = sentenceSheet_(), timeZone = sheet.getParent().getSpreadsheetTimeZone(), count = sheet.getLastRow() - 1;
  const items = count < 1 ? [] : sheet.getRange(2, 1, count, 9).getValues().filter(row => row[0] !== '').map(row => ({
    no: Number(row[0]), ko: String(row[1]), en: String(row[2]), start: Number(row[3]), enStart: Number(row[4]), end: Number(row[5]),
    state: SENTENCE_STATES.includes(row[6]) ? row[6] : '못외움', memorized: mobileStudyDate_(row[7], timeZone), plays: Number(row[8]) || 0
  }));
  const parts = sentenceAudioParts_();
  return { items: items, audio: { parts: parts.map(p => ({ name: p.name, size: p.size })), version: parts.map(p => p.id + ':' + p.size).join('|') } };
}

// One audio part (about 4 MB) as base64; the app joins the parts in order.
function sentenceAudioPart(name) {
  const part = sentenceAudioParts_().find(p => p.name === name);
  if (!part) throw new Error('음성 파일 조각을 찾을 수 없습니다: ' + name);
  return Utilities.base64Encode(DriveApp.getFileById(part.id).getBlob().getBytes());
}

function sentenceDeckMark(no, state) {
  if (!SENTENCE_STATES.includes(state)) throw new Error('암기 상태가 올바르지 않습니다.');
  const sheet = sentenceSheet_(), lock = LockService.getScriptLock();
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
function sentenceDeckPlays(counts) {
  if (!counts || typeof counts !== 'object') return true;
  const sheet = sentenceSheet_(), lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const range = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 9), rows = range.getValues();
    const plays = rows.map(row => [(Number(row[8]) || 0) + (Number(counts[String(row[0])]) || 0)]);
    sheet.getRange(2, 9, plays.length, 1).setValues(plays);
    return true;
  } finally { lock.releaseLock(); }
}

// Run once from the editor: points the API at the Drive folder holding part-00, part-01, ...
function setupSentenceAudio() {
  const folderId = '__SENTENCE_AUDIO_FOLDER__';
  PropertiesService.getScriptProperties().setProperty('SENTENCE_AUDIO_FOLDER', folderId);
  console.log('음성 조각 ' + sentenceAudioParts_().length + '개 연결 완료');
}
