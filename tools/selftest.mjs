/* HUDUT — tarayıcısız mantık testi.  node tools/selftest.mjs */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const store = new Map();
const sandbox = {
  console,
  Intl,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['assets/js/data/countries.js', 'assets/js/graph.js', 'assets/js/game.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const { Hudut: H, HudutGame: G } = sandbox;

let fails = 0;
const check = (label, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  ✗ ${label} ${extra}`); }
  return cond;
};

/* ---- 1. arama ---- */
console.log('\n[1] Arama / normalizasyon');
const searchCases = [
  ['türkiye', 'TUR'], ['TURKIYE', 'TUR'], ['turkıye', 'TUR'],
  ['abd', 'USA'], ['Amerika', 'USA'], ['ingiltere', 'GBR'],
  ['çekya', 'CZE'], ['cekya', 'CZE'], ['Çek Cumhuriyeti', 'CZE'],
  ['ozbekistan', 'UZB'], ['Özbekistan', 'UZB'], ['ürdün', 'JOR'],
  ['bae', 'ARE'], ['germany', 'DEU'], ['kosova', 'UNK'],
  ['dr kongo', 'COD'], ['guney kore', 'KOR'], ['sili', 'CHL'],
];
for (const [q, expect] of searchCases) {
  const hit = H.resolve(q) || H.search(q, 1)[0];
  check(`"${q}" → ${expect}`, hit && hit.c === expect, `(bulunan: ${hit ? hit.c : 'yok'})`);
}
console.log(`  ${searchCases.length} arama denendi.`);

/* ---- 2. isimler ---- */
console.log('\n[2] Türkçe adlar');
const badCase = H.all.filter((c) => /^[a-zçğıöşü]/.test(c.tr));
check('küçük harfle başlayan ad yok', badCase.length === 0, badCase.map((c) => c.tr).join(','));
for (const [code, expect] of [['CHN', 'Çin'], ['CHL', 'Şili'], ['JOR', 'Ürdün'], ['TCD', 'Çad'], ['UZB', 'Özbekistan'], ['CZE', 'Çekya']]) {
  check(`${code} = ${expect}`, H.name(code) === expect, `(→ ${H.name(code)})`);
}

/* ---- 3. sınır grafiği ---- */
console.log('\n[3] Sınır grafiği');
const yes = [['TUR', 'GRC'], ['TUR', 'GEO'], ['FRA', 'ESP'], ['EGY', 'ISR'], ['PAN', 'COL'], ['MYS', 'THA'], ['IDN', 'PNG'], ['RUS', 'PRK']];
const no = [['ESP', 'MAR'], ['TUR', 'RUS'], ['JPN', 'KOR'], ['USA', 'BRA'], ['FRA', 'BRA'], ['GBR', 'FRA']];
for (const [a, b] of yes) check(`${a}–${b} sınırı var`, H.get(a).nb.includes(b));
for (const [a, b] of no) check(`${a}–${b} sınırı yok`, !H.get(a).nb.includes(b));
const asym = H.all.filter((c) => c.nb.some((n) => !H.get(n).nb.includes(c.c)));
check('graf simetrik', asym.length === 0, asym.map((c) => c.c).join(','));

console.log('  örnek rota TUR→DEU:', (H.shortestPath('TUR', 'DEU') || []).map(H.name).join(' → '));
console.log('  örnek rota PRT→CHN:', (H.shortestPath('PRT', 'CHN') || []).map(H.name).join(' → '));
check('Afrika–Avrupa yalnız Sina üzerinden', H.shortestPath('ITA', 'MAR').includes('EGY'));

/* ---- 4. günlük bulmacalar ---- */
console.log('\n[4] 21 günlük bulmaca');
const seen = new Set();
for (let i = 0; i < 21; i++) {
  const d = new Date(2026, 7, 1 + i);
  const key = H.localDateKey(d);
  const p = H.dailyPuzzle(key);
  const route = H.shortestPath(p.start, p.end);
  const mids = route.length - 2;
  const ok = check(`${key} çözülebilir`, route && mids >= 1 && mids <= 8, `(${mids})`);
  check(`${key} uçlar farklı`, p.start !== p.end);
  check(`${key} tekrar yok`, !seen.has(p.start + p.end));
  seen.add(p.start + p.end);
  // aynı gün iki kez çağırınca aynı sonuç
  check(`${key} deterministik`, H.dailyPuzzle(key).start === p.start && H.dailyPuzzle(key).end === p.end);
  if (ok && i < 8) {
    console.log(`  #${p.number} ${key}  ${H.name(p.start)} → ${H.name(p.end)}  (${mids} ülke)`);
    console.log(`      ${route.map(H.name).join(' · ')}`);
  }
}

/* ---- 5. tam bir oyun ---- */
console.log('\n[5] Oyun akışı');
{
  const p = H.dailyPuzzle('2026-08-01');
  const g = G.createGame(p);
  const route = H.shortestPath(p.start, p.end);
  const mids = route.slice(1, -1);

  check('bütçe = en kısa + 4', g.state.budget === mids.length + 4);
  check('başta oynanıyor', g.state.status === 'playing');

  // yanlış tahmin
  const wrong = H.all.find((c) => c.nb.length && !g.routeSet.has(c.c) && c.c !== p.start && c.c !== p.end);
  const r1 = g.guess(wrong.c);
  check('yanlış tahmin kabul edildi', r1.ok);
  check('yanlış tahmin rotada değil', r1.entry.kind !== 'onroute', r1.entry.kind);
  check('yanlış tahminde yön oku var', !!r1.entry.arrow || r1.entry.kind === 'void');

  check('tekrar reddedildi', !g.guess(wrong.c).ok);
  check('uç nokta reddedildi', !g.guess(p.start).ok);

  // doğru rotayı tamamla
  for (const c of mids) {
    const r = g.guess(c);
    check(`${H.name(c)} rotada`, r.ok && r.entry.kind === 'onroute', r.ok ? r.entry.kind : 'red');
  }
  check('kazanıldı', g.state.status === 'won', g.state.status);
  check('kazanan yol uçlardan geçiyor',
    g.state.winPath[0] === p.start && g.state.winPath[g.state.winPath.length - 1] === p.end);
  console.log('  paylaşım metni:\n' + g.shareText().split('\n').map((l) => '    ' + l).join('\n'));
}

/* ---- 6. kaybetme + ipucu ---- */
console.log('\n[6] Bütçe tükenmesi ve ipucu');
{
  const p = H.dailyPuzzle('2026-08-05');
  const g = G.createGame(p);
  const junk = H.all.filter((c) => c.nb.length && !g.routeSet.has(c.c) && c.c !== p.start && c.c !== p.end);
  let i = 0;
  while (g.state.status === 'playing' && i < junk.length) g.guess(junk[i++].c);
  check('bütçe bitince kaybedildi', g.state.status === 'lost', g.state.status);
  check('bütçe aşılmadı', g.used() === g.state.budget, `${g.used()}/${g.state.budget}`);

  const g2 = G.createGame(p);
  const hinted = g2.takeHint();
  check('ipucu bir ülke açtı', !!hinted);
  check('ipucu rotada', g2.routeSet.has(hinted));
  check('ipucu tahmin listesine yazıldı', g2.state.guesses.some((x) => x.hint && x.code === hinted));

  // sadece ipuçlarıyla kazanılabilmeli
  let guard = 0;
  while (g2.state.status === 'playing' && guard++ < 30) if (!g2.takeHint()) break;
  check('yalnız ipuçlarıyla kazanılabilir', g2.state.status === 'won', g2.state.status);
}

/* ---- 7. kaydet/geri yükle ---- */
console.log('\n[7] Kalıcılık');
{
  const p = H.dailyPuzzle('2026-08-09');
  const a = G.createGame(p);
  const mid = H.shortestPath(p.start, p.end)[1];
  a.guess(mid);
  a.persist();
  const b = G.createGame(p);
  check('geri yükleme çalıştı', b.restore());
  check('tahmin korundu', b.state.guesses.length === 1 && b.state.guesses[0].code === mid);
}

console.log(fails === 0 ? '\n✔ Tüm kontroller geçti.\n' : `\n✗ ${fails} kontrol başarısız.\n`);
process.exit(fails ? 1 : 0);
