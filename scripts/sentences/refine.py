"""Re-transcribe each Korean prompt with a larger model (language fixed to Korean)."""
import json, sys
import soundfile as sf
from faster_whisper import WhisperModel
audio, rate = sf.read(sys.argv[1], dtype='float32')
items = json.load(open(sys.argv[2], encoding='utf-8'))
model = WhisperModel(sys.argv[3], device='cpu', compute_type='int8')
for it in items:
    if it['no'] == 1 or it['koEnd'] - it['start'] > 20:  # first prompt sits in the intro; last item is the closing talk
        continue
    clip = audio[int(max(0, it['start']) * rate):int((it['koEnd'] + 0.25) * rate)]
    segs, _ = model.transcribe(clip, language='ko', beam_size=5, vad_filter=False, without_timestamps=True, condition_on_previous_text=False)
    it['ko_medium'] = ' '.join(s.text.strip() for s in segs).strip()
    print(it['no'], it['ko'], '=>', it['ko_medium'], flush=True)
json.dump(items, open(sys.argv[4], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
