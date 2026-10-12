"""Create Microsoft neural MP3s for every English word/sentence in the study sheets.

Files are named by a hash of voice + text, so the repository never stores the word list.
The study app (docs/index.html) computes the same hash to find a file.
"""
import asyncio
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.request

import edge_tts

VOICE = 'en-US-AndrewNeural'
OUT = os.path.join('docs', 'audio')
MANIFEST = os.path.join(OUT, 'manifest.json')
MAX_PER_RUN = int(os.environ.get('MAX_PER_RUN', '400'))


def normalize(text):
    return re.sub(r'\s+', ' ', text).strip()


def audio_id(text):
    return hashlib.sha1((VOICE + '|' + normalize(text)).encode('utf-8')).hexdigest()[:20]


def fetch_texts(url, key):
    body = json.dumps({'key': key, 'fn': 'studyAudioTexts', 'args': []}).encode('utf-8')
    request = urllib.request.Request(url, data=body, headers={'Content-Type': 'text/plain;charset=utf-8'})
    # Apps Script answers POST with a redirect; urllib follows it as a GET, which is what it expects.
    with urllib.request.urlopen(request, timeout=180) as response:
        data = json.load(response)
    if not data.get('ok'):
        sys.exit('API error: ' + str(data.get('error')))
    return [normalize(t) for t in data['result'] if normalize(t)]


async def synthesize(text, path):
    for attempt in range(3):
        try:
            await edge_tts.Communicate(text, VOICE).save(path + '.part')
            if os.path.getsize(path + '.part') > 0:
                os.replace(path + '.part', path)
                return True
        except Exception as error:  # network or service error: retry, then skip this text
            print(f'  retry {attempt + 1}: {error}')
        await asyncio.sleep(2 * (attempt + 1))
    if os.path.exists(path + '.part'):
        os.remove(path + '.part')
    return False


def write_output(**values):
    target = os.environ.get('GITHUB_OUTPUT')
    if target:
        with open(target, 'a') as handle:
            for name, value in values.items():
                handle.write(f'{name}={value}\n')


async def main():
    url, key = os.environ.get('STUDY_API_URL'), os.environ.get('STUDY_API_KEY')
    if not url or not key:
        # Not connected yet: prove the voice service works on this runner without saving anything.
        with tempfile.TemporaryDirectory() as folder:
            ok = await synthesize('Compost maturity was evaluated.', os.path.join(folder, 'test.mp3'))
        print('Self-test (API not configured):', 'voice service OK' if ok else 'voice service FAILED')
        write_output(changed='false')
        return 0 if ok else 1

    os.makedirs(OUT, exist_ok=True)
    existing = {name[:-4] for name in os.listdir(OUT) if name.endswith('.mp3')}
    texts = fetch_texts(url, key)
    todo = {}
    for text in texts:
        file_id = audio_id(text)
        if file_id not in existing:
            todo.setdefault(file_id, text)
    print(f'{len(texts)} texts, {len(existing)} files, {len(todo)} missing')

    made = failed = 0
    for file_id, text in list(todo.items())[:MAX_PER_RUN]:
        if await synthesize(text, os.path.join(OUT, file_id + '.mp3')):
            existing.add(file_id)
            made += 1
        else:
            failed += 1
    print(f'made {made}, failed {failed}, left for next run {max(0, len(todo) - made - failed)}')

    manifest = {'voice': VOICE, 'files': sorted(existing)}
    previous = None
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as handle:
            previous = json.load(handle)
    changed = previous != manifest
    if changed:
        with open(MANIFEST, 'w') as handle:
            json.dump(manifest, handle, separators=(',', ':'))
    write_output(changed='true' if changed else 'false')
    return 1 if failed and not made else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
