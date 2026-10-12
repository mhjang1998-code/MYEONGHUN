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

// GitHub's own 10-minute schedule can stall, so this time trigger starts the audio workflow instead:
// right away when words change, otherwise at most once an hour (to finish voices still being made).
const STUDY_WORKFLOW = 'https://api.github.com/repos/mhjang1998-code/MYEONGHUN/actions/workflows/study-site.yml/dispatches';
const STUDY_BRANCH = 'claude/gracious-albattani-xpf88a';

function studyKickAudio() {
  const props = PropertiesService.getScriptProperties(), token = (props.getProperty('GITHUB_TOKEN') || '').trim();
  if (!token) return 'GITHUB_TOKEN 스크립트 속성이 없습니다.';
  const digest = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(studyAudioTexts()), Utilities.Charset.UTF_8));
  const last = Number(props.getProperty('AUDIO_KICKED_AT') || 0);
  if (digest === props.getProperty('AUDIO_TEXTS_DIGEST') && Date.now() - last < 3600000) return '변경 없음';
  const response = UrlFetchApp.fetch(STUDY_WORKFLOW, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ ref: STUDY_BRANCH })
  });
  if (response.getResponseCode() !== 204) throw new Error('GitHub 실행 요청 실패 (' + response.getResponseCode() + '): ' + response.getContentText().slice(0, 200));
  props.setProperties({ AUDIO_TEXTS_DIGEST: digest, AUDIO_KICKED_AT: String(Date.now()) });
  return 'GitHub 음성 만들기 실행 요청 완료';
}

// Run once from the editor after adding the GITHUB_TOKEN script property.
function setupAudioTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'studyKickAudio').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('studyKickAudio').timeBased().everyMinutes(10).create();
  console.log(studyKickAudio());
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
