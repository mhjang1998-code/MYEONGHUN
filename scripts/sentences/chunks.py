"""Transcribe each speech chunk separately so the language is detected per chunk (ko prompt vs en answer)."""
import json, sys
import soundfile as sf
from faster_whisper import WhisperModel
audio, rate = sf.read(sys.argv[1], dtype='float32')
chunks = [tuple(map(float, l.split())) for l in open(sys.argv[2]) if l.strip()]
# Join pieces split by short pauses inside one sentence.
merged = []
for a, b in chunks:
    if merged and a - merged[-1][1] < 0.6: merged[-1][1] = b
    else: merged.append([a, b])
model = WhisperModel(sys.argv[3], device='cpu', compute_type='int8')
with open(sys.argv[4], 'w', encoding='utf-8') as out:
    for a, b in merged:
        clip = audio[int(max(0, a - 0.15) * rate):int((b + 0.15) * rate)]
        segs, info = model.transcribe(clip, language=None, beam_size=5, vad_filter=False, without_timestamps=True, condition_on_previous_text=False)
        text = ' '.join(s.text.strip() for s in segs).strip()
        lang = info.language
        if lang not in ('ko', 'en'):  # rare mis-detection: decide by script
            lang = 'ko' if any('가' <= ch <= '힣' for ch in text) else 'en'
        out.write(json.dumps({'start': round(a, 2), 'end': round(b, 2), 'lang': lang, 'p': round(info.language_probability, 2), 'text': text}, ensure_ascii=False) + '\n')
        out.flush()
