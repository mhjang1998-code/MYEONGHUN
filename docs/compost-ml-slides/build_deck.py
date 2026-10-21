"""Build deck.html: one self-contained presentation from slides/NN-*.html.

Each slide fragment holds its own <style>, one <section class="page">, and a
<script> that calls DECK.register(). The build wraps them in the shared engine
(engine/engine.css, engine/engine.js) and embeds a Pretendard subset that holds
only the glyphs the deck uses, so the file works offline.

Usage: python3 build_deck.py        (needs: pip install fonttools brotli)
"""
import base64
import glob
import io
import os
import re

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = [("Regular", 400), ("Medium", 500), ("Bold", 700)]


def read(*parts):
    return open(os.path.join(HERE, *parts), encoding="utf-8").read()


def split_fragment(text):
    styles = "\n".join(re.findall(r"<style>(.*?)</style>", text, flags=re.S))
    scripts = "\n".join(re.findall(r"<script>(.*?)</script>", text, flags=re.S))
    markup = re.sub(r"<(style|script)>.*?</\1>", "", text, flags=re.S).strip()
    return styles, markup, scripts


def font_faces(text):
    chars = set(text) | set(chr(c) for c in range(0x20, 0x7F)) | set("−±×÷·…“”‘’℃℉²³₀₁₂₃₄⁺⁻→←↔›‹")
    unicodes = sorted(ord(c) for c in chars if ord(c) > 0x1F)
    faces = []
    for name, weight in FONTS:
        font = TTFont(os.path.join(HERE, "assets", "fonts", f"Pretendard-{name}.woff2"))
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=unicodes)
        sub.subset(font)
        buf = io.BytesIO()
        font.flavor = "woff2"
        font.save(buf)
        b64 = base64.b64encode(buf.getvalue()).decode()
        faces.append(f'@font-face{{font-family:"Pretendard";font-weight:{weight};font-display:block;'
                     f'src:url(data:font/woff2;base64,{b64}) format("woff2")}}')
    return "\n".join(faces)


CHROME = """
<nav id="nav" aria-label="쪽 이동">
  <button class="btn" id="prev">‹ 이전</button><button class="btn" id="ovbtn">쪽 목록</button><button class="btn" id="next">다음 ›</button>
</nav>
<div id="scrim"></div>
<aside id="drawer" tabindex="-1" aria-label="상세 내용">
  <header>
    <div class="dt" id="dtitle"></div>
    <button class="btn x" id="dclose" aria-label="닫기">닫기 ✕</button>
    <div id="tabs" role="tablist">
      <button role="tab" data-tab="detail">내역</button><button role="tab" data-tab="source">출처와 전제</button><button role="tab" data-tab="notes">발표 메모</button>
    </div>
  </header>
  <div id="dbody"></div>
</aside>
<div id="ov"><div class="ovh">쪽 목록 · 클릭하면 이동 (O / Esc 닫기)</div><div id="ovgrid"></div></div>
"""


def main():
    files = sorted(glob.glob(os.path.join(HERE, "slides", "[0-9][0-9]-*.html")))
    styles, markup, scripts = [], [], []
    for f in files:
        s, m, j = split_fragment(open(f, encoding="utf-8").read())
        styles.append(s), markup.append(m), scripts.append(j)

    body_text = "\n".join(markup + scripts)
    out = "\n".join([
        "<title>퇴비화 머신러닝 발표</title>",
        '<meta name="description" content="Shi 2025 · Wang 2024 퇴비화 머신러닝 논문 용어 발표">',
        f"<style>\n{font_faces(body_text + CHROME)}\n{read('engine', 'engine.css')}\n" + "\n".join(styles) + "\n</style>",
        '<div id="stage">',
        *markup,
        CHROME,
        "</div>",
        f"<script>\n{read('engine', 'engine.js')}\n" + "\n".join(scripts) + "\nDECK.start();\n</script>",
    ])
    open(os.path.join(HERE, "deck.html"), "w", encoding="utf-8").write(out)
    print(f"deck.html: {len(files)} pages, {len(out) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
