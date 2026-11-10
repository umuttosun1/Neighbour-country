/**
 * HUDUT — Dünya Bankası göstergelerini indir
 *
 * Çıktı: tools/raw/worldbank.json
 *   { fetched, indicators: { <kod>: { name, values: { <ISO3>: [değer, yıl] } } } }
 *
 * Her gösterge için ülke başına en son dolu değer (mrnev=1) alınır.
 * API anahtar istemez ama yavaş/kararsız olabildiği için istekler yeniden denenir.
 *
 * Çalıştırma:  node tools/fetch-worldbank.mjs   (sonra: node tools/build-data.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools/raw/worldbank.json');

// Sıra = kartta görünme sırası. build-data.mjs bu kodları kısa adlara eşler.
export const INDICATORS = [
  'SP.POP.TOTL',          // nüfus
  'NY.GDP.MKTP.CD',       // GSYH (cari $)
  'NY.GDP.PCAP.CD',       // kişi başı GSYH (cari $)
  'SP.DYN.LE00.IN',       // doğumda yaşam beklentisi
  'SP.DYN.TFRT.IN',       // doğurganlık (kadın başına doğum)
  'SP.URB.TOTL.IN.ZS',    // kentsel nüfus %
  'SL.UEM.TOTL.ZS',       // işsizlik %
  'FP.CPI.TOTL.ZG',       // enflasyon (TÜFE, yıllık %)
  'IT.NET.USER.ZS',       // internet kullanan nüfus %
  'EN.GHG.CO2.PC.CE.AR5', // kişi başı CO₂ (ton)
  'AG.LND.FRST.ZS',       // orman alanı %
  'ST.INT.ARVL',          // gelen turist
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!Array.isArray(json) || json[0]?.message) {
        throw new Error(JSON.stringify(json[0]?.message || json).slice(0, 200));
      }
      return json;
    } catch (e) {
      if (i === tries) throw e;
      console.log(`  ! ${e.message} — ${i}. deneme başarısız, tekrar deneniyor`);
      await sleep(1500 * i);
    }
  }
}

const out = { fetched: new Date().toISOString().slice(0, 10), indicators: {} };

for (const code of INDICATORS) {
  const url = `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=500&mrnev=1`;
  const [, rows] = await fetchJson(url);
  const values = {};
  for (const r of rows || []) {
    if (r.value == null || !/^[A-Z]{3}$/.test(r.countryiso3code)) continue;
    values[r.countryiso3code] = [r.value, Number(r.date)];
  }
  out.indicators[code] = { name: rows?.[0]?.indicator?.value || code, values };
  console.log(`${code.padEnd(22)} ${String(Object.keys(values).length).padStart(3)} ülke  ${out.indicators[code].name}`);
}

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\nYazıldı: tools/raw/worldbank.json (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
