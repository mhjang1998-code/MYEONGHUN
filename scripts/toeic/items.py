"""Turn each Day's TOEIC audio into example-sentence items and a clip bundle.

Audio structure per headword: word x2, Korean meaning, example sentence x2 (a second meaning repeats the
last two). Pauses split the audio into entries (>= 0.6 s) and pieces (>= 0.22 s); long English pieces are
sentence readings, and two alike readings in a row make one item. Nothing from the audio or transcript is
printed or stored in the repository: items go to the private sheet, clips to private Drive.
"""
import base64, difflib, json, os, re, struct, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from make_audio import api_url

DEADLINE = time.time() + float(os.environ.get('BUDGET_MINUTES', '310')) * 60
ONLY = [int(d) for d in os.environ.get('DAYS', '').split(',') if d.strip()]
URL, KEY = api_url(), (os.environ.get('STUDY_API_KEY') or '').strip()
HANGUL = re.compile(r'[가-힣]')


def api(fn, *args):
    body = json.dumps({'key': KEY, 'fn': fn, 'args': list(args)}).encode('utf-8')
    request = urllib.request.Request(URL, data=body, headers={'Content-Type': 'text/plain;charset=utf-8'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                data = json.loads(response.read().decode('utf-8', 'replace'))
            break
        except Exception:
            if attempt == 3: raise
            time.sleep(10 * (attempt + 1))
    if not data.get('ok'):
        if '알 수 없는 요청' in str(data.get('error')):
            print('The study API does not have these functions yet; nothing to do.'); sys.exit(0)
        sys.exit('API error: ' + str(data.get('error')))
    return data.get('result')


def pieces(wav):
    log = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', wav, '-af', 'silencedetect=noise=-35dB:d=0.22', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
    total = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], capture_output=True, text=True).stdout)
    out, prev = [], 0.0
    for s, e in zip(starts, ends):
        if s - prev > 0.12: out.append([prev, s])
        prev = e
    if total - prev > 0.12: out.append([prev, total])
    return out


def norm(text): return re.findall(r"[a-z0-9']+", text.lower())


def halve(text):
    """'X X' (both readings in one stretch) -> 'X' (the second reading, usually the cleaner one)."""
    words = text.split()
    if len(words) < 6: return text
    best, cut = 0.0, 0
    for k in range(max(2, len(words) // 2 - 2), min(len(words) - 2, len(words) // 2 + 2) + 1):
        ratio = difflib.SequenceMatcher(None, norm(' '.join(words[:k])), norm(' '.join(words[k:]))).ratio()
        if ratio > best: best, cut = ratio, k
    return ' '.join(words[cut:]) if best >= 0.75 else text


def alike(a, b):
    a, b = norm(a), norm(b)
    return bool(a and b) and difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


def build_items(wav, audio, rate, small, sharp):
    def hear(model, a, b, language=None):
        clip = audio[int(max(0, a - 0.12) * rate):int((b + 0.12) * rate)]
        segs, _ = model.transcribe(clip, language=language, beam_size=5, vad_filter=False, without_timestamps=True, condition_on_previous_text=False)
        return ' '.join(s.text.strip() for s in segs).strip()

    def sentences(a, b):
        """The different sentences read in a..b, each as (text, start, end); a sentence read twice counts once."""
        clip = audio[int(max(0, a - 0.12) * rate):int((b + 0.12) * rate)]
        segs, _ = sharp.transcribe(clip, language='en', beam_size=5, vad_filter=False, word_timestamps=True, condition_on_previous_text=False)
        words = [w for seg in segs for w in (seg.words or [])]
        runs, cur = [], []
        for w in words:
            cur.append(w)
            token = w.word.strip()
            # "Ms." or "Dr." is a title, not the end of a sentence.
            if re.search(r'[.?!]["\']?$', token) and not re.fullmatch(r'(?i)(mr|mrs|ms|dr|st|prof|jr)\.', token): runs.append(cur); cur = []
        if cur: runs.append(cur)
        runs = [(' '.join(w.word.strip() for w in r), a - 0.12 + r[0].start, a - 0.12 + r[-1].end) for r in runs if r]
        out = []
        for text, start, end in runs:
            if out and alike(text, out[-1][0]): out[-1] = (text, out[-1][1], end)
            else: out.append((text, start, end))
        return out

    entries = []
    for a, b in pieces(wav):
        if entries and a - entries[-1][-1][1] < 0.6: entries[-1].append([a, b])
        else: entries.append([[a, b]])
    items, head = [], ''
    for entry in entries:
        parts = []
        for a, b in entry:
            text = hear(small, a, b)
            parts.append({'a': a, 'b': b, 'ko': bool(HANGUL.search(text)), 'text': text})
        # Korean pieces (a meaning) cut the entry into stretches; the sentence readings fill the rest of a stretch
        # from its first long piece on. They are heard as one clip so a pause inside a sentence does not split it.
        stretches, current = [], []
        for p in parts:
            if p['ko']: stretches.append(current); stretches.append([p]); current = []
            else: current.append(p)
        stretches.append(current)
        first_short = next((p for p in parts if not p['ko'] and p['b'] - p['a'] < 1.5), None)
        if first_short and parts.index(first_short) == 0:
            words = first_short['text'].strip(' .!?').split()
            head = ' '.join(words[:len(words) // 2]) if len(words) >= 2 and len(words) % 2 == 0 and norm(' '.join(words[:len(words) // 2])) == norm(' '.join(words[len(words) // 2:])) else ' '.join(words)
        cursor, meaning = entry[0][0], ''
        for stretch in stretches:
            if not stretch: continue
            if stretch[0]['ko']: meaning = (meaning + ' ' + stretch[0]['text']).strip(); continue
            long = next((p for p in stretch if p['b'] - p['a'] >= 1.5), None)
            if not long: continue
            a, b = long['a'], stretch[-1]['b']
            text = halve(hear(sharp, a, b, 'en'))
            if len(norm(text)) < 4 or re.search(r'hackers|vocabulary', text, re.I): continue
            found = [(text, a, b)]
            if len(norm(text)) >= 14:  # maybe two sentences (a second meaning whose Korean was not caught)
                split = [x for x in sentences(a, b) if len(norm(x[0])) >= 4]
                if len(split) >= 2: found = [(t, max(a, s0), min(b, e0)) for t, s0, e0 in split]; found[0] = (found[0][0], a, found[0][2]); found[-1] = (found[-1][0], found[-1][1], b)
            for text, a, b in found:
                if items and not meaning and abs(a - (items[-1]['end'] - 0.35)) < 2.5 and alike(text, items[-1]['en']):
                    items[-1]['end'] = round(b + 0.35, 2)  # the second reading came after a longer pause
                else:
                    items.append({'en': text, 'start': round(max(0, cursor - 0.15), 2), 'enStart': round(a - 0.12, 2), 'end': round(b + 0.35, 2), 'head': head, 'meaning': meaning})
                cursor, meaning = b + 0.35, ''
    return items


def bundle(mp3, items, folder):
    index, body = {}, bytearray()
    for it in items:
        entry = []
        for a, b in ((it['start'], it['enStart']), (it['enStart'], it['end'])):
            clip = os.path.join(folder, 'c.m4a')
            # -vn: the mp3 may carry cover art, which cannot go into an audio-only m4a.
            run = subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{a:.2f}', '-t', f'{max(0.2, b - a):.2f}', '-i', mp3, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '44100',
                                  '-af', 'afade=t=in:d=0.03', '-c:a', 'aac', '-b:a', '56k', '-movflags', '+faststart', clip], capture_output=True, text=True)
            if run.returncode: sys.exit('ffmpeg failed: ' + run.stderr.strip()[-400:])
            data = open(clip, 'rb').read(); entry += [len(body), len(data)]; body += data
        index[str(it['no'])] = entry
    head = json.dumps(index, separators=(',', ':')).encode()
    return b'SCB1' + struct.pack('>I', len(head)) + head + bytes(body)


def main():
    if not URL or not KEY:
        print('Study API not configured; nothing to do.'); return 0
    files, done = api('toeicFiles'), set(api('toeicItemDays'))
    redo = [int(d) for d in os.environ.get('REDO', '').split(',') if d.strip()]
    todo = [f for f in files if (f['day'] in ONLY if ONLY else f['day'] not in done or f['day'] in redo)]
    print(f'{len(files)} files, {len(done)} done, {len(todo)} to do', flush=True)
    if not todo: return 0
    import soundfile as sf
    from faster_whisper import WhisperModel
    small = WhisperModel('small', device='cpu', compute_type='int8')
    sharp = WhisperModel(os.environ.get('SENTENCE_MODEL', 'distil-large-v3'), device='cpu', compute_type='int8')
    for f in todo:
        if time.time() > DEADLINE - 1800:
            print('time budget reached; the rest waits for the next run'); break
        started = time.time()
        with tempfile.TemporaryDirectory() as folder:
            mp3, wav = os.path.join(folder, 'a.mp3'), os.path.join(folder, 'a.wav')
            with open(mp3, 'wb') as out:
                for i in range(f['parts']): out.write(base64.b64decode(api('toeicSourcePart', f['day'], i)))
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', mp3, '-ac', '1', '-ar', '16000', wav], check=True)
            audio, rate = sf.read(wav, dtype='float32')
            items = build_items(wav, audio, rate, small, sharp)
            for n, it in enumerate(items, 1): it['no'] = f['day'] * 1000 + n
            data = bundle(mp3, items, folder)
        size = 2000000; total = (len(data) + size - 1) // size
        for i in range(total): api('toeicSaveBundlePart', f['day'], i, total, base64.b64encode(data[i * size:(i + 1) * size]).decode())
        api('toeicSaveItems', f['day'], [[it['no'], it['en'], it['start'], it['enStart'], it['end'], it['head'], it['meaning']] for it in items])
        print(f"Day {f['day']:02d}: {len(audio) / rate / 60:.1f} min, {len(items)} sentences, bundle {len(data) / 1e6:.1f} MB, {time.time() - started:.0f}s", flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
