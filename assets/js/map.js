/* =========================================================
   HUDUT — harita katmanı
   Projeksiyon, çizim, yakınlaştırma/kaydırma, durum boyama.
   Oyun kurallarını bilmez; sadece "şu ülke şu durumda" der.
   ========================================================= */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  function createMap(svg, wrap, opts = {}) {
    /* ---------- projeksiyon ---------- */

    const features = topojson.feature(global.WORLD_TOPO, global.WORLD_TOPO.objects.countries).features;

    // Doğal Dünya projeksiyonu: kutuplarda aşırı şişmeyen, hoş duran bir uzlaşma.
    const projection = d3.geoNaturalEarth1().fitExtent([[0, 0], [1000, 520]], { type: 'Sphere' });
    const geoPath = d3.geoPath(projection);

    // Antarktika'yı çerçeveleme hesabının dışında tutuyoruz; yoksa harita
    // alt tarafta kimsenin oynamadığı devasa bir bantla dengesizleşiyor.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const bounds = new Map();
    const centers = new Map();

    for (const f of features) {
      const b = geoPath.bounds(f);
      if (!isFinite(b[0][0])) continue;
      const code = f.properties.c;
      if (code) {
        bounds.set(code, b);
        centers.set(code, largestPartCentroid(f));
      }
      if (code === 'ATA') continue;
      x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]);
      x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]);
    }

    // Çok parçalı ülkelerde etiket/çizgi düğümü en büyük parçaya konsun,
    // yoksa Norveç'in adaları yüzünden etiket denizde kalıyor.
    function largestPartCentroid(f) {
      const g = f.geometry;
      if (g.type !== 'MultiPolygon') return geoPath.centroid(f);
      let best = null, bestArea = -1;
      for (const poly of g.coordinates) {
        const part = { type: 'Polygon', coordinates: poly };
        const a = Math.abs(geoPath.area(part));
        if (a > bestArea) { bestArea = a; best = part; }
      }
      return best ? geoPath.centroid(best) : geoPath.centroid(f);
    }

    const PAD = 6;
    const VB = { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 };
    svg.setAttribute('viewBox', `${VB.x} ${VB.y} ${VB.w} ${VB.h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    /* ---------- katmanlar ---------- */

    const defs = el('defs');
    const grad = el('linearGradient', { id: 'chainGrad', x1: '0', y1: '0', x2: '1', y2: '0' });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': '#e8a33d' }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': '#3fd6b0' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    const root = el('g', { class: 'map-root' });
    svg.appendChild(root);

    const gGrat = el('g', { class: 'layer-graticule' });
    const gLand = el('g', { class: 'layer-land' });
    const gDeco = el('g', { class: 'layer-deco' });   // hâle, rota çizgisi
    const gLabel = el('g', { class: 'layer-label' });
    root.append(gGrat, gLand, gDeco, gLabel);

    const hairline = { 'vector-effect': 'non-scaling-stroke' };
    gGrat.appendChild(el('path', { class: 'graticule', d: geoPath(d3.geoGraticule10()) || '', ...hairline }));
    gGrat.appendChild(el('path', { class: 'sphere-halo', d: geoPath({ type: 'Sphere' }) || '', ...hairline }));

    /** code -> <path> */
    const shapes = new Map();
    for (const f of features) {
      const d = geoPath(f);
      if (!d) continue;
      const code = f.properties.c;
      const p = el('path', { d, 'vector-effect': 'non-scaling-stroke' });
      p.setAttribute('class', code ? 'country interactive' : 'country neutral');
      if (code) {
        p.dataset.c = code;
        shapes.set(code, p);
      }
      gLand.appendChild(p);
    }

    /* ---------- görünüm dönüşümü ---------- */

    const view = { k: 1, x: 0, y: 0 };
    let anim = null;

    function apply() {
      root.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
      // Etiketler ekran ölçeğinde sabit kalsın.
      const unitsPerPx = VB.w / (svg.clientWidth || VB.w);
      const size = 11 * unitsPerPx / view.k;
      gLabel.style.fontSize = size + 'px';
      gLabel.style.strokeWidth = size * 0.28 + 'px';
      // Süs daireleri de ekranda sabit büyüklükte kalsın.
      for (const c of gDeco.querySelectorAll('[data-r]')) {
        c.setAttribute('r', (+c.dataset.r * unitsPerPx) / view.k);
      }
    }

    function clamp() {
      view.k = Math.max(1, Math.min(16, view.k));
      // Görünür pencere, içeriğin dışına tamamen kaçamasın.
      const visW = VB.w / view.k, visH = VB.h / view.k;
      const minX = VB.x + VB.w - visW, minY = VB.y + VB.h - visH;
      // ekran = kullanıcı*k + t  →  görünen sol üst köşenin kullanıcı koordinatı:
      const ux = (VB.x - view.x) / view.k;
      const uy = (VB.y - view.y) / view.k;
      const clampedUx = Math.max(VB.x, Math.min(minX, ux));
      const clampedUy = Math.max(VB.y, Math.min(minY, uy));
      view.x = VB.x - clampedUx * view.k;
      view.y = VB.y - clampedUy * view.k;
    }

    function setView(k, ux, uy, animate) {
      // ux,uy: görünümün ortalanacağı kullanıcı koordinatı
      const target = {
        k,
        x: VB.x + VB.w / 2 - ux * k,
        y: VB.y + VB.h / 2 - uy * k,
      };
      const saved = { ...view };
      Object.assign(view, target);
      clamp();
      const final = { ...view };
      if (!animate) return apply();
      Object.assign(view, saved);
      tween(final);
    }

    function tween(target) {
      if (anim) cancelAnimationFrame(anim);
      const from = { ...view };
      const t0 = performance.now();
      const dur = 700;
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = ease(t);
        view.k = from.k + (target.k - from.k) * e;
        view.x = from.x + (target.x - from.x) * e;
        view.y = from.y + (target.y - from.y) * e;
        apply();
        if (t < 1) anim = requestAnimationFrame(step);
        else anim = null;
      };
      anim = requestAnimationFrame(step);
    }

    /** Verilen ülkeleri rahatça içine alacak şekilde odaklan. */
    function focusOn(codes, { padding = 1.45, animate = true, maxK = 9 } = {}) {
      const bs = codes.map((c) => bounds.get(c)).filter(Boolean);
      if (!bs.length) return;
      const bx0 = Math.min(...bs.map((b) => b[0][0]));
      const by0 = Math.min(...bs.map((b) => b[0][1]));
      const bx1 = Math.max(...bs.map((b) => b[1][0]));
      const by1 = Math.max(...bs.map((b) => b[1][1]));
      const bw = Math.max(bx1 - bx0, 8) * padding;
      const bh = Math.max(by1 - by0, 8) * padding;
      const k = Math.max(1, Math.min(maxK, Math.min(VB.w / bw, VB.h / bh)));
      setView(k, (bx0 + bx1) / 2, (by0 + by1) / 2, animate);
    }

    function resetView(animate = true) {
      setView(1, VB.x + VB.w / 2, VB.y + VB.h / 2, animate);
    }

    function zoomBy(factor) {
      const ux = (VB.x + VB.w / 2 - view.x) / view.k;
      const uy = (VB.y + VB.h / 2 - view.y) / view.k;
      setView(view.k * factor, ux, uy, true);
    }

    /* ---------- fare / dokunma ---------- */

    const pt = svg.createSVGPoint();
    function toUser(clientX, clientY) {
      pt.x = clientX; pt.y = clientY;
      const m = svg.getScreenCTM();
      if (!m) return { x: 0, y: 0 };
      const p = pt.matrixTransform(m.inverse());
      return { x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k };
    }

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (anim) { cancelAnimationFrame(anim); anim = null; }
      const before = toUser(e.clientX, e.clientY);
      view.k *= Math.exp(-e.deltaY * 0.0015);
      view.k = Math.max(1, Math.min(16, view.k));
      // İmlecin altındaki nokta yerinde kalsın.
      pt.x = e.clientX; pt.y = e.clientY;
      const m = svg.getScreenCTM();
      if (m) {
        const s = pt.matrixTransform(m.inverse());
        view.x = s.x - before.x * view.k;
        view.y = s.y - before.y * view.k;
      }
      clamp();
      apply();
    }, { passive: false });

    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (anim) { cancelAnimationFrame(anim); anim = null; }
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: 0 };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const m = svg.getScreenCTM();
      const scale = m ? VB.w / svg.getBoundingClientRect().width : 1;
      const dx = (e.clientX - drag.sx) * scale;
      const dy = (e.clientY - drag.sy) * scale;
      drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
      view.x = drag.vx + dx;
      view.y = drag.vy + dy;
      clamp();
      apply();
    });
    const endDrag = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const wasClick = drag.moved < 3;
      drag = null;
      svg.classList.remove('dragging');
      if (wasClick && e.target instanceof SVGPathElement && e.target.dataset.c && opts.onPick) {
        opts.onPick(e.target.dataset.c);
      }
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    /* ---------- ipucu balonu ---------- */

    const tip = opts.tip;
    let revealed = new Set();

    svg.addEventListener('pointermove', (e) => {
      if (!tip || drag) return;
      const t = e.target;
      const code = t instanceof SVGPathElement ? t.dataset.c : null;
      // Sadece oyuncunun zaten bildiği ülkelerin adı gösterilir; aksi hâlde
      // haritanın üstünde gezinerek bütün cevapları okumak mümkün olurdu.
      if (code && revealed.has(code)) {
        const r = wrap.getBoundingClientRect();
        tip.textContent = global.Hudut.name(code);
        tip.style.left = e.clientX - r.left + 'px';
        tip.style.top = e.clientY - r.top + 'px';
        tip.hidden = false;
      } else {
        tip.hidden = true;
      }
    });
    svg.addEventListener('pointerleave', () => { if (tip) tip.hidden = true; });

    /* ---------- durum boyama ---------- */

    const STATE_CLASSES = ['start', 'end', 'warm', 'cool', 'loose', 'solved'];

    /**
     * @param {Map<string,string>} states  ülke kodu -> durum sınıfı
     * @param {Set<string>} labels         adı yazılacak ülkeler
     */
    function render(states, labels) {
      revealed = labels;
      for (const [code, p] of shapes) {
        const s = states.get(code);
        p.classList.remove(...STATE_CLASSES);
        if (s) p.classList.add(...s.split(' '));
      }

      gLabel.textContent = '';
      for (const code of labels) {
        const c = centers.get(code);
        if (!c || !isFinite(c[0])) continue;
        const t = el('text', { class: 'country-label', x: c[0], y: c[1] });
        t.textContent = global.Hudut.name(code);
        gLabel.appendChild(t);
      }
      apply();
    }

    /** Başlangıç/hedef için nabız gibi atan halkalar ve aralarındaki kesikli yay. */
    function decorate(startCode, endCode) {
      gDeco.textContent = '';
      if (!startCode || !endCode) return;
      const a = centers.get(startCode), b = centers.get(endCode);
      const A = global.Hudut.get(startCode), B = global.Hudut.get(endCode);
      if (A && B && A.ll && B.ll) {
        const arc = geoPath({
          type: 'LineString',
          coordinates: [[A.ll[1], A.ll[0]], [B.ll[1], B.ll[0]]],
        });
        if (arc) gDeco.appendChild(el('path', { class: 'hint-arc', d: arc, 'vector-effect': 'non-scaling-stroke' }));
      }
      for (const [c, cls] of [[a, 'h-start'], [b, 'h-end']]) {
        if (!c || !isFinite(c[0])) continue;
        const ring = el('circle', {
          class: 'endpoint-halo ' + cls, cx: c[0], cy: c[1], r: 9, 'vector-effect': 'non-scaling-stroke',
        });
        ring.dataset.r = 11;
        gDeco.appendChild(ring);
      }
      apply();
    }

    /** Kazanınca zinciri tek bir akan çizgi olarak çiz. */
    function drawChain(pathCodes) {
      const pts = pathCodes.map((c) => centers.get(c)).filter((p) => p && isFinite(p[0]));
      if (pts.length < 2) return;
      const d = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
      gDeco.appendChild(el('path', { class: 'chain-line', d, 'vector-effect': 'non-scaling-stroke' }));
      for (const p of pts) {
        const dot = el('circle', { class: 'node-dot', cx: p[0], cy: p[1], r: 2, fill: '#fff2d8' });
        dot.dataset.r = 2.4;
        gDeco.appendChild(dot);
      }
      apply();
    }

    const ro = new ResizeObserver(() => apply());
    ro.observe(svg);
    apply();

    return { render, decorate, drawChain, focusOn, resetView, zoomBy, bounds, centers };
  }

  global.HudutMap = { createMap };
})(window);
