"""Cut the long recording into one small audio file per sentence part and pack them into a clip bundle.

  python bundle.py full_audio rows.json out.m4a
rows.json: [[no, ko, en, start, enStart, end, ...], ...] (the 300문장 sheet columns).
Bundle = 'SCB1' + uint32 index length + JSON {no: [aOffset, aLength, bOffset, bLength]} + the clips.
Part a is the Korean prompt (start..enStart), part b the English (enStart..end); anything outside the
sentences (opening and closing talk) is left out.
"""
import json, os, struct, subprocess, sys, tempfile
src, rows_path, out = sys.argv[1:4]
rows = json.load(open(rows_path, encoding='utf-8'))
index, body = {}, bytearray()
with tempfile.TemporaryDirectory() as folder:
    for row in rows:
        no, start, en_start, end = row[0], row[3], row[4], row[5]
        entry = []
        for a, b in ((start, en_start), (en_start, end)):
            clip = os.path.join(folder, 'c.m4a')
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{a:.2f}', '-t', f'{b - a:.2f}', '-i', src, '-ac', '1', '-ar', '44100',
                            '-af', 'afade=t=in:d=0.03', '-c:a', 'aac', '-b:a', '56k', '-movflags', '+faststart', clip], check=True)
            data = open(clip, 'rb').read()
            entry += [len(body), len(data)]; body += data
        index[str(no)] = entry
head = json.dumps(index, separators=(',', ':')).encode()
with open(out, 'wb') as f:
    f.write(b'SCB1' + struct.pack('>I', len(head)) + head + body)
print(len(rows), 'sentences,', round(os.path.getsize(out) / 1e6, 1), 'MB')
