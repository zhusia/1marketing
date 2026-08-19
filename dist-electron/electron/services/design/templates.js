"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESIGN_FORMATS = void 0;
exports.formatInfo = formatInfo;
exports.escapeHtml = escapeHtml;
exports.listTemplates = listTemplates;
exports.templateIds = templateIds;
exports.renderTemplate = renderTemplate;
exports.sanitizeAuthoredHtml = sanitizeAuthoredHtml;
exports.tokensFor = tokensFor;
const designSystems_1 = require("./designSystems");
const fonts_1 = require("./fonts");
exports.DESIGN_FORMATS = [
    { id: 'feature_image', label: 'Feature image (16:9)', width: 1200, height: 675 },
    { id: 'og_card', label: 'Open Graph / Twitter card', width: 1200, height: 630 },
    { id: 'social_square', label: 'Social square', width: 1080, height: 1080 },
    { id: 'story', label: 'Story / vertical', width: 1080, height: 1920 },
    { id: 'banner', label: 'Wide banner', width: 1500, height: 500 },
];
function formatInfo(format) {
    return exports.DESIGN_FORMATS.find((entry) => entry.id === format) ?? exports.DESIGN_FORMATS[0];
}
// --- color helpers ---------------------------------------------------------
function hexToRgb(hex) {
    const normalized = hex.replace('#', '').trim();
    const value = normalized.length === 3
        ? normalized.split('').map((c) => c + c).join('')
        : normalized.padEnd(6, '0').slice(0, 6);
    const int = parseInt(value, 16);
    return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}
function toHex(r, g, b) {
    const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}
function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
/** Readable foreground (#fff / near-black) for a given background color. */
function readableText(hex) {
    return luminance(hex) > 0.6 ? '#0b0b0f' : '#ffffff';
}
/** Lighten (amount > 0) or darken (amount < 0) toward white/black. */
function shift(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const f = (n) => (amount >= 0 ? n + (255 - n) * amount : n * (1 + amount));
    return toHex(f(r), f(g), f(b));
}
/** Blend two colors in sRGB. */
function mix(a, b, t) {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return toHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}
function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const px = (n) => `${Math.round(n)}px`;
/**
 * Faint film-grain tile (inline SVG → data URI, no external fetch).
 *
 * Keep the SVG percent-encoded. The old raw URI was interpolated as
 * `style="...url("data:...")..."`, so the nested quote ended the HTML style
 * attribute and the remaining CSS was painted as visible text in exported art.
 */
const GRAIN_URI = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140">' +
    '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>' +
    '<feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>')}`;
/** Treatment-specific background CSS + extra blurred-blob layers, all derived from the accent. */
function backgroundArt(ctx, treatment) {
    const accent = ctx.accentColor;
    const base = mix('#08080d', accent, 0.1);
    const light = shift(accent, 0.24);
    const mid = accent;
    const deep = shift(accent, -0.4);
    const blob = (style) => `<div class="bg-layer" style="${style}"></div>`;
    switch (treatment) {
        case 'linear':
            return { bg: `linear-gradient(135deg, ${shift(accent, 0.08)} 0%, ${shift(accent, -0.5)} 100%)`, layers: '' };
        case 'spotlight':
            return {
                bg: `radial-gradient(130% 120% at 50% -15%, ${shift(accent, -0.1)} 0%, ${mix('#06060a', accent, 0.06)} 48%, #05050a 100%)`,
                layers: blob(`background:radial-gradient(60% 50% at 50% 0%, ${rgba(light, 0.5)}, transparent 70%);mix-blend-mode:screen`),
            };
        case 'aurora':
            return {
                bg: mix('#070710', accent, 0.08),
                layers: blob(`left:-10%;top:-25%;width:75%;height:90%;background:${rgba(light, 0.55)};filter:blur(120px);border-radius:50%`) +
                    blob(`right:-15%;top:-10%;width:60%;height:80%;background:${rgba(mix(accent, '#22d3ee', 0.5), 0.4)};filter:blur(140px);border-radius:50%`) +
                    blob(`left:25%;bottom:-30%;width:70%;height:80%;background:${rgba(deep, 0.55)};filter:blur(130px);border-radius:50%`),
            };
        case 'geometric':
            return {
                bg: `linear-gradient(160deg, ${mix('#0c0c14', accent, 0.16)}, ${mix('#06060c', accent, 0.05)})`,
                layers: blob(`right:-8%;top:-12%;width:42%;height:0;padding-bottom:42%;background:${rgba(light, 0.22)};border-radius:50%;filter:blur(8px)`) +
                    blob(`right:6%;top:8%;width:26%;height:0;padding-bottom:26%;border:2px solid ${rgba(light, 0.35)};border-radius:50%`) +
                    blob(`left:-6%;bottom:-10%;width:34%;height:0;padding-bottom:34%;background:${rgba(deep, 0.5)};border-radius:32%;transform:rotate(12deg);filter:blur(6px)`) +
                    blob(`inset:0;opacity:.5;background-image:radial-gradient(${rgba('#ffffff', 0.07)} 1.4px, transparent 1.6px);background-size:${px(ctx.height * 0.05)} ${px(ctx.height * 0.05)}`),
            };
        case 'gridlines':
            return {
                bg: `linear-gradient(180deg, ${mix('#0a0a12', accent, 0.12)}, #06060b)`,
                layers: blob(`inset:0;opacity:.6;background-image:linear-gradient(${rgba('#ffffff', 0.06)} 1px, transparent 1px),linear-gradient(90deg, ${rgba('#ffffff', 0.06)} 1px, transparent 1px);background-size:${px(ctx.height * 0.08)} ${px(ctx.height * 0.08)};-webkit-mask-image:radial-gradient(120% 120% at 50% 0%, #000 40%, transparent 100%)`) +
                    blob(`left:50%;top:-20%;width:60%;height:70%;transform:translateX(-50%);background:radial-gradient(closest-side, ${rgba(light, 0.4)}, transparent);filter:blur(40px)`),
            };
        case 'mesh':
        default:
            return {
                bg: `radial-gradient(62% 78% at 14% 8%, ${rgba(light, 0.95)} 0%, transparent 56%),` +
                    `radial-gradient(54% 70% at 88% 22%, ${rgba(mix(accent, '#ffffff', 0.35), 0.7)} 0%, transparent 52%),` +
                    `radial-gradient(80% 95% at 72% 96%, ${rgba(deep, 0.95)} 0%, transparent 60%),` +
                    `linear-gradient(135deg, ${mid} 0%, ${base} 100%)`,
                layers: '',
            };
    }
}
/** Opt-in decorative overlays layered above the background. */
function decorationLayers(ctx) {
    if (!ctx.decoration?.length)
        return '';
    const accent = ctx.accentColor;
    const out = [];
    const layer = (style) => `<div class="bg-layer" style="${style}"></div>`;
    for (const item of ctx.decoration) {
        switch (item) {
            case 'glow':
                out.push(layer(`right:-12%;top:-18%;width:55%;height:75%;background:radial-gradient(closest-side, ${rgba(shift(accent, 0.3), 0.55)}, transparent);filter:blur(30px)`));
                break;
            case 'ring':
                out.push(layer(`right:-18%;bottom:-30%;width:60%;height:0;padding-bottom:60%;border:${px(ctx.height * 0.012)} solid ${rgba('#ffffff', 0.1)};border-radius:50%`));
                break;
            case 'dots':
                out.push(layer(`inset:0;opacity:.5;background-image:radial-gradient(${rgba('#ffffff', 0.12)} 1.4px, transparent 1.6px);background-size:${px(ctx.height * 0.045)} ${px(ctx.height * 0.045)};-webkit-mask-image:linear-gradient(180deg,#000,transparent)`));
                break;
            case 'corner-marks': {
                const s = px(ctx.height * 0.06);
                const m = px(ctx.height * 0.05);
                const c = rgba('#ffffff', 0.32);
                out.push(layer(`left:${m};top:${m};width:${s};height:${s};border-left:2px solid ${c};border-top:2px solid ${c}`));
                out.push(layer(`right:${m};bottom:${m};width:${s};height:${s};border-right:2px solid ${c};border-bottom:2px solid ${c}`));
                break;
            }
            case 'noise':
                out.push(layer(`inset:0;background-image:url('${GRAIN_URI}');background-size:${px(ctx.height * 0.18)};opacity:.06;mix-blend-mode:overlay`));
                break;
        }
    }
    return out.join('');
}
/**
 * Light-mode counterpart to {@link backgroundArt}: a paper base with soft accent washes, used
 * when the resolved design system is a light one. Keeps the same treatment vocabulary so a
 * light variant still reads as e.g. "spotlight" or "mesh", just on paper instead of in the dark.
 */
function lightBackgroundArt(ctx, treatment) {
    const accent = ctx.accentColor;
    const paper = ctx.tokens.palette.bg;
    const warm = ctx.tokens.palette.surfaceWarm;
    const tint = (t) => mix(paper, accent, t);
    const blob = (style) => `<div class="bg-layer" style="${style}"></div>`;
    switch (treatment) {
        case 'linear':
            return { bg: `linear-gradient(160deg, ${shift(paper, 0.02)} 0%, ${tint(0.1)} 100%)`, layers: '' };
        case 'spotlight':
            return {
                bg: `radial-gradient(120% 120% at 50% -12%, ${tint(0.16)} 0%, ${paper} 56%)`,
                layers: blob(`background:radial-gradient(58% 46% at 50% 0%, ${rgba(accent, 0.16)}, transparent 70%)`),
            };
        case 'aurora':
            return {
                bg: paper,
                layers: blob(`left:-12%;top:-22%;width:70%;height:85%;background:${rgba(accent, 0.18)};filter:blur(120px);border-radius:50%`) +
                    blob(`right:-14%;top:-8%;width:55%;height:75%;background:${rgba(mix(accent, '#22d3ee', 0.5), 0.14)};filter:blur(140px);border-radius:50%`),
            };
        case 'geometric':
            return {
                bg: `linear-gradient(160deg, ${paper}, ${tint(0.06)})`,
                layers: blob(`right:-6%;top:-10%;width:38%;height:0;padding-bottom:38%;background:${rgba(accent, 0.14)};border-radius:50%;filter:blur(6px)`) +
                    blob(`right:7%;top:9%;width:24%;height:0;padding-bottom:24%;border:2px solid ${rgba(accent, 0.3)};border-radius:50%`),
            };
        case 'gridlines':
            return {
                bg: `linear-gradient(180deg, ${shift(paper, 0.01)}, ${tint(0.05)})`,
                layers: blob(`inset:0;opacity:.7;background-image:linear-gradient(${rgba(accent, 0.1)} 1px, transparent 1px),linear-gradient(90deg, ${rgba(accent, 0.1)} 1px, transparent 1px);background-size:${px(ctx.height * 0.08)} ${px(ctx.height * 0.08)};-webkit-mask-image:radial-gradient(120% 120% at 50% 0%, #000 42%, transparent 100%)`),
            };
        case 'mesh':
        default:
            return {
                bg: `radial-gradient(60% 76% at 12% 6%, ${rgba(accent, 0.2)} 0%, transparent 55%),` +
                    `radial-gradient(52% 68% at 90% 18%, ${rgba(mix(accent, '#ffffff', 0.2), 0.16)} 0%, transparent 52%),` +
                    `radial-gradient(78% 92% at 74% 98%, ${rgba(warm, 0.6)} 0%, transparent 60%),` +
                    `linear-gradient(135deg, ${shift(paper, 0.02)} 0%, ${tint(0.05)} 100%)`,
                layers: '',
            };
    }
}
/** Light theme for the generated-art background (paper + dark ink + accent washes). */
function lightGeneratedTheme(ctx) {
    const accent = ctx.accentColor;
    const paper = ctx.tokens.palette.bg;
    const ink = luminance(ctx.tokens.palette.fg) < 0.5 ? ctx.tokens.palette.fg : '#0b0b0f';
    const art = lightBackgroundArt(ctx, ctx.backgroundTreatment);
    return {
        mode: 'light',
        ink,
        inkSoft: rgba(ink, 0.64),
        hair: rgba(ink, 0.12),
        // A very light accent (e.g. brutalist yellow) is unreadable as text — darken it for labels.
        accentText: luminance(accent) > 0.62 ? shift(accent, -0.5) : accent,
        accentOn: readableText(accent),
        card: mix(paper, ink, 0.05),
        bg: art.bg,
        layers: art.layers + decorationLayers(ctx),
    };
}
/** Resolve the page theme (text colors, background art, decoration) for the chosen source. */
function resolveTheme(ctx) {
    const accent = ctx.accentColor;
    const accentOn = readableText(accent);
    // Image background → dark scrim for legibility.
    if ((ctx.background === 'asset' || ctx.background === 'generated') && ctx.backgroundDataUri) {
        return {
            mode: 'dark',
            ink: '#ffffff',
            inkSoft: rgba('#ffffff', 0.86),
            hair: rgba('#ffffff', 0.22),
            accentText: shift(accent, 0.4),
            accentOn,
            card: rgba('#ffffff', 0.08),
            bg: '#0a0a0f',
            layers: `<div class="bg-layer" style="background-image:url('${ctx.backgroundDataUri}');background-size:cover;background-position:center"></div>` +
                `<div class="bg-layer" style="background:linear-gradient(180deg, ${rgba('#05060a', 0.35)} 0%, ${rgba('#05060a', 0.78)} 100%)"></div>` +
                decorationLayers(ctx),
        };
    }
    // Solid accent fill → theme follows the accent's lightness.
    if (ctx.background === 'solid') {
        const lightBg = luminance(accent) > 0.6;
        const ink = lightBg ? '#0b0b0f' : '#ffffff';
        return {
            mode: lightBg ? 'light' : 'dark',
            ink,
            inkSoft: lightBg ? rgba('#000000', 0.66) : rgba('#ffffff', 0.84),
            hair: lightBg ? rgba('#000000', 0.14) : rgba('#ffffff', 0.2),
            accentText: lightBg ? shift(accent, -0.45) : '#ffffff',
            accentOn: ink === '#ffffff' ? accent : '#ffffff',
            card: lightBg ? rgba('#000000', 0.05) : rgba('#ffffff', 0.08),
            bg: accent,
            layers: decorationLayers(ctx),
        };
    }
    // Generated art background (default). Light design systems (clean, bento, claymorphism,
    // artistic, brutalism, colorful…) carry a light --bg; honour it so selecting/rotating a
    // system actually changes the look instead of every render collapsing to a dark gradient.
    if (luminance(ctx.tokens.palette.bg) > 0.62)
        return lightGeneratedTheme(ctx);
    const art = backgroundArt(ctx, ctx.backgroundTreatment);
    return {
        mode: 'dark',
        ink: '#ffffff',
        inkSoft: rgba('#ffffff', 0.84),
        hair: rgba('#ffffff', 0.18),
        accentText: shift(accent, 0.4),
        accentOn,
        card: rgba('#ffffff', 0.06),
        bg: art.bg,
        layers: art.layers + decorationLayers(ctx),
    };
}
// --- typography + document shell -------------------------------------------
const DENSITY_MUL = { airy: 1.06, balanced: 1, compact: 0.92 };
const PAD_FACTOR = { airy: 0.085, balanced: 0.07, compact: 0.055 };
function scaleOf(ctx) {
    const unit = Math.min(ctx.width, ctx.height);
    const mul = DENSITY_MUL[ctx.density] ?? 1;
    return {
        unit,
        mul,
        pad: Math.round(unit * (PAD_FACTOR[ctx.density] ?? 0.07)),
        eyebrow: unit * 0.026 * mul,
        sub: unit * 0.04 * mul,
        cta: unit * 0.036 * mul,
        meta: unit * 0.026,
        logo: Math.round(ctx.height * 0.052),
        cardRadius: Math.round(unit * 0.03),
    };
}
/**
 * Paused, deterministically seekable intro animation (Web Animations API) for video export.
 * The frame capturer calls `window.__odSeek(ms)`; nothing animates during a still PNG render.
 */
function animationScript(durationMs) {
    return `<script>(function(){
  var TOTAL=${Math.max(1, Math.round(durationMs))};
  var anims=[];
  function all(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
  function add(el,frames,opts){
    if(!el||!el.animate)return;
    var anim=el.animate(frames,Object.assign({duration:TOTAL,fill:'both',easing:'cubic-bezier(0.16,1,0.3,1)'},opts||{}));
    anim.pause();
    anims.push(anim);
  }
  function stagger(selector,frames,baseDelay,step,dur,easing){
    all(selector).forEach(function(el,i){add(el,frames,{delay:baseDelay+(i*step),duration:dur||Math.min(TOTAL,1600),easing:easing||'cubic-bezier(0.16,1,0.3,1)'});});
  }
  add(document.body,
    [{opacity:0,transform:'scale(1.055)'},{opacity:1,offset:0.18,transform:'scale(1.035)'},{opacity:1,transform:'scale(1)'}],
    {duration:TOTAL,easing:'cubic-bezier(0.22,1,0.36,1)'}
  );
  add(document.querySelector('.canvas'),
    [{opacity:0,transform:'translateY(3%) scale(.985)'},{opacity:1,offset:.22,transform:'translateY(0) scale(1)'},{opacity:1,transform:'translateY(0) scale(1)'}],
    {duration:Math.min(TOTAL,1800),easing:'cubic-bezier(0.16,1,0.3,1)'}
  );
  all('.bg-layer').forEach(function(el,i){
    add(el,
      [
        {opacity:i%2?0.56:0.72,transform:'scale(1.08) translate3d('+(i%2?-2:2)+'%, '+(i%3?-2:2)+'%, 0) rotate('+(i%2?-2:2)+'deg)'},
        {opacity:1,offset:.45,transform:'scale(1.02) translate3d(0,0,0) rotate(0deg)'},
        {opacity:.9,transform:'scale(1.1) translate3d('+(i%2?2:-2)+'%, '+(i%3?2:-2)+'%, 0) rotate('+(i%2?2:-2)+'deg)'}
      ],
      {duration:TOTAL,delay:i*90,easing:'cubic-bezier(0.45,0,0.55,1)'}
    );
  });
  add(document.querySelector('.motion-sweep'),
    [{opacity:0,transform:'translate3d(-72%, -8%, 0) rotate(-18deg)'},{opacity:.52,offset:.22},{opacity:0,transform:'translate3d(82%, 10%, 0) rotate(-18deg)'}],
    {duration:Math.min(TOTAL,3600),delay:Math.min(500,TOTAL*.08),easing:'cubic-bezier(0.45,0,0.55,1)'}
  );
  add(document.querySelector('.motion-progress span'),
    [{transform:'scaleX(0)'},{transform:'scaleX(1)'}],
    {duration:TOTAL,easing:'linear'}
  );
  stagger('.logo,.eyebrow',
    [{opacity:0,transform:'translateY(-18px) scale(.94)'},{opacity:1,transform:'translateY(0) scale(1)'}],
    130,120,900
  );
  stagger('.h1',
    [{opacity:0,filter:'blur(10px)',transform:'translateY(42px) scale(.96)'},{opacity:1,filter:'blur(0px)',transform:'translateY(0) scale(1)'}],
    280,90,1100
  );
  stagger('.sub',
    [{opacity:0,transform:'translateY(28px)'},{opacity:1,transform:'translateY(0)'}],
    560,110,1050
  );
  stagger('.cta,.chip',
    [{opacity:0,transform:'translateY(28px) scale(.9)'},{opacity:1,offset:.72,transform:'translateY(0) scale(1.035)'},{opacity:1,transform:'translateY(0) scale(1)'}],
    780,120,1000,'cubic-bezier(0.34,1.56,0.64,1)'
  );
  stagger('.card',
    [{opacity:0,filter:'blur(10px)',transform:'translateY(46px) rotateX(7deg) scale(.96)'},{opacity:1,filter:'blur(0px)',transform:'translateY(0) rotateX(0deg) scale(1)'}],
    420,140,1300
  );
  stagger('.rule',
    [{opacity:0,transform:'scaleX(0)'},{opacity:1,transform:'scaleX(1)'}],
    640,80,900
  );
  all('.card img,.canvas>img').forEach(function(el,i){
    add(el,
      [{transform:'scale(1.08) translate3d('+(i%2?-1.8:1.8)+'%,0,0)'},{transform:'scale(1.015) translate3d(0,0,0)',offset:.42},{transform:'scale(1.055) translate3d('+(i%2?1.8:-1.8)+'%,0,0)'}],
      {duration:TOTAL,delay:120+i*80,easing:'cubic-bezier(0.45,0,0.55,1)'}
    );
  });
  for(var i=0;i<anims.length;i++)anims[i].pause();
  window.__odSeek=function(t){for(var i=0;i<anims.length;i++){try{anims[i].currentTime=Math.max(0,Math.min(TOTAL,t));}catch(e){}}};
  window.__odSeek(0);
})();</script>`;
}
/**
 * Quality gate: shrink any `[data-fit]` element until it stops overflowing its box / exceeding
 * its allowed line count. Runs after web fonts settle so the measurement uses final metrics
 * (RenderService awaits `document.fonts.ready` before capturing).
 */
const FIT_SCRIPT = `<script>(function(){
  function fit(el){
    var max=parseFloat(el.getAttribute('data-fit'))||64;
    var min=parseFloat(el.getAttribute('data-fit-min'))||Math.max(14,max*0.42);
    var maxLines=parseFloat(el.getAttribute('data-fit-lines'))||4;
    var size=max,guard=0;el.style.fontSize=size+'px';
    function lh(){var v=parseFloat(getComputedStyle(el).lineHeight);return v||size*1.1;}
    while(guard++<400&&size>min){
      var lines=Math.round(el.scrollHeight/lh());
      if(lines>maxLines||el.scrollWidth>el.clientWidth+1){size-=2;el.style.fontSize=size+'px';}else break;
    }
  }
  function run(){var els=document.querySelectorAll('[data-fit]');for(var i=0;i<els.length;i++)fit(els[i]);}
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(run);}run();
})();</script>`;
/** Build the full HTML document: tokens → :root, fonts, reset, utility classes, layers, content. */
/**
 * Per-design-system "signature" CSS: each bundled system's hallmark surface treatment
 * (claymorphism's soft 3D, brutalism's hard offset shadows, agentic's technical glow…),
 * layered AFTER the base kit so a selected/pinned (or Auto-rotated) system fully transforms
 * the render — not just its palette. Keyed on the resolved design-system id; '' for none.
 * Rules use the same single-class selectors as the kit (and reference CSS vars), so they
 * override cleanly and stay theme-aware.
 */
function signatureCss(id) {
    switch (id) {
        case 'claymorphism':
            return `
.card{border:none;border-radius:calc(var(--card-radius) * 1.5);box-shadow:10px 10px 24px rgba(120,80,50,.16), -8px -8px 20px rgba(255,255,255,.85)}
.cta-solid{border-radius:999px;box-shadow:7px 7px 16px rgba(120,80,50,.22), -5px -5px 14px rgba(255,255,255,.7)}
.cta-ghost{border:none;box-shadow:6px 6px 14px rgba(120,80,50,.16), -5px -5px 12px rgba(255,255,255,.75)}
.chip{border:none;box-shadow:5px 5px 12px rgba(120,80,50,.14), -4px -4px 10px rgba(255,255,255,.75)}
.rule{height:10px;border-radius:999px;background:var(--card);box-shadow:inset 2px 2px 5px rgba(120,80,50,.25), inset -2px -2px 5px rgba(255,255,255,.7)}`;
        case 'brutalism':
            return `
.card{border:3px solid var(--ink);border-radius:0;box-shadow:9px 9px 0 var(--ink)}
.cta{border-radius:0;border:3px solid var(--ink)}
.cta-solid{box-shadow:6px 6px 0 var(--ink)}
.cta-ghost{box-shadow:6px 6px 0 var(--ink);border-width:3px}
.chip{border:2px solid var(--ink);border-radius:0}
.rule{height:7px;border-radius:0;background:var(--ink)}
.eyebrow{letter-spacing:.16em}`;
        case 'colorful':
            return `
.card{border:2.5px solid var(--ink);border-radius:18px;box-shadow:7px 7px 0 var(--accent)}
.cta-solid{border-radius:999px;font-weight:800;border:2.5px solid var(--ink)}
.cta-ghost{border:2.5px solid var(--ink);border-radius:999px}
.chip{border:2px solid var(--ink);border-radius:999px}
.rule{height:8px;border-radius:999px}`;
        case 'agentic':
            return `
.card{border:1px solid var(--hair);border-radius:10px;background:rgba(255,255,255,.035);box-shadow:inset 0 1px 0 rgba(255,255,255,.05), 0 0 48px rgba(96,165,250,.07)}
.cta-solid{border-radius:8px;font-family:var(--font-mono);letter-spacing:.02em}
.cta-ghost{border-radius:8px;font-family:var(--font-mono)}
.eyebrow{font-family:var(--font-mono)}
.chip{font-family:var(--font-mono);border-radius:6px}
.rule{height:2px;border-radius:0;background:linear-gradient(90deg,var(--accent),transparent)}`;
        case 'bento':
            return `
.card{border:1px solid var(--hair);border-radius:calc(var(--card-radius) * 1.15);box-shadow:0 1px 0 rgba(15,23,42,.04), 0 10px 28px rgba(15,23,42,.07)}
.cta{border-radius:11px}
.rule{height:5px;border-radius:999px}`;
        case 'clean':
            return `
.card{border:1px solid var(--hair);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.cta{border-radius:8px}
.rule{height:4px}
.h1{letter-spacing:-.022em}`;
        case 'bold':
            return `
.card{border:1px solid var(--hair);border-radius:6px;box-shadow:none}
.cta{border-radius:6px;font-weight:800}
.h1{letter-spacing:-.035em;font-weight:900}
.rule{height:7px;border-radius:2px}`;
        case 'artistic':
            return `
.card{border:1px solid var(--hair);border-radius:2px;box-shadow:0 16px 44px rgba(40,25,15,.18)}
.cta{border-radius:2px}
.eyebrow{font-style:italic;letter-spacing:.12em}
.rule{height:3px;border-radius:0}`;
        default:
            return '';
    }
}
function document_(ctx, theme, inner, opts = {}) {
    const tokens = ctx.tokens;
    const sc = scaleOf(ctx);
    const displayFont = pickDisplayFont(ctx);
    const bodyFont = pickBodyFont(ctx);
    const monoFont = (0, fonts_1.getBundledFont)('JetBrains Mono');
    const tokenVars = Object.entries(tokens.vars)
        .map(([k, val]) => `${k}:${val}`)
        .join(';');
    const rootVars = [
        tokenVars,
        `--accent:${ctx.accentColor}`,
        `--accent-on:${theme.accentOn}`,
        `--ink:${theme.ink}`,
        `--ink-soft:${theme.inkSoft}`,
        `--hair:${theme.hair}`,
        `--accent-text:${theme.accentText}`,
        `--card:${theme.card}`,
        `--card-radius:${px(sc.cardRadius)}`,
        `--font-display:${(0, fonts_1.fontStack)(displayFont, "'Space Grotesk', system-ui, sans-serif")}`,
        `--font-body:${(0, fonts_1.fontStack)(bodyFont, 'system-ui, -apple-system, sans-serif')}`,
        `--font-mono:${(0, fonts_1.fontStack)(monoFont, 'ui-monospace, Menlo, monospace')}`,
        `--pad:${px(sc.pad)}`,
        `--fs-eyebrow:${px(sc.eyebrow)}`,
        `--fs-sub:${px(sc.sub)}`,
        `--fs-cta:${px(sc.cta)}`,
        `--fs-meta:${px(sc.meta)}`,
    ].join(';');
    const motion = ctx.animate ? animationScript(ctx.durationMs ?? 4000) : '';
    const motionLayers = ctx.animate
        ? `<div class="motion-sweep"></div><div class="motion-progress"><span></span></div>`
        : '';
    const canvasPad = opts.bare ? '0' : 'var(--pad)';
    return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
${(0, fonts_1.fontFaceCss)([displayFont, bodyFont, monoFont])}
:root{${rootVars}}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${ctx.width}px;height:${ctx.height}px;overflow:hidden}
body{position:relative;background:${theme.bg};color:var(--ink);font-family:var(--font-body);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.bg-layer{position:absolute;inset:0;pointer-events:none}
.canvas{position:relative;z-index:2;height:100%;width:100%;padding:${canvasPad}}
.authored-root{position:relative;width:100%;height:100%;overflow:hidden;isolation:isolate}
.authored-root>:first-child{width:100%;height:100%}
.stack{display:flex;flex-direction:column}
.eyebrow{font-family:var(--font-mono);font-weight:700;font-size:var(--fs-eyebrow);letter-spacing:.2em;text-transform:uppercase;color:var(--accent-text)}
.h1{font-family:var(--font-display);font-weight:800;line-height:${tokens.leading.tight};letter-spacing:var(--tracking-display);color:var(--ink);text-wrap:balance}
.sub{font-family:var(--font-body);font-weight:450;font-size:var(--fs-sub);line-height:1.42;color:var(--ink-soft)}
.cta{display:inline-flex;align-items:center;gap:.5em;font-family:var(--font-body);font-weight:600;font-size:var(--fs-cta);border-radius:var(--radius-pill);padding:.74em 1.35em;white-space:nowrap}
.cta-solid{background:var(--accent);color:var(--accent-on);box-shadow:0 ${px(sc.unit * 0.02)} ${px(sc.unit * 0.05)} ${rgba('#000000', 0.28)}}
.cta-ghost{border:1.5px solid var(--hair);color:var(--ink)}
.rule{height:${px(Math.max(4, sc.unit * 0.008))};border-radius:9px;background:var(--accent)}
.chip{display:inline-flex;align-items:center;font-family:var(--font-body);font-weight:600;font-size:var(--fs-meta);color:var(--ink-soft);border:1px solid var(--hair);border-radius:var(--radius-pill);padding:.5em .95em}
.card{background:var(--card);border:1px solid var(--hair);border-radius:var(--card-radius);box-shadow:var(--elev-raised)}
.logo{height:${px(sc.logo)};max-width:42%;object-fit:contain;object-position:left center}
.source-media{position:relative}
.source-media-card{position:relative;overflow:hidden;background:var(--card);border:1px solid var(--hair);border-radius:var(--card-radius);box-shadow:0 ${px(sc.unit * 0.03)} ${px(sc.unit * 0.08)} ${rgba('#000000', 0.38)}}
.source-media-card img{width:100%;height:100%;object-fit:cover;display:block}
.source-media-card:after{content:"";position:absolute;inset:0;box-shadow:inset 0 0 0 1px ${rgba('#ffffff', 0.08)};pointer-events:none}
.source-media-rail{display:flex;align-items:stretch;gap:${px(sc.unit * 0.016)}}
.motion-sweep{position:absolute;z-index:1;left:0;top:0;width:120%;height:38%;background:linear-gradient(90deg,transparent,${rgba('#ffffff', 0.22)},transparent);filter:blur(18px);mix-blend-mode:screen;pointer-events:none}
.motion-progress{position:absolute;z-index:3;left:var(--pad);right:var(--pad);bottom:calc(var(--pad) * .42);height:${px(Math.max(3, sc.unit * 0.006))};border-radius:999px;background:${rgba('#ffffff', 0.1)};overflow:hidden;pointer-events:none}
.motion-progress span{display:block;width:100%;height:100%;background:linear-gradient(90deg,var(--accent),${shift(ctx.accentColor, 0.42)});transform-origin:left center}
${opts.bare ? '' : signatureCss(tokens.id)}
</style></head>
<body>${theme.layers}${motionLayers}<main class="canvas">${inner}</main>${motion}${FIT_SCRIPT}</body></html>`;
}
function pickDisplayFont(ctx) {
    return ((0, fonts_1.getBundledFont)(ctx.displayFamily) ||
        (0, fonts_1.resolveFont)(ctx.displayFamily, 'display') ||
        (0, fonts_1.resolveFont)(ctx.tokens.fonts.display, 'display') ||
        (0, fonts_1.getBundledFont)('Space Grotesk'));
}
function pickBodyFont(ctx) {
    return ((0, fonts_1.getBundledFont)(ctx.bodyFamily) ||
        (0, fonts_1.resolveFont)(ctx.bodyFamily, 'body') ||
        (0, fonts_1.resolveFont)(ctx.tokens.fonts.body, 'body') ||
        (0, fonts_1.getBundledFont)('Inter'));
}
// --- archetype building blocks ---------------------------------------------
function logoImg(ctx) {
    return ctx.logoDataUri ? `<img class="logo" src="${ctx.logoDataUri}" alt=""/>` : '';
}
function eyebrowHtml(ctx) {
    return ctx.eyebrow ? `<div class="eyebrow">${escapeHtml(ctx.eyebrow)}</div>` : '';
}
function h1Html(ctx, opts) {
    const style = [
        `font-size:${px(opts.size)}`,
        opts.maxWidth ? `max-width:${opts.maxWidth}` : '',
        opts.align === 'center' ? 'text-align:center' : '',
    ]
        .filter(Boolean)
        .join(';');
    return `<div class="h1" data-fit="${Math.round(opts.size)}" data-fit-min="${Math.round(opts.size * 0.45)}" data-fit-lines="${opts.lines ?? 3}" style="${style}">${escapeHtml(ctx.headline)}</div>`;
}
function subHtml(ctx, maxWidth) {
    if (!ctx.subhead)
        return '';
    return `<div class="sub" style="${maxWidth ? `max-width:${maxWidth}` : ''}">${escapeHtml(ctx.subhead)}</div>`;
}
function ctaHtml(ctx, kind = 'solid') {
    if (ctx.cta)
        return `<span class="cta cta-${kind}">${escapeHtml(ctx.cta)}</span>`;
    if (ctx.brandName)
        return `<span class="eyebrow" style="opacity:.9">${escapeHtml(ctx.brandName)}</span>`;
    return '';
}
function sourceImages(ctx) {
    return (ctx.sourceImageDataUris ?? []).filter(Boolean).slice(0, 4);
}
function primaryVisual(ctx) {
    return sourceImages(ctx)[0] ?? ctx.productShotDataUri ?? ctx.backgroundDataUri ?? null;
}
function sourceMediaCard(src, style) {
    return `<div class="card source-media-card" style="${style}"><img src="${src}" alt=""/></div>`;
}
function sourceMediaRail(ctx, max = 3) {
    const images = sourceImages(ctx).slice(0, max);
    if (!images.length)
        return '';
    const sc = scaleOf(ctx);
    const height = Math.max(sc.unit * 0.12, Math.min(sc.unit * 0.2, ctx.height * 0.2));
    return `<div class="source-media source-media-rail" style="height:${px(height)};max-width:100%">
    ${images
        .map((src, index) => sourceMediaCard(src, `flex:${index === 0 ? '1.35' : '1'};min-width:0;border-radius:${px(sc.cardRadius * 0.72)}`))
        .join('')}
  </div>`;
}
function sourceMediaCollage(ctx) {
    const images = sourceImages(ctx).slice(0, 3);
    if (!images.length)
        return '';
    const sc = scaleOf(ctx);
    const width = Math.min(ctx.width * 0.44, sc.unit * 0.82);
    const height = Math.min(ctx.height * 0.46, sc.unit * 0.52);
    if (images.length === 1) {
        return `<div class="source-media" style="width:${px(width)};height:${px(height)}">
      ${sourceMediaCard(images[0], `width:100%;height:100%;border-radius:${px(sc.cardRadius)}`)}
    </div>`;
    }
    const cards = images
        .map((src, index) => {
        const styles = [
            `position:absolute;border-radius:${px(sc.cardRadius * 0.82)}`,
            index === 0
                ? `left:0;top:${px(height * 0.08)};width:${px(width * 0.72)};height:${px(height * 0.82)};z-index:3`
                : index === 1
                    ? `right:0;top:0;width:${px(width * 0.48)};height:${px(height * 0.48)};z-index:2`
                    : `right:${px(width * 0.08)};bottom:0;width:${px(width * 0.44)};height:${px(height * 0.42)};z-index:4`,
        ].join(';');
        return sourceMediaCard(src, styles);
    })
        .join('');
    return `<div class="source-media source-media-collage" style="width:${px(width)};height:${px(height)}">${cards}</div>`;
}
function sourceMediaShowcase(ctx) {
    const main = primaryVisual(ctx);
    if (!main)
        return '';
    const images = sourceImages(ctx).filter((src) => src !== main).slice(0, 3);
    const sc = scaleOf(ctx);
    return `<div class="source-media" style="width:100%;height:100%;display:flex;flex-direction:column;gap:${px(sc.unit * 0.018)}">
    ${sourceMediaCard(main, `flex:1;min-height:0;border-radius:${px(sc.cardRadius * 0.72)}`)}
    ${images.length
        ? `<div class="source-media-rail" style="height:${px(sc.unit * 0.14)}">${images
            .map((src) => sourceMediaCard(src, `flex:1;min-width:0;border-radius:${px(sc.cardRadius * 0.5)}`))
            .join('')}</div>`
        : ''}
  </div>`;
}
const heroLeft = {
    info: { id: 'gradient-bold', name: 'Hero Bold', description: 'Full-bleed art with an oversized headline and CTA pill.', formats: [] },
    render: (ctx) => {
        const sc = scaleOf(ctx);
        const media = sourceMediaCollage(ctx);
        if (media) {
            const vertical = ctx.height > ctx.width * 1.2;
            return vertical
                ? `<div class="stack" style="height:100%;justify-content:space-between;gap:${px(sc.unit * 0.034)}">
            <div class="stack" style="gap:${px(sc.unit * 0.025)}">${logoImg(ctx)}${eyebrowHtml(ctx)}</div>
            <div style="align-self:center">${media}</div>
            <div class="stack" style="gap:${px(sc.unit * 0.028)}">
              ${h1Html(ctx, { size: sc.unit * 0.122, maxWidth: '13ch', lines: 3 })}
              ${subHtml(ctx, '32ch')}
              <div>${ctaHtml(ctx, 'solid')}</div>
            </div>
          </div>`
                : `<div style="height:100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.82fr);gap:${px(sc.pad)};align-items:center">
            <div class="stack" style="height:100%;justify-content:space-between">
              <div class="stack" style="gap:${px(sc.unit * 0.03)}">${logoImg(ctx)}${eyebrowHtml(ctx)}</div>
              <div class="stack" style="gap:${px(sc.unit * 0.028)}">
                ${h1Html(ctx, { size: sc.unit * 0.12, maxWidth: '13ch', lines: 3 })}
                ${subHtml(ctx, '34ch')}
              </div>
              <div>${ctaHtml(ctx, 'solid')}</div>
            </div>
            <div style="justify-self:end">${media}</div>
          </div>`;
        }
        return `<div class="stack" style="height:100%;justify-content:space-between">
      <div class="stack" style="gap:${px(sc.unit * 0.03)}">${logoImg(ctx)}${eyebrowHtml(ctx)}</div>
      <div class="stack" style="gap:${px(sc.unit * 0.028)}">
        ${h1Html(ctx, { size: sc.unit * 0.135, maxWidth: '15ch', lines: 3 })}
        ${subHtml(ctx, '40ch')}
      </div>
      <div>${ctaHtml(ctx, 'solid')}</div>
    </div>`;
    },
};
const heroCentered = {
    info: { id: 'hero-centered', name: 'Centered', description: 'Symmetric eyebrow, headline, subhead and CTA on centered art.', formats: [] },
    render: (ctx) => {
        const sc = scaleOf(ctx);
        const media = sourceMediaRail(ctx, 3);
        return `<div class="stack" style="height:100%;align-items:center;justify-content:center;text-align:center;gap:${px(sc.unit * 0.03)}">
      ${ctx.logoDataUri ? `<img src="${ctx.logoDataUri}" alt="" style="height:${px(ctx.height * 0.09)};max-width:46%;object-fit:contain;margin-bottom:${px(sc.unit * 0.01)}"/>` : ''}
      ${media ? `<div style="width:min(100%,${px(sc.unit * 0.78)});margin-bottom:${px(sc.unit * 0.006)}">${media}</div>` : ''}
      ${eyebrowHtml(ctx)}
      ${h1Html(ctx, { size: sc.unit * 0.1, maxWidth: '18ch', lines: 3, align: 'center' })}
      ${subHtml(ctx, '46ch')}
      ${ctx.cta ? `<div style="margin-top:${px(sc.unit * 0.012)}">${ctaHtml(ctx, 'solid')}</div>` : ''}
    </div>`;
    },
};
const spotlightLeft = {
    info: {
        id: 'spotlight-left',
        name: 'Spotlight',
        description: 'Copy on the left, product screenshot showcased on the right panel.',
        formats: ['feature_image', 'og_card', 'banner', 'social_square'],
    },
    render: (ctx) => {
        const sc = scaleOf(ctx);
        const media = sourceMediaShowcase(ctx);
        const shot = primaryVisual(ctx);
        const panel = `linear-gradient(135deg, ${shift(ctx.accentColor, 0.05)}, ${shift(ctx.accentColor, -0.5)})`;
        return `<div style="height:100%;display:flex;gap:${px(sc.pad)};align-items:center">
      <div class="stack" style="flex:1;gap:${px(sc.unit * 0.026)}">
        ${logoImg(ctx)}${eyebrowHtml(ctx)}
        ${h1Html(ctx, { size: sc.unit * 0.1, maxWidth: '16ch', lines: 4 })}
        ${subHtml(ctx, '40ch')}
        ${ctx.cta ? `<div style="margin-top:${px(sc.unit * 0.012)}">${ctaHtml(ctx, 'solid')}</div>` : ''}
      </div>
      <div class="card" style="flex:1.12;align-self:stretch;display:flex;align-items:center;justify-content:center;overflow:hidden;background:${panel};padding:${px(sc.pad * 0.7)}">
        ${media || (shot ? `<img src="${shot}" alt="" style="max-width:100%;max-height:100%;border-radius:${px(sc.cardRadius * 0.7)};box-shadow:0 ${px(sc.unit * 0.04)} ${px(sc.unit * 0.1)} ${rgba('#000000', 0.45)}"/>` : `<div class="h1" style="font-size:${px(sc.unit * 0.1)};opacity:.25">${escapeHtml(ctx.brandName || ctx.headline)}</div>`)}
      </div>
    </div>`;
    },
};
const splitShowcase = {
    info: {
        id: 'split-showcase',
        name: 'Showcase',
        description: 'Accent copy panel beside a framed product card — great for launches.',
        formats: ['feature_image', 'og_card', 'banner', 'social_square'],
    },
    render: (ctx) => {
        const sc = scaleOf(ctx);
        const media = sourceMediaShowcase(ctx);
        const shot = primaryVisual(ctx);
        return `<div style="height:100%;display:flex;gap:${px(sc.pad)};align-items:stretch">
      <div class="stack" style="flex:1.05;justify-content:center;gap:${px(sc.unit * 0.026)}">
        ${eyebrowHtml(ctx)}
        ${h1Html(ctx, { size: sc.unit * 0.098, maxWidth: '15ch', lines: 4 })}
        ${subHtml(ctx, '38ch')}
        <div style="display:flex;gap:${px(sc.unit * 0.018)};margin-top:${px(sc.unit * 0.014)};align-items:center">${ctaHtml(ctx, 'solid')}${logoImg(ctx)}</div>
      </div>
      <div class="card" style="flex:1;align-self:stretch;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:${px(sc.pad * 0.55)}">
        ${media || (shot ? `<img src="${shot}" alt="" style="max-width:100%;max-height:100%;border-radius:${px(sc.cardRadius * 0.6)}"/>` : `<div class="rule" style="width:38%"></div>`)}
      </div>
    </div>`;
    },
};
const editorial = {
    info: { id: 'editorial', name: 'Editorial', description: 'Magazine-style: kicker, large headline, rule and byline with generous whitespace.', formats: [] },
    render: (ctx) => {
        const sc = scaleOf(ctx);
        const media = sourceMediaRail(ctx, 3);
        return `<div class="stack" style="height:100%;justify-content:center;gap:${px(sc.unit * 0.03)}">
      <div style="display:flex;align-items:center;gap:${px(sc.unit * 0.02)}">${eyebrowHtml(ctx)}<span class="rule" style="flex:1;max-width:${px(sc.unit * 0.18)}"></span></div>
      ${h1Html(ctx, { size: sc.unit * 0.092, maxWidth: '20ch', lines: 4 })}
      ${subHtml(ctx, '52ch')}
      ${media ? `<div style="width:min(100%,${px(sc.unit * 0.86)});margin:${px(sc.unit * 0.004)} 0">${media}</div>` : ''}
      <div style="display:flex;align-items:center;gap:${px(sc.unit * 0.018)};margin-top:${px(sc.unit * 0.01)}">
        ${logoImg(ctx)}${ctx.brandName ? `<span class="chip">${escapeHtml(ctx.brandName)}</span>` : ''}${ctx.cta ? ctaHtml(ctx, 'ghost') : ''}
      </div>
    </div>`;
    },
};
const statCard = {
    info: { id: 'stat-card', name: 'Stat / Metric', description: 'A headline number as the focal point with supporting copy.', formats: [] },
    render: (ctx) => {
        const sc = scaleOf(ctx);
        const media = sourceMediaRail(ctx, 2);
        // Use the CTA as a small metric label when present; headline carries the figure.
        return `<div class="stack" style="height:100%;justify-content:space-between">
      <div class="stack" style="gap:${px(sc.unit * 0.02)}">${logoImg(ctx)}${eyebrowHtml(ctx)}</div>
      <div class="stack" style="gap:${px(sc.unit * 0.02)}">
        ${h1Html(ctx, { size: sc.unit * 0.2, maxWidth: '14ch', lines: 2 })}
        ${subHtml(ctx, '44ch')}
        ${media ? `<div style="width:min(100%,${px(sc.unit * 0.72)});margin-top:${px(sc.unit * 0.01)}">${media}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:${px(sc.unit * 0.018)}"><span class="rule" style="width:${px(sc.unit * 0.08)}"></span>${ctaHtml(ctx, 'ghost')}</div>
    </div>`;
    },
};
const quoteCard = {
    info: {
        id: 'quote-card',
        name: 'Quote / Testimonial',
        description: 'Large pull-quote with an accent bar — great for testimonials.',
        formats: ['feature_image', 'og_card', 'social_square', 'story'],
    },
    render: (ctx) => {
        const sc = scaleOf(ctx);
        const media = sourceMediaRail(ctx, 2);
        return `<div class="stack" style="height:100%;justify-content:center;gap:${px(sc.unit * 0.03)}">
      <div style="font-family:var(--font-display);font-size:${px(sc.unit * 0.22)};line-height:.6;color:var(--accent-text);font-weight:800">&ldquo;</div>
      ${h1Html(ctx, { size: sc.unit * 0.08, maxWidth: '22ch', lines: 5 })}
      <div style="display:flex;align-items:center;gap:${px(sc.unit * 0.018)};margin-top:${px(sc.unit * 0.01)}">
        <span class="rule" style="width:${px(sc.unit * 0.06)}"></span>
        <span class="sub" style="font-weight:600">${escapeHtml(ctx.subhead || ctx.brandName)}</span>
      </div>
      ${media ? `<div style="width:min(100%,${px(sc.unit * 0.72)})">${media}</div>` : ''}
      ${logoImg(ctx)}
    </div>`;
    },
};
const bento = {
    info: { id: 'bento', name: 'Bento', description: 'A headline tile beside supporting feature cards in a bento grid.', formats: ['feature_image', 'og_card', 'social_square', 'story'] },
    render: (ctx) => {
        const sc = scaleOf(ctx);
        const gap = px(sc.unit * 0.022);
        const images = sourceImages(ctx).slice(0, 3);
        const chips = (ctx.subhead || '')
            .split(/[,•|]/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 4);
        const tile = (inner, style = '') => `<div class="card" style="padding:${px(sc.unit * 0.04)};display:flex;${style}">${inner}</div>`;
        const featureChips = chips.length
            ? chips.map((c) => tile(`<span class="sub" style="align-self:flex-end;font-weight:600;color:var(--ink)">${escapeHtml(c)}</span>`, 'align-items:flex-end')).join('')
            : images.length
                ? images
                    .slice(0, 2)
                    .map((src) => sourceMediaCard(src, `min-height:0;border-radius:${px(sc.cardRadius)};padding:0`))
                    .join('')
                : tile(`<span class="sub" style="align-self:flex-end;color:var(--ink)">${escapeHtml(ctx.brandName)}</span>`, 'align-items:flex-end');
        return `<div style="height:100%;display:grid;grid-template-columns:1.4fr 1fr;grid-auto-rows:1fr;gap:${gap}">
      <div class="card" style="grid-row:1 / span 2;padding:${px(sc.unit * 0.045)};display:flex;flex-direction:column;justify-content:space-between">
        <div class="stack" style="gap:${px(sc.unit * 0.02)}">${logoImg(ctx)}${eyebrowHtml(ctx)}</div>
        ${h1Html(ctx, { size: sc.unit * 0.075, maxWidth: '14ch', lines: 4 })}
        ${images[0] && chips.length ? `<div style="height:${px(sc.unit * 0.18)}">${sourceMediaCard(images[0], `height:100%;border-radius:${px(sc.cardRadius * 0.62)};padding:0`)}</div>` : ''}
        ${ctx.cta ? `<div>${ctaHtml(ctx, 'solid')}</div>` : ''}
      </div>
      ${featureChips}
    </div>`;
    },
};
const TEMPLATES = [
    heroLeft,
    heroCentered,
    spotlightLeft,
    splitShowcase,
    editorial,
    statCard,
    quoteCard,
    bento,
];
// Back-compat: old documents stored `minimal-centered` — route it to the centered archetype.
const TEMPLATE_ALIASES = { 'minimal-centered': 'hero-centered' };
function listTemplates(format) {
    return TEMPLATES.filter((t) => !format || t.info.formats.length === 0 || t.info.formats.includes(format)).map((t) => t.info);
}
/** All archetype ids the design agent may choose (used to constrain its output). */
function templateIds(format) {
    return listTemplates(format).map((t) => t.id);
}
function renderTemplate(templateId, ctx) {
    if (templateId === 'authored' && ctx.authoredHtml) {
        return renderAuthored(ctx);
    }
    const id = TEMPLATE_ALIASES[templateId] ?? templateId;
    const template = TEMPLATES.find((t) => t.info.id === id) ?? heroLeft;
    const theme = resolveTheme(ctx);
    const inner = template.render(ctx, theme);
    return document_(ctx, theme, inner);
}
// --- authored (agent-written) mode -----------------------------------------
/**
 * Strip anything that would break the offline, no-external-fetch render model (or run code)
 * from agent-authored HTML, leaving inline styles + `data:` images intact. Returns null when
 * nothing usable survives, so the caller can fall back to a deterministic archetype.
 */
function sanitizeAuthoredHtml(raw) {
    if (!raw || raw.trim().length < 20)
        return null;
    let html = raw
        .trim()
        .replace(/^```(?:html)?\s*/i, '')
        .replace(/\s*```$/i, '')
        // A double-quoted data URL inside a double-quoted style attribute closes the
        // attribute early. Normalize the common model-authored form before stripping
        // unsafe markup. Percent-encoded/base64 data URIs do not contain apostrophes.
        .replace(/url\("(data:[^"]+)"\)/gi, (_match, uri) => `url('${uri.replace(/'/g, '%27')}')`);
    // Unwrap a full document down to its body if the agent returned one.
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch)
        html = bodyMatch[1];
    html = html
        .replace(/<!doctype[^>]*>/gi, '')
        .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<(?:link|iframe|object|embed|meta|base|form)[^>]*>/gi, '')
        .replace(/<\/(?:iframe|object|embed|form)>/gi, '')
        .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
        .replace(/@import[^;]+;/gi, '')
        // Neutralize any non-data remote resource (http/https/protocol-relative).
        .replace(/url\(\s*['"]?(?:https?:)?\/\/[^)]*\)/gi, 'url()')
        .replace(/\b(?:src|href)\s*=\s*"(?:https?:)?\/\/[^"]*"/gi, 'data-blocked=""')
        .replace(/\b(?:src|href)\s*=\s*'(?:https?:)?\/\/[^']*'/gi, "data-blocked=''");
    return html.replace(/\s+/g, ' ').trim().length < 20 ? null : html;
}
function renderAuthored(ctx) {
    const theme = resolveTheme(ctx);
    // Authored markup controls its own full-bleed composition; give it the token/font scaffold
    // and a neutral dark base, but no kit background/decoration or canvas padding.
    const bareTheme = { ...theme, bg: theme.mode === 'light' ? '#f6f6f8' : '#08080d', layers: '' };
    return document_(ctx, bareTheme, `<div class="authored-root">${ctx.authoredHtml ?? ''}</div>`, { bare: true });
}
/** Resolve the font scaffold for a given design system id + optional explicit pairing. */
function tokensFor(designSystemId) {
    return (0, designSystems_1.getDesignTokens)(designSystemId);
}
//# sourceMappingURL=templates.js.map