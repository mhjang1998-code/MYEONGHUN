"""Group per-chunk transcripts: a Korean chunk starts an item, the English chunks after it are the answer."""
import json, re, sys
chunks = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8')]
first_ko_start, total = float(sys.argv[2]), float(sys.argv[3])
items = []
CJK = re.compile(r'[가-힣\u3040-\u30ff\u4e00-\u9fff]')
for c in chunks:
    # Korean prompts are short; Whisper sometimes labels them Japanese/Chinese. English answers have only Latin text.
    c['lang'] = 'ko' if CJK.search(c['text']) else 'en'
    if c['lang'] == 'ko':
        if items and not items[-1]['en_chunks']:
            items[-1]['ko'] += ' ' + c['text']; items[-1]['ko_end'] = c['end']; continue
        items.append({'ko': c['text'], 'start': c['start'], 'ko_end': c['end'], 'en_chunks': []})
    else:
        if not items:  # English before the first Korean chunk: its Korean prompt sits inside the intro chunk
            items.append({'ko': '', 'start': first_ko_start, 'en_chunks': []})
        items[-1]['en_chunks'].append(c)
def clean(t): return re.sub(r'\s+', ' ', t).strip()
out = []
for i, it in enumerate(items):
    ens = it['en_chunks']
    nxt = items[i + 1]['start'] if i + 1 < len(items) else total
    end = round(min(nxt - 0.05, (ens[-1]['end'] + 0.6) if ens else nxt), 2)
    out.append({'no': i + 1, 'ko': clean(it['ko']), 'en': clean(ens[0]['text']) if ens else '', 'en2': clean(ens[1]['text']) if len(ens) > 1 else '',
                'start': round(max(0, it['start'] - 0.25), 2), 'koEnd': round(it.get('ko_end', it['start']), 2), 'en_spans': [[e['start'], e['end']] for e in ens], 'enStart': round((ens[0]['start'] - 0.2) if ens else it['start'], 2), 'end': end, 'n_en': len(ens)})
json.dump(out, open(sys.argv[4], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(out), 'items')
from collections import Counter
print('english chunk counts:', Counter(o['n_en'] for o in out))
for o in out:
    if o['n_en'] != 2: print(' ', o['no'], o['n_en'], '|', o['ko'], '|', o['en'], '|', o['en2'])
