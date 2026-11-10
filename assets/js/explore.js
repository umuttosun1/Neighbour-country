/* =========================================================
   HUDUT — keşfet modu
   Ülke arama, bilgi kartı, komşular ve kara yolu rotası.
   Haritayı ve aramayı oyunla paylaşır; oyun kurallarına dokunmaz.
   ========================================================= */
(function (global) {
  'use strict';

  const H = global.Hudut;
  const $ = (id) => document.getElementById(id);

  const ALL = new Set(H.all.map((c) => c.c));
  const nf = new Intl.NumberFormat('tr-TR');
  const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

  const displayNames = (type) => {
    try { return new Intl.DisplayNames(['tr'], { type, fallback: 'none' }); } catch { return null; }
  };
  const DN_LANG = displayNames('language');
  const DN_CUR = displayNames('currency');

  const trUpperFirst = (s) => (s ? s[0].toLocaleUpperCase('tr-TR') + s.slice(1) : s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  let ctx = null;        // { map, flag, toast, playRoute }
  let current = null;    // seçili ülke kodu
  let route = null;      // { to, path } | null
  let active = false;

  /* ---------- biçimlendirme ---------- */

  function formatPopulation(n) {
    if (n == null) return '—';
    if (n >= 1e9) return nf2.format(n / 1e9) + ' milyar';
    if (n >= 1e6) return nf1.format(n / 1e6) + ' milyon';
    return nf.format(n);
  }

  function languages(c) {
    return c.lang.map((code, i) => {
      const tr = DN_LANG && DN_LANG.of(code);
      return trUpperFirst(tr || c.langEn[i] || code);
    });
  }

  function currencies(c) {
    return c.cur.map(([code, symbol, en]) => {
      const tr = DN_CUR && DN_CUR.of(code);
      const name = trUpperFirst(tr || en);
      return symbol && symbol !== code ? `${name} (${symbol})` : `${name} (${code})`;
    });
  }

  /* ---------- otomatik tamamlama (arama + rota hedefi) ---------- */

  function autocomplete(input, list, onChoose, { exclude = () => false } = {}) {
    let items = [];
    let sel = -1;

    const close = () => { items = []; sel = -1; list.hidden = true; list.textContent = ''; };

    function draw() {
      list.textContent = '';
      if (!items.length) { list.hidden = true; return; }
      items.forEach((c, i) => {
        const li = document.createElement('li');
        li.setAttribute('aria-selected', String(i === sel));
        li.innerHTML = `<span class="s-flag">${ctx.flag(c.c)}</span><span class="s-name"></span><span class="s-reg"></span>`;
        li.querySelector('.s-name').textContent = c.tr;
        li.querySelector('.s-reg').textContent = c.reg;
        li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(c.c); });
        list.appendChild(li);
      });
      list.hidden = false;
    }

    function choose(code) {
      input.value = '';
      close();
      onChoose(code);
    }

    input.addEventListener('input', () => {
      items = H.search(input.value, 8).filter((c) => !exclude(c.c)).slice(0, 7);
      sel = items.length ? 0 : -1;
      draw();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (!items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; draw(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const target = (sel >= 0 && items[sel]) || H.resolve(input.value) || H.search(input.value, 1)[0];
      if (!target) { ctx.toast('Böyle bir ülke bulamadım.', 'bad'); return; }
      choose(target.c);
    });
  }

  /* ---------- harita ---------- */

  function paint({ refocus = true } = {}) {
    if (!active) return;
    const states = new Map();
    const labels = new Set();
    ctx.map.decorate(null, null); // önceki süsleri / rota çizgisini temizle

    if (route && route.path) {
      const p = route.path;
      p.forEach((c, i) => {
        states.set(c, i === 0 ? 'start' : i === p.length - 1 ? 'end' : 'onpath');
        labels.add(c);
      });
      ctx.map.render(states, labels, ALL);
      ctx.map.drawChain(p);
      if (refocus) ctx.map.focusOn(p, { maxK: 7 });
      return;
    }

    if (current) {
      const c = H.get(current);
      states.set(current, 'sel');
      labels.add(current);
      for (const n of c.nb) { states.set(n, 'nb'); labels.add(n); }
      ctx.map.render(states, labels, ALL);
      if (refocus) ctx.map.focusOn([current, ...c.nb], { maxK: 6, padding: 1.3 });
      return;
    }

    ctx.map.render(states, labels, ALL);
    if (refocus) ctx.map.resetView();
  }

  /* ---------- panel ---------- */

  function renderWelcome() {
    const top = [...H.all].sort((a, b) => b.nb.length - a.nb.length).slice(0, 5);
    const picks = ['TUR', 'DEU', 'BRA', 'CHN', 'EGY', 'KAZ'].filter((c) => H.get(c));
    $('ex-card').innerHTML = `
      <div class="ex-welcome">
        <h2>Bir ülke seç</h2>
        <p>Ara ya da haritada bir ülkeye tıkla: başkenti, nüfusu, dilleri, para
        birimi ve <b>kara komşuları</b> görünsün. İki ülke arasındaki en kısa kara
        yolunu da bulabilirsin.</p>
        <div class="ex-chips">
          ${picks.map((c) => chip(c)).join('')}
          <button type="button" class="ex-chip ghost-chip" data-random>🎲 Rastgele</button>
        </div>
        <h3>En çok komşusu olanlar</h3>
        <ol class="ex-rank">
          ${top.map((c) => `<li><button type="button" class="ex-link" data-c="${c.c}">${ctx.flag(c.c)} ${esc(c.tr)}</button><span>${c.nb.length}</span></li>`).join('')}
        </ol>
      </div>`;
    $('ex-route').hidden = true;
  }

  /**
   * Gerçek bayrak resmi (flagcdn). Çevrimdışıyken ya da resim yoksa
   * init()'teki hata dinleyicisi onu oyunun emoji/ISO rozetiyle değiştirir.
   */
  const flagImg = (code, w) => {
    const cc = ctx.iso2(code).toLowerCase();
    return `<img class="flag-img" data-c="${code}" alt="" loading="lazy" decoding="async" ` +
      `src="https://flagcdn.com/w${w}/${cc}.png" srcset="https://flagcdn.com/w${w * 2}/${cc}.png 2x">`;
  };

  const chip = (code) =>
    `<button type="button" class="ex-chip" data-c="${code}" title="${esc(H.get(code).en)}">` +
    `<span class="flag">${flagImg(code, 40)}</span>${esc(H.name(code))}</button>`;

  function renderCard() {
    const c = H.get(current);
    const density = c.pop != null && c.area > 0 ? nf.format(Math.round(c.pop / c.area)) + ' kişi/km²' : '—';
    const badges = [
      !c.nb.length ? '<span class="ex-badge">kara sınırı yok</span>' : '',
      c.nb.length && !c.sea ? '<span class="ex-badge">denize kıyısı yok</span>' : '',
    ].join('');
    const fact = (label, value, cls = '') =>
      `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd></div>`;

    $('ex-card').innerHTML = `
      <article class="ex-country">
        <header class="ex-head">
          <span class="ex-flag">${flagImg(c.c, 160)}</span>
          <div class="ex-title">
            <h2>${esc(c.tr)}</h2>
            <p>${c.en !== c.tr ? esc(c.en) + ' · ' : ''}${esc(c.reg)}</p>
            ${badges ? `<div class="ex-badges">${badges}</div>` : ''}
          </div>
        </header>
        <dl class="ex-facts">
          ${fact('Başkent', esc(c.cap.join(', ') || '—'))}
          ${fact('Nüfus', formatPopulation(c.pop) + (c.popY ? ` <small>${c.popY}</small>` : ''))}
          ${fact('Yüzölçümü', c.area ? nf.format(c.area) + ' km²' : '—')}
          ${fact('Yoğunluk', density)}
          ${fact('Diller', esc(languages(c).join(', ') || '—'), 'wide')}
          ${fact('Para birimi', esc(currencies(c).join(', ') || '—'), 'wide')}
          ${fact('Telefon kodu', esc(c.tel || '—'))}
          ${fact('İnternet', esc(c.tld || '—'))}
        </dl>
        <h3 class="ex-subhead">Kara komşuları <span>${c.nb.length}</span></h3>
        ${c.nb.length
          ? `<div class="ex-chips">${[...c.nb].sort((a, b) => H.name(a).localeCompare(H.name(b), 'tr')).map(chip).join('')}</div>`
          : `<p class="ex-note">${esc(c.tr)} ile kara sınırı paylaşan bir ülke yok.</p>`}
      </article>`;

    $('ex-route').hidden = c.nb.length === 0;
    $('ex-from').innerHTML = `${ctx.flag(c.c)} <b>${esc(c.tr)}</b>`;
    renderRoute();
  }

  function renderRoute() {
    const out = $('ex-route-out');
    if (!route) { out.innerHTML = ''; return; }
    if (!route.path) {
      out.innerHTML = `<p class="ex-note">${esc(H.name(current))} ile ${esc(H.name(route.to))} arasında
        kara yolu yok — farklı kıtalarda ya da adada.</p>`;
      return;
    }
    const p = route.path;
    const mids = p.length - 2;
    out.innerHTML = `
      <p class="ex-route-sum"><b>${p.length - 1}</b> sınır geçişi · arada <b>${mids}</b> ülke</p>
      <ol class="ex-chain">
        ${p.map((c, i) => `<li class="${i === 0 ? 'is-start' : i === p.length - 1 ? 'is-end' : ''}">
          <button type="button" class="ex-link" data-c="${c}">${ctx.flag(c)} ${esc(H.name(c))}</button></li>`).join('')}
      </ol>
      <div class="ex-actions">
        ${mids >= 1 ? '<button type="button" class="btn-primary" id="ex-play">Bu rotayı oyna</button>' : ''}
        <button type="button" class="ghost" id="ex-clear">Rotayı kapat</button>
      </div>`;
    const play = $('ex-play');
    if (play) play.addEventListener('click', () => ctx.playRoute(p[0], p[p.length - 1]));
    $('ex-clear').addEventListener('click', () => { route = null; renderRoute(); paint(); });
  }

  /* ---------- seçim ---------- */

  function select(code, { refocus = true } = {}) {
    if (!H.get(code)) return;
    current = code;
    route = null;
    renderCard();
    paint({ refocus });
    try { history.replaceState(null, '', '#kesfet/' + code); } catch { /* file:// */ }
    $('panel-explore').scrollTop = 0;
  }

  function routeTo(code) {
    if (!current || code === current) return;
    route = { to: code, path: H.shortestPath(current, code) };
    renderRoute();
    paint();
    $('ex-route').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- dışa açılan yüzey ---------- */

  function init(context) {
    ctx = context;
    autocomplete($('ex-input'), $('ex-sugg'), (c) => select(c));
    autocomplete($('ex-to'), $('ex-to-sugg'), routeTo, { exclude: (c) => c === current });

    // bayrak resmi yüklenemezse (çevrimdışı) rozet göster; 'error' kabarcıklanmaz, yakalama aşamasında dinle
    $('panel-explore').addEventListener('error', (e) => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.classList.contains('flag-img')) {
        img.outerHTML = ctx.flag(img.dataset.c);
      }
    }, true);

    // kart içindeki bütün ülke bağlantıları / çipleri
    $('panel-explore').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-c], [data-random]');
      if (!btn) return;
      if (btn.hasAttribute('data-random')) {
        const pool = H.endpointPool;
        select(pool[Math.floor(Math.random() * pool.length)].c);
      } else {
        select(btn.dataset.c);
      }
    });
    renderWelcome();
  }

  function activate(code) {
    active = true;
    if (code && H.get(code)) select(code);
    else if (current) {
      renderCard();
      paint();
      try { history.replaceState(null, '', '#kesfet/' + current); } catch { /* file:// */ }
    }
    else { renderWelcome(); paint(); }
    if (!('ontouchstart' in window)) setTimeout(() => $('ex-input').focus(), 0);
  }

  function deactivate() { active = false; }

  /** Haritada tıklanan ülke: rota hedefi seçerken değil, doğrudan seç. */
  function pick(code) { select(code, { refocus: false }); }

  /** "◎" düğmesi */
  function focus() { paint(); }

  global.HudutExplore = { init, activate, deactivate, pick, focus };
})(window);
