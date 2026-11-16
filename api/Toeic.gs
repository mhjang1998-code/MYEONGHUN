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
