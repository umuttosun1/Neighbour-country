# HUDUT — sınırdan sınıra

Tarayıcıda oynanan günlük coğrafya bulmacası. Her gün iki ülke seçilir;
oyuncu aradaki ülkeleri bularak **kara sınırlarından** kesintisiz bir
zincir kurmaya çalışır.

Kurulum gerekmez: `index.html` dosyasına çift tıklamak yeterli.
Tüm veri `<script>` etiketiyle yüklendiği için `file://` altında da çalışır.

## Çalıştırma

```
# doğrudan
start index.html

# ya da yerel sunucuyla
npx serve .
```

## Oyun

- **Kazanma:** tahmin edilen ülkeler başlangıçtan hedefe kesintisiz bir
  sınır zinciri oluşturunca. Zincirin en kısa olması gerekmez.
- **Tahmin hakkı:** en kısa rotadaki ülke sayısı + 4.
- **Geri bildirim:** `rotada` = ülke en kısa rotalardan birinin üstünde.
  `+N adım` = bu ülkeden geçmek rotayı N sınır uzatır; yanındaki ok en
  yakın doğru rota ülkesinin yönünü gösterir.
- **Haritadan tahmin:** bir ülkeye iki kez tıklamak onu tahmin eder.
  Ülke adları yalnızca zaten bilinen ülkeler için gösterilir — yoksa
  haritada gezinerek bütün cevaplar okunabilirdi.
- **Zorluk temposu:** hafta içi kısa, hafta sonu uzun rotalar
  (`WEEK_SHAPE`, `graph.js`).

## Dosyalar

| Dosya | İş |
|---|---|
| `assets/js/graph.js` | Ülke dizini, Türkçe arama, en kısa yol, günlük bulmaca üretimi. DOM'a dokunmaz. |
| `assets/js/game.js`  | Kurallar: tahmin sınıflandırma, bütçe, kazanma/kaybetme, kayıt. |
| `assets/js/map.js`   | Projeksiyon, çizim, yakınlaştırma/kaydırma, durum boyama. Kuralları bilmez. |
| `assets/js/app.js`   | DOM bağlantıları, otomatik tamamlama, modallar. |
| `assets/js/data/*.js`| **Üretilmiş.** Elle düzenleme — `tools/build-data.mjs` çalıştır. |

## Veriyi yeniden üretmek

```
node tools/build-data.mjs   # tools/raw/* → assets/js/data/*
node tools/selftest.mjs     # tarayıcısız mantık testi
```

Kaynaklar (`tools/raw/`):

- `countries-50m.json` — [world-atlas](https://github.com/topojson/world-atlas),
  Natural Earth 50m sınır geometrisi.
- `mledoze-countries.json` — [mledoze/countries](https://github.com/mledoze/countries),
  kara sınırları ve Türkçe adlar.

Veri hattının hallettiği pürüzler:

- Kaynaktaki Türkçe adlar yanlış locale ile büyütülmüş (`çin`, `şili`,
  `ürdün`); ilk harf `tr-TR` kurallarıyla düzeltiliyor.
- Haritada olup veri setinde karşılığı olmayan alanlar: Somaliland →
  Somali'ye, Kuzey Kıbrıs → Kıbrıs'a katılıyor; Kosova ayrı bir oyun
  ülkesi olarak ekleniyor.
- **İspanya–Fas** (Ceuta/Melilla) sınırı grafikten çıkarıldı: gerçek ama
  dünya ölçeğinde çizilemiyor, oyuncuya görünmez bir kestirme sunuyordu.
  Böylece Afrika ile Avrasya arasındaki tek geçit Mısır–İsrail/Filistin
  oluyor ve haritada net görülüyor. Değiştirmek için `EXCLUDED_EDGES`.

## Ayarlar

Zorluğu belirleyen her şey `assets/js/game.js` içindeki `TUNING` bloğunda
ve `guessBudget()` fonksiyonunda toplandı.
