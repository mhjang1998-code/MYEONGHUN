"""Transcribe the TOEIC example-sentence audio Day by Day and save the raw result to the private sheet.

Audio comes from Drive through the study API and is never written to the repository; no transcript text
is printed (workflow logs are public). Each speech chunk between pauses is transcribed on its own so the
language (Korean / English) is detected per chunk.
"""
import base64, json, os, re, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from make_audio import api_url

DEADLINE = time.time() + float(os.environ.get('BUDGET_MINUTES', '300')) * 60
ONLY = [int(d) for d in os.environ.get('DAYS', '').split(',') if d.strip()]
URL, KEY = api_url(), (os.environ.get('STUDY_API_KEY') or '').strip()


def api(fn, *args):
    body = json.dumps({'key': KEY, 'fn': fn, 'args': list(args)}).encode('utf-8')
    request = urllib.request.Request(URL, data=body, headers={'Content-Type': 'text/plain;charset=utf-8'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                data = json.loads(response.read().decode('utf-8', 'replace'))
            break
        except Exception as error:  # Apps Script hiccup: retry
            if attempt == 3: raise
            time.sleep(10 * (attempt + 1))
    if not data.get('ok'):
        if '알 수 없는 요청' in str(data.get('error')):  # the API project has not been updated yet
            print('The study API does not have the TOEIC functions yet; nothing to do.'); sys.exit(0)
        sys.exit('API error: ' + str(data.get('error')))
    return data.get('result')


def speech_chunks(wav):
    log = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', wav, '-af', 'silencedetect=noise=-35dB:d=0.35', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
    total = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], capture_output=True, text=True).stdout)
    chunks, prev = [], 0.0
    for s, e in zip(starts, ends):
        if s - prev > 0.15: chunks.append([prev, s])
        prev = e
    if total - prev > 0.15: chunks.append([prev, total])
    merged = []
    for a, b in chunks:  # join pieces split by a short pause inside one sentence
        if merged and a - merged[-1][1] < 0.6: merged[-1][1] = b
        else: merged.append([a, b])
    return merged


def main():
    if not URL or not KEY:
        print('Study API not configured; nothing to do.'); return 0
    files = api('toeicFiles')
    done = set(api('toeicRawDays'))
    todo = [f for f in files if (f['day'] in ONLY if ONLY else f['day'] not in done)]
    print(f'{len(files)} files, {len(done)} done, {len(todo)} to do')
    if not todo: return 0
    import soundfile as sf
    from faster_whisper import WhisperModel
    model = WhisperModel(os.environ.get('WHISPER_MODEL', 'small'), device='cpu', compute_type='int8')
    for f in todo:
        if time.time() > DEADLINE - 1500:
            print('time budget reached; the rest waits for the next run'); break
        started = time.time()
        with tempfile.TemporaryDirectory() as folder:
            mp3, wav = os.path.join(folder, 'a.mp3'), os.path.join(folder, 'a.wav')
            with open(mp3, 'wb') as out:
                for i in range(f['parts']): out.write(base64.b64decode(api('toeicSourcePart', f['day'], i)))
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', mp3, '-ac', '1', '-ar', '16000', wav], check=True)
            audio, rate = sf.read(wav, dtype='float32')
            rows = []
            for a, b in speech_chunks(wav):
                clip = audio[int(max(0, a - 0.15) * rate):int((b + 0.15) * rate)]
                segs, info = model.transcribe(clip, language=None, beam_size=5, vad_filter=False, without_timestamps=True, condition_on_previous_text=False)
                text = ' '.join(s.text.strip() for s in segs).strip()
                lang = 'ko' if re.search(r'[가-힣]', text) else 'en'
                rows.append([round(a, 2), round(b, 2), lang, round(info.language_probability, 2), text])
        api('toeicSaveRaw', f['day'], rows)
        print(f"Day {f['day']:02d}: {len(audio) / rate / 60:.1f} min, {len(rows)} chunks, {time.time() - started:.0f}s", flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
