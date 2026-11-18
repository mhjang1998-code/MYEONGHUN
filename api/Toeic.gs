// TOEIC example-sentence audio (Drive folder '해커스 기본 MP3', 단어와예문암기_DayNN.mp3).
// The audio stays in Drive; the GitHub runner fetches it in parts with the connection key to transcribe it.
const TOEIC_SOURCE_FOLDER = '1ihTSs3KmgwSi0NF_CxkAANDVDIWOusu5';
const TOEIC_RAW_SHEET = '토익 원본';
const TOEIC_PART_SIZE = 3000000;

function toeicFiles() {
  const files = DriveApp.getFolderById(TOEIC_SOURCE_FOLDER).getFiles(), list = [];
  while (files.hasNext()) {
    const file = files.next(), match = /Day\s*(\d+)\.mp3$/i.exec(file.getName());
    if (match && !file.isTrashed()) list.push({ day: Number(match[1]), id: file.getId(), size: file.getSize(), parts: Math.ceil(file.getSize() / TOEIC_PART_SIZE) });
  }
  return list.sort((a, b) => a.day - b.day);
}

// One part (about 3 MB) of a Day's original mp3, as base64.
function toeicSourcePart(day, index) {
  const file = toeicFiles().find(f => f.day === Number(day));
  if (!file) throw new Error('Day ' + day + ' 음성 파일을 찾을 수 없습니다.');
  const bytes = DriveApp.getFileById(file.id).getBlob().getBytes(), start = Number(index) * TOEIC_PART_SIZE;
  return Utilities.base64Encode(bytes.slice(start, start + TOEIC_PART_SIZE));
}

function toeicRawSheet_() {
  const book = SpreadsheetApp.openById(SENTENCE_BOOK);
  let sheet = book.getSheetByName(TOEIC_RAW_SHEET);
  if (!sheet) {
    sheet = book.insertSheet(TOEIC_RAW_SHEET);
    sheet.getRange(1, 1, 1, 6).setValues([['Day', '시작(초)', '끝(초)', '언어', '확률', '받아쓰기']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Days whose raw transcript is already saved.
function toeicRawDays() {
  const sheet = toeicRawSheet_();
  if (sheet.getLastRow() < 2) return [];
  return Array.from(new Set(sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(r => Number(r[0])).filter(Boolean))).sort((a, b) => a - b);
}

// Replaces one Day's raw transcript: rows of [start, end, lang, probability, text].
function toeicSaveRaw(day, rows) {
  if (!Array.isArray(rows) || rows.length > 3000) throw new Error('받아쓰기 결과가 올바르지 않습니다.');
  const sheet = toeicRawSheet_(), lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const last = sheet.getLastRow();
    if (last > 1) {
      const days = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (let i = days.length - 1; i >= 0; i--) if (Number(days[i][0]) === Number(day)) sheet.deleteRow(i + 2);
    }
    const text = value => String(value || '').startsWith('=') ? "'" + value : String(value || '');
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows.map(r => [Number(day), Number(r[0]), Number(r[1]), String(r[2]), Number(r[3]), text(r[4])]));
    return rows.length;
  } finally { lock.releaseLock(); }
}

// ---- Example-sentence deck ('토익 예문' tab) and its per-Day clip bundles ----
const TOEIC_ITEM_SHEET = '토익 예문';
const toeicGroup_ = day => 'Day ' + String(day).padStart(2, '0');

function toeicItemSheet_() {
  const book = SpreadsheetApp.openById(SENTENCE_BOOK);
  let sheet = book.getSheetByName(TOEIC_ITEM_SHEET);
  if (!sheet) {
    sheet = book.insertSheet(TOEIC_ITEM_SHEET);
    sheet.getRange(1, 1, 1, 12).setValues([['번호', '한국어', '영어', '시작(초)', '영어 시작(초)', '끝(초)', '상태', '외운 날', '들은 횟수', '단어', '단어 뜻', '묶음']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function toeicItemDays() {
  const sheet = toeicItemSheet_();
  if (sheet.getLastRow() < 2) return [];
  return Array.from(new Set(sheet.getRange(2, 12, sheet.getLastRow() - 1, 1).getValues().map(r => parseInt(String(r[0]).replace(/\D/g, ''), 10)).filter(Boolean))).sort((a, b) => a - b);
}

// Replaces one Day's sentences: rows of [no, english, start, enStart, end, headword, spokenMeaning].
// Translation, state and play counts already in the sheet are kept for sentences whose number stays.
function toeicSaveItems(day, rows) {
  if (!Array.isArray(rows) || rows.length > 200) throw new Error('예문 목록이 올바르지 않습니다.');
  const sheet = toeicItemSheet_(), group = toeicGroup_(day), lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const kept = {}, last = sheet.getLastRow();
    if (last > 1) {
      const all = sheet.getRange(2, 1, last - 1, 12).getValues();
      for (let i = all.length - 1; i >= 0; i--) if (all[i][11] === group) { kept[all[i][0]] = all[i]; sheet.deleteRow(i + 2); }
    }
    const text = value => String(value || '').startsWith('=') ? "'" + value : String(value || '');
    const values = rows.map(r => { const old = kept[r[0]] || [];
      return [Number(r[0]), old[1] || '', text(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), old[6] || '못외움', old[7] || '', old[8] || 0, text(r[5]), text(r[6]), group]; });
    if (values.length) sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 12).setValues(values);
    return values.length;
  } finally { lock.releaseLock(); }
}

function toeicClipFolder_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('TOEIC_CLIP_FOLDER');
  if (!id) { id = DriveApp.createFolder('토익 예문 음성 조각 (비공개)').getId(); props.setProperty('TOEIC_CLIP_FOLDER', id); }
  return DriveApp.getFolderById(id);
}

// One part of a Day's clip bundle; the Day becomes available to the app when its last part arrives.
function toeicSaveBundlePart(day, index, total, base64) {
  const folder = toeicClipFolder_(), prefix = 'toeic-' + String(day).padStart(2, '0') + '-part-', props = PropertiesService.getScriptProperties();
  if (Number(index) === 0) {
    props.deleteProperty('TOEIC_BUNDLE_' + day);
    const files = folder.getFiles();
    while (files.hasNext()) { const file = files.next(); if (file.getName().indexOf(prefix) === 0) file.setTrashed(true); }
  }
  folder.createFile(Utilities.newBlob(Utilities.base64Decode(base64), 'application/octet-stream', prefix + String(index).padStart(2, '0')));
  if (Number(index) === Number(total) - 1) props.setProperty('TOEIC_BUNDLE_' + day, total + ':' + Date.now());
  return true;
}

// {'Day 01': {parts: [{name}], version}} for every Day whose bundle is complete.
function toeicBundleGroups_() {
  const all = PropertiesService.getScriptProperties().getProperties(), groups = {};
  Object.keys(all).forEach(key => {
    const match = /^TOEIC_BUNDLE_(\d+)$/.exec(key); if (!match) return;
    const total = Number(all[key].split(':')[0]), day = String(match[1]).padStart(2, '0');
    groups[toeicGroup_(match[1])] = { version: all[key], parts: Array.from({ length: total }, (_, i) => ({ name: 'toeic-' + day + '-part-' + String(i).padStart(2, '0') })) };
  });
  return groups;
}

function toeicBundlePart_(name) {
  const files = toeicClipFolder_().getFilesByName(name);
  while (files.hasNext()) { const file = files.next(); if (!file.isTrashed()) return Utilities.base64Encode(file.getBlob().getBytes()); }
  throw new Error('음성 조각을 찾을 수 없습니다: ' + name);
}
