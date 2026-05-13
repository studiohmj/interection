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
  mouseHue:     0,
};

const setTarget = v => { S.target = Math.max(0, Math.min(1, v)); };

let _lastBloomCSS = '';
const setCSS = () => {
  const s = S.bloom.toFixed(3);
  if (s !== _lastBloomCSS) { document.documentElement.style.setProperty('--bloom', s); _lastBloomCSS = s; }
};

/* pointer:coarse = finger/touch primary input (not mouse). More reliable than
   maxTouchPoints which is > 0 on Windows even without a touchscreen display. */
const isMobile  = window.matchMedia('(pointer: coarse)').matches;
let FRAME_MS  = isMobile ? 34 : 16;  // 30fps mobile; raised to 34 when camera active on desktop
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
let vidMouseX    = 0;
let _lastVidBloom = -1;   // throttle video seek
let _lastSeekT    = 0;    // time-gate: max ~10 seeks/s

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
          dropPh: Math.random() * Math.PI * 2,
        });
      }
    });
    /* pre-sort outer→inner so render() doesn't sort every frame */
    return petals.sort((a, b) => a.li - b.li);
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

    /* ── petals outer → inner (pre-sorted in constructor) ── */
    this.petals.forEach(p => this._petal(p, bloom, cx, cy));

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

    /* gradient: 3-stop (5-stop was too heavy per frame) */
    const gr = ctx.createLinearGradient(0, -len * 0.18, 0, len);
    gr.addColorStop(0,   `hsl(${p.hue+7}, ${sat*.6}%, ${Lmid-14}%)`);
    gr.addColorStop(0.5, `hsl(${p.hue},   ${sat}%,    ${Lmid}%)`);
    gr.addColorStop(1,   `hsl(${p.hue-7}, ${sat*.5}%, ${Ltip}%)`);

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
    return out.sort((a,b)=>a.li-b.li);
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

    this.petals.forEach(p=>this._petal(p, bloom, cx, cy));
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
    gr.addColorStop(0,   `hsl(${p.hue+8}, ${sat*0.4}%, 94%)`);
    gr.addColorStop(0.5, `hsl(${p.hue},   ${sat}%,   ${p.Lbase}%)`);
    gr.addColorStop(1,   `hsl(${p.hue-4}, ${sat*1.0}%,${p.Lbase-10}%)`);

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
    return out.sort((a,b)=>a.li-b.li);
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

    this.facets.forEach(f=>this._facet(f, bloom, cx, cy));
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

    const gr = ctx.createLinearGradient(-sz, 0, sz, sz*1.2);
    gr.addColorStop(0,   `hsl(${hue+18},${sat}%,${L+28}%)`);
    gr.addColorStop(0.5, `hsl(${hue},   ${sat}%,${L}%)`);
    gr.addColorStop(1,   `hsl(${hue-18},${sat*.75}%,${L-10}%)`);
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
    /* pre-sort back→front by z3d (positive curR keeps order stable) */
    return out.sort((a,b) => a.z3d - b.z3d);
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
    /* use pre-sorted seeds (no spread/sort every frame) */
    this.seeds.forEach(s => this._seed(s, bloom, cx, cy, curR));
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
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.stroke();

    /* starburst tip — 6 rays (was 10, too heavy × 48 seeds) */
    ctx.translate(px, py);
    ctx.strokeStyle = `hsl(${s.hue},65%,80%)`;
    ctx.lineWidth   = 0.4*sc;
    for (let i=0; i<6; i++) {
      const ang = (i/6)*Math.PI*2;
      const rl  = i%2===0 ? sz : sz*0.55;
      ctx.beginPath();
      ctx.moveTo(0,0);
      ctx.lineTo(Math.cos(ang)*rl, Math.sin(ang)*rl);
      ctx.stroke();
    }
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
   BASE PETAL RENDERER  (Rose)
═══════════════════════════════════════════ */
class BasePetalRenderer {
  constructor(layers, glowHue, centerHue, delays) {
    this.t=0; this.witherOffset=0; this.prevRenderBloom=0;
    this._gh=glowHue; this._ch=centerHue;
    this._del=delays||layers.map((_,i)=>i*0.10);
    this.petals=this._build(layers);
  }
  _build(layers){
    const out=[];
    layers.forEach(({li,n,r,len,w,hb,hv,Lb,Ld})=>{
      for(let i=0;i<n;i++) out.push({
        li, maxR:r, len, w, angle:(i/n)*Math.PI*2+li*0.35,
        hue:hb+(Math.random()-0.5)*hv,
        Lbase:Lb+(Math.random()-0.5)*4, Ltip:Lb+Ld+(Math.random()-0.5)*5,
        ph:Math.random()*Math.PI*2, dropPh:Math.random()*Math.PI*2
      });
    });
    return out.sort((a,b)=>a.li-b.li);
  }
  _lb(p,bloom){const d=this._del[p.li]??0;return Math.min(1,Math.max(0,(bloom-d)/(1.001-d)));}
  render(bloom){
    this.t++;
    const W=cv.width,H=cv.height,cx=W/2+G.parallaxX,cy=H/2+G.parallaxY;
    const withering=bloom<this.prevRenderBloom-0.002;
    this.witherOffset+=withering?Math.min(0.04,(this.prevRenderBloom-bloom)*1.1):-this.witherOffset*0.06;
    this.witherOffset=Math.max(0,Math.min(Math.PI*0.25,this.witherOffset));
    this.prevRenderBloom=bloom;
    ctx.fillStyle='#050506'; ctx.fillRect(0,0,W,H);
    if(bloom>0.04){
      const g=ctx.createRadialGradient(cx,cy,0,cx,cy,W*0.42);
      g.addColorStop(0,  `hsla(${this._gh},75%,52%,${(bloom*0.13).toFixed(3)})`);
      g.addColorStop(0.45,`hsla(${this._gh+15},50%,28%,${(bloom*0.05).toFixed(3)})`);
      g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    }
    this.petals.forEach(p=>this._petal(p,bloom,cx,cy));
    this._stamen(bloom,cx,cy);
    const v=ctx.createRadialGradient(cx,cy,W*0.22,cx,cy,W*0.74);
    v.addColorStop(0,'transparent'); v.addColorStop(1,'rgba(0,0,0,0.70)');
    ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
  }
  _petal(p,bloom,cx,cy){
    const b=this._lb(p,bloom); if(b<0.005)return;
    const breathe=1+Math.sin(this.t*0.013+p.ph)*0.013*b;
    const droop=this.witherOffset*(1+p.li*0.3)*Math.sin(p.dropPh+p.angle);
    const fa=p.angle+droop, r=p.maxR*(0.05+b*0.95);
    const px=cx+Math.cos(fa)*r, py=cy+Math.sin(fa)*r;
    const sc=(0.03+b*0.97)*breathe, len=p.len, hw=len*p.w;
    const sat=(15+b*72)*(0.3+bloom*0.7);
    ctx.save();
    ctx.translate(px,py); ctx.rotate(fa+Math.PI/2); ctx.scale(sc,sc);
    ctx.globalAlpha=0.04+b*0.96;
    const gr=ctx.createLinearGradient(0,-len*0.18,0,len);
    gr.addColorStop(0,  `hsl(${p.hue+7},${(sat*.6).toFixed(1)}%,${p.Lbase-14}%)`);
    gr.addColorStop(0.5,`hsl(${p.hue},  ${sat.toFixed(1)}%,     ${p.Lbase}%)`);
    gr.addColorStop(1,  `hsl(${p.hue-7},${(sat*.5).toFixed(1)}%,${p.Ltip}%)`);
    ctx.fillStyle=gr;
    ctx.beginPath(); ctx.moveTo(0,-len*0.14);
    ctx.bezierCurveTo(hw*1.05,-len*0.06,hw*1.1,len*0.55,0,len);
    ctx.bezierCurveTo(-hw*1.1,len*0.55,-hw*1.05,-len*0.06,0,-len*0.14);
    ctx.fill(); ctx.restore();
  }
  _stamen(bloom,cx,cy){
    if(bloom<0.04)return;
    const b=Math.min(1,bloom*1.4), r=3+bloom*16;
    ctx.save(); ctx.globalAlpha=0.3+b*0.7;
    ctx.shadowColor=`hsl(${this._ch},80%,62%)`; ctx.shadowBlur=22*b;
    const cg=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
    cg.addColorStop(0,`hsl(${this._ch},${(22+b*58).toFixed(0)}%,${(30+b*22).toFixed(0)}%)`);
    cg.addColorStop(1,`hsl(${this._ch},${(16+b*48).toFixed(0)}%,${(18+b*16).toFixed(0)}%)`);
    ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

/* Rose — deep crimson, dense petals */
class RoseRenderer extends BasePetalRenderer {
  constructor(){super([
    {li:0,n:12,r:215,len:88,w:.38,hb:4, hv:7, Lb:36,Ld:30},
    {li:1,n:8, r:136,len:68,w:.43,hb:6, hv:5, Lb:42,Ld:24},
    {li:2,n:5, r:64, len:46,w:.50,hb:8, hv:4, Lb:47,Ld:18},
  ],5,5,[0,.08,.18]);}
}

/* ── JELLYFISH ── translucent bell + tentacles */
class JellyfishRenderer {
  constructor() {
    this.t=0; this.witherOffset=0; this.prevRenderBloom=0;
    const tCount = isMobile ? 8 : 14;
    this.tentacles = Array.from({length:tCount},(_,i)=>({
      angle:(i/tCount)*Math.PI*2, phase:Math.random()*Math.PI*2,
      lenM:0.65+Math.random()*0.70, thick:0.9+Math.random()*1.1,
      hue:188+(Math.random()-0.5)*30, freq:0.018+Math.random()*0.014,
    }));
  }
  render(bloom) {
    this.t++;
    const W=cv.width,H=cv.height,cx=W/2+G.parallaxX,cy=H/2+G.parallaxY;
    const withering=bloom<this.prevRenderBloom-0.002;
    this.witherOffset+=withering?Math.min(0.04,(this.prevRenderBloom-bloom)*1.2):-this.witherOffset*0.06;
    this.witherOffset=Math.max(0,Math.min(0.55,this.witherOffset));
    this.prevRenderBloom=bloom;
    ctx.fillStyle='#050506'; ctx.fillRect(0,0,W,H);
    if(bloom<0.01)return;
    const bR=bloom*155, bH=bR*0.52;
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,bR*2.8);
    g.addColorStop(0,`rgba(60,200,255,${bloom*0.11})`);
    g.addColorStop(0.5,`rgba(20,100,220,${bloom*0.04})`);
    g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    // tentacles
    const tLen=bloom*200*(1+this.witherOffset*0.8);
    this.tentacles.forEach(t=>{
      const rx=cx+Math.cos(t.angle)*bR*0.82, ry=cy+bH*0.78;
      const wx=Math.sin(this.t*t.freq+t.phase)*16*bloom;
      const len=tLen*t.lenM;
      ctx.save();
      ctx.globalAlpha=0.3+bloom*0.45;
      ctx.strokeStyle=`hsla(${t.hue},72%,74%,0.85)`;
      ctx.lineWidth=t.thick*bloom;
      ctx.shadowColor=`hsl(${t.hue},85%,78%)`; ctx.shadowBlur=isMobile?0:5; ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(rx,ry);
      ctx.bezierCurveTo(rx+wx*0.5,ry+len*0.28,rx+wx*(-0.6),ry+len*0.62,rx+wx*0.3,ry+len);
      ctx.stroke(); ctx.restore();
    });
    // bell
    ctx.save();
    const bg=ctx.createRadialGradient(cx,cy-bH*0.18,bR*0.05,cx,cy,bR*1.1);
    bg.addColorStop(0,`rgba(160,230,255,${bloom*0.42})`);
    bg.addColorStop(0.45,`rgba(55,150,245,${bloom*0.24})`);
    bg.addColorStop(0.82,`rgba(18,75,200,${bloom*0.10})`);
    bg.addColorStop(1,'rgba(8,30,120,0)');
    ctx.globalAlpha=0.88; ctx.fillStyle=bg;
    ctx.shadowColor='rgba(80,200,255,0.55)'; ctx.shadowBlur=28*bloom;
    ctx.beginPath(); ctx.moveTo(cx-bR,cy);
    ctx.ellipse(cx,cy,bR,bH,0,Math.PI,0,true);
    ctx.bezierCurveTo(cx+bR*0.65,cy+bH*0.32,cx-bR*0.65,cy+bH*0.32,cx-bR,cy);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha=bloom*0.65;
    ctx.strokeStyle='rgba(175,235,255,0.8)'; ctx.lineWidth=1.6; ctx.shadowBlur=16;
    ctx.beginPath(); ctx.ellipse(cx,cy,bR,bH,0,Math.PI,0,true); ctx.stroke();
    if(bloom>0.35){
      const rA=Math.min(1,(bloom-0.35)*1.8);
      for(let i=1;i<=3;i++){
        ctx.globalAlpha=rA*0.16; ctx.strokeStyle='rgba(195,240,255,0.7)';
        ctx.lineWidth=0.65; ctx.shadowBlur=5;
        ctx.beginPath();
        ctx.ellipse(cx,cy-bH*0.08,bR*(0.28+i*0.22),bH*(0.28+i*0.22)*0.58,0,Math.PI,0,true);
        ctx.stroke();
      }
    }
    ctx.restore();
    const cg=ctx.createRadialGradient(cx,cy-bH*0.28,0,cx,cy-bH*0.28,bR*0.42);
    cg.addColorStop(0,`rgba(205,248,255,${bloom*0.58})`);
    cg.addColorStop(0.6,`rgba(70,180,255,${bloom*0.14})`);
    cg.addColorStop(1,'rgba(20,90,200,0)');
    ctx.save(); ctx.globalAlpha=0.78; ctx.fillStyle=cg;
    ctx.beginPath(); ctx.ellipse(cx,cy-bH*0.28,bR*0.42,bH*0.32,0,0,Math.PI*2); ctx.fill();
    ctx.restore();
    const v=ctx.createRadialGradient(cx,cy,W*0.22,cx,cy,W*0.74);
    v.addColorStop(0,'transparent'); v.addColorStop(1,'rgba(0,0,0,0.72)');
    ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
  }
}

/* ── SNOWFLAKE ── 6-fold crystalline arms */
class SnowflakeRenderer {
  constructor() {
    this.t=0; this.witherOffset=0; this.prevRenderBloom=0;
    this.subPos=[0.27,0.48,0.67,0.84];
    this.subLen=[0.52,0.44,0.36,0.28];
  }
  render(bloom) {
    this.t++;
    const W=cv.width,H=cv.height,cx=W/2+G.parallaxX,cy=H/2+G.parallaxY;
    const withering=bloom<this.prevRenderBloom-0.002;
    this.witherOffset+=withering?Math.min(0.03,(this.prevRenderBloom-bloom)*0.9):-this.witherOffset*0.08;
    this.witherOffset=Math.max(0,Math.min(0.5,this.witherOffset));
    this.prevRenderBloom=bloom;
    ctx.fillStyle='#050506'; ctx.fillRect(0,0,W,H);
    if(bloom<0.01)return;
    const maxLen=Math.min(W,H)*0.37;
    const armLen=bloom*maxLen*(1-this.witherOffset*0.65);
    const rot=this.t*0.0038;
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,maxLen);
    g.addColorStop(0,`rgba(160,215,255,${bloom*0.10})`);
    g.addColorStop(0.5,`rgba(80,155,245,${bloom*0.04})`);
    g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(rot);
    for(let i=0;i<6;i++){
      ctx.save(); ctx.rotate((i/6)*Math.PI*2); this._arm(armLen,bloom); ctx.restore();
    }
    ctx.restore();
    const cr=5+bloom*15;
    ctx.save(); ctx.globalAlpha=0.55+bloom*0.45;
    ctx.shadowColor='rgba(200,235,255,1)'; ctx.shadowBlur=28*bloom;
    const cg=ctx.createRadialGradient(cx,cy,0,cx,cy,cr);
    cg.addColorStop(0,'rgba(242,252,255,1)'); cg.addColorStop(0.55,'rgba(165,215,255,0.85)');
    cg.addColorStop(1,'rgba(80,155,255,0.2)');
    ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.fill(); ctx.restore();
    const v=ctx.createRadialGradient(cx,cy,W*0.2,cx,cy,W*0.72);
    v.addColorStop(0,'transparent'); v.addColorStop(1,'rgba(0,0,0,0.72)');
    ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
  }
  _arm(len,bloom) {
    if(len<2)return;
    const blurMain = isMobile ? 0 : 8+bloom*12;
    const blurSub  = isMobile ? 0 : 5;
    ctx.globalAlpha=0.82+bloom*0.18;
    ctx.strokeStyle='rgba(205,235,255,0.92)';
    ctx.lineWidth=1.5+bloom*1.5;
    ctx.shadowColor='rgba(170,220,255,0.85)'; ctx.shadowBlur=blurMain; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(len,0); ctx.stroke();
    ctx.globalAlpha=0.7+bloom*0.3; ctx.shadowBlur=isMobile?0:14*bloom;
    ctx.fillStyle='rgba(225,245,255,0.92)';
    ctx.beginPath(); ctx.arc(len,0,2+bloom*3.2,0,Math.PI*2); ctx.fill();
    if(bloom>0.16){
      const sA=Math.min(1,(bloom-0.16)*2.6);
      this.subPos.forEach((sp,si)=>{
        const bx=sp*len, sLen=len*this.subLen[si]*sA;
        if(sLen<1)return;
        [-1,1].forEach(side=>{
          ctx.save(); ctx.translate(bx,0); ctx.rotate(side*Math.PI/3);
          ctx.globalAlpha=sA*0.72; ctx.lineWidth=1.0+bloom*0.85; ctx.shadowBlur=blurSub;
          ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(sLen,0); ctx.stroke();
          if(!isMobile && bloom>0.58){
            const tA=Math.min(1,(bloom-0.58)*2.4), tLen=sLen*0.42*tA;
            [-1,1].forEach(ts=>{
              ctx.save(); ctx.translate(sLen*0.52,0); ctx.rotate(ts*Math.PI/3);
              ctx.globalAlpha=tA*0.48; ctx.lineWidth=0.7; ctx.shadowBlur=0;
              ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(tLen,0); ctx.stroke();
              ctx.restore();
            });
          }
          ctx.restore();
        });
      });
    }
  }
}

/* ── ORBIT ── atom with tilted electron rings */
class OrbitRenderer {
  constructor() {
    this.t=0; this.witherOffset=0; this.prevRenderBloom=0;
    this.rings=[
      {n:2,r:78, speed:0.024,tilt:0,            col:[255,218,80]},
      {n:3,r:138,speed:0.016,tilt:Math.PI/2.8,  col:[80,210,255]},
      {n:4,r:192,speed:0.011,tilt:Math.PI*2/3,  col:[180,100,255]},
    ];
  }
  render(bloom) {
    this.t++;
    const W=cv.width,H=cv.height,cx=W/2+G.parallaxX,cy=H/2+G.parallaxY;
    const withering=bloom<this.prevRenderBloom-0.002;
    this.witherOffset+=withering?Math.min(0.03,(this.prevRenderBloom-bloom)*1.0):-this.witherOffset*0.07;
    this.witherOffset=Math.max(0,Math.min(0.5,this.witherOffset));
    this.prevRenderBloom=bloom;
    ctx.fillStyle='#050506'; ctx.fillRect(0,0,W,H);
    if(bloom<0.01)return;
    const g=ctx.createRadialGradient(cx,cy,0,cx,cy,260);
    g.addColorStop(0,`rgba(255,200,60,${bloom*0.10})`);
    g.addColorStop(0.5,`rgba(160,80,255,${bloom*0.04})`);
    g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    const thresh=[0,0.33,0.68], sc=1-this.witherOffset*0.6;
    this.rings.forEach((ring,ri)=>{
      if(bloom<thresh[ri]+0.02)return;
      const rA=Math.min(1,(bloom-thresh[ri])*3.5);
      const r=ring.r*sc*Math.min(1,rA*1.6);
      const [rr,gg,bb]=ring.col;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(ring.tilt);
      ctx.shadowBlur=0;   /* 링 outline은 blur 없음 */
      ctx.globalAlpha=rA*0.28;
      ctx.strokeStyle=`rgba(${rr},${gg},${bb},0.6)`;
      ctx.lineWidth=0.85;
      ctx.shadowColor=`rgba(${rr},${gg},${bb},0.5)`;
      ctx.beginPath(); ctx.ellipse(0,0,r,r*0.42,0,0,Math.PI*2); ctx.stroke();
      for(let e=0;e<ring.n;e++){
        const ang=(e/ring.n)*Math.PI*2+this.t*ring.speed;
        const ex=Math.cos(ang)*r, ey=Math.sin(ang)*r*0.42;
        ctx.shadowBlur=0;
        for(let tr=5;tr>=1;tr--){
          const ta=ang-tr*ring.speed*12;
          const tx=Math.cos(ta)*r, ty=Math.sin(ta)*r*0.42;
          ctx.globalAlpha=rA*(0.055-tr*0.008);
          ctx.fillStyle=`rgba(${rr},${gg},${bb},0.8)`;
          ctx.beginPath(); ctx.arc(tx,ty,(4.5-tr*0.6)*rA,0,Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha=rA*0.92;
        ctx.shadowColor=`rgba(${rr},${gg},${bb},1)`;
        ctx.shadowBlur=isMobile?0:18;
        ctx.fillStyle=`rgba(${rr},${gg},${bb},0.95)`;
        ctx.beginPath(); ctx.arc(ex,ey,4.2*rA,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    });
    const nr=8+bloom*14;
    ctx.save(); ctx.globalAlpha=0.55+bloom*0.45;
    ctx.shadowColor='rgba(255,210,60,1)'; ctx.shadowBlur=38*bloom;
    const cg=ctx.createRadialGradient(cx,cy,0,cx,cy,nr);
    cg.addColorStop(0,`rgba(255,248,200,${0.92+bloom*0.08})`);
    cg.addColorStop(0.4,`rgba(255,175,40,${0.72+bloom*0.18})`);
    cg.addColorStop(1,`rgba(215,70,10,${0.28+bloom*0.28})`);
    ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(cx,cy,nr,0,Math.PI*2); ctx.fill();
    ctx.restore();
    const v=ctx.createRadialGradient(cx,cy,W*0.2,cx,cy,W*0.72);
    v.addColorStop(0,'transparent'); v.addColorStop(1,'rgba(0,0,0,0.72)');
    ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
  }
}

/* ═══════════════════════════════════════════
   FALLING PETAL PARTICLES
═══════════════════════════════════════════ */
const PCLR = [
  '#FF4FA3','#FF74B8','#FB8EC4','#F9A8D4',
  '#FECDD3','#EC4899','#E879A0','#FF6BB5',
];
const MAX_P = isMobile ? 60 : 100;
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
let _camSkelEl = null, _camSkelCtx = null, _camSkelW = 0, _camSkelH = 0;
function drawCamSkeleton(lmArray) {
  if (!_camSkelEl) {
    _camSkelEl = document.getElementById('cam-skel');
    if (!_camSkelEl) return;
    _camSkelCtx = _camSkelEl.getContext('2d');
    const box = _camSkelEl.parentElement;
    _camSkelW = box.offsetWidth; _camSkelH = box.offsetHeight;
    _camSkelEl.width = _camSkelW; _camSkelEl.height = _camSkelH;
  }
  const w = _camSkelW, h = _camSkelH;
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
  thumbsup: 'Thumbs Up — Full Bloom Hold',
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

  /* thumbsup: thumb genuinely pointing UP — 수직 각도 체크로 주먹 오인 방지
     - thumbVertical: 엄지 방향 벡터의 수직 성분 (1.0 = 완전 위쪽)
     - 0.75 이상이어야 인정 (약 41° 이내 수직 정렬 필요) */
  const thumbDY  = lm[2].y - thumbTip.y;  /* 양수 = 위로 향함 */
  const thumbDX  = thumbTip.x - lm[2].x;
  const thumbLen = Math.hypot(thumbDX, thumbDY) + 1e-6;
  const thumbVertical = thumbDY / thumbLen;  /* 수직 성분 */

  const thumbUp = thumbTip.y < thumbIP.y - 0.06
               && thumbTip.y < lm[0].y  - 0.06    /* 손목보다 충분히 위 (강화) */
               && thumbTip.y < lm[9].y  - 0.04    /* 손바닥 중심보다 위 (마진 추가) */
               && thumbVertical > 0.75             /* 수직 방향으로만 인정 */
               && extN === 0;

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
      video: { width:320, height:240, facingMode:'user' }
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
  camVid.play().catch(() => {});
  camBox.classList.remove('hidden');
  setStatus('Loading model…', false);

  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
  });
  hands.setOptions({
    maxNumHands:1, modelComplexity:0,
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

      smoothedOpen += (avgRatio - smoothedOpen) * 0.55;

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
  if (!isMobile) FRAME_MS = 34; /* cap render at 30fps to share CPU with MediaPipe */
  updateModeUI('camera');
  setStatus('Hand tracking active', true);

  let smoothedOpen = 0.12;
  let prevExtN = 0;
  let _lastMpT = 0;
  let _mpBusy  = false;
  /* 시간 기반 스로틀: mobile ~15fps, desktop ~20fps */
  const MP_MS = isMobile ? 80 : 66;

  (async function mpLoop() {
    const now = performance.now();
    if (!_mpBusy && vid.readyState >= 2 && now - _lastMpT >= MP_MS) {
      _lastMpT = now;
      _mpBusy  = true;
      try { await hands.send({ image: vid }); } catch (_) {}
      _mpBusy  = false;
    }
    requestAnimationFrame(mpLoop);
  })();

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
    S.mouseHeldAt = Date.now();
    setTarget(0);
    showHoldIndicator(true);
  });
  document.addEventListener('mouseup', () => {
    if (S.mode !== 'mouse') return;
    const wasHold = (Date.now() - (S.mouseHeldAt || 0)) > 350;
    S.mouseHeld = false;
    S.mouseHeldAt = 0;
    if (!wasHold) setTarget(1);   /* click → bloom; hold → stay withered */
    showHoldIndicator(false);
  });
  document.addEventListener('touchstart', e => {
    if (skip(e) || S.mode !== 'mouse') return;
    S.mouseHeld = true;
    S.mouseHeldAt = Date.now();
    setTarget(0);
    showHoldIndicator(true);
  }, { passive: false });
  document.addEventListener('touchend', e => {
    if (S.mode !== 'mouse') return;
    e.preventDefault();               /* ghost mousedown/mouseup 방지 */
    const wasHold = (Date.now() - (S.mouseHeldAt || 0)) > 350;
    S.mouseHeld = false;
    S.mouseHeldAt = 0;
    if (!wasHold) setTarget(1);
    showHoldIndicator(false);
  }, { passive: false });

  document.addEventListener('dblclick', e => {
    if (skip(e) || S.mode !== 'mouse' || S.stage !== 'interact') return;
    spawnPetals(62, true);
    setTarget(1);
  });

  document.addEventListener('wheel', e => {
    if (S.mode !== 'mouse' || S.stage !== 'interact') return;
    e.preventDefault();
    const delta = -e.deltaY * 0.004;
    setTarget(Math.max(0, Math.min(1, S.target + delta)));
  }, { passive: false });
}

function showHoldIndicator(on) {
  const el = document.getElementById('hold-indicator');
  if (el) el.classList.toggle('on', on);
}

function updateModeUI(mode) {
  document.getElementById('mode-cam').classList.toggle('active-mode', mode==='camera');
  document.getElementById('mode-mouse').classList.toggle('active-mode', mode==='mouse');
  const guide = document.querySelector('.guide-ko');
  if (guide) {
    if (mode === 'mouse') {
      guide.innerHTML = '꾹 누르면 꽃이 지고 유지됩니다<br>다시 클릭하면 꽃이 핍니다.';
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
  if (_elBloomFill && S.stage === 'interact')
    _elBloomFill.style.height = (S.bloom * 100).toFixed(1) + '%';
}

function updateVidBloomBar() {
  if (_elVbFill) _elVbFill.style.height = (S.bloom * 100).toFixed(1) + '%';
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

  if (name === 'video') {
    /* play at rate=0: keeps video buffer alive in browser memory
       without rate=0, mobile browsers release buffer after ~30s of pause */
    flowerVid.play().catch(() => {});
    flowerVid.playbackRate = 0;
  } else if (S.prevStage === 'video') {
    flowerVid.pause();
    flowerVid.playbackRate = 1;
  }

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
  cxC += (rawX-cxC) * 0.50;
  cyC += (rawY-cyC) * 0.50;
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
  new RoseRenderer(),
  new JellyfishRenderer(),
  new SnowflakeRenderer(),
  new OrbitRenderer(),
];
const RENDERER_NAMES = ['Peony', 'Lotus', 'Crystal', 'Dandelion', 'Rose', 'Jellyfish', 'Snowflake', 'Orbit'];
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

  /* color / parallax only needed in interact stage */
  if (S.stage === 'interact') {
    const _tHue = COLOR_ANGLES[G.colorMode];
    G.colorAngle += (_tHue - G.colorAngle) * 0.035;
    const _newFilter = Math.abs(G.colorAngle) > 0.5 ? `hue-rotate(${G.colorAngle.toFixed(1)}deg)` : '';
    if (_newFilter !== _lastFilterStr) { cv.style.filter = _newFilter; _lastFilterStr = _newFilter; }

    if (S.handOn) {
      /* pointing: use fingertip for more precise flower tracking */
      const src    = (G.gesture === 'point' && G.indexTip) ? G.indexTip : G.palmPos;
      const factor = G.gesture === 'point' ? 0.18 : 0.12;
      if (src) {
        const tx = ((0.5 - src.x)) * cv.width  * factor;
        const ty = ((src.y - 0.5)) * cv.height * factor;
        G.parallaxX += (tx - G.parallaxX) * 0.10;
        G.parallaxY += (ty - G.parallaxY) * 0.10;
      }
    } else {
      G.parallaxX *= 0.92;
      G.parallaxY *= 0.92;
    }
  }

  /* directional lerp: faster wither than bloom, scaled by timeScale */
  const speed  = (S.target < S.bloom ? 0.09 : 0.055) * G.timeScale;
  S.bloom     += (S.target - S.bloom) * speed;

  /* video stage: mouse scrub disabled — camera only */

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

  /* scrub flower video — only when bloom changes enough (avoids per-frame seek) */
  if (S.stage === 'video' && flowerVid.readyState >= 1 && flowerVid.duration) {
    /* seek only when bloom changed enough AND enough time passed (max ~10 seeks/s) */
    const _seekThresh = isMobile ? 0.045 : 0.018;
    if (Math.abs(S.bloom - _lastVidBloom) > _seekThresh && now - _lastSeekT > 100) {
      const t = Math.min(S.bloom * flowerVid.duration, flowerVid.duration - 0.05);
      flowerVid.currentTime = Math.max(0, t);
      _lastVidBloom = S.bloom;
      _lastSeekT = now;
    }
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
    /* sort only every 8 frames — depth changes slowly */
    if (S.frame % 8 === 0) petals.sort((a,b)=>a.depth-b.depth);
    petals.forEach(p => { p.update(S.bloom, withering); p.draw(); });
  }

  updateBloomBar();

  /* gesture indicator visibility */
  const showGI = !!G.gestLabel && S.handOn && S.stage === 'interact';
  if (_elGI) _elGI.classList.toggle('on', showGI);
  if (_elGL && _elGL.textContent !== G.gestLabel) _elGL.textContent = G.gestLabel;

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

  /* Camera Guide → gestures page, cam tab pre-selected */
  const _btnCamGuide = document.getElementById('btn-cam-guide');
  if (_btnCamGuide) {
    _btnCamGuide.addEventListener('click', () => {
      /* activate cam tab */
      document.querySelectorAll('.gg-tab').forEach(t => t.classList.toggle('gg-tab-active', t.dataset.panel === 'cam'));
      document.querySelectorAll('.gg-panel').forEach(p => p.classList.toggle('gg-panel-off', p.id !== 'gg-panel-cam'));
      const sub = document.getElementById('gg-subtitle');
      if (sub) sub.innerHTML = '손 모양에 따라 다른 인터렉션이 활성화됩니다<br>카메라 모드에서만 작동합니다';
      goTo('gestures');
    });
    _btnCamGuide.addEventListener('mouseenter', () => document.body.classList.add('hovering'));
    _btnCamGuide.addEventListener('mouseleave', () => document.body.classList.remove('hovering'));
  }

  /* Mouse Guide → gestures page, mouse tab pre-selected */
  const _btnMouseGuide = document.getElementById('btn-mouse-guide');
  if (_btnMouseGuide) {
    _btnMouseGuide.addEventListener('click', () => {
      document.querySelectorAll('.gg-tab').forEach(t => t.classList.toggle('gg-tab-active', t.dataset.panel === 'mouse'));
      document.querySelectorAll('.gg-panel').forEach(p => p.classList.toggle('gg-panel-off', p.id !== 'gg-panel-mouse'));
      const sub = document.getElementById('gg-subtitle');
      if (sub) sub.innerHTML = '마우스 클릭과 위치로 꽃을 제어합니다<br>터치 기기에서도 동일하게 작동합니다';
      goTo('gestures');
    });
    _btnMouseGuide.addEventListener('mouseenter', () => document.body.classList.add('hovering'));
    _btnMouseGuide.addEventListener('mouseleave', () => document.body.classList.remove('hovering'));
  }

  /* Color cycle button */
  const _btnColor = document.getElementById('btn-color');
  if (_btnColor) {
    _btnColor.addEventListener('click', () => {
      G.colorMode = (G.colorMode + 1) % COLOR_ANGLES.length;
    });
    _btnColor.addEventListener('mouseenter', () => document.body.classList.add('hovering'));
    _btnColor.addEventListener('mouseleave', () => document.body.classList.remove('hovering'));
  }

  document.getElementById('btn-gg-back').addEventListener('click', () => {
    goTo(S.prevStage === 'gestures' ? 'video' : S.prevStage);
  });
  document.getElementById('btn-gg-back').addEventListener('mouseenter', () => document.body.classList.add('hovering'));
  document.getElementById('btn-gg-back').addEventListener('mouseleave', () => document.body.classList.remove('hovering'));

  /* guide tab switcher */
  const GG_SUBTITLES = {
    cam:   '손 모양에 따라 다른 인터렉션이 활성화됩니다<br>카메라 모드에서만 작동합니다',
    mouse: '마우스 클릭과 위치로 꽃을 제어합니다<br>터치 기기에서도 동일하게 작동합니다',
  };
  document.querySelectorAll('.gg-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const panel = tab.dataset.panel;
      document.querySelectorAll('.gg-tab').forEach(t => t.classList.toggle('gg-tab-active', t === tab));
      document.querySelectorAll('.gg-panel').forEach(p => p.classList.toggle('gg-panel-off', p.id !== 'gg-panel-' + panel));
      const sub = document.getElementById('gg-subtitle');
      if (sub) sub.innerHTML = GG_SUBTITLES[panel] || '';
    });
    tab.addEventListener('mouseenter', () => document.body.classList.add('hovering'));
    tab.addEventListener('mouseleave', () => document.body.classList.remove('hovering'));
  });

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

/* cached DOM refs for hot loop */
let _elGI, _elGL, _elBloomFill, _elVbFill;

window.addEventListener('load', () => {
  setLoad(50, 'Building');
  bindButtons();
  _elGI       = document.getElementById('gest-indicator');
  _elGL       = document.getElementById('gest-label');
  _elBloomFill= document.getElementById('bloom-bar-fill');
  _elVbFill   = document.getElementById('vb-fill');
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
