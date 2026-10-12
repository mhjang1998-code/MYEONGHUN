// Study data functions, copied from the bound project's mobile app code (doGet moved to Api.gs).
const MOBILE_STUDY_BOOKS = {
  general: { id: '1QREAKTTImJvP90EmE8fLjAxF2Z-Tb8jcqU1cxe-Vs8Q', title: '영어 통합 학습장' },
  paper: { id: '18s1N19P-9zhoKt4kQDp9iHLKXY1SnjR9PXPAVKDwxxM', title: '논문 영어' }
};
const MOBILE_STUDY_SHEETS = { word: '주차별 단어', sentence: '주차별 문장' };
const MOBILE_STUDY_STATES = ['미평가', '모름', '헷갈림', '기억남'];
const MOBILE_STUDY_LOG = '앱 복습 이력';

function mobileStudyPreferences() {
  try { return JSON.parse(PropertiesService.getUserProperties().getProperty('studyPreferencesV1')||'{}'); }
  catch(error) { return {}; }
}

function mobileStudySavePreferences(value) {
  if(!value||typeof value!=='object'||!['general','paper'].includes(value.book))throw new Error('잘못된 학습 설정입니다.');
  const json=JSON.stringify(value);
  if(json.length>7000)throw new Error('학습 설정이 너무 큽니다.');
  PropertiesService.getUserProperties().setProperty('studyPreferencesV1',json);
  return true;
}

function mobileStudyPronunciation(book,type,row) {
  if(!Object.prototype.hasOwnProperty.call(MOBILE_STUDY_SHEETS,type)||!Number.isInteger(row)||row<5)throw new Error('발음 항목을 확인해 주세요.');
  const ss=mobileStudyBook_(book),sheet=ss.getSheetByName(MOBILE_STUDY_SHEETS[type]);
  if(!sheet||row>sheet.getMaxRows())throw new Error('항목을 찾을 수 없습니다.');
  mobileStudyHeaders_(sheet);
  const values=sheet.getRange(row,3,1,2).getDisplayValues()[0];
  if(!String(values[0]).trim())throw new Error('영어 단어 또는 문장이 비어 있습니다.');
  return {book:book,type:type,row:row,english:String(values[0]),meaning:String(values[1]),title:ss.getName(),sheetUrl:ss.getUrl()+'#gid='+sheet.getSheetId()+'&range=C'+row};
}

function mobileStudyLoad(book) {
  book = book || 'general';
  const ss = mobileStudyBook_(book);
  const timeZone = ss.getSpreadsheetTimeZone();
  const cards = [];
  const history = mobileStudyHistory_(ss);
  Object.keys(MOBILE_STUDY_SHEETS).forEach(type => {
    const sheet = ss.getSheetByName(MOBILE_STUDY_SHEETS[type]);
    if (!sheet) throw new Error('학습 시트를 찾을 수 없습니다: ' + MOBILE_STUDY_SHEETS[type]);
    mobileStudyHeaders_(sheet);
    if (sheet.getLastRow() < 5) return;
    mobileStudyRows_(sheet).forEach((row, index) => {
      if (!row[2] && !row[3]) return;
      const date = mobileStudyDate_(row[0], timeZone);
      const tracked = mobileStudyTracked_(history[String(row[8])], row);
      cards.push({ id: String(row[8]), book: book, type: type, row: index + 5, date: date, month: date.slice(0, 7),
        week: String(row[1] || ''), english: String(row[2] || ''), meaning: String(row[3] || ''),
        count: mobileStudyCount_(row[4]), status: String(row[5] || '미평가'),
        reviewed: mobileStudyDate_(row[6], timeZone), memo: String(row[7] || ''),
        unknownStreak: tracked.streak, unknownSince: tracked.since, unknownTotal: tracked.total });
    });
  });
  return { book: book, title: ss.getName(), cards: cards, sheetUrl: ss.getUrl(), today: Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd') };
}

function mobileStudyReview(ref, status, requestId) {
  if (!MOBILE_STUDY_STATES.includes(status)) throw new Error('암기 상태가 올바르지 않습니다.');
  return mobileStudyWrite_(ref, requestId, 'review:' + status, function(sheet, row, ss) {
    const count = mobileStudyCount_(row[4]) + 1;
    if (count > 9999) throw new Error('복습 횟수가 너무 큽니다. 횟수를 확인해 주세요.');
    const day = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    const tracked = mobileStudyTracked_(mobileStudyHistory_(ss)[ref.id], row);
    const streak = status === '모름' ? tracked.streak + 1 : 0;
    const since = status === '모름' ? tracked.since || day : '';
    const total = tracked.total + (status === '모름' ? 1 : 0);
    mobileStudyCountRule_(sheet.getRange(ref.row, 5), count);
    sheet.getRange(ref.row, 5, 1, 3).setValues([[count + '회차', status, new Date(day + 'T00:00:00+09:00')]]);
    sheet.getRange(ref.row, 7).setNumberFormat('yyyy-mm-dd');
    const result = { count: count, status: status, reviewed: day, unknownStreak: streak, unknownSince: since, unknownTotal: total };
    mobileStudyLog_(ss, ref, row, result, requestId, '복습', sheet);
    CacheService.getScriptCache().put('undo:' + requestId, JSON.stringify({ref:ref,after:result,before:{count:mobileStudyCount_(row[4]),status:String(row[5]||'미평가'),reviewed:mobileStudyDate_(row[6],ss.getSpreadsheetTimeZone()),unknownStreak:tracked.streak,unknownSince:tracked.since,unknownTotal:tracked.total}}),21600);
    return result;
  });
}

function mobileStudyUndo(ref, originalId, requestId) {
  return mobileStudyWrite_(ref,requestId,'undo:'+originalId,function(sheet,row,ss){
    const raw=CacheService.getScriptCache().get('undo:'+originalId);
    if(!raw)throw new Error('취소 가능 시간이 지났습니다. 시트에서 확인해 주세요.');
    const saved=JSON.parse(raw);
    if(['id','book','type','row','english','meaning'].some(k=>saved.ref[k]!==ref[k])||mobileStudyCount_(row[4])!==saved.after.count||String(row[5])!==saved.after.status||mobileStudyDate_(row[6],ss.getSpreadsheetTimeZone())!==saved.after.reviewed)throw new Error('이후 수정된 항목이라 취소할 수 없습니다. 새로 확인해 주세요.');
    const result=saved.before;
    sheet.getRange(ref.row,5,1,3).setValues([[result.count+'회차',result.status,result.reviewed?new Date(result.reviewed+'T00:00:00+09:00'):'']]);
    mobileStudyLog_(ss,ref,row,result,requestId,'취소',sheet);
    return result;
  });
}

function mobileStudySetCount(ref, count, expectedCount, requestId) {
  const value = Number(count);
  if (!Number.isInteger(value) || value < 0 || value > 9999) throw new Error('복습 횟수는 0~9999의 정수로 입력해 주세요.');
  return mobileStudyWrite_(ref, requestId, 'count:' + value, function(sheet, row, ss) {
    if (mobileStudyCount_(row[4]) !== Number(expectedCount)) throw new Error('다른 곳에서 횟수가 바뀌었습니다. 새로고침 후 다시 수정해 주세요.');
    const cell = sheet.getRange(ref.row, 5);
    mobileStudyCountRule_(cell, value);
    cell.setValue(value + '회차');
    const tracked = mobileStudyTracked_(mobileStudyHistory_(ss)[ref.id], row);
    const result = { count: value, status: String(row[5] || '미평가'), reviewed: mobileStudyDate_(row[6], ss.getSpreadsheetTimeZone()), unknownStreak: tracked.streak, unknownSince: tracked.since, unknownTotal: tracked.total };
    mobileStudyLog_(ss, ref, row, result, requestId, '횟수 수정', sheet);
    return result;
  });
}

function mobileStudySetMemo(ref, memo, expectedMemo, requestId) {
  if (typeof memo !== 'string' || typeof expectedMemo !== 'string' || memo.length > 20000) throw new Error('메모는 20,000자 이내로 입력해 주세요.');
  return mobileStudyWrite_(ref, requestId, 'memo:' + JSON.stringify([memo, expectedMemo]), function(sheet, row) {
    if (sheet.getRange(4, 8).getValue() !== '메모') throw new Error('메모 열 제목을 확인해 주세요.');
    if (String(row[7] || '') !== expectedMemo) throw new Error('다른 곳에서 메모가 바뀌었습니다. 작성한 내용을 보관한 뒤 새로고침해 주세요.');
    const cell = sheet.getRange(ref.row, 8);
    if (memo) cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(memo).build());
    else cell.setValue('');
    return { memo: memo };
  });
}

function mobileStudyWrite_(ref, requestId, action, update) {
  if (!ref || !Object.prototype.hasOwnProperty.call(MOBILE_STUDY_BOOKS, ref.book) ||
      !Object.prototype.hasOwnProperty.call(MOBILE_STUDY_SHEETS, ref.type) ||
      !Number.isInteger(ref.row) || ref.row < 5 || !ref.id) throw new Error('학습 항목이 올바르지 않습니다. 새로고침해 주세요.');
  if (!/^[a-zA-Z0-9_-]{12,90}$/.test(String(requestId || ''))) throw new Error('저장 요청이 올바르지 않습니다.');
  const key = 'study:' + requestId;
  const signature = JSON.stringify([ref.book, ref.type, ref.row, ref.english, ref.meaning, action]);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    const previous = cache.get(key);
    if (previous) {
      const saved = JSON.parse(previous);
      if (saved.signature !== signature) throw new Error('중복 요청을 확인할 수 없습니다.');
      return saved.result;
    }
    const ss = mobileStudyBook_(ref.book);
    const sheet = ss.getSheetByName(MOBILE_STUDY_SHEETS[ref.type]);
    if (!sheet || ref.row > sheet.getMaxRows()) throw new Error('항목 위치가 바뀌었습니다. 새로고침해 주세요.');
    mobileStudyHeaders_(sheet);
    const row = sheet.getRange(ref.row, 1, 1, 9).getValues()[0];
    // Refuse stale rows after a desktop sort, insertion, or edit.
    if ((!row[2] && !row[3]) || String(row[8]) !== ref.id || String(row[2] || '') !== ref.english || String(row[3] || '') !== ref.meaning) {
      throw new Error('단어 또는 행 위치가 바뀌었습니다. 새로고침 후 다시 눌러 주세요.');
    }
    const result = update(sheet, row, ss);
    SpreadsheetApp.flush();
    cache.put(key, JSON.stringify({ signature: signature, result: result }), 21600);
    return result;
  } finally { lock.releaseLock(); }
}

function mobileStudyBook_(book) {
  if (!Object.prototype.hasOwnProperty.call(MOBILE_STUDY_BOOKS, book)) throw new Error('단어장을 선택해 주세요.');
  return SpreadsheetApp.openById(MOBILE_STUDY_BOOKS[book].id);
}

function mobileStudyHeaders_(sheet) {
  const headers = sheet.getRange(4, 1, 1, 8).getValues()[0];
  if (headers[3] !== '뜻' || headers[4] !== '복습 횟수' || headers[5] !== '암기 상태' || headers[6] !== '최근 복습일') {
    throw new Error('시트의 열 구성이 변경되었습니다. 열 제목을 확인해 주세요.');
  }
}

function mobileStudyCountRule_(cell, count) {
  const rule = cell.getDataValidation();
  if (!rule || rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return;
  const choices = rule.getCriteriaValues()[0].map(String);
  const label = count + '회차';
  if (!choices.includes(label)) cell.setDataValidation(rule.copy().requireValueInList(choices.concat(label), true).build());
}

function mobileStudyDate_(value, timeZone) {
  return value instanceof Date ? Utilities.formatDate(value, timeZone, 'yyyy-MM-dd') : String(value || '');
}

function mobileStudyCount_(value) {
  const count = parseInt(String(value || '0'), 10);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function mobileStudyRows_(sheet) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (sheet.getMaxColumns() < 9) sheet.insertColumnAfter(8);
    const header = sheet.getRange(4, 9);
    if (header.getValue() && header.getValue() !== '학습 ID') throw new Error('학습 ID 열을 확인해 주세요.');
    if (!header.getValue()) { header.setValue('학습 ID'); sheet.hideColumns(9); }
    const rows = sheet.getRange(5, 1, sheet.getLastRow() - 4, 9).getValues();
    const used = new Set(); let changed = false;
    rows.forEach(row => {
      if (!row[2] && !row[3]) return;
      if (!row[8] || used.has(String(row[8]))) { row[8] = Utilities.getUuid(); changed = true; }
      used.add(String(row[8]));
    });
    if (changed) sheet.getRange(5, 9, rows.length, 1).setValues(rows.map(row => [row[8] || '']));
    return rows;
  } finally { lock.releaseLock(); }
}

function mobileStudyHistory_(ss) {
  const sheet = ss.getSheetByName(MOBILE_STUDY_LOG), result = {};
  if (!sheet || sheet.getLastRow() < 2) return result;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues().forEach(row => {
    if (row[1]) result[String(row[1])] = { status: String(row[6]), count: Number(row[7]), streak: Number(row[8]) || 0,
      since: mobileStudyDate_(row[9], ss.getSpreadsheetTimeZone()), total: Number(row[10]) || 0 };
  });
  return result;
}

function mobileStudyTracked_(last, row) {
  const continuous = last && last.status === '모름' && row[5] === '모름' && last.count === mobileStudyCount_(row[4]);
  return { streak: continuous ? last.streak : 0, since: continuous ? last.since : '', total: last ? last.total : 0 };
}

function mobileStudyLog_(ss, ref, before, result, requestId, kind, sourceSheet) {
  let log = ss.getSheetByName(MOBILE_STUDY_LOG);
  try {
    if (!log) {
      log = ss.insertSheet(MOBILE_STUDY_LOG);
      log.appendRow(['복습 시각','학습 ID','구분','단어 및 문장','뜻','이전 상태','결과','복습 후 회차','연속 모름','모름 추적 시작','누적 모름','요청 ID','기록 종류']);
      log.setFrozenRows(1); log.hideSheet();
    }
    const text = value => String(value || '').startsWith('=') ? "'" + value : String(value || '');
    const next = log.getLastRow() + 1;
    if (next > log.getMaxRows()) log.insertRowsAfter(log.getMaxRows(), 1000);
    log.getRange(next,1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    log.getRange(next,10).setNumberFormat('yyyy-mm-dd');
    log.getRange(next,1,1,13).setValues([[new Date(),ref.id,ref.type==='word'?'단어':'문장',text(ref.english),text(ref.meaning),String(before[5]||'미평가'),result.status,result.count,result.unknownStreak,
      result.unknownSince ? new Date(result.unknownSince+'T00:00:00+09:00') : '',result.unknownTotal,requestId,kind]]);
  } catch (error) {
    sourceSheet.getRange(ref.row,5,1,3).setValues([before.slice(4,7)]);
    throw new Error('복습 이력을 저장하지 못해 변경을 되돌렸습니다. 다시 확인해 주세요.');
  }
}
