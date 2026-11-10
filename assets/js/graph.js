/* =========================================================
   HUDUT — graf katmanı
   Saf mantık: ülke dizini, arama, en kısa yol, günlük bulmaca.
   DOM'a hiç dokunmaz.
   ========================================================= */
(function (global) {
  'use strict';

  const DATA = global.COUNTRY_DATA.countries;

  /* ---------- dizin ---------- */

  const byCode = new Map(DATA.map((c) => [c.c, c]));
  const playable = DATA.filter((c) => c.nb.length > 0);
  const endpointPool = DATA.filter((c) => c.end);

  /**
   * Türkçe duyarlı arama normalizasyonu.
   * "TÜRKİYE", "turkiye", "Türkiye" → "turkiye"
   * Sıra önemli: önce tr-TR küçültme (I→ı), sonra harf sadeleştirme.
   */
  function norm(s) {
    return String(s)
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  }

  // Her ülke için aranabilir anahtarlar: Türkçe ad, İngilizce ad, takma adlar.
  const searchKeys = new Map();
  for (const c of DATA) {
    const keys = [c.tr, c.en, ...c.al].map(norm).filter(Boolean);
    searchKeys.set(c.c, [...new Set(keys)]);
  }

  const exactIndex = new Map();
  for (const c of DATA) for (const k of searchKeys.get(c.c)) if (!exactIndex.has(k)) exactIndex.set(k, c);

  function resolve(text) {
    return exactIndex.get(norm(text)) || null;
  }

  /** Öneri listesi: tam eşleşme > baştan eşleşme > içinde geçen. */
  function search(query, limit = 7) {
    const q = norm(query);
    if (!q) return [];
    const hits = [];
    for (const c of DATA) {
      let best = Infinity;
      for (const k of searchKeys.get(c.c)) {
        if (k === q) best = Math.min(best, 0);
        else if (k.startsWith(q)) best = Math.min(best, 1);
        else if (k.includes(q)) best = Math.min(best, 2);
      }
      if (best < Infinity) hits.push({ c, rank: best });
    }
    hits.sort((a, b) => a.rank - b.rank || (a.c.nb.length ? 0 : 1) - (b.c.nb.length ? 0 : 1) || b.c.area - a.c.area);
    return hits.slice(0, limit).map((h) => h.c);
  }

  /* ---------- graf ---------- */

  const distCache = new Map();

  /** from ülkesinden tüm ülkelere sınır-adımı mesafesi. */
  function distances(from) {
    let d = distCache.get(from);
    if (d) return d;
    d = new Map([[from, 0]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i];
      const dv = d.get(v);
      for (const w of byCode.get(v).nb) {
        if (!d.has(w)) {
          d.set(w, dv + 1);
          queue.push(w);
        }
      }
    }
    distCache.set(from, d);
    return d;
  }

  const distance = (a, b) => {
    const d = distances(a).get(b);
    return d === undefined ? Infinity : d;
  };

  /** a → b en kısa yol, uç noktalar dahil. Yoksa null. */
  function shortestPath(a, b) {
    if (a === b) return [a];
    const prev = new Map([[a, null]]);
    const queue = [a];
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i];
      if (v === b) break;
      for (const w of byCode.get(v).nb) {
        if (!prev.has(w)) {
          prev.set(w, v);
          queue.push(w);
        }
      }
    }
    if (!prev.has(b)) return null;
    const path = [];
    for (let v = b; v != null; v = prev.get(v)) path.push(v);
    return path.reverse();
  }

  /**
   * En az bir optimal yol üzerinde bulunan tüm ülkeler.
   * Bir tahminin "doğru rotada" sayılması bu kümeye bakılarak belirlenir —
   * böylece tek bir kanonik yol dayatmak yerine bütün eşdeğer
   * rotaları kabul etmiş oluyoruz.
   */
  function onRouteSet(a, b) {
    const D = distance(a, b);
    if (!isFinite(D)) return new Set();
    const da = distances(a);
    const db = distances(b);
    const set = new Set();
    for (const c of DATA) {
      const x = da.get(c.c);
      const y = db.get(c.c);
      if (x !== undefined && y !== undefined && x + y === D) set.add(c.c);
    }
    return set;
  }

  /** Yalnızca `allowed` kümesindeki ülkeler kullanılarak from'dan gidilebilenler. */
  function reachableWithin(allowed, from) {
    const seen = new Set([from]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      for (const w of byCode.get(queue[i]).nb) {
        if (allowed.has(w) && !seen.has(w)) {
          seen.add(w);
          queue.push(w);
        }
      }
    }
    return seen;
  }

  /** Sadece `allowed` içindeki ülkelerle a→b yolu (varsa). Kazanma kontrolü. */
  function connectWithin(allowed, a, b) {
    const prev = new Map([[a, null]]);
    const queue = [a];
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i];
      if (v === b) break;
      for (const w of byCode.get(v).nb) {
        if (allowed.has(w) && !prev.has(w)) {
          prev.set(w, v);
          queue.push(w);
        }
      }
    }
    if (!prev.has(b)) return null;
    const path = [];
    for (let v = b; v != null; v = prev.get(v)) path.push(v);
    return path.reverse();
  }

  /* ---------- coğrafya ---------- */

  const RAD = Math.PI / 180;

  /** a ülkesinden b ülkesine bakış açısı (derece, 0 = kuzey). */
  function bearing(aCode, bCode) {
    const A = byCode.get(aCode).ll;
    const B = byCode.get(bCode).ll;
    if (!A || !B) return null;
    const f1 = A[0] * RAD;
    const f2 = B[0] * RAD;
    const dl = (B[1] - A[1]) * RAD;
    const y = Math.sin(dl) * Math.cos(f2);
    const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  const COMPASS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const arrowFor = (deg) => (deg == null ? '' : COMPASS[Math.round(deg / 45) % 8]);

  /* ---------- rastgelelik ---------- */

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** mulberry32 — küçük, hızlı, deterministik. */
  function rng(seed) {
    let t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- bulmaca üretimi ---------- */

  const EPOCH = Date.UTC(2026, 0, 1);
  const DAY = 86400000;

  function localDateKey(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function puzzleNumber(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY) + 1;
  }

  /**
   * Haftanın gününe göre zorluk temposu: hafta başı kısa, hafta sonu uzun.
   * Dizinin sırası Pazar…Cumartesi (JS getDay).
   */
  const WEEK_SHAPE = [6, 3, 3, 4, 4, 5, 5];

  /**
   * Verilen tohumla, aradaki ülke sayısı hedefe olabildiğince yakın bir
   * başlangıç–hedef çifti seçer. Hedef uzunlukta çift bulunamazsa
   * kademeli olarak ±1, ±2 esnetilir.
   */
  function makePuzzle(seed, targetMids) {
    const rand = rng(seed);
    const pool = endpointPool;
    const tolerances = [0, 1, 2];

    for (const tol of tolerances) {
      for (let attempt = 0; attempt < 240; attempt++) {
        const a = pool[Math.floor(rand() * pool.length)];
        const da = distances(a.c);
        const candidates = [];
        for (const b of pool) {
          if (b.c === a.c) continue;
          const d = da.get(b.c);
          if (d === undefined) continue;
          if (Math.abs(d - 1 - targetMids) <= tol) candidates.push(b);
        }
        if (candidates.length) {
          const b = candidates[Math.floor(rand() * candidates.length)];
          // Yön tutarlı olsun: batıdaki/kuzeydeki ülke başlangıç olsun.
          const [s, e] = a.ll[1] <= b.ll[1] ? [a, b] : [b, a];
          return { start: s.c, end: e.c, seed };
        }
      }
    }
    return { start: 'PRT', end: 'IND', seed }; // asla ulaşılmaması gereken emniyet
  }

  function dailyPuzzle(dateKey = localDateKey()) {
    const n = puzzleNumber(dateKey);
    const [y, m, d] = dateKey.split('-').map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const p = makePuzzle(hashSeed('hudut-v1-' + dateKey), WEEK_SHAPE[weekday]);
    return { ...p, dateKey, number: n, daily: true };
  }

  function randomPuzzle() {
    const mids = 3 + Math.floor(Math.random() * 4);
    const p = makePuzzle((Math.random() * 4294967296) >>> 0, mids);
    return { ...p, dateKey: null, number: null, daily: false };
  }

  /* ---------- dışa açılan yüzey ---------- */

  global.Hudut = {
    all: DATA,
    byCode,
    playable,
    endpointPool,
    get: (c) => byCode.get(c),
    name: (c) => (byCode.get(c) ? byCode.get(c).tr : c),
    flag: (c) => (byCode.get(c) ? byCode.get(c).flag : ''),
    norm,
    resolve,
    search,
    distances,
    distance,
    shortestPath,
    onRouteSet,
    reachableWithin,
    connectWithin,
    bearing,
    arrowFor,
    localDateKey,
    puzzleNumber,
    dailyPuzzle,
    randomPuzzle,
  };
})(window);
