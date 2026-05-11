'use strict';

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
const S = {
  bloom:     0.12,
  target:    0.12,
  mode:      'none',
  tracking:  false,
  handOn:    false,
  lastHand:  0,
  showSkel:  false,
  frame:     0,
  prevBloom: 0,
  stage:     'intro',
  prevStage: 'video',
  mouseHeld: false,
};

/* ── GESTURE STATE ─── */
const G = {
  gesture:    'neutral',
  prevGesture:'neutral',
  colorMode:  0,
  colorAngle: 0,
  timeScale:  1.0,
  indexTip:   null,
  palmPos:    null,
  gestLabel:  '',
  lastStorm:    0,
  lastBoost:    0,
  lastRock:     0,
  rockHeldSince:0,   // dwell timer for rock
  parallaxX:    0,
  parallaxY:    0,
};

const setTarget = v => { S.target = Math.max(0, Math.min(1, v)); };

let _lastBloomCSS = '';
const setCSS = () => {
  const s = S.bloom.toFixed(3);
  if (s !== _lastBloomCSS) { document.documentElement.style.setProperty('--bloom', s); _lastBloomCSS = s; }
};

const isMobile  = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const FRAME_MS  = isMobile ? 34 : 0;   // 30fps cap on mobile, uncapped on desktop
let   _lastFrameT = 0;
let   _lastFilterStr = '';

/* ═══════════════════════════════════════════
   CANVAS
═══════════════════════════════════════════ */
const cv  = document.getElementById('canvas');
const ctx = cv.getContext('2d');
const lc  = document.getElementById('lm-canvas');
const lx  = lc.getContext('2d');
const flowerVid = document.getElementById('flower-vid');
let vidMouseX = 0;

function resizeCanvases() {
  cv.width  = lc.width  = window.innerWidth;
  cv.height = lc.height = window.innerHeight;
}
resizeCanvases();
window.addEventListener('resize', resizeCanvases);

/* ═══════════════════════════════════════════
   FLOWER RENDERER  (redesigned)
═══════════════════════════════════════════ */
class FlowerRenderer {
  constructor() {
    this.t         = 0;
    this.petals    = this._buildPetals();
    this.filaments = this._buildFilaments();
    this.witherOffset = 0; // accumulated droop when withering
  }

  /* ── build petal data ── */
  _buildPetals() {
    /*  li = layer index (0=outermost, drawn first)
        r  = max radius from center
        len= petal length
        w  = half-width ratio relative to len
        hb = base hue  hv = hue variance
        Lb = base lightness (saturated mid)
        Ld = delta to tip lightness               */
    const cfg = [
      { li:0, n:9,  r:230, len:100, w:.38, hb:334, hv:8,  Lb:46, Ld:36 },
      { li:1, n:7,  r:148, len:76,  w:.43, hb:338, hv:6,  Lb:51, Ld:30 },
      { li:2, n:5,  r:78,  len:54,  w:.48, hb:343, hv:5,  Lb:57, Ld:26 },
    ];
    const petals = [];
    cfg.forEach(({ li, n, r, len, w, hb, hv, Lb, Ld }) => {
      for (let i = 0; i < n; i++) {
        petals.push({
          li,
          angle:  (i / n) * Math.PI * 2 + li * 0.35,
          maxR:   r, len, w,
          hue:    hb + (Math.random() - 0.5) * hv,
          Lbase:  Lb + (Math.random() - 0.5) * 5,
          Ltip:   Lb + Ld + (Math.random() - 0.5) * 6,
          ph:     Math.random() * Math.PI * 2,
          dropPh: Math.random() * Math.PI * 2,  // for wither droop phase
        });
      }
    });
    return petals;
  }

  /* ── precompute stamen filaments ── */
  _buildFilaments() {
    const fils = [];
    for (let i = 0; i < 22; i++) {
      fils.push({
        angle: (i / 22) * Math.PI * 2 + (Math.random() - 0.5) * 0.25,
        len:   9 + Math.random() * 13,
        hue:   44 + Math.random() * 18,
        thick: 0.5 + Math.random() * 0.6,
      });
    }
    return fils;
  }

  /* ── local bloom per layer (inner opens last) ── */
  _lb(p, bloom) {
    const delays = [0.0, 0.10, 0.20];
    const d = delays[p.li];
    return Math.min(1, Math.max(0, (bloom - d) / (1.001 - d)));
  }

  /* ── main render ── */
  render(bloom) {
    this.t++;
    const W = cv.width, H = cv.height;
    const cx = W / 2 + G.parallaxX, cy = H / 2 + G.parallaxY;

    /* track withering direction for droop */
    const withering = bloom < this.prevRenderBloom - 0.002;
    this.witherOffset += withering
      ? Math.min(0.04, (this.prevRenderBloom - bloom) * 1.2)
      : -this.witherOffset * 0.06;
    this.witherOffset = Math.max(0, Math.min(Math.PI * 0.25, this.witherOffset));
    this.prevRenderBloom = bloom;

    /* ── background ── */
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, W, H);

    /* atmospheric glow behind flower */
    if (bloom > 0.04) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.42);
      g.addColorStop(0,   `rgba(255,60,145,${bloom * 0.14})`);
      g.addColorStop(0.4, `rgba(160,0,80,${bloom * 0.055})`);
      g.addColorStop(1,   'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    /* ── petals outer → inner ── */
    [...this.petals]
      .sort((a, b) => a.li - b.li)
      .forEach(p => this._petal(p, bloom, cx, cy));

    /* ── stamen ── */
    this._stamen(bloom, cx, cy);

    /* ── vignette ── */
    const v = ctx.createRadialGradient(cx, cy, W * 0.22, cx, cy, W * 0.74);
    v.addColorStop(0, 'transparent');
    v.addColorStop(1, 'rgba(0,0,0,0.68)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  _petal(p, bloom, cx, cy) {
    const b = this._lb(p, bloom);
    if (b < 0.005) return;

    /* breathing pulse at full bloom */
    const breathe = 1 + Math.sin(this.t * 0.013 + p.ph) * 0.013 * b;

    /* droop when withering: petals tilt gravitationally */
    const droop    = this.witherOffset * (1 + p.li * 0.3)
                   * Math.sin(p.dropPh + p.angle);  // asymmetric
    const finalAng = p.angle + droop;

    const r  = p.maxR * (0.05 + b * 0.95);
    const px = cx + Math.cos(finalAng) * r;
    const py = cy + Math.sin(finalAng) * r;
    const scale = (0.03 + b * 0.97) * breathe;

    const len = p.len, hw = len * p.w;

    /* color: desaturate when withering */
    const sat  = (15 + b * 72) * (0.3 + bloom * 0.7);
    const Lmid = p.Lbase;
    const Ltip = p.Ltip;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(finalAng + Math.PI / 2);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 0.04 + b * 0.96;

    /* gradient: dark rich base → bright mid → pale luminous tip */
    const gr = ctx.createLinearGradient(0, -len * 0.18, 0, len);
    gr.addColorStop(0,    `hsl(${p.hue+10},${sat*.55}%,${Lmid-18}%)`);
    gr.addColorStop(0.18, `hsl(${p.hue+4}, ${sat*.8}%, ${Lmid-6}%)`);
    gr.addColorStop(0.45, `hsl(${p.hue},   ${sat}%,    ${Lmid}%)`);
    gr.addColorStop(0.72, `hsl(${p.hue-4}, ${sat*.85}%,${(Lmid+Ltip)/2}%)`);
    gr.addColorStop(1,    `hsl(${p.hue-8}, ${sat*.4}%, ${Ltip}%)`);

    /* petal glow */
    if (b > 0.18) {
      ctx.shadowColor = `hsl(${p.hue},82%,65%)`;
      ctx.shadowBlur  = 5 + b * 12;
    }

    ctx.fillStyle = gr;

    /* petal shape: elongated teardrop / rose petal */
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.14);
    ctx.bezierCurveTo(
       hw * 1.05, -len * 0.06,
       hw * 1.1,   len * 0.55,
       0,          len
    );
    ctx.bezierCurveTo(
      -hw * 1.1,   len * 0.55,
      -hw * 1.05, -len * 0.06,
       0,         -len * 0.14
    );
    ctx.fill();

    /* center vein */
    if (b > 0.3) {
      ctx.globalAlpha = b * 0.2;
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth   = 0.55;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -len * 0.1);
      ctx.quadraticCurveTo(len * 0.055, len * 0.38, 0, len * 0.86);
      ctx.stroke();
    }

    ctx.restore();
  }

  _stamen(bloom, cx, cy) {
    if (bloom < 0.04) return;
    const b  = Math.min(1, bloom * 1.4);
    const cr = 3 + bloom * 19;

    /* filaments (appear after inner petals open) */
    if (bloom > 0.38) {
      const fa = Math.min(1, (bloom - 0.38) * 1.6) * 0.75;
      this.filaments.forEach(f => {
        const tx = cx + Math.cos(f.angle) * (cr + f.len);
        const ty = cy + Math.sin(f.angle) * (cr + f.len);

        ctx.save();
        ctx.globalAlpha = fa;
        ctx.strokeStyle = `hsl(${f.hue},75%,72%)`;
        ctx.lineWidth   = f.thick;
        ctx.shadowColor = `hsl(${f.hue},90%,82%)`;
        ctx.shadowBlur  = 5;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(f.angle) * (cr - 2), cy + Math.sin(f.angle) * (cr - 2));
        ctx.lineTo(tx, ty);
        ctx.stroke();
        /* anther dot */
        ctx.fillStyle = `hsl(${f.hue},90%,82%)`;
        ctx.beginPath();
        ctx.arc(tx, ty, 2.0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    /* center disk */
    ctx.save();
    ctx.globalAlpha = 0.25 + b * 0.75;
    ctx.shadowColor = '#FF4FA3';
    ctx.shadowBlur  = 22 * b;

    /* soft outer halo */
    ctx.beginPath();
    ctx.arc(cx, cy, cr + 16, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,60,148,${b * 0.09})`;
    ctx.fill();

    /* core gradient */
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    cg.addColorStop(0, `hsl(340,${22+b*58}%,${30+b*20}%)`);
    cg.addColorStop(1, `hsl(340,${16+b*48}%,${18+b*16}%)`);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════
   LOTUS RENDERER
═══════════════════════════════════════════ */
class LotusRenderer {
  constructor() {
    this.t = 0;
    this.petals = this._buildPetals();
    this.witherOffset = 0;
    this.prevRenderBloom = 0;
  }

  _buildPetals() {
    const cfg = [
      { li:0, n:8, maxR:210, len:95, w:.82, hb:330, hv:12, Lb:80, Ld:10 },
      { li:1, n:5, maxR:130, len:70, w:.90, hb:335, hv:8,  Lb:85, Ld:8  },
      { li:2, n:4, maxR:62,  len:48, w:.95, hb:340, hv:6,  Lb:88, Ld:7  },
    ];
    const out = [];
    cfg.forEach(({ li, n, maxR, len, w, hb, hv, Lb, Ld }) => {
      for (let i = 0; i < n; i++) {
        out.push({
          li, maxR, len, w,
          angle:  (i/n)*Math.PI*2 + li*0.5,
          hue:    hb + (Math.random()-0.5)*hv,
          Lbase:  Lb + (Math.random()-0.5)*3,
          Ltip:   Lb + Ld + (Math.random()-0.5)*4,
          ph:     Math.random()*Math.PI*2,
          dropPh: Math.random()*Math.PI*2,
        });
      }
    });
    return out;
  }

  _lb(p, bloom) {
    const d = [0.0, 0.14, 0.28][p.li];
    return Math.min(1, Math.max(0, (bloom-d)/(1.001-d)));
  }

  render(bloom) {
    this.t++;
    const W = cv.width, H = cv.height;
    const cx = W/2 + G.parallaxX, cy = H/2 + G.parallaxY;

    const withering = bloom < this.prevRenderBloom - 0.002;
    this.witherOffset += withering
      ? Math.min(0.025, (this.prevRenderBloom-bloom)*0.9)
      : -this.witherOffset*0.07;
    this.witherOffset = Math.max(0, Math.min(0.55, this.witherOffset));
    this.prevRenderBloom = bloom;

    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, W, H);

    if (bloom > 0.04) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W*0.46);
      g.addColorStop(0,   `rgba(255,200,230,${bloom*0.09})`);
      g.addColorStop(0.45,`rgba(200,120,180,${bloom*0.035})`);
      g.addColorStop(1,   'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    [...this.petals].sort((a,b)=>a.li-b.li).forEach(p=>this._petal(p, bloom, cx, cy));
    this._center(bloom, cx, cy);

    const v = ctx.createRadialGradient(cx, cy, W*0.2, cx, cy, W*0.74);
    v.addColorStop(0,'transparent');
    v.addColorStop(1,'rgba(0,0,0,0.70)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  _petal(p, bloom, cx, cy) {
    const b = this._lb(p, bloom);
    if (b < 0.005) return;

    const splayFactor = 0.15 + b*0.85;
    const breathe = 1 + Math.sin(this.t*0.012 + p.ph)*0.01*b;
    const droop   = this.witherOffset*(1+p.li*0.2)*Math.sin(p.dropPh+p.angle);
    const finalAng = p.angle + droop;

    const r   = p.maxR*(0.06 + b*0.94);
    const px  = cx + Math.cos(finalAng)*r;
    const py  = cy + Math.sin(finalAng)*r;
    const len = p.len, hw = len*p.w;
    const sat = 8 + b*38;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(finalAng + Math.PI/2);
    ctx.scale(breathe*splayFactor, breathe*(0.5+b*0.5));
    ctx.globalAlpha = 0.06 + b*0.92;

    const gr = ctx.createLinearGradient(0,-len*0.15, 0, len);
    gr.addColorStop(0,    `hsl(${p.hue+12},${sat*0.3}%,96%)`);
    gr.addColorStop(0.25, `hsl(${p.hue+6}, ${sat*0.6}%,${p.Ltip+2}%)`);
    gr.addColorStop(0.55, `hsl(${p.hue},   ${sat}%,   ${p.Lbase}%)`);
    gr.addColorStop(1,    `hsl(${p.hue-4}, ${sat*1.1}%,${p.Lbase-12}%)`);

    if (b > 0.15) {
      ctx.shadowColor = `hsl(${p.hue},${sat*2}%,90%)`;
      ctx.shadowBlur  = 10 + b*20;
    }
    ctx.fillStyle = gr;

    ctx.beginPath();
    ctx.moveTo(0, -len*0.08);
    ctx.bezierCurveTo( hw*1.25,-len*0.02,  hw*1.15, len*0.6,  0, len);
    ctx.bezierCurveTo(-hw*1.15, len*0.6,  -hw*1.25,-len*0.02, 0,-len*0.08);
    ctx.fill();

    if (b > 0.35) {
      ctx.globalAlpha = b*0.18;
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth   = 0.5;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(0,-len*0.05);
      ctx.quadraticCurveTo(len*0.04, len*0.42, 0, len*0.9);
      ctx.stroke();
      [-1,1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(0, len*0.18);
        ctx.quadraticCurveTo(s*hw*0.6, len*0.55, s*hw*0.95, len*0.75);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  _center(bloom, cx, cy) {
    if (bloom < 0.04) return;
    const b = Math.min(1, bloom*1.3);
    const r = 4 + bloom*13;
    ctx.save();
    ctx.globalAlpha = 0.3 + b*0.7;
    ctx.shadowColor = '#FFD060';
    ctx.shadowBlur  = 20*b;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    cg.addColorStop(0,   `hsl(50,${45+b*50}%,${68+b*22}%)`);
    cg.addColorStop(0.6, `hsl(44,${35+b*40}%,${50+b*18}%)`);
    cg.addColorStop(1,   `hsl(38,${25+b*30}%,${35+b*12}%)`);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fill();
    if (bloom > 0.5) {
      const da = Math.min(1,(bloom-0.5)*2)*0.5;
      ctx.globalAlpha = da;
      ctx.fillStyle = 'rgba(255,240,150,0.55)';
      for (let i=0; i<12; i++) {
        const ang = (i/12)*Math.PI*2;
        ctx.beginPath();
        ctx.arc(cx+Math.cos(ang)*r*0.55, cy+Math.sin(ang)*r*0.55, 1.2, 0, Math.PI*2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════
   CRYSTAL RENDERER
═══════════════════════════════════════════ */
class CrystalRenderer {
  constructor() {
    this.t = 0;
    this.facets = this._buildFacets();
    this.prevRenderBloom = 0;
  }

  _buildFacets() {
    const rings = [
      { li:0, n:8, maxR:210, size:70 },
      { li:1, n:5, maxR:130, size:52 },
      { li:2, n:3, maxR:66,  size:36 },
    ];
    const out = [];
    rings.forEach(({ li, n, maxR, size }) => {
      for (let i=0; i<n; i++) {
        out.push({
          li, maxR, size,
          angle:   (i/n)*Math.PI*2 + li*0.38,
          hue:     255 + Math.random()*90,
          rotOff:  (Math.random()-0.5)*0.5,
          ph:      Math.random()*Math.PI*2,
        });
      }
    });
    return out;
  }

  _lb(f, bloom) {
    const d = [0.0, 0.13, 0.26][f.li];
    return Math.min(1, Math.max(0, (bloom-d)/(1.001-d)));
  }

  render(bloom) {
    this.t++;
    const W = cv.width, H = cv.height;
    const cx = W/2 + G.parallaxX, cy = H/2 + G.parallaxY;
    this.prevRenderBloom = bloom;

    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, W, H);

    if (bloom > 0.04) {
      const h = 270 + bloom*70;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W*0.44);
      g.addColorStop(0,   `hsla(${h},80%,55%,${bloom*0.12})`);
      g.addColorStop(0.5, `hsla(${h+30},60%,35%,${bloom*0.05})`);
      g.addColorStop(1,   'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    if (bloom > 0.6) {
      const ra = Math.min(1,(bloom-0.6)/0.35)*0.055;
      const h  = 270 + bloom*70 + this.t*0.18;
      ctx.save();
      ctx.globalAlpha = ra;
      for (let i=0; i<6; i++) {
        const ang = (i/6)*Math.PI*2 + this.t*0.004;
        ctx.strokeStyle = `hsl(${h+i*12},90%,85%)`;
        ctx.lineWidth   = 0.8;
        ctx.shadowColor = `hsl(${h+i*12},90%,75%)`;
        ctx.shadowBlur  = 14;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx+Math.cos(ang)*W*0.45, cy+Math.sin(ang)*H*0.45);
        ctx.stroke();
      }
      ctx.restore();
    }

    [...this.facets].sort((a,b)=>a.li-b.li).forEach(f=>this._facet(f, bloom, cx, cy));
    this._core(bloom, cx, cy);

    const v = ctx.createRadialGradient(cx, cy, W*0.19, cx, cy, W*0.72);
    v.addColorStop(0,'transparent');
    v.addColorStop(1,'rgba(0,0,0,0.72)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  _facet(f, bloom, cx, cy) {
    const b = this._lb(f, bloom);
    if (b < 0.005) return;

    const breathe = 1 + Math.sin(this.t*0.01 + f.ph)*0.018*b;
    const r   = f.maxR*(0.08 + b*0.92)*breathe;
    const px  = cx + Math.cos(f.angle)*r;
    const py  = cy + Math.sin(f.angle)*r;
    const sz  = f.size*(0.08 + b*0.92);
    const hue = f.hue + bloom*70 + this.t*0.12;
    const sat = 65 + b*30;
    const L   = 30 + b*38;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(f.angle + f.rotOff + this.t*0.0035);
    ctx.globalAlpha = 0.07 + b*0.87;
    ctx.shadowColor = `hsl(${hue},${sat}%,${L+30}%)`;
    ctx.shadowBlur  = 14 + b*28;

    const gr = ctx.createLinearGradient(-sz, 0, sz, sz*1.2);
    gr.addColorStop(0,    `hsl(${hue+25},${sat}%,${L+30}%)`);
    gr.addColorStop(0.3,  `hsl(${hue+10},${sat}%,${L+15}%)`);
    gr.addColorStop(0.65, `hsl(${hue},   ${sat}%,${L}%)`);
    gr.addColorStop(1,    `hsl(${hue-20},${sat*.75}%,${L-12}%)`);
    ctx.fillStyle = gr;

    ctx.beginPath();
    ctx.moveTo(0, -sz*1.5);
    ctx.lineTo(sz*0.72, 0);
    ctx.lineTo(0, sz*1.15);
    ctx.lineTo(-sz*0.72, 0);
    ctx.closePath();
    ctx.fill();

    if (b > 0.22) {
      ctx.globalAlpha = b*0.4;
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = `hsl(${hue+35},95%,92%)`;
      ctx.lineWidth   = 0.7;
      ctx.stroke();
      ctx.globalAlpha = b*0.2;
      ctx.beginPath();
      ctx.moveTo(0,-sz*1.5);
      ctx.lineTo(sz*0.72, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  _core(bloom, cx, cy) {
    if (bloom < 0.04) return;
    const b   = Math.min(1, bloom*1.2);
    const r   = 5 + bloom*20;
    const hue = 275 + bloom*90 + this.t*0.2;

    ctx.save();
    ctx.globalAlpha = 0.3 + b*0.7;
    ctx.shadowColor = `hsl(${hue},100%,75%)`;
    ctx.shadowBlur  = 35*b;

    ctx.beginPath();
    ctx.arc(cx, cy, r+20, 0, Math.PI*2);
    ctx.fillStyle = `hsla(${hue},80%,55%,${b*0.08})`;
    ctx.fill();

    if (bloom > 0.4) {
      const sa = Math.min(1,(bloom-0.4)/0.5);
      ctx.globalAlpha = sa*0.55;
      ctx.strokeStyle = `hsl(${hue+20},90%,88%)`;
      ctx.lineWidth   = 1;
      ctx.shadowBlur  = 18;
      for (let i=0; i<8; i++) {
        const ang = (i/8)*Math.PI*2 + this.t*0.006;
        const len = r + 22 + Math.sin(this.t*0.04+i)*6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx+Math.cos(ang)*len, cy+Math.sin(ang)*len);
        ctx.stroke();
      }
    }

    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    cg.addColorStop(0,    `hsl(${hue+30},70%,92%)`);
    cg.addColorStop(0.35, `hsl(${hue+10},80%,72%)`);
    cg.addColorStop(0.7,  `hsl(${hue},   85%,52%)`);
    cg.addColorStop(1,    `hsl(${hue-20},70%,32%)`);
    ctx.globalAlpha = 0.3 + b*0.7;
    ctx.shadowBlur  = 35*b;
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════
   DANDELION RENDERER
═══════════════════════════════════════════ */
class DandelionRenderer {
  constructor() {
    this.t = 0;
    this.seeds = this._buildSeeds();
    this.prevRenderBloom = 0;
    this.witherOffset = 0;
  }

  _buildSeeds() {
    const n = 48, phi = Math.PI*(3-Math.sqrt(5));
    const out = [];
    for (let i=0; i<n; i++) {
      const y3d = 1-(i/(n-1))*2;
      const r3d = Math.sqrt(Math.max(0, 1-y3d*y3d));
      const th  = phi*i;
      out.push({
        x3d: Math.cos(th)*r3d,
        y3d,
        z3d: Math.sin(th)*r3d,
        len: 38 + Math.random()*26,
        sz:  2.5 + Math.random()*3.5,
        hue: 42 + Math.random()*18,
        ph:  Math.random()*Math.PI*2,
      });
    }
    return out;
  }

  render(bloom) {
    this.t++;
    const W = cv.width, H = cv.height;
    const cx = W/2 + G.parallaxX, cy = H/2 + G.parallaxY;

    const withering = bloom < this.prevRenderBloom - 0.002;
    this.witherOffset += withering
      ? Math.min(0.02,(this.prevRenderBloom-bloom)*0.8)
      : -this.witherOffset*0.07;
    this.witherOffset = Math.max(0, Math.min(0.4, this.witherOffset));
    this.prevRenderBloom = bloom;

    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, W, H);

    if (bloom > 0.04) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, W*0.4);
      g.addColorStop(0,   `rgba(255,245,190,${bloom*0.08})`);
      g.addColorStop(0.45,`rgba(200,170,100,${bloom*0.03})`);
      g.addColorStop(1,   'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    const curR = 8 + bloom*(175-8);
    const sorted = [...this.seeds]
      .map(s => ({ ...s, _rz: s.z3d*curR }))
      .sort((a,b) => a._rz - b._rz);

    sorted.forEach(s => this._seed(s, bloom, cx, cy, curR));
    this._center(bloom, cx, cy);

    const v = ctx.createRadialGradient(cx, cy, W*0.18, cx, cy, W*0.7);
    v.addColorStop(0,'transparent');
    v.addColorStop(1,'rgba(0,0,0,0.72)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  _seed(s, bloom, cx, cy, curR) {
    if (bloom < 0.008) return;
    const depth = (s.z3d + 1) / 2;
    const sc    = 0.45 + depth*0.7;
    const alp   = (0.1 + depth*0.78) * Math.min(1, bloom*2.8);
    if (alp < 0.008) return;

    const px = cx + s.x3d*curR;
    const py = cy + s.y3d*curR + this.witherOffset*s.y3d*18;

    const breathe = 1 + Math.sin(this.t*0.013+s.ph)*0.02*Math.min(1,bloom*3);
    const sz = s.sz*sc*breathe*Math.min(1, bloom*2.2);

    ctx.save();
    ctx.globalAlpha = alp;
    ctx.lineCap = 'round';

    /* filament from center to tip */
    ctx.strokeStyle = `hsl(${s.hue},55%,72%)`;
    ctx.lineWidth   = 0.55*sc;
    ctx.shadowColor = `hsl(${s.hue},75%,82%)`;
    ctx.shadowBlur  = 5*sc;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.stroke();

    /* starburst tip */
    ctx.translate(px, py);
    ctx.strokeStyle = `hsl(${s.hue},65%,80%)`;
    ctx.lineWidth   = 0.4*sc;
    ctx.shadowBlur  = 3*sc;
    for (let i=0; i<10; i++) {
      const ang = (i/10)*Math.PI*2;
      const rl  = i%2===0 ? sz : sz*0.55;
      ctx.beginPath();
      ctx.moveTo(0,0);
      ctx.lineTo(Math.cos(ang)*rl, Math.sin(ang)*rl);
      ctx.stroke();
    }
    ctx.shadowBlur = 8*sc;
    ctx.fillStyle  = `hsl(${s.hue},70%,82%)`;
    ctx.beginPath();
    ctx.arc(0, 0, sz*0.28, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  _center(bloom, cx, cy) {
    if (bloom < 0.04) return;
    const b = Math.min(1, bloom*1.4);
    const r = 3 + bloom*9;
    ctx.save();
    ctx.globalAlpha = 0.4 + b*0.6;
    ctx.shadowColor = '#FFE580';
    ctx.shadowBlur  = 22*b;
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    cg.addColorStop(0,   `hsl(50,${65+b*35}%,${78+b*18}%)`);
    cg.addColorStop(0.7, `hsl(44,${50+b*30}%,${58+b*14}%)`);
    cg.addColorStop(1,   `hsl(40,${35+b*22}%,${40+b*10}%)`);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════
   FALLING PETAL PARTICLES
═══════════════════════════════════════════ */
const PCLR = [
  '#FF4FA3','#FF74B8','#FB8EC4','#F9A8D4',
  '#FECDD3','#EC4899','#E879A0','#FF6BB5',
];
const MAX_P = isMobile ? 80 : 150;
let petals = [];

class Petal {
  constructor(rising) {
    const W = cv.width, H = cv.height;
    this.depth = Math.random();
    this.size  = 4 + this.depth * 20;
    this.clr   = PCLR[Math.floor(Math.random() * PCLR.length)];
    this.slim  = Math.random() < 0.45;
    this.rot   = Math.random() * Math.PI * 2;
    this.rotV  = (Math.random() - 0.5) * 0.025;
    this.sw    = Math.random() * Math.PI * 2;
    this.swS   = 0.006 + Math.random() * 0.01;
    this.swA   = 0.25 + this.depth * 0.85;
    this.alpha = rising ? 0 : (0.04 + Math.random() * 0.08);
    this.maxA  = (0.28 + this.depth * 0.48) * (0.7 + Math.random() * 0.3);
    this.active = true;

    if (rising) {
      const sx = 0.22 + this.depth * 0.26;
      this.x  = W * (0.5 - sx/2) + Math.random() * W * sx;
      this.y  = H + this.size + Math.random() * 80;
      const sp = 0.5 + this.depth * 2.2;
      this.vx = (Math.random() - 0.5) * sp;
      this.vy = -(Math.random() * sp + 0.45);
    } else {
      /* ambient — start high, fall slowly */
      this.x  = Math.random() * W;
      this.y  = -this.size - Math.random() * H * 0.6;
      this.vy = 0.15 + Math.random() * 0.28;
      this.vx = (Math.random() - 0.5) * 0.45;
    }
  }

  update(bloom, withering) {
    this.sw += this.swS;
    const wx = Math.sin(this.sw) * this.swA;

    if (bloom > 0.18) {
      /* rising */
      this.vy  -= bloom * 0.036 * (0.5 + this.depth);
      this.vy   = Math.max(this.vy, -(1.8 + this.depth * 3.2));
      this.alpha = Math.min(this.alpha + 0.008 * bloom, this.maxA);
    } else {
      /* falling — more gravity when actively withering */
      const g = withering ? 0.09 + bloom * 0.02 : 0.045 + bloom * 0.03;
      this.vy  += g;
      this.vy   = Math.min(this.vy, 5 + this.depth * 3);
      /* spin faster when falling in wither */
      if (withering) this.rotV += (Math.random() - 0.5) * 0.004;
      this.alpha = Math.max(this.alpha - (withering ? 0.004 : 0.0025), 0);
    }

    this.vx += wx * 0.013;
    this.vx  *= 0.994;
    this.x   += this.vx + wx * 0.14;
    this.y   += this.vy;
    this.rot  += this.rotV;

    const H = cv.height;
    if (bloom > 0.18 && this.y < -120) {
      /* recycle rising petals */
      this.y  = H + this.size + Math.random() * 40;
      this.x  = cv.width * 0.2 + Math.random() * cv.width * 0.6;
      this.vy = -(Math.random() * (0.5 + this.depth * 1.8) + 0.35);
      this.alpha = 0;
    }
    if (this.alpha <= 0.002 && this.y > H + 60) this.active = false;
  }

  draw() {
    if (this.alpha < 0.002) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle   = this.clr;

    const s = this.size;
    if (this.slim) {
      const w = s * 0.33;
      ctx.beginPath();
      ctx.moveTo(0,-s*1.12); ctx.bezierCurveTo(w,-s*.5,w,s*.5,0,s*1.12);
      ctx.bezierCurveTo(-w,s*.5,-w,-s*.5,0,-s*1.12); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(0,-s); ctx.bezierCurveTo(s*.55,-s*.43,s*.55,s*.43,0,s);
      ctx.bezierCurveTo(-s*.55,s*.43,-s*.55,-s*.43,0,-s); ctx.fill();
    }
    ctx.restore();
  }
}

function spawnPetals(n, rising) {
  for (let i = 0; i < n && petals.length < MAX_P; i++) petals.push(new Petal(rising));
}

/* ═══════════════════════════════════════════
   HAND SKELETON
═══════════════════════════════════════════ */
const CONN = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];
const TIPS = new Set([4,8,12,16,20]);

function drawSkeleton(lm) {
  lx.clearRect(0, 0, lc.width, lc.height);
  if (!lm) return;

  const W = lc.width, H = lc.height;
  const cxW = W / 2, cyH = H / 2;

  /* spotlight beam when pointing */
  if (G.gesture === 'point' && G.indexTip) {
    const tx = (1 - G.indexTip.x) * W;
    const ty = G.indexTip.y * H;
    const ex = cxW + G.parallaxX;
    const ey = cyH + G.parallaxY;
    lx.save();
    const gr = lx.createLinearGradient(tx, ty, ex, ey);
    gr.addColorStop(0, 'rgba(255,79,163,0.80)');
    gr.addColorStop(0.6, 'rgba(255,79,163,0.25)');
    gr.addColorStop(1, 'rgba(255,79,163,0.0)');
    lx.strokeStyle = gr;
    lx.lineWidth = 2.5;
    lx.shadowColor = 'rgba(255,79,163,0.9)';
    lx.shadowBlur = 22;
    lx.lineCap = 'round';
    lx.beginPath();
    lx.moveTo(tx, ty);
    lx.lineTo(ex, ey);
    lx.stroke();
    /* glowing dot at fingertip */
    lx.beginPath();
    lx.arc(tx, ty, 6, 0, Math.PI * 2);
    lx.fillStyle = 'rgba(255,79,163,0.95)';
    lx.shadowBlur = 28;
    lx.fill();
    lx.restore();
  }

}

/* draw hand skeleton(s) on cam-preview canvas */
let _camSkelEl = null, _camSkelCtx = null;
function drawCamSkeleton(lmArray) {
  if (!_camSkelEl) _camSkelEl = document.getElementById('cam-skel');
  if (!_camSkelEl) return;
  const box = _camSkelEl.parentElement;
  const w = box.offsetWidth, h = box.offsetHeight;
  if (_camSkelEl.width !== w) _camSkelEl.width = w;
  if (_camSkelEl.height !== h) _camSkelEl.height = h;
  if (!_camSkelCtx) _camSkelCtx = _camSkelEl.getContext('2d');
  const cx = _camSkelCtx;
  cx.clearRect(0, 0, w, h);
  if (!lmArray.length) return;

  for (const lm of lmArray) {
    const pt = i => ({ x: (1 - lm[i].x) * w, y: lm[i].y * h });

    /* bone connections — thin, semi-transparent */
    cx.lineWidth = 0.85; cx.lineCap = 'round';
    CONN.forEach(([a, b]) => {
      const pa = pt(a), pb = pt(b);
      /* finger bones slightly brighter than palm connections */
      const isPalm = (a === 0 || b === 0 || (a >= 5 && a <= 17 && b >= 5 && b <= 17));
      cx.strokeStyle = isPalm ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.50)';
      cx.beginPath(); cx.moveTo(pa.x, pa.y); cx.lineTo(pb.x, pb.y); cx.stroke();
    });

    /* joints */
    for (let i = 0; i < 21; i++) {
      const p = pt(i);
      if (TIPS.has(i)) {
        /* fingertips: pink glow */
        cx.beginPath();
        cx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
        cx.fillStyle = 'rgba(255,79,163,0.90)';
        cx.fill();
        /* outer ring */
        cx.beginPath();
        cx.arc(p.x, p.y, 4.2, 0, Math.PI * 2);
        cx.strokeStyle = 'rgba(255,79,163,0.30)';
        cx.lineWidth = 0.8;
        cx.stroke();
      } else if (i === 0) {
        /* wrist */
        cx.beginPath();
        cx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        cx.fillStyle = 'rgba(255,255,255,0.55)';
        cx.fill();
      } else {
        /* knuckles */
        cx.beginPath();
        cx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
        cx.fillStyle = 'rgba(255,255,255,0.40)';
        cx.fill();
      }
    }
  }
}

/* ═══════════════════════════════════════════
   GESTURE DETECTION
═══════════════════════════════════════════ */
const GESTURE_LABELS = {
  open:     'Open Hand — Bloom',
  fist:     'Fist — Wither',
  peace:    'Peace ✌ — Petal Storm',
  point:    'Pointing — Spotlight',
  rock:     'Rock 🤘 — Color Shift',
  pinch:    'Pinch — Slow Time',
  thumbsup: 'Thumbs Up — Instant Bloom',
  neutral:  '',
};
const COLOR_ANGLES = [0, 200, 285, 48]; // pink, teal, purple, gold

function detectGesture(lm) {
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  /* finger extended = tip clearly above PIP joint */
  const ext  = tips.map((t, i) => lm[t].y < lm[pips[i]].y - 0.015);
  const extN = ext.filter(Boolean).length;

  const thumbTip = lm[4], thumbIP = lm[3];

  /* thumbsup: thumb clearly pointing up, ALL other fingers closed (no stray) */
  const thumbUp = thumbTip.y < thumbIP.y - 0.04 && extN === 0;

  /* pinch: thumb-index distance < threshold AND index finger raised above MCP
     (prevents fist from triggering pinch when thumb is near folded index) */
  const pinchDist  = Math.hypot(thumbTip.x - lm[8].x, thumbTip.y - lm[8].y);
  const indexRaised = lm[8].y < lm[5].y;   // index tip above index MCP
  const isPinch    = pinchDist < 0.07 && indexRaised && !ext[1] && !ext[2] && !ext[3];

  /* openRatio: 4 fingers only, thumb excluded */
  const openRatio = extN / 4;

  const palmPos = { x: lm[9].x, y: lm[9].y };

  let gesture = 'neutral';
  if      (isPinch)                                    gesture = 'pinch';
  else if (ext[0] && !ext[1] && !ext[2] && !ext[3])   gesture = 'point';
  else if (ext[0] && ext[1] && !ext[3] && extN <= 3)  gesture = 'peace';
  else if (ext[0] && !ext[1] && !ext[2] && ext[3])    gesture = 'rock';
  else if (thumbUp)                                    gesture = 'thumbsup';
  else if (openRatio >= 0.75)                          gesture = 'open';
  else if (openRatio <= 0.25)                          gesture = 'fist';

  return { gesture, openRatio, indexTip: lm[8], palmPos, extN };
}

function handleGestureChange(gesture) {
  G.gestLabel = GESTURE_LABELS[gesture] || '';
  if (gesture === 'peace' && Date.now() - G.lastStorm > 1800) {
    spawnPetals(62, true);
    G.lastStorm = Date.now();
  }
  if (gesture === 'thumbsup' && Date.now() - G.lastBoost > 2000) {
    spawnPetals(40, true);
    G.lastBoost = Date.now();
  }
  /* rock: handled via dwell timer in onResults, not here */
}



/* ═══════════════════════════════════════════
   CAMERA TRACKING
═══════════════════════════════════════════ */
async function startCamera() {
  setStatus('Requesting camera…', false);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width:480, height:360, facingMode:'user' }
    });
  } catch (_) {
    setStatus('Camera denied', false);
    return false;
  }
  const vid    = document.getElementById('webcam');
  const camVid = document.getElementById('cam-vid');
  const camBox = document.getElementById('cam-preview');
  vid.srcObject = stream; camVid.srcObject = stream;
  await vid.play();
  camBox.classList.remove('hidden');
  setStatus('Loading model…', false);

  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });
  hands.setOptions({
    maxNumHands:2, modelComplexity:0,
    minDetectionConfidence:0.65, minTrackingConfidence:0.50,
  });
  hands.onResults(res => {
    const lms = res.multiHandLandmarks;
    if (lms?.length > 0) {
      S.handOn = true; S.lastHand = Date.now();

      /* primary hand: gesture + index tip */
      const lm0 = lms[0];
      const { gesture, openRatio: ratio0, indexTip, palmPos: palm0, extN } = detectGesture(lm0);

      /* second hand: only bloom (no gesture override) */
      let avgRatio = ratio0;
      let avgPalm  = palm0;
      if (lms.length > 1) {
        const { openRatio: ratio1, palmPos: palm1 } = detectGesture(lms[1]);
        avgRatio = (ratio0 + ratio1) / 2;
        avgPalm  = { x: (palm0.x + palm1.x) / 2, y: (palm0.y + palm1.y) / 2 };
      }

      smoothedOpen += (avgRatio - smoothedOpen) * 0.42;

      G.prevGesture = G.gesture;
      G.gesture     = gesture;
      G.indexTip    = indexTip;
      G.palmPos     = avgPalm;

      if (G.gesture !== G.prevGesture) handleGestureChange(gesture);

      /* rock: only cycle color after holding 600ms + 3.5s global cooldown */
      if (gesture === 'rock') {
        if (!G.rockHeldSince) G.rockHeldSince = Date.now();
        if (Date.now() - G.rockHeldSince > 600 && Date.now() - G.lastRock > 3500) {
          G.colorMode    = (G.colorMode + 1) % COLOR_ANGLES.length;
          G.lastRock     = Date.now();
          G.rockHeldSince = 0;
        }
      } else {
        G.rockHeldSince = 0;
      }

      prevExtN = extN;

      /* bloom target: fist→0, open→1, others proportional */
      if      (gesture === 'fist')     setTarget(0);
      else if (gesture === 'open')     setTarget(1);
      else if (gesture !== 'thumbsup') setTarget(smoothedOpen);

      drawSkeleton(lm0);
      drawCamSkeleton(lms);
    } else {
      if (Date.now() - S.lastHand > 1800) {
        S.handOn = false; setTarget(0.12);
        G.gesture = 'neutral'; G.gestLabel = '';
        G.indexTip = null; G.palmPos = null;
      }
      drawSkeleton(null);
      drawCamSkeleton([]);
    }
    refreshStatus();
  });

  S.tracking=true; S.mode='camera';
  setStatus('Tracking hand', true);
  updateModeUI('camera');

  let smoothedOpen = 0.12;
  let prevExtN = 0;
  let ok=false;
  let _mpTick = 0;
  try {
    if (typeof Camera !== 'undefined') {
      new Camera(vid, {
        onFrame: async() => { _mpTick++; if (_mpTick % 2 === 0) await hands.send({image:vid}); },
        width:480, height:360,
      }).start(); ok=true;
    }
  } catch(_){}
  if (!ok) {
    (async function mpLoop(){
      _mpTick++;
      if(vid.readyState>=2 && _mpTick % 2 === 0) await hands.send({image:vid});
      requestAnimationFrame(mpLoop);
    })();
  }
  return true;
}

/* ═══════════════════════════════════════════
   MOUSE FALLBACK
   Hold = wither (0) · Release = bloom (1)
═══════════════════════════════════════════ */
let mouseListenersAdded = false;

function enableMouse() {
  S.mode = 'mouse';
  setStatus('Hold to wither · Release to bloom', false);
  updateModeUI('mouse');

  if (mouseListenersAdded) return;
  mouseListenersAdded = true;

  const skip = e => e.target.closest('button, a');

  document.addEventListener('mousedown', e => {
    if (skip(e) || S.mode !== 'mouse') return;
    S.mouseHeld = true;
    setTarget(0);
    showHoldIndicator(true);
  });
  document.addEventListener('mouseup', () => {
    if (S.mode !== 'mouse') return;
    S.mouseHeld = false;
    setTarget(1);
    showHoldIndicator(false);
  });
  document.addEventListener('touchstart', e => {
    if (skip(e) || S.mode !== 'mouse') return;
    S.mouseHeld = true;
    setTarget(0);
    showHoldIndicator(true);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (S.mode !== 'mouse') return;
    S.mouseHeld = false;
    setTarget(1);
    showHoldIndicator(false);
  });
}

function showHoldIndicator(on) {
  const el = document.getElementById('hold-indicator');
  if (el) el.classList.toggle('on', on);
}

function updateModeUI(mode) {
  document.getElementById('mode-cam').classList.toggle('active-mode', mode==='camera');
  document.getElementById('mode-mouse').classList.toggle('active-mode', mode==='mouse');
  const guide = document.getElementById('guide-ko');
  if (guide) {
    if (mode === 'mouse') {
      guide.innerHTML = '꾹 누르면 꽃이 지고<br>손을 떼면 꽃이 핍니다.';
    } else {
      guide.innerHTML = '손을 펼치면 꽃이 피고<br>손을 쥐면 꽃이 집니다.';
    }
  }
}

/* ═══════════════════════════════════════════
   STATUS UI
═══════════════════════════════════════════ */
function setStatus(msg, on) {
  const tl = document.getElementById('t-label');
  const td = document.getElementById('t-dot');
  const tu = document.getElementById('tracking-ui');
  if (tl) tl.textContent = msg;
  if (td) td.classList.toggle('on', on);
  if (tu) tu.classList.toggle('tracking', on);
}

function refreshStatus() {
  if (!S.tracking) return;
  const o = S.bloom;
  if (S.handOn) {
    if (o > 0.65)       setStatus('Open — Blooming', true);
    else if (o < 0.3)   setStatus('Closed — Withering', true);
    else                setStatus('Hand detected', true);
    setVideoStatus(o > 0.65 ? 'Blooming ✦' : o < 0.3 ? 'Withering' : 'Hand detected', true);
  } else {
    setStatus('No hand in view', false);
    setVideoStatus('손을 화면에 보여주세요', false);
  }
}

/* ═══════════════════════════════════════════
   BLOOM PROGRESS BAR
═══════════════════════════════════════════ */
function updateBloomBar() {
  const fill = document.getElementById('bloom-bar-fill');
  if (fill) fill.style.height = (S.bloom * 100).toFixed(1) + '%';
}

function updateVidBloomBar() {
  const fill = document.getElementById('vb-fill');
  if (fill) fill.style.height = (S.bloom * 100).toFixed(1) + '%';
}

function setVideoStatus(msg, on) {
  const lbl = document.getElementById('vst-label');
  const dot = document.getElementById('vst-dot');
  if (lbl) lbl.textContent = msg;
  if (dot) dot.classList.toggle('on', on);
}

/* ═══════════════════════════════════════════
   STAGE MACHINE
═══════════════════════════════════════════ */
const stages = {
  video:    document.getElementById('st-video'),
  intro:    document.getElementById('st-intro'),
  guide:    document.getElementById('st-guide'),
  interact: document.getElementById('st-interact'),
  end:      document.getElementById('st-end'),
  gestures: document.getElementById('st-gestures'),
};

function goTo(name) {
  S.prevStage = S.stage;
  S.stage = name;
  Object.entries(stages).forEach(([k,el]) => el.classList.toggle('active', k===name));
  flowerVid.classList.toggle('visible', name === 'video');
  if (name === 'video') flowerVid.pause();
  /* reset color/gesture effects when leaving interact */
  if (S.prevStage === 'interact' && name !== 'interact') {
    G.colorMode = 0; G.colorAngle = 0; cv.style.filter = '';
  }
}

let guideTimer;
function scheduleGuideHide() {
  clearTimeout(guideTimer);
  guideTimer = setTimeout(() => {
    const go = document.getElementById('guide-overlay');
    if (go) go.classList.add('hidden');
  }, 7000);
}

/* ═══════════════════════════════════════════
   CURSOR
═══════════════════════════════════════════ */
const curEl = document.getElementById('cursor');
let rawX=0, rawY=0, cxC=0, cyC=0, cReady=false;

document.addEventListener('mousemove', e => {
  rawX=e.clientX; rawY=e.clientY;
  vidMouseX = e.clientX / window.innerWidth;
  if (!cReady) {
    cxC=rawX; cyC=rawY;
    curEl.style.left=cxC+'px'; curEl.style.top=cyC+'px';
    curEl.classList.add('ready'); cReady=true;
  }
});

/* touch → video scrub & mouse-mode bloom */
document.addEventListener('touchstart', e => {
  if (e.touches.length > 0) vidMouseX = e.touches[0].clientX / window.innerWidth;
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (e.touches.length > 0) vidMouseX = e.touches[0].clientX / window.innerWidth;
}, { passive: true });

function tickCursor() {
  cxC += (rawX-cxC) * 0.22;
  cyC += (rawY-cyC) * 0.22;
  curEl.style.left = cxC+'px';
  curEl.style.top  = cyC+'px';
}

document.querySelectorAll('button,a').forEach(el => {
  el.addEventListener('mouseenter', ()=>document.body.classList.add('hovering'));
  el.addEventListener('mouseleave', ()=>document.body.classList.remove('hovering'));
});

/* ═══════════════════════════════════════════
   RENDERER MANAGEMENT
═══════════════════════════════════════════ */
const renderers = [
  new FlowerRenderer(),
  new LotusRenderer(),
  new CrystalRenderer(),
  new DandelionRenderer(),
];
const RENDERER_NAMES = ['Peony', 'Lotus', 'Crystal', 'Dandelion'];
let activeRendererIdx = 0;

function cycleRenderer(idx) {
  activeRendererIdx = ((idx % renderers.length) + renderers.length) % renderers.length;
  document.querySelectorAll('.obj-btn').forEach((b, i) =>
    b.classList.toggle('active', i === activeRendererIdx));
  petals = [];
}

/* ═══════════════════════════════════════════
   MAIN LOOP
═══════════════════════════════════════════ */

function loop(now) {
  requestAnimationFrame(loop);
  /* mobile fps cap */
  if (FRAME_MS > 0 && now - _lastFrameT < FRAME_MS) return;
  _lastFrameT = now;
  S.frame++;

  /* gesture: pinch → slow time, thumbsup → hold full bloom */
  if (G.gesture === 'pinch') {
    G.timeScale = Math.max(0.10, G.timeScale - 0.055);
  } else {
    G.timeScale = Math.min(1.0, G.timeScale + 0.09);
  }
  if (G.gesture === 'thumbsup') setTarget(1);

  /* color mode lerp */
  G.colorAngle += (COLOR_ANGLES[G.colorMode] - G.colorAngle) * 0.035;
  const _newFilter = Math.abs(G.colorAngle) > 0.5 ? `hue-rotate(${G.colorAngle.toFixed(1)}deg)` : '';
  if (_newFilter !== _lastFilterStr) { cv.style.filter = _newFilter; _lastFilterStr = _newFilter; }

  /* parallax: palm position offsets flower center (smoothed) */
  if (G.palmPos && S.handOn) {
    const tx = ((0.5 - G.palmPos.x)) * cv.width  * 0.10;
    const ty = ((G.palmPos.y - 0.5)) * cv.height * 0.10;
    G.parallaxX += (tx - G.parallaxX) * 0.06;
    G.parallaxY += (ty - G.parallaxY) * 0.06;
  } else {
    G.parallaxX *= 0.92;
    G.parallaxY *= 0.92;
  }

  /* directional lerp: faster wither than bloom, scaled by timeScale */
  const speed  = (S.target < S.bloom ? 0.065 : 0.038) * G.timeScale;
  S.bloom     += (S.target - S.bloom) * speed;

  /* video stage: mouse X scrub (when no camera) */
  if (S.stage === 'video' && S.mode !== 'camera') setTarget(vidMouseX);

  /* hand timeout → ambient */
  if (S.tracking && S.handOn && Date.now()-S.lastHand > 2000) {
    S.handOn=false; setTarget(0.12); refreshStatus();
  }

  const withering = S.bloom < S.prevBloom - 0.003;

  /* burst on open threshold */
  if (S.bloom > 0.72 && S.prevBloom <= 0.72 && petals.length < MAX_P-25) {
    spawnPetals(24, true);
  }

  /* burst of falling petals when withering starts */
  if (withering && S.prevBloom > 0.5 && S.bloom < 0.5 && petals.length < MAX_P-30) {
    spawnPetals(18, false);
  }

  S.prevBloom = S.bloom;
  setCSS();

  /* scrub flower video in video stage */
  if (S.stage === 'video' && flowerVid && flowerVid.readyState >= 1 && flowerVid.duration) {
    flowerVid.currentTime = S.bloom * flowerVid.duration;
    updateVidBloomBar();
  }

  /* render flower only when canvas is visible:
     interact = transparent bg, end = 0.75 overlay (canvas shows through) */
  const onInteract   = S.stage === 'interact';
  const canvasVisible = onInteract || S.stage === 'end';
  if (canvasVisible) {
    renderers[activeRendererIdx].render(S.bloom);
  } else if (S.stage !== 'video') {
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, cv.width, cv.height);
  }

  /* petal particles */
  if (onInteract) {
    const rate = Math.ceil(S.bloom * 3 + 0.4);
    if (S.frame % Math.max(1, 7-rate) === 0) {
      spawnPetals(rate, S.bloom > 0.18);
    }
    /* extra falling petals while actively withering */
    if (withering && S.frame % 4 === 0 && petals.length < MAX_P) {
      spawnPetals(2, false);
    }
  }

  if (onInteract) {
    petals = petals.filter(p=>p.active);
    petals.sort((a,b)=>a.depth-b.depth);
    petals.forEach(p => { p.update(S.bloom, withering); p.draw(); });
  }

  updateBloomBar();

  /* gesture indicator visibility */
  const gi = document.getElementById('gest-indicator');
  const gl = document.getElementById('gest-label');
  const showGI = !!G.gestLabel && S.handOn && S.stage === 'interact';
  if (gi) gi.classList.toggle('on', showGI);
  if (gl && gl.textContent !== G.gestLabel) gl.textContent = G.gestLabel;

  /* lm-canvas: always on for spotlight, otherwise follow skeleton toggle */
  lc.classList.toggle('on', G.gesture === 'point' && S.handOn);

  tickCursor();
}

/* ═══════════════════════════════════════════
   BUTTON EVENTS
═══════════════════════════════════════════ */
function bindButtons() {
  document.getElementById('btn-begin').addEventListener('click', () => goTo('guide'));

  document.getElementById('btn-allow').addEventListener('click', async () => {
    const ok = await startCamera();
    goTo('interact'); setTarget(0.3); scheduleGuideHide();
    if (!ok) enableMouse();
  });

  document.getElementById('btn-skip').addEventListener('click', () => {
    enableMouse(); goTo('interact'); setTarget(0.3); scheduleGuideHide();
  });

  document.getElementById('btn-end').addEventListener('click', () => {
    setTarget(0);
    setTimeout(() => goTo('end'), 1100);
  });

  document.getElementById('btn-skel').addEventListener('click', () => {
    const box = document.getElementById('cam-preview');
    if (box) box.classList.toggle('hidden');
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    setTarget(0.12); goTo('video');
  });

  document.getElementById('btn-vid-cam').addEventListener('click', async () => {
    const btn = document.getElementById('btn-vid-cam');
    btn.textContent = 'Connecting…';
    setVideoStatus('카메라 요청 중…', false);
    const ok = await startCamera();
    if (ok) {
      btn.textContent = '● Camera Active';
      btn.classList.add('cam-on');
      setVideoStatus('Open your hand', true);
    } else {
      btn.textContent = 'Allow Camera →';
      setVideoStatus('카메라 거부 · 마우스로 체험하세요', false);
    }
  });

  document.getElementById('btn-vid-canvas').addEventListener('click', () => {
    if (S.tracking) {
      goTo('interact'); setTarget(0.3); scheduleGuideHide();
    } else {
      goTo('guide');
    }
  });

  ['btn-vid-cam', 'btn-vid-canvas', 'btn-vid-guide'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mouseenter', () => document.body.classList.add('hovering'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('hovering'));
  });

  document.getElementById('btn-vid-guide').addEventListener('click', () => goTo('gestures'));

  document.getElementById('btn-guide').addEventListener('click', () => goTo('gestures'));
  document.getElementById('btn-guide').addEventListener('mouseenter', () => document.body.classList.add('hovering'));
  document.getElementById('btn-guide').addEventListener('mouseleave', () => document.body.classList.remove('hovering'));

  document.getElementById('btn-gg-back').addEventListener('click', () => {
    goTo(S.prevStage === 'gestures' ? 'video' : S.prevStage);
  });
  document.getElementById('btn-gg-back').addEventListener('mouseenter', () => document.body.classList.add('hovering'));
  document.getElementById('btn-gg-back').addEventListener('mouseleave', () => document.body.classList.remove('hovering'));

  document.getElementById('mode-cam').addEventListener('click', async () => {
    if (S.mode !== 'camera') { const ok=await startCamera(); if(!ok) enableMouse(); }
  });
  document.getElementById('mode-mouse').addEventListener('click', () => {
    if (S.mode !== 'mouse') enableMouse();
  });

  /* bind object-selector buttons */
  document.querySelectorAll('.obj-btn').forEach(btn => {
    const i = parseInt(btn.getAttribute('data-idx'), 10);
    btn.addEventListener('click', () => cycleRenderer(i));
    btn.addEventListener('mouseenter', () => document.body.classList.add('hovering'));
    btn.addEventListener('mouseleave', () => document.body.classList.remove('hovering'));
  });
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
const ldEl   = document.getElementById('loading');
const ldFill = document.getElementById('ld-fill');
const ldMsg  = document.getElementById('ld-msg');

function setLoad(pct, msg) {
  if (ldFill) ldFill.style.width = pct + '%';
  if (msg && ldMsg) ldMsg.textContent = msg;
}

window.addEventListener('load', () => {
  setLoad(50, 'Building');
  bindButtons();
  goTo('video');
  setLoad(100, 'Ready');

  setTimeout(() => {
    if (ldEl) {
      ldEl.style.transition = 'opacity 1s, visibility 1s';
      ldEl.style.opacity    = '0';
      ldEl.style.visibility = 'hidden';
      setTimeout(() => ldEl.remove(), 1000);
    }
    loop();
  }, 500);
});
