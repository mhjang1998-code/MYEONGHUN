// Deck engine: page switching, scaling, drawer (내역 / 출처와 전제 / 발표 메모), overview, keyboard.
// Pages register their interactive code with DECK.register(id, fn); fn(root) runs once at start.
window.DECK = (() => {
  const inits = {};
  const stage = document.getElementById('stage');
  const pages = [...stage.querySelectorAll('.page')];
  const html = document.documentElement;
  let cur = 0, tab = 'detail';
  const titleOf = p => p.dataset.title || p.querySelector('.hl')?.textContent || '';

  const fit = () => stage.style.setProperty('--s', Math.min(innerWidth / 1920, innerHeight / 1080));
  addEventListener('resize', fit); fit();

  pages.forEach((p, i) => {
    const pn = p.querySelector('.foot .pn');
    if (pn) pn.textContent = (i + 1) + ' / ' + pages.length;
  });

  function show(k, animate = true) {
    k = Math.max(0, Math.min(pages.length - 1, k));
    if (!animate) html.classList.add('still');
    pages.forEach((p, i) => p.classList.toggle('on', i === k));
    cur = k;
    try { history.replaceState(null, '', '#' + (k + 1)); } catch (e) {}
    if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!location.hash.includes('static')) html.classList.remove('still');
    }));
    if (html.classList.contains('dopen')) fillDrawer();
    markOverview();
  }
  const go = d => { closeAll(); show(cur + d); };

  // drawer
  const drawer = document.getElementById('drawer'), dbody = document.getElementById('dbody');
  const tabs = [...document.querySelectorAll('#tabs button')];
  function fillDrawer() {
    const p = pages[cur];
    document.getElementById('dtitle').textContent = titleOf(p);
    const t = p.querySelector(`template[data-tab="${tab}"]`);
    dbody.innerHTML = t ? t.innerHTML : '<p>이 장에는 해당 내용이 없습니다.</p>';
    tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  }
  function openDrawer(which) {
    tab = which || tab; html.classList.remove('oopen'); html.classList.add('dopen');
    fillDrawer(); drawer.focus();
  }
  const closeAll = () => html.classList.remove('dopen', 'oopen');
  tabs.forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; fillDrawer(); }));
  document.getElementById('scrim').addEventListener('click', closeAll);
  document.getElementById('dclose').addEventListener('click', closeAll);
  stage.addEventListener('click', e => {
    const b = e.target.closest('[data-drawer]'); if (b) openDrawer(b.dataset.drawer);
    const j = e.target.closest('[data-goto]'); if (j) { closeAll(); show(+j.dataset.goto - 1); }
    const g = e.target.closest('[data-goto-id]'); if (g) { closeAll(); show(pages.findIndex(p => p.id === g.dataset.gotoId)); }
  });

  // overview
  const grid = document.getElementById('ovgrid');
  grid.innerHTML = pages.map((p, i) => `<button data-goto="${i + 1}"><span class="n">${i + 1}</span>
    <span class="s">${p.dataset.sec || ''}</span><span class="t">${titleOf(p)}</span></button>`).join('');
  function markOverview() { [...grid.children].forEach((b, i) => b.classList.toggle('cur', i === cur)); }
  const toggleOverview = () => { html.classList.remove('dopen'); html.classList.toggle('oopen'); markOverview(); };

  document.getElementById('prev').addEventListener('click', () => go(-1));
  document.getElementById('next').addEventListener('click', () => go(1));
  document.getElementById('ovbtn').addEventListener('click', toggleOverview);

  document.addEventListener('keydown', e => {
    const inField = e.target.closest && e.target.closest('input, textarea, select');
    if (e.key === 'Escape') { if (inField) e.target.blur(); closeAll(); return; }
    if (inField) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
    else if (e.key === 'o' || e.key === 'O') toggleOverview();
    else if (e.key === 'n' || e.key === 'N') { html.classList.contains('dopen') && tab === 'notes' ? closeAll() : openDrawer('notes'); }
    else if (/^[1-9]$/.test(e.key)) { closeAll(); show(+e.key - 1); }
  });

  function start() {
    pages.forEach(p => { try { inits[p.id]?.(p); } catch (err) { console.error(p.id, err); } });
    if (location.hash.includes('static') || matchMedia('(prefers-reduced-motion: reduce)').matches) html.classList.add('still');
    const m = /^#(\d+)/.exec(location.hash);
    show(m ? +m[1] - 1 : 0, false);
  }
  addEventListener('hashchange', () => { const m = /^#(\d+)/.exec(location.hash); if (m && +m[1] - 1 !== cur) { closeAll(); show(+m[1] - 1); } });
  return { register: (id, fn) => { inits[id] = fn; }, start, show: k => show(k) };
})();
