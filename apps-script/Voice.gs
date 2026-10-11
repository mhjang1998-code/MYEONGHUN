// Google Cloud Text-to-Speech male voices for StudyPage. Enabled when Script Property TTS_API_KEY is set.
const STUDY_TTS_VOICES = { 'en-US': 'en-US-Neural2-D', 'en-GB': 'en-GB-Neural2-B' };

function mobileStudyTtsEnabled() {
  return !!PropertiesService.getScriptProperties().getProperty('TTS_API_KEY');
}

function mobileStudyTts(text, accent, rate) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('TTS_API_KEY');
  const voice = STUDY_TTS_VOICES[accent];
  const value = String(text || '').trim(), speed = Number(rate) || 1;
  if (!apiKey) throw new Error('TTS_API_KEY가 설정되지 않았습니다.');
  if (!voice || !value || value.length > 1500 || speed < 0.25 || speed > 2) throw new Error('발음 요청이 올바르지 않습니다.');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, [voice, speed, value].join('|'), Utilities.Charset.UTF_8);
  const cacheKey = 'tts:' + Utilities.base64EncodeWebSafe(digest);
  const cache = CacheService.getScriptCache(), hit = cache.get(cacheKey);
  if (hit) return hit;
  const response = UrlFetchApp.fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Goog-Api-Key': apiKey },
    payload: JSON.stringify({ input: { text: value }, voice: { languageCode: accent, name: voice }, audioConfig: { audioEncoding: 'MP3', speakingRate: speed } })
  });
  if (response.getResponseCode() !== 200) {
    console.error(response.getContentText());
    throw new Error('Google 음성 생성 실패 (' + response.getResponseCode() + ')');
  }
  const audio = JSON.parse(response.getContentText()).audioContent;
  if (audio.length < 100000) cache.put(cacheKey, audio, 21600);
  return audio;
}
