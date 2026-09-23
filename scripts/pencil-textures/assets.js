// Asset builders. Each returns { name, img (ImageData), type, q }.
window.ASSETS = (() => {
  const R = 3; // device px per CSS px (iPhone)
  const C = {
    graphite: '#3a3936', graphiteDark: '#2b2825', terra: '#cc6445', terraDark: '#a8492c', tint: '#f3ddd3',
    notebook: '#f8f1de',
  };
  const out = {};

  // ---------- double pencil frame, 9-slice (slice 12 CSS, middle 60 x 12 CSS) ----------
  function roundedRectPts(W, H, ins, r, o) {
    const [il, it, ir, ib] = ins; const x0 = il, y0 = it, x1 = W - ir, y1 = H - ib;
    const { s, mx, my } = o; const pts = [];
    const pTop = P.noise1(mx, o.pCellH, o.seed + 1), pBot = P.noise1(mx, o.pCellH, o.seed + 2), pL = P.noise1(my, o.pCellV, o.seed + 3), pR = P.noise1(my, o.pCellV, o.seed + 4);
    const pv = o.pvar;
    const PT = (x) => o.p * (1 - pv * pTop(x - s)), PB = (x) => o.p * (1 - pv * pBot(x - s)), PL = (y) => o.p * (1 - pv * pL(y - s)), PR = (y) => o.p * (1 - pv * pR(y - s));
    const wob = (x) => (x >= s && x <= s + mx ? o.wobble * Math.sin((2 * Math.PI * (x - s)) / mx) : 0);
    const step = 0.8;
    const arc = (cx, cy, a0, a1, pa, pb) => { const n = Math.ceil((Math.abs(a1 - a0) * r) / step); for (let i = 1; i < n; i++) { const t = i / n; const a = a0 + (a1 - a0) * t; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), p: pa + (pb - pa) * t, w: o.w }); } };
    // top edge
    for (let x = x0 + r; x <= x1 - r; x += step) pts.push({ x, y: y0 + wob(x), p: PT(x), w: o.w });
    arc(x1 - r, y0 + r, -Math.PI / 2, 0, PT(x1 - r), PR(y0 + r));
    for (let y = y0 + r; y <= y1 - r; y += step) pts.push({ x: x1, y, p: PR(y), w: o.w });
    arc(x1 - r, y1 - r, 0, Math.PI / 2, PR(y1 - r), PB(x1 - r));
    for (let x = x1 - r; x >= x0 + r; x -= step) pts.push({ x, y: y1 - wob(x), p: PB(x), w: o.w });
    arc(x0 + r, y1 - r, Math.PI / 2, Math.PI, PB(x0 + r), PL(y1 - r));
    for (let y = y1 - r; y >= y0 + r; y -= step) pts.push({ x: x0, y, p: PL(y), w: o.w });
    arc(x0 + r, y0 + r, Math.PI, 1.5 * Math.PI, PL(y0 + r), PT(x0 + r));
    pts.push({ ...pts[0] });
    return pts;
  }
  function frame(name, color, seed, o = {}) {
    const s = 12 * R, mx = 60 * R, my = 12 * R, W = 2 * s + mx, H = 2 * s + my;
    const tooth = P.tooth(W, H, { px: mx, py: my, seed });
    const L = P.layer(W, H, { tooth });
    const base = { s, mx, my, seed, pCellH: 30, pCellV: 12, pvar: 0.2, wobble: 0.5 };
    P.stroke(L, roundedRectPts(W, H, [1.4 * R, 1.4 * R, 1.5 * R, 1.3 * R], 6.4 * R, { ...base, w: (o.outerW ?? 1.5) * R, p: o.outerP ?? 0.86 }), { k: 1.22, soft: 0.16, dmin: 0.62, base: 0.3 });
    P.stroke(L, roundedRectPts(W, H, [3.9 * R, 3.8 * R, 4.0 * R, 3.9 * R], 4.2 * R, { ...base, seed: seed + 50, w: (o.innerW ?? 0.95) * R, p: o.innerP ?? 0.74, wobble: 0.35 }), { k: 1.22, soft: 0.16, dmin: 0.6, base: 0.3 });
    out[name] = { img: P.compose(W, H, [{ L, color }]), note: `9-slice ${W}x${H}px, slice ${s}` };
  }

  function frameThin(name, color, seed) {
    const s = 6 * R, mx = 60 * R, my = 12 * R, W = 2 * s + mx, H = 2 * s + my;
    const tooth = P.tooth(W, H, { px: mx, py: my, seed }); const L = P.layer(W, H, { tooth });
    P.stroke(L, roundedRectPts(W, H, [1.2 * R, 1.2 * R, 1.2 * R, 1.2 * R], 1.6 * R, { s, mx, my, seed, pCellH: 30, pCellV: 12, pvar: 0.2, wobble: 0.3, w: 1.05 * R, p: 0.72 }), { k: 1.2, soft: 0.16, dmin: 0.58, base: 0.26 });
    out[name] = { img: P.compose(W, H, [{ L, color }]), note: `9-slice ${W}x${H}px, slice ${s}` };
  }

  // ---------- seamless diagonal hatch (colored pencil), torus-friendly direction (1,-2) ----------
  function hatch(name, seed, o = {}) {
    const T = (o.T || 72) * R; const tooth = P.tooth(T, T, { seed }); const L = P.layer(T, T, { tooth, wrap: true });
    const rnd = P.rng(seed); const dir = [1 / Math.sqrt(5), -2 / Math.sqrt(5)]; const nrm = [2 / Math.sqrt(5), 1 / Math.sqrt(5)];
    const spacingN = P.noise1(T * Math.sqrt(5), (o.cluster || 9) * R, seed + 7);
    // offsets (in c = 2x + y units) of the hatch lines, rescaled to wrap exactly
    const gaps = []; let sum = 0; const target = T; // c in [0, T)
    while (sum < target) { const g = (o.spacing || 2.3) * R * Math.sqrt(5) * (0.45 + 1.1 * spacingN(sum)) / Math.sqrt(5) * Math.sqrt(5); gaps.push(g); sum += g; }
    const scale = target / sum; let c = 0;
    const lineLen = T * Math.sqrt(5);
    for (const g of gaps) {
      c += g * scale;
      // point on line: x = c/2, y = 0 satisfies 2x + y = c
      const ox = c / 2, oy = 0;
      let t = rnd() * lineLen;
      const end = t + lineLen;
      while (t < end - 2 * R) {
        const len = ((o.lenMin || 7) + rnd() * ((o.lenMax || 15) - (o.lenMin || 7))) * R;
        const gap = (0.6 + rnd() * 2.2) * R;
        const jit = (rnd() - 0.5) * 0.5 * R; const ang = (rnd() - 0.5) * 0.07;
        const cx = ox + dir[0] * (t + len / 2) + nrm[0] * jit, cy = oy + dir[1] * (t + len / 2) + nrm[1] * jit;
        const dx = Math.cos(ang) * dir[0] - Math.sin(ang) * dir[1], dy = Math.sin(ang) * dir[0] + Math.cos(ang) * dir[1];
        const p = (o.pMin ?? 0.5) + rnd() * ((o.pMax ?? 0.92) - (o.pMin ?? 0.5));
        P.stroke(L, P.line(cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2, { w: (o.w || 0.85) * R, p, taperIn: 0.18, taperOut: 0.3, bow: (rnd() - 0.5) * 0.6 * R, seed: Math.floor(rnd() * 1e6), pvar: 0.22, wMin: 0.65, pMin: 0.35 }), { k: o.k ?? 1.2, soft: 0.15, dmin: 0.6, base: 0.25 });
        t += len + gap;
      }
    }
    out[name] = { img: P.maskImage(L, o.opacity ?? 1), note: `tile ${T}px = ${T / R} CSS` };
  }

  // ---------- hand-drawn circle(s) ----------
  function circlePts(cx, cy, r, o) {
    const pts = []; const n = Math.ceil((o.sweep * r * Math.max(o.sx || 1, o.sy || 1)) / 0.8); const wob = P.noise1(1000, 40, o.seed); const pv = P.noise1(1000, 30, o.seed + 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n; const a = o.a0 + o.sweep * t; const rr = r * (1 + (o.spiral || 0) * t) + (wob(t * 600) - 0.5) * 2 * (o.wobble || 0);
      const tp = Math.min(P.sstep(0, o.taper || 0.05, t), P.sstep(1, 1 - (o.taper || 0.05), t));
      pts.push({ x: cx + rr * Math.cos(a) * (o.sx || 1), y: cy + rr * Math.sin(a) * (o.sy || 1), p: o.p * (0.3 + 0.7 * tp) * (1 - 0.25 * pv(t * 600)), w: o.w * (0.6 + 0.4 * tp) });
    }
    if (o.tilt) { const c = Math.cos(o.tilt), s = Math.sin(o.tilt); for (const q of pts) { const x = q.x - cx, y = q.y - cy; q.x = cx + x * c - y * s; q.y = cy + x * s + y * c; } }
    return pts;
  }
  function ring(name, color, seed) {
    const S = 80 * R; const tooth = P.tooth(S, S, { seed }); const L = P.layer(S, S, { tooth }); const c = S / 2;
    P.stroke(L, circlePts(c, c, 38.6 * R, { a0: -1.75, sweep: 2 * Math.PI + 0.22, w: 1.15 * R, p: 0.82, wobble: 0.35 * R, seed }), { k: 1.18, soft: 0.15, dmin: 0.6, base: 0.25 });
    P.stroke(L, circlePts(c, c, 28.4 * R, { a0: 1.2, sweep: 2 * Math.PI + 0.26, w: 1.0 * R, p: 0.72, wobble: 0.3 * R, seed: seed + 9 }), { k: 1.15, soft: 0.15, dmin: 0.55, base: 0.2 });
    out[name] = { img: P.compose(S, S, [{ L, color }]), note: `80 CSS` };
  }
  function loop(name, wCss, hCss, seed, o = {}) {
    const W = wCss * R, H = hCss * R; const tooth = P.tooth(W, H, { seed }); const L = P.layer(W, H, { tooth });
    P.stroke(L, circlePts(W / 2, H / 2, 1, { a0: o.a0 ?? 3.6, sweep: 2 * Math.PI + (o.over ?? 0.55), sx: (W / 2 - 2.2 * R), sy: (H / 2 - 2.2 * R), spiral: o.spiral ?? -0.07, w: (o.w || 1.4) * R, p: 0.88, wobble: 0.006, seed, taper: 0.07, tilt: o.tilt ?? -0.06 }), { k: 1.22, soft: 0.15, dmin: 0.62, base: 0.3 });
    out[name] = { img: P.maskImage(L), note: `${wCss}x${hCss} CSS mask` };
  }
  function cross(name, seed) {
    const S = 20 * R; const tooth = P.tooth(S, S, { seed }); const L = P.layer(S, S, { tooth });
    P.stroke(L, P.line(4 * R, 4.6 * R, 16 * R, 15.6 * R, { w: 1.8 * R, p: 0.92, taperIn: 0.12, taperOut: 0.3, bow: 0.6 * R, seed }), { k: 1.25, soft: 0.15, dmin: 0.62, base: 0.3 });
    P.stroke(L, P.line(15.4 * R, 3.8 * R, 4.4 * R, 16.2 * R, { w: 1.7 * R, p: 0.88, taperIn: 0.15, taperOut: 0.35, bow: -0.5 * R, seed: seed + 3 }), { k: 1.25, soft: 0.15, dmin: 0.62, base: 0.3 });
    out[name] = { img: P.maskImage(L), note: '20 CSS mask' };
  }

  // ---------- underline swoosh, 3-slice (caps 24 CSS, middle 48 CSS, height 12 CSS) ----------
  function swoosh(name, color, seed, o = {}) {
    const cap = 24 * R, mid = 48 * R, W = 2 * cap + mid, H = 12 * R; const tooth = P.tooth(W, H, { px: mid, py: H, seed }); const L = P.layer(W, H, { tooth });
    const y0 = (o.y ?? 7.2) * R; const pv = P.noise1(mid, 22, seed + 1); const pts = [];
    const midY = (x) => y0 + 0.28 * R * Math.sin((2 * Math.PI * (x - cap)) / mid);
    for (let x = 2.2 * R; x <= W - 9 * R; x += 0.8) {
      let y, p, w;
      if (x < cap) { const t = (x - 2.2 * R) / (cap - 2.2 * R); y = midY(cap) + (o.startDy ?? 1.0) * R * (1 - P.sstep(0, 1, t)); p = 0.9 * (0.25 + 0.75 * P.sstep(0, 0.55, t)) * (1 - 0.18 * pv(x - cap)); w = 1.95 * R * (0.4 + 0.6 * P.sstep(0, 0.6, t)); }
      else if (x <= cap + mid) { y = midY(x); p = 0.9 * (1 - 0.18 * pv(x - cap)); w = 1.95 * R; }
      else { const t = (x - cap - mid) / (cap - 9 * R); y = midY(cap + mid) + (o.endDy ?? 0.3) * R * t; p = 0.9 * (1 - 0.18 * pv(x - cap)); w = 1.95 * R; }
      pts.push({ x, y, p, w });
    }
    // the hook: curls up at the right end and lifts off
    const lx = pts[pts.length - 1].x, ly = pts[pts.length - 1].y; const hook = o.hook ?? 1;
    for (let i = 1; i <= 30; i++) { const t = i / 30; pts.push({ x: lx + 6.2 * R * Math.sin(t * 1.35) / Math.sin(1.35), y: ly - 5.0 * R * hook * Math.pow(t, 1.6), p: 0.9 * (1 - 0.75 * Math.pow(t, 1.3)), w: 1.95 * R * (1 - 0.5 * t) }); }
    P.stroke(L, pts, { k: 1.28, soft: 0.16, dmin: 0.66, base: 0.34 });
    out[name] = { img: P.compose(W, H, [{ L, color }]), note: `3-slice caps ${cap}px mid ${mid}px` };
  }
  function shortSwoosh(name, color, seed) {
    const W = 42 * R, H = 8 * R; const tooth = P.tooth(W, H, { seed }); const L = P.layer(W, H, { tooth });
    P.stroke(L, P.line(2 * R, 5.2 * R, 39.5 * R, 3.6 * R, { w: 2.1 * R, p: 0.92, taperIn: 0.2, taperOut: 0.25, bow: 0.8 * R, seed, pvar: 0.2, wMin: 0.4 }), { k: 1.28, soft: 0.16, dmin: 0.66, base: 0.34 });
    out[name] = { img: P.compose(W, H, [{ L, color }]), note: '42x8 CSS' };
  }

  // ---------- seamless horizontal rule and wavy divider ----------
  function rule(name, color, seed, o = {}) {
    const W = 120 * R, H = (o.h || 6) * R; const tooth = P.tooth(W, H, { px: W, py: H, seed }); const L = P.layer(W, H, { tooth, wrapX: true });
    const pv = P.noise1(W, 20, seed + 1); const pts = [];
    for (let x = -4; x <= W + 4; x += 0.8) pts.push({ x, y: (o.y || 3.3) * R + 0.22 * R * Math.sin((2 * Math.PI * x) / W) + 0.12 * R * Math.sin((6 * Math.PI * x) / W + 1), p: (o.p || 0.62) * (1 - 0.3 * pv(x)), w: (o.w || 1.05) * R });
    P.stroke(L, pts, { k: o.k || 1.34, soft: 0.16, dmin: o.dmin || 0.7, base: o.base || 0.34 });
    out[name] = { img: P.compose(W, H, [{ L, color }]), note: `repeat-x 120x${o.h || 6} CSS` };
  }
  function wave(name, color, seed) {
    const W = 120 * R, H = 10 * R; const tooth = P.tooth(W, H, { px: W, py: H, seed }); const L = P.layer(W, H, { tooth, wrapX: true });
    const amp = P.noise1(W, 34, seed + 2), pv = P.noise1(W, 18, seed + 3); const lam = W / 15; const pts = [];
    for (let x = -4; x <= W + 4; x += 0.6) { const A = 1.9 * R * (0.25 + 0.75 * amp(x)); pts.push({ x, y: 5 * R + A * Math.sin((2 * Math.PI * x) / lam), p: 0.8 * (1 - 0.25 * pv(x)), w: 1.0 * R }); }
    P.stroke(L, pts, { k: 1.2, soft: 0.16, dmin: 0.6, base: 0.26 });
    out[name] = { img: P.compose(W, H, [{ L, color }]), note: 'repeat-x 120x10 CSS' };
  }

  // ---------- torn paper edge (tab bar top), seamless ----------
  function torn(name, paper, seed, shadow) {
    const W = 120 * R, H = 14 * R; const n1 = P.noise1(W, 34, seed), n2 = P.noise1(W, 9, seed + 1), n3 = P.noise1(W, 3, seed + 2), fib = P.noise(W, H, 1.2, 4, seed + 5);
    const img = new ImageData(W, H); const pc = P.hex(paper);
    for (let x = 0; x < W; x++) {
      const e = 7.2 * R + 2.3 * R * (n1(x) - 0.5) + 1.2 * R * (n2(x) - 0.5) + 0.55 * R * (n3(x) - 0.5) + (shadow ? 1.1 * R : 0);
      for (let y = 0; y < H; y++) {
        const j = (y * W + x) * 4; let a;
        if (shadow) { a = P.sstep(e - 2.4 * R, e + 1.2 * R, y) * 0.26; img.data[j] = 70; img.data[j + 1] = 52; img.data[j + 2] = 28; img.data[j + 3] = Math.round(a * 255); continue; }
        a = P.sstep(e - 0.5, e + 0.7, y);
        // white fibres fringing the torn edge
        const fringe = P.sstep(e - 1.6 * R, e - 0.2 * R, y) * (1 - a) * (fib(x, y) > 0.55 ? 0.8 : 0.25);
        const lighten = 1 - a; // fringe colour is whiter than the paper
        const al = Math.max(a, fringe);
        const mixW = fringe > a ? 0.7 : 0;
        img.data[j] = Math.round(pc[0] * (1 - mixW) + 255 * mixW); img.data[j + 1] = Math.round(pc[1] * (1 - mixW) + 253 * mixW); img.data[j + 2] = Math.round(pc[2] * (1 - mixW) + 246 * mixW); img.data[j + 3] = Math.round(al * 255); void lighten;
      }
    }
    out[name] = { img, note: 'border-image top 14 CSS, repeat-x 120 CSS' };
  }

  // ---------- papers (opaque, 2x) ----------
  function paper(name, baseHex, seed, o = {}) {
    const D = 2, T = (o.T || 160) * D; const b = P.hex(baseHex); const img = new ImageData(T, T);
    const m1 = P.noise(T, T, (o.mottle || 40) * D, (o.mottle || 40) * D * 0.8, seed), m2 = P.noise(T, T, 12 * D, 9 * D, seed + 1), g = P.noise(T, T, 0.9 * D, 0.9 * D, seed + 2), g2 = P.noise(T, T, 2.2 * D, 1.6 * D, seed + 3);
    const lum = new Float32Array(T * T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      let v = (m1(x, y) - 0.5) * (o.mottleAmt ?? 0.045) + (m2(x, y) - 0.5) * (o.mottle2 ?? 0.02) + (g(x, y) - 0.5) * (o.grain ?? 0.03) + (g2(x, y) - 0.5) * (o.grain2 ?? 0.02);
      if (o.weave) { const wx = Math.sin((2 * Math.PI * x) / (o.weave * D)), wy = Math.sin((2 * Math.PI * y) / (o.weave * D)); v += (Math.max(wx, 0) - Math.max(wy, 0)) * 0.006 + wx * wy * 0.004; }
      lum[y * T + x] = v;
    }
    // fibres: short faint curved strokes, lighter and darker
    const rnd = P.rng(seed + 9);
    for (let i = 0; i < (o.fibres ?? 60); i++) {
      let x = rnd() * T, y = rnd() * T, a = rnd() * Math.PI * 2; const len = (6 + rnd() * 22) * D; const s = rnd() < 0.55 ? 1 : -1; const amt = (0.012 + rnd() * 0.02) * s;
      for (let t = 0; t < len; t += 0.5) { a += (rnd() - 0.5) * 0.18; x += Math.cos(a) * 0.5; y += Math.sin(a) * 0.5; const X = ((Math.round(x) % T) + T) % T, Y = ((Math.round(y) % T) + T) % T; lum[Y * T + X] += amt; }
    }
    for (let i = 0; i < T * T; i++) { const j = i * 4; const f = 1 + lum[i]; img.data[j] = Math.min(255, Math.round(b[0] * f)); img.data[j + 1] = Math.min(255, Math.round(b[1] * f)); img.data[j + 2] = Math.min(255, Math.round(b[2] * f)); img.data[j + 3] = 255; }
    out[name] = { img, type: 'image/webp', q: 0.86, note: `tile ${T / D} CSS @${D}x` };
  }

  // ---------- mascot: flexed arm in the style of the reference pig ----------
  const ARM = 'M6 30.5C9 23 14 19.5 20 19.5c5.5 0 8.5 4 9.5 8.5 1-4 1.5-8 .7-11.2-2.6-1.2-3.2-5.4-1.6-8.4 2-3.6 8.9-4.8 12.6-2 3 2.4 2.8 7-.2 10.2 1.4 6.4 2.6 14.4 1.4 20.4-1 5-5.4 7.6-10.8 7.6-10 .8-19 .4-26-.4';
  function mascot(name, seed) {
    const S = 208, sc = S / 50, dx = 1 * sc, dy = 1 * sc; const tooth = P.tooth(S, S, { seed, scale: 1.2 });
    const mask = P.pathMask(S, S, ARM + 'z', { scale: sc, dx: dx + 1.5, dy: dy + 1.2 });
    const fill = P.layer(S, S, { tooth }); const rnd = P.rng(seed);
    // broad translucent cross strokes (like the pig): two directions, overlapping bands
    // light wash so no bare paper shows inside the outline
    const wash = P.layer(S, S, { tooth });
    for (let i = 0; i < 14; i++) { const y = (4 + i * 3.4) * sc; P.stroke(wash, P.line(-10, y + 30, S + 10, y - 30, { w: 4.2 * sc, p: 0.9, seed: 500 + i, pvar: 0.1 }), { k: 1.5, soft: 0.3, dmin: 0.85, base: 0.8, mask }); }
    // broad translucent cross strokes (like the pig): a few wide bands in two directions
    const bands = (ang, offs) => { const dxv = Math.cos(ang), dyv = Math.sin(ang), nx = -dyv, ny = dxv; offs.forEach((o, i) => { const cx = S / 2 + nx * o * sc, cy = S / 2 + ny * o * sc; P.stroke(fill, P.line(cx - dxv * S, cy - dyv * S, cx + dxv * S, cy + dyv * S, { w: (6 + rnd() * 2) * sc, p: 0.85, seed: i + 40 * offs.length, pvar: 0.12, wobble: 0.8 * sc }), { k: 1.4, soft: 0.25, dmin: 0.85, base: 0.7, mask, opacity: 0.2 + rnd() * 0.16 }); }); };
    bands(-Math.PI / 4, [-15, -6.5, 2, 10.5, 18]); bands(Math.PI / 4.4, [-17, -8, 1, 9.5, 17.5]);
    // a darker shade on the lower side of the arm
    const shade = P.layer(S, S, { tooth });
    for (let i = 0; i < 16; i++) { const x = (8 + i * 2.2) * sc + dx, y0 = 44 * sc + dy; P.stroke(shade, P.line(x, y0 + 1.5 * sc, x + 3.5 * sc, y0 - 9 * sc, { w: 1.1 * sc, p: 0.7, taperIn: 0.2, taperOut: 0.5, seed: 300 + i }), { k: 1, soft: 0.12, dmin: 0.5, mask }); }
    // outline and details
    const line = P.layer(S, S, { tooth });
    P.stroke(line, P.path(ARM, { scale: sc, dx, dy, w: 1.75 * sc, p: 0.95, pvar: 0.12, from: 0.012, to: 0.985, taperIn: 0.03, taperOut: 0.04, seed }), { k: 1.4, soft: 0.14, dmin: 0.72, base: 0.55 });
    for (const d of ['M31 10.6c2-.9 4.4-.9 6.2.3', 'M30.8 13.8c2.1-.8 4.6-.6 6.5.5', 'M29.4 28.4c-.3 1.8 0 3.4.9 4.6']) P.stroke(line, P.path(d, { scale: sc, dx, dy, w: 0.9 * sc, p: 0.85, taperIn: 0.2, taperOut: 0.3, seed: seed + d.length }), { k: 1.15, soft: 0.1, dmin: 0.6, base: 0.3 });
    for (const d of ['M12.6 15.6l-1.8-2.8', 'M18.4 13.4l-.1-3.4', 'M24.2 15l1.6-2.8']) P.stroke(line, P.path(d, { scale: sc, dx, dy, w: 1.0 * sc, p: 0.85, taperIn: 0.25, taperOut: 0.35, seed: seed + d.length * 3 }), { k: 1.15, soft: 0.1, dmin: 0.6, base: 0.3 });
    out[name] = { img: P.compose(S, S, [{ L: wash, color: '#e08c6c', opacity: 0.92 }, { L: fill, color: '#c95a38' }, { L: shade, color: '#9c4027', opacity: 0.5 }, { L: line, color: C.graphiteDark }]), note: '50 CSS @4x' };
  }

  // handwriting mask: the same paper-tooth skipping, lighter, plus uneven pressure,
  // so text masked with it reads as written in pencil instead of printed
  function lead(name, seed) {
    const T = 48 * R; const tooth = P.tooth(T, T, { seed }); const tone = P.noise(T, T, 9 * R, 9 * R, seed + 5); const img = new ImageData(T, T);
    for (let i = 0; i < T * T; i++) {
      const speck = P.clamp((0.22 - tooth[i]) / 0.16, 0, 1);
      const a = (1 - 0.9 * speck) * (1 - 0.1 * tone(i % T, (i / T) | 0));
      img.data[i * 4 + 3] = Math.round(P.clamp(a, 0, 1) * 255);
    }
    out[name] = { img, note: 'mask tile 48 CSS @3x' };
  }
  // paper-tooth eraser for canvas charts: where the paper dips, the lead skips
  function grain(name, seed) {
    const T = 64 * R; const tooth = P.tooth(T, T, { seed }); const img = new ImageData(T, T);
    for (let i = 0; i < T * T; i++) { const e = P.clamp((0.46 - tooth[i]) / 0.34, 0, 1) * 0.85; img.data[i * 4 + 3] = Math.round(e * 255); }
    out[name] = { img, note: 'tile 64 CSS @3x, destination-out' };
  }

  return {
    build(names) {
      const all = {
        'frame-graphite': () => frame('frame-graphite', C.graphite, 11),
        'frame-terra': () => frame('frame-terra', C.terra, 23, { outerW: 1.6, outerP: 0.9, innerP: 0.8 }),
        'frame-red': () => frame('frame-red', '#b8322a', 31),
        'hatch': () => hatch('hatch', 41, { spacing: 1.9, pMin: 0.55, pMax: 0.95 }),
        'frame-thin': () => frameThin('frame-thin', C.graphite, 37),
        'tint-terra': () => paper('tint-terra', C.tint, 43, { T: 120, mottle: 30, mottleAmt: 0.035, mottle2: 0.02, grain: 0.035, grain2: 0.02, fibres: 0 }),
        'hatch-dense': () => hatch('hatch-dense', 45, { T: 48, spacing: 1.35, lenMin: 5, lenMax: 10, pMin: 0.6, pMax: 0.95, cluster: 6, w: 0.8 }),
        'ring': () => ring('ring', C.graphite, 47),
        'loop': () => loop('loop', 40, 32, 53, {}),
        'loop-wide': () => loop('loop-wide', 60, 26, 59, { w: 1.15, over: 0.45, tilt: -0.03 }),
        'cross': () => cross('cross', 61),
        'swoosh-a': () => swoosh('swoosh-a', C.graphite, 67, {}),
        'swoosh-b': () => swoosh('swoosh-b', C.graphite, 71, { y: 6.6, startDy: 1.6, endDy: -0.4, hook: 0.8 }),
        'swoosh-terra': () => shortSwoosh('swoosh-terra', C.terra, 73),
        'rule': () => rule('rule', C.graphite, 79, { p: 0.9, w: 1.3 }),
        'rule-terra': () => rule('rule-terra', C.terra, 83, { w: 1.6, p: 0.95 }),
        'wave': () => wave('wave', C.graphite, 89),
        'torn': () => torn('torn', C.notebook, 97, false),
        'torn-shadow': () => torn('torn-shadow', C.notebook, 97, true),
        'desk': () => paper('desk', '#e7e2d8', 101, { T: 240, mottle: 70, mottleAmt: 0.05, mottle2: 0.018, grain: 0.02, grain2: 0.014, fibres: 50 }),
        'napkin': () => paper('napkin', '#faf8f3', 103, { T: 160, mottle: 45, mottleAmt: 0.02, mottle2: 0.012, grain: 0.022, grain2: 0.012, weave: 2.6, fibres: 70 }),
        'notebook': () => paper('notebook', C.notebook, 107, { T: 160, mottle: 45, mottleAmt: 0.03, mottle2: 0.014, grain: 0.026, grain2: 0.014, fibres: 60 }),
        'mascot': () => mascot('mascot', 109),
        'grain': () => grain('grain', 127),
        'lead': () => lead('lead', 131),
      };
      for (const n of names || Object.keys(all)) all[n]();
      return Object.entries(out).map(([name, v]) => ({ name, w: v.img.width, h: v.img.height, note: v.note, type: v.type || 'image/png', url: P.encode(v.img, v.type || 'image/png', v.q) }));
    },
  };
})();
