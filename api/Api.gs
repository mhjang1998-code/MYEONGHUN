// JSON API for the GitHub Pages study app (docs/index.html) and the audio workflow.
// Deploy as a web app: Execute as "Me", Who has access "Anyone". Every call needs the API_KEY script property.

function doGet() {
  return studyJson_({ ok: true, service: 'english-study' });
}

function doPost(e) {
  let request;
  try { request = JSON.parse(e && e.postData && e.postData.contents || '{}'); }
  catch (error) { return studyJson_({ ok: false, error: '잘못된 요청입니다.' }); }
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!key || request.key !== key) return studyJson_({ ok: false, auth: false, error: '연결 키가 맞지 않습니다.' });
  // Built per call: functions in other .gs files are not defined yet when this file loads.
  const api = {
    mobileStudyPreferences, mobileStudySavePreferences, mobileStudyPronunciation, mobileStudyLoad,
    mobileStudyReview, mobileStudyUndo, mobileStudySetCount, mobileStudySetMemo, studyAudioTexts
  };
  const fn = Object.prototype.hasOwnProperty.call(api, request.fn) ? api[request.fn] : null;
  if (!fn) return studyJson_({ ok: false, error: '알 수 없는 요청입니다: ' + request.fn });
  try { return studyJson_({ ok: true, result: fn.apply(null, Array.isArray(request.args) ? request.args : []) }); }
  catch (error) { return studyJson_({ ok: false, error: error && error.message || String(error) }); }
}

// English text of every word and sentence, for generating pronunciation audio.
function studyAudioTexts() {
  const texts = new Set();
  Object.keys(MOBILE_STUDY_BOOKS).forEach(book => {
    const ss = mobileStudyBook_(book);
    Object.keys(MOBILE_STUDY_SHEETS).forEach(type => {
      const sheet = ss.getSheetByName(MOBILE_STUDY_SHEETS[type]);
      if (!sheet || sheet.getLastRow() < 5) return;
      sheet.getRange(5, 3, sheet.getLastRow() - 4, 1).getValues().forEach(row => {
        const text = String(row[0] || '').trim();
        if (text) texts.add(text);
      });
    });
  });
  return Array.from(texts);
}

// Run once from the editor: creates the connection key and prints it to the execution log.
function setupApiKey() {
  const key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  console.log('연결 키: ' + key);
  return key;
}

function studyJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
