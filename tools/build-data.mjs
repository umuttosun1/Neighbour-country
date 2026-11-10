/**
 * HUDUT — veri hattı
 *
 * Girdi  : tools/raw/countries-50m.json   (Natural Earth 50m, TopoJSON)
 *          tools/raw/mledoze-countries.json (ülke adları + kara sınırları)
 * Çıktı  : assets/js/data/world.js      -> window.WORLD_TOPO
 *          assets/js/data/countries.js  -> window.COUNTRY_DATA
 *
 * Çıktılar `<script>` ile yüklenebilen JS dosyaları; böylece index.html
 * hiçbir sunucu olmadan, dosyadan çift tıklayarak da açılabiliyor
 * (file:// altında fetch() CORS'a takılır, script etiketi takılmaz).
 *
 * Çalıştırma:  node tools/build-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/raw', f), 'utf8'));

/* ------------------------------------------------------------------ *
 * 1. Elle bakım gerektiren tablolar
 * ------------------------------------------------------------------ */

// Kaynak veri Türkçe adları yanlış locale ile büyütmüş: "çin", "şili", "ürdün"...
// Ayrıca bazı çeviriler yaygın kullanımdan uzak.
const NAME_FIXES = {
  ESH: 'Batı Sahra',
  CPV: 'Yeşil Burun Adaları',
  WSM: 'Samoa',
  COD: 'Demokratik Kongo',
  COG: 'Kongo',
  SWZ: 'Esvatini',
  MYA: 'Myanmar',
  UNK: 'Kosova',
  VGB: 'Britanya Virjin Adaları',
  FLK: 'Falkland Adaları',
  BIH: 'Bosna-Hersek',
};

// Kullanıcı bunları yazarsa da kabul edelim.
const ALIASES = {
  USA: ['ABD', 'Amerika', 'Amerika Birleşik Devletleri', 'USA', 'US'],
  GBR: ['İngiltere', 'Britanya', 'Büyük Britanya', 'UK', 'İngiltere ve Galler'],
  NLD: ['Felemenk', 'Nederland'],
  ARE: ['BAE', 'Emirlikler', 'Dubai'],
  CZE: ['Çek Cumhuriyeti', 'Çekoslovakya'],
  MKD: ['Makedonya'],
  MMR: ['Burma', 'Birmanya'],
  SWZ: ['Svaziland'],
  COD: ['Kongo Demokratik Cumhuriyeti', 'DR Kongo', 'Zaire', 'Kinşasa Kongo'],
  COG: ['Kongo Cumhuriyeti', 'Brazzaville Kongo'],
  CIV: ['Kot Divuar', "Côte d'Ivoire", 'Fildişi Sahilleri'],
  CAF: ['Orta Afrika'],
  TLS: ['Timor Leste'],
  PRK: ['Kuzey Kore', 'Demokratik Kore'],
  KOR: ['Güney Kore', 'Kore'],
  RUS: ['Rusya Federasyonu', 'Sovyetler'],
  DEU: ['Federal Almanya'],
  GRC: ['Yunanistan', 'Helen'],
  TUR: ['Turkiye', 'Türkiye Cumhuriyeti'],
  IRN: ['Persia', 'Pers'],
  NER: ['Nijer'],
  NGA: ['Nijerya'],
  ZAF: ['Güney Afrika Cumhuriyeti'],
  SSD: ['Güney Sudan'],
  DOM: ['Dominik'],
  PSE: ['Filistin', 'Batı Şeria', 'Gazze'],
  ESH: ['Sahra', 'Batı Sahara'],
  LAO: ['Laos'],
  VAT: ['Vatikan'],
  BLR: ['Beyaz Rusya'],
  MDA: ['Moldovya'],
  MNE: ['Montenegro'],
  HRV: ['Hırvatistan'],
  KAZ: ['Kazakistan'],
  UZB: ['Özbekistan'],
  CHE: ['İsviçre'],
  SVK: ['Slovak Cumhuriyeti'],
};

// Öneri listesinde ülkenin yanında görünen bölge etiketi.
const REGIONS = {
  'Antarctic': 'Antarktika',
  'Australia and New Zealand': 'Okyanusya',
  'Caribbean': 'Karayipler',
  'Central America': 'Orta Amerika',
  'Central Asia': 'Orta Asya',
  'Central Europe': 'Orta Avrupa',
  'Eastern Africa': 'Doğu Afrika',
  'Eastern Asia': 'Doğu Asya',
  'Eastern Europe': 'Doğu Avrupa',
  'Melanesia': 'Melanezya',
  'Micronesia': 'Mikronezya',
  'Middle Africa': 'Orta Afrika',
  'North America': 'Kuzey Amerika',
  'Northern Africa': 'Kuzey Afrika',
  'Northern Europe': 'Kuzey Avrupa',
  'Polynesia': 'Polinezya',
  'South America': 'Güney Amerika',
  'South-Eastern Asia': 'Güneydoğu Asya',
  'Southeast Europe': 'Güneydoğu Avrupa',
  'Southern Africa': 'Güney Afrika',
  'Southern Asia': 'Güney Asya',
  'Southern Europe': 'Güney Avrupa',
  'Western Africa': 'Batı Afrika',
  'Western Asia': 'Batı Asya',
  'Western Europe': 'Batı Avrupa',
};

/**
 * Haritada görünmeyen "kara sınırları".
 * Ceuta ve Melilla gerçek bir İspanya–Fas kara sınırıdır ama dünya
 * ölçeğinde çizilemez; oyuncuya Avrupa'dan Afrika'ya görünmez bir
 * kestirme sunar. Oyun mantığından çıkarıyoruz — Afrika ile Avrasya
 * arasındaki tek geçit Mısır–İsrail/Filistin oluyor ki bu da haritada
 * net biçimde görülebiliyor.
 */
const EXCLUDED_EDGES = [['ESP', 'MAR']];

// Haritada olup veri setinde karşılığı olmayan alanlar.
// 'merge' -> şeklini şu ülkeye kat, 'neutral' -> sadece kara olarak çiz.
const ORPHANS = {
  Somaliland: { merge: 'SOM' },
  'N. Cyprus': { merge: 'CYP' },
  Kosovo: { adopt: 'UNK' }, // gerçek bir oyun ülkesi olarak ekle
  'Siachen Glacier': { neutral: true },
  'Indian Ocean Ter.': { neutral: true },
};

/* ------------------------------------------------------------------ *
 * 2. Yardımcılar
 * ------------------------------------------------------------------ */

const trUpperFirst = (s) => (s ? s[0].toLocaleUpperCase('tr-TR') + s.slice(1) : s);

const toMulti = (g) =>
  g.type === 'Polygon' ? { type: 'MultiPolygon', arcs: [g.arcs] } : { type: 'MultiPolygon', arcs: g.arcs };

const mergeGeom = (a, b) => ({ type: 'MultiPolygon', arcs: [...toMulti(a).arcs, ...toMulti(b).arcs] });

const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ *
 * 3. Geometri + öznitelik eşleştirme
 * ------------------------------------------------------------------ */

const topo = raw('countries-50m.json');
const mledoze = raw('mledoze-countries.json');

const byNumeric = new Map(mledoze.filter((c) => c.ccn3).map((c) => [String(c.ccn3), c]));
const byAlpha3 = new Map(mledoze.map((c) => [c.cca3, c]));

/** cca3 -> { geom, meta } */
const shapes = new Map();
const neutralGeoms = [];

for (const g of topo.objects.countries.geometries) {
  const geom = { type: g.type, arcs: g.arcs };
  const match = g.id != null ? byNumeric.get(String(g.id)) : null;

  if (match) {
    const prev = shapes.get(match.cca3);
    shapes.set(match.cca3, { geom: prev ? mergeGeom(prev.geom, geom) : geom, meta: match });
    continue;
  }

  const orphan = ORPHANS[g.properties?.name];
  if (!orphan) {
    log(`  ! eşleşmeyen ve tanımsız alan atlandı: ${g.properties?.name}`);
    continue;
  }
  if (orphan.neutral) {
    neutralGeoms.push({ ...geom, properties: { c: null } });
  } else if (orphan.merge) {
    const prev = shapes.get(orphan.merge);
    if (prev) prev.geom = mergeGeom(prev.geom, geom);
    else neutralGeoms.push({ ...geom, properties: { c: null } });
  } else if (orphan.adopt) {
    const meta = byAlpha3.get(orphan.adopt);
    if (meta) shapes.set(orphan.adopt, { geom, meta });
  }
}

log(`Harita şekli olan ülke: ${shapes.size}  |  nötr alan: ${neutralGeoms.length}`);

/* ------------------------------------------------------------------ *
 * 4. Komşuluk grafiği
 * ------------------------------------------------------------------ */

const excluded = new Set(EXCLUDED_EDGES.map(([a, b]) => [a, b].sort().join('~')));
const adj = new Map([...shapes.keys()].map((k) => [k, new Set()]));

let dropped = 0;
let offMap = new Set();
for (const [code, { meta }] of shapes) {
  for (const other of meta.borders || []) {
    if (!shapes.has(other)) {
      offMap.add(other);
      continue;
    }
    if (excluded.has([code, other].sort().join('~'))) {
      dropped++;
      continue;
    }
    // Simetrik kapanış: taraflardan biri listelemişse sınır vardır.
    adj.get(code).add(other);
    adj.get(other).add(code);
  }
}
log(`Haritada olmayan sınır hedefleri: ${[...offMap].join(', ') || '-'}`);
log(`Elle çıkarılan kenar sayısı: ${dropped / 2 || dropped}`);

/* ------------------------------------------------------------------ *
 * 5. Bileşenler ve doğrulama
 * ------------------------------------------------------------------ */

function components() {
  const seen = new Set();
  const out = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const q = [start];
    seen.add(start);
    while (q.length) {
      const v = q.shift();
      comp.push(v);
      for (const w of adj.get(v)) if (!seen.has(w)) (seen.add(w), q.push(w));
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

const comps = components();
const compId = new Map();
comps.forEach((c, i) => c.forEach((k) => compId.set(k, i)));
log(
  `Bağlantılı bileşenler: ` +
    comps
      .slice(0, 6)
      .map((c) => c.length)
      .join(', ') +
    ` ... (toplam ${comps.length}, tek başına ${comps.filter((c) => c.length === 1).length} ada)`
);

/* ------------------------------------------------------------------ *
 * 6. Ülke kayıtları
 * ------------------------------------------------------------------ */

/**
 * Başlangıç/hedef olmaya uygun ülkeler.
 * Şart: bağımsız BM üyesi, kara sınırı var, çok küçük değil.
 * Not: başlangıç ve hedef haritada zaten işaretli olduğu için ülkenin
 * "ünlü" olması şart değil — asıl zorluk aradakileri adlandırmakta.
 */
const MIN_ENDPOINT_AREA = 20000;

const countries = [];
for (const [code, { meta }] of [...shapes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const tr = NAME_FIXES[code] || trUpperFirst(meta.translations?.tur?.common || meta.name.common);
  const nb = [...adj.get(code)].sort();
  countries.push({
    c: code,
    tr,
    en: meta.name.common,
    flag: meta.flag || '',
    ll: meta.latlng ? [meta.latlng[0], meta.latlng[1]] : null,
    area: Math.round(meta.area || 0),
    reg: REGIONS[meta.subregion] || REGIONS[meta.region] || meta.subregion || meta.region || '',
    comp: compId.get(code),
    nb,
    al: ALIASES[code] || [],
    end:
      meta.independent === true &&
      meta.unMember === true &&
      nb.length > 0 &&
      (meta.area || 0) >= MIN_ENDPOINT_AREA,
  });
}

const endpoints = countries.filter((c) => c.end);
log(`Toplam ülke: ${countries.length}  |  başlangıç/hedef olabilecek: ${endpoints.length}`);

/* ------------------------------------------------------------------ *
 * 7. Bulmaca üretilebilirlik kontrolü
 * ------------------------------------------------------------------ */

function bfs(from) {
  const d = new Map([[from, 0]]);
  const q = [from];
  while (q.length) {
    const v = q.shift();
    for (const w of adj.get(v)) if (!d.has(w)) (d.set(w, d.get(v) + 1), q.push(w));
  }
  return d;
}

const histogram = new Map();
let pairCount = 0;
for (const a of endpoints) {
  const d = bfs(a.c);
  for (const b of endpoints) {
    if (b.c <= a.c) continue;
    const dist = d.get(b.c);
    if (dist == null) continue;
    const mids = dist - 1;
    if (mids >= 2 && mids <= 8) {
      histogram.set(mids, (histogram.get(mids) || 0) + 1);
      pairCount++;
    }
  }
}
log(
  'Aradaki ülke sayısına göre uygun çift sayısı: ' +
    [...histogram.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}→${v}`).join('  ')
);
log(`Toplam oynanabilir çift: ${pairCount}`);

// Sağlık kontrolü: birkaç bilinen sınır doğru mu?
const expectTrue = [['TUR', 'GRC'], ['TUR', 'IRN'], ['USA', 'MEX'], ['FRA', 'DEU'], ['EGY', 'ISR'], ['RUS', 'PRK'], ['GBR', 'IRL']];
const expectFalse = [['ESP', 'MAR'], ['FRA', 'BRA'], ['TUR', 'RUS'], ['USA', 'RUS'], ['JPN', 'KOR']];
for (const [a, b] of expectTrue) if (!adj.get(a)?.has(b)) log(`  !! BEKLENEN SINIR YOK: ${a}-${b}`);
for (const [a, b] of expectFalse) if (adj.get(a)?.has(b)) log(`  !! OLMAMASI GEREKEN SINIR VAR: ${a}-${b}`);

/* ------------------------------------------------------------------ *
 * 8. Yazma
 * ------------------------------------------------------------------ */

const outTopo = {
  type: 'Topology',
  bbox: topo.bbox,
  transform: topo.transform,
  arcs: topo.arcs,
  objects: {
    countries: {
      type: 'GeometryCollection',
      geometries: [
        ...[...shapes].map(([code, { geom }]) => ({ ...geom, properties: { c: code } })),
        ...neutralGeoms,
      ],
    },
  },
};

const outDir = path.join(ROOT, 'assets/js/data');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  path.join(outDir, 'world.js'),
  '/* Üretilmiş dosya — tools/build-data.mjs. Elle düzenlemeyin. */\n' +
    'window.WORLD_TOPO=' + JSON.stringify(outTopo) + ';\n'
);

fs.writeFileSync(
  path.join(outDir, 'countries.js'),
  '/* Üretilmiş dosya — tools/build-data.mjs. Elle düzenlemeyin. */\n' +
    'window.COUNTRY_DATA=' + JSON.stringify({ countries }) + ';\n'
);

const kb = (p) => (fs.statSync(path.join(outDir, p)).size / 1024).toFixed(0) + ' KB';
log(`\nYazıldı: assets/js/data/world.js (${kb('world.js')}), assets/js/data/countries.js (${kb('countries.js')})`);
