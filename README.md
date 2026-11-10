# HUDUT — sınırdan sınıra

Dünya haritası üzerinde ülkeleri ve kara komşularını keşfetmek, bir de her gün
iki ülke arasındaki sınır zincirini kurmaya çalışmak için tarayıcı uygulaması.

Kurulum gerekmez: `index.html` dosyasına çift tıklamak yeterli. Tüm veri
`<script>` etiketiyle yüklendiği için `file://` altında ve internetsiz de çalışır.

```
start index.html      # doğrudan
npx serve .           # ya da yerel sunucuyla
```

## Keşfet

- Bir ülkeyi ara (Türkçe, aksansız da olur: `turkiye`, `ABD`, `BAE`) ya da
  haritada tıkla.
- Kartta resmî ad (yerel dillerde de), başkent, nüfus, yüzölçümü, yoğunluk,
  diller, para birimi, halkın adı, telefon kodu, internet uzantısı ve olimpiyat
  kodu; bağımsızlık / BM üyeliği rozetleri.
- **Ekonomi ve toplum** (Dünya Bankası): kişi başı gelir, GSYH, yaşam beklentisi,
  doğurganlık, kentli nüfus, işsizlik, enflasyon, internet kullanımı, kişi başı
  CO₂, orman alanı, gelen turist — her biri için yıl ve dünya sırası.
- Haritada ve kartta **kara komşuları**; komşuya tıklayarak ülkeden ülkeye
  gezilebilir. Komşular nüfus, kişi başı gelir ve yaşam beklentisinde seçili
  ülkeyle tabloda kıyaslanır.
- **Kara yolu ve karşılaştırma:** iki ülke arasındaki en kısa sınır rotası
  haritada çizilir ve iki ülke bütün göstergelerde yan yana karşılaştırılır
  (kara yolu olmasa da). *Bu rotayı oyna* o iki ülkeyle bir bulmaca başlatır.
- Doğrudan bağlantı: `index.html#kesfet/TUR`
- Bayraklar internet varsa [flagcdn](https://flagcdn.com) üzerinden gelir;
  yoksa ISO kodu rozeti gösterilir.

## Günlük oyun

- **Kazanma:** tahmin edilen ülkeler başlangıçtan hedefe kesintisiz bir
  sınır zinciri oluşturunca. Zincirin en kısa olması gerekmez.
- **Tahmin hakkı:** en kısa rotadaki ülke sayısı + 4.
- **Geri bildirim:** `rotada` = ülke en kısa rotalardan birinin üstünde.
  `+N adım` = bu ülkeden geçmek rotayı N sınır uzatır; yanındaki ok en
  yakın doğru rota ülkesinin yönünü gösterir.
- **Haritadan tahmin:** bir ülkeye iki kez tıklamak onu tahmin eder.
  Oyunda ülke adları yalnızca zaten bilinen ülkeler için gösterilir.
- **Zorluk temposu:** hafta içi kısa, hafta sonu uzun rotalar
  (`WEEK_SHAPE`, `graph.js`). Zorluk ayarları `game.js` içindeki `TUNING`.

## Dosyalar

| Dosya | İş |
|---|---|
| `assets/js/graph.js`   | Ülke dizini, Türkçe arama, en kısa yol, günlük bulmaca üretimi. DOM'a dokunmaz. |
| `assets/js/game.js`    | Oyun kuralları: tahmin sınıflandırma, bütçe, kazanma/kaybetme, kayıt. |
| `assets/js/map.js`     | Projeksiyon, çizim, yakınlaştırma/kaydırma, durum boyama. Kuralları bilmez. |
| `assets/js/explore.js` | Keşfet modu: arama, ülke kartı, göstergeler ve dünya sırası, komşu / iki ülke karşılaştırması, rota bulucu. |
| `assets/js/app.js`     | Oyun paneli, mod geçişi, modallar. |
| `assets/js/data/*.js`  | **Üretilmiş.** Elle düzenleme — `tools/build-data.mjs` çalıştır. |

## Veriyi yeniden üretmek

```
node tools/fetch-worldbank.mjs  # Dünya Bankası göstergelerini indir (isteğe bağlı)
node tools/build-data.mjs   # tools/raw/* → assets/js/data/*
node tools/selftest.mjs     # tarayıcısız mantık testi
```

Kaynaklar (`tools/raw/`):

- `countries-50m.json` — [world-atlas](https://github.com/topojson/world-atlas),
  Natural Earth 50m sınır geometrisi.
- `mledoze-countries.json` — [mledoze/countries](https://github.com/mledoze/countries),
  kara sınırları, Türkçe adlar, resmî adlar, başkent, dil, para birimi, telefon
  kodu, BM üyeliği, olimpiyat kodu.
- `worldbank.json` — [Dünya Bankası](https://data.worldbank.org) göstergeleri
  (ülke başına en son dolu yıl). `tools/fetch-worldbank.mjs` indirir; API
  anahtar istemez. Gösterge listesi betiğin başında.

Dil ve para birimi adları tarayıcının `Intl.DisplayNames` özelliğiyle Türkçeleştirilir.

Veri hattının hallettiği pürüzler:

- Kaynaktaki Türkçe adlar yanlış locale ile büyütülmüş (`çin`, `şili`,
  `ürdün`); ilk harf `tr-TR` kurallarıyla düzeltiliyor.
- Haritada olup veri setinde karşılığı olmayan alanlar: Somaliland →
  Somali'ye, Kuzey Kıbrıs → Kıbrıs'a katılıyor; Kosova ayrı bir ülke olarak
  ekleniyor (Dünya Bankası kodu `XKX` → `UNK`).
- **İspanya–Fas** (Ceuta/Melilla) sınırı grafikten çıkarıldı: gerçek ama
  dünya ölçeğinde çizilemiyor, görünmez bir kestirme sunuyordu. Böylece Afrika
  ile Avrasya arasındaki tek geçit Mısır–İsrail/Filistin. Değiştirmek için
  `EXCLUDED_EDGES`.

## Geçmiş

Proje basit bir "Neighbour Country Finder" olarak başladı (REST Countries
API'sinden ülke ve komşu bilgisi). O API'nin kullanılan sürümü kapatıldığı için
uygulama çevrimdışı veriye geçirildi ve HUDUT oyunuyla birleştirildi.
