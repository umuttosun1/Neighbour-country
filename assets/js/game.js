/* =========================================================
   HUDUT — oyun katmanı
   Durum makinesi: tahmin al, sınıflandır, kazanma/kaybetme kararı,
   ilerlemeyi sakla. Arayüzden bağımsız; test etmesi kolay.
   ========================================================= */
(function (global) {
  'use strict';

  const H = global.Hudut;

  /* =======================================================
     AYAR BLOĞU — oyunun hissini burası belirliyor.
     Bu üç sayı zorluğu tümüyle şekillendiriyor; oynadıkça
     kendine göre değiştirmek isteyeceğin yer burası.
     ======================================================= */
  const TUNING = {
    /** En kısa rotanın üstüne verilen hata payı. */
    extraGuesses: 4,
    /** Bu kadar fazladan adımlık sapma hâlâ "yakın" sayılır. */
    nearThreshold: 2,
    /** İpucu bir tahmine mal olur. */
    hintCost: 1,
  };

  /**
   * Bulmacaya kaç tahmin hakkı verilecek?
   *
   * Şu an düz bir kural: en kısa rota + sabit pay. Yani 3 ülkelik bir
   * bulmacada 7, 6 ülkelikte 10 hakkın var — uzun bulmacalarda oransal
   * olarak daha sıkı. Alternatif bir yaklaşım pay'ı rota uzunluğuyla
   * ölçeklemek olurdu (örn. `mids + 2 + Math.ceil(mids / 2)`), bu da
   * uzun rotalarda nefes aldırır ama kısa olanları kolaylaştırır.
   */
  function guessBudget(optimalMids) {
    return optimalMids + TUNING.extraGuesses;
  }

  /* ---------- kalıcı depolama ---------- */

  const LS = {
    read(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
      catch { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* özel mod */ }
    },
  };

  const STATS_KEY = 'hudut:stats:v1';
  const dailyKey = (dateKey) => `hudut:daily:${dateKey}`;

  const emptyStats = () => ({ played: 0, won: 0, streak: 0, best: 0, last: null });

  function loadStats() { return { ...emptyStats(), ...LS.read(STATS_KEY, {}) }; }

  function recordResult(dateKey, won) {
    const s = loadStats();
    if (s.last === dateKey) return s;            // aynı gün iki kez sayılmasın
    const yesterday = new Date(dateKey + 'T12:00:00');
    yesterday.setDate(yesterday.getDate() - 1);
    const contiguous = s.last === H.localDateKey(yesterday);

    s.played += 1;
    if (won) {
      s.won += 1;
      s.streak = contiguous ? s.streak + 1 : 1;
      s.best = Math.max(s.best, s.streak);
    } else {
      s.streak = 0;
    }
    s.last = dateKey;
    LS.write(STATS_KEY, s);
    return s;
  }

  /* ---------- oyun ---------- */

  function createGame(puzzle) {
    const { start, end } = puzzle;

    const optimal = H.shortestPath(start, end) || [start, end];
    const optimalMids = Math.max(0, optimal.length - 2);
    const routeSet = H.onRouteSet(start, end);
    const D = H.distance(start, end);

    const state = {
      puzzle,
      optimal,
      optimalMids,
      budget: guessBudget(optimalMids),
      guesses: [],            // { code, kind, excess, arrow, hint }
      status: 'playing',      // playing | won | lost
      winPath: null,
    };

    const used = () => state.guesses.length;
    const remaining = () => Math.max(0, state.budget - used());
    const guessedCodes = () => new Set(state.guesses.map((g) => g.code));

    /** Tahminlerin + uçların oluşturduğu izinli ülke kümesi. */
    function allowedSet() {
      const s = guessedCodes();
      s.add(start);
      s.add(end);
      return s;
    }

    /**
     * Tahmini rotaya göre sınıflandır.
     * `excess` = bu ülkeden geçmenin en kısa rotaya kıyasla kaç fazladan
     * sınır geçişine mal olduğu. 0 ise ülke gerçekten optimal bir rotanın
     * üstünde; büyüdükçe sapma artıyor.
     */
    function classify(code) {
      const x = H.distance(start, code);
      const y = H.distance(code, end);
      if (!isFinite(x) || !isFinite(y)) return { kind: 'void', excess: null };
      const excess = x + y - D;
      if (excess === 0) return { kind: 'onroute', excess: 0 };
      if (excess <= TUNING.nearThreshold) return { kind: 'near', excess };
      return { kind: 'far', excess };
    }

    /** Sapan tahminler için: en yakın doğru rota ülkesine bakan ok. */
    function arrowToward(code) {
      const d = H.distances(code);
      let best = null, bestD = Infinity;
      for (const r of routeSet) {
        if (r === code) continue;
        const x = d.get(r);
        if (x !== undefined && x < bestD) { bestD = x; best = r; }
      }
      return best ? H.arrowFor(H.bearing(code, best)) : '';
    }

    function checkEnd() {
      const path = H.connectWithin(allowedSet(), start, end);
      if (path) {
        state.status = 'won';
        state.winPath = path;
      } else if (remaining() === 0) {
        state.status = 'lost';
      }
      return state.status;
    }

    /**
     * Bir tahmin işle.
     * @returns {{ok:boolean, reason?:string, entry?:object}}
     */
    function guess(code, { hint = false } = {}) {
      if (state.status !== 'playing') return { ok: false, reason: 'over' };
      const country = H.get(code);
      if (!country) return { ok: false, reason: 'unknown' };
      if (code === start || code === end) return { ok: false, reason: 'endpoint' };
      if (guessedCodes().has(code)) return { ok: false, reason: 'duplicate' };

      const c = classify(code);
      const entry = {
        code,
        kind: c.kind,
        excess: c.excess,
        arrow: c.kind === 'onroute' || c.kind === 'void' ? '' : arrowToward(code),
        hint,
      };
      state.guesses.push(entry);
      checkEnd();
      return { ok: true, entry };
    }

    /**
     * Oyuncunun mevcut ağına bitişik, doğru rota üstünde bir ülke aç.
     * Zincire hemen eklenebilecek bir tane varsa onu seçer — böylece
     * ipucu her zaman işe yarar bir hamle olur.
     */
    function takeHint() {
      if (state.status !== 'playing' || remaining() < TUNING.hintCost) return null;
      const have = allowedSet();
      const pending = [...routeSet].filter((c) => c !== start && c !== end && !have.has(c));
      if (!pending.length) return null;

      const network = new Set([
        ...H.reachableWithin(have, start),
        ...H.reachableWithin(have, end),
      ]);
      const adjacent = pending.filter((c) => H.get(c).nb.some((n) => network.has(n)));
      const pool = adjacent.length ? adjacent : pending;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const r = guess(pick, { hint: true });
      return r.ok ? pick : null;
    }

    function giveUp() {
      if (state.status !== 'playing') return;
      state.status = 'lost';
    }

    /** Harita için: ülke kodu -> görsel durum. */
    function mapStates() {
      const have = allowedSet();
      const fromStart = H.reachableWithin(have, start);
      const fromEnd = H.reachableWithin(have, end);
      const states = new Map();
      for (const g of state.guesses) {
        if (fromStart.has(g.code)) states.set(g.code, 'warm');
        else if (fromEnd.has(g.code)) states.set(g.code, 'cool');
        else states.set(g.code, 'loose');
      }
      if (state.status === 'lost') {
        for (const c of state.optimal) {
          if (c !== start && c !== end && !states.has(c)) states.set(c, 'cool solved');
        }
      }
      states.set(start, 'start');
      states.set(end, 'end');
      return states;
    }

    /** Harita için: adı gösterilebilecek ülkeler. */
    function mapLabels() {
      const s = new Set([start, end, ...state.guesses.map((g) => g.code)]);
      if (state.status !== 'playing') state.optimal.forEach((c) => s.add(c));
      return s;
    }

    /** Oyuncunun zincirinin uçlardan ne kadar ilerlediği. */
    function progress() {
      const have = allowedSet();
      return {
        fromStart: H.reachableWithin(have, start).size - 1,
        fromEnd: H.reachableWithin(have, end).size - 1,
      };
    }

    const ICONS = { onroute: '🟩', near: '🟨', far: '🟥', void: '⬜' };

    function shareText() {
      const title = puzzle.daily ? `HUDUT #${puzzle.number}` : 'HUDUT · serbest oyun';
      const line = state.guesses.map((g) => (g.hint ? '💡' : ICONS[g.kind])).join('');
      const score = state.status === 'won' ? `${used()}/${state.budget}` : `X/${state.budget}`;
      return [
        `${title}  ${H.flag(start)} → ${H.flag(end)}`,
        `${line}  ${score}`,
        `${H.name(start)} → ${H.name(end)} · en kısa: ${optimalMids} ülke`,
      ].join('\n');
    }

    /* ---- kaydet / geri yükle (yalnız günlük bulmaca) ---- */

    function persist() {
      if (!puzzle.daily) return;
      LS.write(dailyKey(puzzle.dateKey), {
        start, end,
        guesses: state.guesses,
        status: state.status,
      });
    }

    function restore() {
      if (!puzzle.daily) return false;
      const saved = LS.read(dailyKey(puzzle.dateKey), null);
      if (!saved || saved.start !== start || saved.end !== end) return false;
      state.guesses = saved.guesses || [];
      state.status = 'playing';
      checkEnd();
      if (saved.status === 'lost' && state.status === 'playing') state.status = 'lost';
      return true;
    }

    return {
      state, remaining, used, guess, takeHint, giveUp,
      mapStates, mapLabels, progress, shareText, persist, restore,
      routeSet, optimalMids,
    };
  }

  global.HudutGame = { createGame, loadStats, recordResult, TUNING, guessBudget };
})(window);
