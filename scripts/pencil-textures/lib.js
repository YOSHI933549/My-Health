// Pencil simulation: graphite / coloured pencil deposited on the peaks of a paper-tooth
// height field. Runs in the browser (canvas only used for encoding).
window.P = (() => {
  const P = {};
  P.rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const sm = (t) => t * t * (3 - 2 * t);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  P.clamp = clamp; P.sstep = sstep;

  // periodic 2D value noise (period px,py in pixels)
  P.noise = (px, py, cellX, cellY, seed) => {
    const cx = Math.max(1, Math.round(px / cellX)), cy = Math.max(1, Math.round(py / cellY));
    const r = P.rng(seed); const g = new Float32Array(cx * cy); for (let i = 0; i < g.length; i++) g[i] = r();
    return (x, y) => {
      const fx = ((((x % px) + px) % px) / px) * cx, fy = ((((y % py) + py) % py) / py) * cy;
      const x0 = Math.floor(fx), y0 = Math.floor(fy); const tx = sm(fx - x0), ty = sm(fy - y0);
      const X0 = x0 % cx, X1 = (x0 + 1) % cx, Y0 = y0 % cy, Y1 = (y0 + 1) % cy;
      const a = g[Y0 * cx + X0], b = g[Y0 * cx + X1], c = g[Y1 * cx + X0], d = g[Y1 * cx + X1];
      return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    };
  };
  P.noise1 = (period, cell, seed) => { const n = P.noise(period, 1, cell, 1, seed); return (t) => n(t, 0); };

  P.equalize = (f) => {
    const N = f.length, bins = 4096; let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < N; i++) { const v = f[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const h = new Float32Array(bins); const sc = (bins - 1) / (mx - mn || 1);
    for (let i = 0; i < N; i++) h[Math.round((f[i] - mn) * sc)]++;
    let acc = 0; for (let i = 0; i < bins; i++) { acc += h[i]; h[i] = acc / N; }
    for (let i = 0; i < N; i++) f[i] = h[Math.round((f[i] - mn) * sc)];
    return f;
  };

  // paper tooth: fine grain + medium tooth + slight anisotropy (paper fibres run horizontally)
  P.tooth = (W, H, o = {}) => {
    const px = o.px || W, py = o.py || H, s = o.scale || 1, seed = o.seed || 1;
    const n1 = P.noise(px, py, 1.25 * s, 1.1 * s, seed + 11);
    const n2 = P.noise(px, py, 2.6 * s, 1.9 * s, seed + 23);
    const n3 = P.noise(px, py, 7 * s, 4.5 * s, seed + 37);
    const w1 = o.w1 ?? 0.55, w2 = o.w2 ?? 0.35, w3 = o.w3 ?? 0.1;
    const f = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = w1 * n1(x, y) + w2 * n2(x, y) + w3 * n3(x, y);
    return P.equalize(f);
  };

  P.layer = (W, H, o = {}) => ({ W, H, a: new Float32Array(W * H), S: new Float32Array(W * H), wrap: !!o.wrap, tooth: o.tooth, wrapX: o.wrapX ?? !!o.wrap, wrapY: o.wrapY ?? !!o.wrap });

  P.resample = (pts, step = 0.4) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]; const d = Math.hypot(b.x - a.x, b.y - a.y); const n = Math.max(1, Math.ceil(d / step));
      for (let k = 0; k < n; k++) { const t = k / n; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t, w: a.w + (b.w - a.w) * t }); }
    }
    out.push(pts[pts.length - 1]);
    return out;
  };

  // deposit one stroke. o.k: how deep the lead reaches into the tooth; o.soft: grain softness;
  // o.dmin: pigment density at light pressure; o.base: film in the valleys at high pressure
  P.stroke = (L, pts, o = {}) => {
    const { W, H, S, a, tooth } = L;
    const k = o.k ?? 1.0, soft = o.soft ?? 0.1, dmin = o.dmin ?? 0.5, op = o.opacity ?? 1, base = o.base ?? 0.1, edge = o.edge ?? 0.9;
    const samples = P.resample(pts, o.step || 0.35);
    const touched = [];
    for (const s of samples) {
      const r = s.w / 2; const ix0 = Math.floor(s.x - r - edge - 1), ix1 = Math.ceil(s.x + r + edge + 1), iy0 = Math.floor(s.y - r - edge - 1), iy1 = Math.ceil(s.y + r + edge + 1);
      for (let yy = iy0; yy <= iy1; yy++) {
        let Y = yy; if (L.wrapY) Y = ((Y % H) + H) % H; else if (Y < 0 || Y >= H) continue;
        for (let xx = ix0; xx <= ix1; xx++) {
          let X = xx; if (L.wrapX) X = ((X % W) + W) % W; else if (X < 0 || X >= W) continue;
          const d = Math.hypot(xx + 0.5 - s.x, yy + 0.5 - s.y);
          const cov = sstep(r + edge, r - edge, d); if (cov <= 0) continue;
          const v = cov * s.p; const idx = Y * W + X;
          if (v > S[idx]) { if (S[idx] === 0) touched.push(idx); S[idx] = v; }
        }
      }
    }
    for (const idx of touched) {
      const t = S[idx]; S[idx] = 0;
      const h = tooth ? tooth[idx] : 0.5; const thr = 1 - t * k;
      const g = sstep(thr - soft, thr + soft, h);
      let al = (g * (dmin + (1 - dmin) * t) + base * t * t * (1 - g)) * op;
      if (o.mask) al *= o.mask[idx];
      a[idx] = 1 - (1 - a[idx]) * (1 - clamp(al, 0, 1));
    }
  };

  // straight-ish stroke with taper, bow, wobble and pressure variation
  P.line = (x0, y0, x1, y1, o = {}) => {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1; const n = Math.max(2, Math.ceil(len / 0.8));
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len; const seed = o.seed || 1;
    const wob = P.noise1(1000, o.wobCell || 30, seed + 5), pv = P.noise1(1000, o.pCell || 14, seed + 9);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n; const tin = o.taperIn ? sstep(0, o.taperIn, t) : 1, tout = o.taperOut ? sstep(1, 1 - o.taperOut, t) : 1; const tp = Math.min(tin, tout);
      const w = (o.w || 3) * ((o.wMin ?? 0.5) + (1 - (o.wMin ?? 0.5)) * tp);
      const off = (wob(t * len) - 0.5) * 2 * (o.wobble || 0) + (o.bow || 0) * Math.sin(Math.PI * t);
      const p = (o.p ?? 0.8) * ((o.pMin ?? 0.25) + (1 - (o.pMin ?? 0.25)) * tp) * (1 - (o.pvar ?? 0.25) * pv(t * len));
      pts.push({ x: x0 + (x1 - x0) * t + nx * off, y: y0 + (y1 - y0) * t + ny * off, p: clamp(p, 0, 1), w });
    }
    return pts;
  };

  // points along an SVG path (browser geometry), transformed by scale/offset
  P.path = (d, o = {}) => {
    const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d); svg.appendChild(path); document.body.appendChild(svg);
    const len = path.getTotalLength(); const sc = o.scale || 1; const n = Math.max(2, Math.ceil((len * sc) / (o.step || 0.8)));
    const from = (o.from || 0) * len, to = (o.to ?? 1) * len; const pv = P.noise1(10000, o.pCell || 16, (o.seed || 1) + 3);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n; const L = from + (to - from) * t; const q = path.getPointAtLength(L);
      const tin = o.taperIn ? sstep(0, o.taperIn, t) : 1, tout = o.taperOut ? sstep(1, 1 - o.taperOut, t) : 1; const tp = Math.min(tin, tout);
      const p = (o.p ?? 0.8) * ((o.pMin ?? 0.3) + (1 - (o.pMin ?? 0.3)) * tp) * (1 - (o.pvar ?? 0.2) * pv(t * len * sc));
      pts.push({ x: q.x * sc + (o.dx || 0), y: q.y * sc + (o.dy || 0), p: clamp(p, 0, 1), w: (o.w || 3) * ((o.wMin ?? 0.6) + (1 - (o.wMin ?? 0.6)) * tp) });
    }
    svg.remove();
    return pts;
  };

  // coverage mask of a filled SVG path (for clipping fills)
  P.pathMask = (W, H, d, o = {}) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    ctx.setTransform(o.scale || 1, 0, 0, o.scale || 1, o.dx || 0, o.dy || 0); ctx.fillStyle = '#000'; ctx.fill(new Path2D(d));
    if (o.blur) { /* soft edge */ }
    const im = ctx.getImageData(0, 0, W, H).data; const m = new Float32Array(W * H); for (let i = 0; i < W * H; i++) m[i] = im[i * 4 + 3] / 255; return m;
  };

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  P.hex = hex;
  // layers: [{L, color:'#rrggbb', opacity}], bg optional '#rrggbb'
  P.compose = (W, H, layers, bg) => {
    const out = new Float32Array(W * H * 4);
    if (bg) { const c = hex(bg); for (let i = 0; i < W * H; i++) { out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 1; } }
    for (const ly of layers) {
      const c = hex(ly.color); const op = ly.opacity ?? 1; const A = ly.L.a;
      for (let i = 0; i < W * H; i++) {
        const al = A[i] * op; if (!al) continue; const j = i * 4;
        if (ly.multiply && out[j + 3] > 0) {
          // pigment over pigment: multiply-ish darkening
          for (let ch = 0; ch < 3; ch++) { const dst = out[j + ch] / Math.max(out[j + 3], 1e-6); const mix = dst * (1 - al) + (dst * c[ch] / 255) * al; out[j + ch] = mix * (out[j + 3] + al * (1 - out[j + 3])); }
          const na = out[j + 3] + al * (1 - out[j + 3]);
          // add the part of the new pigment that lands on bare paper
          const bare = al * (1 - out[j + 3]); for (let ch = 0; ch < 3; ch++) out[j + ch] = (out[j + ch] / Math.max(na, 1e-6)) * na; out[j + 3] = na; void bare;
        } else {
          for (let ch = 0; ch < 3; ch++) out[j + ch] = c[ch] * al + out[j + ch] * (1 - al);
          out[j + 3] = al + out[j + 3] * (1 - al);
        }
      }
    }
    const img = new ImageData(W, H);
    for (let i = 0; i < W * H; i++) { const j = i * 4; const a = out[j + 3]; img.data[j + 3] = Math.round(clamp(a, 0, 1) * 255); if (a > 0) { img.data[j] = Math.round(clamp(out[j] / (bg ? 1 : a), 0, 255)); img.data[j + 1] = Math.round(clamp(out[j + 1] / (bg ? 1 : a), 0, 255)); img.data[j + 2] = Math.round(clamp(out[j + 2] / (bg ? 1 : a), 0, 255)); } }
    return img;
  };
  // a layer as a black alpha mask
  P.maskImage = (L, op = 1) => { const img = new ImageData(L.W, L.H); for (let i = 0; i < L.W * L.H; i++) { img.data[i * 4 + 3] = Math.round(clamp(L.a[i] * op, 0, 1) * 255); } return img; };
  P.encode = (img, type = 'image/png', q) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); return c.toDataURL(type, q); };
  return P;
})();
