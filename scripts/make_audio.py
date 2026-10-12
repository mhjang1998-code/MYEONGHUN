"""Create pronunciation MP3s for every English word/sentence in the study sheets.

Voices come from Kokoro (open-source, runs offline on the GitHub runner), so no outside voice
service can block it. Files are named by a hash of voice + text, so the repository never stores
the word list; the study app (docs/index.html) computes the same hash to find a file.

  python scripts/make_audio.py --check   # only count missing files (no model needed)
  python scripts/make_audio.py           # generate missing files
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

# Must match FILE_VOICES in docs/index.html.
VOICES = {'en-US': ('am_michael', 'en-us'), 'en-GB': ('bm_george', 'en-gb')}
OUT = os.path.join('docs', 'audio')
MANIFEST = os.path.join(OUT, 'manifest.json')
MODEL_DIR = os.environ.get('KOKORO_DIR', 'kokoro-model')
MAX_PER_RUN = int(os.environ.get('MAX_PER_RUN', '1500'))


def normalize(text):
    return re.sub(r'\s+', ' ', text).strip()


def audio_id(voice, text):
    return hashlib.sha1(('kokoro-' + voice + '|' + normalize(text)).encode('utf-8')).hexdigest()[:20]


def fetch_texts():
    url, key = os.environ.get('STUDY_API_URL'), os.environ.get('STUDY_API_KEY')
    if not url or not key:
        return None
    body = json.dumps({'key': key, 'fn': 'studyAudioTexts', 'args': []}).encode('utf-8')
    request = urllib.request.Request(url, data=body, headers={'Content-Type': 'text/plain;charset=utf-8'})
    # Apps Script answers POST with a redirect; urllib follows it as a GET, which is what it expects.
    with urllib.request.urlopen(request, timeout=180) as response:
        data = json.load(response)
    if not data.get('ok'):
        sys.exit('API error: ' + str(data.get('error')))
    return [normalize(t) for t in data['result'] if normalize(t)]


def missing_files(texts):
    existing = {name[:-4] for name in os.listdir(OUT) if name.endswith('.mp3')} if os.path.isdir(OUT) else set()
    todo = {}
    for text in texts:
        for voice, lang in VOICES.values():
            file_id = audio_id(voice, text)
            if file_id not in existing:
                todo.setdefault(file_id, (voice, lang, text))
    return existing, todo


def write_output(**values):
    target = os.environ.get('GITHUB_OUTPUT')
    if target:
        with open(target, 'a') as handle:
            for name, value in values.items():
                handle.write(f'{name}={value}\n')


def main():
    texts = fetch_texts()
    if texts is None:
        print('Study API not configured (STUDY_API_URL / STUDY_API_KEY secrets); nothing to do.')
        write_output(missing='0', changed='false')
        return 0
    existing, todo = missing_files(texts)
    print(f'{len(texts)} texts, {len(existing)} files, {len(todo)} missing')
    if '--check' in sys.argv:
        write_output(missing=str(len(todo)))
        return 0

    import soundfile
    from kokoro_onnx import Kokoro
    kokoro = Kokoro(os.path.join(MODEL_DIR, 'kokoro-v1.0.int8.onnx'), os.path.join(MODEL_DIR, 'voices-v1.0.bin'))
    os.makedirs(OUT, exist_ok=True)
    made = failed = 0
    with tempfile.TemporaryDirectory() as folder:
        for file_id, (voice, lang, text) in list(todo.items())[:MAX_PER_RUN]:
            try:
                samples, rate = kokoro.create(text, voice=voice, speed=1.0, lang=lang)
                wav = os.path.join(folder, file_id + '.wav')
                soundfile.write(wav, samples, rate)
                subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-b:a', '48k',
                                os.path.join(OUT, file_id + '.mp3')], check=True)
                existing.add(file_id)
                made += 1
            except Exception as error:  # one bad text must not stop the rest
                print(f'  failed ({voice}): {error}')
                failed += 1
    print(f'made {made}, failed {failed}, left for next run {max(0, len(todo) - made - failed)}')

    # Keep only files for the current voices and texts (e.g. after a word is edited or deleted).
    wanted = {audio_id(voice, text) for text in texts for voice, _ in VOICES.values()}
    for file_id in existing - wanted:
        os.remove(os.path.join(OUT, file_id + '.mp3'))
    files = {name: sorted(audio_id(voice, t) for t in set(texts) if audio_id(voice, t) in existing)
             for name, (voice, _) in VOICES.items()}
    manifest = {'voices': {name: 'kokoro-' + VOICES[name][0] for name in VOICES}, 'files': files}
    with open(MANIFEST, 'w') as handle:
        json.dump(manifest, handle, separators=(',', ':'))
    write_output(changed='true')
    return 1 if failed and not made else 0


if __name__ == '__main__':
    sys.exit(main())
