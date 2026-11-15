import json, sys
import soundfile as sf
from faster_whisper import WhisperModel
audio, rate = sf.read(sys.argv[1], dtype='float32')
rows = {r[0]: r for r in json.load(open(sys.argv[2], encoding='utf-8'))}
rows[200][5] = 2039.4; rows[201][3] = 2040.6
m = WhisperModel('small', device='cpu', compute_type='int8')
for no in map(int, sys.argv[3].split(',')):
    r = rows[no]
    for label, a, b in (('full', r[3], r[5]), ('english', r[4], r[5])):
        segs, _ = m.transcribe(audio[int(a * rate):int(b * rate)], language=None, without_timestamps=True, condition_on_previous_text=False)
        print(no, label, '|', ' '.join(s.text.strip() for s in segs), '| expected:', r[1], '/', r[2])
