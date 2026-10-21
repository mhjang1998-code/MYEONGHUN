"""Merge the numbered slide files (NN-*.html) into one presentation, deck.html.

Each slide file is self-contained so it can be studied alone. This script keeps the
shared <style> once, keeps each slide's own <style>/<section>/<aside>/<script>, scopes
document.querySelectorAll to the slide, and renames the per-slide notes ids.

Usage: python3 build_deck.py
"""
import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED_IDS = ("notesBtn", "notes")


def split_slide(path):
    text = open(path, encoding="utf-8").read()
    styles = re.findall(r"<style>(.*?)</style>", text, flags=re.S)
    shared, own = styles[0], styles[1:]
    body = re.sub(r"<style>.*?</style>", "", text, flags=re.S)
    body = re.sub(r"<(title|meta|link)[^>]*>(?:[^<]*</title>)?\s*", "", body)
    return shared, own, body.strip()


def scope(body, n):
    for i in SHARED_IDS:
        body = body.replace(f'id="{i}"', f'id="{i}-{n}"').replace(f"getElementById('{i}')", f"getElementById('{i}-{n}')")
    body = body.replace("document.querySelectorAll(", "ROOT.querySelectorAll(")
    body = body.replace("<script>\n(() => {", f"<script>\n(() => {{ const ROOT = document.getElementById('slide-{n}');", 1)
    # notes toggle: only the visible slide reacts to N
    body = body.replace("if ((e.key==='n'||e.key==='N')", "if (ROOT.hidden) return; if ((e.key==='n'||e.key==='N')")
    return body


def main():
    files = sorted(f for f in glob.glob(os.path.join(HERE, "[0-9][0-9]-*.html")))
    shared, own_styles, slides = None, [], []
    for f in files:
        n = os.path.basename(f)[:2]
        s, own, body = split_slide(f)
        shared = shared or s
        own_styles += own
        slides.append(f'<div class="deck-slide" id="slide-{n}" hidden>\n{scope(body, n)}\n</div>')

    head = open(files[0], encoding="utf-8").read()
    fonts = re.findall(r"<(?:meta|link)[^>]*>", head)
    out = "\n".join([
        "<title>퇴비화 머신러닝 발표</title>",
        *fonts,
        f"<style>{shared}</style>",
        *(f"<style>{s}</style>" for s in own_styles),
        DECK_CSS,
        *slides,
        DECK_UI.replace("__TOTAL__", str(len(slides))),
    ])
    open(os.path.join(HERE, "deck.html"), "w", encoding="utf-8").write(out)
    print(f"deck.html: {len(slides)} slides")


DECK_CSS = """<style>
body{padding-bottom:64px}
.deck-bar{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;justify-content:center;align-items:center;gap:10px;
  padding:8px max(16px,env(safe-area-inset-right,0px)) calc(8px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));
  background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(6px);border-top:1px solid var(--line)}
.deck-bar button{font:inherit;font-size:.85rem;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:8px;padding:6px 14px;cursor:pointer}
.deck-bar button:hover{border-color:var(--accent)}
.deck-bar button:disabled{opacity:.4;cursor:default}
.deck-count{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);min-width:5ch;text-align:center}
.deck-hint{font-size:.75rem;color:var(--muted)}
@media (max-width:560px){.deck-hint{display:none}}
:fullscreen body,body:fullscreen{overflow:auto}
</style>"""

DECK_UI = """<nav class="deck-bar" aria-label="슬라이드 넘기기">
  <button id="deckPrev" aria-label="이전 슬라이드">← 이전</button>
  <span class="deck-count" id="deckCount">1 / __TOTAL__</span>
  <button id="deckNext" aria-label="다음 슬라이드">다음 →</button>
  <button id="deckFull">전체화면 (F)</button>
  <span class="deck-hint">←/→ 넘기기 · N 발표 메모</span>
</nav>
<script>
(() => {
  const slides = [...document.querySelectorAll('.deck-slide')];
  const prev = document.getElementById('deckPrev'), next = document.getElementById('deckNext'), count = document.getElementById('deckCount');
  let i = 0;
  const fromHash = () => { const m = /^#s(\\d+)$/.exec(location.hash); return m ? Math.min(slides.length, Math.max(1, +m[1])) - 1 : 0; };
  function show(k) {
    i = Math.max(0, Math.min(slides.length - 1, k));
    slides.forEach((s, j) => s.hidden = j !== i);
    count.textContent = (i + 1) + ' / ' + slides.length;
    prev.disabled = i === 0; next.disabled = i === slides.length - 1;
    try { history.replaceState(null, '', '#s' + (i + 1)); } catch (e) {}
    window.scrollTo(0, 0);
  }
  prev.addEventListener('click', () => show(i - 1));
  next.addEventListener('click', () => show(i + 1));
  const full = () => {
    const d = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else d.requestFullscreen?.().catch(() => {});
  };
  document.getElementById('deckFull').addEventListener('click', full);
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(i + 1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); show(i - 1); }
    else if (e.key === 'f' || e.key === 'F') full();
  });
  show(fromHash());
})();
</script>"""

if __name__ == "__main__":
    main()
