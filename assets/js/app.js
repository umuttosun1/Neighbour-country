/* =========================================================
   HUDUT — arayüz
   DOM bağlantıları, otomatik tamamlama, modallar.
   ========================================================= */
(function () {
  'use strict';

  const H = window.Hudut;
  const $ = (id) => document.getElementById(id);

  const ui = {
    mapWrap: $('mapwrap'), map: $('map'), tip: $('map-tip'), toast: $('toast'),
    startFlag: $('start-flag'), startName: $('start-name'),
    endFlag: $('end-flag'), endName: $('end-name'),
    gap: $('gap-label'), meter: $('meter'),
    date: $('puzzle-date'), no: $('puzzle-no'),
    form: $('guess-form'), input: $('guess-input'), sugg: $('suggestions'),
    status: $('status'), list: $('guess-list'),
    btnHint: $('btn-hint'), btnRandom: $('btn-random'), btnGiveUp: $('btn-giveup'),
    btnHelp: $('btn-help'), btnStats: $('btn-stats'),
    modal: $('modal'), modalBody: $('modal-body'), modalClose: $('modal-close'),
  };

  let game = null;
  let mapCtl = null;
  let chainDrawn = false;
  let armed = null;        // haritada tıklanıp onay bekleyen ülke
  let armTimer = 0;
  let sel = -1;            // seçili öneri
  let suggestions = [];

  /* ---------- küçük yardımcılar ---------- */

  let toastTimer = 0;
  function toast(msg, tone = '') {
    ui.toast.textContent = msg;
    ui.toast.className = 'toast ' + tone;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2400);
  }

  /* ---------- bayraklar ---------- */

  /**
   * Windows'ta Segoe UI Emoji bayrak glifi içermez; emoji iki harfe düşer.
   * Bunu tuvale çizip gerçekten renk çıkıyor mu diye bakarak anlıyor,
   * desteklenmiyorsa ISO kodundan düzgün bir rozet basıyoruz.
   */
  const FLAGS_OK = (() => {
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 26;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.font = '22px sans-serif';
      cx.textBaseline = 'top';
      cx.fillText('🇹🇷', 0, 0);
      const d = cx.getImageData(0, 0, 26, 26).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 200 && d[i] > 130 && d[i + 1] < 95 && d[i + 2] < 95) return true;
      }
      return false;
    } catch { return false; }
  })();

  /** Bayrak emojisindeki bölgesel gösterge harflerinden ISO-2 kodu. */
  function iso2(code) {
    const f = Hudut.flag(code);
    const cp = f ? [...f].map((ch) => ch.codePointAt(0)) : [];
    if (cp.length === 2 && cp.every((c) => c >= 0x1f1e6 && c <= 0x1f1ff)) {
      return cp.map((c) => String.fromCharCode(c - 0x1f1e6 + 65)).join('');
    }
    return code.slice(0, 2);
  }

  const flagMarkup = (code) =>
    FLAGS_OK ? Hudut.flag(code) : `<span class="iso">${iso2(code)}</span>`;

  const setFlag = (node, code) => { node.innerHTML = flagMarkup(code); };

  const trDate = (key) =>
    new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(key + 'T12:00:00'));

  /** Sıcak (başlangıç) → soğuk (hedef) arası renk geçişi. */
  function rampColor(t) {
    const a = [232, 163, 61], b = [63, 214, 176];
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgb(${c.join(',')})`;
  }

  /* ---------- panel çizimi ---------- */

  function refresh() {
    const s = game.state;

    setFlag(ui.startFlag, s.puzzle.start);
    ui.startName.textContent = H.name(s.puzzle.start);
    setFlag(ui.endFlag, s.puzzle.end);
    ui.endName.textContent = H.name(s.puzzle.end);
    ui.gap.textContent = `${s.optimalMids} ülke`;

    if (s.puzzle.daily) {
      ui.date.textContent = trDate(s.puzzle.dateKey);
      ui.no.textContent = '#' + s.puzzle.number;
    } else {
      ui.date.textContent = 'serbest oyun';
      ui.no.textContent = '';
    }

    // tahmin ölçeri
    ui.meter.textContent = '';
    const left = game.remaining();
    for (let i = 0; i < s.budget; i++) {
      const bar = document.createElement('i');
      if (i >= left) bar.className = 'spent';
      else if (left <= 2) bar.className = 'low';
      ui.meter.appendChild(bar);
    }

    renderGuesses();
    renderStatus();

    mapCtl.render(game.mapStates(), game.mapLabels());

    if (s.status !== 'playing' && !chainDrawn) {
      chainDrawn = true;
      mapCtl.drawChain(s.status === 'won' ? s.winPath : s.optimal);
    }

    const over = s.status !== 'playing';
    ui.input.disabled = over;
    ui.btnHint.disabled = over || game.remaining() < 1;
    ui.btnGiveUp.disabled = over;
    if (over) closeSuggestions();

    if (s.puzzle.daily) game.persist();
  }

  const KIND_TAG = {
    onroute: 'rotada',
    near: 'yakın',
    far: 'uzak',
    void: 'kara sınırı yok',
  };

  function renderGuesses() {
    ui.list.textContent = '';
    if (!game.state.guesses.length) {
      const empty = document.createElement('li');
      empty.className = 'g-empty';
      empty.textContent = 'Tahminlerin burada birikecek.';
      ui.list.appendChild(empty);
      return;
    }
    for (const g of game.state.guesses) {
      const li = document.createElement('li');
      li.className = 'g-' + g.kind;

      const flag = document.createElement('span');
      flag.className = 'g-flag';
      if (g.hint) flag.textContent = '💡';
      else setFlag(flag, g.code);

      const name = document.createElement('span');
      name.className = 'g-name';
      name.textContent = H.name(g.code);

      const tag = document.createElement('span');
      tag.className = 'g-tag';
      const label = document.createElement('span');
      label.textContent = g.kind === 'onroute' || g.kind === 'void'
        ? KIND_TAG[g.kind]
        : `+${g.excess} adım`;
      tag.appendChild(label);
      if (g.arrow) {
        const arrow = document.createElement('span');
        arrow.className = 'g-arrow';
        arrow.textContent = g.arrow;
        arrow.title = 'Doğru rota bu yönde';
        tag.appendChild(arrow);
      }

      li.append(flag, name, tag);
      ui.list.appendChild(li);
    }
  }

  function renderStatus() {
    const s = game.state;
    if (s.status === 'won') {
      ui.status.innerHTML = `Zincir tamam — <b>${s.winPath.length - 2} ülke</b> ile bağladın.`;
      return;
    }
    if (s.status === 'lost') {
      ui.status.innerHTML = 'Zincir kurulamadı. Doğru rota haritada.';
      return;
    }
    if (!s.guesses.length) {
      ui.status.innerHTML = `Aradaki ülkeleri yaz. En kısa rota <b>${s.optimalMids} ülke</b>.`;
      return;
    }
    const p = game.progress();
    ui.status.innerHTML =
      `Başlangıçtan <b>${p.fromStart}</b>, hedeften <b>${p.fromEnd}</b> ülke bağlı · ` +
      `<b>${game.remaining()}</b> tahmin kaldı.`;
  }

  /* ---------- öneriler ---------- */

  function renderSuggestions() {
    ui.sugg.textContent = '';
    if (!suggestions.length) { ui.sugg.hidden = true; return; }
    suggestions.forEach((c, i) => {
      const li = document.createElement('li');
      li.setAttribute('aria-selected', String(i === sel));
      li.innerHTML =
        `<span class="s-flag"></span><span class="s-name"></span><span class="s-reg"></span>`;
      li.querySelector('.s-flag').innerHTML = flagMarkup(c.c);
      li.querySelector('.s-name').textContent = c.tr;
      li.querySelector('.s-reg').textContent = c.nb.length ? c.reg : 'ada';
      li.addEventListener('mousedown', (e) => { e.preventDefault(); submit(c.c); });
      ui.sugg.appendChild(li);
    });
    ui.sugg.hidden = false;
  }

  function closeSuggestions() {
    suggestions = [];
    sel = -1;
    ui.sugg.hidden = true;
    ui.sugg.textContent = '';
  }

  ui.input.addEventListener('input', () => {
    suggestions = H.search(ui.input.value, 7);
    sel = suggestions.length ? 0 : -1;
    renderSuggestions();
  });

  ui.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSuggestions(); return; }
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % suggestions.length; renderSuggestions(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + suggestions.length) % suggestions.length; renderSuggestions(); }
  });

  ui.input.addEventListener('blur', () => setTimeout(closeSuggestions, 120));

  ui.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const picked = sel >= 0 ? suggestions[sel] : null;
    const exact = H.resolve(ui.input.value);
    const target = picked || exact || H.search(ui.input.value, 1)[0];
    if (!target) { toast('Böyle bir ülke bulamadım.', 'bad'); return; }
    submit(target.c);
  });

  /* ---------- tahmin ---------- */

  const REASON = {
    unknown: 'Böyle bir ülke bulamadım.',
    endpoint: 'O zaten uçlardan biri.',
    duplicate: 'Bunu zaten tahmin ettin.',
    over: 'Oyun bitti.',
  };

  function submit(code) {
    const before = game.state.status;
    const r = game.guess(code);
    ui.input.value = '';
    closeSuggestions();
    disarm();

    if (!r.ok) { toast(REASON[r.reason] || 'Olmadı.', 'bad'); return; }

    if (r.entry.kind === 'void') toast(`${H.name(code)} kara sınırı olmayan bir ülke.`, 'bad');
    else if (r.entry.kind === 'onroute') toast(`${H.name(code)} doğru rotada.`, 'good');

    refresh();
    if (before === 'playing' && game.state.status !== 'playing') {
      setTimeout(showResult, 900);
    }
  }

  /* ---------- haritadan tahmin (iki tıkla onay) ---------- */

  function disarm() {
    clearTimeout(armTimer);
    armed = null;
  }

  function onPick(code) {
    if (game.state.status !== 'playing') return;
    const s = game.state;
    if (code === s.puzzle.start || code === s.puzzle.end) {
      toast(`${H.name(code)} — bu bulmacanın ucu.`);
      return;
    }
    if (game.mapLabels().has(code)) {
      toast(H.name(code));
      return;
    }
    if (armed === code) { submit(code); return; }
    armed = code;
    toast('Tahmin etmek için tekrar tıkla.');
    clearTimeout(armTimer);
    armTimer = setTimeout(disarm, 3000);
  }

  /* ---------- modallar ---------- */

  function openModal(html) {
    ui.modalBody.innerHTML = html;
    ui.modal.hidden = false;
  }
  function closeModal() { ui.modal.hidden = true; }

  ui.modalClose.addEventListener('click', closeModal);
  ui.modal.addEventListener('click', (e) => { if (e.target === ui.modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.modal.hidden) closeModal(); });

  function chainHTML(path) {
    return path.map((c, i) => {
      const t = i / Math.max(1, path.length - 1);
      const col = rampColor(t);
      return `<span class="node" style="border-color:${col};color:${col}">` +
             `${flagMarkup(c)} ${H.name(c)}</span>`;
    }).join('<span class="sep">→</span>');
  }

  function showResult() {
    const s = game.state;
    const won = s.status === 'won';
    const path = won ? s.winPath : s.optimal;
    const stats = s.puzzle.daily
      ? window.HudutGame.recordResult(s.puzzle.dateKey, won)
      : window.HudutGame.loadStats();

    openModal(`
      <div class="result-head">
        <p class="verdict ${won ? 'win' : 'lose'}">${won ? 'Zincir kuruldu' : 'Zincir kopuk'}</p>
        <p class="sub">${won
          ? `${game.used()} tahminde · en kısası ${s.optimalMids} ülke`
          : `en kısa rota ${s.optimalMids} ülkeymiş`}</p>
      </div>
      <h3>${won ? 'Senin rotan' : 'En kısa rota'}</h3>
      <div class="chain">${chainHTML(path)}</div>
      ${s.puzzle.daily ? `
        <h3>İstatistik</h3>
        <div class="stat-grid">
          <div><strong>${stats.played}</strong><span>oynanan</span></div>
          <div><strong>${stats.played ? Math.round((stats.won / stats.played) * 100) : 0}%</strong><span>başarı</span></div>
          <div><strong>${stats.streak}</strong><span>seri</span></div>
          <div><strong>${stats.best}</strong><span>en iyi seri</span></div>
        </div>` : ''}
      <div class="modal-actions">
        <button type="button" class="btn-primary" id="do-share">Sonucu kopyala</button>
        <button type="button" class="btn-secondary" id="do-again">Yeni bulmaca</button>
      </div>
    `);

    $('do-share').addEventListener('click', async (e) => {
      const text = game.shareText();
      try {
        await navigator.clipboard.writeText(text);
        e.target.textContent = 'Kopyalandı ✓';
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        e.target.textContent = 'Kopyalandı ✓';
      }
    });
    $('do-again').addEventListener('click', () => { closeModal(); newGame(H.randomPuzzle()); });
  }

  function showHelp() {
    openModal(`
      <h2>Nasıl oynanır</h2>
      <p class="lede">Her gün iki ülke veriliyor. Aralarını <b>kara sınırlarıyla</b>
      birbirine bağlayan ülkeleri bul.</p>

      <h3>Kural</h3>
      <ul>
        <li>Tahmin ettiğin ülkeler, başlangıçtan hedefe kesintisiz bir <b>sınır zinciri</b>
            oluşturunca kazanırsın.</li>
        <li>Zincirin en kısa olması şart değil — ama tahmin hakkın sınırlı.</li>
        <li>Haritada bir ülkeye iki kez tıklayarak da tahmin edebilirsin.
            Adını bilmesen de olur.</li>
      </ul>

      <h3>Geri bildirim</h3>
      <ul>
        <li><b>rotada</b> — ülke en kısa rotalardan birinin üstünde.</li>
        <li><b>+N adım</b> — bu ülkeden geçmek rotayı N sınır uzatıyor.
            Yanındaki ok doğru rotanın yönünü gösterir.</li>
      </ul>

      <h3>Haritadaki renkler</h3>
      <div class="key"><i class="sw sw-start"></i> başlangıç ülkesi</div><br>
      <div class="key"><i class="sw sw-end"></i> hedef ülke</div><br>
      <div class="key"><i class="sw sw-warm"></i> başlangıca bağlanmış tahmin</div><br>
      <div class="key"><i class="sw sw-cool"></i> hedefe bağlanmış tahmin</div><br>
      <div class="key"><i class="sw sw-loose"></i> henüz hiçbir uca bağlanmamış</div>

      <p style="margin-top:18px">Ceuta ve Melilla gibi haritada görünmeyen sınırlar
      oyun dışıdır: Afrika ile Avrasya arasındaki tek geçit <code>Mısır ↔ İsrail</code>.</p>
    `);
  }

  function showStats() {
    const st = window.HudutGame.loadStats();
    openModal(`
      <h2>İstatistik</h2>
      <div class="stat-grid">
        <div><strong>${st.played}</strong><span>oynanan</span></div>
        <div><strong>${st.played ? Math.round((st.won / st.played) * 100) : 0}%</strong><span>başarı</span></div>
        <div><strong>${st.streak}</strong><span>seri</span></div>
        <div><strong>${st.best}</strong><span>en iyi seri</span></div>
      </div>
      <p style="margin-top:14px">Sadece günlük bulmacalar sayılır. Seri, art arda
      çözülen gün sayısıdır.</p>
    `);
  }

  /* ---------- düğmeler ---------- */

  ui.btnHelp.addEventListener('click', showHelp);
  ui.btnStats.addEventListener('click', showStats);

  ui.btnHint.addEventListener('click', () => {
    const before = game.state.status;
    const code = game.takeHint();
    if (!code) { toast('Verecek ipucu kalmadı.', 'bad'); return; }
    toast(`İpucu: ${H.name(code)}`, 'good');
    refresh();
    if (before === 'playing' && game.state.status !== 'playing') setTimeout(showResult, 900);
  });

  ui.btnRandom.addEventListener('click', () => newGame(H.randomPuzzle()));

  ui.btnGiveUp.addEventListener('click', () => {
    if (game.state.status !== 'playing') return;
    game.giveUp();
    refresh();
    setTimeout(showResult, 500);
  });

  document.querySelectorAll('.zoomers button').forEach((b) => {
    b.addEventListener('click', () => {
      const mode = b.dataset.zoom;
      if (mode === 'in') mapCtl.zoomBy(1.6);
      else if (mode === 'out') mapCtl.zoomBy(1 / 1.6);
      else if (mode === 'world') mapCtl.resetView();
      else mapCtl.focusOn([game.state.puzzle.start, game.state.puzzle.end]);
    });
  });

  /* ---------- oyun döngüsü ---------- */

  function newGame(puzzle) {
    game = window.HudutGame.createGame(puzzle);
    chainDrawn = false;
    disarm();
    ui.input.value = '';
    closeSuggestions();

    if (puzzle.daily) game.restore();

    mapCtl.decorate(puzzle.start, puzzle.end);
    refresh();
    mapCtl.focusOn([puzzle.start, puzzle.end]);

    if (game.state.status !== 'playing') setTimeout(showResult, 700);
    else if (!('ontouchstart' in window)) ui.input.focus();
  }

  function boot() {
    mapCtl = window.HudutMap.createMap(ui.map, ui.mapWrap, { tip: ui.tip, onPick });
    newGame(H.dailyPuzzle());

    if (!localStorage.getItem('hudut:seen')) {
      try { localStorage.setItem('hudut:seen', '1'); } catch { /* yoksay */ }
      setTimeout(showHelp, 500);
    }
  }

  boot();
})();
