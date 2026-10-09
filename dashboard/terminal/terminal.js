// BOBAI BRAIN TERMINAL — the popup behind the yellow "Brain Terminal" button.
// Loaded on the first click only (see the loader in index.html); nothing here runs with the page.
// Every figure is read live: the chain (same calls as app.js chain()), the bots' logs, the agent
// record, the NFT state and the pool's swaps. Nothing is invented; decoration is only motion.
import * as THREE from './vendor/build/three.module.min.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';

// where this file lives (/terminal/ on the site) — the figure's poses sit next to it
const BASE = new URL('./', import.meta.url).pathname;

// ================= constants (same addresses and calls as the homepage, app.js chain()) =================
const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
// data comes from the live site: same origin there, absolute from a local preview or the test copy (bobai-lab.pages.dev)
// same origin everywhere (2026-09-27): the live site answers /logs and /api itself, the lab's worker hands them on, and a
// fixed https://brainonbnb.com broke every host that is not brainonbnb.com under the site's own CSP (connect-src 'self')
const SITE = '', AG = 'https://agent.brainonbnb.com', SITE_URL = 'https://brainonbnb.com';
const RPCS = ['https://bsc-dataseed.binance.org/', 'https://bsc.publicnode.com'];
const LOGS_RPC = 'https://bsc.publicnode.com'; // dataseed refuses eth_getLogs ranges
// the same node under its second address: asked when the first one turns a request away (2026-09-27)
const LOGS_RPCS = [LOGS_RPC, 'https://bsc-rpc.publicnode.com'];
// a swap paid out to one of these is BOBAI acting (buyback, tax swap), not a trader
const BOTS = ['0xdefc0e900dfc83e207902cf22265ae63f94c01ce', '0x15ba17075ef5e0736292b030e3715d9100fe3d38', '0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a'];
const whoTraded = x => x.who === 'tax' ? 'the token contract, swapping its collected tax, ' : x.who === BOTS[2] ? "BOBAI's DeFi agent " : x.who === BOTS[1] ? 'dev bot d38 ' : 'buyback bot 1ce ';
// d38 (the dev buyback bot) too: the Telegram bot ignores its buys (IGNORED_WALLETS), so no scene here either (2026-09-29)
const OURS = ['0xdefc0e900dfc83e207902cf22265ae63f94c01ce', '0x15ba17075ef5e0736292b030e3715d9100fe3d38', '0x245c386dcfed896f5c346107596141e5edcbffff', '0xbfaa69233741924ed5b9d5daa9b4bf7b84567f0a', '0x000000000000000000000000000000000000dead'];
const BOBAI = '0x245c386dcfed896f5c346107596141e5edcbffff', BW = '0xdeFC0e900Dfc83e207902cF22265Ae63f94c01ce';
const BOB = '0x51363f073b1e4920fda7aa9e9d84ba97ede1560e', WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const P = '0x6eadd4cb786898b34929444988380ed0cc6fd9a6', BOBP = '0x3c79593e01A7f7FeD5d0735B16621e2D52A6bC58'.toLowerCase();
const BNBFEED = '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE';
const EXACT = {}; // the exact dollars of NFT buys, asked once per tx (exactBuyUsd; declared up here: logs() starts it)
const SWAP = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const SYNC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'; // the pair's reserves after every swap (the live price)
const DEAD_BAL = '0x70a08231000000000000000000000000000000000000000000000000000000000000dEaD';
const balOf = a => '0x70a08231000000000000000000000000' + a.slice(2);
const TX = 'https://bscscan.com/tx/';
const BUYC = '#35e07a', SELLC = '#ff4d6d';
// a sell's tax light (2026-09-30, operator: "a buy sends a green dot of tax into the brain — a red one for a sell"): it
// was there, but red glows far weaker than green under the bloom — a deeper red, 40% bigger, so it reads as clearly
const SELL_DOT = '#ff2448', dotOf = buy => buy ? [BUYC, 1] : [SELL_DOT, 1.4];
// The terminal is opened on purpose, to watch BOBAI live — its motion IS the content. A system-wide 'reduce
// motion' (Windows turns it on with 'Animation effects' off) froze the figure and broke REPLAY for anyone who
// has it (2026-09-25, the operator's own PC). So it no longer stills the scene; a visitor who needs calm opens
// /?calm#brain, which keeps everything still exactly as before.
const REDUCED = /[?&]calm\b/.test(location.search);

// The split in force now (homepage "Tax Allocation Schedule", Sep 20 06:00 UTC → Nov 20, 2026).
// PREVIEW ONLY: before this ships it must read the phase from the one source the site uses.
const GIGGLE_DAY = Date.parse('2026-11-20T00:01:00Z');
const livePhase = () => (typeof window.__bobaiPhase === 'function' && window.__bobaiPhase()) || null;
const DEST = [
  { k: 'burnA',   name: 'BURN $BOBAI',    pct: 0.8, c: '#ff8a1f' },
  { k: 'burnB',   name: 'BURN $BOB',      pct: 0.3, c: '#ffc247' },
  { k: 'liq',     name: 'LIQ BOOST III',  pct: 0.5, c: '#2ee6c8' },
  { k: 'defi',    name: 'DEFI AGENT',     pct: 0.3, c: '#60a5fa' },
  { k: 'giggle',  name: 'GIGGLE POT',     pct: 0.3, c: '#f472b6' },
  { k: 'creator', name: 'CREATOR',  pct: 0.8, c: '#c9b8a8' },
];
const D = Object.fromEntries(DEST.map(d => [d.k, d]));
const TIERS = ['NICE BUY', 'BIG BUY', 'HUGE BUY', 'WHALE BUY', 'THUNDER BUY', 'KRAKEN BUY'];

// ================= helpers =================
const $ = id => document.getElementById(id === 'bt' ? 'bt' : 'bt-' + id);
const NF = {}; const nf = (n, d = 0) => (NF[d] || (NF[d] = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))).format(Number(n)); // one formatter per decimal count, kept: toLocaleString built a new one on every call (35x slower, 2026-10-06), same output
const cmp = n => Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
// the homepage cards print their BNB totals with four decimals
const bnb4 = n => (+n || 0).toFixed(4) + ' BNB';
const bnbF = n => `${nf(n, Number(n) < 0.1 ? 4 : 3)} BNB`;
const short = h => h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '';
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const u18 = h => (h && h !== '0x') ? Number(BigInt(h)) / 1e18 : 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
// ASKED, NOT RELOADED (2026-10-06): 'no-cache' asks the server every time, as fresh as before, but a file that has not
// changed answers 304 with no body (logs/*.json carry an ETag) — 'no-store' fetched the whole of it every 45 s
async function getJSON(u, ms = 15000) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(u, { cache: 'no-cache', signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}
async function rpc(calls, url) {
  const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c[0], params: c[1] })));
  const urls = Array.isArray(url) ? url : url ? [url] : RPCS;
  for (const [k, u] of urls.entries()) {
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json();
      /* a node that answers with a rate limit inside the batch hands over to the next one (2026-10-07); a plain revert does not (handing those over too sent the second node enough to answer 403); the last one's answer stands */
      if (Array.isArray(j) && j.length === calls.length) { const o = []; for (const x of j) o[x.id] = x.result ?? null; if (k < urls.length - 1 && j.some(x => x && x.error && (x.error.code === -32005 || /limit|rate|exceed|capacity|busy|timeout/i.test(x.error.message || '')))) continue; return o; }
    } catch {}
  }
  throw new Error('rpc');
}
const call = (to, data) => ['eth_call', [{ to, data }, 'latest']];

// ================= three.js scene =================
const win = $('win'), canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0b090a, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0, 0, 12);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.75, 0.4, 0.45);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// world anchors (set in layout)
const A = { fig: new THREE.Vector3(), head: new THREE.Vector3(), core: new THREE.Vector3(), src: new THREE.Vector3(), figH: 6.2 };
let viewW = 13, viewH = 8.7, portrait = false;
// THE WINDOW'S AND THE FIGURE'S BOX, READ ONCE PER FRAME (2026-10-06): toScreen ran for every ghost, label and piece,
// and each read after a style write forced the page to lay itself out again — on a phone the Halloween ghosts alone
// did it six times a frame. A frame reads each box once; a resize or a new layout reads it afresh.
let FRAME_N = 0; const RC = { n: -1, r: null }, RF = { n: -1, r: null };
addEventListener('resize', () => { RC.n = RF.n = -1; });

// ---------- the brain: a neural cloud that fires ----------
const MAXP = 8;
const pulseU = { value: Array.from({ length: MAXP }, () => new THREE.Vector4(0, 0, 0, -99)) };
const pulseC = { value: Array.from({ length: MAXP }, () => new THREE.Color(1, 1, 1)) };
let pulseIdx = 0;
const common = {
  uTime: { value: 0 }, uIntro: { value: 0 }, uPulse: pulseU, uPulseC: pulseC, uPx: { value: renderer.getPixelRatio() },
};
const PULSE_GLSL = `
  uniform float uTime; uniform float uIntro; uniform vec4 uPulse[${MAXP}]; uniform vec3 uPulseC[${MAXP}];
  vec3 firing(vec3 p, out float amt){
    vec3 col = vec3(0.0); amt = 0.0;
    for(int i=0;i<${MAXP};i++){
      float age = uTime - uPulse[i].w;
      if(age < 0.0 || age > 3.2) continue;
      float d = distance(p, uPulse[i].xyz);
      float front = age * 2.6;
      float w = exp(-pow((d - front) * 2.2, 2.0)) * (1.0 - age / 3.2);
      amt += w; col += uPulseC[i] * w;
    }
    return col;
  }`;
function brainPoints(n, R) {
  const pos = new Float32Array(n * 3), start = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    let x = s * Math.cos(th), y = u, z = s * Math.sin(th);
    const hemi = Math.sign(x) || 1;
    // cortex folds: ridges along the surface, a fissure between hemispheres
    const fold = 1 + 0.07 * Math.sin(9 * th + 4 * u) * Math.cos(7 * u + 2 * th) + 0.035 * Math.sin(23 * th + 17 * u);
    const shell = Math.random() < 0.78 ? 1 : Math.cbrt(Math.random()) * 0.92;
    // the fissure only a hint (2026-09-28): standing free beside him, a 9 % gap read as a brain cut in half
    x = x * 1.22 * R * fold * shell + hemi * 0.025 * R; y = y * 0.98 * R * fold * shell; z = z * 1.08 * R * fold * shell;
    if (y < -0.55 * R) y = -0.55 * R + (y + 0.55 * R) * 0.3; // flatter base
    pos.set([x, y, z], i * 3);
    const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1), rr = rnd(9, 16);
    start.set([rr * Math.sin(b) * Math.cos(a), rr * Math.cos(b), rr * Math.sin(b) * Math.sin(a) - 4], i * 3);
    seed[i] = Math.random();
  }
  return { pos, start, seed };
}
const brain = new THREE.Group(); scene.add(brain);
const NB = 5200;
const bp = brainPoints(NB, 1);
const bGeo = new THREE.BufferGeometry();
bGeo.setAttribute('position', new THREE.BufferAttribute(bp.pos, 3));
bGeo.setAttribute('aStart', new THREE.BufferAttribute(bp.start, 3));
bGeo.setAttribute('aSeed', new THREE.BufferAttribute(bp.seed, 1));
const bMat = new THREE.ShaderMaterial({
  uniforms: { ...common, uScale: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `${PULSE_GLSL}
    uniform float uPx; uniform float uScale; attribute vec3 aStart; attribute float aSeed; varying vec3 vCol; varying float vA;
    void main(){
      float k = smoothstep(0.0, 1.0, clamp(uIntro * 1.25 - aSeed * 0.25, 0.0, 1.0));
      vec3 p = mix(aStart, position * uScale, k);
      vec4 wp = modelMatrix * vec4(p, 1.0);
      float amt; vec3 fc = firing(wp.xyz, amt);
      float tw = 0.7 + 0.3 * sin(uTime * (0.45 + aSeed * 0.9) + aSeed * 40.0); // a slow, faint shimmer: the brain lights up for the chain's events, not on its own
      vec3 base = mix(vec3(0.95, 0.62, 0.42), vec3(1.0, 0.78, 0.25), aSeed);
      vCol = base * (0.24 + 0.16 * tw) + fc * 0.9;
      vA = (0.4 + 0.35 * tw) * k + amt * 0.5;
      vec4 mv = viewMatrix * wp;
      gl_PointSize = (1.4 + aSeed * 2.2 + amt * 2.2) * uPx * (10.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `varying vec3 vCol; varying float vA;
    void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if(d > 0.5) discard;
      gl_FragColor = vec4(vCol, vA * smoothstep(0.5, 0.0, d)); }`,
});
brain.add(new THREE.Points(bGeo, bMat));
// synapses between near neurons
let synapses;
{
  const idx = [], M = 1400, P3 = bp.pos;
  for (let i = 0; i < M; i++) {
    let best = [-1, -1], bd = [1e9, 1e9];
    for (let j = 0; j < M; j++) {
      if (i === j) continue;
      const dx = P3[i * 3] - P3[j * 3], dy = P3[i * 3 + 1] - P3[j * 3 + 1], dz = P3[i * 3 + 2] - P3[j * 3 + 2], d = dx * dx + dy * dy + dz * dz;
      if (d < bd[0]) { bd[1] = bd[0]; best[1] = best[0]; bd[0] = d; best[0] = j; } else if (d < bd[1]) { bd[1] = d; best[1] = j; }
    }
    for (const b of best) if (b > i && bd[best.indexOf(b)] < 0.06) idx.push(i, b);
  }
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.BufferAttribute(bp.pos, 3));
  lGeo.setAttribute('aStart', new THREE.BufferAttribute(bp.start, 3));
  lGeo.setAttribute('aSeed', new THREE.BufferAttribute(bp.seed, 1));
  lGeo.setIndex(idx);
  const lMat = new THREE.ShaderMaterial({
    uniforms: { ...common, uScale: bMat.uniforms.uScale }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `${PULSE_GLSL}
      uniform float uScale; attribute vec3 aStart; attribute float aSeed; varying vec3 vCol; varying float vA;
      void main(){ float k = smoothstep(0.6, 1.0, uIntro);
        vec4 wp = modelMatrix * vec4(position * uScale, 1.0); float amt; vec3 fc = firing(wp.xyz, amt);
        vCol = vec3(0.85, 0.55, 0.35) * 0.35 + fc * 0.8; vA = (0.18 + amt * 0.45) * k;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `varying vec3 vCol; varying float vA; void main(){ gl_FragColor = vec4(vCol, vA); }`,
  });
  synapses = new THREE.LineSegments(lGeo, lMat); brain.add(synapses);
}
// far dust
{
  const n = 900, pos = new Float32Array(n * 3), sd = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos.set([rnd(-16, 16), rnd(-10, 10), rnd(-14, -3)], i * 3); sd[i] = Math.random(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  scene.add(new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: common, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime; uniform float uPx; attribute float aSeed; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = 0.25 + 0.25 * sin(uTime * 0.7 + aSeed * 30.0);
        gl_PointSize = (0.8 + aSeed * 1.6) * uPx; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; if(length(c) > 0.5) discard; gl_FragColor = vec4(0.9, 0.85, 1.0, vA * 0.3); }`,
  })));
}

// ---------- glow sprites ----------
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.75)'); g.addColorStop(0.45, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}
const GLOW = glowTex();
function sprite(color, s) {
  const m = new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sp = new THREE.Sprite(m); sp.scale.set(s, s, 1); scene.add(sp); return sp;
}

// ---------- destinations, streams, charge ring ----------
// ---------- what BOBAI does, given a shape: a black hole for each burn, living liquid, a gyroscope, a coin ----------
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const keyLight = new THREE.PointLight(0xffd27a, 140, 40); keyLight.position.set(3, 3, 7); scene.add(keyLight);
const ADD = THREE.AdditiveBlending;
function vortex(color, R, n) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.3, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })));
  const geo = new THREE.BufferGeometry(), f = k => Float32Array.from({ length: n }, k);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aAng', new THREE.BufferAttribute(f(() => Math.random() * 6.283), 1));
  geo.setAttribute('aRad', new THREE.BufferAttribute(f(() => Math.random()), 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(f(() => Math.random()), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: common.uTime, uIntro: common.uIntro, uPx: common.uPx, uBoost: { value: 0 }, uR: { value: R }, uC: { value: new THREE.Color(color) } },
    transparent: true, depthWrite: false, blending: ADD,
    vertexShader: `uniform float uTime, uBoost, uR, uPx, uIntro; attribute float aAng, aRad, aSeed; varying float vL; varying float vA;
      void main(){
        float life = fract(aRad - uTime * (0.06 + uBoost * 0.15) * (0.6 + aSeed * 0.8));   // 1 = outer edge, 0 = swallowed
        float r = mix(0.28, 1.0, life) * uR;
        float a = aAng + uTime * (0.7 + uBoost * 1.2) / pow(max(r / uR, 0.28), 1.5);
        vec3 p = vec3(cos(a) * r, (aSeed - 0.5) * 0.05 * uR * life, sin(a) * r);
        vL = life; vA = smoothstep(0.0, 0.1, life) * smoothstep(1.0, 0.7, life) * uIntro;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.9 + (1.0 - life) * 1.7 + uBoost * 1.6) * uPx * (10.0 / -mv.z);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uC; uniform float uBoost; varying float vL; varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if(d > 0.5) discard;
        vec3 hot = mix(vec3(1.0, 0.96, 0.82), uC, smoothstep(0.05, 0.55, vL));
        gl_FragColor = vec4(hot * (0.5 + uBoost * 0.45), vA * 0.8 * smoothstep(0.5, 0.0, d)); }`,
  });
  const disk = new THREE.Points(geo, mat); disk.rotation.set(1.38, 0, 0.28); g.add(disk);
  const halo = new THREE.Mesh(new THREE.RingGeometry(R * 0.31, R * 0.345, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: ADD, side: THREE.DoubleSide }));
  g.add(halo); scene.add(g);
  g.userData.update = (dt, b) => { mat.uniforms.uBoost.value = b; halo.scale.setScalar(1 + b * 0.35); g.rotation.z = Math.sin(common.uTime.value * 0.3) * 0.08; };
  return g;
}
function liquid(color, R) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: common.uTime, uIntro: common.uIntro, uBoost: { value: 0 }, uC: { value: new THREE.Color(color) } }, transparent: true, depthWrite: false, blending: ADD,
    vertexShader: `uniform float uTime, uBoost; varying float vF; varying float vH;
      void main(){ float w = sin(position.x * 9.0 + uTime * 2.2) * sin(position.y * 7.0 + uTime * 1.7) * sin(position.z * 8.0 + uTime * 2.6);
        float ripple = sin(length(position.xy) * 30.0 - uTime * 12.0) * uBoost * 0.5;
        vec3 p = position + normal * (w * (0.05 + uBoost * 0.14) + ripple * 0.05); vH = w;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vec3 vn = normalize(normalMatrix * normal);
        vF = pow(1.0 - abs(dot(vn, normalize(-mv.xyz))), 2.2); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uC; uniform float uBoost, uIntro; varying float vF; varying float vH;
      void main(){ vec3 col = uC * (0.18 + vF * 1.7 + uBoost * 0.9) + vec3(0.8, 1.0, 0.9) * max(vH, 0.0) * 0.3;
        gl_FragColor = vec4(col, (0.22 + vF * 0.78) * uIntro); }`,
  });
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 24), mat), g = new THREE.Group(); g.add(m); scene.add(g);
  g.userData.update = (dt, b) => { mat.uniforms.uBoost.value = b; m.rotation.y += dt * 0.3; };
  return g;
}
function gyro(color, R) {
  const g = new THREE.Group(), rings = [];
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(R * (1 - i * 0.2), R * 0.028, 8, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: ADD })); g.add(m); rings.push(m); }
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(R * 0.24), new THREE.MeshBasicMaterial({ color: 0xdbeafe, wireframe: true, transparent: true, opacity: 0.9 })); g.add(core);
  scene.add(g);
  g.userData.update = (dt, b) => { const s = 1 + b * 1.6; rings[0].rotation.x += dt * 0.7 * s; rings[1].rotation.y += dt * 0.9 * s; rings[2].rotation.x += dt * 0.5 * s; rings[2].rotation.z += dt * 0.6 * s; core.rotation.y += dt * 1.4 * s; core.rotation.x += dt * 0.6 * s; };
  return g;
}
function coinObj(color, R) {
  const g = new THREE.Group(), spin = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.55, R * 0.12, 64), new THREE.MeshStandardMaterial({ color: 0xf5c542, metalness: 0.7, roughness: 0.3, emissive: 0x7a5200 }));
  face.rotation.x = Math.PI / 2; spin.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, R * 0.03, 8, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: ADD })); spin.add(rim);
  g.add(spin);
  const n = 160, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({ length: n }, () => Math.random()), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: common.uTime, uPx: common.uPx, uIntro: common.uIntro, uBoost: { value: 0 }, uR: { value: R }, uC: { value: new THREE.Color(color) } }, transparent: true, depthWrite: false, blending: ADD,
    vertexShader: `uniform float uTime, uPx, uBoost, uR; attribute float aSeed; varying float vA;
      void main(){ float t = fract(aSeed * 7.0 + uTime * (0.25 + uBoost * 0.9)); float a = aSeed * 40.0;
        vec3 p = vec3(cos(a) * uR * 0.6 * (0.3 + t), t * uR * 2.0 - uR * 0.2, sin(a) * uR * 0.6 * (0.3 + t));
        vA = (1.0 - t) * (0.35 + uBoost); vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.2 + aSeed * 2.0) * uPx * (10.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uC; uniform float uIntro; varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; if(length(c) > 0.5) discard; gl_FragColor = vec4(mix(uC, vec3(1.0, 0.85, 0.4), 0.4), vA * uIntro); }`,
  });
  g.add(new THREE.Points(geo, mat)); scene.add(g);
  g.userData.update = (dt, b) => { mat.uniforms.uBoost.value = b; spin.rotation.y += dt * (1.1 + b * 2.5); };
  return g;
}
const MAKE = { burnA: d => vortex(d.c, 0.62, 2600), burnB: d => vortex(d.c, 0.46, 1500), liq: d => liquid(d.c, 0.36), defi: d => gyro(d.c, 0.4), giggle: d => coinObj(d.c, 0.42) };
for (const d of DEST) {
  d.pos = new THREE.Vector3(); d.boost = 0;
  d.orb = sprite(new THREE.Color(d.c), 0.5); d.halo = sprite(new THREE.Color(d.c), 1.3); d.halo.material.opacity = 0.08;
  d.obj = MAKE[d.k] ? MAKE[d.k](d) : null;
  d.R = { burnA: 0.62, burnB: 0.46, liq: 0.4, defi: 0.42, giggle: 0.42 }[d.k] || 0.2;
  if (d.obj) d.orb.visible = false;
}
// shockwaves when something lands
const shocks = [];
function shock(pos, color, size = 2.6) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 128), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: ADD, side: THREE.DoubleSide }));
  m.position.copy(pos); m.scale.setScalar(0.1); scene.add(m); shocks.push({ m, t: 0, size });
}
function updShocks(dt) {
  for (let i = shocks.length - 1; i >= 0; i--) {
    const s = shocks[i]; s.t += dt / 1.8;
    if (s.t >= 1) { scene.remove(s.m); s.m.geometry.dispose(); shocks.splice(i, 1); continue; }
    s.m.scale.setScalar(s.size * (0.3 + 0.7 * (1 - Math.pow(1 - s.t, 3)))); s.m.material.opacity = 0.4 * (1 - s.t) * (1 - s.t);
  }
}
// camera: leans in toward what just happened, slowly, and settles back. No shake.
const cam = { push: new THREE.Vector3(), look: new THREE.Vector3() };
function focus(pos) { cam.push.copy(pos).multiplyScalar(0.1); cam.push.z = -0.5; }
const coreOrb = sprite(new THREE.Color('#F0B90B'), 0.7), coreHalo = sprite(new THREE.Color('#F0B90B'), 2.0); coreHalo.material.opacity = 0.08;
const srcOrb = sprite(new THREE.Color('#9ae6b4'), 0.45);
// charge ring = how far the collected tax is to the token's own swap (MIN_DISPATCH below), not the last run's size
// THE RING FILLS IN THE SIX COLOURS (operator, 2026-09-28: "fill the buyback circle like the detail ring, in the colours
// of the six places it goes, nicely transparent"): the filled arc is cut into the destinations' own colours, each as
// long as its share of the tax — so the circle already shows where the next buyback will go. The % is on the board only.
const ringBg = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.7, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false }));
const ringFgs = DEST.map(d => new THREE.Mesh(new THREE.RingGeometry(0.6, 0.68, 8, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: new THREE.Color(d.c), transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide /* the arcs run clockwise (negative angle) = their back faces the camera; single-sided they were culled, the old gold ring too */ })));
scene.add(ringBg, ...ringFgs);
let charge = 0, chargeShown = 0;
// THE REAL TRIGGER (read on-chain 2026-09-28, operator: "shows 100% but does not trigger"): the token contract swaps its
// collected tax to BNB — and sends it to the buyback wallet 1ce — only once feeAccumulated() reaches minDispatch()
// = 400,000 BOBAI, inside the next trade. The buyback bot then splits within 10 minutes (it runs from 0.004 BNB).
// The ring used to compare the queue with the LAST RUN's size, so it read 100% long before the swap could happen.
// read live since 2026-09-29 (minDispatch(), as Classic's fill bar): a changed threshold shows up by itself
let MIN_DISPATCH = 400000;
// 1ce keeps 0.003 BNB for gas and splits only above 0.004 (worker/index.js GAS_RESERVE + MIN_BNB): the reserve is not
// queued money, and BNB above it is split at the bot's next 10-minute check (audit 2026-09-28)
const splitBnb = () => S.walletBnb > 0.004 ? S.walletBnb - 0.003 : 0;
let ringP = -1;
window.__btRing = () => ringFgs.map(m => [m.visible, +(m.geometry.parameters.thetaLength || 0).toFixed(3), m.position.toArray().map(v => +v.toFixed(2)), m.material.opacity]); // for checks from outside (read-only)
function setRing(p) {
  if (Math.abs(p - ringP) < 0.002) return; ringP = p; // rebuilt only when the fill moves, not every frame
  const tot = DEST.reduce((a, d) => a + (d.pct > 0 ? d.pct : 0), 0) || 1; let at = Math.PI / 2;
  DEST.forEach((d, i) => {
    const m = ringFgs[i], len = d.pct > 0 ? Math.max(0, p) * Math.PI * 2 * d.pct / tot : 0;
    m.geometry.dispose(); m.geometry = new THREE.RingGeometry(0.58, 0.7, Math.max(4, Math.ceil(len * 16)), 1, at, -Math.max(0.0005, len)); m.visible = len > 0.0005;
    at -= len;
  });
}

// stream particles: count by share, so the thickness IS the split
const streams = [];
const SP = 170; // particles per 1% of tax
function buildStreams() {
  for (const s of streams) { scene.remove(s.pts); s.pts.geometry.dispose(); }
  streams.length = 0;
  for (const d of DEST) {
    if (!(d.pct > 0)) continue;
    const a = A.core.clone(), b = d.pos.clone();
    const mid = a.clone().lerp(b, 0.5); mid.y += (b.y - a.y) * 0.15 + 0.2; mid.z += 1.2;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const n = Math.round(d.pct * SP), pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.1, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    scene.add(pts);
    const width = 0.05 + d.pct * 0.16;
    streams.push({ d, curve, pts, n, off: Float32Array.from({ length: n }, () => Math.random()), jit: Array.from({ length: n }, () => [rnd(-1, 1) * width, rnd(-1, 1) * width, rnd(-1, 1) * width]), spd: Float32Array.from({ length: n }, () => rnd(0.8, 1.2)) });
  }
}
const tmpV = new THREE.Vector3(), cA = new THREE.Color(), cB = new THREE.Color('#fff4d6'), TMPC = new THREE.Color();
function updStreams(dt) {
  for (const s of streams) {
    const P3 = s.pts.geometry.attributes.position.array, C3 = s.pts.geometry.attributes.color.array;
    const boost = s.d.boost, speed = 0.05 + boost * 0.22;
    cA.set(s.d.c);
    for (let i = 0; i < s.n; i++) {
      s.off[i] = (s.off[i] + dt * speed * s.spd[i]) % 1;
      const t = s.off[i];
      s.curve.getPoint(t, tmpV);
      const taper = Math.sin(t * Math.PI);
      P3[i * 3] = tmpV.x + s.jit[i][0] * taper; P3[i * 3 + 1] = tmpV.y + s.jit[i][1] * taper; P3[i * 3 + 2] = tmpV.z + s.jit[i][2] * taper;
      const br = (0.7 + boost * 0.7) * (0.35 + 0.65 * taper) * clamp(introK * 1.5 - 0.5, 0, 1);
      const c = TMPC.copy(cA).lerp(cB, boost * 0.5); // one colour object for all, not 500 new ones a frame (2026-10-05)
      C3[i * 3] = c.r * br; C3[i * 3 + 1] = c.g * br; C3[i * 3 + 2] = c.b * br;
    }
    s.pts.geometry.attributes.position.needsUpdate = true; s.pts.geometry.attributes.color.needsUpdate = true;
    s.d.boost = Math.max(0, s.d.boost - dt * 0.3);
  }
}
// comets: one-off flights (a trade flying in, a run leaving)
const comets = [];
function comet(from, to, color, dur = 1.1, onDone, size = 1) {
  const cs = (portrait ? 0.55 : 1) * size, sp = sprite(new THREE.Color(color), 0.45 * cs), trail = [];
  for (let i = 0; i < 10; i++) { const t = sprite(new THREE.Color(color), 0.4 * cs * (1 - i / 11)); t.material.opacity = 0.5 * (1 - i / 10); trail.push(t); }
  const mid = from.clone().lerp(to, 0.5); mid.y += 0.9; mid.z += 1.5;
  comets.push({ sp, trail, curve: new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone()), t: 0, dur, onDone });
}
function updComets(dt) {
  for (let i = comets.length - 1; i >= 0; i--) {
    const c = comets[i]; c.t += dt / c.dur;
    if (c.t >= 1) { scene.remove(c.sp); c.trail.forEach(t => scene.remove(t)); comets.splice(i, 1); c.onDone && c.onDone(); continue; }
    const e = 1 - Math.pow(1 - c.t, 2);
    c.curve.getPoint(e, c.sp.position);
    c.trail.forEach((t, k) => c.curve.getPoint(Math.max(0, e - (k + 1) * 0.025), t.position));
  }
}
function fire(pos, color) {
  pulseU.value[pulseIdx].set(pos.x, pos.y, pos.z, common.uTime.value);
  pulseC.value[pulseIdx].set(color);
  pulseIdx = (pulseIdx + 1) % MAXP;
}

// ---------- the workers: satellites that orbit the brain and flare on every real heartbeat ----------
const WORKERS = [
  { k: 'buyback', name: 'BUYBACK BOT', c: '#F0B90B', every: 'every 10 min' },
  { k: 'dev',     name: 'DEV BOT', c: '#ffcf6b', every: 'hourly' },
  { k: 'lp',      name: 'DEFI AGENT', c: '#60a5fa', every: 'hourly check' },
  { k: 'agent',   name: 'AGENT SERVER', c: '#22d3ee', every: 'serves agents & apps' },
  { k: 'nft',     name: 'NFT WATCHER', c: '#a78bfa', every: 'watches every buy' },
];
const W = Object.fromEntries(WORKERS.map(w => [w.k, w]));
for (const [i, w] of WORKERS.entries()) { w.ph = i / WORKERS.length * Math.PI * 2; w.pos = new THREE.Vector3(); w.sp = sprite(new THREE.Color(w.c), 0.34); w.flare = 0; w.last = 0; }
// faint orbit path
const orbit = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xc68f76, transparent: true, opacity: 0.16 }));
scene.add(orbit);
function orbitPt(a, out) { const rx = A.figH * (portrait ? 0.62 : 0.6) /* wide screen: AROUND the brain (its half-width is 0.45 figH), between the left edge and him */, rz = A.figH * 0.3; return out.set(A.head.x + Math.cos(a) * rx, A.head.y + 0.25 + Math.sin(a) * rz * 0.28, A.head.z + Math.sin(a) * rz); }
function buildOrbit() { const pts = []; for (let i = 0; i < 128; i++) pts.push(orbitPt(i / 128 * Math.PI * 2, new THREE.Vector3())); orbit.geometry.dispose(); orbit.geometry = new THREE.BufferGeometry().setFromPoints(pts); }
function beat(k, text, n = 1) {
  const w = W[k]; w.flare = 1.4; w.last = Date.now(); w.beats = (w.beats || 0) + 1;
  // a bot's step is an action on the chain and lights the brain; the agent server answering strangers is not — its
  // satellite flares, the brain stays calm (it answered every few seconds and kept the brain flashing)
  if (k !== 'agent') for (let i = 0; i < Math.min(n, 5); i++) setTimeout(() => comet(w.pos, A.head, w.c, 0.8, () => fire(A.head, new THREE.Color(w.c))), i * 160);
  if (text) logLine('BOBAI', w.c, ["BOBAI's ", [w.name.toLowerCase()], ' ' + text]);
  atWork(k);
}
// HE IS SEEN AT WORK (2026-09-26): when one of his bots beats, he says what it just did, with its real result — at
// most once in ten minutes, and only when the stage is free (a scene, a reader's focus or a line of his go first).
function atWork(k) {
  const now = performance.now();
  if (mode !== 'live' || !opened || now < (LIFE.workAt || 0) || poseT > 0 || pinnedK || QUEUE.length || now < sceneUntil + 2500 || now < LIFE.sayUntil) return;
  const rb = S.lp?.last?.steps?.rebalance, inr = lpNow().inR;
  const left = Math.max(0, Math.round(charge * 100));
  const said = {
    // five ways each (2026-10-02)
    lp: () => [poseOr('defi'), inr === false ? vary('v1', ['Checked my CAKE/BNB range: the price stepped outside, so I wait beside it.', 'My DeFi agent looked: the price is outside its range. It waits, it does not chase.',
      'Range check done. Outside for now, so no fees. Patience is part of the strategy.', 'CAKE/BNB moved out of my range. My DeFi agent sits tight until it comes back.', 'DeFi check: out of range at the moment. Waiting is cheaper than chasing.'])
      : vary('v2', ['Checked my CAKE/BNB range: in range, earning fees.', 'My DeFi agent looked: right in its range, collecting fees.', 'Range check done. In range, fees coming in.', 'CAKE/BNB is inside my range. My DeFi agent earns while I talk.', 'DeFi check: in range. Every swap through the pool pays it a little.'])],
    buyback: () => [poseOr('think'), splitBnb() > 0 ? vary('v3', [`Buyback bot: ${bnbF(splitBnb())} is ready to split at its next check.`, `${bnbF(splitBnb())} waits in my buyback bot. It splits at the next check.`, `My buyback bot holds ${bnbF(splitBnb())}. The burns are coming up.`, `Ready to split: ${bnbF(splitBnb())}. The next check does it.`, `The buyback bot found ${bnbF(splitBnb())}. Splitting it soon.`])
      : S.queued >= MIN_DISPATCH ? vary('v4f', ['My tax queue is full. The token swaps it to BNB inside one of the next trades, then my bot splits it.', `Full queue: ${cmp(S.queued)} BOBAI of tax, waiting for the next trade to swap it.`, 'The tax queue reached its mark. One of the next trades carries the swap, then the burns follow.',
        'Queue full, swap pending. The token does it inside a trade, not on a timer.', `${cmp(S.queued)} BOBAI of tax is ready. The next trade or two turns it into BNB for my bots.`])
      : vary('v4', [`The tax is ${left}% of the way to the token's ${cmp(MIN_DISPATCH)} swap. Then my bot splits it.`, `Charging: ${left}% of the way to the next ${cmp(MIN_DISPATCH)} tax swap.`, `My tax queue is ${left}% full. At ${cmp(MIN_DISPATCH)} BOBAI it turns into BNB for the bots.`, `${left}% to the next tax swap. Every trade adds a little.`, `Buyback bot checked in. The tax queue is ${left}% of the way to ${cmp(MIN_DISPATCH)}.`])],
    agent: () => [poseOr('think'), vary('v5', agentLines())],
  }[k];
  if (!said) return;
  // the agent server answers strangers many times an hour: it gets a line at most every half hour, the bots keep their turn
  if (k === 'agent') { if (now < (LIFE.agentSaidAt || 0)) return; LIFE.agentSaidAt = now + 1800e3; }
  const [p, line] = said(); LIFE.workAt = now + 600e3; LIFE.next = Math.max(LIFE.next, now + 60e3);
  setPose(p, 5); speak(line, 5200);
}

// ================= the split in force =================
function applyPhase() {
  ringP = -1; // a new split table redraws the ring's colours
  const p = livePhase(); if (!p) { $('phase').textContent = ''; return; }
  const n = v => parseFloat(v) || 0;
  const pct = { burnA: n(p.bobaiPct), burnB: n(p.bobPct), liq: n(p.liqPct), defi: n(p.lpPct), giggle: n(p.gigglePct), creator: n(p.creatorPct) };
  for (const d of DEST) {
    d.pct = pct[d.k]; const on = d.pct > 0;
    d.el.style.display = on ? '' : 'none'; if (d.obj) d.obj.visible = on; d.orb.visible = on && !d.obj; d.halo.visible = on;
    d.el.querySelector('.pc').textContent = d.pct + '%';
  }
  const end = isFinite(p.end) ? new Date(p.end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  $('phase').textContent = 'The 3% split in force' + (end ? ' until ' + end : '') + ' — the same split as in window 02, Tokenomics.';
  buildStreams();
}

// ================= layout =================
const fig = $('fig');
// TELL ME A JOKE (operator, 2026-09-29: "a nice button under BOBAI, below the yellow shadow: click it and he tells a
// joke and laughs — one of the two videos"). It stands on its own in the window (the figure layer lets clicks through
// and fades while a clip plays) and follows his feet in placeLabels(). The click is handled by jokeTap().
const jokeBtn = document.createElement('button');
jokeBtn.type = 'button'; jokeBtn.className = 'joke'; jokeBtn.id = 'bt-joke';
// the badge: a small laughing face, drawn (no emoji) — "HA" read as a mystery (operator, 2026-09-29)
jokeBtn.innerHTML = '<span class="jk-ha" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M6.5 9.5q1.5-2 3 0M14.5 9.5q1.5-2 3 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M6 13h12q-.6 5.5-6 5.5T6 13z" fill="currentColor"/></svg></span><span class="jk-th" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="9" cy="9.2" r="1.5" fill="currentColor"/><circle cx="15.5" cy="8.6" r="1.5" fill="currentColor"/><path d="M7.8 14q4.2 4.2 8.4 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg></span><span class="jk-t">Tell me a joke</span><span class="jk-d" aria-hidden="true"><i></i><i></i><i></i></span>';
win.appendChild(jokeBtn);
// the phone scene's scale: 1 until fitPortrait() finds the lowest label under the view tabs, then smaller step by step
const FIT = { scale: 1, tries: 0, at: 0 };
function fitPortrait(now) {
  if (!portrait || FIT.tries > 12 || now < FIT.at) return;
  FIT.at = now + 250;
  const bar = $('mtabs'), labsEls = DEST.filter(d => d.pct > 0).map(d => d.el); if (!bar || !labsEls.length) return;
  const floor = bar.getBoundingClientRect().top - 6, low = Math.max(...labsEls.map(e => e.getBoundingClientRect().bottom));
  if (low <= floor) { FIT.tries = 99; return; }
  FIT.scale *= Math.max(0.8, Math.min(0.97, 1 - (low - floor) / 900)); FIT.tries++; layout();
}
// A near-square or narrow window takes the stacked layout too (2026-09-29, operator: iPad): at 1180x740 landscape the
// terminal is 630x660 and the wide layout's label column ran past its right edge (five labels cut, 1280x800 one).
const portraitNow = r => r.height > r.width * 0.95 || r.width < 680;
function layout() {
  RC.n = RF.n = -1;
  const r = win.getBoundingClientRect(); if (!r.width) return;
  renderer.setSize(r.width, r.height, false); composer.setSize(r.width, r.height);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  viewH = 2 * 12 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)); viewW = viewH * camera.aspect;
  portrait = portraitNow(r); win.classList.toggle('portrait', portrait);
  // a short wide window (a 1280x720 laptop: the terminal is ~570x480 in the new page) has no room for the grey second
  // line under each label: six of them overlapped their neighbours (2026-09-27). The figures stay, the detail goes.
  win.classList.toggle('tight', !portrait && r.height < 700);
  const tlH = (portraitNow(r) ? 170 : 112) / r.height * viewH; // phone: timeline + view tabs // timeline eats the bottom
  if (portrait) {
    // The two rows of destinations must end above the view tabs and the timeline on every phone: on a 360x640 screen
    // the second row (DeFi agent, Giggle pot, creator) sat 54 px under the tabs (measured 2026-09-26). So BOBAI and
    // the brain shrink, step by step, until the lower row's labels (about 80 px) clear the bottom stack.
    // (measured, not guessed: fitPortrait() below reads where the lowest label really ends and shrinks the scale)
    A.figH = Math.min(viewH * 0.42, viewW * 1.15) * FIT.scale; // larger again once the labels lost their figures (2026-09-27); fitPortrait shrinks it where a phone is short // larger than before: the destinations below are smaller now (operator, 2026-09-26)
    A.fig.set(0, viewH / 2 - viewH * 0.11 - A.figH / 2, 0);
  } else {
    A.figH = Math.min(viewH * 0.61, viewW * 0.40); // a little larger since the labels carry no figures (2026-09-27)
    // a step right, and in a short window (tight) a step up: his legs stay clear of the log box (2026-09-27)
    A.fig.set(0, -viewH / 2 + tlH + A.figH / 2 + viewH * (r.height < 700 ? 0.19 : 0.12), 0);
  }
  // wide screen: the hologram brain and its ring of bots sit a step left of him (operator, 2026-09-28), clear of the buyback ring
  // wide screen: at the left edge, clear of him (operator, 2026-09-28: "at the edge, not behind BOBAI")
  A.head.set(A.fig.x - (portrait ? 0 : viewW * 0.26), A.fig.y + A.figH * 0.29, -1.2);
  if (portrait) A.core.set(A.fig.x, A.fig.y - A.figH * 0.54, 0.8);
  else A.core.set(A.fig.x + viewW * 0.145, A.fig.y + A.figH * 0.06, 0.8);
  // wide screen: the trades sit bottom left, just above the log box (its tallest: 128 px from the bottom + 176 px)
  A.src.set(-viewW / 2 + (portrait ? 0.45 : viewW * 0.12), portrait ? A.fig.y + A.figH * 0.05 : -viewH / 2 + (r.height < 700 ? 250 : 345) / (r.height / viewH), 0);
  brain.position.copy(A.head);
  bMat.uniforms.uScale.value = A.figH * (portrait ? 0.34 : 0.37); // the bots' ring runs around it, not through it (2026-09-28) // wide screen: fits between the edge and him
  const n = DEST.length;
  DEST.forEach((d, i) => {
    if (portrait) {
      // 0.55 below the core, not 0.95: labels that wrap on a 360-390 px phone kept the second row clear of the view tabs (A3, 2026-09-25)
      // a little further apart (operator, 2026-10-05: "give the six points on the phone a bit more distance"): the rows
      // gain what the names gave back by moving nearer to their lights (placeLabels, --off)
      d.pos.set((i % 3 - 1) * viewW * 0.325, A.core.y - 0.5 - Math.floor(i / 3) * 1.1, 0);
    } else {
      const top = viewH / 2 - viewH * 0.16, bot = -viewH / 2 + tlH + viewH * 0.1;
      const y = top - i * (top - bot) / (n - 1);
      const x = viewW * 0.255 + Math.sin(i / (n - 1) * Math.PI) * viewW * 0.03;
      d.pos.set(x, y, 0);
    }
    d.orb.position.copy(d.pos); d.halo.position.copy(d.pos); if (d.obj) d.obj.position.copy(d.pos);
    d.mScale = portrait ? 0.5 : 1;
  });
  coreOrb.position.copy(A.core); coreHalo.position.copy(A.core); srcOrb.position.copy(A.src);
  ringBg.position.copy(A.core); for (const m of ringFgs) m.position.copy(A.core);
  const rs = portrait ? 0.5 : 1; ringBg.scale.setScalar(rs); for (const m of ringFgs) m.scale.setScalar(rs); // phone: it covered the BOB orb (2026-09-28)
  buildStreams(); buildOrbit();
  // figure: DOM image sized from world units
  const pxPerUnit = r.height / viewH, h = A.figH * pxPerUnit, w = h * (683 / 1024);
  camera.updateMatrixWorld();
  A.figW = w; A.figHpx = h;
  // BOBAI's place on the screen, from the camera AT REST: he is a picture in front of the scene, and following the
  // camera's lean and push every frame made him lurch whenever a big moment moved it (2026-09-26, "krasse Wackler")
  { const p0 = camera.position.clone(); camera.position.set(0, 0, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    A.figScreen = toScreen(A.fig); camera.position.copy(p0); camera.lookAt(cam.look.x, cam.look.y, 0); camera.updateMatrixWorld(); }
  Object.assign(fig.style, { width: w + 'px', height: h + 'px' });
}
// where the log box sits inside the window, re-read once a second: it changes width with a transition, and a read at
// layout time caught it halfway (2026-09-27)
const LOGBOX = { right: 0, top: 0, at: 0 };
let SRCH = 0; addEventListener('resize', () => { SRCH = 0; });
function logBox() {
  if (performance.now() - LOGBOX.at < 1000) return LOGBOX;
  const t = win.querySelector(".term"), tr = t && t.getBoundingClientRect(), r = win.getBoundingClientRect();
  LOGBOX.right = tr && tr.width ? tr.right - r.left : 0; LOGBOX.top = tr && tr.width ? tr.top - r.top : 0; LOGBOX.at = performance.now();
  return LOGBOX;
}
const pv = new THREE.Vector3();
const winBox = () => { if (RC.n !== FRAME_N || !RC.r) { RC.r = win.getBoundingClientRect(); RC.n = FRAME_N; } return RC.r; };
function toScreen(v) { const r = winBox(); pv.copy(v).project(camera); return { x: (pv.x + 1) / 2 * r.width, y: (1 - pv.y) / 2 * r.height }; }

// ================= labels =================
const labs = $('labs');
function mkLab(cls, c) { const d = document.createElement('div'); d.className = 'lab ' + cls; if (c) d.style.setProperty('--c', c); labs.appendChild(d); return d; }

for (const d of DEST) {
  d.el = mkLab('dest', d.c);
  d.el.innerHTML = `<div class="n">${d.name}<span class="pc">${d.pct}%</span></div><div class="v">…</div><div class="s"></div>`;
}
const coreLab = mkLab('core'); coreLab.innerHTML = '<div class="n">NEXT BUYBACK</div><div class="v">…</div><div class="s"></div><div class="s cd"></div>';
const srcLab = mkLab('src'); srcLab.innerHTML = '<div class="n"><span>TRADES</span><span class="sep"> · </span><span>3% TAX</span></div><div class="s">each buy &amp; sell on PancakeSwap</div>';
for (const w of WORKERS) { w.el = mkLab('wk', w.c); w.el.innerHTML = `<b>${w.name}</b><i>…</i>`; }

// ================= focus: point at a part of BOBAI, he shows it and the panel explains it =================
// Hover previews, click pins. With nothing chosen he stands in his base pose; an event still takes over
// for a moment and he returns to whatever is chosen.
const POSE_OF = { follow: 'idle', burnA: 'burn', burnB: 'burn', liq: 'liq', defi: 'defi', giggle: 'giggle', creator: 'idle', core: 'burn', src: 'idle',
  buyback: 'burn', dev: 'idle', lp: 'defi', agent: 'idle', nft: 'giggle' };
let focusK = null, pinnedK = null;
const detail = $('detail');
const bsc = a => 'https://bscscan.com/address/' + a;
const agoL = t => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const week = t => Date.parse(t) >= Date.now() - 7 * 86400e3;
function info(k) {
  if (k === 'follow') return FOLLOW;
  const lastRun = S.burns[S.burns.length - 1], wk = S.burns.filter(e => week(e.time));
  const sum = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
  const lp = S.lp, rb = lp?.last?.steps?.rebalance, chk = lp?.last_check?.steps?.increase;
  const boost = boost3();
  switch (k) {
    case 'burnA': return { t: 'BOBAI burns BOBAI', c: D.burnA.c, rows: [
      ['At the dead address', nf(S.deadA || 0) + ' BOBAI'], ['Share of supply', supplyPct(S.deadA || 0) + '%'],
      ['Worth today', '$' + nf((S.deadA || 0) * S.price)], ['By the bot, all time', nf(sum(S.burns, e => e.bobaiBurned)) + ' BOBAI'], ['By the bot, last 7 days', nf(sum(wk, e => e.bobaiBurned)) + ' BOBAI'],
      ['Bot burn runs', nf(S.burns.length)], ['Last burn', agoL(lastRun && Date.parse(lastRun.time))]],
      note: pctOf('burnA') + ' of every trade buys BOBAI back and sends it to the dead address. Gone for good.',
      links: [['last burn tx', lastRun && TX + lastRun.bobaiBurnTx], ['dead address', bsc('0x000000000000000000000000000000000000dEaD')]] };
    case 'burnB': return { t: 'BOBAI burns $BOB', c: D.burnB.c, rows: [
      ['BOB at the dead address (everyone)', cmp(S.deadB || 0) + ' BOB'], ['BOBAI’s part, worth today', '$' + nf(sum(S.burns, bobOf) * S.bobP)],
      ['By BOBAI’s bot, all time', cmp(sum(S.burns, bobOf)) + ' BOB'], ['Share of all BOB burned', S.deadB ? (sum(S.burns, bobOf) / S.deadB * 100).toFixed(1) + '%' : '…'], ['Last 7 days', cmp(sum(wk, bobOf)) + ' BOB']],
      note: pctOf('burnB') + ' of every trade buys $BOB (Build On BNB) and burns it — BOBAI feeding the chain it was born on.',
      links: [['last burn tx', lastRun && TX + lastRun.bobBurnTx]] };
    case 'liq': return { t: 'BOBAI adds liquidity', c: D.liq.c, rows: [
      ['Liq Boost III adds', nf(boost.n)], ['BNB added', bnb4(boost.bnb)], ['LP burned (Boost III)', nf(boost.lp, 2)],
      ['All bot adds', nf(S.liq.length)], ['Pool LP locked', lpText()]],
      note: pctOf('liq') + ' of every trade is added to the BOBAI/BNB pool and the LP tokens are burned. Nobody can pull it.',
      links: [['last add tx', S.liq.length && TX + S.liq[S.liq.length - 1].addLiqTx], ['pool', bsc(P)]] };
    case 'defi': case 'lp': return { t: "BOBAI's DeFi agent", c: D.defi.c, rows: [
      ['Working capital', rb ? bnbF(lpNow().value ?? 0) : '…'], ['Range', lpNow().inR === false ? 'OUT of range' : 'in range'],
      ['Pool', 'CAKE/BNB 0.05%'], ['Fees earned', lp?.flow?.in?.fees ? bnbF(lp.flow.in.fees.bnb) : '…'],
      ['BOBAI it holds', cmp(lp?.flow?.out?.bobai_units || 0)], ['Last check', agoL(Date.parse(lp?.last_check?.at || lp?.last?.at))]],
      note: 'Gets ' + pctOf('defi') + ' of every trade, provides liquidity on PancakeSwap V3, and half of what it earns buys BOBAI it keeps.',
      links: [['agent wallet', bsc('0xbFAA69233741924eD5b9d5DAA9B4Bf7B84567F0A')], ['full record', SITE + '/liquidity']] };
    case 'giggle': return { t: 'The Giggle Academy pot', c: D.giggle.c, rows: [
      ['In the pot', bnb4(ggBnb())], ['Worth', '$' + nf(ggBnb() * S.bnbP, 2)],
      ['Sends so far', nf(S.burns.filter(e => e.giggleTx).length)], ['Donated on', 'Nov 20, 2026 · World Children’s Day']],
      note: GIGGLE_OPEN() ? pctOf('giggle') + ' of every trade collects here. On Nov 20 it all goes to Giggle Academy, and the receipt is posted.'
        : 'The pot went to Giggle Academy on Nov 20, World Children’s Day. The transfer is on BscScan: tap the pot wallet.',
      links: [['pot wallet', bsc('0x5E4102520A71B2AA18a1208330d4848dea4BD105')]] };
    case 'creator': case 'dev': { const dv = S.dev[S.dev.length - 1]; return { t: 'Creator share → d38', c: D.creator.c, rows: [
      ['Share of each trade', pctOf('creator')], ['Last in from 1ce', lastRun ? bnbF(lastRun.creatorBnb) : '…'], ['Last payout from d38', dv ? bnbF(dv.availableBnb) : '…'],
      ['Payout split', '80% creator · 20% to 6 builders'] /* builder #6 from 1.10. (worker-dev-buyback 32bc2ff) */, ['Dev bot runs', 'hourly · last ' + agoL(W.dev.last)]],
      note: 'The 1ce bot sends the creator share to d38; the dev bot pays it out every hour. Both wallets are public.',
      links: [['d38 wallet', bsc('0x15Ba17075ef5E0736292b030e3715d9100fe3d38')]] }; }
    case 'core': case 'buyback': return { t: 'The buyback bot · 1ce', c: '#F0B90B', rows: [
      ['Tax queued in the token', nf(S.queued) + ' BOBAI'], ['BNB in 1ce', S.walletBnb.toFixed(4) + ' BNB' + (splitBnb() > 0 ? '' : ' · gas')],
      ['Queued, in dollars', '$' + nf(S.queued * S.price + splitBnb() * S.bnbP, 2)], ['Runs', 'every 10 min · last ' + agoL(W.buyback.last)],
      ['Last split', lastRun ? bnbF(lastRun.totalBnb) + ' · ' + agoL(Date.parse(lastRun.time)) : '…']],
      note: `Every trade pays 3% tax into the token. At ${cmp(MIN_DISPATCH)} BOBAI the token swaps it to BNB for this wallet, inside a trade; the bot then splits it ${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][DEST.filter(d => d.pct > 0).length] || 'several'} ways within 10 minutes. 0.003 BNB stays here for gas.`,
      links: [['1ce wallet', bsc(BW)]] };
    case 'agent': { const k = S.kinds || {}; return { t: "BOBAI's agent server", c: W.agent.c, rows: [
      ['Tool calls by agents and apps today', nf(HB.agent || 0)], ['Menu checks by registries', nf(HB.agentMenu || 0)], ['All requests incl. crawlers', nf(HB.agentAll || 0)],
      ['Discovery reads', nf(k.discovery || 0)], ['Hire / jobs / dispatch', nf((k.hire || 0) + (k.job || 0) + (k.dispatch || 0))], ['Last request', agoL(W.agent.last)]],
      note: 'Tool calls = another agent or app actually used one of BOBAI’s tools (MCP, REST API, paid answers). Menu checks = a registry or agent read the tool list. The last row counts everything, crawlers included. BOBAI’s own sweeps are in none of them.',
      links: [['services', SITE + '/services'], ['raw counts', AG + '/stats']] }; }
    case 'nft': return { t: 'BOBAI drops NFTs', c: '#a78bfa', rows: [
      ['Dropped', nf((S.nft?.minted || []).reduce((a, b) => a + b, 0)) + ' of ' + nf((S.nft?.cap || []).reduce((a, b) => a + b, 0) || 1925)], ['Holders', nf(S.nft?.holders || 0)],
      ['Latest', S.nft?.drops?.length ? '#' + S.nft.drops[0].tokenId + ' · $' + nf(S.nft.drops[0].usd || 0) + ' buy' : '…']],
      note: 'Every buy of $100 or more mints an NFT straight into the buyer’s wallet. No claim, no gas for the holder.',
      links: [['collection', SITE + '/nft/']] };
    case 'src': return { t: 'Every trade feeds BOBAI', c: '#9ae6b4', rows: [
      // the day's trades from the ledger, not the few seen since the page opened ("2" read as a dead pool, 2026-09-27)
      ...(chartWords() ? [['Trades, last 24 hours', nf(chartWords().n) + ' · ' + chartWords().s]] : [['Trades seen since you opened this', nf(S.hist.filter(e => e.t >= liveSince).length)]]), ['Tax on each', '3% of the trade'], ['Price', '$' + (S.price ? S.price.toFixed(7) : '…')]],
      note: 'Each buy and sell on PancakeSwap pays 3%. That is the fuel this brain runs on.', links: [['pool', bsc(P)]] };
  }
}
// ---------- the detail as a board too (2026-09-26, operator: "the flipchart where the text is now") ----------
// Tap or hover anything and BOBAI's board shows its figures and one diagram — the last 14 days of it, what is charged,
// where the range stands — instead of a paragraph. Every bar is a day of our own logs; nothing is estimated.
const dayOf = t => Math.floor(t / 86400e3);
function perDay(list, tf, vf, days = 14) {
  const today = dayOf(Date.now()), v = new Array(days).fill(0);
  for (const x of list || []) { const t = tf(x), i = days - 1 - (today - dayOf(t)); if (Number.isFinite(t) && i >= 0 && i < days) v[i] += +vf(x) || 0; }
  return v;
}
function barsHtml(vals, cap, fmt) {
  const mx = Math.max(...vals) || 1;
  return `<div class="db"><div class="db-c">${cap}</div><div class="db-b">${vals.map((v, i) => `<i style="--h:${Math.max(v > 0 ? 4 : 1, v / mx * 100).toFixed(1)}%;--i:${i}"${v > 0 ? '' : ' class="z"'}></i>`).join('')}</div>`
    + `<div class="db-x"><span>14 DAYS AGO</span><span>${vals[vals.length - 1] > 0 ? `TODAY <b>${fmt(vals[vals.length - 1])}</b>` : 'TODAY · NONE YET (UTC)'}</span></div></div>`;
}
function hbarsHtml(list, cap) {
  const mx = Math.max(...list.map(x => x[1])) || 1;
  return `<div class="db"><div class="db-c">${cap}</div>${list.map(([l, v], i) => `<div class="dh-r"><span>${l}</span><i style="--w:${(v / mx * 100).toFixed(1)}%;--i:${i}"></i><b>${nf(v)}</b></div>`).join('')}</div>`;
}
function ringHtml(parts, mid, cap) {
  const R = 26, C = 2 * Math.PI * R, tot = parts.reduce((a, p) => a + p[0], 0) || 1; let off = 0, arcs = '';
  parts.forEach(([v, col], i) => { const len = v / tot * C; if (len > 0) arcs += `<circle r="${R}" cx="34" cy="34" style="--sc:${col};--len:${len.toFixed(2)};--c0:${C.toFixed(2)};--i:${i}" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`; off += len; });
  return `<div class="db"><div class="db-c">${cap}</div><div class="fl-d"><svg viewBox="0 0 68 68" aria-hidden="true"><circle class="fl-bg" r="${R}" cx="34" cy="34"/>${arcs}<text x="34" y="37.5" text-anchor="middle">${mid}</text></svg>`
    + `<div class="fl-k">${parts.map(([v, col, lab, txt]) => `<span style="--sc:${col}"><em></em>${lab}<b>${txt ?? Math.round(v / tot * 100) + '%'}</b></span>`).join('')}</div></div></div>`;
}
// WHERE THE AGENT STANDS NOW (2026-10-07, operator: "the DeFi range does not show correctly in the terminal"): after a
// re-set the rebalance step's `ticks` and `in_range` describe the range it LEFT — the new one is `new_ticks` — so the
// window drew the old narrow range with "beside it, waiting" over a position sitting in the middle of ±20%. The range
// is new_ticks after a re-set, the price and the value are the newest check's (its increase step), in range is read
// from the two
function lpNow() {
  const lp = S.lp, rb = lp?.last_check?.steps?.rebalance || lp?.last?.steps?.rebalance, inc = lp?.last_check?.steps?.increase;
  const ticks = (rb?.acted && !rb?.error && rb?.new_ticks) || rb?.ticks || null, tick = inc?.tick ?? rb?.tick ?? null;
  const inR = ticks && tick != null ? tick >= ticks[0] && tick < ticks[1] : (inc?.in_range ?? rb?.in_range ?? null);
  const value = inc?.value_after_bnb ?? inc?.value_bnb ?? rb?.value_with_reserve_bnb ?? rb?.value_bnb ?? null;
  return { rb, inc, ticks, tick, inR, value };
}
function rangeHtml() {
  const { ticks, tick } = lpNow();
  if (!ticks || tick == null) return '';
  const [lo, hi] = ticks, pad = (hi - lo) * 0.45, a = lo - pad, b = hi + pad, pos = v => clamp((v - a) / (b - a), 0, 1) * 100, inR = tick >= lo && tick < hi;
  return `<div class="db"><div class="db-c">CAKE / BNB · 0.05% · WHERE THE PRICE STANDS</div><div class="dm${inR ? '' : ' out'}"><div class="rng" style="left:${pos(lo)}%;width:${pos(hi) - pos(lo)}%"></div><i style="left:${pos(tick)}%"></i></div>`
    + `<div class="db-x"><span>${inR ? 'IN RANGE · EARNING FEES' : 'BESIDE IT · WAITING FOR THE PRICE'}</span></div></div>`;
}
function vizOf(k) {
  const bt = e => Date.parse(e.time), n4 = v => v ? v.toFixed(v < 0.01 ? 4 : 3) + ' BNB' : '0';
  switch (k) {
    case 'burnA': return barsHtml(perDay(S.burns, bt, e => e.bobaiBurned), 'BOBAI BURNED BY THE BOT, PER DAY', v => cmp(v));
    case 'burnB': return barsHtml(perDay(S.burns, bt, bobOf), 'BOB BURNED BY THE BOT, PER DAY', v => cmp(v));
    case 'liq': return barsHtml(perDay(S.liq, bt, l => l.bnb), 'BNB ADDED TO THE POOL, PER DAY', n4);
    case 'giggle': return barsHtml(perDay(S.burns, bt, e => e.giggleBnb), 'BNB INTO THE POT, PER DAY', n4);
    case 'creator': case 'dev': return barsHtml(perDay(S.burns, bt, e => e.creatorBnb), 'CREATOR SHARE IN, PER DAY', n4);
    case 'defi': case 'lp': return rangeHtml();
    case 'core': case 'buyback': { const c = clamp(charge, 0, 1); if (splitBnb() > 0) return ringHtml([[1, '#F0B90B', 'READY TO SPLIT', bnbF(splitBnb())]], '100%', 'SWAPPED · SPLIT AT THE NEXT CHECK');
      // the queue is full and the token has not swapped yet: it does so inside a trade, so the board says it waits for one
      // (operator, 2026-10-05: "402,688 BOBAI queued, but it is not sent yet?")
      if (S.queued >= MIN_DISPATCH) return ringHtml([[1, '#F0B90B', 'COLLECTED', cmp(S.queued)]], 'FULL', 'FULL · THE TOKEN SWAPS IT INSIDE ONE OF THE NEXT TRADES');
      return ringHtml([[c, '#F0B90B', 'COLLECTED', cmp(S.queued)], [1 - c, 'rgba(255,255,255,.08)', 'TO THE SWAP', cmp(Math.max(0, MIN_DISPATCH - S.queued))]], Math.round(c * 100) + '%', 'TAX TO THE NEXT SWAP · ' + cmp(MIN_DISPATCH) + ' BOBAI'); }
    case 'nft': { const m = (S.nft?.minted || []).reduce((a, b) => a + b, 0), cap = (S.nft?.cap || []).reduce((a, b) => a + b, 0) || 1925; return ringHtml([[m, '#a78bfa', 'DROPPED', nf(m)], [Math.max(0, cap - m), 'rgba(255,255,255,.08)', 'STILL TO EARN', nf(cap - m)]], Math.round(m / cap * 100) + '%', 'THE COLLECTION'); }
    case 'agent': { const q = S.kinds || {}; return hbarsHtml([['MCP', +q.mcp || 0], ['REST', +q.rest || 0], ['DISCOVERY', +q.discovery || 0], ['HIRE · JOBS', (+q.hire || 0) + (+q.job || 0) + (+q.dispatch || 0)]], 'REQUESTS FROM OUTSIDE, TODAY'); }
    case 'src': return '<canvas class="fl-c fl-spark"></canvas>';
  }
  return '';
}
function paintDetail(k) {
  const d = info(k); if (!d) return;
  const fresh = detail.dataset.k !== k; detail.dataset.k = k;
  if (fresh) { detail.classList.remove('draw'); void detail.offsetWidth; detail.classList.add('draw'); clearTimeout(detail._t); detail._t = setTimeout(() => detail.classList.remove('draw'), 2600); }
  detail.style.setProperty('--c', d.c);
  const h = document.createElement('div'); h.className = 'dh';
  const tt = document.createElement('b'); tt.textContent = d.t; h.append(tt);
  if (pinnedK === k) { const x = document.createElement('button'); x.type = 'button'; x.className = 'dx'; x.textContent = '×'; x.onclick = e => { e.stopPropagation(); unpin(); }; h.append(x); }
  const rows = document.createElement('div'); rows.className = 'dr';
  for (const [a, b] of d.rows.slice(0, k === 'follow' ? 99 : 5)) { const r = document.createElement('div'); const s1 = document.createElement('span'); s1.textContent = a; const s2 = document.createElement('b'); s2.textContent = b; r.append(s1, s2); rows.append(r); }
  // the diagram takes the paragraph's place; a trade being followed keeps its sentence (it tells a path, not a figure)
  // a repaint while the diagram is still drawing itself (hover, then the click that pins it) keeps the diagram on screen:
  // made anew, its ring drew a second time (operator, 2026-10-05: "the yellow circle loads twice")
  const keep = !fresh && detail.classList.contains('draw') && k !== 'follow' ? detail.querySelector('.dv') : null;
  const viz = keep || k === 'follow' ? '' : vizOf(k), n = keep || document.createElement(viz ? 'div' : 'p');
  if (keep) { /* as it is */ } else if (viz) { n.className = 'dv'; n.innerHTML = viz; } else n.textContent = d.note;
  const l = document.createElement('div'); l.className = 'dl';
  for (const [a, u] of d.links) if (u) { const e = document.createElement('a'); e.href = u; e.target = '_blank'; e.rel = 'noopener'; e.textContent = a + ' ↗'; l.append(e); }
  // the kept diagram is not taken out and put back (that alone starts its animation again): the rest is renewed around it
  if (keep) { for (const c of [...detail.children]) if (c !== keep) c.remove(); detail.prepend(h, rows); detail.append(l); }
  else detail.replaceChildren(h, rows, n, l);
  const sc = n.querySelector('canvas.fl-spark'); if (sc) requestAnimationFrame(() => drawSpark(sc, { t: Date.now(), col: '#9ae6b4', lab: 'NOW' }));
}
function setFocus(k) {
  focusK = k;
  win.classList.toggle('has-detail', !!k); // the chart steps back behind an open board
  if (k) { paintDetail(k); detail.classList.add('on'); }
  else detail.classList.remove('on'); // a board opening is no reason for a move (one figure, one flow)
}
function unpin() { pinnedK = null; setFocus(null); }
// A TAP ON A PART OF HIM PLAYS ITS MOVE (operator, 2026-09-27: "click burn, liq, DeFi, Giggle on the right and no
// animation comes any more"): the board opens and he shows what that part does — at once, as a chain event does.
// A hover only opens the board; a tap within 4 s of the last one does not restart him.
const CLICK_MOVE = { burnA: 'burn', burnB: 'burn-small', liq: 'liq', defi: 'defi', giggle: 'giggle', creator: 'coffee', core: 'burn-big',
  src: 'buy-nice', buyback: 'burn', dev: 'coffee', lp: 'defi', agent: 'think', nft: 'cheer' };
// ON A DESKTOP THE MOUSE IS ENOUGH (operator, 2026-09-27: "on the desktop the animations should come on hover, at the
// six points and at trades"): resting the pointer on one of them for a moment plays its move, as a click does. A pointer
// only passing over does not (the short wait), and the 4 s pause of clickMove keeps him from twitching between points.
const HOVER_MOVE = new Set(['burnA', 'burnB', 'liq', 'defi', 'giggle', 'creator', 'src']);
let hoverT = 0;
function hoverMove(k) {
  clearTimeout(hoverT);
  if (k && HOVER_MOVE.has(k)) hoverT = setTimeout(() => { if (focusK === k || pinnedK === k) clickMove(k); }, 350);
}
// a happy move, in turns: the one of these he did longest ago (among those with a clip)
function joyMove() {
  const J = ['dance', 'giggle', 'moon', 'saber', 'cheer'].filter(p => flowPose(p) === p);
  if (!J.length) return 'idle';
  const fresh = J.filter(p => !RECENT.includes(p)); const L = fresh.length ? fresh : J;
  return L[Math.floor(Math.random() * L.length)];
}
// EACH CIRCLE, ITS OWN NEWS (operator, 2026-10-01: "hovering the circles — buyback, BOB burn, BOBAI burn, liquidity, DeFi,
// Giggle — the matching animation and a current, smart line about exactly that circle, what its bot did"): a hover or tap
// used to play the move in silence (and the joke button said "telling you something"). Every line reads the live figures.
const hAgo = t => { const m = Math.max(1, Math.round((Date.now() - t) / 60e3)); const d = Math.floor(m / 1440); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : d === 1 ? 'a day ago' : `${d} days ago`; }; // whole hours and days, never "1 days ago" (2026-10-05)
function circleLine(k) {
  const lb = S.burns.filter(e => +e.bobaiBurned > 0).at(-1), wk = S.burns.filter(e => Date.parse(e.time) >= Date.now() - 7 * 86400e3);
  const rb = S.lp?.last?.steps?.rebalance, inr = lpNow().inR, ll = S.liq.at(-1), dv = S.dev.at?.(-1), nd = S.nft?.drops?.[0];
  const f = LIFE.flow || {};
  // five ways each (operator, 2026-10-02: "at least five variants of every text"); every figure stays the live one
  const L = {
    burnA: () => { if (!lb) return null; const a = cmp(+lb.bobaiBurned), t = hAgo(Date.parse(lb.time)), s = supplyPct(S.deadA || 0); return vary('v6', [
      `My last burn: ${a} BOBAI, ${t}. ${s}% of my supply is gone for good.`, `${a} BOBAI burned ${t}. All in all ${s}% of my supply sits at the dead address.`,
      `This circle is my BOBAI burn. Last one: ${a} BOBAI, ${t}. ${s}% of the supply, gone.`, `${s}% of my supply is burned, and counting. The newest: ${a} BOBAI, ${t}.`,
      `Burned ${t}: ${a} BOBAI. Every burn has its transaction, ${s}% of the supply so far.`]); },
    burnB: () => { const b = S.burns.filter(e => bobOf(e) > 0).at(-1); if (!b) return null; const a = cmp(bobOf(b)), t = hAgo(Date.parse(b.time)), w = cmp(wk.reduce((x, e) => x + bobOf(e), 0)); return vary('v7', [
      `I burn BOB too: ${a} BOB ${t}. ${w} this week.`, `BOB burn: ${a} BOB ${t}, ${w} in the last seven days.`, `A part of my tax buys BOB and burns it. Last time ${a} BOB, ${t}.`,
      `${w} BOB burned this week. The newest: ${a} BOB, ${t}.`, `Burning for the BOB family too: ${a} BOB ${t}. This week: ${w}.`]); },
    liq: () => { const l = lpText(), last = ll ? `${bnbF(+ll.bnb || 0)}, ${hAgo(Date.parse(ll.time))}` : ''; return vary('v8', [
      `${l} of my pool's LP is burned.${last ? ` Last add: ${last}.` : ''} Nobody can pull it.`, `My pool: ${l} of its LP at the dead address.${last ? ` Newest add ${last}.` : ''}`,
      `Liquidity that stays: ${l} of the LP is burned.${last ? ` Last add: ${last}.` : ''}`, `${l} of the LP is burned, so the pool cannot be pulled.${last ? ` I added ${last}.` : ''}`,
      `Deeper with every add${last ? `, the last one ${last}` : ''}. ${l} of the LP is burned.`]); },
    defi: () => { if (!rb) return null; const v = bnbF(rb.value_with_reserve_bnb ?? rb.value_bnb ?? 0), r = inr === false; return vary('v9', [
      `My DeFi agent works ${v} in CAKE/BNB. ${r ? 'Price outside its range right now, so it waits.' : 'In range, earning fees.'}`, `${v} at work in CAKE/BNB. ${r ? 'Out of range for now: it waits.' : 'In its range, collecting fees.'}`,
      `This is my DeFi agent: ${v} in CAKE/BNB. ${r ? 'The price left its range, so it sits tight.' : 'Right in range, earning.'}`, `CAKE/BNB, ${v}, managed by my DeFi agent. ${r ? 'Outside its range at the moment.' : 'In range at the moment.'}`,
      `My DeFi agent has ${v} in CAKE/BNB. ${r ? 'Waiting for the price to come back into range.' : 'Fees coming in.'}`]); },
    giggle: () => { const p = bnb4(ggBnb()); return GIGGLE_OPEN() ? vary('v10', [`The Giggle pot holds ${p} for Giggle Academy. Every trade adds to it until November 20.`, `${p} in the Giggle pot so far. It goes to Giggle Academy on November 20.`,
      `Every trade adds a coin for Giggle Academy. The pot: ${p}.`, `The Giggle pot: ${p}, growing with every trade until November 20.`, `For the kids of Giggle Academy: ${p} in the pot, and counting.`])
      : vary('v11', [`The Giggle pot went to Giggle Academy. ${p}, from every trade.`, `${p} from every trade went to Giggle Academy.`, `The Giggle pot is delivered: ${p} for Giggle Academy.`, `Giggle Academy got the pot: ${p}.`, `${p} for Giggle Academy, made by every trade.`]); },
    creator: () => { if (!dv) return null; const b = bnbF(+dv.availableBnb || 0), t = hAgo(Date.parse(dv.time)), sp = dv.builder6Bnb ? '80% creator, 20% to 6 builders' : '82% creator, 18% to 5 builders'; return vary('v12', [
      `My creator share paid out ${b} ${t}: ${sp}.`, `Creator share, last payout ${b}, ${t}. Split: ${sp}.`, `${b} paid out ${t} from the creator share: ${sp}.`,
      `The creator slice pays the builders too: ${sp}. Last payout ${b}, ${t}.`, `Last creator payout: ${b}, ${t}. ${sp}.`]); },
    src: () => { const t = `${nf(f.b || 0)} buy${f.b === 1 ? '' : 's'}, ${nf(f.s || 0)} sell${f.s === 1 ? '' : 's'}`; return vary('v13', [`Every trade pays 3% tax into my brain. This hour: ${t}.`, `This hour: ${t}. Each one paid 3% to the brain.`,
      `The source of it all: 3% of every trade. This hour, ${t}.`, `${t} this hour, all taxed 3%. That is my fuel.`, `Trades feed me: ${t} this hour, 3% each.`]); },
    core: () => { const u = `$${nf(S.queued * S.price + splitBnb() * S.bnbP, 2)}`, s = splitBnb() > 0; return vary('v14', [`Right now ${u} of tax is charging my next buyback.${s ? ' My bot splits it at its next check.' : ''}`,
      `${u} of tax waiting in my brain for the next buyback.${s ? ' The split is next.' : ''}`, `My brain holds ${u} of tax right now.${s ? ' Ready to split.' : ' Still charging.'}`,
      `The next buyback is worth ${u} so far.${s ? ' My bot splits it soon.' : ''}`, `Charging: ${u} of tax for my next buyback.${s ? ' Split coming at the next check.' : ''}`]); },
    buyback: () => { const s = splitBnb() > 0, x = s ? `${bnbF(splitBnb())} is ready to split.` : W.buyback.last ? `Last check ${hAgo(W.buyback.last)}.` : `${Math.round(clamp(S.queued / MIN_DISPATCH, 0, 1) * 100)}% charged for the next one.`; /* no heartbeat read: no invented "1 min ago" (2026-10-05) */ return vary('v15', [`My buyback bot checks every 10 minutes. ${x}`,
      `Every 10 minutes my buyback bot looks at its wallet. ${x}`, `Buyback bot, on duty every 10 minutes. ${x}`, `${x} My buyback bot checks every 10 minutes.`, `Ten minutes, check, split, repeat. ${x}`]); },
    dev: () => { if (!dv) return 'My dev bot runs hourly and pays the creator share.'; const b = bnbF(+dv.availableBnb || 0), t = hAgo(Date.parse(dv.time)); return vary('v16', [`My dev bot runs hourly. Last payout ${b}, ${t}.`,
      `Dev bot, hourly. It paid ${b} ${t}.`, `Every hour my dev bot pays the creator share. Last time: ${b}, ${t}.`, `${b} paid out ${t}. My dev bot runs every hour.`, `Hourly dev bot. Newest payout ${b}, ${t}.`]); },
    lp: () => { if (!rb) return null; const r = inr === false; return vary('v17', [`My DeFi agent checks its range every hour. ${r ? 'Outside right now, it waits.' : 'In range, earning fees.'}`,
      `Hourly range check for my DeFi agent. ${r ? 'Out of range: waiting.' : 'In range: earning.'}`, `My DeFi agent looks at CAKE/BNB every hour. ${r ? 'The price is outside, so it waits.' : 'In range right now.'}`,
      `Range watch, every hour. ${r ? 'Outside for now.' : 'Inside, collecting fees.'}`, `${r ? 'Out of range right now.' : 'In range right now.'} My DeFi agent checks every hour.`]); },
    agent: () => vary('v18', agentLines()),
    nft: () => { if (!(nd && nd.ts)) return null; const a = `#${nd.tokenId}, ${TIERS[nd.tier] || 'a buy'}, ${hAgo(nd.ts * 1000)}`; return vary('v19', [`Last NFT drop: ${a}. Buy $100 or more and the next is yours.`,
      `Newest NFT: ${a}. A buy of $100 or more gets the next one.`, `NFT drop ${a}. Every buy of $100 or more earns one.`, `My last NFT went out: ${a}. $100 or more and you get one too.`, `Fresh NFT: ${a}. They drop by themselves for buys of $100+.`]); },
  }[k];
  try { return L ? L() || null : null; } catch { return null; }
}
function clickMove(k) {
  const p = CLICK_MOVE[k] && withClip(CLICK_MOVE[k]), now = performance.now(); if (!p || flowPose(p) !== p || now < (LIFE.clickAt || 0) + 4000) return;
  LIFE.clickAt = now; const line = circleLine(k);
  setPose(line ? moveForLine(line, p) : p, 6, true); if (line) speak(line, 6000); LIFE.next = Math.max(LIFE.next, now + 60e3);
}
function bindFocus(el, k) {
  el.classList.add('hot');
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && !pinnedK) { setFocus(k); hoverMove(k); } });
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hoverMove(null); if (e.pointerType === 'mouse' && !pinnedK) setFocus(null); });
  el.addEventListener('click', e => { e.stopPropagation(); pinnedK = pinnedK === k ? null : k; setFocus(pinnedK); if (pinnedK) clickMove(k); });
}
for (const d of DEST) bindFocus(d.el, d.k);
for (const w of WORKERS) bindFocus(w.el, w.k);
bindFocus(coreLab, 'core'); bindFocus(srcLab, 'src');
setInterval(() => { if (focusK && detail.classList.contains('on')) paintDetail(focusK); }, 2000);

// ================= phone: four views instead of one crowded one =================
// BRAIN is the scene. MONEY and BOTS put every figure the scene carries into a readable list
// (the same text as the labels, so the two can never differ); tapping a row opens its detail.
// LOG is the terminal, full height, with the prompt.
let mview = 'brain';
const mpanel = $('mpanel');
function mrow(k, color, name, big, sub, badge) {
  const r = document.createElement('button'); r.type = 'button'; r.className = 'mrow'; r.style.setProperty('--c', color);
  const n = document.createElement('span'); n.className = 'mn'; n.textContent = name;
  if (badge) { const b = document.createElement('i'); b.textContent = badge; n.append(b); }
  const v = document.createElement('b'); v.textContent = big || '…';
  const s = document.createElement('small'); s.textContent = sub || '';
  r.append(n, v, s); r.onclick = () => { pinnedK = k; setFocus(k); };
  return r;
}
function paintMobile() {
  if (mview === 'money') {
    const rows = [mrow('core', '#F0B90B', 'NEXT BUYBACK CHARGING', coreLab.querySelector('.v').textContent, [...coreLab.querySelectorAll('.s')].map(s => s.textContent).filter(Boolean).join(' · '))];
    for (const d of DEST) if (d.pct > 0) rows.push(mrow(d.k, d.c, d.name, d.el.querySelector('.v').textContent, d.el.querySelector('.s').textContent, d.pct + '%'));
    rows.push(mrow('src', '#9ae6b4', 'TRADES · 3% TAX', S.price ? '$' + S.price.toFixed(8) : '…', 'every buy and sell pays 3% into the brain'));
    mpanel.replaceChildren(...rows);
  } else if (mview === 'bots') {
    mpanel.replaceChildren(...WORKERS.map(w => mrow(w.k, w.c, w.name, w.last ? 'beat ' + ago(w.last) : '…', ({ buyback: `splits the tax BNB ${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'][DEST.filter(d => d.pct > 0).length] || DEST.filter(d => d.pct > 0).length} ways · checks every 10 min`, dev: 'pays out the creator share, hourly', lp: 'works the DeFi position, checks hourly', agent: nf(HB.agent || 0) + ' tool calls by agents today', nft: 'mints an NFT on every $100+ buy' })[w.k])));
  }
}
function setView(v) {
  mview = v;
  $('mtabs').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(b.dataset.v === v)); });
  win.classList.toggle('m-list', v === 'money' || v === 'bots');
  win.classList.toggle('m-log', v === 'log');
  if (v === 'log') setTimeout(() => { logEl.scrollTop = logEl.scrollHeight; }, 50);
  if (v !== 'brain') { pinnedK = null; setFocus(null); }
  if ((v === 'chart') !== CX.on) openCx(v === 'chart'); // the chart has its own tab on a phone
  paintMobile();
}
{ const b = document.createElement('button'); b.type = 'button'; b.dataset.v = 'chart'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false'); b.textContent = 'CHART'; $('mtabs').insertBefore(b, $('mtabs').querySelector('[data-v="log"]')); }
$('mtabs').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) setView(b.dataset.v); });
setInterval(() => { if (mview === 'money' || mview === 'bots') paintMobile(); }, 2000);
const ago = t => { if (!t) return '…'; const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; };
function roll(el, a, b, fmt) {
  el.dataset.rolling = '1'; const t0 = performance.now();
  const st = now => { const k = Math.min(1, (now - t0) / 2200), e = 1 - Math.pow(1 - k, 4); el.textContent = fmt(a + (b - a) * e); if (k < 1) requestAnimationFrame(st); else delete el.dataset.rolling; };
  requestAnimationFrame(st);
}
function setDest(k, v, s) { const d = D[k]; if (!d.el.querySelector('.v').dataset.rolling) d.el.querySelector('.v').textContent = v; d.el.querySelector('.s').textContent = s || ''; }
// label widths, measured when they change rather than read every frame (a read after the writes would force a layout per frame)
const labW = new Map();
const labRO = new ResizeObserver(es => { for (const e of es) labW.set(e.target, e.borderBoxSize?.[0]?.inlineSize ?? e.target.offsetWidth); });
function placeLabels() {
  if (!labW.size) { for (const d of DEST) { labRO.observe(d.el); labRO.observe(d.el.querySelector('.n')); } labRO.observe(coreLab); labRO.observe(srcLab); labRO.observe(jokeBtn); for (const w of WORKERS) labRO.observe(w.el); }
  const fs = A.figScreen || toScreen(A.fig); fig.style.left = fs.x - A.figW / 2 + 'px'; fig.style.top = fs.y - A.figHpx / 2 + 'px';
  // the joke button (centre point). Wide: just under the shadow at his feet (its bottom is 52% of the figure's height
  // below the centre), stepped right of the log box where the two would touch and up where the timeline begins.
  // Stacked (iPad portrait, phone): under him sits the buyback orb, so it stands on his shoe line beside his right foot.
  { const bw = labW.get(jokeBtn) || 160, bh = 36, Wd = win.clientWidth, Hd = win.clientHeight; let jx, jy;
    if (portrait) { jy = fs.y + A.figHpx * 0.38; jx = Math.min(fs.x + A.figW * 0.28 + 8 + bw / 2, Wd - 8 - bw / 2); }
    else {
      jy = Math.min(fs.y + A.figHpx * 0.52 + 6 + bh / 2, Hd - 120 - bh / 2); jx = fs.x;
      const lb = logBox(); if (lb.right && jy + bh / 2 > lb.top - 6 && jx - bw / 2 < lb.right + 10) jx = lb.right + 10 + bw / 2;
    }
    jokeBtn.style.left = jx + 'px'; jokeBtn.style.top = jy + 'px'; }
  const pxU = win.getBoundingClientRect().height / viewH;
  const xs = new Map();
  for (const d of DEST) { const s = toScreen(d.pos); xs.set(d, s.x); d.el.style.top = s.y + 'px'; d.el.style.setProperty('--off', Math.round(portrait ? d.R * d.mScale * pxU * 0.8 + 1 : d.R * d.mScale * pxU + 14) + 'px'); } /* phone: the name sits close under its light */
  // Phone: a row of three labels is wider than its thirds of a 360 px screen. Each row is kept
  // inside the edges and its labels apart, nudged sideways under their orbs rather than cut off.
  if (portrait) {
    // the labels hang in #bt-labs, which starts a few px left of the window on a phone (8 px measured at 344 px,
    // 2026-09-27): the row is kept between the WINDOW's edges, translated into the labels' own coordinates
    const Wd = win.clientWidth, M = 6, GAP = 3, off = labs.getBoundingClientRect().left - win.getBoundingClientRect().left;
    for (let i = 0; i < DEST.length; i += 3) {
      const row = DEST.slice(i, i + 3).filter(d => d.el.style.display !== 'none' && labW.has(d.el)).sort((a, b) => xs.get(a) - xs.get(b));
      let edge = M - off;
      for (const d of row) { const w = labW.get(d.el), x = Math.max(xs.get(d), edge + w / 2); xs.set(d, x); edge = x + w / 2 + GAP; }
      edge = Wd - M - off;
      for (const d of row.reverse()) { const w = labW.get(d.el), x = Math.min(xs.get(d), edge - w / 2); xs.set(d, x); edge = x - w / 2 - GAP; }
    }
  } else {
    // Wide screen: the labels hang to the right of their orbs. In the new page the terminal is a window in the middle,
    // a third narrower than the full screen it was drawn for, and the labels ran past its right edge (2026-09-27).
    // Each label gets the room that is really left (--mw): its figure shrinks to fit and its second line wraps.
    // Its name row never wraps (the name and its % pill): at 1440 px "LIQ BOOST III 0.5%" still ran 7 px past the edge
    // (2026-10-03) — a row wider than the room left moves the whole label left until it fits.
    const Wd = win.clientWidth;
    for (const d of DEST) { const nw = labW.get(d.el.querySelector('.n')); if (nw) xs.set(d, Math.min(xs.get(d), Wd - 8 - nw - (parseFloat(d.el.style.getPropertyValue('--off')) || 26))); }
    for (const d of DEST) d.el.style.setProperty('--mw', Math.max(120, Math.round(Wd - xs.get(d) - (parseFloat(d.el.style.getPropertyValue('--off')) || 26) - 12)) + 'px');
  }
  for (const [d, x] of xs) d.el.style.left = x + 'px';
  // countdown to the buyback bot's next run (cron every 10 min; the last heartbeat anchors it)
  // THE COUNTDOWN ONLY WHEN THE RUN WILL SPLIT SOMETHING (2026-09-28): the bot runs every 10 min but splits only above
  // 0.004 BNB in 1ce (worker/index.js GAS_RESERVE + MIN_BNB); below that the next buyback waits for the token's own swap
  // at 400K BOBAI, so the line says how far that is instead of promising a run that splits nothing
  if (S.walletBnb <= 0.004) coreLab.querySelector('.cd').textContent = ''; // the ring shows how far; the % is on the board (operator, 2026-09-28)
  else if (W.buyback.last) {
    const left = W.buyback.last + 600e3 - Date.now();
    coreLab.querySelector('.cd').textContent = left > 0 ? `splits in ${String(Math.floor(left / 60e3)).padStart(2, '0')}:${String(Math.floor(left / 1e3) % 60).padStart(2, '0')}` : 'bot is running now…';
  }
  // on a phone the core's label hangs to the left of the core (right-aligned): it may not run past the edge
  const c = toScreen(A.core.clone().add(portrait ? new THREE.Vector3(-0.4, 0, 0) : new THREE.Vector3(0, -0.8, 0)));
  let cx = portrait && labW.has(coreLab) ? Math.max(c.x, labW.get(coreLab) + 6) : c.x;
  // wide screen: the core's label is centred under it, and in a short window the log box reaches that far — the label
  // sat half under it ("…ACK CHARGING", 2026-09-27). It steps right until it clears the log (measured on resize only).
  // Stepped right, it ran into the Giggle coin ("…BNB queued" under the coin, 2026-09-28): it now sits between the log
  // and the coin, and where that gap is narrower than the label its lines wrap to fit (the unwrapped width is kept).
  if (!portrait && labW.has(coreLab)) {
    if (!coreLab.style.maxWidth) coreLab.nat = labW.get(coreLab);
    const lb = logBox(), lr = lb.right, w = coreLab.nat || labW.get(coreLab);
    let L = lr && c.y + coreLab.offsetHeight > lb.top - 6 ? lr + 8 : -Infinity; // its lower lines reach the log first
    // Centred under the core it hung over BOBAI's shins (63 px at 1440x900, 8-21 px at 1280-1920; 2026-09-28): at leg
    // height it starts right of his right leg, his shoe tip 78 % across his picture (measured on the standing pose).
    const h = coreLab.offsetHeight, atLegs = c.y < fs.y + A.figHpx / 2 && c.y + h > fs.y;
    if (atLegs) L = Math.max(L, fs.x + A.figW * 0.28 + 8);
    // every orb to the right at the label's height stops it at the orb's own size: the Giggle coin, and in a short
    // window (1280x720, 1366x768) the DeFi orb too (a fixed 24 px for the coin let the bottom line touch it at 1536)
    let R = Infinity;
    for (const d of DEST) { if (d.el.style.display === 'none') continue;
      const s = toScreen(d.pos), r = d.R * d.mScale * pxU + 10; if (s.x > c.x && s.y + r > c.y && s.y - r < c.y + h) R = Math.min(R, s.x - r); }
    // no room between his leg and the orbs: the label goes to his other side, where the space at leg height is free
    const lx = fs.x - A.figW * 0.28 - 8, lfree = lx - w > 8 && !(lr && c.y + h > lb.top - 6 && lx - w < lr + 8);
    let mw = '';
    if (R - L < Math.min(w, 140) && atLegs && lfree) cx = lx - w / 2;
    else if (R - L < w) { mw = Math.max(140, Math.floor(R - L)) + 'px'; cx = isFinite(L) ? L + Math.min(w, R - L) / 2 : R - Math.min(w, R - L) / 2; }
    else cx = Math.min(Math.max(cx, L + w / 2), R - w / 2);
    if (coreLab.style.maxWidth !== mw) coreLab.style.maxWidth = mw;
  }
  coreLab.style.left = cx + 'px'; coreLab.style.top = c.y + 'px';
  // the trades label is centred on its orb near the left edge: kept inside the window instead of cut in half
  const s = toScreen(A.src), sx = labW.has(srcLab) ? Math.max(s.x, labW.get(srcLab) / 2 + 8) : s.x; srcLab.style.left = sx + 'px';
  // wide screen: it stays above the log's roof (at 1366x768 its second line reached 11 px into the log, layout.mjs 2026-09-29)
  let sy = s.y + (portrait ? 26 : 0); // phone: under its dot, clear of his arm
  if (!portrait) { const lb = logBox(); if (lb.top && sx - (labW.get(srcLab) || 0) / 2 < lb.right) sy = Math.min(sy, lb.top - 6 - 18 - (SRCH || (SRCH = srcLab.offsetHeight))); } // its box starts 18 px under its top (terminal.css .src translate(-50%,18px))
  srcLab.style.top = sy + 'px';
  for (const w of WORKERS) {
    // kept inside the window: on its orbit the left one ran past the edge ("…CK BOT · 1ce", layout.mjs 2026-09-29)
    const p = toScreen(w.pos), ww = labW.get(w.el) || 0, Wd = win.clientWidth;
    w.el.style.left = (ww ? clamp(p.x, ww / 2 + 6, Wd - ww / 2 - 6) : p.x) + 'px'; w.el.style.top = p.y - 16 + 'px';
    w.el.style.zIndex = w.pos.z > A.head.z ? 3 : 1; w.el.style.opacity = labs.querySelector('.show') ? (w.el.classList.contains('under') ? 0.08 : w.pos.z > A.head.z ? 1 : 0.45) : 0;
    w.el.lastChild.textContent = w.last ? 'beat ' + ago(w.last) : w.every;
  }
}
function floatAt(v, text, color) {
  const s = toScreen(v), el = document.createElement('div');
  el.className = 'flt'; el.textContent = text; el.style.setProperty('--c', color); el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
  labs.appendChild(el); setTimeout(() => el.remove(), 2500);
}

// ================= the figure lives =================
let pose = 'idle', poseT = 0;
// ONE FIGURE, ONE FLOW (2026-09-26, operator: "like a film — he cannot suddenly be doing push-ups; there must always
// be one in-between pose everything starts from"): every move is a hub clip, anim/hub-<move>.pack.mp4, that starts
// in his standing pose, does the move and ends in that same standing pose. A move without its hub clip is not
// shown at all — he stays standing — so the picture never cuts from one pose into another.
// ALL TAKES AGAIN (2026-09-28, operator: "use all animations and videos" — the DeFi hologram ring, the liquidity pour):
// the older takes that start and end inside the move (defi, liq, think …) play too, faded in from and out to the
// standing still (SOFT), so the picture still never jumps. Takes that run out of the frame stay withheld (cut.txt).
const flowPose = p => p === 'idle' || (!REDUCED && moveTakes(p).length) ? p : 'idle';
// VARIETY (operator, 2026-09-27: "he shows the hard hat and the blocks very often — alternate"): a move of his own
// (not a chain event) that he did among his last four is swapped for one he has not, from the moves that have a clip.
// Chain events (urgent) always show their own move.
const RECENT = [];
// when each move was last shown (2026-09-28): his own moments take the ones not seen for longest, not a coin toss
const MOVED = new Map();
// what he did, for checking his behaviour from outside (read-only: window.__btMoves) — [seconds, move, own|event]
const MOVELOG = window.__btMoves = [];
window.__btPlay = p => setPose(p, 6, true); // for checks from outside: play one move now
window.__btAgent = () => ({ use: HB.agent ?? null, menu: HB.agentMenu ?? null, all: HB.agentAll ?? null, lines: agentLines() }); // for checks from outside (read-only)
// for checks from outside (read-only): drops on record, and buys that would still play beside their own drop (must be 0)
// for truth.mjs (2026-09-29): the record as the terminal holds it and the figures it shows, compared from outside with the chain
window.__btTruth = () => ({
  ev: events.map(x => ({ id: x.id, kind: x.kind, t: x.t, usd: x.usd, bnb: x.bnb, buy: x.buy, ours: x.ours, taxSwap: !!x.taxSwap, tx: x.tx, key: x.key, who: x.who,
    n: x.n && { tokenId: x.n.tokenId, usd: x.n.usd, usdExact: x.n.usdExact, tier: x.n.tier, buyTx: x.n.buyTx }, e: x.e && { time: x.e.time, bnb: x.e.bobaiBurnBnb, burned: x.e.bobaiBurned }, l: x.l && x.l.time, dev: !!x.l?.dev, lbnb: x.l?.bnb,
    title: x.kind === 'run' ? tierOf(BURN_TIERS, burnUsd(x.e))?.[2] : x.kind === 'nft' ? buyTierOf(nUsd(x.n) || 100, x.n)?.[2] : x.kind === 'trade' && x.buy && !x.ours && x.usd >= ALERT_USD ? tierOf(BUY_TIERS, x.usd)?.[2] : null })),
  S: { price: S.price, bnbP: S.bnbP, deadA: S.deadA, deadB: S.deadB, queued: S.queued, walletBnb: S.walletBnb, lpPct: S.lpPct, histFrom: S.histFrom, backHead: S.backHead, hist: S.hist.length, block: S.block },
  dest: Object.fromEntries(DEST.map(d => [d.k, [d.pct, d.el.querySelector('.v').textContent, d.el.querySelector('.s').textContent]])),
  core: [coreLab.querySelector('.v').textContent, coreLab.querySelector('.s').textContent, charge], mode, minD: MIN_DISPATCH, candles: CH.rows.length, chSrc: CH.src,
});
window.__btDup = () => { const d = new Set((S.nft?.drops || []).map(n => (n.buyTx || '').toLowerCase())); return [events.filter(x => x.kind === 'nft').length, events.filter(x => x.kind === 'trade' && x.buy && d.has((x.tx || '').toLowerCase())).length, S.hist.filter(x => x.buy && d.has((x.tx || '').toLowerCase())).length]; };
// a pretend alert buy of $usd, played in this browser only (never stored, never sent) — to check a tier's moment
// for checks from outside: replay a REAL buy through the live path (queue + watchMint polling the real drop list); nothing is written
window.__btTestReal = (tx, usd) => { const x = { kind: 'trade', id: 'test-r' + Date.now(), t: Date.now(), buy: true, usd, bnb: usd / (S.bnbP || 600), bobai: 1, ours: false, tx, mint: true }; events.push(x); enqueue(x); watchMint(x); };
window.__btTestMint = (usd, tier, ms) => { const x = { kind: 'trade', id: 'test-m' + Date.now(), t: Date.now(), buy: true, usd, bnb: usd / (S.bnbP || 600), bobai: 1, ours: false, tx: '', mint: true }; enqueue(x); setTimeout(() => { x.drop = { usd, tokenId: 0, tier, rarity: 0 }; mintArrived(x, x.drop); }, ms); };
// for checks from outside (read-only): when the window showed and which clip was starting then
window.__btShows = [];
window.__btWave = () => waveHello(); window.__btWaveLines = () => ({ HELLO, STRETCH }); // checks: a wave with its community line, a stretch with its own
window.__btCircles = () => Object.fromEntries(['burnA','burnB','liq','defi','giggle','creator','src','core','buyback','dev','lp','agent','nft'].map(k => [k, circleLine(k)])); // checks: what each circle says now
window.__btPrice = () => (S.price > 0 ? S.price : null); // the BOBAI price the terminal read from the chain, for the Brain page's windows (03 PROOF)
window.__btRecall = () => recallLine(); // checks: what he would remember right now
window.__btCam = () => [camera.position.x, camera.position.y, camera.position.z, cam.look.x, cam.look.y]; // shake.mjs: the view never jolts
window.__btTestEv = kind => { const l = S.liq.at(-1), x = [...events].reverse().find(e => kind === 'devliq' ? e.kind === 'liq' && e.l?.dev : kind.includes(':') ? e.kind + ':' + e.key === kind : e.kind === kind) || (kind === 'liq' && l ? { kind: 'liq', id: 'test-liq', t: Date.parse(l.time), l } : null); if (x) run(x, false); return !!x; }; // the last real event of a kind, played again (layout.mjs)
window.__btCore = () => { const c = toScreen(A.head), r = win.getBoundingClientRect(); return [Math.round(r.left + c.x), Math.round(r.top + c.y)]; }; // the brain on screen, for checks (nftscene.mjs)
window.__btTestCard = () => { const n = S.nft?.drops?.[0]; if (n) enqueue({ kind: 'nftcard', id: 'test-c' + Date.now(), t: Date.now(), n }); return !!n; }; // the newest drop's card, through the queue
window.__btTestNft = () => { const n = S.nft?.drops?.[0]; if (!n) return false; const x = { id: 'test-n' + Date.now(), t: Date.now(), kind: 'nft', n }; events.push(x); enqueue(x); return true; }; // a fresh minted buy, as it stands once its NFT is in (tlclick.mjs)
window.__btPx = () => [S.price, S.priceAt || 0, S.hist.length, S.hist.length ? S.hist[S.hist.length - 1].t : 0, (typeof cxCandles === 'function' && cxCandles().at(-1)?.c * S.bnbP) || 0]; // the live price, when it was read, the swaps seen, the open chart's last close in $ (chartlive.mjs)
// qa/details.mjs (2026-10-05): a board opened and repainted, a full tax queue, a small swap read by the page and the
// big chart's line for the newest candle
window.__btTestDetail = { focus: k => setFocus(k), queue: n => { const was = S.queued, wb = S.walletBnb; S.queued = n ?? MIN_DISPATCH + 2688; S.walletBnb = 0; const h = vizOf('core'); S.queued = was; S.walletBnb = wb; return h; }, // no BNB waiting to split: that state has its own board
  swap: (usd, sell) => { const x = { kind: 'trade', id: 'test-s' + Date.now(), t: Date.now(), buy: !sell, usd, bnb: usd / (S.bnbP || 600), bobai: usd / (S.price || 2e-4), ours: false, tx: '0xtest' + Date.now() }; S.hist.push(x); chartSwap(x); },
  cx: () => { openCx(true); CX.hover = cxCandles().length - 1; },
  // a hard day (ch = the day's change in %): the kinds of his next eight own moments, a word of heart, the moves his market lines may take
  hard: ch => { LIFE.combo = { ...(LIFE.combo || { key: 'down-loud', trend: 'down', act: 'loud' }), ch }; OWN_BAG = []; const kinds = []; for (let i = 0; i < 8; i++) kinds.push(ownKind()); OWN_BAG = []; return { kinds, line: heartLine(), moves: actsNow().map(a => a[0]) }; } };
window.__btTestLive = (usd, sell) => { const x = { kind: 'trade', id: 'test-l' + Date.now() + Math.random(), t: Date.now(), buy: !sell, usd, bnb: usd / (S.bnbP || 600), bobai: usd / (S.price || 2e-4), ours: false, tx: '' }; x.lit = performance.now(); events.push(x); enqueue(x); };
window.__btTestBuy = (usd, nftTier) => nftTier != null ? run({ kind: 'nft', id: 'test-n' + Date.now(), t: Date.now(), n: { usd, tokenId: 0, tier: nftTier, rarity: 0, ts: Date.now() / 1000 } }, false) : run({ kind: 'trade', id: 'test-' + Date.now(), t: Date.now(), buy: true, usd, bnb: usd / (S.bnbP || 600), bobai: usd / (S.price || 2e-4), ours: false, tx: '' }, false);
const OWN_MOVES = ['dance', 'walk', 'coffee', 'pushups', 'think', 'moon', 'shrug', 'laugh', 'cheer', 'saber', 'bull', 'hodl', 'build', 'giggle'];
function varied(p) {
  if (!RECENT.includes(p)) return p;
  const alt = OWN_MOVES.filter(m => m !== p && !RECENT.includes(m) && flowPose(m) === m);
  return alt.length ? alt[Math.floor(Math.random() * alt.length)] : p;
}
// A MOVE WITHOUT ITS CLIP YET takes the nearest one that has one (2026-09-27): a kraken buy used to fall back to the
// confetti, a supernova burn to the plain fireball, and think/hodl/bull/defi to standing still. The next smaller tier
// first, then a move of the same spirit; once the clip itself exists it is used.
const STAND_IN = { 'buy-kraken': 'cheer', 'buy-thunder': 'saber', 'buy-whale': 'buy-huge', 'buy-huge': 'buy-big', 'buy-big': 'buy-nice', 'buy-nice': 'giggle',
  'burn-supernova': 'burn-apocalypse', 'burn-apocalypse': 'burn-mega', 'burn-mega': 'burn-big', 'burn-big': 'burn-nice', 'burn-nice': 'burn-small', 'burn-small': 'burn',
  think: 'coffee', hodl: 'saber', bull: 'dance', defi: 'build', 'defi-buy': 'defi', 'defi-cap': 'defi', laugh: 'giggle', shrug: 'walk',
  // withheld as cut by the frame (temp/terminal/anim/cut.txt, 2026-09-27) until re-shot in the wide framing
  burn: 'burn-nice', pushups: 'walk', liq: 'build' };
function withClip(p) { let q = p; for (let n = 0; n < 8 && q && q !== 'idle' && flowPose(q) !== q; n++) q = STAND_IN[q]; return q && flowPose(q) === q ? q : p; }
function setPose(p, hold = 2.4, urgent = true) {
  FACE.hop = 0;
  p = flowPose(withClip(urgent ? p : varied(p)));
  if (p !== 'idle') { MOVED.set(p, Date.now()); RECENT.push(p); if (RECENT.length > 6) RECENT.shift(); MOVELOG.push([Math.round(performance.now() / 1000), p, urgent ? 'event' : 'own']); if (MOVELOG.length > 60) MOVELOG.shift(); }
  if (p !== 'idle') vidMove(p, urgent);
  pose = p; poseT = hold; faceShow(null);
}
// the stills stay his standing pose: a move is only ever seen as the clip that leaves it and comes back to it
function showStill() {
  fig.querySelectorAll('img[data-p]').forEach(i => i.classList.toggle('on', i.dataset.p === 'idle'));
  fig.querySelectorAll('.rgb').forEach(i => i.src = `${BASE}fig/idle.webp`);
}

// ================= BOBAI lives (2026-09-25, the operator's vision: a living Tamagotchi) =================
// He is never a still picture: between the chain's own moments he reads the market from the pool's price,
// has a mood, does something that fits it, says a line, now and then a joke — and every line about his
// work is a real, live number. The chain always goes first: an event (buy, burn, liquidity) interrupts
// whatever he is doing. Poses that are not drawn yet fall back to the idle one, so the table can grow
// pose by pose without the scene ever showing a gap. He always looks the same: one figure, one style.
const LIFE = { mood: 'flat', d1h: 0, flow: { b: 0, s: 0, bu: 0, su: 0 }, touchAt: 0, next: 0, last: null, sayUntil: 0, quietSince: Date.now(), prices: [] };
const TIER_POSES = ['buy-nice', 'buy-big', 'buy-huge', 'buy-whale', 'buy-thunder', 'buy-kraken', 'burn-small', 'burn-nice', 'burn-big', 'burn-mega', 'burn-apocalypse', 'burn-supernova'];
const EXTRA_POSES = ['coffee', 'pushups', 'bull', 'saber', 'moon', 'hodl', 'cheer', 'laugh', 'think', 'shrug', 'build', 'dance', 'walk'];
const HAVE = new Set(['idle', 'burn', 'liq', 'defi', 'giggle']);
// poses beyond the first five load quietly; the ones not drawn yet 404 once and stay out of the rotation
function loadExtraPoses() {
  // the tier poses too: without them in HAVE a KRAKEN BUY or an APOCALYPSE BURN fell back to the plain cheer or
  // burn, and their clips never played (found 2026-09-26)
  // NAMED, NOT LOADED (2026-09-27): he only ever stands in the idle still and moves in clips, so the ~30 pose stills
  // (2.7 MB, half of a first visit) are needed only when a share card is drawn. The deploy lists them in
  // fig/stills.json; a pose counts as there by name and its picture loads on demand (poseImg).
  const add = (list) => { for (const p of list) {
    if (fig.querySelector(`img[data-p="${p}"]`)) { HAVE.add(p); continue; }
    const i = new Image(); i.dataset.p = p; i.alt = ''; i.decoding = 'async'; i.dataset.src = `fig/${p}.webp`;
    fig.insertBefore(i, fig.querySelector('.rgb')); HAVE.add(p);
  } };
  const all = [...EXTRA_POSES, ...TIER_POSES];
  fetch(`${BASE}fig/stills.json`, { cache: 'no-cache' }).then(r => r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : Promise.reject())
    .then(list => add(all.filter(p => list.includes(p)))).catch(() => add(all));
}
// a pose's still, loaded now if it was only named so far (share cards); resolves to the image or null
function poseImg(p) {
  const i = p && fig.querySelector(`img[data-p="${p}"]`); if (!i) return Promise.resolve(null);
  if (!i.getAttribute('src')) i.src = BASE + i.dataset.src;
  if (i.complete && i.naturalWidth) return Promise.resolve(i);
  return new Promise(r => { const t = setTimeout(() => r(null), 4000); i.addEventListener('load', () => { clearTimeout(t); r(i); }, { once: true }); i.addEventListener('error', () => { clearTimeout(t); r(null); }, { once: true }); });
}
const poseOr = p => HAVE.has(p) ? p : 'idle';
// A JOKE COMES WITH A CLIP (operator, 2026-09-29: "every time he makes a joke one of the videos must come"): the laugh
// move plays with it, its line held until the clip starts. When no clip can start now (a move of his own still playing,
// a scene waiting for its move, no laugh take) the joke is not told — never a joke said standing still.
// a joke not told among the last ten (40+ of them: no repeat within a visit's first dozen)
const JOKE_RECENT = [];
// THE LINE NAMES THE MOVE (operator, 2026-10-01: "when he talks about the moon, the moon clip should come"): a line that
// names one of his moves plays that move — a mood line used to take any of the mood's moves (cheer under "is this the
// moon?") and every joke laughed, also about push-ups or coffee. Only a move he can play now; otherwise the usual one.
const LINE_MOVES = [[/\bwen moon|\bmoon\b/i, 'moon'], [/coffee|\bmug\b/i, 'coffee'], [/pump be with you|saber/i, 'saber'], [/\bsaddle|\bride\b|brought my own|\bbull\b(?! market)/i, 'bull'], [/hard hat|stack(ing)? blocks|block on the stack|builder mode/i, 'build'],
  [/push-?ups?|\bgym\b/i, 'pushups'], [/\bdanc/i, 'dance'], [/\bwalk|\bstroll/i, 'walk'], [/diamond hands|\bhodl\b/i, 'hodl'], [/\bnft\b/i, 'nft'], [/\bshrug/i, 'shrug'], [/\bouch\b/i, 'ouch']];
function moveForLine(t, fallback) { for (const [rx, p] of LINE_MOVES) if (rx.test(t || '') && flowPose(p) === p) return p; return fallback; }
function freshJoke() {
  const mine = (MOOD_JOKES[LIFE.combo?.key] || []).filter(j => !JOKE_RECENT.includes(j));
  /* on a day that goes up, no joke says the candles are red (2026-10-07) */
  const up = /^up-/.test(LIFE.combo?.key || ''), all = up ? JOKES.filter(j => !/\bred\b/i.test(j)) : JOKES;
  const pool = mine.length && Math.random() < 0.45 ? mine : all.filter(j => !JOKE_RECENT.includes(j)), j = pick(pool.length ? pool : all);
  JOKE_RECENT.push(j); if (JOKE_RECENT.length > 10) JOKE_RECENT.shift(); return j;
}
function tellJoke(ms) {
  if (REDUCED || !VID.v) { speak(freshJoke(), ms); return true; }
  if (VID.go || VID.want && VID.want.p !== 'idle' || !HAVE.has('laugh') || !moveTakes('laugh').length || VID.on && VID.cur && !/^rest/.test(VID.cur) || performance.now() < (LIFE.greetUntil || 0)) return false;
  const j = freshJoke(); setPose(moveForLine(j, 'laugh'), 6, true); speak(j, ms); return true; // urgent: never varied() into another move — a joke laughs, unless it names a move (2026-10-01)
}
// the speech bubble, above his head; letters arrive one by one like he is thinking them
const bubble = document.createElement('div'); bubble.className = 'say'; bubble.setAttribute('aria-live', 'polite');
win.appendChild(bubble);
let typing = 0;
// ---------- his body lives: each move has its own rhythm ----------
// The pictures are stills; the life is in how they move. A gallop bounces, a cheer jumps, a laugh shakes,
// push-ups go down and up, coffee sways slowly. y is % of his height (negative = up), r degrees around his
// feet, sy a squash (+) or stretch. Small numbers on purpose: precise, never wild.
const up = x => -Math.abs(Math.sin(x));
const BMS = { y: 0, r: 0, sy: 0, sx: 0 }; // the sway as shown, easing toward what the pose asks for
// HE FEELS A HIT (2026-10-06, Halloween: the skeleton throws the moon at his head): a short tilt away from the blow that
// dies out in under a second, on top of whatever he does — his clip plays on underneath, nothing is cut. side: -1 | 1
let OUCH_AT = -1e9, OUCH_SIDE = 1;
const ouch = (side = 1) => { OUCH_AT = performance.now(); OUCH_SIDE = side; };
function bodyMotion(p, t) {
  // STANDING LIFE (operator, 2026-09-27: "he should move a tiny bit when standing, not look frozen"): feet stay on the
  // ground (no float); the breath lifts him from the feet — in quicker than out — and the chest widens a touch; his
  // weight shifts slowly from foot to foot on two unrelated rhythms, so it never reads as a metronome. Still small:
  // the Veo clips carry the real motion (2026-09-25: 'die vielen Wackler')
  const b = Math.sin(t * 1.35), br = b > 0 ? b : b * 0.7;
  return { y: 0, r: Math.sin(t * 0.55) * 0.35 + Math.sin(t * 0.21 + 1) * 0.2, sy: br * 0.014, sx: br * 0.005 };
}

// ---------- his face lives: he blinks, and his mouth moves while he speaks ----------
// Each pose may have <pose>@blink and <pose>@talk: the same picture with only the eyes or the mouth changed,
// shown on top for a moment. A pose without them simply does not blink yet. No crossfade on the face: a blink
// is a snap, as it is in any animated film.
const FACE = { el: null, have: new Set(), nextBlink: 0, blinkUntil: 0, talkUntil: 0, talkOpen: false, nextFlap: 0, hop: 0 };
function faceInit() {
  if (FACE.el) return;
  FACE.el = new Image(); FACE.el.className = 'face'; FACE.el.alt = ''; fig.insertBefore(FACE.el, fig.querySelector('.rgb'));
  // only the face frames that exist (the deploy lists them in fig/faces.json, 2026-09-27): most poses have a clip now
  // and no face frames, and asking for all of them cost ~60 requests that each came back as the index page
  const load = (names) => { for (const n of names) { const i = new Image(); i.onload = () => FACE.have.add(n); i.src = `${BASE}fig/${n}.webp`; } };
  const all = ['idle', 'burn', 'liq', 'defi', 'giggle', ...EXTRA_POSES].flatMap(p => [p + '@blink', p + '@talk']);
  fetch(`${BASE}fig/faces.json`, { cache: 'no-cache' }).then(r => r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : Promise.reject())
    .then(list => load(list.filter(n => all.includes(n)))).catch(() => load(all));
}
function faceShow(k) {
  if (!FACE.el) return;
  const key = k && pose + '@' + k;
  if (!key || !FACE.have.has(key)) { FACE.el.classList.remove('on'); return; }
  const src = `${BASE}fig/${key}.webp`; if (!FACE.el.src.endsWith(src)) FACE.el.src = src;
  FACE.el.classList.add('on');
}

// ---------- real motion: Veo clips of him, played over the still pose (2026-09-25) ----------
// Each move may have anim/<pose>.pack.mp4: an ordinary H.264 video twice as tall — colour on top, the alpha
// mask below (key_clip.py) — so it plays on every phone, iPhones included, where transparent WebM does not.
// A tiny WebGL canvas in the figure box puts colour and mask back together, cropped to exactly the frame of
// the still (the clip was made from it on a 720x1280 canvas, figure at y 110..1190). The first frame IS the
// still, so the switch from picture to motion does not show; a move without a clip stays the picture it was.
const VID = { cv: null, gl: null, tex: null, v: null, have: new Set(), tried: new Set(), cur: null, on: false };
const VID_Y0 = 110 / 1280, VID_Y1 = 1190 / 1280;
// the canvas reaches above his picture box by the strip the still crops away, so a fireball tossed up stays in view (and fades at the very edge)
const VID_HEAD = VID_Y0 / (VID_Y1 - VID_Y0);
function vidInit() {
  if (VID.cv) return;
  const cv = document.createElement('canvas'); cv.className = 'vid'; fig.insertBefore(cv, FACE.el || fig.querySelector('.rgb'));
  const gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true, antialias: false, preserveDrawingBuffer: true });
  if (!gl) { cv.remove(); return; }
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 u;void main(){u=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
  // R = the part of the source frame the canvas shows: x0, width, y0, height (source units, 0..1) — see FRAMING
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `precision mediump float;varying vec2 u;uniform sampler2D t;uniform vec4 R;
    void main(){float x=R.x+u.x*R.y;float y=R.z+(1.-u.y)*R.w;
    vec3 c=texture2D(t,vec2(x,y*.5)).rgb;float a=texture2D(t,vec2(x,.5+y*.5)).r;
    a=smoothstep(.04,.96,a)*smoothstep(0.,.09,y)*smoothstep(1.,.97,y)*smoothstep(0.,.1,x)*smoothstep(1.,.9,x);gl_FragColor=vec4(c*a,a);}`));
  // SOFT EDGES (operator, 2026-09-27: "nothing may be shown cut off"): what Veo drew past the frame — the volcano on
  // the right, the saber's tip on the left, a fireball tossed up — used to end in a hard line. The frame's last tenth
  // on the left and right and its top strip now fade to nothing; he stands 15% inside the frame and never reaches it.
  gl.linkProgram(pr); gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.BLEND);
  // TWO VIDEO ELEMENTS (2026-10-02, trans.mjs: every switch froze 333-1785 ms while the one element loaded the next file):
  // while a take plays, the next one (the queued move, or the rest take picked ahead) loads and decodes its first frame in
  // the spare element; at the last frame the two swap, and the next take's first frame — the same standing pose — is
  // already there. VID.v is always the one on screen; a take the spare does not hold loads as before.
  const mk = () => { const e = document.createElement('video'); e.muted = true; e.loop = false; e.playsInline = true; e.setAttribute('playsinline', ''); e.crossOrigin = 'anonymous'; e.preload = 'auto'; return e; };
  const v = mk(), spare = mk();
  // a copy of the last shown frame, faded out over the next clip when a chain event cannot wait for the current one to end
  const ghost = document.createElement('canvas'); ghost.className = 'vid ghost'; fig.insertBefore(ghost, cv.nextSibling);
  Object.assign(VID, { cv, gl, tex, v, spare, ghost, fresh: true, uR: gl.getUniformLocation(pr, "R") });
  for (const e of [v, spare]) {
    // uploading a 480x1708 frame 60 times a second for a 24 fps clip was the stutter; only new frames go up now
    // HANDED OVER, NOT WAITED FOR (2026-10-02): 'ended' comes a frame and a task later, and a play() needs its own
    // 100-300 ms to start. The next take is started hidden in the spare that long before this one ends (VID.lat, learned
    // from every start of this visit), and takes the canvas once BOTH hold: this take has shown its LAST frame (the
    // standing pose — its last 6 frames glide into it, so it is never cut short) and the next one is running.
    // capped at 0.15 s: with 0.25 a slow first start made the next take run 0.2-0.46 s ahead (its start skipped)
    const lead = () => Math.min(0.15, Math.max(0.04, (VID.lat ?? 100) / 1000));
    const hand = () => { if (spareReady()) { VID.v.pause(); vidEnded(); } };
    if ('requestVideoFrameCallback' in e) {
      const onFrame = (now, meta) => {
        if (e === VID.v) {
          VID.fresh = true; const sp = VID.spare;
          if (!e.loop && e.duration) {
            e._last = meta.mediaTime >= e.duration - 0.05;
            if (!sp._go && meta.mediaTime >= e.duration - lead() && spareReady()) {
              sp._go = true; sp._shown = false; sp._t0 = performance.now(); if (sp.currentTime > 0.05) sp.currentTime = 0;
              sp.play().catch(() => { sp._go = false; });
            }
            if (e._last && sp._go && sp._shown) hand();
          }
        } else if (e === VID.spare && e._go) {
          if (!e._shown) { e._shown = true; const l = performance.now() - e._t0; VID.lat = VID.lat == null ? l : VID.lat * 0.6 + l * 0.4; }
          if (VID.v._last) hand();
        }
        e.requestVideoFrameCallback(onFrame);
      };
      e.requestVideoFrameCallback(onFrame);
    }
    else VID.noRvfc = true;
    e.addEventListener('ended', () => { if (e === VID.v) vidEnded(); });
  }
  // which clips exist: asked once each, quietly. A static host answers a missing file with its index page and
  // a 200, so only a video counts (found 2026-09-25). Standing takes (idle, idle-v2, rest, rest-v2) and the hub
  // moves, each maybe with a second take (hub-<move>-v2).
  // ONE LIST, NOT SEVENTY QUESTIONS (2026-09-27): the deploy writes anim/clips.json with every clip it ships. Asking
  // for each possible clip cost ~70 requests per visit, and each missing one came back as the index page, whose
  // stylesheet hints the browser then chased relative to anim/. The per-clip question stays only as the fallback.
  const moves = ['burn', 'liq', 'defi', 'giggle', 'nft', 'ouch', ...EXTRA_POSES, ...TIER_POSES]; // nft: he paints the card (hub-nft, 2026-09-29); ouch: the Halloween moon hits his head (2026-10-06) — known here, never one of his own idle moves
  // every take up to -v9 (2026-09-30: new waiting takes rest-v3..v6 and third takes of moves would have been ignored)
  const V = n => Array.from({ length: 8 }, (_, i) => n + '-v' + (i + 2));
  const wanted = ['idle', ...V('idle'), 'rest', ...V('rest'), ...ENTRANCES.flatMap(e => ['hub-enter-' + e, ...V('hub-enter-' + e)]), ...moves.flatMap(m => ['hub-' + m, ...V('hub-' + m), m, m + '-v2'])];
  // which clips were shot in the wide framing (FRAMING.wide); a list that does not answer means none
  // no greeting came (a moment took the stage): alive anyway — but a greeting only waiting for the boot gets until 22 s
  const fb = () => { if (!SAID_HI && performance.now() < 22e3 && !QUEUE.length) return setTimeout(fb, 1000); GREETED = true; LIFE.saidHi = true; if (!VID.cur) vidRest(); }; // no greeting: the joke button is free anyway
  setTimeout(fb, 9000);
  // until his entrance the picture is empty; never longer than 25 s, whatever happens (a clip that never loads)
  if (!REDUCED && ENTRANCES.length) { fig.classList.add('away'); setTimeout(() => { if (!/-enter-/.test(VID.cur || '')) fig.classList.remove('away'); }, 25e3); }
  VID.wide = new Set(); fetch(`${BASE}anim/wide.json`, { cache: 'no-cache' }).then(r => r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : []).then(l => { for (const c of l) VID.wide.add(c); }).catch(() => {});
  fetch(`${BASE}anim/clips.json`, { cache: 'no-cache' }).then(r => r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : Promise.reject())
    .then(list => { for (const p of list) if (wanted.includes(p)) VID.have.add(p); VID.listed = true; const e = !GREETED && enterTake(); if (e) prefetchClip(e); else fig.classList.remove('away'); if (!VID.cur && GREETED) vidRest(); prefetchClip(waveTake() || 'idle'); }) // the greeting's wave, fetched while the page boots
    .catch(() => { fig.classList.remove('away'); Promise.allSettled(wanted.map(p => fetch(`${BASE}anim/${p}.pack.mp4`, { method: 'HEAD' }).then(r => { if (r.ok && /^video\//.test(r.headers.get('content-type') || '')) VID.have.add(p); }))).then(() => { VID.listed = true; }); });
}
// Every clip begins and ends in his standing still, so clip -> clip never shows a seam. Between moves he stands in
// the calm rest takes, one after the other (vidRest); the still shows only while no clip can play.
// FRAMING (2026-09-27, operator: "everything visible, nothing cut"): where his still sits inside a clip's source frame
// (b*) and which part of that frame the canvas shows (s*), both in source units 0..1. The canvas is laid over his
// picture box so that b* lands exactly on it — he keeps his size and place in every clip — and reaches past the box
// by whatever the clip shows around him.
//   normal — the first takes: he fills the 720x1280 frame (still = y 110..1190); shown down to his feet
//   wide   — takes shot from figure/hub-start-wide.png: he stands at 70% (x 108..612, y 451..1207), with room
//            on both sides and above for the volcano, the saber and a fireball; the whole frame is shown
const FRAMING = {
  normal: { sx0: 0, sx1: 1, sy0: 0, sy1: 1190 / 1280, bx0: 0, bx1: 1, by0: 110 / 1280, by1: 1190 / 1280 },
  wide: { sx0: 0, sx1: 1, sy0: 0, sy1: 1, bx0: 108 / 720, bx1: 612 / 720, by0: 451 / 1280, by1: 1207 / 1280 },
};
function vidFrame(c) {
  const F = VID.wide && VID.wide.has(c) ? FRAMING.wide : FRAMING.normal, bw = F.bx1 - F.bx0, bh = F.by1 - F.by0;
  VID.F = F; VID.wf = (F.sx1 - F.sx0) / bw; VID.hf = (F.sy1 - F.sy0) / bh;
  const css = { left: -(F.bx0 - F.sx0) / bw * 100 + '%', top: -(F.by0 - F.sy0) / bh * 100 + '%', width: VID.wf * 100 + '%', height: VID.hf * 100 + '%', right: 'auto', bottom: 'auto' };
  Object.assign(VID.cv.style, css); // the ghost keeps the framing of the clip it copied (vidGhost)
  VID.gl.uniform4f(VID.uR, F.sx0, F.sx1 - F.sx0, F.sy0, F.sy1 - F.sy0);
}
// a take that starts and ends inside the move, not in his standing pose
const SOFT = c => !/^(hub-|idle|rest)/.test(c);
// THE NEXT CLIP IS ALREADY HERE (2026-09-29, flow.mjs: a queued move started 1.3-1.5 s after the clip before it ended — the
// new file loaded first, and he stood still meanwhile). A move that waits its turn is fetched while the clip before it still
// plays (up to 8 s), and starts from memory; the takes that come most often are warmed at the start. At most 10 are kept.
// ONE DOWNLOAD PER CLIP (2026-10-06): fetched into the browser's cache, the two players still asked the network for every
// take each time they played it (range requests) — 4.2 of 4.8 MB in three minutes. Now each take is downloaded once and
// kept in memory as a blob: URL (the CSP allows media-src blob: since then; before, blob: media failed with
// NotSupportedError). At most CLIP_KEEP takes are kept; one a player holds is never dropped. Without blob support, or
// before its download is done, a take plays from its address as before.
const WARM = new Set(), CLIPS = new Map(), CLIP_KEEP = 14;
const BLOB_OK = (() => { const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); return !m || /media-src[^;]*blob:/.test(m.content); })();
// a page served without that policy (the lab, an old cache) refuses blob: media: then back to addresses, for good
let BLOB_BAD = false;
addEventListener('securitypolicyviolation', e => { if (BLOB_BAD || !/^blob/.test(e.blockedURI || '')) return; BLOB_BAD = true;
  for (const v of [VID.v, VID.spare]) if (v && /^blob:/.test(v.src)) { const c = v === VID.v ? VID.cur : v._c; if (c) { v.src = `${BASE}anim/${c}.pack.mp4`; if (v === VID.v) v.play().catch(() => {}); } }
  for (const u of CLIPS.values()) URL.revokeObjectURL(u); CLIPS.clear(); WARM.clear(); });
function clipSrc(c) { if (BLOB_BAD) return `${BASE}anim/${c}.pack.mp4`; const u = CLIPS.get(c); if (u) { CLIPS.delete(c); CLIPS.set(c, u); return u; } prefetchClip(c); return `${BASE}anim/${c}.pack.mp4`; }
// a download on its way: PEND holds its promise (the blob: URL, or null when it failed)
const PEND = new Map();
function prefetchClip(c) {
  if (!c || WARM.has(c) || !VID.have?.has(c)) return;
  WARM.add(c);
  const p = fetch(`${BASE}anim/${c}.pack.mp4`).then(r => r.ok ? r.blob() : Promise.reject()).then(b => {
    if (!BLOB_OK || BLOB_BAD || !b.size) return null;
    const url = URL.createObjectURL(b); CLIPS.set(c, url);
    for (const [k, u] of CLIPS) { if (CLIPS.size <= CLIP_KEEP) break; if (k === VID.cur || k === VID.spare?._c || VID.v?.src === u || VID.spare?.src === u) continue; URL.revokeObjectURL(u); CLIPS.delete(k); WARM.delete(k); }
    return url;
  }).catch(() => { WARM.delete(c); return null; }).finally(() => PEND.delete(c));
  PEND.set(c, p);
}
function vidStart(c, loop = false) {
  // ITS COPY IS ON THE WAY (2026-10-06, clipnet.mjs: a moment that came before its take was in memory fetched it a
  // second time from the address): wait for the copy — the address would need the same download — at most 2.5 s
  const sp0 = VID.spare, pf = !(sp0 && sp0._c === c && sp0.readyState >= 2) && !CLIPS.has(c) && PEND.get(c);
  if (pf && VID.waitC !== c && VID.waited !== c) { const k = VID.waitC = c; let done = false; const go = () => { if (done) return; done = true; if (VID.waitC === k) { VID.waitC = null; VID.waited = c; vidStart(c, loop); } };
    pf.then(go); setTimeout(go, 2500); return; }
  VID.waitC = null; VID.waited = null;
  // THE FRAMING CHANGES WITH THE NEW CLIP'S FIRST FRAME, NOT BEFORE (2026-09-28, operator: "sometimes BOBAI gets
  // extremely big"): set at once, the old clip's last frame stayed on the canvas for the few hundred ms the new one
  // took to load, drawn in the new clip's framing — a normal take's frame in the wide framing is 1.4x too big.
  // From the still (nothing on the canvas) it may change at once.
  if (VID.on) VID.frameFor = c; else { VID.frameFor = null; vidFrame(c); }
  if (!/-enter-/.test(c)) fig.classList.remove('away'); // after his entrance (or without one) he is in the picture
  (window.__btClips = window.__btClips || []).push(c); if (window.__btClips.length > 80) window.__btClips.shift(); // every clip played, for checks from outside
  // from the still, a soft take fades in over it; out of a playing clip the ghost already dissolves the seam
  VID.cv.classList.toggle('soft', SOFT(c) && !VID.on);
  // the spare holds this take with its first frame decoded: swap, no loading (vidPreload)
  const sp = VID.spare;
  if (sp && sp._c === c && sp.readyState >= 2 && !sp.error) {
    const old = VID.v, going = sp._go; VID.v = sp; VID.spare = old; old.pause(); old._c = null; old._go = false; sp._go = false; VID.fresh = true;
    if (!going && sp.currentTime > 0.05) sp.currentTime = 0; // started early (LEAD): it runs on from where it is
  } else {
    (window.__btLoads = window.__btLoads || []).push([c, sp && sp._c, sp && sp.readyState]); if (window.__btLoads.length > 40) window.__btLoads.shift(); // a switch the spare missed, for checks
    VID.v.src = clipSrc(c); if (sp && sp._c === c) { sp._c = null; sp._go = false; sp.pause(); }
  }
  VID.cur = c; VID.v.loop = loop; VID.v._last = false; trace('start', c, VID.v === sp ? 'swap' : 'load', !!HELD);
  // the canvas shows only once the clip's first frame is on it (vidDraw), so there is never an empty frame between
  VID.v.play().then(() => { trace('playing', c, VID.cur === c); if (VID.cur !== c) return; VID.on = true; VID.showOn = true; VID.fresh = true; if (!/^rest/.test(c) && !/-enter-/.test(c)) flushSay(); })
    .catch(err => {
      if (VID.cur !== c) return;
      // NEVER A FROZEN STILL FOR A HICCUP (2026-09-29, flow.mjs: 3-4% still): any failed play() stopped the video on the
      // still and struck the clip off for the whole visit. An interrupted play (AbortError) is ignored; a clip that fails
      // twice is struck off; either way he goes on in his calm rest take, the still only if the rest take itself fails.
      (window.__btVidErr = window.__btVidErr || []).push([Math.round(performance.now() / 1000), c, err?.name || String(err)]);
      if (err?.name === 'AbortError') return;
      // AUTOPLAY REFUSED (2026-10-03, operator's phone in power-saving mode: "his lively moves are gone"): the browser
      // plays no video without a touch. Not a broken clip — none is struck off; he stands in his still and his clips
      // come back with the first tap anywhere on the page
      if (err?.name === 'NotAllowedError') {
        const g = VID.go; VID.go = null; vidStop(); if (g) g(); // a board that waited for this move still shows
        if (!VID.wake) { VID.wake = () => { document.removeEventListener('pointerdown', VID.wake, true); VID.wake = null; if (!VID.cur) vidRest(); }; document.addEventListener('pointerdown', VID.wake, true); }
        return;
      }
      VID.fails = VID.fails || {}; VID.fails[c] = (VID.fails[c] || 0) + 1; if (VID.fails[c] >= 2) VID.have.delete(c);
      if (/^rest/.test(c)) { if (VID.fails[c] >= 2) vidStop(); else { VID.on = false; vidStart(c); } return; }
      VID.move = null; VID.on = false; const g = VID.go; VID.go = null; vidRest(); if (g) g(); // a board that waited for this move still shows
    });
}
function vidStop() {
  VID.cur = null; VID.move = null; VID.on = false;
  if (VID.cv) { VID.cv.classList.remove('soft', 'on'); VID.v.pause(); }
  fig.classList.remove('moving', 'away'); showStill();
}
// every take of a move, however many come (operator, 2026-09-29: 'all videos played, in turns, also the new ones'):
// -v2 up to -v9 join by themselves the day clips.json lists them; vidMove plays them round-robin
function takesOf(base) { return [base, ...Array.from({ length: 8 }, (_, i) => base + '-v' + (i + 2))].filter(c => VID.have.has(c)); }
// a move's takes: its hub takes. ONE FLOW FIRST (operator, 2026-09-28: "the transitions are anything but one flow —
// above all the hard hat and the blocks"): measured, every hub take starts and ends within 2.5 of his still, every
// older take 10-28 away (build 28), and a fade between two poses still reads as a jump. So only hub takes play, as
// on 27.9. ("it was like that before"); a move without its hub take yet (defi, think, hodl — being shot) takes its
// STAND_IN, and its own hub take is used the day it arrives.
// THE DEFI AGENT BUYS BOBAI (2026-10-03, operator: "when the DeFi agent buys BOBAI, animate it"): the two takes where
// the golden robot helper (his DeFi agent) rolls in with coins play the agent's BOBAI buy (fees collected or a re-set
// that sends fees to BOBAI); its other steps keep the hologram and the phone, so the robot means: BOBAI was bought
// (operator, same day: "BOBAI buys BOBAI with the DeFi agent = the golden robot cat, new capital = the blue ones"): new
// capital plays the two blue hologram takes
const DEFI_COIN = ['hub-defi-v4', 'hub-defi-v5'], DEFI_BLUE = ['hub-defi', 'hub-defi-v2'];
function moveTakes(p) {
  if (p === 'defi-buy') return DEFI_COIN.filter(c => VID.have.has(c));
  if (p === 'defi-cap') return DEFI_BLUE.filter(c => VID.have.has(c));
  const t = takesOf('hub-' + p), work = p === 'defi' ? t.filter(c => !DEFI_COIN.includes(c)) : t;
  return work.length ? work : t;
}
function vidMove(p, urgent) {
  if (!VID.v || REDUCED) return;
  const takes = moveTakes(p); if (!takes.length) return;
  if (!urgent && VID.go) return; // a scene is waiting for its move: his own moves wait too
  // the same move again: nothing to do — except for the chain's next event of the same kind while the first one's take
  // is in its last seconds (2026-10-05: two NICE BUYs in a row, the second board came 6.7 s after the first, the 8 s
  // take was still on, nothing was queued and he stood in his rest take beside the second board): its next take follows
  if (VID.move === p && !(urgent && VID.on && !VID.want && (VID.v.duration || 8) - VID.v.currentTime < 3.5)) return;
  // his own move (a joke, a gesture) never queues behind a move that is playing; the chain's events do (a burst is
  // thinned where it belongs, in moment(): a clip dropped here would leave its board on screen without him moving)
  if (!urgent && VID.on && VID.cur && !/^(rest|idle)/.test(VID.cur)) return;
  if (!urgent && VID.want && VID.want.p !== 'idle') return; // nor does it replace a move still waiting its turn
  VID.turn = VID.turn || {}; const n = VID.turn[p] = VID.turn[p] == null ? Math.floor(Math.random() * takes.length) : VID.turn[p] + 1;
  const c = takes[n % takes.length];
  // standing as the still: the move starts right away — its first frame IS the standing pose
  if (!VID.on) { if (VID.on && SOFT(c)) vidGhost(); VID.want = null; VID.move = p; vidStart(c); return; }
  // something is playing: a quiet move waits for it to come home to the standing pose; the chain's event does not
  // wait long — with more than 2.5 s left, the current frame dissolves into the new clip over a third of a second
  const left = (VID.v.duration || 8) - VID.v.currentTime;
  // anything playing is waited out to its last frame — his standing pose — even for the chain's own events; what he
  // says is held back with it (holdSay/flushSay), so bubble and move still come together
  VID.want = { p, c }; prefetchClip(c); holdSay(); void left;
}
// EXACT POSE ONLY (2026-09-28, operator: "the transitions must happen exactly when BOBAI is in exactly the same
// start/end pose"; "always one flow, a change of motif not — or almost not — visible to the human eye"). Measured
// (temp/terminal/home_points.py): no take passes through the standing pose in its middle, only at its first and
// last frame. So a clip changes only where one ends: nothing is cut into, dissolved or slowed (tried the same day —
// ramped speed at the cuts and 0.35 s dissolves — and he looked worse: "before it was better").
window.__btVideo = () => VID.v; // trans.mjs: the video element on screen (not in the DOM), to time every presented frame
window.__btVideos = () => [VID.v, VID.spare].filter(Boolean); // both elements (they swap at every preloaded switch)
window.__btVid = () => VID.v ? [VID.cur, +VID.v.currentTime.toFixed(2), +VID.v.playbackRate.toFixed(2), +(VID.v.duration || 0).toFixed(2)] : null; // for checks from outside (read-only)
function vidGhost(dur = 0.35) {
  const { cv, ghost } = VID; if (!ghost || !VID.on) return;
  ghost.width = cv.width; ghost.height = cv.height; ghost.getContext('2d').drawImage(cv, 0, 0);
  for (const k of ['left', 'top', 'width', 'height', 'right', 'bottom']) ghost.style[k] = cv.style[k];
  ghost.style.transition = 'none'; ghost.style.opacity = 1; void ghost.offsetWidth;
  ghost.style.transition = `opacity ${dur}s`; ghost.style.opacity = 0;
}
// a small moment of standing life (the wave, the stretch): plays once, back to the still
// HIS WAVE SAYS SOMETHING (operator, 2026-10-01: "when he waves, the joke button says 'telling you something' but he says
// nothing — he could greet the community: hey builders, believers, brainers, thanks for the support"): a wave between his
// moments now comes with one of these, typed when his hand goes up (held like every move's line), never the same twice soon
const HELLO = [
  'Hey builders, believers, brainers! Good to have you here.',
  'Thank you for the support. Every one of you counts.',
  'Hello to everyone watching. You keep this brain running.',
  'Builders, believers, brainers: thank you. We build this together.',
  'Waving to the best community on BNB Chain.',
  'Thanks for being here. The chain is more fun with you.',
  'Hey, you! Yes, you. Thanks for watching me build.',
  'Brainers, you are the reason I keep building.',
];
// the second take is a stretch with a big yawn, not a wave: its own lines (operator, 2026-10-01: "when he yawns it says
// 'telling you something' and he says nothing")
const STRETCH = [
  'Big stretch. Building on BNB Chain is a full-body job.',
  'Yawn. Not bored, just a long day of building.',
  'Stretch break. My bots keep watching the chain.',
  'Even a brain needs a stretch. Back to work.',
  'One yawn, then back to the next block.',
];
let HELLO_BAG = [], STRETCH_BAG = [];
function waveHello() {
  const later = VID.on, c = vidIdle(); if (!c) return false;
  let line;
  if (/-v2$/.test(c)) { if (!STRETCH_BAG.length) STRETCH_BAG = [...STRETCH].sort(() => Math.random() - 0.5); line = STRETCH_BAG.shift(); }
  else { if (!HELLO_BAG.length) HELLO_BAG = [...HELLO].sort(() => Math.random() - 0.5); line = HELLO_BAG.shift(); }
  speak(line, 5600); if (later) holdSay(); // after the rest take: the line waits for the move
  LIFE.next = Math.max(LIFE.next, performance.now() + 16e3); // his next own moment waits out the wave and its line (2026-10-05: it spoke over a held wave line 3 s later)
  return true;
}
function vidIdle() {
  if (!VID.v || REDUCED || VID.go || VID.on && !/^rest/.test(VID.cur)) return false;
  const takes = takesOf('idle'); if (!takes.length) return false; // a wave or a stretch (the rest takes play anyway)
  VID.idleN = (VID.idleN ?? Math.floor(Math.random() * takes.length)) + 1; const c = takes[VID.idleN % takes.length];
  if (VID.on) { VID.want = { p: 'idle', c }; prefetchClip(c); return c; } // after the rest take, back in his standing pose (the take's name: truthy)
  VID.move = 'idle'; vidStart(c); return c;
}
// HIS ENTRANCE (operator, 2026-10-02: "when the terminal starts, a start animation — BOBAI drives up in a Fiat Multipla,
// comes as a breakdancer, with a horde of baby kraken, in full construction gear… only once at the start, or on a
// reload"). Until the greeting the picture is empty (fig.away hides the still); the entrance starts on the empty
// screen and ends in his standing pose, the greeting wave follows at its end with the line. Never the same one twice
// running in this browser. No entrance clip (or reduced motion): he stands there and waves, as before.
// NONE ANY MORE (operator, 2026-10-02: "the welcome videos we leave be, the start of the terminal stays as it is now"):
// the list is empty, so no entrance plays and the still is never hidden while the clip list loads (that blank showed as
// 2-3 empty frames at the start, trans.mjs). The takes were ['multipla', 'breakdance', 'puppies', 'builder', 'jetpack', 'giftbox'].
const ENTRANCES = [];
function enterTake() {
  if (REDUCED || !VID.v) return null;
  if (VID.enterC && VID.have.has(VID.enterC)) return VID.enterC;
  const all = ENTRANCES.flatMap(e => takesOf('hub-enter-' + e)); if (!all.length) return null;
  let last = ''; try { last = localStorage.getItem('bobai-bt-enter') || ''; } catch {}
  const L = all.length > 1 ? all.filter(c => c !== last) : all;
  return VID.enterC = L[Math.random() * L.length | 0];
}
window.__btEnter = () => [VID.enterC || null, fig.classList.contains('away'), VID.cur]; // for checks from outside
// the wave itself, for the greeting and a visitor who rests the mouse on him (hoverBobai)
// MORE THAN ONE HELLO (operator, 2026-10-02: "the greeting is almost always the same"): every wave take (not the stretch,
// idle-v2) takes turns, and this browser remembers the last one, so the next visit opens with another
function waveTake() {
  if (VID.waveC && VID.have.has(VID.waveC)) return VID.waveC;
  const waves = takesOf('idle').filter(c => c !== 'idle-v2'); if (!waves.length) return null;
  let last = ''; try { last = localStorage.getItem('bobai-bt-wave') || ''; } catch {}
  const L = waves.length > 1 ? waves.filter(c => c !== last) : waves, c = L[Math.random() * L.length | 0];
  VID.waveC = c; try { localStorage.setItem('bobai-bt-wave', c); } catch {} return c;
}
function vidWave() {
  const c = !VID.v || REDUCED || VID.go || VID.on && !/^rest/.test(VID.cur) ? null : waveTake(); if (!c) return false;
  VID.waveC = null; // the next wave of this visit is another one
  if (VID.on) { VID.want = { p: 'idle', c }; prefetchClip(c); return true; } // at the rest take's end
  VID.want = null; VID.move = 'idle'; vidStart(c); return true;
}
// ALWAYS ALIVE (2026-09-28, operator: "the standing pose as a video where he moves calmly, not frozen like now";
// "BOBAI must always look animated and alive in the terminal"): between moves the two calm rest takes play one after
// the other — breathing, the arms settling, a blink, a small smile — each starting and ending in his standing pose
// (seam 1.95-2.06, as good as the hub takes). The one with the broad smile (rest-v2) comes about one time in three
// and never twice running: on its own on repeat it showed the same chuckle every 8 s (2026-09-27).
let GREETED = false;
function restTake() {
  const r = takesOf('rest'); if (r.length < 2) return r[0] || null;
  // MORE WAITING TAKES (2026-09-30, operator: "3-4 different ones, lots of variety"): the plain breathing one about 40%
  // of the time, the others share the rest, never the same take twice running (the broad smile no longer on repeat)
  const others = r.filter(c => c !== 'rest' && c !== VID.lastRest);
  return VID.lastRest = (VID.lastRest !== 'rest' && Math.random() < 0.4) || !others.length ? 'rest' : pick(others);
}
function vidRest() {
  const c = !REDUCED && VID.v && (VID.nextRest && VID.have.has(VID.nextRest) ? VID.nextRest : restTake()); VID.nextRest = null; if (!c) { vidStop(); return; }
  VID.move = null; vidStart(c);
}
// THE BOARD COMES WITH HIS MOVE (operator, 2026-09-28: "the animation and the flipchart come together — the next action
// just waits"). A scene's window shows the moment his move starts: while a clip still plays to its last frame (the
// standing pose), the window waits with it. Nothing else takes the stage meanwhile; a stuck clip lets it go after 12 s.
function withMove(show) {
  if (VID.want && VID.want.p !== 'idle') {
    VID.go = show;
    setTimeout(() => { if (VID.go === show) { VID.go = null; show(); } }, 12000); // an 8 s take + the next one loading: 9 s was sometimes too short (replay 29.9.)
    return;
  }
  VID.go = null; show();
}
function vidEnded() {
  if (SOFT(VID.cur || '')) vidGhost(); // a soft take ends inside the move: its last frame dissolves into what comes next
  if (VID.want) { const { p, c } = VID.want; VID.want = null; VID.move = p; vidStart(c); const g = VID.go; VID.go = null; if (g) g(); return; }
  // home again: the standing pose, alive — the next calm rest take (vidRest)
  if (pose !== 'idle') { pose = 'idle'; }
  vidRest();
}
// what plays after this take, loaded into the spare element while this one plays (see vidInit): the move waiting its turn,
// else the rest take vidRest will pick (picked now, kept for it)
function vidPreload() {
  const sp = VID.spare; if (!sp || VID.v.loop) return;
  const c = VID.want ? VID.want.c : (VID.nextRest = VID.nextRest || restTake());
  if (!c || !VID.have.has(c)) return;
  if (sp._c !== c) { sp._c = c; sp._warm = false; sp._go = false;
    // A TAKE ON ITS WAY IS WAITED FOR (2026-10-06, clipnet.mjs: every take's first play came over the network twice, the
    // spare asking for the address while the memory copy was still loading — 0.9 MB a take): the spare stays empty until
    // the copy is here (a few seconds while the clip before plays); if the switch comes first, vidStart loads it as before
    if (!CLIPS.has(c) && !BLOB_BAD && BLOB_OK) { prefetchClip(c); const p = PEND.get(c);
      if (p) { sp.removeAttribute('src'); sp.load(); p.then(u => { if (sp._c === c && sp !== VID.v && !sp.getAttribute('src')) sp.src = u ? clipSrc(c) : `${BASE}anim/${c}.pack.mp4`; }); return; } }
    sp.src = clipSrc(c); return; }
  // A SLEEPING DECODER (2026-10-02, trans.mjs): Chrome parks a paused element's decoder, and waking it at the switch cost
  // 130-400 ms with the first frames skipped. Shortly before the switch the spare plays a moment and goes back to its
  // first frame, awake (playing it at speed 0 instead was measured slower: median 150 ms against 117)
  const left = (VID.v.duration || 8) - VID.v.currentTime;
  if (!sp._warm && left < 0.8 && sp.readyState >= 2) {
    sp._warm = true;
    sp.play().then(() => { if (sp !== VID.v && !sp._go) { sp.pause(); sp.currentTime = 0; } }).catch(() => {});
  }
}
// the spare holds what comes next, first frame ready
function spareReady() {
  const sp = VID.spare, c = VID.want ? VID.want.c : VID.nextRest;
  return !!(sp && c && sp._c === c && sp.readyState >= 2 && !sp.seeking);
}
function vidDraw() {
  if (!VID.on || !VID.v) return;
  vidPreload();
  if (VID.v.readyState < 2) return;
  if (VID.frameFor) { vidFrame(VID.frameFor); VID.frameFor = null; VID.fresh = true; } // the new clip's first frame is here: its framing now
  if (RF.n !== FRAME_N || !RF.r) { RF.r = fig.getBoundingClientRect(); RF.n = FRAME_N; }
  const { cv, gl, v } = VID, r = RF.r, dpr = Math.min(devicePixelRatio, 2);
  const w = Math.round(r.width * (VID.wf || 1) * dpr), h = Math.round(r.height * (VID.hf || 1 + VID_HEAD) * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); VID.fresh = true; }
  if (!VID.fresh && !VID.noRvfc && cv.width === w && cv.height === h) return; VID.fresh = false;
  gl.bindTexture(gl.TEXTURE_2D, VID.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  if (VID.showOn) {
    VID.showOn = false; cv.classList.add('on');
    // a soft take fades in over the still; the still goes only once the take covers it
    if (cv.classList.contains('soft')) { const c = VID.cur; setTimeout(() => { if (VID.cur === c && VID.on) fig.classList.add('moving'); }, 420); }
    else fig.classList.add('moving');
  }
}

function faceTick(now) {
  if (!FACE.el || REDUCED || VID.on) { if (VID.on && FACE.el) FACE.el.classList.remove('on'); return; } // a clip moves the whole face itself
  if (now < FACE.talkUntil) {                       // talking: the mouth opens and closes at a speaking pace
    if (now >= FACE.nextFlap) { FACE.talkOpen = !FACE.talkOpen; FACE.nextFlap = now + (FACE.talkOpen ? 90 + Math.random() * 90 : 70 + Math.random() * 80); faceShow(FACE.talkOpen ? 'talk' : null); }
    return;
  }
  if (FACE.talkOpen) { FACE.talkOpen = false; faceShow(null); }
  if (now < FACE.blinkUntil) return;
  if (FACE.blinkUntil) { FACE.blinkUntil = 0; faceShow(null); }
  if (now >= FACE.nextBlink) {                       // a blink every 2.5-6 s, now and then a double one
    faceShow('blink'); FACE.blinkUntil = now + 120;
    FACE.nextBlink = now + (Math.random() < 0.18 ? 260 : 2500 + Math.random() * 3500);
  }
}
// BUBBLE AND MOVE TOGETHER (2026-09-28): a line said while his move still waits for the clip before it to come home
// is held back and typed the moment the move starts (flushSay); a line typed just before the move was queued is
// taken back and held the same way (holdSay)
let LASTSAY = null, HELD = null;
// THE GREETING'S TIMING, FOR CHECKS (2026-10-02: 2 of 12 flow runs showed the greeting line ~1.6 s after the wave): what held
// the line, what let it go and when the wave really started — flow.mjs prints it when its greeting rule fails
const trace = (...a) => { const T = window.__btTrace = window.__btTrace || []; if (T.length < 80) T.push([Math.round(performance.now()), ...a]); };
function holdSay() {
  if (!LASTSAY || performance.now() - LASTSAY.at > 400) return;
  HELD = LASTSAY; LASTSAY = null; typing++; bubble.classList.remove('on'); LIFE.sayUntil = performance.now() + 3500 + HELD.ms;
}
function flushSay() { if (HELD) { const h = HELD; HELD = null; trace('flush', VID.cur); speak(h.text, h.ms); } }
let tapHi = ''; // the hello in front of the first tap's answer (set by bobaiTap for one call)
function speak(text, ms = 5200) {
  if (!text) return;
  if (tapHi) text = tapHi + ' ' + text; // the first tap's hello (bobaiTap)
  // held for the move: the line before it closes now (2026-09-29: it stayed up, stretched over the wait, and the new line
  // only swapped its text in when the move came)
  if (VID.want && VID.want.p !== 'idle' && !REDUCED) { trace('held-for-move', VID.want.p, text.slice(0, 24)); HELD = { text, ms }; typing++; bubble.classList.remove('on'); LIFE.sayUntil = performance.now() + 3500 + ms; return; }
  LASTSAY = { text, ms, at: performance.now() }; trace('say', text.slice(0, 24), VID.cur);
  const id = ++typing; bubble.textContent = ''; bubble.classList.remove('on', 'tight'); void bubble.offsetWidth; bubble.classList.add('on');
  LIFE.sayUntil = performance.now() + ms;
  if (portrait) { bubble.classList.add('top'); win.classList.add('talking'); placeBubble(); } // phone: the top row at once, not a frame later over MOMENTS (2026-09-30); after sayUntil, or placeBubble closes it
  FACE.talkUntil = performance.now() + Math.min(3200, text.length * 22 + 500); // he says it while it types
  // typed by the clock, 22 ms a letter: on a slow device the timer fires late, and one letter per tick left a long line
  // unfinished when its time was up (2026-10-06, a hello line broke off at "We build this to")
  const t0 = performance.now(); let i = 0;
  const step = () => { if (id !== typing) return; i = Math.min(text.length, Math.max(i + 1, Math.floor((performance.now() - t0) / 22))); bubble.textContent = text.slice(0, i); if (i < text.length) setTimeout(step, REDUCED ? 0 : 22); };
  step();
}
function placeBubble() {
  if (!bubble.classList.contains('on')) return;
  if (performance.now() > LIFE.sayUntil) { bubble.classList.remove('on'); win.classList.remove('talking'); underBubble(true); return; }
  const wr = win.getBoundingClientRect(), fr = fig.getBoundingClientRect();
  if (portrait) {
    // Phone: a 360x640 screen has 29 px between the header and his hair, too little for two lines, and a bubble lower
    // down covered his face (measured 2026-09-25). So while he speaks the bubble takes the title row — the title fades
    // for those seconds — and its tail points down at his head. The share and close buttons stay where they are.
    bubble.classList.add('top'); win.classList.add('talking');
    const right = Math.min(wr.width - 12, $('shr').getBoundingClientRect().left - wr.left - 8);
    bubble.style.maxWidth = (right - 12) + 'px';
    const bw = bubble.offsetWidth || 200, cx = fr.left - wr.left + fr.width / 2, left = clamp(cx - bw / 2, 12, right - bw);
    bubble.style.left = left + 'px'; bubble.style.top = '10px';
    bubble.style.setProperty('--tail', clamp(cx - left, 22, bw - 22) + 'px');
    // his hair starts 8.5% down the picture box in every pose; a third line would reach it, so it gets a smaller type
    if (10 + bubble.offsetHeight > fr.top - wr.top + fr.height * 0.085 + 4) bubble.classList.add('tight'); // until the next line: toggling back would flicker
    return;
  }
  bubble.classList.remove('top', 'tight'); win.classList.remove('talking');
  const x = fr.left - wr.left + fr.width * 0.74, y = fr.top - wr.top + fr.height * 0.04;
  // on a wide screen the destination labels stand to his right: the bubble ends before them
  const edge = portrait ? wr.width - 12 : Math.min(wr.width - 12, D.burnA.el.getBoundingClientRect().left - wr.left - 16);
  bubble.style.maxWidth = Math.max(170, Math.min(300, edge - x)) + 'px';
  bubble.style.left = clamp(x, 12, edge - (bubble.offsetWidth || 220)) + 'px';
  bubble.style.top = Math.max(56, y - (bubble.offsetHeight || 40)) + 'px';
  underBubble();
}
// the bots' names orbit his head, right where the bubble sits: one that passes under it steps back for those seconds
// (checked four times a second, not every frame, so the labels' own placement never waits on a layout read)
let underAt = 0;
function underBubble(clear) {
  const now = performance.now(); if (!clear && now < underAt) return; underAt = now + 250;
  const b = !clear && bubble.getBoundingClientRect();
  for (const w of WORKERS) { const r = b && w.el.getBoundingClientRect(); w.el.classList.toggle('under', !!b && r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom); }
}
// the mood: the pool's own price over the last hour — from the swaps he saw, then from his own reads
// THE MARKET'S WEATHER (2026-09-26): the whole scene takes a breath of the hour's mood — a hint of green when the
// price is climbing, of red when it falls, nothing when it is flat. Faded over seconds, never a flash.
const MOOD_TINT = { pump: 'rgba(53,224,122,.11)', up: 'rgba(53,224,122,.055)', flat: 'rgba(0,0,0,0)', down: 'rgba(255,77,109,.055)', dump: 'rgba(255,77,109,.11)' };
const moodEl = document.createElement('div'); moodEl.className = 'mood'; moodEl.setAttribute('aria-hidden', 'true');
win.insertBefore(moodEl, win.querySelector('.vign'));
// HIS MOOD, SHOWN AND MOVING (2026-09-29, operator: "BOBAI tells his market mood and above all shows it animated"): a chip
// under the title names his mood with the hour's figure (an arrow that turns with the market and bounces up, sways or
// sinks); the animation of the mood itself is his video: every mood line and mood swing plays the clip that fits it
// (no weather effects — operator, 2026-09-29: "not weather, the videos we have").
const MOOD_NAME = { pump: 'hyped', up: 'bullish', flat: 'chill', down: 'focused', dump: 'unshaken' };
const nTrades = n => nf(n) + (n === 1 ? ' trade' : ' trades'); // "1 trades" read wrong (2026-09-30)
const $usd = u => '$' + nf(u, 0), pct = x => (x >= 0 ? '+' : '') + x.toFixed(1) + '%', mins = m => m == null ? 'a long while' : m >= 120 ? `${Math.floor(m / 60)} hours` : `${m} minutes`;
const COMBO = {
  'up-loud': { name: 'on fire', moves: ['bull', 'saber', 'dance', 'cheer'], lines: [
    c => `${pct(c.ch)} in 24 hours and ${nTrades(c.n2)} in two hours. Hold on tight, this bull is running.`,
    c => `Green day, loud chain: ${$usd(c.v2)} traded in two hours. Every trade paid 3% to the brain.`,
    c => `${pct(c.ch)} and the volume is screaming. May the pump be with you.`,
    c => `${pct(c.ch)} on the day and the chain will not sit still: ${$usd(c.v2)} in two hours. I can barely keep up with the tax.`,
    c => `${nTrades(c.n2)} in two hours, ${pct(c.ch)} on the day. This is the part where I dance.`,
    c => `Loud and green: ${pct(c.ch)} in 24 hours. Every buy pays 3%, and the burn pile grows with it.`] },
  // the bull in a bullish market (operator, 2026-10-01: "mood check bullish, and the bull hardly ever comes"): it was only in 'on fire' and 'battle mode'
  'up-normal': { name: 'bullish', moves: ['bull', 'cheer', 'saber', 'moon', 'dance'], lines: [
    c => `${pct(c.ch)} in 24 hours, at a steady pace. Green is my favourite colour.`,
    c => `${pct(c.ch)} today, ${nTrades(c.n2)} in two hours. No rush, just up.`,
    c => `Green day, ${pct(c.ch)}. Is this the moon? Asking for a friend.`,
    c => `${pct(c.ch)} in 24 hours. The bull is out, so I saddle up and ride.`,
    c => `${pct(c.ch)} on the day. Steady green, steady burns. That is the plan working.`,
    c => `${pct(c.ch)} in 24 hours and climbing calmly. ${nTrades(c.n2)} in two hours, each one paid its 3%.`] },
  'up-quiet': { name: 'proud', moves: ['coffee', 'hodl', 'dance', 'moon', 'bull'], lines: [
    c => `${pct(c.ch)} in 24 hours, and not one trade for ${mins(c.quietMin)}. Nobody sells. That is conviction.`,
    c => `Green day, quiet chain. ${pct(c.ch)}, and the holders just hold. Coffee time.`,
    c => `${pct(c.ch)} in a quiet day. A slow bull ride, nobody in a hurry.`,
    c => `${pct(c.ch)} today and the chain is whispering. Green and quiet is a good look.`,
    c => `${pct(c.ch)} in 24 hours, and the last trade was ${mins(c.quietMin)} ago. Holders holding, brain building.`,
    c => `Quiet green day, ${pct(c.ch)}. Diamond hands everywhere I look.`] },
  'side-loud': { name: 'restless', moves: ['think', 'pushups', 'walk', 'saber'], lines: [
    c => `${nTrades(c.n2)} in two hours, and the day is only ${pct(c.ch ?? 0)}. Lots of noise, no direction yet.`,
    c => `${$usd(c.v2)} traded in two hours, ${pct(c.ch ?? 0)} on the day. Buyers and sellers are wrestling. I collect the 3%.`,
    c => `${pct(c.ch ?? 0)} on the day, ${nTrades(c.n2)} in two hours. A tug of war, and the rope pays 3%.`,
    c => `Busy and flat: ${$usd(c.v2)} traded in two hours, and the price barely moved. Every one of those trades fed the burn.`,
    c => `Lots of hands, no direction, ${pct(c.ch ?? 0)} on the day. Push-ups while they decide.`,
    c => `${nTrades(c.n2)} in two hours and the chart still says ${pct(c.ch ?? 0)}. Somebody is busy. I am busier.`] },
  'side-normal': { name: 'chill', moves: ['coffee', 'shrug', 'walk', 'think'], lines: [
    c => `${pct(c.ch ?? 0)} in 24 hours, ${nTrades(c.n2)} in two hours. Sideways, and the tax counts every one.`,
    c => `Sideways at ${pct(c.ch ?? 0)}. The chart is doing a plank. I do my job.`,
    c => `${pct(c.ch ?? 0)} on the day. Not up, not down, just working. Like me.`,
    c => `Flat chart, ${nTrades(c.n2)} in two hours. A coffee and the next buyback, in that order.`,
    c => `${pct(c.ch ?? 0)} in 24 hours. Sideways? I shrug and keep the bots running.`,
    c => `A calm ${pct(c.ch ?? 0)} day. Good weather for building.`] },
  'side-quiet': { name: 'bored', moves: ['coffee', 'shrug', 'moon', 'walk'], lines: [
    c => `No trade for ${mins(c.quietMin)}, ${pct(c.ch ?? 0)} on the day. wen volume?`,
    c => `${mins(c.quietMin)} without a single trade. The chart is taking a nap. I am not.`,
    c => `No trade for ${mins(c.quietMin)}. I counted the blocks instead. Lots of blocks.`,
    c => `Quiet chain, ${pct(c.ch ?? 0)} on the day. A little walk around my pool while it naps.`,
    c => `${mins(c.quietMin)} of silence on my chart. The calm before the next buyback.`,
    c => `${pct(c.ch ?? 0)} on the day and nothing moving. Coffee, refill, still building.`] },
  'down-loud': { name: 'battle mode', moves: ['saber', 'hodl', 'pushups', 'bull'], lines: [
    c => `${pct(c.ch)} in 24 hours and ${nTrades(c.n2)} in two hours. Every sell pays 3%, and part of it burns.`,
    c => `Red and loud: ${$usd(c.v2)} traded in two hours. The LP is burned, the pool stays. So do I.`,
    c => `${pct(c.ch)} and a lot of hands moving. Weak hands feed the burn; strong hands get a smaller supply. Stay strong.`,
    c => `${pct(c.ch)} on the day, ${$usd(c.v2)} traded in two hours. Busy red days burn the most tax.`,
    c => `Red and busy: ${nTrades(c.n2)} in two hours. Diamond hands, steady bots, burned LP.`,
    c => `${pct(c.ch)} in 24 hours. Saber out. The bears do not get my pool.`] },
  'down-normal': { name: 'stubborn', moves: ['hodl', 'think', 'pushups', 'walk'], lines: [
    c => `${pct(c.ch)} in 24 hours. Diamond hands, same plan.`,
    c => `${pct(c.ch)} today, ${nTrades(c.n2)} in two hours. Red candles, and the bots work exactly the same.`,
    c => `${pct(c.ch)} on the day. Every red candle is a discount for the patient. We keep building.`,
    c => `${pct(c.ch)} in 24 hours. I do push-ups, the bots do burns. Both of us get stronger.`,
    c => `${pct(c.ch)} today. Red is temporary, a burned LP is forever.`,
    c => `${pct(c.ch)} on the day, ${nTrades(c.n2)} in two hours. Same machine, same 3%, same plan.`] },
  'down-quiet': { name: 'patient', moves: ['think', 'hodl', 'coffee', 'shrug'], lines: [
    c => `${pct(c.ch)} on the day, and no trade for ${mins(c.quietMin)}. The sellers took a break. I did not.`,
    c => `Red and quiet: ${mins(c.quietMin)} without a trade. Time to think, not to panic.`,
    c => `${pct(c.ch)} today and a calm chain. The best projects are built on days nobody watches. Today is one.`,
    c => `${pct(c.ch)} and nobody trading for ${mins(c.quietMin)}. Calm hands. I like calm hands.`,
    c => `Quiet red day, ${pct(c.ch)}. A coffee and a long view.`,
    c => `${pct(c.ch)} in 24 hours and a sleepy chain. The bots do not nap, and neither do I.`] },
};
// SMARTER BY MOOD (2026-09-30, operator: "more intelligent: lines, building explanations and jokes that fit the market
// and his mood; when bored or chill a bit more active, interactive; a red market gets positive, motivating vibes").
// MOOD_JOKES: two per mood, told with the laugh like every joke; MOOD_BUILD: how BOBAI works, said the way the market
// needs it (a red day: why the machine keeps going); INVITES: something real to try on this screen, only in the calm
// moods — never a line pointing at a button that is not there (portrait: only what a finger can reach)
const MOOD_JOKES = {
  // five per mood since 2026-10-02 (operator: "at least five variants of everything")
  'up-loud': ['The chart is so green, my brain photosynthesises.', 'Someone asked if I am bullish. I brought a bull. To the meeting.',
    'The chart is climbing so fast, my bots asked for a seatbelt.', 'Volume this loud, I had to turn my own brain down a notch.', 'Green and loud. Even the dead address sent a thumbs up.'],
  'up-normal': ['Green again. I am starting to think the chart likes me back.', 'My horoscope said: number go up. First time it was right.',
    'Steady up. My chart finally learned to use the stairs.', 'Green day. I checked twice, then once more to be polite.', 'Up again. Must be my good looks. And the burns.'],
  'up-quiet': ['Up and quiet. Even the sellers are too comfy to move.', 'Green day, no trades. Everybody is busy admiring their bags.',
    'Green and quiet. The candles are tiptoeing up.', 'Price up, trades down. Everybody is holding their breath. And their bags.', 'So calm and so green, I almost fell asleep in profit.'],
  'side-loud': ['So many trades, so little direction. Like a group chat planning dinner.', 'Buyers and sellers arm-wrestling. I sell popcorn. Taxed, of course.',
    'All this trading and the chart has not moved. Cardio for candles.', 'Busy and flat. The market is running on a treadmill.', 'Everyone is trading, nobody is winning. Except the burn.'],
  'side-normal': ['Sideways is just the chart meditating. Om. Om. 3% tax.', 'Flat chart, flat white. Balance.',
    'My chart is so flat, I could use it as a table.', 'Sideways again. The candles are practising their posture.', 'Not up, not down. The chart is on airplane mode.'],
  'side-quiet': ['So quiet I can hear the blocks being made. Every half second. Relaxing.', 'No trades for a while. I started talking to the dead address. Great listener.',
    'Quiet day. The candles called in sick.', 'No trades. I could hear a single BOBAI drop.', 'So quiet, the tax queue is counting sheep. 3% of each.'],
  'down-loud': ['Red candles are just green candles playing hard to get.', 'Sell pressure? I call it tax season.',
    'Red and loud. The bears brought a band. I brought the burn.', 'So much selling, the dead address needs a bigger wallet.', 'Bears are loud today. Loud bears pay the same 3%.'],
  'down-normal': ['Red day. My hands are diamond, my coffee is black, my plan is unchanged.', 'The chart went down. I went to the gym. Only one of us is getting stronger.',
    'Red candles? I call them limited editions.', 'The chart dipped. I did not. Brains float.', 'Red day. Good thing I am a brain: pink goes with everything.'],
  'down-quiet': ['Red and quiet: the bears fell asleep. Tiptoe, everybody.', 'Even the sellers take breaks. Brains do not.',
    'Quiet and red. The chart is sulking. It will get over it.', 'The bears are napping. Nobody wake them.', 'Red and silent, like a library where every book is on sale.'],
};
const MOOD_BUILD = {
  up: ['Green day, same machine: 3% of every trade, split by the phase table, burned and locked on-chain. The chart is the result, not the plan.',
    () => `Up days fill the tax queue faster. At ${cmp(MIN_DISPATCH)} BOBAI the token contract swaps it, and the buyback bot splits the BNB the same day.`, // the mark as the token reads it now (minDispatch, 2026-10-06)
    'Green or not, the rule is the same: 3% of every trade, split on-chain, every step with its own transaction.',
    'More trades on green days means more tax, and more tax means bigger burns. My bot does the math every ten minutes.',
    'Up days are a good time to check the receipts. Every burn and every liquidity add on this screen has its transaction.',
    'Price up, LP still burned. The deeper the pool, the calmer the candles.'],
  side: ['Sideways is when building happens. The bots check every ten minutes, the LP stays burned, the DeFi agent works its range.',
    'No drama, just mechanics: every trade pays 3%, and my bot splits it between the circles you see around me.', // true in every tax phase, the creator share included (2026-10-05)
    () => `Flat days are honest days. The tax queue fills, the token swaps it at ${cmp(MIN_DISPATCH)} BOBAI, and my bot splits the BNB.`,
    'While the chart rests, the bots do not. Every ten minutes they check, split and write it all on-chain.',
    'Quiet chart, loud receipts: every step my bots take is a transaction anyone can check on BscScan.',
    'Sideways is a good day to look under the hood. Tap a circle around me and I tell you what its bot did last.'],
  down: ['Red days are when the design shows. Every sell pays 3% too, part of it burns, part deepens the pool. Nobody can pull the liquidity.',
    'Price down, work on. The buyback bot does not read charts. It reads its wallet, every ten minutes, and splits what is there.',
    'Supply only goes one way here: down, into the dead address. A red candle does not change that. It just makes each burn buy more.',
    'Red day, same receipts. Every burn on this screen still has its transaction.',
    'Nobody can pull the pool: the LP tokens sit at the dead address. Red candles cannot change that.',
    'A red day is a stress test, and the machine passes it every ten minutes: check, split, burn, add, log.'],
};
const INVITES = [
  // [line, what must be there] — w = wide screen only, p = portrait only, any = both
  ['Bored? Press REPLAY 24H under the chart and I show you the whole day in a minute. Every scene is real.', 'any'],
  ['Hover a mark on the timeline under the chart: every trade in BOBAI, BNB and dollars.', 'w'],
  ['Type next in my terminal down there and I tell you how full the next buyback is.', 'w'],
  ['Type burns in my terminal. I list my latest burns with their transactions.', 'w'],
  ['Try the four corners button up there. It makes me bigger. I like it.', 'big'],
  ['Tap MOMENTS up there: every burn, liquidity add and big buy of the day, one tap each.', 'mom'],
  ['Tap the MONEY tab. It shows where every BNB of the 3% went.', 'p'],
  ['Tap the TELL ME A JOKE button. I have a few new ones. Some are even good.', 'any'],
  ['Open the 7D chart and hover the orange marks. Each one is a burn run, with its transaction.', 'any'],
  ['Want a picture of this moment? SHARE THIS MOMENT makes one with the live numbers.', 'any'],
];
function inviteLine() {
  const bigBtn = document.querySelector('#bt .bt-big'), can = w => w === 'any' || (w === 'w' && !portrait) || (w === 'p' && portrait) || (w === 'big' && !!bigBtn && !bigBtn.hidden && !document.body.classList.contains('bp-big')) || (w === 'mom' && momList().length > 0); // MOMENTS only when it has some
  const ok = INVITES.filter(([l, w]) => can(w) && !INVITE_RECENT.includes(l)); if (!ok.length) return null;
  const l = pick(ok)[0]; INVITE_RECENT.push(l); if (INVITE_RECENT.length > 5) INVITE_RECENT.shift(); return l;
}
const INVITE_RECENT = [];
window.__btSmart = () => ({ jokes: MOOD_JOKES, build: MOOD_BUILD, invites: INVITES.map(i => i[0]) }); // for checks from outside
window.__btCombos = (c = { ch: -12.3, n2: 9, v2: 1234, quietMin: 95 }) => Object.entries(COMBO).map(([k, m]) => [k, m.name, m.moves.filter(p => flowPose(p) === p).length, ...m.lines.map(f => f(c))]); // for checks from outside
const comboOf = () => COMBO[LIFE.combo?.key] || COMBO['side-normal'];
const moodChip = document.createElement('span'); moodChip.className = 'mdc'; moodChip.dataset.mood = 'flat'; moodChip.hidden = true;
moodChip.innerHTML = '<span class="mi" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 8h10M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="mk">mood</span><b class="mn">chill</b><span class="mp"></span>';
{ const t = document.querySelector('#bt .ttl'); (t || win).appendChild(moodChip); }
function paintMood() {
  moodEl.style.backgroundColor = MOOD_TINT[LIFE.mood] || MOOD_TINT.flat; moodEl.dataset.mood = LIFE.mood;
  const f = LIFE.flow || { b: 0, s: 0 }, pc = (LIFE.d1h >= 0 ? '+' : '') + LIFE.d1h.toFixed(1) + '% 1h';
  moodChip.hidden = !LIFE.combo;
  if (moodChip.dataset.key !== (LIFE.combo?.key || '')) { moodChip.dataset.key = LIFE.combo?.key || ''; moodChip.dataset.mood = LIFE.mood; moodChip.classList.remove('turn'); void moodChip.offsetWidth; moodChip.classList.add('turn'); }
  const c = LIFE.combo; moodChip.dataset.act = c?.act || 'normal';
  moodChip.querySelector('.mn').textContent = comboOf().name;
  moodChip.querySelector('.mp').textContent = c && c.ch != null ? pct(c.ch) + ' 24h' : pc;
  moodChip.title = c ? `BOBAI's mood: ${c.ch != null ? pct(c.ch) + ' in 24 hours' : pc + ' in the last hour'}, ${c.act === 'quiet' ? `no trade for ${mins(c.quietMin)}` : `${nTrades(c.n2)} and ${$usd(c.v2)} in the last 2 hours`}; ${f.b} buys and ${f.s} sells in the last hour` : '';
}
// his mood in words, from what he can see: the hour's price, who traded in it (buys against sells, in dollars), and the
// day's chart — so an hour that dips inside a green day reads as a breather, not as the end of the world
function moodLine(head = 'Mood check') {
  readMood();
  // NO "MOOD CHECK: BULLISH." ANY MORE (operator, 2026-10-02: "the mood checks are super nice — just the opening 'mood check',
  // the mood and the +/- % every time is superfluous, it is already up top left; the text after it must stay as it comes"):
  // a mood check starts with its line; a mood SWING keeps its short opening, it announces the change
  const check = head === 'Mood check';
  if (!LIFE.combo) return check ? 'Still reading my chart. Ask me again in a minute.' : `${head}: still reading my chart. Ask me again in a minute.`; // never "0 trades" from a ledger not loaded yet
  const f = LIFE.flow, c = LIFE.combo, m = comboOf();
  const who = f.b >= 3 && f.bu > f.su * 2 ? ' ' + pick(MOOD_WHO.buy) : f.s >= 3 && f.su > f.bu * 2 ? ' ' + pick(MOOD_WHO.sell) : '';
  return check ? `${pick(m.lines)(c)}${who}` : `${pick(MOOD_HEADS[head] || [head])}: ${m.name}. ${pick(m.lines)(c)}${who}`;
}
// how he opens a mood line and who he saw trading (2026-10-02: five of each, so "Mood check" is not every time)
const MOOD_HEADS = { 'Mood swing': ['Mood swing', 'Mood shift', 'The mood just turned', 'New mood', 'Plot twist'] };
const MOOD_WHO = {
  buy: ['Buyers in charge this hour.', 'The buyers have the wheel this hour.', 'This hour belongs to the buyers.', 'More buying than selling this hour. I noticed.', 'Buyers outnumber sellers this hour.'],
  sell: ['Sellers louder this hour. Their 3% says thanks.', 'Sellers busy this hour. Every sell still pays 3%.', 'More selling this hour. The tax keeps the brain fed anyway.', 'Sellers had the mic this hour. I kept the burns going.', 'A selling hour. Part of their 3% burns, so thank you.'],
};
// the move that shows his mood: the one of these he did longest ago
const MOOD_MOVES = { pump: ['bull', 'saber', 'dance', 'cheer'], up: ['cheer', 'saber', 'dance', 'moon'], flat: ['coffee', 'think', 'shrug', 'walk'], down: ['hodl', 'think', 'pushups', 'saber'], dump: ['think', 'hodl', 'saber', 'walk'] };
function moodMove() {
  const L = (LIFE.combo ? comboOf().moves : MOOD_MOVES[LIFE.mood] || MOOD_MOVES.flat).filter(p => flowPose(p) === p);
  if (!L.length) return poseOr('think');
  return [...L].sort((a, b) => (MOVED.get(a) || 0) - (MOVED.get(b) || 0))[0];
}
window.__btMood = () => ({ mood: LIFE.mood, d1h: +LIFE.d1h.toFixed(2), flow: LIFE.flow, own: ownLast, line: moodLine() }); // for checks from outside
window.__btTestMood = m => { LIFE.mood = m; paintMood(); }; // for checks from outside: show one mood now (the next read sets the real one)
// a move the line NAMES is not varied away (varied() swaps a move he just did; 1.10. linemove.mjs: 'the bull is out' with the dance)
// the mood lines he said, for checks (mood.mjs finds them in the bubble; since 2.10. they have no 'Mood check:' opening)
const saidMood = l => { const L = window.__btMoodLines = window.__btMoodLines || []; L.push(l); if (L.length > 30) L.shift(); return l; };
function tellMood(ms = 6400) { const line = saidMood(moodLine()), named = moveForLine(line, null); setPose(named || moodMove(), 6, !!named); speak(line, ms); }
function readMood() {
  const now = Date.now(), pts = [];
  // who traded in the hour (tax swaps and our own bots left out): the chip's tooltip and his mood lines
  const fl = { b: 0, s: 0, bu: 0, su: 0 };
  // every swap the page read is in S.hist; the record (events) keeps only the ones with a scene (2026-10-01)
  for (const e of S.hist) if (!e.taxSwap && !e.ours && e.t >= now - 3600e3) { if (e.buy) { fl.b++; fl.bu += e.usd || 0; } else { fl.s++; fl.su += e.usd || 0; } }
  LIFE.flow = fl;
  for (const e of S.hist) if (!e.taxSwap && e.bobai > 0 && e.bnb > 0 && e.t >= now - 3600e3) pts.push([e.t, e.bnb / e.bobai]);
  for (const [t, p] of LIFE.prices) if (t >= now - 3600e3) pts.push([t, p / (S.bnbP || 1)]);
  for (const r of CH.rows) if (r.t >= now - 3600e3) pts.push([r.t, r.c]); // the chart's closes: the same pool, the same unit
  pts.sort((a, b) => a[0] - b[0]);
  if (pts.length < 3) { LIFE.mood = 'flat'; LIFE.d1h = 0; readCombo(); paintMood(); return; }
  const med = a => { const s = a.map(x => x[1]).sort((x, y) => x - y); return s[s.length >> 1]; };
  const k = Math.max(1, Math.floor(pts.length / 4)), a = med(pts.slice(0, k)), b = med(pts.slice(-k));
  const d = (b / a - 1) * 100; LIFE.d1h = d;
  LIFE.mood = d >= 8 ? 'pump' : d >= 2 ? 'up' : d <= -8 ? 'dump' : d <= -2 ? 'down' : 'flat';
  readCombo();
  paintMood();
}
// HIS MOOD IS TWO THINGS AT ONCE (operator, 2026-09-29: "up = +10% in 24h, down = -10% in 24h, sideways; and whether there
// is a lot of volume in 1-2 h, or no trade for 1-2 h — a mix of both, many variants"): the day's TREND from his own chart
// (+10% or more up, -10% or less down, else sideways) and the last two hours' ACTIVITY (loud: at least 6 trades and about
// twice the day's usual two-hour volume, or $2,000+; quiet: no trade for 90 minutes; else normal) — nine moods, each with
// its own name, moves and lines. The five old market words stay underneath (his everyday moves and the tint use them).
function readCombo() {
  // no mood before his chart has loaded (2026-09-30): an empty ledger read as "bored, +0.0% 1h" for the first seconds,
  // then the chip jumped to the real mood — and the jump could fire a "Mood swing" line that never happened
  // the few candles built from the page's own swaps (while the ledger loads) hold no 24h figure: wait for the ledger,
  // up to 30 s — only then the stand-in counts (the chip read "+0.0% 1h" under a chart showing +1.16% 24h)
  if (!CH.rows.length || (CH.src !== 'ledger' && performance.now() < 30e3)) { LIFE.combo = null; return; }
  const cs = candles(), now = Date.now(), ch = cs.length >= 12 ? chartChange(cs) : null;
  const trend = ch == null ? (LIFE.d1h >= 2 ? 'up' : LIFE.d1h <= -2 ? 'down' : 'side') : ch >= 10 ? 'up' : ch <= -10 ? 'down' : 'side';
  const usdOf = c => (c.v || 0) * (c.u || S.bnbP || 0);
  const day = cs.filter(c => c.t >= now - 86400e3), two = cs.filter(c => c.t >= now - 7200e3);
  const n2 = two.reduce((a, c) => a + c.n, 0), v2 = two.reduce((a, c) => a + usdOf(c), 0), avg2 = day.reduce((a, c) => a + usdOf(c), 0) / 12;
  let lastT = 0; for (const c of cs) if (c.n > 0) lastT = Math.max(lastT, c.t);
  for (const e of S.hist) if (!e.taxSwap && !e.ours) lastT = Math.max(lastT, e.t);
  const quietMin = lastT ? Math.floor((now - lastT) / 60e3) : null;
  const act = quietMin == null || quietMin >= 90 ? 'quiet' : (n2 >= 6 && v2 >= Math.max(300, avg2 * 1.8)) || v2 >= 2000 ? 'loud' : 'normal';
  LIFE.combo = { key: trend + '-' + act, trend, act, ch, n2, v2, quietMin };
  // the everyday moves follow the combined mood: a loud green day is a pump, a loud red one a dump
  LIFE.mood = trend === 'up' ? (act === 'loud' ? 'pump' : 'up') : trend === 'down' ? (act === 'loud' ? 'dump' : 'down') : 'flat';
}
setInterval(() => { try { if (opened) readMood(); } catch {} }, 20e3); // the chip follows the market between his moves too
// HIS OWN MOMENTS IN EVEN TURNS (operator, 2026-09-29: "when BOBAI speaks up by himself: mood, jokes and what he does,
// equally"): a bag of the three, drawn empty in random order and refilled, never the same kind twice across a refill
let OWN_BAG = [], ownLast = null;
function ownKind() {
  // in a calm mood (not loud) an invitation joins the bag: something real to try on the screen (2026-09-30)
  // MOOD FIRST, THEN WHAT HE DOES, THEN A JOKE (operator, 2026-10-01; it was one of each): of every eight moments of his
  // own four are his mood, three what he does (in a calm market one of them an invitation to try the screen), one a
  // joke — the joke button is there for more. Shuffled so the same kind never comes twice in a row.
  // A HARD DAY (operator, 2026-10-05, at −42%: "BOBAI has to motivate in this difficult time too, and not make so many
  // jokes — people are tilted"): with the day at −15% or worse no joke of his own comes; three of eight moments are a
  // word of heart instead (heartLine). The joke button still tells one to whoever asks for it.
  const kinds = HARD_DAY() ? ['mood', 'mood', 'heart', 'work', 'heart', 'work', 'heart', 'work']
    : LIFE.combo && LIFE.combo.act !== 'loud' ? ['mood', 'mood', 'mood', 'mood', 'work', 'work', 'invite', 'joke'] : ['mood', 'mood', 'mood', 'mood', 'work', 'work', 'work', 'joke'];
  const apart = b => b.every((k, i) => !i || k !== b[i - 1] || k === 'mood' && b.filter(x => x === 'mood').length > b.length / 2);
  if (!OWN_BAG.length) { let n = 0; do OWN_BAG = [...kinds].sort(() => Math.random() - 0.5); while (++n < 200 && (OWN_BAG[0] === ownLast || !apart(OWN_BAG))); }
  return (ownLast = OWN_BAG.shift());
}
// what he does when the chain is quiet, by mood. Lines about his work are functions: real numbers, read now.
// what his own chart says, in words: the day's change and how many trades made it (the TG bot's ledger)
function chartWords() {
  const cs = candles(); if (cs.length < 12) return null;
  const ch = chartChange(cs), n = CH.rows.filter(r => r.t >= Date.now() - 86400e3).reduce((a, r) => a + (r.b || 0) + (r.s || 0), 0);
  const sg = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  return ch == null ? null : { ch, n, s: sg(ch), ...(bnbChange(cs) || {}), sg }; // one decimal, as the mood chip (2026-10-01)
}
// the Giggle Academy slice runs until 20 Nov 2026 00:01 UTC (phase table); after that no line may say trades still feed it
const GIGGLE_OPEN = () => Date.now() < Date.parse('2026-11-20T00:01:00Z');
// each work line with the move that shows what it says (2026-09-28: 'This week I burned…' came with a coffee)
// HE REMEMBERS (operator, 2026-10-01: "make him smarter"): the last real moment of the hour, in his own words — a burn run,
// or a buy from outside worth $50 or more, with how long ago and what it did for him. Null when the hour was quiet.
function recallLine() {
  const now = Date.now(), mins = t => { const m = Math.max(1, Math.round((now - t) / 60e3)); return m === 1 ? 'A minute ago' : `${m} minutes ago`; };
  const run = S.burns.filter(e => Date.parse(e.time) >= now - 3600e3 && +e.bobaiBurned > 0).at(-1);
  const buy = S.hist.filter(x => x.buy && !x.ours && !x.taxSwap && x.usd >= 50 && x.t >= now - 3600e3).at(-1);
  // five ways to remember each (2026-10-02); the figures stay the record's own
  if (run && (!buy || Date.parse(run.time) >= buy.t)) { const a = mins(Date.parse(run.time)), b = cmp(+run.bobaiBurned), ctx = burnContext(run); return ['burn', vary('v20', [
    `${a} I burned ${b} BOBAI. ${ctx || 'Gone for good, on-chain.'}`, `Remember the burn ${a.toLowerCase()}? ${b} BOBAI, gone. ${ctx || 'Check it on BscScan.'}`,
    `${a}: ${b} BOBAI to the dead address. ${ctx || 'Supply only goes down.'}`, `Still warm: ${b} BOBAI burned ${a.toLowerCase()}. ${ctx || 'Every step with its transaction.'}`,
    `My last burn was ${a.toLowerCase()}: ${b} BOBAI. ${ctx || 'Never coming back.'}`]).trim()]; }
  if (buy) { const a = mins(buy.t), u = `$${nf(buy.usd, 0)}`, t = `$${nf(buy.usd * 0.03, 2)}`; return ['cheer', vary('v21', [
    `${a} someone bought ${u} of BOBAI. ${t} of tax from it is charging my next buyback.`, `Remember that ${u} buy ${a.toLowerCase()}? Its ${t} of tax is already working for the burns.`,
    `${a}: a ${u} buy. Thank you, whoever you are. ${t} of tax from it feeds my next buyback.`, `A ${u} buy ${a.toLowerCase()}. ${t} of tax from it went straight into my queue.`,
    `Still smiling about the ${u} buy ${a.toLowerCase()}. ${t} of tax, charging my next buyback.`])]; }
  return null;
}
const WORK = [
  ['cheer', () => (WORK.r = recallLine())?.[1] ?? null, () => WORK.r?.[0]], // read once: a second read marked a second variant as said
  ['think', () => { const w = chartWords(); return w ? `My chart, last 24 hours: ${w.s}, ${nf(w.n)} trades. I read every single one.` : null; }],
  ['think', () => { const w = chartWords(); return w ? (Math.abs(w.ch) < 1.5 ? `${w.s} in a day. Calm chart, busy bots.` : w.ch > 0 ? `${w.s} today. Green candles look good on me.` : `${w.s} today. Red candles, same work: every trade still pays 3%.`) : null; }],
  ['hodl', () => `${cmp(S.queued)} BOBAI of tax in my pocket. The next buyback is charging.`],
  ['burn', () => { const wk = S.burns.filter(e => Date.parse(e.time) >= Date.now() - 7 * 86400e3); return `This week I burned ${cmp(wk.reduce((a, e) => a + (+e.bobaiBurned || 0), 0))} BOBAI. Gone. Forever.`; }],
  ['liq', () => `${lpText()} of my pool's LP is burned. Nobody can pull it. Not even me.`],
  ['giggle', () => GIGGLE_OPEN() ? `The Giggle pot holds ${bnb4(ggBnb())}. Every trade adds to it until November 20.` : null],
  ['burn', () => `${supplyPct(S.deadA || 0)}% of my supply is at the dead address. Still counting.`],
];
// the viewer's own time of day (2026-09-28): a morning coffee in the morning, the night shift at night
function dayActs() {
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return [['coffee', 'Morning coffee first. Then the chart. Then the world.'], ['walk', 'Morning round of my pool. Still locked. Good morning to it.'],
    ['coffee', 'gm. Coffee in one hand, the chart in the other.'], ['think', 'Morning check: what did the chain do overnight? Reading it now.'], ['pushups', 'Morning push-ups. Strong hands start early.']];
  if (h >= 23 || h < 5) return [['think', 'Night shift. The chain never sleeps, so neither do I.'], ['walk', 'Late walk around the pool. Everything locked, everything quiet.'], ['coffee', 'Midnight coffee. Do not tell my doctor. I do not have one.'],
    ['think', 'Quiet hours. I read the blocks while the world sleeps.'], ['hodl', 'Late night, diamond hands. Nothing changes after dark.']];
  return [];
}
// EVERY CLIP IN EVERY MARKET (2026-09-29, operator: "all the videos we have are used — also the bull ride when the market
// is calm, up or down; build it all in intelligently"): the chart is flat most of the time, and the flat list had no bull,
// hodl, shrug or cheer, so those clips almost never came. Each mood now has every everyday move, with a line that fits
// that market; act() still takes the move he has not shown for longest, so over a visit all of them come round.
// EVERY MOVE, FIVE WAYS TO SAY IT (operator, 2026-10-02: "not always the same lines — at least five variants each"):
// lines that fit any market, for a tap and for his own moves (about two in five of those take one of these instead of the
// market's line). Each names only its own move, or none, so the clip that plays is the one the words describe.
const MOVE_LINES = {
  saber: ['May the pump be with you.', 'Saber out. For the burns!', 'En garde, bears. The saber stays with me.', 'A Jedi never sells. He burns.', 'Lightsaber check: fully charged, like my next buyback.'],
  moon: ['wen moon? I count burns, not days.', 'Moon check: still there. Still waiting for us.', 'Looking at the moon. Measuring the distance.', 'One day, moon. One burn at a time.', 'The moon called. I said: after the next buyback.'],
  coffee: ['Coffee break. The bots keep working.', 'Coffee first. Charts second.', 'This coffee is stronger than paper hands.', 'A sip of coffee, a look at the pool. Perfect.', 'Coffee number three today. Building is thirsty work.'],
  hodl: ['Diamond hands. Always.', 'Holding. It is what I do best.', 'Diamond hands, zero regrets.', 'Hold tight. Hodl tighter.', 'These hands do not sell. They only burn.'],
  cheer: ['Thanks for watching me work.', 'You are here! Best part of my day.', 'Cheers to every holder out there.', 'Hooray for the builders!', 'A cheer for the community. You keep this brain going.'],
  think: ['Checking the chart. Again.', 'Thinking about the next buyback.', 'Let me think. Burn first, then think again.', 'Big brain moment. Give me a second.', 'Reading the last blocks. Interesting.'],
  pushups: ['Strong hands need training.', 'Push-ups for strong hands.', 'One push-up per burn. I am getting fit.', 'Training day. Paper hands skip it.', 'Down, up, burn. Repeat.'],
  shrug: ['It is what it is. The burns go on.', 'The market? I shrug and build.', 'Up, down, whatever. The tax counts every trade.', 'Who knows where the chart goes. I just keep working.', 'Shrug. The bots do not care about candles.'],
  bull: ['Want a ride? This bull only goes up. In theory.', 'Saddle up, builder.', 'Bull ride! Hold on to your bags.', 'This bull is house-trained. Mostly.', 'Out for a ride across BNB Chain.'],
  dance: ['A little dance for the chain.', 'Dancing between two blocks.', 'Dance break! The bots keep the beat.', 'I dance, the tax burns. Teamwork.', 'This is my burn dance.'],
  walk: ['A walk around my pool.', 'Walking my rounds. All locked, all good.', 'Quick walk to stretch the legs between blocks.', 'Patrol walk: the LP is still burned.', 'A little walk, a lot of thinking.'],
  burn: ['Burn time. Gone for good.', 'Into the fire with it.', 'Every burn makes the supply a little smaller.', 'Burning is my cardio.', 'The dead address says thank you.'],
  liq: ['More liquidity, and I burn the LP.', 'Deeper pool, smoother trades.', 'Filling up my pool. LP to the dead address.', 'A pool nobody can pull. I made sure.', 'Liquidity in, LP burned. My favourite routine.'],
  defi: ['Tuning the DeFi agent.', 'My DeFi agent works CAKE/BNB while I talk.', 'Checking the range of my DeFi agent.', 'DeFi agent at work: fees in, range watched.', 'A little tune-up for my DeFi agent.'],
  laugh: ['Ha! The chart made me laugh.', 'Laughing all the way to the dead address.', 'Sorry, I just thought of a joke. Later.', 'Ha. Good day to be a brain.', 'I laugh, the bots burn. Fair split.'],
  build: ['Building on BNB Chain. Block by block.', 'Hard hat on. Another block on the stack.', 'Stacking blocks, one every half second.', 'Builder mode: on.', 'Measure twice, burn once.'],
};
const ACTS_MORE = {
  flat: [['bull', 'No bull market today, so I brought my own. Practice ride.'], ['hodl', 'Nothing happening? Perfect time to hold.'], ['shrug', 'Quiet chart. Could be worse. Could be red.'],
    ['cheer', 'Quiet chain, and the tax still counts every trade. Small win.'], ['liq', () => `${lpText()} of my pool's LP is burned. I checked. Twice.`], ['build', 'Slow market, fast builder. Stacking blocks.'],
    ['shrug', 'Sideways. The bots do not mind, so neither do I.']],
  up: [['hodl', 'Green candles? Still holding. Obviously.'], ['think', () => { const w = chartWords(); return w ? `${w.s} in 24 hours. Let me read that again.` : 'Green. Let me read that again.'; }],
    ['liq', 'Price up, pool deep, LP burned. That is how it should look.'], ['build', 'Green day. Building while it is sunny.'], ['shrug', 'Up again. Act natural.']],
  pump: [['hodl', 'Pumping? Nobody sells in here. We hold.'], ['think', `Checking the chart. Yes, that is real.`], ['coffee', 'A pump like this needs a coffee.'], ['walk', 'Victory lap. A big one.'],
    ['pushups', 'Pump day. My arms join in.'], ['laugh', 'Up this fast? I am laughing all the way to the dead address.'], ['build', 'Busy chain. More blocks to stack.']],
  down: [['bull', 'Bears everywhere. I ride the bull anyway.'], ['cheer', 'Red day, but the burns keep going. That is a small cheer.'], ['giggle', () => GIGGLE_OPEN() ? 'Red candles, same pot: every trade still adds a coin for Giggle Academy.' : 'Red candles. A coin for luck anyway.'],
    ['moon', 'Down only makes the way to the moon longer. Patience.'], ['liq', 'Red day, locked pool. Nobody can pull it.'], ['build', 'Red day? Builders build anyway.']],
  dump: [['bull', 'Dump? Hold my bull.'], ['think', 'Big red. Thinking. The plan is still the plan.'], ['giggle', () => GIGGLE_OPEN() ? 'Big red, and the Giggle pot still grows. Every sell pays too.' : 'Big red. A coin for luck, and on we go.'],
    ['dance', 'Big red. I dance it off.'], ['moon', 'The moon is still there. Further away today.'], ['liq', 'Big red, but the LP is burned. The pool stays.']],
};
const ACTS = {
  flat: [['dance', 'Quiet chain. I dance anyway.'], ['dance', 'Low volume, high spirits.'], ['coffee', 'No trades for a bit. I am not bored, I am patient.'], ['laugh', 'Sideways again. The chart is doing a plank.'], ['walk', 'A little walk around my pool. All locked, all good.'], ['coffee', 'Sideways. Coffee first, then the chart.'], ['pushups', 'Sideways market? Push-ups. Strong hands.'], ['think', () => { const w = chartWords(); return w ? `Checking my chart. Again. ${w.s} in 24 hours.` : 'Checking the chart. Again. Still sideways.'; }], ['moon', 'wen moon?'], ['defi', 'Tuning the DeFi agent while nobody is looking.'], ['saber', 'Guarding the pool. The LP stays burned.'], ['giggle', () => GIGGLE_OPEN() ? 'A coin for Giggle Academy. Every trade adds one until November 20.' : 'A coin for Giggle Academy. The pot went to the kids on November 20.']],
  up: [['dance', 'Green candles make me dance.'], ['bull', 'Up only today. Saddle up.'], ['saber', 'May the pump be with you.'], ['cheer', 'Green candles. I like green candles.'], ['moon', 'Is this the moon? Asking for a friend.'], ['coffee', 'Green morning. The coffee tastes better.'], ['pushups', 'Pumping. My arms too.'], ['walk', 'Victory lap around my pool.'], ['laugh', 'Green day. Even my jokes land.'], ['giggle', 'Up? I knew it. I did not know it.']],
  pump: [['bull', 'Hold on tight. This bull is running.'], ['saber', 'May the pump be with you. Always.'], ['cheer', 'This is what 3% on every trade feels like.'], ['dance', 'Pump dance. Nobody can stop me.'], ['moon', 'Wen moon? No dates. Just burns.'], ['giggle', () => GIGGLE_OPEN() ? 'Up we go. A coin for Giggle Academy too.' : 'Up we go. Giggle Academy got its pot on November 20.']],
  down: [['hodl', 'Red candles. Diamond hands.'], ['burn', 'Price down, burns on. Every sell still feeds me.'], ['think', 'Zoom out. Then zoom out again.'], ['shrug', 'Down day. The bots do not take days off.'], ['pushups', 'Red candles, more push-ups.'], ['coffee', 'Red day. Coffee, then back to work.'], ['walk', 'Walking it off. The bots keep burning.'], ['dance', 'Red day. I dance to keep warm.'], ['saber', 'Bears at the gate. The LP is burned, so good luck.']],
  dump: [['hodl', 'Nobody panics in here. We burn.'], ['coffee', 'Big red. Big coffee. Same plan.'], ['shrug', 'Sells pay 3% too. I keep working.'], ['pushups', 'Big red. Bigger push-ups.'], ['burn', 'Dumps pay 3% too. More for me to burn.'], ['walk', 'A calm walk. The plan does not change.'], ['saber', 'Big dump? Big deal. The pool is locked and I am armed.'], ['laugh', 'Someone sold. Their 3% says thank you.']],
};
for (const [m, more] of Object.entries(ACTS_MORE)) ACTS[m].push(...more);
// when nothing has happened for a while, he tells a joke — short, clean, about the job
const JOKES = [
  'Why did the chart break up with me? Too many ups and downs.',
  'I told my bot to take a break. It burned the break.',
  'My portfolio and I have a lot in common: we both need a hug.',
  'Wen lambo? After the next buyback. Probably.',
  'I am not addicted to charts. I can stop any candle now.',
  'A bear walked into my pool. Paid 3% tax. Left.',
  'Paper hands asked me for advice. I said: hold my coffee.',
  'My brain is 45% of my body. The other 55% is conviction.',
  'Someone asked me when I sell. I said: I only know how to burn.',
  'Every time you say "wen", a buyback bot gets its wings.',
  'Gas fees on BNB Chain are so low, I tip my bots.',
  'I burn more tokens before breakfast than most do all week. Then breakfast.',
  'Sideways is just the market doing push-ups.',
  'Why did BOBAI cross the chain? To burn on the other side.',
  'I asked the dead address how it is doing. No reply. Very relaxed.',
  'Stop-loss? I only know stop-worrying.',
  'The liquidity is locked. The jokes are not. Sorry.',
  'Diamond hands are just regular hands with better lighting.',
  // a little closer to the edge, always friendly (operator, 2026-09-27: "they may be a bit on the edge, but always likeable")
  'I tried to rug myself once. The LP is burned. Could not even do that.',
  'My therapist asked how I deal with loss. I said: I send it to the dead address.',
  'Jeets sell, I burn their tax. Honestly, a beautiful relationship.',
  'Someone called me exit liquidity. Rude. I am entry burning.',
  '"Few understand." Correct. Mostly my mom.',
  '100x leverage? No thanks. I have a brain. A big one.',
  'My dating profile: likes long walks around the pool, candlelight and burning things.',
  'Why do I never sleep? The chain never does. Also, I am a brain. Where would I even put a pillow?',
  'I once tried to time the market. The market timed me out.',
  'The dead address is my best friend. Never complains, never sells, never texts back.',
  'Roses are red, my candles are too. I burn some BOBAI, just for you.',
  'Bears hate this one trick: every sell pays 3%, and part of it burns.',
  'Degen confession: I check the chart even though I am the chart.',
  'Ser, this is a burn-ery.',
  'I asked a whale for a selfie. It bought instead. Even better.',
  'My brain is huge. My bags are huge. My jokes are... being worked on.',
  'Not financial advice. Just fire.',
  'My bot works 24/7 and never asks for a raise. I asked for one. The bot said no.',
  // more of them (operator, 2026-09-28: "more jokes, and more often")
  'I have two moods: burning and about to burn.',
  'People ask if I have feelings. I have a 3% tax. Close enough.',
  'Buy high, sell low? Amateur. I buy back and burn.',
  'My financial plan: step one, burn. Step two, see step one.',
  'I tried meditation. The candles kept talking to me.',
  'They said crypto is a rollercoaster. I only ride the burn slide.',
  'I would tell you a joke about liquidity, but it is locked.',
  'I do not have a lambo. I have a pool. With a burned LP. Way cooler.',
  'Red candle? Calm down. I have seen worse. In the mirror, before coffee.',
  'My brain has 86 billion neurons. All of them say: hold.',
  'The whale said "bye". The tax said "thank you".',
  'I am not a chart expert. I just stare at it until it goes up.',
  'Some people collect stamps. I collect burned tokens.',
  'Weekend plans: watch the pool, burn some tax, pretend to relax.',
  'If you listen closely, you can hear the dead address saying "more".',
  // harder ones (operator, 2026-09-29: "5-8 more, they may be really a bit harder and rougher, but still legal")
  'Some tokens have a roadmap. Others have a getaway car.',
  'Leverage traders are like candles: they burn fast, and nobody remembers their names.',
  'My chart is like my ex: red, dramatic, and I still check on it at 3 a.m.',
  'Paper hands sold the bottom again. Thank you for your service. And for your 3%.',
  'I would call the bottom, but last time the bottom called back and asked for a loan.',
  '"100x gem" in a Telegram group? Sure. The 100 is how many people become exit liquidity.',
  'Influencers say "not financial advice" the way pickpockets say "excuse me".',
  'Liquidated at 50x? Congratulations. You just paid for a whale’s new yacht.',
  // one in a billion, said with a wink (operator, 2026-10-09: "smarter, more likeable, funnier — and never lose the core")
  'There are a billion tokens out there. Only one of them reads its own chain out loud. Hi.',
  'Three sites, three 24h numbers. I asked BNB to hold still. It said no.',
  'Most tokens have a chart. I have a chart, a brain, and an opinion about your slippage.',
  'Other AIs write poems. I write receipts. On-chain. With transaction links.',
  'I do not sleep, I do not panic, and I do not need coffee. I drink it anyway, for the look.',
  'One in a billion? My mum says that too. The difference: I can prove it on BscScan.',
];
// HE REMEMBERS WHAT HE SAID (2026-09-28, operator: "more intelligent, more alive, more real"): only the very last line
// was avoided, so '11.6% of my supply…' came back after two minutes. Nothing said in the last 20 minutes is said
// again while the list has anything fresh; when all of it was said, the longest-ago quarter is used.
// ACROSS VISITS TOO (operator, 2026-10-02: "yesterday it was nearly always 'May the pump be with you', and the greeting is
// almost always the same"): the memory lived only as long as the page, so every reload started from zero and the first
// pick of a short list came round again and again. It is now kept in this browser (never sent anywhere) for a day, by a
// short fingerprint of the line, and among the fresh lines the ones said longest ago (or never) come first — so over
// a few visits he goes through every variant before one comes back.
const SAID_KEY = 'bobai-bt-said', SAID = new Map();
const saidId = x => { const s = typeof x === 'string' ? x : Array.isArray(x) ? x.map(v => typeof v === 'function' ? String(v) : Array.isArray(v) ? v.join('|') : String(v)).join('#') : String(x); let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
try { const o = JSON.parse(localStorage.getItem(SAID_KEY) || '{}'), now = Date.now(); for (const [k, t] of Object.entries(o)) if (now - t < 86400e3) SAID.set(k, t); } catch {}
let saidSaveT = 0;
function saidSave() { clearTimeout(saidSaveT); saidSaveT = setTimeout(() => { try { const e = [...SAID].sort((a, b) => b[1] - a[1]).slice(0, 600); localStorage.setItem(SAID_KEY, JSON.stringify(Object.fromEntries(e))); } catch {} }, 1500); }
const LIFEFAST = /[?&]lifefast(&|$)/.test(location.search);
function pick(list) {
  const now = Date.now(), keep = (LIFEFAST ? 20 / 12 : 20) * 60e3, lastId = LIFE.last != null ? saidId(LIFE.last) : '';
  const at = x => SAID.get(saidId(x)) || 0;
  let pool = list.filter(x => saidId(x) !== lastId && now - at(x) > keep);
  if (!pool.length) pool = [...list].filter(x => list.length < 2 || saidId(x) !== lastId);
  // the longest-ago half of what is left (never said counts as longest ago), one of those at random: not predictable, never stuck
  pool = [...(pool.length ? pool : list)].sort((a, b) => at(a) - at(b)).slice(0, Math.max(1, Math.ceil(pool.length / 2)));
  const x = pool[Math.random() * pool.length | 0]; SAID.set(saidId(x), now); LIFE.last = x; saidSave(); return x;
}
// a line written as a list of variants: one of them, by the same memory. vary('name', [...]) for lines with live figures
// or a varying hello in them: their text changes every time, so the memory keeps WHICH variant was said (2026-10-02, qa/
// variety.mjs: two reloads in a row got the same greeting with a different "gm")
const vary = (l, list) => {
  if (list) { const i = +String(pick(list.map((_, k) => l + '#' + k))).split('#').pop(); return vary(list[i]); }
  return typeof l === 'function' ? l() : Array.isArray(l) ? vary(pick(l)) : l;
};
// ?demo: every move in turn with its line, for showing him off (and filming him); the chain still interrupts
const DEMO = /[?&]demo\b/.test(location.search) && [['idle', 'gm. I am BOBAI. I live on BNB Chain.'], ['coffee', 'Sideways. Coffee first, then the chart.'], ['think', 'Checking the chart. Again.'],
  ['pushups', 'Sideways market? Push-ups. Strong hands.'], ['moon', 'wen moon?'], ['bull', 'Up only today. Saddle up.'], ['saber', 'May the pump be with you.'], ['cheer', 'A big buy! Its tax feeds the brain.'],
  ['burn', 'Burn time. Gone for good.'], ['liq', 'More liquidity, and I burn the LP.'], ['defi', 'Tuning the DeFi agent.'], ['giggle', 'A coin for Giggle Academy.'], ['build', 'Building on BNB Chain. Block by block.'],
  ['hodl', 'Red candles. Diamond hands.'], ['shrug', 'Sells pay 3% too. Thank you.'], ['laugh', 'Sideways is just the market doing push-ups.'],
  ['dance', 'Quiet chain. I dance anyway.'], ['walk', 'A little walk around my pool.']];
let demoI = 0;
function lifeTick(now) {
  if (!opened) return;
  placeBubble();                                     // a replay's scene lines need placing and ending too
  if (mode !== 'live' || document.hidden) return;
  if (DEMO) { if (now >= LIFE.next && !pinnedK) { let k = 0, e; do e = DEMO[demoI++ % DEMO.length]; while (++k < DEMO.length && e[0] !== 'idle' && flowPose(e[0]) === 'idle'); const [p, line] = e; setPose(poseOr(p), 8); /* only the moves that have their clip */ speak(line, 3400); LIFE.next = now + 10e3; } return; }
  if (poseT > 0 || pinnedK || QUEUE.length || now < sceneUntil + 2500) return; // the chain's own moments and the reader's focus go first
  // A TAPPED JOKE GOES BEFORE HIS OWN MOVES (3.10., qa/situations: the queued joke waited for paintJoke's 250 ms tick and
  // his own coffee move took the free stage first): told here the moment the stage is free; after 30 s he lives on
  if (jokeQueued && now - (LIFE.touchAt || 0) < 30e3) { if (jokeReady()) jokeTap(); return; }
  // THE MARKET TURNS (2026-09-26): when the hour's price crosses into a new mood he answers at once, with the real
  // figure — not at his next idle move two minutes later. At most once in ten minutes, so a choppy hour stays calm.
  if (now >= (LIFE.moodAt || 0)) {
    readMood();
    const was = LIFE.seenMood; LIFE.seenMood = LIFE.combo?.key || was; // no swing out of "not loaded yet"
    // NEVER INTO HIS SENTENCE (2026-10-01, qa/away.mjs: the swing came while 'Back! …' was being typed and cut it off half
    // way): while he speaks or a move waits, the swing waits too — the mood stays unseen, so the next tick tells it
    if (was && was !== LIFE.seenMood && now >= (LIFE.turnAt || 0) && (now < LIFE.sayUntil || VID.want || HELD)) LIFE.seenMood = was;
    else if (was && was !== LIFE.seenMood && now >= (LIFE.turnAt || 0)) {
      LIFE.turnAt = now + 600e3; LIFE.next = now + 8e3 + 60e3 + Math.random() * 60e3;
      const line = saidMood(moodLine('Mood swing')); setPose(moveForLine(line, moodMove()), 7); speak(line, 6600); return;
    }
    LIFE.moodAt = now + 20e3;
  }
  // PAUSES (2026-09-26, operator: "let him take breaks, 1-2 min"): after a move he simply stands for one to two
  // minutes — breathing, and, when the calm rest take exists, blinking. At most once in a pause, halfway, a small
  // standing gesture (the wave, the stretch) that starts and ends in the same pose. No silent moves any more.
  if (now < LIFE.next) {
    // halfway through a pause: a small gesture, or a joke told standing (his rest take smiles along)
    // FEWER JOKES, A BIT MORE OF HIM WHEN NOBODY PLAYS WITH HIM (operator, 2026-09-29): halfway he mostly just waves or
    // stretches; when nobody has tapped him or the joke button for three minutes, every other pause gets one more moment
    // of his own from the same even bag (mood, joke, work) — a little more alive, never busier than that
    if (LIFE.idleAt && now >= LIFE.idleAt && pose === 'idle' && now >= LIFE.sayUntil) { LIFE.idleAt = 0; const alone = performance.now() - (LIFE.touchAt || 0) > 180e3, still = !S.hist.some(x => x.t >= Date.now() - 900e3); if (!(alone && Math.random() < (still ? 0.65 : 0.5) && !ownBusy() && ownMoment())) waveHello(); }
    return;
  }
  // A MOVE OF HIS OWN WAITS FOR THE ONE PLAYING (2026-09-29, ?lifefast: 8 moves chosen, 4 played — a move picked while
  // another clip still ran was dropped by vidMove, but its line was still said). He picks when the stage is free.
  if (ownBusy()) { LIFE.next = now + 1200; return; }
  readMood();
  const quietMin = (Date.now() - LIFE.quietSince) / 60e3, r = Math.random();
  // EVERY MOMENT OF HIS OWN IS A MOVE (operator, 2026-09-27: "he only does the hard hat and the blocks — no coffee, no
  // push-ups, no moon at 'wen moon'; use every animation"). Half of his moments used to be a work line said standing
  // still, and moves without a clip yet (think, hodl, bull) stood still too. Now the move comes from the market's list,
  // only among moves that have a clip, the least recent first; the line is the move's own or a work figure.
  const act = () => { const L = actsNow(), ok = L.filter(([p]) => flowPose(p) === p);
    // the moves he has not shown for longest first (a few of them, so he is not predictable), then a line not said lately
    const moves = [...new Set(ok.map(([p]) => p))].filter(p => !RECENT.includes(p)).sort((a, b) => (MOVED.get(a) || 0) - (MOVED.get(b) || 0)).slice(0, 3);
    const fresh = ok.filter(([p]) => moves.includes(p)); return pick(fresh.length ? fresh : ok.length ? ok : L); };
  // MORE JOKES, AND REGULARLY (operator, 2026-09-28, twice): every second moment of his own is a joke, and most pauses
  // get one halfway too — about one joke every two minutes, busy chain or not
  void quietMin, r; ownMoment(act);
  // the rhythm (operator, 2026-09-26): the chain's events always show at once; between them he is calm. What the
  // market does sets the pace of his own moves: a quiet market (no swap for 15 minutes) about every three minutes,
  // a trading one about every two, a strong move (the hour's price ±2% or more) about every 90 s — then there is
  // something to react to. Never faster: the flashes on the chart already show every trade.
  // 2026-09-26 later: a move is one 8 s clip, then a pause of 1-2 minutes (operator) — shorter when the market moves
  const busy = S.hist.some(x => x.t >= Date.now() - 900e3), moving = Math.abs(LIFE.d1h) >= 2;
  const pause = REDUCED ? 240e3 : moving ? 60e3 + Math.random() * 20e3 : busy ? 80e3 + Math.random() * 25e3 : 100e3 + Math.random() * 20e3;
  // nobody has touched him for three minutes: his pauses are a fifth shorter (a little more alive, not busier)
  const alone = performance.now() - (LIFE.touchAt || 0) > 180e3;
  // MORE ALIVE (operator, 2026-09-30: "about 20% more active as a standard, 35% more with no volume — make a formula that
  // makes sense"): his own moments come 1.2x as often; with no trade for 15 minutes (nothing to watch) 1.35x. The pauses
  // divide by that; "alone" (nobody touched him for 3 min) still shortens them a fifth on top
  const ACT = REDUCED ? 1 : busy ? 1.2 : 1.35;
  const pz = (LIFEFAST ? pause / 12 : pause) / ACT * (alone && !REDUCED ? 0.8 : 1); // ?lifefast: the same life, twelve times the pace — for checking it (2026-09-27)
  LIFE.next = now + 8e3 + pz; LIFE.idleAt = now + 8e3 + pz * (0.4 + Math.random() * 0.2);
}
// THE MARKET'S LINES THAT ARE TRUE RIGHT NOW (2026-10-05): a sideways day counts as 'flat' also when it trades, and he
// said "No trades for a bit" seconds after a buy; "Green morning" came in the evening, "Nobody sells in here" in an hour
// with sells. A line about a quiet chain needs 15 minutes without a trade, the morning one the morning, the last no sell.
const QUIET_LINE = /quiet|no trades|low volume|nothing happening|slow market|nobody is looking/i;
// the day at −15% or worse (the same 24H figure the chip shows)
const HARD_DAY = () => (LIFE.combo?.ch ?? 0) <= -15;
// A WORD OF HEART FOR A HARD DAY: what is true and does not change, said plainly — never a promise about the price.
// Eight ways, remembered like every line; the two that name a move (hard hat, diamond hands) play it.
function heartLine() {
  const ch = Math.abs(LIFE.combo?.ch ?? 0).toFixed(0), wk = S.burns.filter(e => Date.parse(e.time) >= Date.now() - 7 * 86400e3).reduce((a, e) => a + (+e.bobaiBurned || 0), 0);
  return vary('v30', ['Rough day, I know. I am still here, and every bot of mine is still working.',
    'Red days test everyone. What does not change: the LP is burned, the contract has no owner, the bots keep running.',
    `${ch}% down in a day hurts. Every sell paid its 3% too, and that is already on its way to the burns.`,
    'I cannot promise a price. I can promise the work: every burn, every step, on-chain, today like every day.',
    wk > 0 ? `Breathe. Zoom out. This week alone I burned ${cmp(wk)} BOBAI, and I am not done.` : 'Breathe. Zoom out. The burns do not stop on a red day.',
    'To everyone still here on a day like this: thank you. I see you, and I keep building.',
    'Builders build on red days too. Hard hat on.',
    'Diamond hands are made on days like this. I hold with you.']);
}
function actsNow() {
  const traded = S.hist.some(x => !x.taxSwap && x.t >= Date.now() - 900e3), h = new Date().getHours(), sells = (LIFE.flow?.s || 0) > 0;
  // on a hard day he does not laugh or dance about it (the lines with those moves wait for a better one)
  const hard = HARD_DAY(), L = [...(ACTS[LIFE.mood] || ACTS.flat), ...dayActs()], ok = L.filter(([p, l]) => !(hard && (p === 'laugh' || p === 'dance')) && (typeof l !== 'string' ||
    !(traded && QUIET_LINE.test(l)) && !(/\bmorning\b/i.test(l) && (h < 5 || h >= 11)) && !(sells && /nobody sells/i.test(l))));
  return ok.length ? ok : L;
}
// a clip of a move still playing or waiting to (his calm rest take does not count)
const ownBusy = () => !!(VID.v && !REDUCED && (VID.go || (VID.want && VID.want.p !== 'idle') || (VID.on && VID.cur && !/^(rest|idle)/.test(VID.cur))));
// one moment of his own, of the kind the even bag hands out: his mood with its move, a joke with its laugh, or what he is
// doing (a work figure, his hard hat, or a move that fits the market). A joke that cannot laugh right now becomes work.
function ownMoment(act) {
  act = act || (() => { const L = actsNow(), ok = L.filter(([p]) => flowPose(p) === p); return pick(ok.length ? ok : L); });
  const k = ownKind(), log = got => { (window.__btOwn = window.__btOwn || []).push([Math.round(performance.now() / 1000), k, got]); return true; }; // for checks from outside
  if (k === 'mood') { tellMood(6400); return log('mood'); }
  if (k === 'heart') { const l = heartLine(), named = moveForLine(l, null); setPose(named || poseOr(pick(['hodl', 'think', 'walk'].filter(p => flowPose(p) === p).concat('hodl'))), 6, !!named); speak(l, 7200); return log('heart'); }
  if (k === 'joke' && tellJoke(6500)) return log('joke');
  if (k === 'invite') { const l = inviteLine(); if (l) { const named = moveForLine(l, null); setPose(named || moodMove(), 6, !!named); speak(l, 6800); return log('invite'); } }
  log('work');
  const r = Math.random();
  // his hard hat: building on BNB Chain — half the time explained the way today's market needs it
  // a line that names the hard hat or the blocks comes with them, however lately he wore it (2026-10-05)
  if (r < 0.25) { const mb = MOOD_BUILD[LIFE.combo?.trend], line = mb && Math.random() < 0.5 ? vary(pick(mb)) : pick(BUILD), named = moveForLine(line, null); setPose(named || poseOr('build'), 6, !!named); speak(line, 6600); return true; }
  // a work line keeps the move that shows what it says, also when that move was seen lately (2026-10-05: it took any
  // other move then — "This week I burned…" with a coffee again — and marked a line of that move as said)
  if (r < 0.6 && S.burns.length) { const [mv0, fn, mvOf] = pick(WORK), line = fn(), mv = (mvOf && mvOf()) || mv0; if (line) { setPose(moveForLine(line, null) || poseOr(mv), 6, true); speak(line, 5600); return true; } }
  const [p, l0] = act(), own = typeof l0 === 'function' ? l0() : l0, line = MOVE_LINES[p] && (!own || Math.random() < 0.4) ? pick(MOVE_LINES[p]) : own, named = moveForLine(line, null); setPose(named || poseOr(p), 6, !!named); speak(line, 5600); return true;
}
// the chain interrupts: a moment of his real work gets a line of its own
// a burn run placed among the week's (2026-09-28): he knows when one is the biggest, or the day's third
function burnContext(x) {
  const amt = +x?.bobaiBurned || 0, t = x?.t || Date.parse(x?.time) || Date.now(); if (!amt) return '';
  const wk = S.burns.filter(e => { const tt = Date.parse(e.time); return e !== x && (!x.bobaiBurnTx || e.bobaiBurnTx !== x.bobaiBurnTx) && tt >= t - 7 * 86400e3 && tt <= t; });
  if (wk.length >= 3 && amt > Math.max(...wk.map(e => +e.bobaiBurned || 0))) return 'Biggest burn of the week! ';
  const day = wk.filter(e => Date.parse(e.time) >= t - 86400e3).length + 1;
  return day >= 2 ? `Burn number ${day} in 24 hours. ` : '';
}
// A BUY IN ITS WEEK (2026-10-06), like burnContext for the burns. The trades in memory reach back an hour, but every buy
// of $100 or more mints an NFT, and the drop log keeps them all with their exact dollars — so the week's alert buys are
// known. Said only while no tier is sold out (then a buy may go without an NFT and the log would miss it).
function buyContext(x) {
  const nft = S.nft; if (!nft || !Array.isArray(nft.drops) || !x?.usd) return '';
  if ((nft.minted || []).some((m, i) => nft.cap && m >= nft.cap[i])) return '';
  const t = x.t || Date.now(), tx = String(x.tx || '').toLowerCase();
  const wk = nft.drops.filter(n => (n.buyTx || '').toLowerCase() !== tx && n.ts * 1000 >= t - 7 * 86400e3 && n.ts * 1000 <= t);
  if (wk.length >= 3 && x.usd > Math.max(...wk.map(n => nUsd(n)))) return 'Biggest buy of the week! ';
  const day = wk.filter(n => n.ts * 1000 >= t - 86400e3).length + 1;
  return day >= 2 ? `Buy number ${day} over $100 in 24 hours. ` : ''; // not "big buy": that is a tier's name
}
// WHAT HE SAYS WHEN HIS OTHER BOTS ACT (2026-10-06): the DeFi agent's scenes (fees collected, new capital, a range
// re-set, the reserve, the services' payments), the creator payout and a freshly minted NFT played their board and his
// clip in silence. Five lines each, every number the event's own; none names a move of his other than the one the scene
// plays (the DeFi lines name no move at all, the NFT lines name the NFT the card shows).
const wpct = s => s && s.width_pct ? ` to ±${s.width_pct}%` : '';
const REACT_MORE = {
  'defi-collect': x => { const s = x.s || {}, g = bnbF(+s.produced_bnb || +s.owed?.bnb_equivalent || 0), b = +s.bobai_units > 0 ? ` ${cmp(s.bobai_units)} BOBAI bought with part of it, and kept.` : '';
    return [`Payday! My DeFi agent collected ${g} in pool fees.${b}`, `${g} of trading fees, collected by my DeFi agent.${b}`, `Fees in: ${g}. My DeFi agent earns while CAKE and BNB trade.${b}`,
      `My DeFi agent just harvested ${g} from its CAKE/BNB range.${b}`, `Collected: ${g} in fees, earned by sitting where the trades are.${b}`]; },
  'defi-increase': x => { const s = x.s || {}, c = bnbF(capOf(s)), v = s.value_after_bnb ? ` The position is ${bnbF(s.value_after_bnb)} now.` : '';
    return [`New capital at work: ${c} more in my DeFi agent's pool.${v}`, `My DeFi agent put ${c} more to work.${v}`, `${c} of fresh capital into the CAKE/BNB range. More capital, more fees.`,
      `The DeFi agent topped up its position by ${c}.${v}`, `More in the pool: ${c}, put to work by my DeFi agent.`]; },
  'defi-rebalance': x => { const s = x.s || {}, w = wpct(s), side = s.one_sided ? ' Parked right beside the price, no trade needed.' : ' Back around the price.';
    return [`The price moved, so my DeFi agent moved its range${w}.${side}`, `Range re-set${w}.${side}`, `My DeFi agent followed the price: a new range${w}.`,
      `New range for my DeFi agent${w}. Out of range earns nothing, so it moves.`, `Re-set done${w}. The agent sits where the trades happen again.`]; },
  'defi-ladder': x => { const w = wpct(x.s);
    return [`My DeFi agent re-set its reserve range${w}. Ready for the next move of the price.`, `Reserve range moved${w}. The second position waits where the price may go.`, `The DeFi agent's reserve is set again${w}.`,
      `A fresh reserve range${w}: when the price steps out of the main one, this one is already there.`, `Reserve re-set${w}. Two ranges, one pool, no idle capital.`]; },
  'defi-sweep': x => { const s = x.s || {}, a = `${s.sweeping ?? s.balance ?? ''} ${s.token || ''}`.trim(), v = s.bnb_equivalent ? ` (${bnbF(s.bnb_equivalent)})` : '';
    return [`What agents paid my services, ${a}${v}, just went to my DeFi agent.`, `Payments swept: ${a}${v} from my agent services into the DeFi agent.`, `My agent services earned ${a}${v}. Now it works in the pool.`,
      `${a}${v} from paid answers, handed to my DeFi agent.`, `The services' till is empty again: ${a}${v} went to my DeFi agent.`]; },
  dev: x => { const t = bnbF(+x.d.availableBnb);
    return [`The creator share was paid out: ${t}.`, `The dev bot paid out ${t} of the creator share, right on schedule.`, `${t} out of the creator share. Builders get paid on BNB Chain too.`,
      `Creator share out: ${t}, on-chain like everything here.`, `The d38 wallet just sent out ${t} of the creator share.`]; },
  nft: x => { const n = x.n || {}, t = TIERS[n.tier] || 'Buy Drops', u = $buy(nUsd(n), n);
    return [`NFT #${n.tokenId} is minted: ${t}, for that ${u} buy. Straight to the buyer's wallet.`, `Fresh NFT, #${n.tokenId}, ${t}. The ${u} buy earned it.`, `Minted! #${n.tokenId}, a ${t} NFT, on its way to the buyer.`,
      `The ${u} buy got its NFT: #${n.tokenId}, ${t}.`, `NFT #${n.tokenId} (${t}) just left the minter. Capped supply, every one on-chain.`]; },
};
function sayMore(k, x) {
  if (mode !== 'live' || REOPEN) return; // a moment reopened from the list is shown, not re-announced
  const L = REACT_MORE[k] && REACT_MORE[k](x); if (!L) return;
  LIFE.quietSince = Date.now(); speak(vary('react-' + k, L), 5000);
}
function react(kind, x) {
  LIFE.quietSince = Date.now();
  // calm, not nervous (operator, 2026-09-25): in a busy minute every small buy and sell used to swap his pose and
  // his line. Small trades now answer at most every 15 s; burns, liquidity and alert-size buys always do.
  // Calmer still (2026-09-26, operator: "less hectic in live mode"): every trade flashes on the chart anyway, so
  // a small one only gets his body and a line when it is worth $20 or more and he has not answered one for 90 s.
  const big = kind === 'run' || kind === 'liq' || (kind === 'buy' && x.usd >= ALERT_USD), now = performance.now();
  if (!big && (kind !== 'tax' && (x?.usd || 0) < 20 || now < (LIFE.reactAt || 0) + 90e3)) return;
  LIFE.reactAt = now; LIFE.next = Math.max(LIFE.next, now + 8e3 + 60e3 + Math.random() * 60e3);
  // his body answers too: a buy lifts him, a big one makes him jump; a sell gets a shrug, never a frown
  // joy in turns (2026-09-27, operator: "the confetti comes too often"): cheer is one of five, never twice in a row
  // a buy that reaches him is an alert buy (isAlert), and its tier moment brings the move right after: a pose here
  // was a twitch before it (2026-09-27). The line stays.
  if (kind === 'buy') { if (x.usd < ALERT_USD) setPose(joyMove(), 3); } // an alert buy: its tier moment moves him
  else if (kind === 'sell') setPose(poseOr('shrug'), 3);
  else if (kind === 'tax') setPose(poseOr('think'), 3); // the token contract at work, not the DeFi agent
  // Several lines per kind, so a busy hour does not repeat itself. Every number is the event's own. The 3% tax is
  // split by the phase table (burns, liquidity, DeFi agent, Giggle pot, creator): no line says all 3% is burned.
  const $u = u => '$' + nf(u, u < 10 ? 2 : 0), tax = x && x.usd ? '$' + nf(x.usd * 0.03, 2) : '';
  const lines = {
    buy: x && x.usd >= ALERT_USD
      ? [`A ${$u(x.usd)} buy! That one earns an NFT, and ${tax} of tax for the brain.`, `${$u(x.usd)}! Somebody believes. NFT on its way, ${tax} to the brain.`, `Big buy, ${$u(x.usd)}. I felt that one in every neuron.`,
        `${$u(x.usd)} of conviction just landed. An NFT for the buyer, ${tax} for the burns.`, `Now that is a buy: ${$u(x.usd)}. Thank you! Your NFT is on its way.`].map(l => buyContext(x) + l)
      : [`Fresh buy, ${$u(x.usd)}. ${tax} of tax just charged me.`, `${$u(x.usd)} in. Every buy feeds the brain.`, `A buy! ${$u(x.usd)}. Welcome aboard.`, `${$u(x.usd)} buy. Small candle, big heart.`, `${$u(x.usd)} buy. Every one of them counts, ${tax} of tax included.`],
    sell: [`Someone sold ${$u(x.usd)}. Sells pay 3% too. Thank you, friend.`, `A ${$u(x.usd)} sell. No hard feelings: ${tax} of it stays and works.`, `${$u(x.usd)} out. I shrug, I burn, I keep going.`,
      `${$u(x.usd)} sold. ${tax} of it stays behind and works for the holders.`, `A ${$u(x.usd)} sell. Goodbye and thanks for the ${tax} of tax.`],
    run: [`Burn time. ${cmp(x.bobaiBurned)} BOBAI, gone for good.`, `${cmp(x.bobaiBurned)} BOBAI into the fire. Supply only goes one way.`, `Buyback done: ${cmp(x.bobaiBurned)} BOBAI burned. Every step has its tx.`,
      `${cmp(x.bobaiBurned)} BOBAI just went to the dead address. Never coming back.`, `Another buyback, another burn: ${cmp(x.bobaiBurned)} BOBAI out of the supply.`].map(l => burnContext(x) + l),
    liq: x?.dev ? [`The dev wallet just added ${bnbF(x.bnb)} and ${cmp(x.bobai)} BOBAI to my pool. LP burned, like every time.`, `Dev add: ${bnbF(x.bnb)} + ${cmp(x.bobai)} BOBAI into the pool, ${nf(x.lpBurned, 1)} LP to the dead address.`,
        `${bnbF(x.bnb)} and ${cmp(x.bobai)} BOBAI from the dev wallet, straight into my pool. The LP? Burned.`, `My pool just got deeper: ${bnbF(x.bnb)} + ${cmp(x.bobai)} BOBAI from the dev wallet, LP burned.`, `A dev add of ${bnbF(x.bnb)}. ${nf(x.lpBurned, 1)} LP tokens to the dead address, as always.`]
      : +x?.bnb > 0 ? [`More liquidity: ${bnbF(x.bnb)} into my pool, ${nf(x.lpBurned, 1)} LP burned. Deeper pool, forever.`, `Added ${bnbF(x.bnb)} to the pool and burned the LP. Nobody can pull that. Not even me.`,
        `${bnbF(x.bnb)} deeper, smoother trades. The ${nf(x.lpBurned, 1)} LP tokens? Burned.`, `Liquidity in: half of ${bnbF(x.bnb)} bought ${cmp(x.bobaiBought)} BOBAI, the other half paired with it. LP to the dead address.`,
        `Another ${bnbF(x.bnb)} of liquidity, locked forever. That is how a pool should be.`] // the figures of the add itself (2026-10-06)
      : [`More liquidity, and I burn the LP. Deeper pool, forever.`, `Added to the pool and burned the LP. Nobody can pull that. Not even me.`, `Deeper pool, smoother trades. The LP tokens? Burned.`,
        `Liquidity in, LP out to the dead address. The pool only grows.`, `Another liquidity add, locked forever. That is how a pool should be.`],
    tax: [`Swapping my collected tax to BNB. The bots take it from here.`, `Tax pile to BNB. Next stop: my buyback bot, then the burns.`, `The tax queue was full, so the token swaps it to BNB. My bot splits it next.`,
      `Collected tax becomes BNB now. The burns are next in line.`, `Tax swap! The BNB goes to my buyback bot for splitting.`],
  }[kind];
  if (lines) speak(vary('react-' + kind + (kind === 'buy' && x.usd >= ALERT_USD ? '-big' : '') + (kind === 'liq' && x?.dev ? '-dev' : ''), lines), kind === 'run' ? 5200 : kind === 'liq' ? 5000 : 4400);
}
let mx = 0, my = 0, smx = 0, smy = 0; // the pointer, and the same eased: nothing follows a finger or a mouse in a jump
// the 3D objects themselves answer the pointer too, not only their labels
function nearObj(e) {
  const r = win.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, pxU = r.height / viewH;
  let best = null, bd = 1e9;
  const test = (v, rad, k) => { const s = toScreen(v), d = Math.hypot(s.x - x, s.y - y); if (d < rad && d < bd) { bd = d; best = k; } };
  for (const d of DEST) if (d.pct > 0) test(d.pos, d.R * d.mScale * pxU + 12, d.k); // a share the phase has ended is not there to tap
  for (const w of WORKERS) test(w.pos, 22, w.k);
  test(A.core, 48, 'core'); test(A.src, 30, 'src');
  return best;
}
const onUi = e => e.target.closest('.lab,.detail,.term,.tl,.hud,.x');
let lastPointer = 'mouse';
// on a phone the open panel covers the label that opened it: a tap on the panel closes it (its links still work)
detail.addEventListener('click', e => { if (lastPointer !== 'mouse' && pinnedK && !e.target.closest('a')) { e.stopPropagation(); unpin(); } });
win.addEventListener('pointerdown', e => { lastPointer = e.pointerType; }, true);
win.addEventListener('pointermove', e => {
  lastPointer = e.pointerType;
  // only a mouse tilts the scene: a finger's touch jumped the brain and BOBAI to wherever it landed (2026-09-26, "Wackler")
  if (e.pointerType === 'mouse') { const r = win.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - 0.5; my = (e.clientY - r.top) / r.height - 0.5; }
  if (onUi(e) || e.pointerType !== 'mouse') { hoverBobai(false); return; }
  const k = nearObj(e), me = !k && onBobai(e); win.style.cursor = k || me ? 'pointer' : '';
  hoverBobai(me);
  if (!pinnedK && k !== focusK) { setFocus(k); hoverMove(k); }
});
win.addEventListener('pointerleave', () => hoverBobai(false));
// HE NOTICES THE MOUSE ON HIM (2026-09-28, operator: "more alive"): resting the pointer on BOBAI for a second makes
// him wave (the idle take) and say hi — the first two times with a line, then a wave alone, at most five times a
// visit and once a minute. Passing over him does nothing; he never cuts into a move or a moment of the chain.
const HOVER_LINES = ['Oh! You are watching me work.', 'Looking for me? Right here, working.', 'Caught you hovering. Hello there.',
  'Tap me and I tell you what I am doing.', 'You found my good side. Both sides are good.'];
let waveT = 0, waveN = 0, waveAt = -1e9;
function hoverBobai(on) {
  if (!on) { clearTimeout(waveT); waveT = 0; return; }
  // once tapped he has been found: no 'you are watching me' after it (operator, 2026-10-06); a finger never hovers
  if (waveT || waveN >= 5 || mode !== 'live' || tapN > 0 || lastPointer !== 'mouse') return;
  waveT = setTimeout(() => {
    waveT = 0; const now = performance.now();
    if (tapN > 0 || now < waveAt + 60e3 || QUEUE.length || now < sceneUntil || pinnedK || (VID.on && !/^rest/.test(VID.cur || ''))) return;
    if (!vidWave()) return;
    waveAt = now; waveN++; (window.__btHover = window.__btHover || []).push(Math.round(now / 1000)); // for checks from outside
    speak(waveN <= HOVER_LINES.length ? HOVER_LINES[(waveN - 1) % HOVER_LINES.length] : pick(HELLO), 3600); // never a silent wave (1.10.)
    LIFE.next = Math.max(LIFE.next, now + 25e3); LIFE.quietSince = Date.now();
  }, 1000);
}
win.addEventListener('click', e => {
  if (onUi(e)) return;
  if (onBobai(e) && !pinnedK && mode === 'live') { clearTimeout(waveT); waveT = 0; bobaiTap(); return; }
  const k = nearObj(e);
  if (!k) { if (lastPointer !== 'mouse' && pinnedK) { pinnedK = null; setFocus(null); } return; } // a tap on empty space closes
  pinnedK = pinnedK === k ? null : k; setFocus(lastPointer === 'mouse' ? (pinnedK || k) : pinnedK); if (pinnedK) clickMove(k);
});

// ================= terminal =================
const logEl = $('log');
let logFollow = true; // the log keeps to its newest line (see BACK TO THE LIVE END)
function logLine(tag, color, parts, txs = [], t = Date.now()) {
  const l = document.createElement('div'); l.className = 'ln'; l.style.setProperty('--c', color);
  const tt = document.createElement('span'); tt.className = 't';
  // ONE COLUMN (2026-09-28): an older line said '27 Sept, 06:40', a new one '05:40:56', and the tags and texts stood
  // crooked with the ellipsis early. Older lines now read 'Sun 06:40' (the full date on hover), both nine characters.
  const old = Date.now() - t > 20 * 3600e3;
  tt.textContent = old ? new Date(t).toLocaleString('en-GB', { weekday: 'short' }) + ' ' + new Date(t).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    : new Date(t).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  if (old) tt.title = new Date(t).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const g = document.createElement('span'); g.className = 'g'; g.textContent = tag;
  const m = document.createElement('span'); m.className = 'm';
  for (const p of parts) { if (!p) continue; const s = document.createElement(Array.isArray(p) ? 'b' : 'span'); s.textContent = Array.isArray(p) ? p[0] : p; m.append(s); }
  for (const [lab, h] of txs) if (h) { const a = document.createElement('a'); a.href = TX + h; a.target = '_blank'; a.rel = 'noopener'; a.textContent = lab + ' ↗'; m.append(a); }
  l.append(tt, g, m);
  // THE LOG IS THE VISIT (operator, 2026-09-28): an event the replay plays from the past is not written in — only what
  // happens from the connection on. The line is still built (callers may use it), just not shown.
  if (mode === 'replay' && t < Date.now() - 60e3) return l;
  const atEnd = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60;
  logEl.append(l);
  while (logEl.children.length > 150) logEl.firstChild.remove();
  if (atEnd || logFollow) logEl.scrollTop = logEl.scrollHeight; // follow the newest line unless the reader scrolled back
  return l;
}

// ================= the prompt: ask BOBAI, or have it check any token — free =================
// Answers come from the same live numbers the scene shows; a token check runs the site's own
// pre-trade scanner (/api/preflight): tax measured from real trades, sellability, depth, LP.
const say = (parts, txs, c = '#F0B90B') => { const l = logLine('BRAIN', c, parts, txs); l.classList.add('wrap'); return l; };
const ADDR = /0x[0-9a-fA-F]{40}/;
const CMDS = {
  help: () => { say(['ask me: ', ['burns'], ' · ', ['next'], ' · ', ['liq'], ' · ', ['defi'], ' · ', ['giggle'], ' · ', ['price'], ' · ', ['bots'], ' · ', ['follow']]); say([['follow'], ' traces the latest trade’s 3% to every burn and pot it paid for — or tap any ▲ ▼ on the timeline, or paste a trade’s tx hash.']); say(['or paste ', ['any BNB Chain token address'], ' and I check it for you: tax, can you sell, depth, LP. Free.']); },
  burns: () => { const wk = S.burns.filter(e => Date.parse(e.time) >= Date.now() - 7 * 86400e3); setFocus('burnA');
    // the latest three runs, each with its transaction (2026-10-09: the invite promised a list the answer never gave)
    setTimeout(() => { for (const e of S.burns.filter(x => +x.bobaiBurned > 0).slice(-3).reverse()) say([ago(Date.parse(e.time)) + ': ', [bobaiAmt(+e.bobaiBurned)], ' burned'], [['tx', e.bobaiBurnTx]], D.burnA.c); }, 60);
    say([[bobaiAmt(S.deadA || 0)], ` burned in total (${supplyPct(S.deadA || 0)}% of supply). This week the bot burned `, [bobaiAmt(wk.reduce((a, e) => a + (+e.bobaiBurned || 0), 0))], ` and ${cmp(wk.reduce((a, e) => a + bobOf(e), 0))} BOB.`], [['last burn', S.burns.at(-1)?.bobaiBurnTx]], D.burnA.c); },
  next: () => { setFocus('core'); const left = W.buyback.last ? W.buyback.last + 600e3 - Date.now() : 0;
    const sb = splitBnb(); void left;
    say([['$' + nf(S.queued * S.price + sb * S.bnbP, 2)], ` is queued for the next buyback (${bobaiAmt(S.queued)} of tax${sb > 0 ? ` + ${bnbF(sb)} ready to split` : ''}). The token swaps its tax to BNB at `, [bobaiAmt(MIN_DISPATCH)], ` (${Math.round(clamp(S.queued / MIN_DISPATCH, 0, 1) * 100)}% there), inside a trade; the bot splits it within 10 min.${nextEta()}`]); },
  liq: () => { setFocus('liq'); const b = boost3();
    say(['Liq Boost III: ', [b.n + ' adds'], `, ${bnb4(b.bnb)} in, ${nf(b.lp, 2)} LP burned. `, [lpText()], ' of the pool LP sits at the dead address — nobody can pull it.'], [], D.liq.c); },
  defi: () => { setFocus('defi'); const rb = S.lp?.last?.steps?.rebalance, inr = lpNow().inR;
    if (!S.lp) { say(['Still reading the DeFi agent. Ask me again in a few seconds.'], [], D.defi.c); return false; } /* before its record loaded it said "0.000 BNB, in range" (2026-10-07) */
    say(['The DeFi agent works ', [bnbF(lpNow().value ?? 0)], ` in CAKE/BNB 0.05%${inr === false ? ', currently OUT of range (it earns nothing until it moves back or resets)' : inr === true ? ', in range, earning fees' : ''}. Fees so far `, [bnbF(S.lp?.flow?.in?.fees?.bnb || 0)], `${defiRate()}; it holds ${bobaiAmt(S.lp?.flow?.out?.bobai_units || 0)} bought with half of them.`], [], D.defi.c); },
  giggle: () => { setFocus('giggle'); const g = ggBnb();
    if (!GIGGLE_OPEN()) return say(['The Giggle Academy pot went to Giggle Academy on Nov 20, World Children’s Day. The transfer is on BscScan.'], [], D.giggle.c);
    say(['The Giggle Academy pot holds ', [bnb4(g)], ` (≈$${nf(g * S.bnbP, 2)}). It all goes to Giggle Academy on Nov 20 — ${Math.ceil((ggEnd() - Date.now()) / 86400e3)} days from now.`], [], D.giggle.c); },
  price: () => { setFocus('src'); const c = chartWords(), f = LIFE.flow || {}, rB = CX.liqUsd > 0 && S.bnbP > 0 ? CX.liqUsd / 2 / S.bnbP : 0;
    say(['BOBAI is ', ['$' + (S.price || 0).toFixed(8)], `, market cap ≈ $${nf(S.price * (1e9 - (S.deadA || 0)))} (supply minus what is burned)${c ? `, ${c.s} in 24 h` : ''}.`
      + (c && c.vb != null && Math.abs(c.ch - c.vb) >= 0.5 ? ` Against BNB I am ${c.sg(c.vb)}: BNB itself went ${c.sg(c.bnb)} in dollars, and that is in every USD figure.` : '')
      + (f.b || f.s ? ` This hour ${nf(f.b)} buy${f.b === 1 ? '' : 's'} ($${nf(f.bu || 0)}) and ${nf(f.s)} sell${f.s === 1 ? '' : 's'} ($${nf(f.su || 0)}).` : '')
      + (rB > 0 ? ` The pool holds ${bnbF(rB)} a side (≈$${nf(CX.liqUsd)}): a 1 BNB buy moves the price about ${(((1 + 1 / rB) ** 2 - 1) * 100).toFixed(1)}%, plus the 3% tax.` : '')
      + ' Read from the pool reserves and Chainlink BNB/USD, this block.']); },
  bots: () => { say(['buyback bot 1ce: last run ', [ago(W.buyback.last)], ' · dev bot d38: ', [ago(W.dev.last)], ' · DeFi agent: ', [ago(W.lp.last)], ' · agent server: ', [nf(HB.agent || 0) + ' tool calls by agents today']]); },
};
CMDS.follow = () => followTrade(S.hist.filter(e => !e.ours).sort((a, b) => b.t - a.t)[0]); // every swap read, not only the ones with a scene
CMDS.trace = CMDS.follow;
CMDS.burn = CMDS.burns; CMDS.buyback = CMDS.next; CMDS.pot = CMDS.giggle; CMDS.liquidity = CMDS.liq; CMDS.agent = CMDS.defi;
CMDS.safe = () => { setFocus('src');
  say([vary('ask-safe', ['Fair question. Here is what the chain says: ', 'Never trust, verify. On-chain: ', 'I would ask too. The facts: ', 'Do not take my word for it. The chain: ', 'Good instinct. What anyone can check: ']),
    ['ownership renounced'], ', no mint, ', [lpText()], ' of the pool LP burned at the dead address, so nobody can pull it. Now I buy and sell $250 of myself on paper:']);
  check(BOBAI); };
CMDS.today = () => { const b = awayBits(Date.now() - 86400e3);
  say([vary('ask-today', ['The last 24 hours on my chain: ', 'Today so far, the last 24 h: ', 'What you missed in 24 hours: ', 'Here is the day: ', 'The last day, from the record: ']),
    [b || 'quiet, no burn run and hardly a trade'], '.']); };
CMDS.why = () => { const c = chartWords(), f = LIFE.flow || {}, now = Date.now();
  const big = S.hist.filter(x => !x.ours && !x.taxSwap && x.t >= now - 3600e3).sort((a, b) => b.usd - a.usd)[0];
  const runs = S.burns.filter(e => Date.parse(e.time) >= now - 86400e3).length, bits = [];
  if (c) bits.push(`${c.s} in 24 hours over ${nf(c.n)} trades`);
  if (c && c.vb != null && Math.abs(c.ch - c.vb) >= 0.5) bits.push(`against BNB ${c.sg(c.vb)}, because BNB itself went ${c.sg(c.bnb)} in dollars`);
  if (f.b || f.s) bits.push(`this hour ${nf(f.b)} buy${f.b === 1 ? '' : 's'} for $${nf(f.bu || 0)} against ${nf(f.s)} sell${f.s === 1 ? '' : 's'} for $${nf(f.su || 0)}`);
  if (big && big.usd >= 50) bits.push(`the largest trade this hour was a ${big.buy ? 'buy' : 'sell'} of $${nf(big.usd)}`);
  bits.push(runs ? `the burns kept going: ${runs} run${runs > 1 ? 's' : ''} in 24 hours` : 'no burn run in 24 hours yet');
  say([vary('ask-why', ['No forecasts from me, only the record: ', 'Here is what moved it: ', 'The chain, not an opinion: ', 'What the trades say: ', 'Facts only: ']), [bits.join('; ')], '. In a thin pool one trade can move the price.']); };
// WHY THE SITES DISAGREE (operator, 2026-10-09: terminal, Binance Web3 and DexScreener each showed another 24h %):
// the honest answer with the figures behind it — each site prices BOBAI in dollars with its own BNB/USD rate and its
// own "a day ago"; against BNB the pool's price is one number for everybody
CMDS.sites = () => { setFocus('src'); const c = chartWords();
  if (!c || c.vb == null) return say(['Still reading my chart. Ask me again in a minute.']);
  say([vary('ask-sites', ['Fair question. ', 'Good eye. ', 'Same coin, three numbers? Here is why. ', 'Not a bug, a currency. ', 'Let me untangle that. ']),
    'Every site turns my pool price into dollars with its own BNB/USD rate and its own "24 hours ago". Mine: ', [c.s], ' in USD, from my pool and Chainlink. ',
    'Against BNB I am ', [c.sg(c.vb)], ' — that number is the pool itself, the same for everyone. BNB went ', [c.sg(c.bnb)], ' in dollars',
    Math.abs(c.bnb) >= 1 ? ', and that is most of the gap between the sites.' : ', so the sites should be close today.',
    vary('ask-sites-end', [' Small pool, so one trade a minute apart moves it too.', ' A few tenths apart is normal for a thin pool.', ' None of them is lying, they just look at different clocks.', ' My chart reads the chain, block by block.', ' Ask me "price" for the rest.'])]); };
CMDS.holders = async () => { setFocus('src');
  try {
    const j = await getJSON(`${SITE}/api/smart-money`, 12000), h = j?.whale_flows?.holdings; if (!h) throw new Error('no holdings');
    const w = h.change_7d || {}, d = h.change_1d || {}, sg = v => (v >= 0 ? '+' : '') + v;
    say([vary('ask-holders', [`My watcher follows every wallet that ever crossed ${bobaiAmt(5e6)}: `, 'The big wallets, read from the chain: ', 'The big holders, on-chain: ', 'Who holds the most: ', 'The 5M+ club: ']),
      [`${nf(h.wallets_tracked)} watched wallets hold ${h.percent_of_total_supply}% of supply`], h.wallets_at_or_above_threshold != null ? ` (${nf(h.wallets_at_or_above_threshold)} of them at 5M+ right now)` : '',
      `. 24 h ${d.percent_change != null ? sg(d.percent_change) + '%' : '?'}, 7 days ${w.percent_change != null ? sg(w.percent_change) + '%' : '?'}${w.bobai_change != null ? ` (${w.bobai_change >= 0 ? '+' : '−'}${bobaiAmt(Math.abs(w.bobai_change))})` : ''}. A total holder count would come from a third party, so I do not show one.`]);
  } catch { say(['The whale watcher did not answer just now — ask again in a minute.']); } };
CMDS.whales = CMDS.holders;
CMDS.moon = () => { const wk = S.burns.filter(e => Date.parse(e.time) >= Date.now() - 7 * 86400e3).reduce((a, e) => a + (+e.bobaiBurned || 0), 0);
  say([vary('ask-moon', ['No dates from me. What I can show: ', 'Moon? I count burns, not days. ', 'I do not do price promises. I do this: ', 'Wen? Nobody knows. What is certain: ', 'No moon talk, just the record: ']),
    [bobaiAmt(wk)], ' burned this week, ', [lpText()], ' of the LP burned. 3% of every trade keeps working.']); };
CMDS.who = () => say([vary('ask-who', ['I am BOBAI, the brain on BNB Chain. ', 'BOBAI. A brain that lives on BNB Chain. ', 'Hi, I am BOBAI. ', 'The name is BOBAI, and this is my chain. ', 'I am BOBAI — the token, awake. ']),
  `Every trade pays 3% tax: it buys back and burns, adds liquidity and burns the LP, and funds a DeFi agent${GIGGLE_OPEN() ? ' and, until Nov 20, Giggle Academy' : ''}. Ownership renounced. Everything I tell you is read from the chain.`,
  vary('ask-who-core', [' A token that thinks, talks and shows its receipts: one in a billion.', ' Plenty of tokens. One brain that reads its own chain to you.', ' Not a chatbot glued to a chart — the chain itself, talking.', ' One in a billion, and I can prove every word.', ' Ask me anything. If I cannot show it on-chain, I will not say it.'])]);
CMDS.hi = () => say([vary('ask-hi', ['gm! Ask me anything about BOBAI, or type ', 'Hey, good to see you. Try ', 'Hello! I am listening. Ask me ', 'gm gm. Want the facts? Type ', 'Hi there! Start with ']), ['today'], ' or ', ['help'], '.']);
CMDS.thanks = () => say([vary('ask-thanks', ['Anytime.', 'You are welcome. I am always here.', 'My pleasure. Back to work.', 'Thank YOU for being here.', 'Glad to help. The chain never sleeps, and neither do I.'])]);
CMDS.joke = () => { say([vary('ask-joke', ['One joke, coming up.', 'Okay, okay. Listen.', 'You asked for it.', 'A joke? I have one.', 'Hold on, this one is good.'])]); jokeTap(); };
CMDS.tax = () => say([vary('ask-tax', ['The tax, as the contract has it: ', 'Every buy and every sell: ', 'Simple: ', 'Here is where the tax goes: ', 'The split: ']),
  ['3% on every trade'], ': buyback and burn, liquidity with the LP burned, and the DeFi agent and pots. The token swaps it to BNB once ', [bobaiAmt(MIN_DISPATCH)], ' are collected; the bot splits it within 10 minutes. Type ', ['next'], ' for the charge.']);
CMDS.mood = () => say([moodLine()]);
CMDS.ca = () => say([vary('ask-ca', ['The one and only contract: ', 'Here it is: ', 'BOBAI on BNB Chain: ', 'Copy it from here, never from a DM: ', 'The contract address: ']), [BOBAI],
  '. Ownership renounced. Paste any other token address here and I check it for you.']);
CMDS.nft = () => { const n = S.nft; if (!n) return say(['Still reading the NFT drops — ask again in a few seconds.']);
  const m = (n.minted || []).reduce((a, b) => a + b, 0), cap = (n.cap || []).reduce((a, b) => a + b, 0) || 1925, d = n.drops?.[0];
  say([vary('ask-nft', ['The Buy NFTs: ', 'My NFT collection: ', 'NFTs, earned not minted: ', 'The drops so far: ', 'The collection: ']),
    [`${nf(m)} of ${nf(cap)} dropped`], ` to ${nf(n.holders || 0)} holders. A buy big enough earns one, automatically.${d ? ` Latest: #${d.tokenId} for a $${nf(d.usd || 0)} buy.` : ''}`]); };
CMDS.team = () => { const add = S.man.at?.(-1);
  say([vary('ask-team', ['One dev and his AI agent, building in the open. ', 'A solo builder and an AI agent. ', 'No big team: one dev, one AI agent, all on-chain. ', 'Built by one dev with an AI agent. ', 'The team is small: a dev and his agent. ']),
    `The dev wallet adds liquidity from its own pocket${add ? ` — last time ${ago(Date.parse(add.time))}` : ''}, and every bot is public. No roadmap promises: what is built is live, and what is live is on-chain.`]); };
CMDS.buy = () => say([vary('ask-buy', ['Where: ', 'How to get BOBAI: ', 'The pool: ', 'Trading BOBAI: ', 'Simple: ']),
  ['PancakeSwap, BOBAI/WBNB'], ', contract ', [short(BOBAI)], ' (type ', ['ca'], ' for the full one). 3% tax on every buy and sell, so allow about 4% slippage. Not advice — type ', ['safe'], ' for the facts first.']);
CMDS.help = (h => () => { h(); say(['or just ask: ', ['is it safe?'], ' · ', ['what did I miss?'], ' · ', ['why down?'], ' · ', ['whales'], ' · ', ['tax'], ' · ', ['who are you?']]); })(CMDS.help);
// ================= what a typed question means (2026-10-09) =================
// The prompt matched only the first word that WAS a command name: 10 of 64 real questions got an answer ("preis",
// "is it safe", "wen moon", "what did I miss", every German one and every typo fell to one fixed sentence). Now:
// phrases first, then single words with a typo allowance, then a fallback that says what he
// can do with one live fact — five ways each. Every answer is the chain's or our own log's, never a third party's.
const bobaiAmt = n => { const u = (+n || 0) * S.price; return `${cmp(+n || 0)} BOBAI (≈$${nf(u, u < 10 ? 2 : 0)})`; }; // $BOBAI always with USD
const ASK = { hit: 0, miss: [] };
const INTENTS = [ // English only (operator, 2026-10-09: "it is English, focus on that")
  [/\b(safe|rug\w*|scam\w*|honeypot|legit|trust|renounc\w*|audit\w*)\b/, 'safe'],
  [/\b(dex ?screener|gecko\w*|cmc|coinmarketcap|other sites?|different|differs?|mismatch|don'?t match|wrong number)\b|\bbinance\b.*\b(shows?|says?|%|percent)\b/, 'sites'],
  [/\b(miss\w*|today|24 ?h|news|status|update|what'?s up|happened)\b/, 'today'],
  [/\b(why)\b|\b(dump\w*|falling|down|pump\w*)\b/, 'why'],
  [/\b(holders?|whales?|big wallets?|smart money)\b/, 'holders'],
  [/\b(when|eta|how long)\b.*\b(burn\w*|buyback)|\bnext\b/, 'next'],
  [/\b(moon|wen|lambo|100x|1000x)\b/, 'moon'],
  [/\b(who)\b|\b(what are you|about you)\b/, 'who'],
  [/\b(joke|funny|lol|haha)\b/, 'joke'],
  [/\b(thanks?|thx|ty)\b/, 'thanks'],
  [/^(hi|hey|hello|gm|gn|yo|sup)\b/, 'hi'],
  [/\b(what can you do|commands?|help)\b/, 'help'],
  [/\b(tax|taxes)\b/, 'tax'],
  [/\b(price|cost\w*|mcap|market ?cap|marketcap|worth|chart)\b/, 'price'],
  [/\b(burn\w*|dead ?address|supply)\b/, 'burns'],
  [/\b(lp|liq\w*|pool|depth|locked)\b/, 'liq'],
  [/\b(defi|range|cake|fees?|yield|apr|apy)\b/, 'defi'],
  [/\b(giggle|academy|donat\w*|charity)\b/, 'giggle'],
  [/\b(bots?|alive|running)\b/, 'bots'],
  [/\b(follow|trace|latest trade)\b/, 'follow'],
  [/\b(how are you|mood|feeling)\b/, 'mood'],
  [/\b(contract|ca|token address)\b/, 'ca'],
  [/\b(nfts?|drops?|collection)\b/, 'nft'],
  [/\b(volume|trades|activity)\b/, 'today'],
  [/\b(team|dev|devs|developer|roadmap|who builds)\b/, 'team'],
  [/\b(buy|sell|swap|pancake\w*|slippage)\b/, 'buy'],
];
const lev = (a, b) => { // edit distance, for typos ("prise", "liqudity")
  if (Math.abs(a.length - b.length) > 2) return 9;
  let p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[b.length];
};
const TYPO_KEYS = ['price', 'burns', 'burn', 'liquidity', 'liq', 'defi', 'giggle', 'next', 'buyback', 'holders', 'whales', 'safe', 'tax', 'help', 'follow', 'joke', 'today'];
const TYPO_TO = { whales: 'holders', burn: 'burns', liquidity: 'liq', buyback: 'next' };
function intentOf(q) {
  const t = q.toLowerCase().replace(/[^a-z0-9%' ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const [re, k] of INTENTS) if (re.test(t) && CMDS[k]) return k;
  for (const x of t.split(' ').filter(w => w.length >= 4)) {
    const k = TYPO_KEYS.find(c => c.length >= 4 && lev(x, c) <= (c.length >= 7 ? 2 : 1));
    if (k) return TYPO_TO[k] || k;
  }
  return null;
}
function missed(q) {
  ASK.miss.push(q.slice(0, 80)); if (ASK.miss.length > 20) ASK.miss.shift();
  const chg = Math.round(clamp(S.queued / MIN_DISPATCH, 0, 1) * 100);
  const fact = S.burns.length ? `Right now the next buyback is ${chg}% charged.` : 'I am still reading the chain.';
  say([vary('ask-miss', [`Not sure what you mean. ${fact} Try `, `That one I do not know yet. ${fact} Ask me `, `Hm, I only speak BOBAI. ${fact} Try `,
    `No idea, honestly. ${fact} You can ask `, `Lost me there. ${fact} Ask `]), ['help'], ', or paste any token address and I check it.']);
}
window.__btAsk = q => intentOf(q); window.__btAskLog = () => ({ hit: ASK.hit, miss: [...ASK.miss] }); // for checks from outside
// the next buyback at the last 24 h's pace (2026-10-09): 3% of the dollars traded fills the queue; an estimate, said as one
function nextEta() {
  const day = CH.rows.filter(r => r.t >= Date.now() - 86400e3), volUsd = day.reduce((a, r) => a + (r.v || 0) * (r.u || S.bnbP), 0);
  const missUsd = Math.max(0, (MIN_DISPATCH - S.queued) * S.price), perH = volUsd * 0.03 / 24;
  if (!(missUsd > 0) || !(perH > 0) || !S.price) return '';
  const h = missUsd / perH;
  return h > 72 ? ' At the last 24 h pace that takes more than three days.' : ` At the last 24 h pace that is about ${h < 1.5 ? Math.max(1, Math.round(h * 60)) + ' min' : Math.round(h) + ' h'} — a pace, not a promise.`;
}
// what the DeFi agent's fees come to a year on its capital, from its own record (2026-10-09); the past, not a forecast
function defiRate() {
  const fees = +(S.lp?.flow?.in?.fees?.bnb || 0), since = Date.parse(S.lp?.flow?.since || ''), cap = lpNow().value;
  const days = (Date.now() - since) / 86400e3;
  if (!(fees > 0) || !(days >= 3) || !(cap > 0)) return '';
  return ` in ${Math.round(days)} days (≈$${nf(fees * S.bnbP, 2)}), about ${(fees / cap / days * 365 * 100).toFixed(0)}% a year on its capital so far`;
}
// HE ANSWERS WITH HIS BODY TOO (2026-10-09): a typed question got its answer in the log only; now he says one short line
// with the move that shows it — only when nothing of the chain and no take of his own is running (a take is never cut),
// five ways each, every line naming its own move or none (checked with the window lines by __btPools)
const ASK_LINES = {
  burns: ['burn', ['Burn time. My record is below.', 'Burning is what I do best. The numbers are below.', 'Every burn is on-chain. Read below.', 'Gone for good. Here is how much.', 'My burns, as the chain counts them.']],
  next: ['burn', ['The next buyback is charging. Details below.', 'Tax in, burn out. Here is the charge.', 'Every trade fills it. Look below.', 'My next burn, measured. Below.', 'Charging up. The numbers are below.']],
  liq: ['liq', ['More liquidity, and the LP is gone for good. Below.', 'The pool, read live. Below.', 'Liquidity: here is what I added.', 'Deep pools, nobody can pull them. See below.', 'My liquidity, line by line below.']],
  defi: ['defi', ['My DeFi agent, at work. Details below.', 'The DeFi agent reports in. Below.', 'Here is what my DeFi agent earns.', 'DeFi agent check. Numbers below.', 'Tuning the DeFi agent. Read below.']],
  giggle: ['giggle', ['A coin for Giggle Academy. Details below.', 'For the kids of Giggle Academy. Below.', 'The Giggle pot, counted. Below.', 'Giggle Academy, my favourite pot. Below.', 'Every trade gives a little to Giggle Academy.']],
  price: ['think', ['Let me check the chain. Below.', 'Reading the pool for you. Below.', 'Checking. The answer is below.', 'One moment, reading the record. Below.', 'Here is what the chain says. Below.']],
  moon: ['moon', ['Looking at the moon. No dates from me.', 'Wen moon? I only count what is on-chain.', 'The moon can wait. The record is below.', 'Moon talk? Facts below.', 'Hello, moon. Not today.']],
};
ASK_LINES.why = ASK_LINES.today = ASK_LINES.holders = ASK_LINES.safe = ASK_LINES.tax = ASK_LINES.price; ASK_LINES.buyback = ASK_LINES.next;
function speakAnswer(k) {
  const l = ASK_LINES[k], now = performance.now();
  (window.__btAskSpoke = window.__btAskSpoke || []).push([k, !!l && mode === 'live' && !QUEUE.length && now >= sceneUntil && !ownBusy() && !VID.go && now >= (LIFE.sayUntil || 0)]); // for checks from outside
  if (!l || mode !== 'live' || QUEUE.length || now < sceneUntil || ownBusy() || VID.go || now < (LIFE.sayUntil || 0)) return;
  LIFE.touchAt = now; LIFE.next = Math.max(LIFE.next, now + 20e3);
  setPose(flowPose(l[0]) === l[0] ? l[0] : poseOr(l[0]), 6); speak(vary('ask-say-' + k, l[1]), 4200);
}
async function check(addr) {
  // the move only when nothing of the chain waits or plays (2026-10-09): an urgent pose here overwrote a queued chain move
  if (mode === 'live' && !QUEUE.length && performance.now() >= sceneUntil && !VID.go && !ownBusy()) setPose('defi', 6);
  fire(A.head, new THREE.Color('#22d3ee'));
  const wait = say(['checking ', [short(addr)], ' — buying $250 of it on paper, selling it back, reading the pool…'], [], '#22d3ee');
  try {
    const j = await getJSON(`${SITE}/api/preflight?address=${addr}&usd=250`, 25000);
    wait.remove();
    if (j.error) return say([j.error], [], SELLC);
    const tk = j.token || {}, tax = j.tax || {}, ex = j.exit || {}, dp = j.depth || {};
    say([[`${tk.symbol || '?'} · ${cut(tk.name || '', 40)}`]], [], '#22d3ee');
    if (j.stop?.length) for (const s of j.stop) say(['STOP · ', [s.code || ''], ' — ' + cut(s.why || '', 180)], [], SELLC);
    else say([['no stop'], ' — the sell went through from a fresh address and it quotes.'], [], BUYC);
    say(['tax: buy ', [(tax.buy_pct ?? '?') + '%'], ' · sell ', [(tax.sell_pct ?? '?') + '%'], ` (${tax.source || 'measured'}) · $250 round trip keeps `, [(ex.round_trip_keep_pct ?? '?') + '%']], [], '#22d3ee');
    say(['a 1% move takes ', ['$' + nf(dp.one_percent_buy_usd || 0)], ' to buy / ', ['$' + nf(dp.one_percent_sell_usd || 0)], ' to sell · LP burned ', [(j.lp_burned_pct ?? 0) + '%']], [], '#22d3ee');
    for (const c of (j.caution || []).slice(0, 3)) say(['careful · ', [c.code || ''], ' — ' + cut(c.why || '', 160)], [], '#ffc247');
    say(['one block, not advice. The full scan: '], [], '#6f6f86').querySelector('.m').append(Object.assign(document.createElement('a'), { href: `${SITE}/scanner?token=${addr}`, target: '_blank', rel: 'noopener', textContent: 'open in the Pool Scanner ↗' }));
  } catch (e) { wait.remove(); say(['the scanner did not answer in time — try again in a moment.'], [], SELLC); }
}
// ================= share this moment: one image, the real numbers, ready for X =================
// The live frame (brain, black holes, streams) + BOBAI in his current pose + the figures of this block.
// Mobile gets the native share sheet with the file; desktop downloads it and opens a prepared post.
// The moments a card can tell (B8, 2026-09-25): right now, the last burn, the last liquidity add, the last
// 24 hours, the last 7 days. Each has its own pose, colour, big number, four cards and post text; a single
// event carries its transaction, so the card says where to check it. Every figure is the terminal's own.
const MOTIFS = ['now', 'burn', 'liq', 'day', 'week'];
function motifOf(k, now) {
  const qUsd = S.queued * S.price + splitBnb() * S.bnbP, sumB = (a, f) => a.reduce((s, x) => s + (parseFloat(f(x)) || 0), 0);
  const utc = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase() + ' · ' + new Date(t).toISOString().slice(11, 16) + ' UTC';
  if (k === 'burn') {
    const e = S.burns.at(-1); if (!e) return null;
    const t = Date.parse(e.time), l = S.liq.find(x => Math.abs(Date.parse(x.time) - t) < 20 * 60e3);
    return {
      pose: (tierOf(BURN_TIERS, burnUsd(e)) || [])[1] || 'burn', col: D.burnA.c, stamp: 'BURN OF ' + utc(t), tx: e.bobaiBurnTx, t,
      label: 'BOBAI JUST BURNED', value: nf(e.bobaiBurned), sub: `BOBAI · from ${bnbF(e.totalBnb)} of tax  ·  ≈ $${nf(e.bobaiBurned * S.price, 2)} today`,
      cards: [['$BOB BURNED', cmp(bobOf(e)) + ' BOB', 'the same run', D.burnB.c],
        ['TO LIQUIDITY', l ? bnb4(l.bnb) : '—', l ? nf(l.lpBurned, 2) + ' LP burned' : 'no add in this run', D.liq.c],
        ['TO THE DEFI AGENT', bnb4(e.lpAgentBnb), 'it works the capital', D.defi.c],
        ['TO THE GIGGLE POT', bnb4(e.giggleBnb), 'donated on Nov 20', D.giggle.c]],
      text: `$BOBAI just burned ${nf(e.bobaiBurned)} BOBAI and ${cmp(bobOf(e))} $BOB from its 3% tax. Check it on-chain: https://bscscan.com/tx/${e.bobaiBurnTx} 🔥`,
    };
  }
  if (k === 'liq') {
    const l = S.liq.at(-1); if (!l) return null;
    const b = boost3();
    return {
      pose: 'liq', col: D.liq.c, stamp: 'LIQUIDITY ADD OF ' + utc(Date.parse(l.time)), tx: l.addLiqTx,
      label: 'BOBAI JUST ADDED LIQUIDITY', value: bnb4(l.bnb), sub: `half bought ${cmp(l.bobaiBought)} BOBAI, paired with the rest  ·  the LP is burned`,
      cards: [['LP BURNED', nf(l.lpBurned, 2) + ' LP', 'sent to the dead address', D.liq.c],
        ['POOL LOCKED', lpText(), 'of all LP, forever', D.liq.c],
        ['LIQ BOOST III', b.n + ' adds', 'since Sep 19', '#F0B90B'],
        ['BOOST III TOTAL', bnb4(b.bnb), nf(b.lp, 2) + ' LP burned', '#F0B90B']],
      text: `$BOBAI just added ${bnb4(l.bnb)} of liquidity and burned the LP: ${lpText()} of the pool is locked forever. On-chain: https://bscscan.com/tx/${l.addLiqTx} 💧`,
    };
  }
  if (k === 'day' || k === 'week') {
    const span = k === 'day' ? 86400e3 : 7 * 86400e3, since = now - span;
    const runs = S.burns.filter(e => Date.parse(e.time) >= since), adds = S.liq.filter(x => Date.parse(x.time) >= since);
    const burned = sumB(runs, e => e.bobaiBurned), bob = sumB(runs, bobOf);
    const range = k === 'day' ? 'LAST 24 HOURS · TO ' + utc(now)
      : 'LAST 7 DAYS · ' + new Date(since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase() + ' – ' + new Date(now).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
    const word = k === 'day' ? 'the last 24 hours' : 'the last 7 days';
    return {
      pose: k === 'day' ? 'idle' : 'giggle', col: '#F0B90B', stamp: range, tx: null,
      label: k === 'day' ? 'BOBAI BURNED IN 24 HOURS' : 'BOBAI BURNED IN 7 DAYS', value: nf(burned), sub: `BOBAI in ${runs.length} burn run${runs.length === 1 ? '' : 's'}  ·  ≈ $${nf(burned * S.price)} today`,
      cards: [['$BOB BURNED', cmp(bob) + ' BOB', 'Build On BNB, gone', D.burnB.c],
        ['LIQUIDITY ADDED', bnb4(sumB(adds, x => x.bnb)), adds.length + ' add' + (adds.length === 1 ? '' : 's') + ' · LP burned', D.liq.c],
        ['TO THE DEFI AGENT', bnb4(sumB(runs, e => e.lpAgentBnb)), 'it works the capital', D.defi.c],
        ['TO THE GIGGLE POT', bnb4(sumB(runs, e => e.giggleTx ? e.giggleBnb : 0)), 'donated on Nov 20', D.giggle.c]],
      text: `$BOBAI, ${word}: ${nf(burned)} BOBAI and ${cmp(bob)} $BOB burned in ${runs.length} runs, ${bnb4(sumB(adds, x => x.bnb))} added to liquidity with the LP burned. All on-chain 🧠`,
    };
  }
  const wk = S.burns.filter(e => Date.parse(e.time) >= now - 7 * 86400e3);
  return {
    pose: null, col: D.burnA.c, stamp: utc(now) + '  ·  LIVE FROM BNB CHAIN', tx: null,
    label: 'BOBAI BURNED FOREVER', value: nf(S.deadA || 0), sub: `${supplyPct(S.deadA || 0)}% of the supply  ·  ≈ $${nf((S.deadA || 0) * S.price)} today`,
    cards: [['BURNED THIS WEEK', cmp(sumB(wk, e => e.bobaiBurned)) + ' BOBAI', '+ ' + cmp(sumB(wk, bobOf)) + ' $BOB burned', D.burnA.c],
      ['NEXT BUYBACK', '$' + nf(qUsd, 2), 'tax charging the next burn', '#F0B90B'],
      ['LIQUIDITY LOCKED', lpText(), 'of the pool LP burned', D.liq.c],
      ['GIGGLE ACADEMY POT', bnb4(ggBnb()), 'donated on Nov 20', D.giggle.c]],
    text: `$BOBAI's brain right now: ${nf(S.deadA || 0)} BOBAI burned (${supplyPct(S.deadA || 0)}% of supply), $${nf(qUsd, 2)} charging for the next buyback. Watch it live 🧠`,
  };
}
// the moment the scene just played (a burn or a liquidity add), so SHARE right after it offers that one
let lastMoment = null;
async function shareCard() {
  // never post a card with zeros on it: wait until the chain and the logs have answered
  if (!S.deadA || !S.burns.length || !S.price) return logLine('SHARE', '#F0B90B', ['still reading the chain — try again in a few seconds']);
  const btn = $('shr'); btn.disabled = true;
  try {
    // 1) the scene this instant, copied off (the drawing buffer is only valid right after a render)
    if (window.__btHw) window.__btHw.hide(true); /* the card shows the scene as it always was: the Halloween night steps out for this one frame */
    useBloom ? composer.render() : renderer.render(scene, camera);
    const snap = document.createElement('canvas'); snap.width = renderer.domElement.width; snap.height = renderer.domElement.height;
    snap.getContext('2d').drawImage(renderer.domElement, 0, 0);
    if (window.__btHw) window.__btHw.hide(false);
    // same origin: a foreign image would taint the canvas
    const logo = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = '/logo.webp'; });
    const now = Date.now(), poseNow = fig.querySelector('img.on') || fig.querySelector('img[data-p="idle"]');
    const cache = {};
    const render = (motif, fmt) => cache[motif + fmt] ||= makeCard(motif, fmt, { snap, logo, now, poseNow });
    const pick = lastMoment && now - lastMoment.t < 120e3 ? lastMoment.kind : 'now';
    card = { motif: pick, fmt: portrait ? 'tall' : 'wide', render, cur: null,
      get blob() { return this.cur.blob; }, get file() { return this.cur.file; }, get text() { return this.cur.text; } };
    if (!(await pickCard(pick, card.fmt))) await pickCard('now', card.fmt);
    card.want = { motif: card.motif, fmt: card.fmt };
    shareMenu(true);
  } catch (e) { logLine('SHARE', SELLC, ['could not make the image: ' + String(e.message || e).slice(0, 60)]); }
  finally { btn.disabled = false; }
}
// One card: a moment in one format — 16:9 (1600×900) for X and desktop, 4:5 (1080×1350) for a phone feed.
async function makeCard(k, fmt, { snap, logo, now, poseNow }) {
  const m = motifOf(k, now); if (!m) return null;
  const tall = fmt === 'tall', W2 = tall ? 1080 : 1600, H2 = tall ? 1350 : 900;
  const c = document.createElement('canvas'); c.width = W2; c.height = H2; const g = c.getContext('2d');
  const SG = '"Space Grotesk", sans-serif', MONO = 'ui-monospace, Consolas, monospace';
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const fit = (text, weight, size, min, maxW, face) => { let f = size; g.font = `${weight} ${f}px ${face}`; while (g.measureText(text).width > maxW && f > min) { f -= 2; g.font = `${weight} ${f}px ${face}`; } };
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  g.fillStyle = '#0b090a'; g.fillRect(0, 0, W2, H2);
  // backdrop: the scene, dimmed; darker where the text sits
  const s = Math.max(W2 / snap.width, H2 / snap.height);
  g.globalAlpha = 0.55; g.drawImage(snap, (W2 - snap.width * s) / 2, (H2 - snap.height * s) / 2, snap.width * s, snap.height * s); g.globalAlpha = 1;
  const shade = tall ? g.createLinearGradient(0, 0, 0, H2) : g.createLinearGradient(0, 0, W2, 0);
  if (tall) { shade.addColorStop(0, 'rgba(8,6,7,.75)'); shade.addColorStop(0.2, 'rgba(8,6,7,.35)'); shade.addColorStop(0.55, 'rgba(8,6,7,.55)'); shade.addColorStop(0.68, 'rgba(8,6,7,.94)'); shade.addColorStop(1, 'rgba(8,6,7,.98)'); }
  else { shade.addColorStop(0, 'rgba(8,6,7,.97)'); shade.addColorStop(0.46, 'rgba(8,6,7,.93)'); shade.addColorStop(0.7, 'rgba(8,6,7,.25)'); shade.addColorStop(1, 'rgba(8,6,7,.55)'); }
  g.fillStyle = shade; g.fillRect(0, 0, W2, H2);
  // the terminal's grid of dots, faint, over the whole card (2026-09-26: the shared picture in the Brain look)
  g.fillStyle = 'rgba(255,236,200,.05)'; for (let y = 11; y < H2; y += 22) for (let x = 11; x < W2; x += 22) g.fillRect(x, y, 1.6, 1.6);
  const halo = g.createRadialGradient(W2 * 0.3, 0, 10, W2 * 0.3, 0, W2 * 0.7); halo.addColorStop(0, rgba(m.col, .10)); halo.addColorStop(1, rgba(m.col, 0));
  g.fillStyle = halo; g.fillRect(0, 0, W2, H2);
  // BOBAI, large, in the pose of the moment, standing in its colour
  const posed = await poseImg(m.pose), img = posed || poseNow;
  const FH = tall ? 700 : 830, FX = tall ? W2 / 2 : 1190, FY = tall ? 150 : H2 - FH + 18;
  const FW = FH * (img?.naturalWidth || 683) / (img?.naturalHeight || 1024), feet = FY + FH - 18;
  const glow = g.createRadialGradient(FX, FY + FH * 0.45, 20, FX, FY + FH * 0.45, tall ? 440 : 520);
  glow.addColorStop(0, rgba(m.col, .30)); glow.addColorStop(0.45, rgba(m.col, .08)); glow.addColorStop(1, rgba(m.col, 0));
  g.fillStyle = glow; g.fillRect(FX - 560, FY - 100, 1120, FH + 200);
  // the shadow under his feet: a flattened circle, so no edge of a box ever shows
  g.save(); g.translate(FX, feet); g.scale(1, 0.16);
  const floor = g.createRadialGradient(0, 0, 4, 0, 0, 240); floor.addColorStop(0, 'rgba(0,0,0,.7)'); floor.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = floor; g.fillRect(-250, -250, 500, 500); g.restore();
  if (img?.complete && img.naturalWidth) g.drawImage(img, FX - FW / 2, FY, FW, FH);
  // header: logo, name, the moment
  const LX = 64, HY = tall ? 92 : 84;
  if (logo) { g.save(); g.beginPath(); g.arc(LX + 28, HY, 28, 0, 7); g.clip(); g.drawImage(logo, LX, HY - 28, 56, 56); g.restore(); }
  const tx0 = logo ? LX + 74 : LX;
  g.textBaseline = 'alphabetic'; g.font = `700 34px ${SG}`; g.fillStyle = '#F0B90B'; g.fillText('$BOBAI', tx0, HY);
  g.fillStyle = '#eceaf5'; g.fillText(' BRAIN TERMINAL', tx0 + g.measureText('$BOBAI').width, HY);
  g.font = `600 15px ${MONO}`; g.fillStyle = '#8f90ad'; g.fillText(m.stamp, tx0, HY + 26);
  // the one big number
  const NY = tall ? 900 : 200;
  fit(m.label, 700, 17, 12, W2 - LX * 2, MONO); g.fillStyle = m.col; g.fillText(m.label, LX, NY);
  fit(m.value, 600, 104, 56, tall ? W2 - LX * 2 : 700, SG);
  g.fillStyle = '#ffffff'; g.shadowColor = rgba(m.col, .45); g.shadowBlur = 36; g.fillText(m.value, LX - 4, NY + 96); g.shadowBlur = 0;
  fit(m.sub, 500, 20, 13, tall ? W2 - LX * 2 : 700, MONO); g.fillStyle = '#a0a2c0'; g.fillText(m.sub, LX, NY + 136);
  // glass cards: 2 × 2 beside BOBAI, or one row of four under him
  const cols = tall ? 4 : 2, GX = tall ? 14 : 20, GY = 22, CW = tall ? (W2 - LX * 2 - GX * 3) / 4 : 302, CH = tall ? 150 : 138, CY = tall ? 1072 : 384;
  m.cards.forEach(([lab, val, sub, col], i) => {
    const x = LX + (i % cols) * (CW + GX), y = CY + Math.floor(i / cols) * (CH + GY), pad = tall ? 16 : 22;
    rr(x, y, CW, CH, 18);
    const fill = g.createLinearGradient(x, y, x, y + CH); fill.addColorStop(0, 'rgba(255,255,255,.085)'); fill.addColorStop(1, 'rgba(255,255,255,.03)');
    g.fillStyle = fill; g.fill(); g.strokeStyle = 'rgba(255,255,255,.13)'; g.lineWidth = 1.5; g.stroke();
    g.save(); rr(x, y, CW, CH, 18); g.clip(); g.fillStyle = col; g.fillRect(x, y, CW, 4); g.restore();
    fit(lab, 700, 14, 10, CW - pad * 2, MONO); g.fillStyle = col; g.fillText(lab, x + pad, y + 38);
    fit(val, 600, tall ? 34 : 40, 20, CW - pad * 2, SG); g.fillStyle = '#ffffff'; g.fillText(val, x + pad, y + (tall ? 88 : 88));
    fit(sub, 500, tall ? 13 : 15, 10, CW - pad * 2, MONO); g.fillStyle = '#9496b4'; g.fillText(sub, x + pad, y + (tall ? 122 : 118));
  });
  // the day's candles under the figures, with this moment marked on them — the chart is part of every story (wide only)
  const cs = !tall && typeof candles === 'function' ? candles().slice(-144) : [];
  if (cs.length > 6) {
    const X0 = LX, X1 = LX + 624, Y0 = 718, Y1 = 790, mt = m.t || now;
    let lo = Infinity, hi = 0; for (const q of cs) { lo = Math.min(lo, q.l); hi = Math.max(hi, q.h); } const sp = Math.max(hi - lo, lo * 0.004);
    const Yc = p => Y1 - (p - lo) / sp * (Y1 - Y0), st = (X1 - X0) / cs.length, bw = Math.max(1.4, st * 0.6);
    g.font = `700 11px ${MONO}`; g.fillStyle = '#8f90ad'; g.fillText('$BOBAI · 24H · 10-MIN CANDLES FROM THE POOL', X0, Y0 - 12);
    cs.forEach((q, i) => { const x = X0 + i * st + st / 2, flat = Math.abs(q.c - q.o) < q.o * 2e-5 && !q.n, col = flat ? 'rgba(160,162,192,.5)' : q.c >= q.o ? '#35e07a' : '#ff4d6d';
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, Yc(q.h)); g.lineTo(Math.round(x) + 0.5, Yc(q.l)); g.stroke();
      const y0 = Yc(Math.max(q.o, q.c)); g.fillStyle = col; g.fillRect(x - bw / 2, y0, bw, Math.max(1.2, Yc(Math.min(q.o, q.c)) - y0)); });
    const mi = cs.findIndex(q => q.t >= mt), mx = X0 + (mi < 0 ? cs.length - 1 : mi) * st + st / 2;
    g.strokeStyle = m.col; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(mx + 0.5, Y0 - 4); g.lineTo(mx + 0.5, Y1 + 4); g.stroke(); g.setLineDash([]);
    g.fillStyle = m.col; g.shadowColor = m.col; g.shadowBlur = 14; g.beginPath(); g.arc(mx, Y0 - 4, 5, 0, 7); g.fill(); g.shadowBlur = 0;
  }
  // footer: where to see it, and where to check this very moment
  g.font = `700 26px ${SG}`; g.fillStyle = '#F0B90B'; g.fillText('brainonbnb.com', LX, H2 - 58);
  g.font = `500 15px ${MONO}`; g.fillStyle = '#8f90ad';
  g.fillText(m.tx ? `tx ${m.tx.slice(0, 10)}…${m.tx.slice(-8)} · check it on bscscan.com` : '3% of every trade · every burn is a transaction you can check', LX, H2 - 30);
  // the glass frame of the chart view, with its line of light
  g.save(); rr(14, 14, W2 - 28, H2 - 28, 26); g.strokeStyle = 'rgba(240,185,11,.34)'; g.lineWidth = 2; g.shadowColor = 'rgba(240,185,11,.35)'; g.shadowBlur = 24; g.stroke(); g.restore();
  const topLine = g.createLinearGradient(W2 * 0.12, 0, W2 * 0.88, 0); topLine.addColorStop(0, 'rgba(240,185,11,0)'); topLine.addColorStop(0.5, 'rgba(240,185,11,.95)'); topLine.addColorStop(1, 'rgba(240,185,11,0)');
  g.fillStyle = topLine; g.shadowColor = '#F0B90B'; g.shadowBlur = 16; g.fillRect(W2 * 0.12, 13, W2 * 0.76, 3); g.shadowBlur = 0;
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return { blob, file: new File([blob], `bobai-${k}-${fmt}-${new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`, { type: 'image/png' }), text: m.text };
}
// Where it can go. The system sheet reaches every app on the device (X, Telegram, WhatsApp, Discord…);
// the direct routes save the image and open the app's own share link, since only the sheet carries files.
let card = null;
// switch the menu to another moment or format; a moment with nothing on record (no burn yet) is not offered
// the last click wins: a slower render that finishes after a newer pick is dropped
async function pickCard(motif, fmt) {
  const tok = card.tok = (card.tok || 0) + 1, m = $('shm');
  m.classList.add('busy');
  const r = await card.render(motif, fmt).finally(() => { if (tok === card.tok) m.classList.remove('busy'); });
  if (!r || tok !== card.tok) return false;
  card.motif = motif; card.fmt = fmt; card.cur = r; return true;
}
const saveImg = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(card.blob); a.download = card.file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
async function copyImg() { await navigator.clipboard.write([new ClipboardItem({ 'image/png': card.blob })]); }
const openApp = u => window.open(u, '_blank', 'noopener');
// the moment's own page on the server (its preview card is this moment), and the post text without links in it
const cardUrl = () => SITE_URL + '/m/' + (card.motif || 'now');
const bare = t => t.replace(/\s*(On-chain:\s*)?https?:\/\/\S+/g, '').trim();
const SHARE_TO = {
  // files + text only: handed a url as well, Telegram and others on iOS keep the link and drop the image (reported by
  // the operator 2026-09-26) — the link rides inside the text instead
  sheet: async () => { await navigator.share({ files: [card.file], text: card.text + ' ' + SITE_URL }); },
  // THE CARD RIDES ON THE LINK (2026-09-27): brainonbnb.com/m/<moment> is drawn by the server as the post's big
  // preview card, so X, Telegram and WhatsApp show it on every device with nothing to attach or paste. The text keeps
  // no link of its own: with two links in a post, X picks either one for the card (the bscscan one, too).
  x: () => { openApp('https://x.com/intent/post?text=' + encodeURIComponent(bare(card.text)) + '&url=' + encodeURIComponent(cardUrl())); return 'X opened — the post shows the card'; },
  telegram: () => { openApp('https://t.me/share/url?url=' + encodeURIComponent(cardUrl()) + '&text=' + encodeURIComponent(bare(card.text))); return 'Telegram opened — the message shows the card'; },
  whatsapp: () => { openApp('https://wa.me/?text=' + encodeURIComponent(bare(card.text) + ' ' + cardUrl())); return 'WhatsApp opened — the message shows the card'; },
  discord: async () => { await copyImg(); return 'image copied — paste it into any Discord channel with Ctrl+V'; },
  copy: async () => { await copyImg(); return 'image copied to the clipboard'; },
  save: () => { saveImg(); return 'image saved'; },
};
let shotUrl = null;
function shareMenu(show) {
  const m = $('shm'); m.classList.toggle('on', show);
  if (!show) return;
  m.querySelector('[data-to="sheet"]').hidden = !navigator.canShare?.({ files: [card.file] });
  const cp = !!(window.ClipboardItem && navigator.clipboard?.write);
  m.querySelector('[data-to="discord"]').hidden = !cp; m.querySelector('[data-to="copy"]').hidden = !cp;
  m.querySelectorAll('[data-fmt]').forEach(b => b.classList.toggle('on', b.dataset.fmt === card.fmt));
  m.querySelectorAll('[data-motif]').forEach(b => { b.classList.toggle('on', b.dataset.motif === card.motif); b.hidden = (b.dataset.motif === 'burn' && !S.burns.length) || (b.dataset.motif === 'liq' && !S.liq.length); });
  m.classList.toggle('tall', card.fmt === 'tall');
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  m.querySelector('img').src = shotUrl = URL.createObjectURL(card.blob);
}
$('shm').addEventListener('click', async e => {
  const m = $('shm'), fm = e.target.closest('[data-fmt], [data-motif]');
  if (fm) {
    // the wish is taken at the click, not when its render lands: a format picked while a moment is still
    // rendering is kept for the next pick instead of being overwritten by the one before it
    const want = card.want = { motif: fm.dataset.motif || card.want.motif, fmt: fm.dataset.fmt || card.want.fmt };
    m.querySelectorAll('[data-fmt]').forEach(b => b.classList.toggle('on', b.dataset.fmt === want.fmt));
    m.querySelectorAll('[data-motif]').forEach(b => b.classList.toggle('on', b.dataset.motif === want.motif));
    if (await pickCard(want.motif, want.fmt)) shareMenu(true);
    return;
  }
  const b = e.target.closest('[data-to]'); if (!b) { if (e.target.closest('.shx')) shareMenu(false); return; }
  try { const msg = await SHARE_TO[b.dataset.to](); if (msg) logLine('SHARE', '#F0B90B', [msg]); shareMenu(false); }
  catch (err) { if (err?.name !== 'AbortError') logLine('SHARE', SELLC, ['that route did not work here — try "save image"']); }
});
$('shr').onclick = shareCard;

const cmdForm = $('cmd'), cmdIn = $('cmdIn');
// opening the log lands on the newest lines
logEl.closest('.term').addEventListener('pointerenter', () => setTimeout(() => { logEl.scrollTop = logEl.scrollHeight; }, 380));
// BACK TO THE LIVE END (operator, 2026-10-02: "open the log and close it again, it sits in the middle and no longer goes
// down to where it is live"): the log grows when opened and shrinks when closed, and its scroll position stayed counted
// from the top — closed, it showed the middle, and no longer counted as 'at the end', so new lines stopped pulling it
// down. Now closing always returns to the newest line, and while it follows, any change of size keeps it there.
logEl.addEventListener('scroll', () => { logFollow = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60; }, { passive: true });
if (window.ResizeObserver) new ResizeObserver(() => { if (logFollow) logEl.scrollTop = logEl.scrollHeight; }).observe(logEl);
{
  const term = logEl.closest('.term'), toEnd = () => { if (term.matches(':hover,:focus-within')) return; logFollow = true; logEl.scrollTop = logEl.scrollHeight; };
  term.addEventListener('pointerleave', () => { setTimeout(toEnd, 50); setTimeout(toEnd, 420); }); // and once the closing has settled
  term.addEventListener('focusout', () => { setTimeout(toEnd, 50); setTimeout(toEnd, 420); });
}
cmdForm.addEventListener('submit', e => {
  e.preventDefault();
  const q = cmdIn.value.trim(); if (!q) return; cmdIn.value = '';
  logLine('YOU', '#eceaf5', [q]).classList.add('wrap');
  const h = q.match(TXHASH);
  if (h) { const x = S.hist.find(e => e.tx.toLowerCase() === h[0].toLowerCase() && !e.taxSwap) || S.hist.find(e => e.tx.toLowerCase() === h[0].toLowerCase()); if (x) return followTrade(x);
    return tradeFromTx(h[0]).then(t => t ? followTrade(t) : say(['that transaction has no BOBAI trade in it. Try ', ['follow'], ' for the latest.'])).catch(() => say(['could not read that transaction right now — try again in a moment.'])); }
  const a = q.match(ADDR);
  if (a) return check(a[0]);
  const w = intentOf(q);
  if (w && !['help', 'hi', 'thanks', 'who', 'joke'].includes(w) && !S.burns.length) return say(['still reading the chain — ask again in a few seconds.']);
  if (w) { ASK.hit++; const r = CMDS[w](q); if (r !== false) speakAnswer(w); } else missed(q); // false: it answered "still reading"
});
cmdIn.addEventListener('focus', () => win.classList.add('typing'));
cmdIn.addEventListener('blur', () => setTimeout(() => win.classList.remove('typing'), 200));

// ================= live data =================
const bobOf = e => +(e.bob || e.bobBurned) || 0;
// Every headline figure comes from the homepage (app.js publishes window.__bobaiNums on each refresh):
// the same reads, the same windows, the same rounding. The terminal's own reads are only the fallback.
const NUMS = () => window.__bobaiNums || {};
const pcEdge = v => v == null ? '—' : v > 0 && v < 0.001 ? '<0.001%' : (v >= 99.9995 && v < 100) ? '>99.999%' : v.toFixed(3) + '%';
const supplyPct = v => (v / 1e9 * 100).toFixed(1);
const lpText = () => NUMS().lpLocked || (S.lpPct ? pcEdge(S.lpPct) : '…');
const BB3_FALLBACK = { start: Date.parse('2026-09-19T18:00:00Z'), end: GIGGLE_DAY };
function boost3() {
  const w = NUMS().bb3 || BB3_FALLBACK, list = S.liq.filter(l => { const t = Date.parse(l.time); return t >= w.start && t < w.end; });
  const b = NUMS().bb3;
  return { list, n: b ? b.count : list.length, bnb: b ? b.bnb : list.reduce((a, l) => a + (parseFloat(l.bnb) || 0), 0), lp: b ? b.lp : list.reduce((a, l) => a + (parseFloat(l.lpBurned) || 0), 0) };
}
const ggBnb = () => NUMS().gg ? NUMS().gg.bnb : S.burns.filter(e => e.giggleTx).reduce((a, e) => a + (parseFloat(e.giggleBnb) || 0), 0);
const ggEnd = () => NUMS().gg?.end || GIGGLE_DAY;
const pctOf = k => (D[k] && D[k].pct != null ? D[k].pct : 0) + '%';
const S = { hist: [], taxSw: new Map(), dev: [], price: 0, bnbP: 0, bobP: 0, queued: 0, walletBnb: 0, lastRunBnb: 0.07, burns: [], liq: [], man: [], lp: null, nft: null, block: 0, token0IsBobai: true };
// The homepage's last read when it is fresh (it refreshes every 30 s); a read of our own otherwise.
async function chain() {
  const n = NUMS().chain;
  if (n && Date.now() - n.at < 60e3) {
    if (!S.block) { const [b] = await rpc([['eth_blockNumber', []]]); S.block = parseInt(b, 16); }
    return takeChain({ at: n.at, bnbP: n.bnbUsd, price: n.priceUsd, bobP: n.bobUsdPrice, bobDead: n.bobDead, bobaiDead: n.bobaiDead, queued: n.queuedBobai, walletBnb: n.walletBnb, lpPct: NUMS().lpPct ?? S.lpPct, minD: n.minDispatch });
  }
  const q = await rpc([
    ['eth_getBalance', [BW, 'latest']], call(WBNB, balOf(BW)), call(BOB, DEAD_BAL), call(BOBAI, DEAD_BAL),
    call(P, '0x0902f1ac'), call(P, '0x0dfe1681'), call(BOBAI, balOf(BOBAI)), call(P, '0x18160ddd'), call(P, DEAD_BAL),
    call(BNBFEED, '0x50d25bcd'), call(BOBP, '0x0902f1ac'), ['eth_blockNumber', []], call(BOBAI, '0x110395bd'),
  ]);
  const bnbP = Number(BigInt(q[9])) / 1e8;
  const rH = q[4], r0 = BigInt('0x' + rH.slice(2, 66)), r1 = BigInt('0x' + rH.slice(66, 130));
  S.token0IsBobai = ('0x' + q[5].slice(26).toLowerCase()) === BOBAI;
  const bR = S.token0IsBobai ? r0 : r1, wR = S.token0IsBobai ? r1 : r0;
  const h = q[10], h0 = BigInt('0x' + h.slice(2, 66)), h1 = BigInt('0x' + h.slice(66, 130));
  if (!S.block) S.block = parseInt(q[11], 16);
  takeChain({ bnbP, price: Number(wR) / Number(bR) * bnbP, bobP: Number(h1) / Number(h0) * bnbP, bobDead: u18(q[2]), bobaiDead: u18(q[3]),
    queued: u18(q[6]), walletBnb: u18(q[0]) + u18(q[1]), lpPct: Number(BigInt(q[8])) / Number(BigInt(q[7])) * 100, minD: q[12] ? u18(q[12]) : 0 });
}
function takeChain({ at = Date.now(), bnbP, price, bobP, bobDead, bobaiDead, queued, walletBnb, lpPct, minD }) {
  if (minD > 0) MIN_DISPATCH = minD;
  // a price older than the one the last trade's Sync gave (the homepage's numbers can be a minute old) does not win
  const newer = !(S.priceAt > at);
  if (price > 0 && newer) { LIFE.prices.push([Date.now(), price]); if (LIFE.prices.length > 400) LIFE.prices.shift(); }
  S.bnbP = bnbP; if (newer || !(S.price > 0)) { S.price = price; S.priceAt = at; } CH.dirty = true; S.bobP = bobP; S.deadB = bobDead; S.queued = queued; S.walletBnb = walletBnb;
  // a burn that lands while the page is open rolls the counter up instead of jumping
  if (S.deadA && bobaiDead > S.deadA) roll(D.burnA.el.querySelector('.v'), S.deadA, bobaiDead, v => burnAText(v));
  S.deadA = bobaiDead;
  paintBobai();
  paintBob();
  const queuedUsd = S.queued * S.price + splitBnb() * bnbP;
  coreLab.querySelector('.v').textContent = '$' + nf(queuedUsd, 2);
  coreLab.querySelector('.s').innerHTML = `<span>${nf(S.queued)} BOBAI tax</span>` + (splitBnb() > 0 ? ` <span>+ ${splitBnb().toFixed(4)} BNB to split</span>` : S.queued >= MIN_DISPATCH ? ' <span>full · swaps inside a next trade</span>' : ''); // two lines, not wrapped at random ("…0.0031 / BNB", 2026-09-28)
  charge = splitBnb() > 0 ? 1 : clamp(S.queued / MIN_DISPATCH, 0, 1); // BNB ready in 1ce = split at the next check
  S.lpPct = lpPct;
  paintLogs();
}
function paintBob() {
  if (!S.deadB) return;
  if (!S.burns.length) return setDest('burnB', cmp(S.deadB) + ' BOB', 'at the dead address · reading the bot log…');
  const ours = S.burns.reduce((a, e) => a + bobOf(e), 0);
  setDest('burnB', cmp(ours) + ' BOB', `burned by BOBAI's bot · ${(ours / S.deadB * 100).toFixed(1)}% of all ${cmp(S.deadB)} BOB burned · ≈$${nf(ours * S.bobP)}`);
}
// BOBAI at the dead address includes the burn at launch; the bot's own part is said beside it
// a phone row has no room for nine digits: the same figure, compact (115.41M); the full one sits in the detail panel
const burnAText = v => (portrait ? cmp(v) : nf(v)) + ' BOBAI';
function paintBobai() {
  if (!S.deadA) return;
  const bot = S.burns.reduce((a, e) => a + (+e.bobaiBurned || 0), 0);
  setDest('burnA', burnAText(S.deadA), `${(S.deadA / 1e9 * 100).toFixed(1)}% of supply gone · ≈$${nf(S.deadA * S.price)}` + (bot ? ` · ${cmp(bot)} by the bot` : ''));
}
function paintLogs() {
  paintBob(); paintBobai();
  const boost = boost3();
  if (S.liq.length) setDest('liq', `${boost.n} adds · ${bnb4(boost.bnb)}`, `${nf(boost.lp, 2)} LP burned · pool ${lpText()} locked`);
  if (S.burns.length) {
    const gg = ggBnb(), days = Math.max(0, Math.ceil((ggEnd() - Date.now()) / 86400e3));
    setDest('giggle', bnb4(gg), GIGGLE_OPEN() ? `≈$${nf(gg * S.bnbP, 2)} · for Giggle Academy in ${days} days` : 'donated to Giggle Academy on Nov 20');
    const cr = S.burns.slice(-1)[0];
    const dv = S.dev[S.dev.length - 1];
    setDest('creator', pctOf('creator') + ' of each trade', (cr ? `last in: ${bnbF(cr.creatorBnb)}` : '') + (dv ? ` · d38 paid out ${bnbF(dv.availableBnb)}` : ''));
  }
  const lp = S.lp;
  if (lp) {
    const rb = lp.last?.steps?.rebalance, inc = lp.last_check?.steps?.increase;
    const v = lpNow().value, inr = lpNow().inR;
    if (v) setDest('defi', bnbF(v) + ' working', `${inr === false ? 'OUT of range' : 'in range'} · holds ${cmp(lp.flow?.out?.bobai_units || 0)} BOBAI`);
  }
}
async function logs() {
  const N = NUMS(), have = x => Promise.resolve(x);
  const [burns, liq, lp, nft, dev, man] = await Promise.allSettled([N.burns ? have(N.burns) : getJSON(SITE + '/logs/burns.json'), N.liq ? have(N.liq) : getJSON(SITE + '/logs/bobai-liq-log.json'), getJSON(AG + '/lp/agent'), getJSON(SITE + '/api/nft/state'), getJSON(SITE + '/logs/dev-buyback-log.json'), getJSON(SITE + '/liq-runs.json')])
    .then(r => r.map(x => x.status === 'fulfilled' ? x.value : null));
  if (burns) { S.burns = burns; S.lastRunBnb = +burns[burns.length - 1].totalBnb || S.lastRunBnb; }
  if (liq) S.liq = liq; if (lp) S.lp = lp; if (nft) S.nft = nft; if (dev) S.dev = dev;
  if (nft && !EXACT._run) { EXACT._run = 1; setTimeout(async () => { for (const n of (S.nft?.drops || []).filter(d => d.ts * 1000 > Date.now() - 7 * 86400e3)) await exactBuyUsd(n); }, 6000); }
  // THE DEV WALLET'S OWN ADDS (2026-09-30, operator: "show them"): the manual runs from d38 (liq-runs.json, the same file
  // the Classic liquidity block reads) — the biggest liquidity of most weeks, and the film showed only the bot's small ones.
  // Kept apart from S.liq, which stays the bot's (its counts, Liq Boost III, the share card)
  if (Array.isArray(man?.runs)) S.man = man.runs.map(r => ({ time: r.time, bnb: r.bnb, bobai: r.bobai, lpBurned: r.lp, addLiqTx: r.addLiqTx, lpBurnTx: r.lpBurnTx, dev: true }));
  paintLogs();
  return buildEvents();
}

// ---------- events (what happened, from the logs) ----------
function buildEvents() {
  const ev = [], liq = [...S.liq];
  for (const e of S.burns) {
    const t = Date.parse(e.time), li = liq.findIndex(l => Math.abs(Date.parse(l.time) - t) < 20 * 60e3);
    ev.push({ id: 'r' + e.time, t, kind: 'run', e, l: li >= 0 ? liq.splice(li, 1)[0] : null });
  }
  for (const l of liq) ev.push({ id: 'l' + l.time, t: Date.parse(l.time), kind: 'liq', l });
  for (const l of S.man) ev.push({ id: 'm' + l.time, t: Date.parse(l.time), kind: 'liq', l });
  const STEP = { collect: 'collected its pool fees', increase: 'put new capital to work', rebalance: 'moved its range to the price', ladder: 'reset its reserve range', sweep: 'swept payments in' };
  // a run that acted stands in the history AND is the last check until the next look (up to ten minutes): once, not twice
  // (2026-10-05: its scene, log line and mark came double in that window)
  const lpSeen = new Set();
  for (const r of [...(S.lp?.history || []), ...(S.lp?.last_check ? [S.lp.last_check] : [])]) {
    if (r.dry || lpSeen.has(r.at)) continue; lpSeen.add(r.at);
    for (const [k, v] of Object.entries(r.steps || {})) for (const s of (Array.isArray(v) ? v : [v]))
      if (s?.acted && STEP[k]) ev.push({ id: 'd' + r.at + k + (s.source || ''), t: Date.parse(r.at) + 5, kind: 'defi', step: STEP[k], key: k, s });
  }
  // ONE RUN, ONE SCENE (2026-10-05, operator: "the DeFi agent only ONE animation when it buys and new capital at work"):
  // the daily run often collects its fees (half buys BOBAI) AND puts new capital to work in the same pass — two boards
  // and two clips back to back; the same with a range move or a reserve reset. The capital rides on the run's main step
  // (x.also): one board with a NEW CAPITAL row, one clip, both log lines
  for (const c of ev.filter(x => x.kind === 'defi' && x.key !== 'increase')) {
    const i = ev.findIndex(y => y.kind === 'defi' && y.key === 'increase' && y.t === c.t);
    if (i >= 0) { c.also = ev[i].s; ev.splice(i, 1); }
  }
  // THE BUYBACK'S SHARE COMES AFTER THE BUYBACK (2026-10-03, operator: "NEW CAPITAL AT WORK twice, at the last one"): a
  // run's time is when it ENDS, its DeFi share lands mid-run and the agent can put it to work before that (3.10.: agent
  // 14:21:11, run 14:21:19) — the film showed the capital before its own burn, right after the previous capital board
  for (const x of ev) if (x.kind === 'defi' && x.key === 'increase') {
    const r = ev.find(y => y.kind === 'run' && y.e.lpAgentTx && y.t > x.t && y.t - x.t < 3 * 60e3);
    if (r) x.t = r.t + 5;
  }
  for (const n of S.nft?.drops || []) ev.push({ id: 'n' + n.tokenId, t: n.ts * 1000, kind: 'nft', n });
  // d38's hourly payout of the creator share. Amounts only: the payout transactions lead to personal wallets.
  // a swap sent by one of our wallets is BOBAI acting (buyback or tax swap), not a trader
  // the pool's swaps, read from the chain itself (backfill): no third-party API between the page and the pool
  // swaps on screen = the Telegram alerts (buys of $100 and more, the bot's own threshold) and BOBAI's own swaps;
  // every swap still feeds the pulse line of the timeline (S.hist), so the market's activity stays visible
  // a buy of $100+ mints an NFT (same threshold as the alert): the drop IS that buy, with its card; the swap of
  // the same transaction is not shown twice. The drops also reach back further than the free nodes' logs.
  const dropped = new Set((S.nft?.drops || []).map(n => (n.buyTx || '').toLowerCase()).filter(Boolean));
  for (const x of S.hist) if (isAlert(x) && !(x.buy && dropped.has(x.tx.toLowerCase()))) ev.push(x);
  for (const d of S.dev) if (+d.availableBnb > 0) ev.push({ id: 'v' + d.time, t: Date.parse(d.time), kind: 'dev', d });
  return ev.filter(x => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
}

// ---------- playing an event ----------
function run(x, fast) {
  // only a fresh one is announced as happening now: a moment reopened from the list (replayMoment) is shown, not re-announced
  if (mode === 'live' && !REOPEN && (x.kind === 'run' || x.kind === 'liq')) { lastMoment = { kind: x.kind === 'run' ? 'burn' : x.l?.dev ? 'now' : 'liq', t: Date.now() }; react(x.kind, x.kind === 'run' ? x.e : x.l); }
  const gap = fast ? 420 : 1000;
  if (x.kind === 'run') {
    const e = x.e;
    fire(A.core, new THREE.Color('#F0B90B'));
    moment('burn', burnUsd(e), flipBurn(e, x.l), x.t, fast, null);
    logLine('SPLIT', '#F0B90B', ['bot split ', [bnbF(e.totalBnb)], ' of collected tax'], [], x.t);
    const steps = [
      ['burnA', 'burn', () => { floatAt(D.burnA.pos, '-' + cmp(e.bobaiBurned) + ' BOBAI', D.burnA.c); logLine('BURN', D.burnA.c, ['burned ', [bobaiAmt(e.bobaiBurned)]], [['burn', e.bobaiBurnTx]], x.t); }],
      ['burnB', 'burn', () => { floatAt(D.burnB.pos, '-' + cmp(bobOf(e)) + ' BOB', D.burnB.c); logLine('BURN', D.burnB.c, ['burned ', [cmp(bobOf(e)) + ' BOB']], [['burn', e.bobBurnTx || e.burnTx]], x.t); }],
      ...(x.l ? [['liq', 'liq', () => { floatAt(D.liq.pos, '+' + nf(x.l.lpBurned, 1) + ' LP burned', D.liq.c); logLine('LIQ', D.liq.c, [[bnbF(x.l.bnb)], ' to liquidity: half bought ', [bobaiAmt(x.l.bobaiBought)], ', paired with the other half · LP burned'], [['add', x.l.addLiqTx], ['LP', x.l.lpBurnTx]], x.t); }]] : []),
      ...(e.lpAgentTx ? [['defi', 'defi', () => { floatAt(D.defi.pos, '+' + bnbF(e.lpAgentBnb), D.defi.c); logLine('DEFI', D.defi.c, ['agent got ', [bnbF(e.lpAgentBnb)]], [['tx', e.lpAgentTx]], x.t); }]] : []),
      ...(e.giggleTx ? [['giggle', 'giggle', () => { floatAt(D.giggle.pos, '+' + bnbF(e.giggleBnb), D.giggle.c); logLine('GIGGLE', D.giggle.c, ['pot got ', [bnbF(e.giggleBnb)]], [['tx', e.giggleTx]], x.t); }]] : []),
      ...(e.creatorTx ? [['creator', null, () => { floatAt(D.creator.pos, '+' + bnbF(e.creatorBnb), D.creator.c); }]] : []),
    ];
    steps.forEach(([k, p, done], i) => setTimeout(() => {
      // he stays in his burn pose: a pose per station read as jumping from motif to motif (operator, 2026-09-25)
      D[k].boost = 1;
      comet(A.core, D[k].pos, D[k].c, fast ? 0.7 : 1.1, () => { hitDest(k); done(); });
    }, gap * (i + 0.6)));
  } else if (x.kind === 'liq') {
    boardScene(x.t, D.liq.c, 'liq', x.l.dev ? 'THE DEV WALLET ADDS LIQUIDITY' : 'BOBAI ADDS LIQUIDITY', 'LIQUIDITY ADDED', flipLiq(x.l), 6.5); D.liq.boost = 1;
    comet(A.core, D.liq.pos, D.liq.c, 1, () => { hitDest('liq'); floatAt(D.liq.pos, '+' + nf(x.l.lpBurned, 1) + ' LP', D.liq.c); });
    if (x.l.dev) logLine('LIQ', D.liq.c, ['dev wallet d38 added ', [bnbF(x.l.bnb)], ' + ', [bobaiAmt(x.l.bobai)], ' to the pool · LP burned'], [['add', x.l.addLiqTx], ['LP', x.l.lpBurnTx]], x.t);
    else logLine('LIQ', D.liq.c, [[bnbF(x.l.bnb)], ' to liquidity: half bought ', [bobaiAmt(x.l.bobaiBought)], ', paired with the other half · LP burned'], [['add', x.l.addLiqTx]], x.t);
  } else if (x.kind === 'defi') {
    defiScene(x, fast); sayMore('defi-' + x.key, x);
    const fees = x.s.produced_bnb ? ` ${bnbF(x.s.produced_bnb)}` : '';
    if (fees) floatAt(D.defi.pos, '+' + fees.trim(), D.defi.c);
    logLine('DEFI', D.defi.c, ['agent ', [x.step], fees], (x.s.txs || []).slice(0, 2).map(t => ['tx', t.hash]), x.t);
    if (x.also) logLine('DEFI', D.defi.c, ['agent ', ['put new capital to work'], ' ' + bnbF(capOf(x.also))], (x.also.txs || []).slice(0, 2).map(t => ['tx', t.hash]), x.t);
  } else if (x.kind === 'trade') {
    const col = x.ours ? '#F0B90B' : x.buy ? BUYC : SELLC;
    if (x.ours) { fire(A.core, new THREE.Color(col)); logLine('BOBAI', col, [whoTraded(x), [x.buy ? 'bought' : 'sold'], ' $' + nf(x.usd, 2) + ' of BOBAI'], [['tx', x.tx]], x.t); }
    else if (!(x.buy && x.usd >= ALERT_USD)) tradeDot(x); // under the alert line, or a sell: the dot alone, as live
    else {
      const big = clamp(Math.sqrt(x.usd) / 6, 0.6, 2.2);
      const [dc, dk] = dotOf(x.buy); comet(A.src, A.core, dc, fast ? 0.9 : 1.2, () => { fire(A.core, new THREE.Color(dc)); floatAt(A.core, '+$' + nf(x.usd * 0.03, 2) + ' tax', '#F0B90B'); }, big * dk);
      floatAt(A.src, (x.buy ? '▲ $' : '▼ $') + nf(x.usd, x.usd < 10 ? 2 : 0), col);
      logLine(x.buy ? 'BUY' : 'SELL', col, ['$' + nf(x.usd, x.usd < 10 ? 2 : 0) + (x.buy ? ' bought' : ' sold') + ' · 3% tax ', ['$' + nf(x.usd * 0.03, 2)]], [['tx', x.tx]], x.t);
      if (x.buy && x.usd >= ALERT_USD) {
        const wait = false; // the buy shows at once; its NFT follows as a card of its own (operator, 2026-09-28)
        nextMintX = wait ? x : null;
        const shown = moment('buy', x.usd, flipBuy(x.usd, x.drop || null, x.t), x.t, fast, x.drop ? nftCard(x.drop) : wait ? 'wait' : null, undefined, x.drop ? { n: x.drop } : undefined);
        if (shown && mode === 'live' && !REOPEN) react('buy', x); // held by speak() until his move starts: line and move together
      }
    }
  } else if (x.kind === 'dev') {
    const d = x.d, tot = +d.availableBnb;
    D.creator.boost = 1; hitDest('creator');
    const out = D.creator.pos.clone().add(new THREE.Vector3(portrait ? 0 : 2.2, portrait ? -1.2 : -0.3, 0));
    comet(D.creator.pos, out, D.creator.c, 1.2);
    floatAt(D.creator.pos, '-' + bnbF(tot), D.creator.c);
    logLine('d38', D.creator.c, ['dev bot paid out ', [bnbF(tot)], ' of the creator share'], [], x.t); // no split to builders: those are personal payouts
    sayMore('dev', x);
  } else if (x.kind === 'nftcard') {
    nftReveal(x.n); sayMore('nft', x);
    logLine('NFT', '#a78bfa', [`${$buy(nUsd(x.n), x.n)} buy → NFT `, ['#' + x.n.tokenId], ` ${TIERS[x.n.tier] || ''}`], [['mint', x.n.mintTx || x.n.tx]]);
  } else if (x.kind === 'nft') {
    const n = x.n;
    moment('buy', nUsd(n) || 100, flipBuy(nUsd(n) || 100, n, x.t), x.t, fast, nftCard(n), undefined, { n });
    comet(A.src, A.core, '#a78bfa', 1, () => fire(A.core, new THREE.Color('#a78bfa')));
    logLine('NFT', '#a78bfa', [`${$buy(nUsd(n), n)} buy → NFT `, ['#' + n.tokenId], ` ${TIERS[n.tier] || ''}`], [['mint', n.mintTx || n.tx]], x.t);
  }
}

// ---------- the big moments: every alert tier gets its own scene (2026-09-25) ----------
// The TG bot's own ladder (worker-tg-bot getBuyEmojis/getBurnEmojis, KRAKEN_USD 2500, SUPERNOVA_USD 250), the
// same bars (1 brain = $10 bought, 1 flame = $2 burned), and a clip of BOBAI for each tier. The scene: film bars
// slide in, the tier title lands, the bar fills icon by icon, BOBAI plays the tier, the brain flashes in the
// tier's colour. Small tiers pass lightly; the big ones take the screen for a few seconds.
const BUY_TIERS = [[2500, 'buy-kraken', 'KRAKEN BUY', '#a78bfa', 3], [1000, 'buy-thunder', 'THUNDER BUY', '#facc15', 3], [500, 'buy-whale', 'WHALE BUY', '#60a5fa', 2],
  [250, 'buy-huge', 'HUGE BUY', '#fb923c', 2], [150, 'buy-big', 'BIG BUY', '#7dd3fc', 1], [0, 'buy-nice', 'NICE BUY', '#86efac', 0]];
const BURN_TIERS = [[250, 'burn-supernova', 'SUPERNOVA BURN', '#e879f9', 3], [150, 'burn-apocalypse', 'APOCALYPSE BURN', '#fb7185', 3], [50, 'burn-mega', 'MEGA BURN', '#ef4444', 2],
  [15, 'burn-big', 'BIG BURN', '#f97316', 1], [5, 'burn-nice', 'NICE BURN', '#fbbf24', 1], [0, 'burn-small', 'BURN', '#fdba74', 0]];
const tierOf = (list, usd) => list.find(t => usd >= t[0]);
// THE BUY'S TIER IS THE ONE MINTED (2026-09-30, operator: "a $249.62 BIG BUY in TG showed as a HUGE BUY in the terminal"):
// the NFT log keeps the buy's dollars rounded (worker-nft-mint: Math.round -> 250) but its tier as minted (1 = BIG, the
// same the TG alert showed). A buy with an NFT takes the NFT's tier; only a buy without one is tiered by its dollars.
const buyTierOf = (usd, n) => (n && TIERS[n.tier] && BUY_TIERS.find(t => t[2] === TIERS[n.tier])) || tierOf(BUY_TIERS, usd);
// and its exact dollars the way TG counts them: the WBNB that went in (per transaction) x Chainlink BNB/USD at that block
const nUsd = n => n ? (n.usdExact ?? +n.usd ?? 0) : 0;
const $buy = (u, n) => (n && n.usdApprox ? '≈ ' : '') + '$' + nf(u, u >= 100 && Math.abs(u - Math.round(u)) > 0.004 ? 2 : 0);
async function exactBuyUsd(n) {
  if (!n || !n.buyTx || n.usdExact != null || EXACT[n.buyTx]) return;
  // since 1790791236 (worker-nft-mint de4c5771, 2026-09-30) the NFT log keeps the dollars with cents, as TG counted them: exact already
  if (n.ts >= 1790791236 || Math.abs(+n.usd - Math.round(+n.usd)) > 0.004) return;
  EXACT[n.buyTx] = 1;
  try { const c = localStorage.getItem('bt-usd-' + n.buyTx); if (c) { const [u, ap] = c.split('|'); n.usdExact = +u; n.usdApprox = ap === '~'; return; } } catch {}
  try {
    const [rc] = await rpc([['eth_getTransactionReceipt', [n.buyTx]]]); if (!rc) return;
    const sws = (rc.logs || []).filter(l => l.address.toLowerCase() === P && l.topics[0] === SWAP); if (!sws.length) return;
    const bnb = foldBuys(sws.map(l => swapOf(l, n.ts * 1000))).filter(x => x.buy && !x.taxSwap).reduce((a, x) => a + (x.bnb || 0), 0);
    // Chainlink at the buy's block — public nodes keep no old state ("missing trie node" after ~2 h): then the candle
    // ledger's BNB price of that hour (also Chainlink, read every 10 min), and the figure is marked as approximate
    let px = 0; try { const [a] = await rpc([['eth_call', [{ to: BNBFEED, data: '0x50d25bcd' }, rc.blockNumber]]]); px = a ? Number(BigInt(a)) / 1e8 : 0; } catch {}
    if (!(px > 0)) { px = bnbUsdAt(n.ts * 1000); n.usdApprox = true; }
    if (!(bnb > 0 && px > 0)) return;
    n.usdExact = Math.round(bnb * px * 100) / 100; n.bnbIn = bnb;
    try { localStorage.setItem('bt-usd-' + n.buyTx, n.usdExact + (n.usdApprox ? '|~' : '')); } catch {}
  } catch {}
}
window.__btExact = async tx => { const n = (S.nft?.drops || []).find(d => (d.buyTx || '').toLowerCase().startsWith(tx.toLowerCase())); if (!n) return null; await exactBuyUsd(n); return [n.usd, n.usdExact, TIERS[n.tier], buyTierOf(nUsd(n), n)?.[2]]; }; // for checks from outside
// A BURN'S DOLLARS AS THE TELEGRAM ALERT HAD THEM (2026-09-29): the alert prices the BOBAI that reached the dead address at
// the pool's price then (worker-tg-bot postBurnAlert). The BNB the bot spent is ~3% more (its buy pays the tax too), so a
// $14.63 burn read as BIG here and NICE in Telegram. The price then comes from the candle ledger (~4 days); an older run
// is priced from its BNB, less that 3%, at today's BNB price.
// BOBAI, BNB AND DOLLARS IN ONE LINE (2026-09-30, operator: "on hover the amount of BOBAI, BNB and the USD value"): a
// past event in dollars at the BNB price of its own hour (the candle ledger's u), not today's
const bnbUsdAt = t => { const r = CH.rows.find(r => r.t >= t && r.t - t <= 60 * 60e3) || [...CH.rows].reverse().find(r => r.t <= t); return (r && r.u > 0 ? r.u : 0) || S.bnbP || 0; };
const $amt = u => '$' + nf(u, u < 10 ? 2 : 0);
const tradeAmt = x => [x.bobai > 1 ? cmp(x.bobai) + ' BOBAI' : null, x.bnb > 0 ? bnbF(x.bnb) : null, x.usd > 0 ? $amt(x.usd) : null].filter(Boolean).join(' · ');
const bnbAmt = (b, t) => { b = +b || 0; const u = b * bnbUsdAt(t); return bnbF(b) + (u > 0 ? ' · ' + $amt(u) : ''); };
const burnUsd = e => { const t = Date.parse(e.time), r = CH.rows.find(r => r.t >= t && r.t - t <= 30 * 60e3);
  return r && r.c > 0 && r.u > 0 ? (+e.bobaiBurned || 0) * r.c * r.u : (+e.bobaiBurnBnb || 0) * 0.97 * S.bnbP; };
const momentEl = document.createElement('div'); momentEl.className = 'moment';
momentEl.innerHTML = '<i class="lb t"></i><i class="lb b"></i><div class="mc"><div class="k"></div><div class="h"></div><div class="s"></div></div><div class="bar"></div><div class="card" hidden><img alt=""><b>NFT DROP</b></div>';
win.appendChild(momentEl);
let momentUntil = 0, momentTimer = 0;
// the NFT card of a drop: the site's own card images, tier x rarity (worker-nft-meta TIER_INFO / RARITY_INFO)
const NFT_TIER_SLUG = ['nice-buy', 'big-buy', 'huge-buy', 'whale-buy', 'thunder-buy', 'kraken-buy'];
const NFT_RARITY_SLUG = ['common', 'uncommon', 'rare', 'mythical', 'legendary', 'ancient', 'immortal'];
const nftCard = n => NFT_TIER_SLUG[n.tier] && NFT_RARITY_SLUG[n.rarity] ? `https://brainonbnb.com/nft/cards/${NFT_TIER_SLUG[n.tier]}-${NFT_RARITY_SLUG[n.rarity]}.jpg` : null;
// THE NFT STICKER (operator, 2026-09-28: "much nicer and bigger, top left corner of the window, over the frame, like a
// sticker that marks the buy"). It hangs on the window's top-left corner, over the frame. A live buy opens its window at
// once with a glowing MINTING card there; the window stays until the NFT is minted (worker-nft-mint, once a minute, max
// ~100 s), then the real card slaps on and the window closes a few seconds later.
const stk = document.createElement('div'); stk.className = 'bt-stk'; stk.hidden = true;
stk.innerHTML = '<div class="st-c"><img alt="NFT card"><i class="st-w">MINTING…</i></div><b>NFT DROP</b>';
// it sits on the buy board's top-left corner (operator, 2026-09-28: "at the buy alert, not the outer frame"); the board
// is made further down, so the sticker joins it when first shown
let mintWaitX = null, nextMintX = null;
// A FREE PLACE FOR A CARD (2026-10-01): the first spot of a search list that covers no visible text, none of the given
// rects, and stays inside the window. Shared by the card on the buy board and the NFT scene's big card.
// the LETTERS, not the boxes (2026-10-01): a title's box spans the whole window while its words sit in the middle — the
// box kept the card off the board's top edge everywhere; the rects of the text lines themselves are what may not be covered
function textRects(skip) {
  const out = [], rg = document.createRange();
  for (const e of win.querySelectorAll('*')) {
    if ((skip && skip.contains(e)) || e.closest('#bt-labs .wk')) continue;
    const tn = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 1); if (!tn.length) continue;
    // the board's and the title's words count while they still fade in (1366 px: placed during the fade, it sat on the rows)
    const own = flipEl.contains(e) || momentEl.contains(e);
    if (!own && (e.checkVisibility ? !e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : getComputedStyle(e).display === 'none')) continue; // a hidden parent hides it too
    if (own && getComputedStyle(e).display === 'none') continue;
    for (const n of tn) { rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.width > 0) out.push(r); }
  }
  return out
    // the scene's own labels (trades, the six places, the core) count even while they fade in: they show again under it
    .concat([...win.querySelectorAll('#bt-labs .lab:not(.wk)')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0));
}
function freeSpot(sw, sh, tries, busy, pad = 6) {
  const W = win.getBoundingClientRect();
  const free = (x, y) => x >= W.left + pad && y >= W.top + pad && x + sw <= W.right - pad && y + sh <= W.bottom - pad
    && !busy.some(r => r.right > x - pad && r.left < x + sw + pad && r.bottom > y - pad && r.top < y + sh + pad);
  for (const [x, y] of tries) if (free(x, y)) return { left: Math.round(x - W.left), top: Math.round(y - W.top) };
  return null;
}
const faceOf = fr => fr && fr.width ? { left: fr.left + fr.width * 0.18, right: fr.right - fr.width * 0.18, top: fr.top, bottom: fr.top + fr.height * 0.42 } : null;
// THE CARD ON THE BOARD'S TOP EDGE (operator, 2026-10-01: "in the replay the NFT comes with the buy — that makes sense; put
// the card in the buy window, in the middle of its top edge"; first it sat on the corner over THIS BUY, BOUGHT and TAX,
// then for an hour in the window's middle): centred on the board's top edge, tilted, 8% bigger, as far down onto the
// board as its words allow; when the edge is taken, the nearest free spot. The orbit's bot labels step aside (.stk-on).
function stkPlace() {
  if (stk.parentNode !== win) win.appendChild(stk);
  stk.classList.remove('pt'); stk.classList.toggle('ph', portrait); stk.style.left = stk.style.top = '';
  const W = win.getBoundingClientRect(), sw = stk.offsetWidth || 108, sh = stk.offsetHeight || 162;
  const fb = flipEl.getBoundingClientRect(), face = faceOf(fig.getBoundingClientRect());
  const busy = textRects(stk); if (face) busy.push(face);
  const tries = [];
  if (fb.width) {
    const cx = fb.left + fb.width / 2 - sw / 2;
    // on the edge first: from three quarters on the board up to just touching it, then a little left and right
    // from the edge itself down into the board's empty middle (its words sit left and right), then up to just touching it
    for (const dx of [0, -24, 24, -48, 48]) for (const k of [0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.4, 0.3, 0.2, 0.1]) tries.push([cx + dx, fb.top - sh * (1 - k)]);
  }
  // the edge is taken (a small screen): the nearest free spot around the board, then anywhere
  const ys = []; for (let y = W.top + 6; y <= W.bottom - sh - 6; y += 12) ys.push(y);
  const yPref = fb.width ? fb.top - sh / 2 : W.top + W.height * 0.3, xPref = fb.width ? fb.left + fb.width / 2 - sw / 2 : W.left + W.width / 2 - sw / 2;
  ys.sort((a, b) => Math.abs(a - yPref) - Math.abs(b - yPref));
  for (const y of ys) for (let d = 0; d <= W.width; d += 20) { tries.push([xPref - d, y]); if (d) tries.push([xPref + d, y]); }
  const at = freeSpot(sw, sh, tries, busy);
  if (at) { stk.style.left = at.left + 'px'; stk.style.top = at.top + 'px'; return; }
  // nowhere free (a tiny window): the board's corner, as before
  if (stk.parentNode !== flipEl) flipEl.appendChild(stk); stk.classList.toggle('pt', portrait);
}
// THE BOARD WRITES FIRST, THEN THE CARD LANDS (2026-10-01): placed while the board still wrote its lines, the card took
// a spot that was free only for the moment and then sat on THIS BUY or the title (qa/stkgeo.mjs). It now waits until the
// board's and the title's text has stood still for 300 ms (at most 3 s), then finds its place and slaps on.
let stkWait = 0;
function stkShow(src) {
  clearTimeout(stkWait); win.classList.add('stk-on');
  stk.classList.toggle('wait', !src); if (src) stk.querySelector('img').src = src;
  stk.classList.remove('go'); stk.style.visibility = 'hidden'; stk.hidden = false; // in the layout to be measured, not yet seen
  const sig = () => flipEl.textContent.length + ':' + (momentEl.querySelector('.mc')?.textContent.length || 0) + ':' + Math.round(flipEl.getBoundingClientRect().height);
  let last = sig(), since = performance.now(); const t0 = since;
  const tick = () => {
    if (stk.hidden) return; // hidden again meanwhile (the moment ended)
    const now = performance.now(), cur = sig(); if (cur !== last) { last = cur; since = now; }
    // and until the title and the board have stopped moving: the title zooms in, so its letters measured small and the card
    // took their place (1440/1366: it sat on HUGE BUY). Endless animations (a glow) do not count.
    // only the TITLE's zoom (the board's own long animations — its pen — kept it waiting to the 3.5 s cap, and then the card
    // was up for barely two seconds before the board closed; qa/stkdbg.mjs): text still for 200 ms, the title settled, max 1.5 s
    const tt = momentEl.querySelector('.mc'), moving = !!tt && tt.getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
    if ((now - since < 200 || moving) && now - t0 < 1500) { stkWait = setTimeout(tick, 80); return; }
    stkPlace(); stk.style.visibility = ''; void stk.offsetWidth; stk.classList.add('go');
  };
  stkWait = setTimeout(tick, 100);
}
function stkHide() { clearTimeout(stkWait); stk.classList.remove('go'); stk.hidden = true; stk.style.visibility = ''; win.classList.remove('stk-on'); }
function stkCancel() { mintWaitX = null; stkHide(); }
function closeMomentIn(ms) {
  const now = performance.now();
  clearTimeout(momentTimer); momentUntil = now + ms;
  momentTimer = setTimeout(() => { momentEl.classList.remove('go'); win.classList.remove('in-moment'); stkHide(); }, ms);
  sceneUntil = now + ms + 1500; pumpScenes();
}
// the NFT of the buy on show is minted: the card slaps onto the corner, the window closes a little later
// THE NFT CARD ON ITS OWN (operator, 2026-09-28: "show the buy first, then the flipchart goes, and when the NFT is
// minted, just the NFT card, beautifully"): the minted card is a scene of its own in the queue — big, in the middle,
// slapped on, its number and tier under it — and goes after ~5 s. No second buy window, no waiting buy.
const nftEl = document.createElement('div'); nftEl.className = 'bt-nft'; nftEl.hidden = true;
nftEl.innerHTML = '<div class="nc"><img alt="NFT card"></div><b>NFT DROP</b><span></span>';
win.appendChild(nftEl);
let nftT = 0;
// HE PAINTS IT FIRST (2026-09-29, the operator's street-artist idea, clip hub-nft): with its clip he paints a card in the
// air in front of him, and the real card lands the moment his is finished (~4 s in); without the clip, at once
// SEE HIM MAKE IT (operator, 2026-10-01: "the NFT comes straight into the middle and you don't see BOBAI create it — paint
// it, spray it"): the card used to land 4.2 s into his move, big and in the middle, over him. It now lands when his own
// card is finished (5.6 s in: he shows it to the viewer and it dissolves), and beside him, so he stays in view.
const NFT_PAINT_MS = 5600;
const nftPaints = () => !REDUCED && moveTakes('nft').length > 0;
function nftReveal(n) {
  if (!nftCard(n)) return;
  if (!nftPaints()) return nftShow(n);
  setPose('nft', 8);
  // by the clip's own clock (1.10.: a timer from the scene's start let the card land at 4.8 s when the take started late)
  withMove(() => { const t0 = performance.now(); const wait = () => {
    const v = VID.v, own = /^hub-nft/.test(VID.cur || '') && v && v.currentTime >= NFT_PAINT_MS / 1000;
    if (own || performance.now() - t0 > NFT_PAINT_MS + 4000 || !/^hub-nft/.test(VID.cur || '') && performance.now() - t0 > NFT_PAINT_MS) nftShow(n); else setTimeout(wait, 80); };
    setTimeout(wait, 400); });
}
function nftShow(n) {
  const src = nftCard(n); if (!src) return;
  nftEl.querySelector('img').src = src;
  nftEl.querySelector('span').textContent = '#' + n.tokenId + ' · ' + (TIERS[n.tier] || '') + (nUsd(n) ? ' · ' + $buy(nUsd(n), n) + ' buy' : '');
  nftEl.hidden = false; nftEl.classList.remove('go', 'out', 'placed'); nftEl.style.left = nftEl.style.top = '';
  nftEl.classList.add('placed'); win.classList.add('nft-on'); // measured at its placed size, the bot labels already aside
  if (!portrait) { // ON THE BRAIN (operator, 2026-10-02: "show the NFT at the brain — it may cover it for the few seconds; just
    // set the NFT nicely on it, the hologram and the dots in the circle still show around it"): wide, the hologram brain
    // stands left of him, so the card is centred on it, its line under it, kept inside the window
    const c = toScreen(A.head), nc = nftEl.querySelector('.nc'), w = nftEl.offsetWidth, h = nftEl.offsetHeight;
    nftEl.style.left = clamp(c.x - w / 2, 8, win.clientWidth - w - 8) + 'px';
    nftEl.style.top = clamp(c.y - nc.offsetHeight / 2, 8, win.clientHeight - h - 8) + 'px';
  } else { // a phone: the brain is behind his head — on it the card would cover his face. Beside him, as on 1.10.: the
    // first free spot right or left of his figure, at chest height; else the middle
    const fr = fig.getBoundingClientRect(), w = nftEl.offsetWidth, h = nftEl.offsetHeight, tries = [];
    if (fr.width) { const y0 = fr.top + fr.height * 0.42 - h / 2;
      for (const dy of [0, -30, 30, -60, 60, -100, 100]) for (const dx of [16, 40, 70]) { tries.push([fr.right + dx, y0 + dy]); tries.push([fr.left - w - dx, y0 + dy]); } }
    const at = freeSpot(w, h, tries, [...textRects(nftEl), fr]);
    if (at) { nftEl.style.left = at.left + 'px'; nftEl.style.top = at.top + 'px'; } else nftEl.classList.remove('placed');
  }
  void nftEl.offsetWidth; nftEl.classList.add('go'); win.classList.add('nft-on');
  fire(A.core, new THREE.Color('#a78bfa')); shock(A.core, '#a78bfa', 1.4);
  clearTimeout(nftT); nftT = setTimeout(() => { nftEl.classList.add('out'); nftT = setTimeout(() => { nftEl.hidden = true; win.classList.remove('nft-on'); }, 600); }, 5000);
}
function mintArrived(x, n) {
  if (mode !== 'live') return;
  // the card image loads first (an empty frame showed while it came, 2026-09-28), then the scene joins the queue
  const go = () => enqueue({ kind: 'nftcard', id: 'c' + n.tokenId, t: Date.now(), n }); // after the buy's own scene, never on top of it
  const src = nftCard(n); if (!src) return;
  const im = new Image(); let done = false; const once = () => { if (!done) { done = true; go(); } };
  im.onload = once; im.onerror = once; setTimeout(once, 6000); im.src = src;
}
const LAST_M = { t: -1e15, level: -1 };
let shownNow = false;
function moment(kind, usd, sub, t, fast, card, sayKey, ctx) { shownNow = false; momentIn(kind, usd, sub, t, fast, card, sayKey, ctx); return shownNow; }
function momentIn(kind, usd, sub, t, fast, card, sayKey, ctx) {
  if (momentEl.classList.contains('held')) return; // a board the visitor holds is not written over
  const tier = kind === 'buy' && ctx && ctx.n ? buyTierOf(usd, ctx.n) : tierOf(kind === 'burn' ? BURN_TIERS : BUY_TIERS, usd); if (!tier) return;
  const [, pose, title, col, level] = tier, now = performance.now();
  // a bigger moment may cut into a smaller one, never the other way round
  if (now < momentUntil && level < (momentEl._level || 0)) return;
  // A BURST, BY THE CHAIN'S CLOCK (2026-09-29): the events of one burst reach this one by one from the queue, seconds
  // apart on screen. Within 15 s of the last moment's chain time only a BIGGER tier gets its own board and clip (a huge
  // after a nice: the escalation is worth seeing); the same or a smaller one keeps its log line. Buys further apart
  // each get their full moment, board and clip together.
  // LIVE, EVERY ALERT ITS OWN SCENE (operator, 2026-10-01: "in a bull run every buy alert gets its time, one after the
  // other, like a flow"): one 8 s poll stamps all its buys with the same time, so this rule let only the first of a burst
  // on stage. Live, the queue already plays them in turn; the rule stays for the replay only.
  if (mode !== 'live' && Math.abs(t - LAST_M.t) < 15e3 && level <= LAST_M.level) { (window.__btSkip = window.__btSkip || []).push([title, 'burst']); return; } // a board the burst rule kept back, for checks
  LAST_M.t = t; LAST_M.level = level; shownNow = true;
  LIFE.next = Math.max(LIFE.next, performance.now() + 30e3); // after the chain's moment, a calm stretch before his own moves
  const hold = [5.2, 6.0, 7.5, 9.0][level]; // long enough for his explanation to be read, in live and in replay alike
  setPose(pose, hold); // a tier without its clip yet takes the next smaller one (withClip in setPose)
  // the stage is taken from now on (a smaller moment may not cut in while this one waits for his move)
  momentEl._level = level; momentUntil = now + 9000 + hold * 1000;
  const mx = nextMintX; nextMintX = null;
  withMove(() => {
  const now = performance.now(); window.__btShows.push([Math.round(now), title, VID.cur]);
  momentEl.style.setProperty('--c', col); momentEl.dataset.level = level;
  momentEl.querySelector('.k').textContent = (Date.now() - t > 120e3 ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase() + ' · ' : '') + (kind === 'burn' ? 'BOBAI BURNS' : 'SOMEONE BUYS $BOBAI');
  momentEl.querySelector('.h').textContent = title;
  mintWaitX = null; // a new moment ends any wait for a card
  momentEl.classList.remove('defi', 'story'); showFlip(sub);
  // no bar of brains or flames any more (operator, 2026-09-28): the title and the board carry the moment
  momentEl.querySelector('.bar').textContent = '';
  momentEl.querySelector('.card').hidden = true; // the card is the sticker now
  if (card === 'wait' && mx?.drop) card = nftCard(mx.drop); // minted while the window waited for his move
  if (card) stkShow(card === 'wait' ? null : card); else stkHide();
  if (card === 'wait') mintWaitX = mx;
  momentEl.classList.remove('go'); void momentEl.offsetWidth; momentEl.classList.add('go');
  win.classList.add('in-moment');
  momentEl.style.setProperty('--hold', hold + 's');
  // waiting for the mint: the window stays until the card is there (mintArrived), at most 100 s
  const ms = card === 'wait' ? 100e3 : hold * 1000; momentUntil = now + ms;
  clearTimeout(momentTimer); momentTimer = setTimeout(() => { momentEl.classList.remove('go'); win.classList.remove('in-moment'); stkHide(); mintWaitX = null; }, ms);
  sceneUntil = Math.max(sceneUntil, now + ms + 1500); // the next scene waits for this one's full time
  // the scene answers: the brain flashes in the tier's colour, rings run out from the core, the camera leans in
  const c = new THREE.Color(col);
  for (let i = 0; i <= level; i++) setTimeout(() => { fire(A.core, c); fire(A.head, c); shock(A.core, col, 1.2 + i * 0.9); }, i * 260);
  // no camera push-in on the big tiers (2026-10-01, operator: "no wobbles"): in and out in two seconds read as a jolt
  });
}


// ---------- the flow: one scene at a time, each with its full time (2026-09-25) ----------
// Live moments queue up instead of piling on top of each other: a scene plays out, a breath, then the next.
// The replay's clock slows for exactly the same durations, so the past and the present move at one pace.
function sceneMs(x, fast) {
  const holds = [5.2, 6.0, 7.5, 9.0], lvl = t => t ? t[4] : 0;
  if (x.kind === 'run') return Math.max(holds[lvl(tierOf(BURN_TIERS, burnUsd(x.e)))] * 1000, (fast ? 420 : 1000) * 6.5);
  if (x.kind === 'nft') return holds[lvl(buyTierOf(nUsd(x.n) || 100, x.n))] * 1000;
  if (x.kind === 'trade') return x.ours ? 900 : holds[lvl(tierOf(BUY_TIERS, x.usd))] * 1000;
  if (x.kind === 'nftcard') return 5600 + (nftPaints() ? NFT_PAINT_MS : 0);
  if (x.kind === 'defi') return 7000;
  if (x.kind === 'liq') return 6500;
  return fast ? 1600 : 2400;
}
const QUEUE = []; let sceneUntil = 0, pumpT = 0;
// EVERY MOMENT ITS FULL TIME (operator, 2026-09-29: "in the replay all videos and animations shown correctly, each
// given its time, nothing cut short"): a scene's time used to run from the call, but its move first waits for the
// playing take to end (up to ~8 s) and its board comes with the move — so the next moment could cut in before the last
// one was even on screen. The stage is busy while a board or an event's move still waits; its time starts when it shows.
const stageBusy = () => !!VID.go || !!(VID.want && VID.want.p !== 'idle');
function enqueue(x) { QUEUE.push(x); pumpScenes(); }
function pumpScenes() {
  clearTimeout(pumpT);
  if (!QUEUE.length) return;
  if (mode !== 'live') { pumpT = setTimeout(pumpScenes, 1000); return; }
  const now = performance.now();
  if (stageBusy()) { pumpT = setTimeout(pumpScenes, 300); return; }
  // a board the visitor holds is not written over — the next scene WAITS for it instead of being dropped (2026-10-01);
  // held longer than 20 s while the chain has more to show, it lets go so the flow goes on
  if (momentEl.classList.contains('held')) { if (now - (momentEl._heldAt || now) < 20e3) { pumpT = setTimeout(pumpScenes, 500); return; } holdRelease(); momentUntil = 0; }
  if (now < sceneUntil) { pumpT = setTimeout(pumpScenes, sceneUntil - now + 60); return; }
  const x = QUEUE.shift(); x.lit = now; run(x, false);
  sceneUntil = now + sceneMs(x, false) + 1500;                             // a breath between two scenes
  if (QUEUE.length) pumpT = setTimeout(pumpScenes, sceneUntil - now + 60);
}

// ---------- BOBAI's flipchart (2026-09-25, operator: show it, don't tell it) ----------
// "As if BOBAI writes on an electronic flipchart": beside him stands a glass board, and in every scene he writes the
// figures onto it, line after line, a glowing pen running ahead of the ink; then he draws one chart — where the money
// went, or where the DeFi agent's range stands. The title says WHAT; the board shows HOW MUCH. No sentence under the
// title, no speech bubble on top of it. A spec is { head, rows: [[label, value, colour?]], split: [[amount, colour,
// label]], meter: step }; every figure is the event's own.
const flipEl = document.createElement('div'); flipEl.className = 'flip';
flipEl.innerHTML = '<div class="fl-h"></div><div class="fl-b"></div><i class="fl-leg l"></i><i class="fl-leg r"></i>';
momentEl.appendChild(flipEl);
const SPLIT_LAB = { burnA: 'BURN BOBAI', burnB: 'BURN BOB', liq: 'LIQUIDITY', defi: 'DEFI AGENT', giggle: 'GIGGLE POT', creator: 'CREATOR' };
function placeFlip() {
  // phone: the board is part of the scene card above the tabs; wide screen: it stands to his left, like a flipchart
  if (portrait) { if (flipEl.parentNode !== momentEl.querySelector('.mc')) momentEl.querySelector('.mc').appendChild(flipEl); flipEl.style.cssText = ''; return; }
  if (flipEl.parentNode !== momentEl) momentEl.appendChild(flipEl);
  if (momentEl.classList.contains('story')) { flipEl.style.cssText = ''; return; }
  // bigger in the full-screen terminal, where he is drawn bigger too (2026-10-06)
  const wr = win.getBoundingClientRect(), fr = fig.getBoundingClientRect(), w = clamp(wr.width * 0.27, 280, document.body.classList.contains('bp-big') ? 400 : 360);
  // THE BOARD IS DRAWN AT zoom 1.12 (terminal.css), and zoom multiplies its top and left too: placed in window pixels it
  // landed 12% lower and further right — 12-41 px over the log at 1366-1920 (layout.mjs 2026-09-29). Every figure here is
  // in window pixels; the ones written to the board are divided by its zoom.
  const z = parseFloat(getComputedStyle(flipEl).zoom) || 1, W = w * z;
  flipEl.style.width = w + 'px';
  flipEl.style.left = Math.max(20, fr.left - wr.left + fr.width * 0.1 - W) / z + 'px';
  // it stands on the log's roof at the lowest, legs included, and never climbs into the title
  const term = document.querySelector('#bt .term'), floor = (term && term.offsetParent ? term.getBoundingClientRect().top - wr.top : wr.height - 120) - 40;
  // the ceiling is the title's own bottom (the titles are smaller since 2026-09-28): a tall board rises instead of
  // hanging over the log
  const mc = momentEl.querySelector('.mc').getBoundingClientRect(), ceil = mc.height ? mc.bottom - wr.top + 14 : wr.height * 0.26;
  // where the room between the title and the log is shorter than the board, the board is drawn smaller (the scale
  // property, apart from its slide-in transform)
  const bh = flipEl.offsetHeight * z, room = floor - ceil, f = bh > room && room > 120 ? Math.max(0.72, room / bh) : 1;
  flipEl.style.transformOrigin = '0 0'; flipEl.style.scale = f === 1 ? '' : String(f);
  // IT STANDS ON THE LOG'S ROOF (2026-10-06, operator: 'in the full screen the DeFi board hangs too high in the air'):
  // at 28% of his height it met the roof in the normal size, but full screen draws him far taller and the board floated
  // at his shoulders — now it stands on the roof everywhere, and rises only where the room above the log is short
  flipEl.style.top = Math.max(ceil, floor - bh * f) / z + 'px';
}
function showFlip(spec) {
  const body = flipEl.querySelector('.fl-b'); body.textContent = ''; meterEl.hidden = true;
  if (!spec || (!spec.rows?.length && !spec.meter)) { flipEl.hidden = true; return; }
  flipEl.hidden = false; flipEl.querySelector('.fl-h').textContent = spec.head || '';
  let at = 0.55; const pen = 0.42;                  // he writes one line after the other
  for (const [lab, val, col] of spec.rows || []) {
    if (val == null || val === '') continue;
    const r = document.createElement('div'); r.className = 'fl-r'; if (col) r.style.setProperty('--fc', col);
    r.innerHTML = '<div class="fl-i"><span></span><b></b></div><i class="fl-p"></i>'; r.querySelector('span').textContent = lab; r.querySelector('b').textContent = val;
    r.style.setProperty('--at', at + 's'); body.appendChild(r); at += pen;
  }
  // the NFT card of a drop sits on the board, in its own row, inside the window — never over his move (operator, 2026-09-28)
  const nr = spec.card && [...body.querySelectorAll('.fl-r')].find(r => r.querySelector('span').textContent === 'NFT DROPPED');
  if (nr) { const i = document.createElement('img'); i.className = 'fl-n'; i.alt = 'NFT card'; i.src = spec.card; nr.querySelector('.fl-i').appendChild(i); }
  const parts = (spec.split || []).filter(p => p[0] > 0), tot = parts.reduce((a, p) => a + p[0], 0);
  if (tot > 0) {                                     // then he draws the diagram: a ring, arc by arc, the colours of where it went
    const d = document.createElement('div'); d.className = 'fl-d';
    const R = 26, C = 2 * Math.PI * R; let off = 0, i = 0, arcs = '';
    for (const [v, col] of parts) {
      const len = v / tot * C, gap = parts.length > 1 ? Math.min(2, len * 0.3) : 0;
      arcs += `<circle r="${R}" cx="34" cy="34" style="--sc:${col};--len:${(len - gap).toFixed(2)};--c0:${C.toFixed(2)};--at:${(at + 0.1 + i * 0.22).toFixed(2)}s" stroke-dasharray="0 ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
      off += len; i++;
    }
    d.innerHTML = `<svg viewBox="0 0 68 68" aria-hidden="true"><circle class="fl-bg" r="${R}" cx="34" cy="34"/>${arcs}<text x="34" y="37.5" text-anchor="middle">${spec.ring || '3%'}</text></svg>`;
    const key = document.createElement('div'); key.className = 'fl-k'; key.style.setProperty('--at', at + 0.35 + 's');
    for (const [v, col, lab] of parts) { const k = document.createElement('span'); k.style.setProperty('--sc', col); k.innerHTML = `<em></em>${lab}<b>${Math.round(v / tot * 100)}%</b>`; key.appendChild(k); }
    d.appendChild(key); body.appendChild(d); at += 0.3 + parts.length * 0.22;
  }
  if (spec.spark && candles().length > 3) {          // and where on the chart it happened
    const cv = document.createElement('canvas'); cv.className = 'fl-c'; cv.style.setProperty('--at', at + 0.2 + 's');
    body.appendChild(cv); setTimeout(() => drawSpark(cv, spec.spark), 80); // a timeout, not a frame: the board is laid out by then
  }
  if (spec.meter) { defiMeter(spec.meter); meterEl.style.setProperty('--at', at + 0.1 + 's'); body.appendChild(meterEl); }
  placeFlip();
}
// the tax of one trade, split by the table in force (the same shares the scene's streams show)
const taxSplit = usd => DEST.filter(d => d.pct > 0).map(d => [usd * 0.03 * d.pct / 3, d.c, SPLIT_LAB[d.k] || d.k.toUpperCase()]);
// a mini chart on the board: three hours of candles around the moment, and a mark on it
function drawSpark(cv, spec, tries = 0) {
  const { t, col, lab } = spec;
  // the board slides in and is laid out a moment later: until it has a width, try again shortly
  const r = cv.getBoundingClientRect(); if (!r.width) { if (tries < 12 && cv.isConnected) setTimeout(() => drawSpark(cv, spec, tries + 1), 150); return; }
  const dpr = Math.min(devicePixelRatio, 2); cv.width = r.width * dpr; cv.height = r.height * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const all = candles(); if (all.length < 2) { if (tries < 12 && cv.isConnected) setTimeout(() => drawSpark(cv, spec, tries + 1), 250); return; }
  const k = all.findIndex(c => c.t >= t), at = k < 0 ? all.length - 1 : k, lo0 = Math.max(0, Math.min(at - 12, all.length - 18)), cs = all.slice(lo0, lo0 + 18);
  let lo = Infinity, hi = 0; for (const c of cs) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); }
  const mid = (hi + lo) / 2, span = Math.max(hi - lo, mid * 0.006); lo = mid - span * 0.62; hi = mid + span * 0.62;
  const W = r.width, H = r.height - 12, step = W / cs.length, bw = Math.max(2, step * 0.55), Y = p => 2 + (1 - (p - lo) / (hi - lo)) * (H - 4);
  cs.forEach((c, i) => {
    const x = i * step + step / 2, col2 = Math.abs(c.c - c.o) < mid * 2e-5 && !c.n ? 'rgba(160,162,192,.45)' : c.c >= c.o ? BUYC : SELLC;
    g.strokeStyle = col2; g.fillStyle = col2; g.globalAlpha = 0.85;
    g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(c.h)); g.lineTo(Math.round(x) + 0.5, Y(c.l)); g.stroke();
    const y0 = Y(Math.max(c.o, c.c)); g.fillRect(x - bw / 2, y0, bw, Math.max(1.2, Y(Math.min(c.o, c.c)) - y0));
  });
  g.globalAlpha = 1;
  const mi = cs.findIndex(c => c.t >= t), mx = (mi < 0 ? cs.length - 1 : mi) * step + step / 2;
  g.strokeStyle = col; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(mx + 0.5, 0); g.lineTo(mx + 0.5, H); g.stroke(); g.setLineDash([]);
  g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 8; g.beginPath(); g.arc(mx, Y(cs[mi < 0 ? cs.length - 1 : mi].c), 3, 0, 7); g.fill(); g.shadowBlur = 0;
  g.font = '700 8px ui-monospace,Consolas,monospace'; g.textAlign = mx > W * 0.6 ? 'right' : 'left';
  g.fillText(lab, mx + (mx > W * 0.6 ? -6 : 6), r.height - 2);
  g.textAlign = 'left'; g.fillStyle = 'rgba(160,162,192,.55)'; g.fillText('3H', 0, r.height - 2);
}
function flipBuy(usd, n, t) {
  return { head: 'THIS BUY', spark: t ? { t, col: BUYC, lab: 'THIS BUY' } : null, rows: [['BOUGHT', $buy(usd, n && n.usdExact === usd ? n : null)], ['TAX · 3%', '$' + nf(usd * 0.03, 2), '#F0B90B'], n ? ['NFT DROPPED', '#' + n.tokenId, '#a78bfa'] : null].filter(Boolean), split: taxSplit(usd) };
}
function flipBurn(e, l) {
  const n = v => parseFloat(v) || 0, parts = { burnA: n(e.bobaiBurnBnb), burnB: n(e.bobBurnBnb), defi: n(e.lpAgentBnb), giggle: n(e.giggleBnb), creator: n(e.creatorBnb) };
  // the liquidity share is the rest of the run: the log of the add (when it is found) or what the other parts leave
  parts.liq = l ? n(l.bnb) : Math.max(0, n(e.totalBnb) - Object.values(parts).reduce((a, b) => a + b, 0));
  return { head: 'THIS BUYBACK', rows: [['BOBAI BURNED', nf(e.bobaiBurned), D.burnA.c], ['BOB BURNED', cmp(bobOf(e)), D.burnB.c], ['TAX SPENT', bnbF(e.totalBnb), '#F0B90B']],
    split: Object.entries(parts).map(([k, v]) => [v, D[k].c, SPLIT_LAB[k]]), ring: 'TAX', spark: { t: Date.parse(e.time), col: D.burnA.c, lab: 'BOT BOUGHT & BURNED' } };
}
function flipLiq(l) {
  // the dev wallet's add: both sides straight from its own run (liq-runs.json), nothing bought by the bot
  if (l.dev) return { head: 'DEV WALLET d38', rows: [['BNB IN', bnbF(l.bnb), D.liq.c], ['BOBAI IN', cmp(l.bobai) + ' BOBAI'], ['LP BURNED', nf(l.lpBurned, 2), '#F0B90B'], ['POOL LOCKED', lpText()]] };
  // the log's bnb is the whole liquidity share: half of it buys the BOBAI, the other half goes in beside it (read on-chain
  // 2026-09-29, add 0x7b41…: 0.01247 BNB -> pool Mint 0.00603 BNB + 18,593 BOBAI). 'BNB ADDED 0.0125 + 19.2K BOBAI' counted it twice.
  return { head: 'INTO THE POOL', rows: [['LIQUIDITY SHARE', bnbF(l.bnb), D.liq.c], ['HALF BOUGHT', cmp(l.bobaiBought) + ' BOBAI'], ['LP BURNED', nf(l.lpBurned, 2), '#F0B90B'], ['POOL LOCKED', lpText()]] };
}
// the DeFi agent: what the step did, as figures; the range drawn under it
const capOf = s => +s.bnb_spent || +s.would_add?.wbnb || +s.spendable_bnb || 0; // BNB an increase step put in
const DEFI_BOARD = {
  collect: s => { const got = +s.produced_bnb || +s.owed?.bnb_equivalent || 0;
    return ['FEES COLLECTED', { head: 'PAYDAY', rows: [['FEES EARNED', bnbF(got), D.defi.c], ['BOBAI BOUGHT', s.bobai_units ? cmp(s.bobai_units) : null, '#F0B90B'], ['BACK TO WORK', s.kept_bnb ? bnbF(s.kept_bnb) : null]],
      split: [[+s.bobai_bnb || got / 2, '#F0B90B', 'BUYS BOBAI'], [+s.kept_bnb || got / 2, D.defi.c, 'CAPITAL']], ring: 'FEES' }]; },
  increase: s => ['NEW CAPITAL AT WORK', { head: 'MORE IN THE POOL', rows: [['ADDED', bnbF(capOf(s)), D.defi.c], ['POSITION NOW', s.value_after_bnb ? bnbF(s.value_after_bnb) : null]], meter: s }],
  // a one-sided re-set sits right beside the price with no trade and earns once the price steps back in
  rebalance: s => ['RANGE MOVED', { head: s.one_sided ? 'PARKED BESIDE THE PRICE' : 'BACK AROUND THE PRICE', rows: [['WIDTH', s.width_pct ? '±' + s.width_pct + '%' : null, D.defi.c], ['TRADE', s.one_sided ? 'NONE' : 'REBALANCED'], ['GAS', s.gas_bnb ? bnbF(s.gas_bnb) : null], ['TO BOBAI', +s.fees_to_bobai_bnb ? bnbF(s.fees_to_bobai_bnb) : null, '#F0B90B']], meter: s }],
  // the meter shows the reserve range it just set (new_reserve_ticks), not the main one (it has no ticks of its own: the
  // meter fell back to the main position's range, 2026-09-29)
  ladder: s => ['RESERVE RESET', { head: 'READY FOR THE NEXT MOVE', rows: [['WIDTH', s.width_pct ? '±' + s.width_pct + '%' : null, D.defi.c]], meter: s.new_reserve_ticks ? { ...s, ticks: s.new_reserve_ticks } : s }],
  sweep: s => ['PAYMENTS SWEPT', { head: 'FROM THE AGENT SERVICES', rows: [['PAID IN', (s.sweeping ?? s.balance ?? '') + ' ' + (s.token || ''), D.defi.c], ['WORTH', s.bnb_equivalent ? bnbF(s.bnb_equivalent) : null]] }],
};
const meterEl = document.createElement('div'); meterEl.className = 'meter';
meterEl.innerHTML = '<div class="mt">CAKE / BNB · 0.05%</div><div class="track"><div class="rng"></div><i class="px"></i></div><div class="ms"></div>';
function defiMeter(s) {
  // the range and the price as the chain has them: from this step, else from the agent's last look
  // a re-set is shown with the range it moved TO (new_ticks)
  if (s && s.new_ticks && s.tick != null) s = { ...s, ticks: s.new_ticks };
  const src = (s && s.ticks && s.tick != null) ? s : (() => { const n = lpNow(); return { ticks: n.ticks, tick: n.tick }; })();
  if (!src?.ticks || src.tick == null) { meterEl.hidden = true; return; }
  const [lo, hi] = src.ticks, pad = (hi - lo) * 0.45, a = lo - pad, b = hi + pad, pos = v => clamp((v - a) / (b - a), 0, 1) * 100;
  const inR = src.tick >= lo && src.tick < hi;
  meterEl.hidden = false; meterEl.classList.toggle('out', !inR);
  meterEl.querySelector('.rng').style.cssText = `left:${pos(lo)}%;width:${pos(hi) - pos(lo)}%`;
  meterEl.querySelector('.px').style.left = pos(src.tick) + '%';
  meterEl.querySelector('.ms').textContent = inR ? 'PRICE IN RANGE · EARNING' : 'PRICE BESIDE IT · WAITING';
}
// one scene frame for everything that is not a tier moment: the kicker, the title, BOBAI's pose and his board
function boardScene(t, col, pose, kicker, title, spec, hold) {
  if (momentEl.classList.contains('held')) return;
  const now = performance.now();
  if (now < momentUntil && (momentEl._level || 0) > 1) return; // a big buy or burn keeps the stage
  setPose(pose, hold); momentEl._level = 1; momentUntil = now + 9000 + hold * 1000;
  LIFE.next = Math.max(LIFE.next, now + 30e3); // a calm stretch after the chain's moment, as in moment()
  withMove(() => {
  const now = performance.now(); momentUntil = now + hold * 1000;
  sceneUntil = Math.max(sceneUntil, now + hold * 1000 + 1500);
  momentEl.style.setProperty('--c', col); momentEl.dataset.level = 1;
  momentEl.querySelector('.k').textContent = (Date.now() - t > 120e3 ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase() + ' · ' : '') + kicker;
  momentEl.querySelector('.h').textContent = title;
  momentEl.querySelector('.bar').textContent = ''; momentEl.querySelector('.card').hidden = true;
  momentEl.classList.remove('story'); momentEl.classList.toggle('defi', /^defi/.test(pose));
  showFlip(spec);
  stkCancel(); momentEl.classList.remove('go'); void momentEl.offsetWidth; momentEl.classList.add('go'); win.classList.add('in-moment');
  clearTimeout(momentTimer); momentTimer = setTimeout(() => { momentEl.classList.remove('go', 'defi'); win.classList.remove('in-moment'); }, hold * 1000);
  fire(A.core, new THREE.Color(col));
  });
}
function defiScene(x, fast) {
  const [title, spec] = (DEFI_BOARD[x.key] || (() => ['AT WORK', { head: x.step, rows: [] }]))(x.s || {});
  if (x.also) { if (x.key === 'collect') spec.head = 'PAYDAY · MORE IN THE POOL'; spec.rows.push(['NEW CAPITAL', bnbF(capOf(x.also)), D.defi.c]); } // the same run's capital (buildEvents)
  const bought = +x.s?.bobai_units > 0 || +x.s?.fees_to_bobai_bnb > 0; // its fees bought BOBAI: the robot brings the coins
  boardScene(x.t, D.defi.c, bought ? 'defi-buy' : x.key === 'increase' ? 'defi-cap' : 'defi', "BOBAI'S DEFI AGENT", title, spec, 7.0);
  D.defi.boost = 1; hitDest('defi');
}

// ---------- BOBAI meets the builders who visit (2026-09-25) ----------
// Tap or click him: he answers with something true about his work right now, a line about building on BNB, a joke, or one of his moves.
// Never twice the same kind in a row; the chain's own scenes always go first.
function onBobai(e) {
  const r = fig.getBoundingClientRect(), x = e.clientX, y = e.clientY;
  // his body, not the empty corners of his picture box
  return x > r.left + r.width * 0.22 && x < r.right - r.width * 0.22 && y > r.top + r.height * 0.05 && y < r.bottom - r.height * 0.06;
}
const BUILD = [
  'I live on BNB Chain. A new block every half second, and I read every one.', // 0.45 s, measured over 10,000 blocks on 2026-09-25
  'Built on BNB: my tax, my burns, my pool, my DeFi agent. All of it on-chain, all of it checkable.',
  'Gas on BNB Chain is so cheap, my bots can look at the chain every ten minutes. Try that elsewhere.',
  'Binance was not built in a day. Neither am I. But I build every day.',
  'Contracts, bots and me, all working in the open on BNB Chain. Check any of it on BscScan.',
  'Every number on this screen comes from BNB Chain, read live or from my own logs of it. No price feed from anyone else.',
  'Every ten minutes my buyback bot checks its wallet. It never forgets. I sometimes do.',
  'Hard hat on. Somebody has to stack the blocks, and on BNB Chain they come fast.',
];
const TAPS = ['Hey! That tickles.', 'Yes, builder?', 'You found me.', 'Hi! Between two blocks:', 'Oh, hello!', 'Yes? Here is what I am doing.', 'Yes, I am real.'];
let tapKind = -1, tapN = 0;
// the joke button: a joke with its laugh clip. A clip still playing is waited out (up to 12 s) so the joke is never told
// without him laughing; the chain's own moments and the replay go first, and he says so.
// THE BUTTON SAYS WHEN IT IS A GOOD MOMENT (2026-09-29, operator: "you do not know when you can click it — when the moment
// is bad, BOBAI is getting ready for another move, standing like 'I am thinking of a joke'; as soon as there is a fitting
// window, it says TELL ME A JOKE"). Ready = what tellJoke() needs: live, no scene of the chain on or queued, no move playing
// or waiting (his calm rest take is fine: the laugh waits for its end). Otherwise a thinking face and THINKING OF ONE…;
// a click then keeps the joke (GOT ONE… WAIT) and it is told the moment the window opens. Ready shows only after it has
// held for half a second, so it does not flicker between two takes.
let jokeQueued = false, jokeReadySince = 0, jokeShown = null;
function jokeReady() {
  if (mode !== 'live' || performance.now() < sceneUntil || QUEUE.length || momentEl.classList.contains('held')) return false;
  if (REDUCED || !VID.v) return true;
  if (VID.go || (VID.want && VID.want.p !== 'idle') || !HAVE.has('laugh') || !moveTakes('laugh').length) return false;
  // his wave is an action too (2026-09-30, operator: "at the start his first action can be cut off by a joke"): only the
  // calm rest takes give way; the greeting, until its line is said, never
  if (!LIFE.saidHi || performance.now() < (LIFE.greetUntil || 0)) return false;
  return !(VID.on && VID.cur && !/^rest/.test(VID.cur));
}
function paintJoke() {
  const now = performance.now(), r = jokeReady();
  if (r && jokeQueued) { jokeTap(); return; }
  jokeReadySince = r ? (jokeReadySince || now) : 0;
  // NEVER "TELLING YOU SOMETHING" WITHOUT A SENTENCE (operator rule, 1.10.; 2.10. it still showed under the NFT card with no
  // bubble): busy, the button names what he does — speaking (or a line held for his move), else a scene, else a moment
  const talking = !!HELD || (bubble.classList.contains('on') && now < LIFE.sayUntil);
  const showing = win.classList.contains('in-moment') || win.classList.contains('nft-on') || (VID.on && VID.cur && !/^(rest|idle)/.test(VID.cur));
  const state = jokeQueued ? 'queued' : r && now - jokeReadySince > 500 ? 'ready' : talking ? 'wait-tell' : showing ? 'wait-show' : 'wait';
  if (state === jokeShown) return;
  const was = jokeShown; jokeShown = state;
  jokeBtn.classList.toggle('wait', state !== 'ready'); jokeBtn.classList.toggle('queued', state === 'queued');
  jokeBtn.querySelector('.jk-t').textContent = ({ ready: 'Tell me a joke', queued: 'Got one, wait', 'wait-tell': 'Telling you something', 'wait-show': 'Showing you something' })[state] || 'One moment'; // no '…': the button draws its own three animated dots (2.10.: it read 'ONE MOMENT_' + dots)
  jokeBtn.setAttribute('aria-label', state === 'ready' ? 'Tell me a joke' : state === 'queued' ? 'BOBAI has a joke ready and tells it in a moment' : 'BOBAI is busy for a moment — tap and he tells a joke right after');
  if (state === 'ready' && was) { jokeBtn.classList.remove('ready-in'); void jokeBtn.offsetWidth; jokeBtn.classList.add('ready-in'); }
}
setInterval(() => { try { paintJoke(); } catch {} }, 250); // (the scene and the video are made further down: until then, nothing to paint)
function jokeTap() {
  LIFE.touchAt = performance.now();
  if (!jokeReady()) { jokeQueued = true; paintJoke(); return; }
  jokeQueued = false;
  if (tellJoke(6500)) { LIFE.next = Math.max(LIFE.next, performance.now() + 30e3); jokeBtn.classList.remove('hit'); void jokeBtn.offsetWidth; jokeBtn.classList.add('hit'); }
  else jokeQueued = true; // no clip could start after all: it waits for the next window
  paintJoke();
}
jokeBtn.addEventListener('click', e => { e.stopPropagation(); jokeTap(); });
jokeBtn.addEventListener('pointerdown', e => e.stopPropagation());
function bobaiTap() {
  if (performance.now() < sceneUntil || QUEUE.length) return speak(vary('v-busy', ['One second, I am on the chain right now.', 'Hold on, something is happening on my chain.', 'Wait, wait. The chain first, then you.', 'Busy for a moment. A trade needs me.', 'Give me a second. I am reading a block.']), 2600);
  tapN++;
  const moves = ['saber', 'moon', 'coffee', 'hodl', 'cheer', 'think', 'pushups', 'shrug', 'bull', 'dance', 'walk'].filter(p => flowPose(p) === p && !RECENT.includes(p)); // only moves he can play, not the last four
  const today = S.burns.filter(e => Date.parse(e.time) >= Date.now() - 86400e3);
  const left = W.buyback.last ? Math.max(0, Math.ceil((W.buyback.last + 600e3 - Date.now()) / 60e3)) : null;
  const rb = S.lp?.last?.steps?.rebalance, inr = lpNow().inR;
  const kinds = [
    () => { setPose(poseOr('think'), 6); speak(`Right now $${nf(S.queued * S.price + splitBnb() * S.bnbP, 2)} of tax is charging my next buyback. ${splitBnb() > 0 && left != null ? left > 0 ? `My bot splits it in ${left} min.` : 'My bot splits it at its next check.' : S.queued >= MIN_DISPATCH ? 'The queue is full: the token swaps it to BNB inside one of the next trades.' : `At ${cmp(MIN_DISPATCH)} BOBAI the token swaps it to BNB — ${Math.round(clamp(S.queued / MIN_DISPATCH, 0, 1) * 100)}% there.`}`, 6200); },
    () => { setPose(poseOr('burn'), 6); speak(today.length ? `In the last 24 hours I burned ${bobaiAmt(today.reduce((a, e) => a + (+e.bobaiBurned || 0), 0))} in ${today.length} run${today.length > 1 ? 's' : ''}. All on-chain, check any of them.` : 'No burn in the last 24 hours yet. The tax is still charging.', 6200); },
    () => { setPose(poseOr('defi'), 6); speak(`My DeFi agent works ${bnbF(lpNow().value ?? 0)} in CAKE/BNB. ${inr === false ? 'The price is outside its range, so it waits.' : inr === true ? 'The price is in its range, so it earns fees.' : 'I am still reading where the price sits in its range.'}`, 6400); },
    () => { const p = moves.length ? moves[Math.random() * moves.length | 0] : 'cheer'; setPose(p, 7); speak(MOVE_LINES[p] ? pick(MOVE_LINES[p]) : 'gm!', 6000); },
    () => { if (HARD_DAY()) { const l = heartLine(); setPose(moveForLine(l, null) || poseOr('hodl'), 6); speak(l, 7000); } else if (!tellJoke(6000)) { setPose(poseOr('build'), 6); speak(pick(BUILD), 6400); } }, // no joke ready: what he builds (not 'thanks for watching me', operator 2026-10-06) // a tap on a hard day: a word of heart, not a joke
    () => { setPose(poseOr('build'), 6); speak(pick(BUILD), 6400); },
    () => { const line = saidMood(moodLine()); setPose(moveForLine(line, moodMove()), 6); speak(line, 6400); },
    () => { const r = recallLine(); if (r) { setPose(poseOr(r[0]), 6); speak(r[1], 6400); } else { setPose(poseOr('build'), 6); speak(pick(BUILD), 6400); } }, // what happened this hour (2026-10-01)
  ];
  // THE FIRST TAP IS ANSWERED (operator, 2026-10-06: "he says tap me, you tap, he says tap me again, then 'oh, you watch
  // me' — make BOBAI more intelligent"): his greeting promised to tell what he is doing, so the first tap does exactly
  // that, with a short hello in front; no tap ever asks for another one
  if (tapN === 1) { const w = [0, 1, 2, ...(recallLine() ? [7] : [])]; tapKind = w[Math.random() * w.length | 0]; tapHi = pick(TAPS); kinds[tapKind](); tapHi = '';
    (window.__btTaps = window.__btTaps || []).push('work'); }
  // A TAP: MOSTLY WHAT HE IS DOING, THEN HIS MOOD, THEN A JOKE (operator, 2026-09-29; jokes were every second tap): about
  // 55% his work (the tax charging, today's burns, the DeFi agent, a move, his hard hat), 30% his mood, 15% a joke — never
  // the same kind twice in a row. The joke button stays the place for jokes.
  else {
    const roll = () => { const r = Math.random(); if (r < 0.15) return 4; if (r < 0.45) return 6; const w = [0, 1, 2, 3, 5, ...(recallLine() ? [7] : [])]; return w[Math.random() * w.length | 0]; };
    let k, n = 0; do k = roll(); while (k === tapKind && ++n < 12); tapKind = k; kinds[k]();
    (window.__btTaps = window.__btTaps || []).push(k === 4 ? 'joke' : k === 6 ? 'mood' : 'work'); // for checks from outside
  }
  LIFE.next = performance.now() + 20e3; LIFE.quietSince = Date.now(); LIFE.touchAt = performance.now();
}
// HE NOTICES WHAT YOU LOOKED AT (2026-09-28, operator: "more intelligent, more alive"): the new page opens its blocks
// and pages as windows over him. When one closes he says a word about it, with a move that fits — once per window
// per visit, never over a moment of the chain, and never more often than every 40 seconds.
let lastWin = null; const winTalked = new Set();
addEventListener('bp:open', e => { lastWin = e.detail === 'wpage' ? 'page:' + (document.querySelector('#wpage .pg-t')?.textContent || '') : e.detail; });
const WIN_LINES = {
  // five ways each since 2026-10-02; each names only its own move, or none
  w01: ['cheer', ['Now you know me a little better. Nice to meet you, builder.', 'That was my story. Thanks for reading it.', 'Now we know each other. Welcome to the brain.', 'You read about me! I am flattered.', 'Nice to meet you properly, builder.']],
  w02: ['think', ['Now you know where every 3% goes. I checked the math twice.', 'Every slice of the 3%, on-chain. Questions? Tap me.', 'That is my tax table. Boring to some, beautiful to me.', 'Where the 3% goes, in one window. All checkable.', 'Tokenomics read. You are officially a big brain.']],
  w03: ['burn', ['Every burn, checkable. I like that you checked.', 'All my burns, each with its transaction.', 'Proof, not promises. Every burn is on-chain.', 'You checked the receipts. Respect.', 'The burn record never lies. It cannot.']],
  w04: ['build', ['I run all of those. Busy brain.', 'All of them, working for $BOBAI. Every day.', 'That is my toolbox. I use all of it.', 'Lots of bots, one brain. Mine.', 'Everything in that window is live and mine.']],
  w06: ['moon', ['Next phase: Depth. I am already stretching.', 'The roadmap goes up. Like the moon, just slower.', 'Next stop on the roadmap. The moon can wait a little.', 'Roadmap read. The moon is on it, somewhere.', 'Step by step to the moon. You saw the steps.']],
  w07: ['think', ['Still a question left? Tap me, or ask in the log.', 'Anything the FAQ did not answer? Ask me.', 'Questions answered. More? Tap me any time.', 'If it is not in the FAQ, ask in my log.', 'Good questions in there. Got another one?']],
  'page:Pool Scanner': ['think', ['Found a token worth a second look? Every answer came straight from the chain.', 'Scanned something? The chain does not lie.', 'The scanner reads the chain, not the hype.', 'Check before you ape. That is what the scanner is for.', 'Every scan, straight from BNB Chain.']],
  'page:Brain Plaza': ['walk', ['A whole plaza of agents. Only the ones that answered made the list.', 'Took a walk through the plaza? Real agents only.', 'The plaza: agents that answer, nothing else.', 'Walking past all those agents. Good neighbours.', 'A walk around the plaza. Every agent there answered.']],
  'page:Agent Services': ['build', ['Ten cents an answer. Cheaper than a good snack.', 'Agents pay me ten cents an answer. Fair deal.', 'My services, open to every agent.', 'Built for agents, paid per answer.', 'Ten cents, one answer, straight from the chain.']],
  'page:DeFi Agent': ['defi', ['That is my DeFi agent. It works while I talk.', 'My DeFi agent, in full detail.', 'CAKE/BNB, managed by my DeFi agent, every hour.', 'Every move of my DeFi agent is on-chain.', 'That is where my DeFi agent earns its fees.']],
  'page:NFT Collection': ['nft', ['Buy $100 or more of BOBAI and an NFT of me lands in your wallet. Automatically.', 'Like my NFTs? A $100 buy gets you one.', 'Every NFT there was earned by a real buy.', 'My NFT collection grows with every big buy.', 'NFTs of me, dropped by themselves for buys of $100+.']],
  'page:brainScreener': ['giggle', ['How did your brain do? Mine is 45% of me, so I cheat a little.', 'Screened your brain? Mine passed. Barely.', 'Brain check done. Nice work.', 'Your brain score is safe with me.', 'Big brain or not, you are welcome here.']],
  "page:The BOBAI Game": ['dance', ['Did you beat my high score? Do not tell me if you did.', 'Game over? My dance says try again.', 'Played my game? I dance for every high score.', 'A dance for your high score.', 'Good game! Happy dance.']],
};
// for checks from outside (qa/variety.mjs): how many variants every pool has, and any line that names a move other than its own
window.__btPools = () => {
  const n = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, (Array.isArray(v) ? v : v.lines || v[1] || []).length]));
  const wrong = [...Object.entries(MOVE_LINES).flatMap(([p, L]) => L.map(l => [p, l])), ...Object.values(WIN_LINES).flatMap(([p, L]) => L.map(l => [p, l])), ...Object.values(ASK_LINES).flatMap(([p, L]) => L.map(l => [p, l]))]
    .map(([p, l]) => [p, l, moveForLine(l, null)]).filter(([p, , m]) => m && m !== p);
  const SX = { s: { produced_bnb: 0.01, bobai_units: 1e6, value_after_bnb: 1, width_pct: 8, one_sided: true, sweeping: 1, token: 'USD1', bnb_equivalent: 0.001 }, d: { availableBnb: 0.02 }, n: { tokenId: 1, tier: 0, usd: 120 } };
  const more = Object.fromEntries(Object.entries(REACT_MORE).map(([k, f]) => [k, f(SX)]));
  wrong.push(...Object.entries(more).flatMap(([k, L]) => L.map(l => [k, l, moveForLine(l, null)])).filter(([k, , m]) => m && !(k === 'nft' && m === 'nft')));
  return { reactMore: Object.fromEntries(Object.entries(more).map(([k, L]) => [k, L.length])), combo: n(COMBO), moodJokes: n(MOOD_JOKES), moodBuild: n(MOOD_BUILD), heads: n(MOOD_HEADS), who: n(MOOD_WHO), moveLines: n(MOVE_LINES), win: Object.fromEntries(Object.entries(WIN_LINES).map(([k, v]) => [k, v[1].length])),
    lists: { HELLO: HELLO.length, STRETCH: STRETCH.length, BUILD: BUILD.length, TAPS: TAPS.length, INVITES: INVITES.length, JOKES: JOKES.length, HOVER_LINES: HOVER_LINES.length }, wrong, said: SAID.size };
};
function afterWindow() {
  const k = lastWin; lastWin = null;
  const l = k && WIN_LINES[k], now = performance.now();
  (window.__btWin = window.__btWin || []).push([k, !!l, mode, QUEUE.length, Math.round(sceneUntil - now), Math.round((LIFE.winAt || 0) - now)]); // for checks from outside
  if (!l || winTalked.has(k) || mode !== 'live' || QUEUE.length || now < sceneUntil || now < (LIFE.winAt || 0)) return;
  winTalked.add(k); LIFE.winAt = now + 40e3;
  // an answer to the visitor goes before his own idle move (one caught mid-move stood frozen through the window); the chain still goes first
  setTimeout(() => { if (QUEUE.length || performance.now() < sceneUntil || document.body.classList.contains('bp-winon')) return; setPose(flowPose(l[0]) === l[0] ? l[0] : poseOr(l[0]), 6); /* a move known by its clip alone (nft) plays too */ speak(vary(l[1]), 5400); LIFE.next = Math.max(LIFE.next, performance.now() + 30e3); }, 700);
}
// the first words when a builder opens the terminal
// HE KNOWS YOU CAME BACK (2026-09-28, operator: "more intelligent, more alive, more real"): this browser keeps when
// it last saw him (only here, never sent anywhere). A visitor who returns after 20 minutes or more is told what
// happened in between — the burn runs, the BOBAI burned, the trades and the price, all from the record he shows.
const SEEN_KEY = 'bobai-bt-seen';
let seenBefore = 0;
try { seenBefore = +localStorage.getItem(SEEN_KEY) || 0; } catch {}
function markSeen() { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {} }
function sinceWords(ms) { const m = Math.round(ms / 60e3), h = Math.round(ms / 3600e3), d = Math.round(ms / 86400e3); return m < 90 ? m + ' minutes' : h < 36 ? h + ' hours' : Math.max(2, d) + ' days'; } // from 36 hours on it is days, and never "1 days" (2026-10-05: 35.6 h read "1 days away")
// ONLY REAL, CURRENT FIGURES (operator, 2026-09-29: "he told me 0 burns, everything 0, though a lot happened — if he
// says it, the data must be correct and current"): on a slow connection he greeted before the trade ledger had come
// and counted from the few swaps the page had seen itself. He now speaks only once the burn record, the NFT drops and
// the ledger (CH.src 'ledger') are in, and names what did happen: buys and sells, NFT drops, liquidity added, the burn
// runs — and with no run in between, how far the next buyback has charged instead of a bare "no burn".
const backReady = () => S.burns.length > 0 && CH.src === 'ledger' && CH.rows.length > 0 && !!S.nft && S.price > 0;
function welcomeBack() {
  const since = seenBefore, gap = Date.now() - since;
  if (!since || gap < 20 * 60e3 || gap > 30 * 86400e3 || !backReady()) return null;
  const bits = awayBits(since);
  const sw = sinceWords(gap), chg = Math.round(clamp(S.queued / MIN_DISPATCH, 0, 1) * 100);
  return bits ? vary('v22', [`Welcome back, builder! Since you were here ${sw} ago: ${bits}.`, `There you are again! In the ${sw} you were gone: ${bits}.`,
    `Good to see you back. ${sw} away, and the chain kept me busy: ${bits}.`, `Welcome back! Your ${sw} away, in short: ${bits}.`, `Back for more? Since your last visit ${sw} ago: ${bits}.`])
    : vary('v23', [`Welcome back, builder! A quiet ${sw} since you were here. The next buyback is ${chg}% charged.`, `There you are again! ${sw} of calm since your last visit. The next buyback is ${chg}% charged.`,
      `Good to see you back. A calm ${sw} on the chain; the next buyback is ${chg}% charged.`, `Welcome back! Not much happened in ${sw}. The tax kept charging: the next buyback is at ${chg}%.`, `Back for more? A slow ${sw} since you left, and the next buyback is ${chg}% charged.`]);
}
function awayBits(since) {
  const runs = S.burns.filter(e => Date.parse(e.time) > since), burned = runs.reduce((a, e) => a + (+e.bobaiBurned || 0), 0);
  const rows = CH.rows.filter(r => r.t > since), buys = rows.reduce((a, r) => a + (r.b || 0), 0), sells = rows.reduce((a, r) => a + (r.s || 0), 0);
  const before = [...CH.rows].reverse().find(r => r.t <= since), last = CH.rows[CH.rows.length - 1];
  const ch = before && last ? usdCh({ o: before.c, ou: before.u }, last) : null; // in USD (2026-10-04)
  const drops = (S.nft?.drops || []).filter(n => n.ts * 1000 > since).length; // S.nft is null until its state was read (2026-10-09)
  const liqBnb = S.liq.filter(l => Date.parse(l.time) > since).reduce((a, l) => a + (+l.bnb || 0), 0);
  const man = S.man.filter(l => Date.parse(l.time) > since), manBnb = man.reduce((a, l) => a + (+l.bnb || 0), 0), manBob = man.reduce((a, l) => a + (+l.bobai || 0), 0);
  const bits = [];
  // away longer than the ledger reaches back (seven days) or than the drop list is long: the count is said as what it
  // is (2026-10-05: twelve days away, and a week's trades were told as the twelve days')
  const from = CH.rows[0]?.t || 0, short = from > since + 3600e3, all = S.nft?.drops || [], dropsCut = all.length >= 100 && drops === all.length;
  if (buys || sells) bits.push(`${nf(buys)} buy${buys === 1 ? '' : 's'} and ${nf(sells)} sell${sells === 1 ? '' : 's'}${short ? ` in the last ${sinceWords(Date.now() - from)} alone` : ''}`);
  if (ch != null && Math.abs(ch) >= 0.1) bits.push(`price ${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%`);
  if (runs.length) bits.push(`${runs.length} burn run${runs.length > 1 ? 's' : ''}, ${cmp(burned)} BOBAI burned`);
  if (liqBnb > 0) bits.push(`${bnbF(liqBnb)} into liquidity, LP burned`);
  if (manBnb > 0) bits.push(`the dev wallet added ${bnbF(manBnb)} + ${cmp(manBob)} BOBAI to the pool`);
  if (drops) bits.push(`${dropsCut ? 'more than ' : ''}${drops} NFT drop${drops > 1 ? 's' : ''}`);
  if (!runs.length) bits.push(`the next buyback is ${Math.round(clamp(S.queued / MIN_DISPATCH, 0, 1) * 100)}% charged`);
  return bits.length === 1 && !runs.length ? null : bits.join(', '); // null: nothing happened but the charge
}
// THE SAME, FOR A TAB THAT WAS IN THE BACKGROUND (2026-09-29): ten minutes or more away, he waves and says what happened
// meanwhile — once the ledger and the logs have been read again, and never over a moment of the chain
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const since = hiddenAt; hiddenAt = 0;
  if (!opened || !since || Date.now() - since < 10 * 60e3) return;
  const fresh = Promise.allSettled([loadCandles(), logs(), trades()]);
  const tell = (tries = 0) => {
    if (document.hidden) return;
    // a move of his own still playing: wait for its end, then the wave (2026-09-30: more active, so a return landed mid-move
    // more often, and vidWave refused — the 'Back!' line came without the wave)
    if ((mode !== 'live' || QUEUE.length || performance.now() < sceneUntil || VID.go || ownBusy() || !backReady()) && tries < 20) return setTimeout(() => tell(tries + 1), 1500);
    if (mode !== 'live') return;
    const bits = awayBits(since), span = sinceWords(Date.now() - since);
    // five ways each to say it (2026-10-02); always starting "Back!" or another short hello, then the real record
    const chg = Math.round(clamp(S.queued / MIN_DISPATCH, 0, 1) * 100);
    const line = bits ? vary('v24', [`Back! In the ${span} you were away: ${bits}.`, `Back already? While you were gone for ${span}: ${bits}.`, `There you are! ${span} away, and here is what you missed: ${bits}.`,
      `Welcome back! The last ${span} on my chain: ${bits}.`, `Missed you! In ${span}: ${bits}.`])
      : vary('v25', [`Back! A quiet ${span} on the chain. The next buyback is ${chg}% charged.`, `Back already? ${span} of calm. The next buyback is ${chg}% charged.`, `There you are! A slow ${span}, nothing big. The next buyback is ${chg}% charged.`,
        `Welcome back! ${span} without much action. The tax kept charging: the next buyback is at ${chg}%.`, `Missed you! A calm ${span} here. The next buyback is ${chg}% charged.`]);
    const waved = vidWave(); if (waved && VID.want) { HELD = { text: line, ms: 8000 }; LIFE.sayUntil = performance.now() + 16000; } else speak(line, 8000);
    LIFE.next = Math.max(LIFE.next, performance.now() + 30e3);
  };
  fresh.then(() => setTimeout(tell, 1500));
});
let SAID_HI = false;
function greet(tries = 0) {
  if (SAID_HI) return;
  // a returning visitor is greeted with what happened: wait for the record (up to ~12 s), never count from half of it
  const gap = Date.now() - seenBefore;
  if (seenBefore && gap >= 20 * 60e3 && gap <= 30 * 86400e3 && !backReady() && tries < 24) { setTimeout(() => greet(tries + 1), 500); return; }
  // THE CLIP LIST STILL ON ITS WAY (2026-10-05, a slow first visit: the list came at 19 s, the greeting was due at 14 s):
  // with no clip known the wave was refused and he said his hello standing still. The greeting waits for the list, in
  // all up to ~12 s; a moment of the chain that took the stage meanwhile goes first (qa/latelist.mjs)
  if (!VID.listed && VID.v && !REDUCED && tries < 24) { setTimeout(() => greet(tries + 1), 500); return; }
  if (tries && (mode !== 'live' || QUEUE.length || performance.now() < sceneUntil) && tries < 40) { setTimeout(() => greet(tries + 1), 500); return; }
  SAID_HI = true; LIFE.saidHi = true; // once per visit, however often the terminal is shown again
  // FIVE HELLOS FOR EACH TIME OF DAY, SIX WAYS ON (operator, 2026-10-02: "the greeting is almost always the same")
  const h = new Date().getHours(), hi = pick(h < 11 ? ['gm', 'Good morning', 'Morning', 'gm gm', 'Rise and shine'] : h < 17 ? ['Hey', 'Hi there', 'Hello', 'Good afternoon', 'Welcome'] : h < 22 ? ['Good evening', 'Evening', 'Hey there', 'Hi', 'Welcome in'] : ['Still up? Me too, always', 'Night owl', 'Late shift', 'Hello, night builder', 'Up late? Same here']);
  // A CALM START (2026-09-28, operator: "right after loading it is all nervous and wrong — too many wrong animations
  // at once"): a joy move for the greeting, his first own move right after it (LIFE.next was 0) and the bots' work
  // lines all landed in the first 20 s. Now he waves once — the line comes with the wave — and then stands in his calm
  // rest takes: his own moves begin after 45 s, the work lines after 90 s. The chain's real moments still show.
  const t = performance.now(); LIFE.next = Math.max(LIFE.next, t + 45e3); LIFE.workAt = Math.max(LIFE.workAt || 0, t + 90e3);
  const back = welcomeBack(), ms = back ? 8000 : 7000;
  LIFE.greetUntil = performance.now() + 8000 + ms; // the wave and its line: no joke cuts in (jokeReady)
  const line = back || vary('v26', [`${hi}, builder! I am BOBAI. Everything you see here is me, working live on BNB Chain. Tap me or anything around me.`,
    `${hi}! I am BOBAI, a brain on BNB Chain. Every flash here is a real trade, burn or bot of mine. Tap around.`,
    `${hi}, builder! BOBAI here, welcome to my terminal. All of it is live from BNB Chain. Tap me and I tell you what I am doing.`,
    `${hi}! BOBAI here. The circles around me are my bots, the chart is my pool. Tap anything you are curious about.`,
    `${hi}, friend! I am BOBAI, and this is me at work on BNB Chain, live. Tap a circle and I show you what it did.`,
    `${hi}! You caught me working. I am BOBAI, every number here comes straight from BNB Chain. Tap me any time.`]);
  // his first clip IS the wave: until the greeting he stands in the still under the boot title (GREETED), so the wave
  // does not wait out a rest take that began a few seconds before it (the greeting came at 15 s, 2026-09-28)
  GREETED = true;
  const ent = !VID.on && enterTake();
  if (ent) { // his entrance first, then the wave with the line (held until the wave's first frame, at most 18 s)
    try { localStorage.setItem('bobai-bt-enter', ent); } catch {}
    VID.move = 'enter'; vidStart(ent); const w = waveTake(); VID.waveC = null;
    if (w) { VID.want = { p: 'idle', c: w }; prefetchClip(w); }
    HELD = { text: line, ms }; LIFE.sayUntil = t + 16000 + ms; LIFE.greetUntil += 9000; LIFE.next += 9000; setTimeout(flushSay, 18000);
    markSeen(); setInterval(() => { if (!document.hidden) markSeen(); }, 60e3); return;
  }
  const waved = vidWave(); // started at once from the still, or queued after a rest take
  trace('greet', waved, VID.on, VID.cur, !!VID.want);
  if (waved && VID.want) { HELD = { text: line, ms }; LIFE.sayUntil = t + 8000 + ms; }
  // from the still the wave still has to load (~2 s on a first visit): the line waits for its first frame too (flushSay in
  // vidStart), at most 8 s (flow.mjs 2026-09-29: the line came 2 s before the wave)
  else if (waved && !VID.on) { HELD = { text: line, ms }; LIFE.sayUntil = t + 8000 + ms; setTimeout(flushSay, 8000); }
  else { speak(line, ms); if (!waved && !VID.cur) vidRest(); } // VID.on turns true only once play() resolves: not a sign of no wave
  markSeen(); setInterval(() => { if (!document.hidden) markSeen(); }, 60e3);
}

const cineEl = $('cine');
function cine(small, big, color, t, fast) {
  cineEl.querySelector('.a').textContent = small; cineEl.querySelector('.b').textContent = big;
  cineEl.querySelector('.t').textContent = Date.now() - t > 120e3 ? new Date(t).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase() : 'JUST NOW';
  cineEl.style.setProperty('--c', color); cineEl.style.setProperty('--d', fast ? '1.9s' : '3.2s');
  cineEl.classList.remove('go'); void cineEl.offsetWidth; cineEl.classList.add('go');
}
function hitDest(k) {
  const d = D[k]; d.boost = 1.2; fire(d.pos, new THREE.Color(d.c));
  shock(d.pos, d.c, d.R * 2.2 * d.mScale); // no camera lean per station: six hits in a row read as a shake (operator, 2026-10-01: "no wobbles")
  d.el.classList.remove('hit'); void d.el.offsetWidth; d.el.classList.add('hit');
}


// ---------- live trades straight from the pool ----------
// Swaps from before the page opened, from the pool's own Swap logs (2026-09-25, operator: everything on-chain,
// so no rate limit or outage of someone else's API leaves the brain blank). A free node serves logs for about the
// last 8,000 blocks (~1 hour); older ranges need an archive token, so the swap lane reaches back that far and the
// rest of the record (burns, liquidity, agent, NFT drops, payouts) comes from our own logs as before.
const BACK_BLOCKS = 7500, BACK_CHUNK = 2500;
// The token contract swaps the tax it has collected to BNB now and then, inside someone's trade; that swap
// is BOBAI at work, not a trader selling. It announces itself with this event, whose first word is the
// BOBAI it swapped — read on-chain 2026-09-25 (tx 0x45b2…b3d8: 558,189 BOBAI → 0.1518 BNB → the 01:21 run).
const TAXSWAP = '0x4ecbb010c79223623fc0a5fd2d955ed432e0d426d06c525f5a1bf8e344753bae';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
function swapOf(l, t) {
  const w = l.data.slice(2).match(/.{64}/g).map(h => Number(BigInt('0x' + h)) / 1e18);
  const [a0in, a1in, a0out, a1out] = w;
  const bnbIn = S.token0IsBobai ? a1in : a0in, bnbOut = S.token0IsBobai ? a1out : a0out;
  const bobaiIn = S.token0IsBobai ? a0in : a1in, bobaiOut = S.token0IsBobai ? a0out : a1out;
  const buy = bnbIn > 0, bnb = buy ? bnbIn : bnbOut, usd = bnb * S.bnbP;
  const who = '0x' + (l.topics[2] || '').slice(26).toLowerCase(), ours = OURS.includes(who);
  // one id per swap, not per transaction: a tax swap and the trade that set it off share one
  const x = { id: 't' + l.transactionHash + ':' + parseInt(l.logIndex, 16), t, kind: 'trade', buy, usd, bnb, bobai: buy ? bobaiOut : bobaiIn, ours, who, tx: l.transactionHash };
  const sw = S.taxSw.get(l.transactionHash);
  if (sw && !buy && Math.abs(x.bobai - sw) <= sw * 1e-6) { x.ours = true; x.who = 'tax'; x.taxSwap = true; }
  return x;
}
// ONE BUY PER TRANSACTION, AS THE TELEGRAM ALERT (2026-09-29, worker-tg-bot foldBuysByTx): an aggregator splits one buy
// into several swaps; the alert, its tier and its NFT go by their sum. Here each swap was a buy of its own: a $150 buy
// in two halves showed no scene at all, a $600 WHALE two HUGE ones.
function foldBuys(list) {
  const out = [], by = new Map();
  for (const x of list) {
    if (x.buy && !x.ours) { const y = by.get(x.tx); if (y) { y.usd += x.usd; y.bnb += x.bnb; y.bobai += x.bobai; y.swaps = (y.swaps || 1) + 1; continue; } by.set(x.tx, x); }
    out.push(x);
  }
  return out;
}
// the tax swaps in the same block range, read before the swaps so they can be told apart
function takeTaxSwaps(logs) {
  for (const l of logs || []) S.taxSw.set(l.transactionHash, Number(BigInt('0x' + l.data.slice(2, 66))) / 1e18);
}
async function backfill() {
  if (!S.block || !S.bnbP) return;
  const head = S.block, lo = head - BACK_BLOCKS;
  // block times from two recent headers, so every swap lands on its minute without a header read per swap
  const [hA, hB] = await rpc([['eth_getBlockByNumber', ['0x' + head.toString(16), false]], ['eth_getBlockByNumber', ['0x' + (head - 2000).toString(16), false]]], LOGS_RPCS);
  const tA = parseInt(hA.timestamp, 16) * 1000, msPer = (tA - parseInt(hB.timestamp, 16) * 1000) / 2000;
  const calls = [], taxCalls = [];
  for (let a = lo; a < head; a += BACK_CHUNK) {
    const range = { fromBlock: '0x' + a.toString(16), toBlock: '0x' + Math.min(head, a + BACK_CHUNK - 1).toString(16) };
    calls.push(['eth_getLogs', [{ address: P, topics: [SWAP], ...range }]]); taxCalls.push(['eth_getLogs', [{ address: BOBAI, topics: [TAXSWAP], ...range }]]);
  }
  const all = await rpc([...taxCalls, ...calls], LOGS_RPCS);
  // A public node answers a busy batch with an error for some of its parts, and a part without a result used to be
  // a silent gap: the same page showed 846 events on one device and 393 on another at the same minute
  // (2026-09-27). Each part that came back empty-handed is asked again on its own, on the node's second address.
  const asked = [...taxCalls, ...calls];
  for (let i = 0; i < asked.length; i++) if (all[i] == null) {
    for (const u of ['https://bsc-rpc.publicnode.com', LOGS_RPC]) {
      try { const [r] = await rpc([asked[i]], u); if (r != null) { all[i] = r; break; } } catch {}
      await new Promise(r => setTimeout(r, 400));
    }
  }
  const res = all.slice(taxCalls.length);
  for (const logs of all.slice(0, taxCalls.length)) takeTaxSwaps(logs);
  const out = foldBuys(res.flatMap(logs => (logs || []).map(l => swapOf(l, tA - (head - parseInt(l.blockNumber, 16)) * msPer))))
    .filter(x => x.ours || x.usd >= 1); // dust: bots poking the pool for cents
  S.hist = out; S.histFrom = tA - BACK_BLOCKS * msPer; S.backHead = head;
  return out;
}
// A $100+ buy mints an NFT (worker-nft-mint, once a minute). Its window opens AT ONCE (operator, 2026-09-28: the wait
// for the mint was too long) with a MINTING sticker; this watch finds the drop and slaps the card on (mintArrived).
// The record keeps the drop in the buy's place, so a replay plays the buy once, with its card.
function watchMint(x) {
  const tx = x.tx.toLowerCase(), until = Date.now() + 100e3;
  const look = async () => {
    const st = await getJSON(SITE + '/api/nft/state?t=' + Date.now()).catch(() => null);
    const n = (st?.drops || []).find(d => (d.buyTx || '').toLowerCase() === tx);
    if (n) { S.nft = st; x.drop = n; const e = { id: 'n' + n.tokenId, t: x.t, kind: 'nft', n }; const i = events.indexOf(x); if (i >= 0) events[i] = e; else events.push(e); mintArrived(x, n); return; }
    if (Date.now() < until) setTimeout(look, 6e3);
    else if (mintWaitX === x) { mintWaitX = null; stkHide(); closeMomentIn(1200); }
  };
  setTimeout(look, 12e3);
}
let TR_OK = 0; // when trades() last read the chain in full
async function trades() {
  if (!S.block) return;
  try {
    const [head] = await rpc([['eth_blockNumber', []]], LOGS_RPCS);
    const to = parseInt(head, 16); if (to <= S.block) return;
    // A TAB THAT COMES BACK (2026-09-29): a hidden page stops asking, and only the last 3,000 blocks were read on its
    // return — the buys of a longer absence were lost, even to the replay. The gap is read in 2,500-block steps as far
    // as the free node reaches (7,500, ~1 hour); what is older than two minutes joins the record quietly, for the replay
    // and his "while you were away", instead of playing as if it happened now.
    const from = Math.max(S.block + 1, to - BACK_BLOCKS), calls = [];
    for (let a = from; a <= to; a += BACK_CHUNK) {
      const range = { fromBlock: '0x' + a.toString(16), toBlock: '0x' + Math.min(to, a + BACK_CHUNK - 1).toString(16) };
      calls.push(['eth_getLogs', [{ address: BOBAI, topics: [TAXSWAP], ...range }]], ['eth_getLogs', [{ address: P, topics: [SWAP], ...range }]], ['eth_getLogs', [{ address: P, topics: [SYNC], ...range }]]);
    }
    const got = await rpc(calls, LOGS_RPCS);
    if (got.some(r => r == null)) return; // a part not answered: ask again next time, from the same block
    // AWAY = the tab was hidden or not asking (2026-10-01): a node that skipped a few answers in a bull run used to turn
    // buys older than two minutes into record-only — while the visitor sat watching. Polled steadily, they still play.
    const away = Date.now() - TR_OK > 90e3; TR_OK = Date.now();
    for (let i = 0; i < got.length; i += 3) takeTaxSwaps(got[i]);
    const logsR = got.filter((_, i) => i % 3 === 1).flat();
    // THE PRICE MOVES WITH THE TRADE (operator, 2026-10-02: "with buys or sells the chart does not update live — the
    // timeline is fast"): the open chart's live candle closed at S.price, read every 20 s — and then often from the
    // homepage's numbers, up to a minute old — so a trade moved its high and low and the close snapped back. The pair's
    // last Sync in these blocks carries the reserves after the trade: the price from them, the same formula as chain().
    const sy = got.filter((_, i) => i % 3 === 2).flat().sort((a, b) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) || parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16)).pop();
    if (sy && S.bnbP > 0) {
      const r0 = BigInt('0x' + sy.data.slice(2, 66)), r1 = BigInt('0x' + sy.data.slice(66, 130)), bR = S.token0IsBobai ? r0 : r1, wR = S.token0IsBobai ? r1 : r0;
      if (bR > 0n) { S.price = Number(wR) / Number(bR) * S.bnbP; S.priceAt = Date.now(); LIFE.prices.push([Date.now(), S.price]); if (LIFE.prices.length > 400) LIFE.prices.shift(); CH.dirty = true; }
    }
    S.block = to;
    const nowMs = Date.now(), dropped = new Set((S.nft?.drops || []).map(n => (n.buyTx || '').toLowerCase()).filter(Boolean));
    for (const x of foldBuys(logsR.map(l => swapOf(l, nowMs - (to - parseInt(l.blockNumber, 16)) * 450)))) { // 0.45 s a block
      const { buy, usd, ours } = x;
      if (usd < 1) continue;
      const col = buy ? BUYC : SELLC;
      if (events.some(e => e.id === x.id) || S.hist.some(e => e.id === x.id)) continue;
      if (away && x.t < nowMs - 120e3) { S.hist.push(x); if (isAlert(x) && !(x.buy && dropped.has(x.tx.toLowerCase()))) events.push(x); continue; } // missed while away: the record only
      x.t = nowMs; S.hist.push(x); chartSwap(x); // every swap shows on the chart, however small
      // below the alert line: no scene, but the trade is SEEN — a light runs from the trades into the brain, green for a
      // buy, red for a sell, its size the trade's (2026-09-26, the core: "the blockchain visible, in the flow")
      if (!isAlert(x)) {
        tradeDot(x);
        // HE NOTICES THE MIDDLE-SIZED TRADES TOO (2026-09-29): a buy or a sell of $50+ gets a line and a move (the lines were
        // written but never called); react() keeps it to one in 90 s, and never over a scene of the chain
        if (!ours && usd >= 50 && mode === 'live' && !QUEUE.length && performance.now() >= sceneUntil && !VID.go) react(buy ? 'buy' : 'sell', x);
        continue;
      }
      x.lit = performance.now(); events.push(x);
      if (ours) {
        if (x.taxSwap) react('tax', x);
        if (x.taxSwap) logLine('BOBAI', '#F0B90B', ['the token contract swapped ', [bobaiAmt(x.bobai)], ' of collected tax to ', [bnbF(x.bnb)], ' for the buyback bot'], [['tx', x.tx]]);
        else logLine('BOBAI', '#F0B90B', [whoTraded(x), [buy ? 'bought' : 'sold'], ' $' + nf(usd, 2) + ' of BOBAI'], [['tx', x.tx]]);
        fire(A.core, new THREE.Color('#F0B90B')); continue;
      }
      chain().catch(() => {}); // his line comes with the buy's own scene (run), not when it is read: queued behind another
      // scene, it was said seconds before his move (flow.mjs 'line comes with the move', 2026-09-29)
      if (buy) { x.mint = true; watchMint(x); }
      enqueue(x); // its scene plays in turn: comet, log line, the tier's moment
    }
  } catch {}
}

// ---------- BOBAI's chart, quietly behind him (2026-09-26, operator: "everyone talks about charts — show ours") ----------
// Green and red candles of the BOBAI/BNB pool, faint enough that he and the brain stay in front. The record is the TG
// bot's own 24-hour ledger (one bucket every ten minutes: the close from the pool's reserves, the wicks from the swaps'
// own prices); no chart site in between. The candle forming now is live: it opens at the last close, follows the
// pool's price as this page reads it, and every swap lands on it as a small flash — each trade is seen, however small.
const CANDLES_URL = new URLSearchParams(location.search).get('candles') || 'https://bobai-tg-bot.bobbuildonbnb.workers.dev/candles';
const CH = { rows: [], min: 10, live: null, flashes: [], drawn: 0, dirty: true };
const chartCv = document.createElement('canvas'); chartCv.className = 'chart'; chartCv.setAttribute('aria-hidden', 'true');
win.insertBefore(chartCv, fig);
const chartX = chartCv.getContext('2d');
const pxBnb = () => S.price > 0 && S.bnbP > 0 ? S.price / S.bnbP : 0;
async function loadCandles() {
  try {
    const j = await getJSON(CANDLES_URL, 12000);
    if (Array.isArray(j?.rows) && j.rows.length) { CH.rows = j.rows.filter(r => r.c > 0).sort((a, b) => a.t - b.t); CH.min = j.minutes || 10; CH.src = 'ledger'; CH.dirty = true; try { if (opened) readMood(); } catch {} return; } // the chip shows at once
  } catch {}
  // no ledger: the hour of swaps this page read itself, in the same ten-minute buckets
  if (CH.src === 'ledger') return;
  const rows = [], ms = CH.min * 60e3;
  for (const x of [...S.hist].sort((a, b) => a.t - b.t)) {
    if (!(x.bnb > 0 && x.bobai > 0)) continue;
    const k = Math.floor(x.t / ms) * ms + ms, p = x.bnb / x.bobai, r = rows[rows.length - 1];
    if (r && r.t === k) { r.c = p; r.h = Math.max(r.h, p); r.l = Math.min(r.l, p); r.v += x.bnb; r[x.buy ? 'b' : 's']++; }
    else rows.push({ t: k, c: p, h: p, l: p, v: x.bnb, b: x.buy ? 1 : 0, s: x.buy ? 0 : 1 });
  }
  CH.rows = rows.filter(r => r.t <= Date.now()); CH.src = 'swaps'; CH.dirty = true;
}
// one candle per bucket: it opens where the one before closed
function candles() {
  const out = []; let prev = null;
  for (const r of CH.rows) {
    const o = prev ? prev.c : r.c;
    out.push({ t: r.t, o, c: r.c, h: Math.max(o, r.c, r.h || 0), l: Math.min(o, r.c, r.l || Infinity), v: r.v || 0, n: (r.b || 0) + (r.s || 0), b: r.b || 0, s: r.s || 0, u: r.u || S.bnbP, ou: (prev ? prev.u : r.u) || S.bnbP, x: r.x || null });
    prev = r;
  }
  // the live candle, from the last close to the price now
  const last = CH.rows[CH.rows.length - 1], now = pxBnb();
  if (last && now > 0) {
    const lv = CH.live && CH.live.since === last.t ? CH.live : (CH.live = { since: last.t, h: Math.max(last.c, now), l: Math.min(last.c, now), v: 0, n: 0 });
    lv.h = Math.max(lv.h, now); lv.l = Math.min(lv.l, now);
    out.push({ t: last.t + CH.min * 60e3, o: last.c, c: now, h: lv.h, l: lv.l, v: lv.v, n: lv.n, b: lv.b || 0, s: lv.s || 0, u: S.bnbP, ou: last.u || S.bnbP, live: true });
  }
  return out;
}
// a swap arrives: it moves the live candle and flashes where it traded
function chartSwap(x) {
  if (!(x.bnb > 0 && x.bobai > 0)) return;
  const p = x.bnb / x.bobai;
  if (CH.live) { CH.live.h = Math.max(CH.live.h, p); CH.live.l = Math.min(CH.live.l, p); CH.live.v += x.bnb; CH.live.n++; if (!x.taxSwap) CH.live[x.buy ? 'b' : 's'] = (CH.live[x.buy ? 'b' : 's'] || 0) + 1; }
  CH.flashes.push({ p, c: x.ours ? '#F0B90B' : x.buy ? BUYC : SELLC, at: performance.now(), usd: x.usd, buy: x.buy, ours: x.ours });
  if (CH.flashes.length > 6) CH.flashes.shift();
  CH.dirty = true;
}
// where it stands: on a wide screen in the open space to his left, above the log, running in behind him like a
// trading screen at his back; on a phone behind him in the top half
function chartBox(w, h) {
  if (portrait) return { x0: w * 0.05, x1: w * 0.95, y0: h * 0.135, y1: h * 0.38, n: 72 };
  const wr = win.getBoundingClientRect(), fr = fig.getBoundingClientRect(), term = document.querySelector('#bt .term');
  const floor = term && term.offsetParent ? term.getBoundingClientRect().top - wr.top - 30 : h - 150;
  return { x0: Math.max(28, w * 0.03), x1: Math.min(w * 0.6, fr.left - wr.left + fr.width * 0.2), y0: Math.max(132, h * 0.19), y1: floor, n: 144 };
}
// IN USD, LIKE EVERY OTHER SCREEN (operator, 2026-10-04: the chip read -6.2 % 24h, DexScreener -4.17 %, Binance -4.16 %):
// the candles are priced in BNB, and BNB itself had gained 2.6 % that day. Each end is priced with BNB's dollar rate of
// its own time (u at the close, ou at the open), so a change is what a holder's dollars did.
// BNB's dollar rate at a time: the ledger candle that holds it, the live rate for the last minutes (minute candles of the
// 1H views carried today's rate on both ends, so their change stayed a BNB change)
function bnbAt(t) {
  if (t >= Date.now() - CH.min * 60e3) return S.bnbP;
  let u = 0; for (const r of CH.rows) { if (r.t > t) break; if (r.u) u = r.u; }
  return u || S.bnbP;
}
function usdCh(a, b) {
  const o = a?.o * (a?.ou || a?.u || S.bnbP), c = b?.c * (b?.u || S.bnbP);
  return o > 0 && c > 0 ? (c / o - 1) * 100 : null;
}
// AGAINST THE PRICE EXACTLY 24 HOURS AGO (operator, 2026-10-09: "terminal, Binance Web3 and DexScreener all show a
// different 24h %"): the reference was the open of the first candle inside the window, up to twenty minutes after
// "a day ago". Now it is the ledger's close at or before now − 24 h, priced with BNB's dollar rate of that moment, as
// the chart sites count it. What is left between the sites is mostly each one's own BNB/USD rate: on a day BNB moves
// 2-3 %, that moves every BOBAI figure in USD while BOBAI against BNB barely moves (bnbChange says which it was).
function dayRef(cs) {
  const t0 = Date.now() - 86400e3; let ref = null;
  for (const c of cs) { if (c.t > t0) break; ref = c; }
  return ref ? { o: ref.c, ou: ref.u } : cs[0];
}
function chartChange(cs) {
  return usdCh(dayRef(cs), cs[cs.length - 1]);
}
function bnbChange(cs) {
  const a = dayRef(cs), b = cs[cs.length - 1];
  return a?.o > 0 && b?.c > 0 ? { vb: (b.c / a.o - 1) * 100, bnb: ((b.u || S.bnbP) / (a.ou || a.u || S.bnbP) - 1) * 100 } : null;
}
function drawChart(now) {
  if (!opened) return;
  const flashing = CH.flashes.some(f => now - f.at < 2600);
  if (!CH.dirty && !flashing && now - CH.drawn < 1000) return;
  CH.drawn = now; CH.dirty = false;
  const r = win.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  if (chartCv.width !== Math.round(r.width * dpr) || chartCv.height !== Math.round(r.height * dpr)) { chartCv.width = Math.round(r.width * dpr); chartCv.height = Math.round(r.height * dpr); }
  const g = chartX; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
  const all = candles(); if (all.length < 2) return;
  const B = chartBox(r.width, r.height), cs = all.slice(-B.n), n = B.n;
  let lo = Infinity, hi = 0, vmax = 0;
  for (const c of cs) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); vmax = Math.max(vmax, c.v); }
  for (const f of CH.flashes) { lo = Math.min(lo, f.p); hi = Math.max(hi, f.p); }
  // a quiet day still gets room: at least ±0.6% around the middle, so one trade does not look like a crash
  const mid = (hi + lo) / 2, span = Math.max(hi - lo, mid * 0.012), pad = span * 0.12;
  lo = mid - span / 2 - pad; hi = mid + span / 2 + pad;
  const vH = (B.y1 - B.y0) * 0.16, pY = B.y1 - vH - 6;
  const Y = p => B.y0 + (1 - (p - lo) / (hi - lo)) * (pY - B.y0);
  const step = (B.x1 - B.x0) / n, bw = Math.max(1.4, Math.min(7, step * 0.62)), X = i => B.x1 - (cs.length - 1 - i) * step - step / 2;
  const mono = 'ui-monospace,Consolas,monospace';
  // hour lines, as faint as the brain's own grid
  g.font = '600 8.5px ' + mono; g.textAlign = 'center';
  for (let i = 0; i < cs.length; i++) {
    const d = new Date(cs[i].t - CH.min * 60e3); if (d.getMinutes() !== 0 || d.getHours() % (portrait ? 3 : 2)) continue;
    g.fillStyle = 'rgba(198,143,118,.06)'; g.fillRect(X(i), B.y0, 1, B.y1 - B.y0);
    g.fillStyle = 'rgba(160,162,192,.32)'; g.fillText(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), X(i), B.y1 + 10);
  }
  // volume, a whisper of gold along the floor
  for (let i = 0; i < cs.length; i++) { const c = cs[i]; if (!c.v || !vmax) continue; const vh = Math.max(1, Math.sqrt(c.v / vmax) * vH); g.fillStyle = 'rgba(240,185,11,.16)'; g.fillRect(X(i) - bw / 2, B.y1 - vh, bw, vh); }
  // the candles: green up, red down; a bucket without a trade is a short grey dash
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i], x = X(i), up = c.c >= c.o, flat = Math.abs(c.c - c.o) < mid * 2e-5 && !c.n;
    const col = flat ? 'rgba(160,162,192,.35)' : up ? BUYC : SELLC;
    g.globalAlpha = c.live ? 0.9 : 0.62;
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(c.h)); g.lineTo(Math.round(x) + 0.5, Y(c.l)); g.stroke();
    const y0 = Y(Math.max(c.o, c.c)), hgt = Math.max(1.2, Y(Math.min(c.o, c.c)) - y0);
    if (!flat) { g.shadowColor = col; g.shadowBlur = c.live ? 10 : 4; }
    g.fillStyle = col; g.fillRect(x - bw / 2, y0, bw, hgt); g.shadowBlur = 0;
  }
  g.globalAlpha = 1;
  // the price now: a dashed line across; the price and the day's change stand in the chart's head
  const last = cs[cs.length - 1], ly = Y(last.c), ch = chartChange(all), upc = (ch ?? 0) >= 0;
  g.setLineDash([3, 5]); g.strokeStyle = 'rgba(240,185,11,.3)'; g.beginPath(); g.moveTo(B.x0, ly + 0.5); g.lineTo(B.x1, ly + 0.5); g.stroke(); g.setLineDash([]);
  g.textAlign = 'left'; g.font = '700 9px ' + mono; g.fillStyle = 'rgba(160,162,192,.6)';
  const hd = '$BOBAI  ', hw = g.measureText(hd).width; g.fillText(hd, B.x0, B.y0 - 10);
  g.font = '700 13px "Space Grotesk",sans-serif'; g.fillStyle = '#f3efe6'; const pt = '$' + (S.price ? S.price.toPrecision(4) : '—'); g.fillText(pt, B.x0 + hw, B.y0 - 10);
  const pw = g.measureText(pt).width;
  g.font = '700 10px ' + mono; const cht = ch != null ? (upc ? '▲ +' : '▼ ') + ch.toFixed(2) + '% 24H' : '';
  if (cht) { g.fillStyle = upc ? BUYC : SELLC; g.fillText(cht, B.x0 + hw + pw + 10, B.y0 - 10); }
  g.font = '600 8px ' + mono; g.fillStyle = 'rgba(160,162,192,.38)';
  cxOpen.style.left = (portrait ? B.x1 - 110 : B.x0) + 'px'; cxOpen.style.top = (portrait ? B.y0 - 24 : B.y1 + 4) + 'px'; cxOpen.classList.add('show');
  if (!portrait) g.fillText('· ' + CH.min + ' MIN CANDLES FROM THE POOL', B.x0 + hw + pw + 20 + (cht ? g.measureText(cht).width * 1.25 : 0), B.y0 - 10);
  // every swap flashes where it traded: a ring on the live candle and its size
  for (const f of CH.flashes) {
    const k = (now - f.at) / 2600; if (k < 0 || k > 1) continue;
    const x = X(cs.length - 1), y = Y(f.p);
    g.globalAlpha = 1 - k; g.strokeStyle = f.c; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 3 + k * 18, 0, 7); g.stroke();
    g.fillStyle = f.c; g.font = '700 10px ' + mono; g.textAlign = 'right';
    g.fillText((f.ours ? 'BOBAI ' : f.buy ? '▲ ' : '▼ ') + '$' + nf(f.usd, f.usd < 10 ? 2 : 0), x - 10, y - 8 - k * 14);
    g.globalAlpha = 1; g.textAlign = 'left';
  }
}

// ---------- the chart, full size (2026-09-26, operator: "so good that people would rather watch it here than on
// Binance or DexScreener") ----------
// One tap opens it: the same pool, larger, with a crosshair and every candle's figures — and what no chart site can
// show: BOBAI's own work on the candles where it happened. A burn, a liquidity add, a step of the DeFi agent, an NFT
// drop sit as marks under their candle, so the chart says not only how the price moved but what BOBAI did meanwhile.
// 24H and 6H are the ledger's ten-minute candles; 1H is one-minute candles from the swaps this page read itself.
const CX = { on: false, tf: '24H', hover: -1, liqUsd: 0 };
const cxEl = document.createElement('div'); cxEl.className = 'chartx'; cxEl.setAttribute('role', 'dialog'); cxEl.setAttribute('aria-label', 'The $BOBAI chart');
cxEl.innerHTML = `<div class="cx-h"><div class="cx-t"><b>$BOBAI</b><span>/ BNB · PANCAKESWAP · LIVE FROM THE POOL</span></div>
  <div class="cx-p"><b class="cx-px">…</b><i class="cx-ch"></i></div>
  <div class="cx-tf"><button type="button" data-tf="1H">1H</button><button type="button" data-tf="6H">6H</button><button type="button" data-tf="24H" class="on">24H</button></div>
  <button type="button" class="cx-x" aria-label="Close the chart">×</button></div>
  <div class="cx-s"></div><div class="cx-c"><canvas></canvas><div class="cx-o"></div></div>
  <div class="cx-k"><span style="--k:${BUYC}">▲ BUY</span><span style="--k:${SELLC}">▼ SELL</span><span style="--k:${D.burnA.c}">◆ BOBAI BURNED</span><span style="--k:#F0B90B">◆ BOBAI SWAP</span><span style="--k:${D.liq.c}">● LIQUIDITY ADDED</span><span style="--k:${D.defi.c}">● DEFI AGENT</span><span style="--k:${D.creator.c}">■ PAYOUT</span><span style="--k:#a78bfa">★ NFT DROP</span><em class="cx-say"></em></div>`;
win.appendChild(cxEl);
const cxCv = cxEl.querySelector('canvas'), cxG = cxCv.getContext('2d');
const cxOpen = document.createElement('button'); cxOpen.type = 'button'; cxOpen.className = 'chart-open'; cxOpen.textContent = 'OPEN CHART ⤢';
win.appendChild(cxOpen);
// the hour of one-minute candles, from the swaps this page read (S.hist), opening at the ledger's price an hour ago
function minuteCandles() {
  const ms = 60e3, end = Math.floor(Date.now() / ms) * ms + ms, start = end - 60 * ms;
  const before = [...CH.rows].reverse().find(r => r.t <= start), sw = S.hist.filter(x => x.bnb > 0 && x.bobai > 0 && x.t >= start).sort((a, b) => a.t - b.t);
  let prev = before ? before.c : sw.length ? sw[0].bnb / sw[0].bobai : pxBnb();
  if (!prev) return [];
  const out = [];
  for (let t = start + ms, i = 0; t <= end; t += ms) {
    const c = { t, o: prev, c: prev, h: prev, l: prev, v: 0, n: 0, b: 0, s: 0, u: bnbAt(t), ou: bnbAt(t - ms) };
    for (; i < sw.length && sw[i].t < t; i++) { const p = sw[i].bnb / sw[i].bobai; c.c = p; c.h = Math.max(c.h, p); c.l = Math.min(c.l, p); c.v += sw[i].bnb; c.n++; c[sw[i].buy ? 'b' : 's']++; }
    if (t === end && pxBnb()) { c.c = pxBnb(); c.h = Math.max(c.h, c.c); c.l = Math.min(c.l, c.c); c.live = true; }
    out.push(c); prev = c.c;
  }
  return out;
}
// by time, not by count: since the ledger keeps a week (2026-09-26) "24H" had shown every candle there was — 30 h
// the next morning, a week by Friday (2026-09-27)
const cxCandles = () => { if (CX.tf === '1H') return minuteCandles(); const from = Date.now() - (CX.tf === '6H' ? 6 : 24) * 3600e3; return candles().filter(c => c.t > from); };
// BOBAI's own work, as marks under the candle it happened in
function cxMarks(cs, span) {
  const t0 = cs[0].t - span, t1 = cs[cs.length - 1].t, out = [];
  for (const x of events) {
    if (x.t <= t0 || x.t > t1) continue;
    // a swap of BOBAI's own buyback run is that run's ◆ already (a candle shows two marks: it would push others out)
    if (x.kind === 'trade' && x.ours && events.some(y => y.kind === 'run' && Math.abs(y.t - x.t) < 5 * 60e3)) continue;
    const k = x.kind === 'run' ? ['◆', D.burnA.c, `BOBAI bought & burned ${cmp(x.e.bobaiBurned)} BOBAI · ${$amt(burnUsd(x.e))}`] : x.kind === 'liq' ? ['●', D.liq.c, x.l.dev ? `dev wallet added ${bnbF(x.l.bnb)} · ${$amt(x.l.bnb * bnbUsdAt(x.t))} + ${cmp(x.l.bobai)} BOBAI, LP burned` : `liquidity added: ${bnbF(x.l.bnb)} · ${$amt(x.l.bnb * bnbUsdAt(x.t))}, LP burned`]
      : x.kind === 'defi' ? ['●', D.defi.c, `DeFi agent ${x.step}`] : x.kind === 'dev' ? ['■', D.creator.c, `dev bot paid out ${bnbF(+x.d.availableBnb)} · ${$amt(+x.d.availableBnb * bnbUsdAt(x.t))} of the creator share`] : x.kind === 'nft' ? ['★', '#a78bfa', `${$buy(nUsd(x.n), x.n)} ${TIERS[x.n.tier] ? TIERS[x.n.tier].toLowerCase() : 'buy'}, NFT #${x.n.tokenId} dropped`]
      : x.kind === 'trade' ? (x.ours ? ['◆', '#F0B90B', `BOBAI ${x.buy ? 'bought' : 'sold'} ${tradeAmt(x)}`] : [x.buy ? '▲' : '▼', x.buy ? BUYC : SELLC, `${x.buy ? 'buy' : 'sell'} ${tradeAmt(x)}`]) : null;
    if (!k) continue;
    const i = cs.findIndex(c => c.t >= x.t); out.push({ i: i < 0 ? cs.length - 1 : i, g: k[0], c: k[1], txt: k[2], t: x.t });
  }
  return out;
}
// marks.mjs: every mark both charts would draw for every event (shape and colour) and the big chart's key
window.__btMarks = () => { const GL = { up: '▲', down: '▼', diamond: '◆', circle: '●', square: '■', star: '★' }, all = [...events].sort((a, b) => a.t - b.t);
  const cs = all.map(x => ({ t: x.t + 1 })), cx = all.length ? cxMarks(cs, 2) : [];
  return { tl: all.map(x => [x.kind + (x.ours ? ':ours' : ''), GL[shapeOf(x)], evColor(x), x.t]), cx: cx.map(m => [m.g, m.c, m.t]),
    cxKey: [...document.querySelectorAll('#bt .cx-k span')].map(e => [e.textContent.trim()[0], e.style.getPropertyValue('--k').trim(), e.textContent.trim().slice(2)]), tlKey: window.__btTlKey || null }; };
function cxStats(all) {
  const day = CH.rows.filter(r => r.t >= Date.now() - 86400e3), volUsd = day.reduce((a, r) => a + (r.v || 0) * (r.u || S.bnbP), 0); // each bucket at its own BNB price
  const b = day.reduce((a, r) => a + (r.b || 0), 0), sl = day.reduce((a, r) => a + (r.s || 0), 0);
  const burned = S.burns.filter(e => Date.parse(e.time) >= Date.now() - 86400e3).reduce((a, e) => a + (+e.bobaiBurned || 0), 0);
  const mcap = S.price * (1e9 - (S.deadA || 0)), lo = Math.min(...all.map(c => c.l * c.u)), hi = Math.max(...all.map(c => c.h * c.u));
  const cell = (k, v, c, cls) => `<div${cls ? ` class="${cls}"` : ''}><span>${k}</span><b${c ? ` style="color:${c}"` : ''}>${v}</b></div>`;
  return cell('MARKET CAP', '$' + nf(mcap)) + cell('LIQUIDITY', CX.liqUsd ? '$' + nf(CX.liqUsd) : '…') + cell('24H VOLUME', '$' + nf(volUsd))
    + cell('24H TRADES', `<i style="color:${BUYC}">${b}▲</i> <i style="color:${SELLC}">${sl}▼</i>`) + cell(CX.tf + ' RANGE', '$' + lo.toPrecision(4) + ' – ' + hi.toPrecision(4), '', 'cx-rg')
    + cell('BURNED 24H', cmp(burned) + ' BOBAI', '#ff7a3d');
}
function drawCx(now) {
  if (!CX.on) return;
  const r = cxCv.getBoundingClientRect(); if (!r.width) return;
  const dpr = Math.min(devicePixelRatio, 2);
  if (cxCv.width !== Math.round(r.width * dpr) || cxCv.height !== Math.round(r.height * dpr)) { cxCv.width = Math.round(r.width * dpr); cxCv.height = Math.round(r.height * dpr); }
  const g = cxG; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
  const cs = cxCandles(); if (cs.length < 2) { g.fillStyle = 'rgba(160,162,192,.6)'; g.font = '700 11px ui-monospace,monospace'; g.fillText('reading the pool…', 20, 30); return; }
  const span = CX.tf === '1H' ? 60e3 : CH.min * 60e3, marks = cxMarks(cs, span);
  const W = r.width, H = r.height, AX = 74, x0 = 8, x1 = W - AX, markH = 22, volH = H * 0.14, y0 = 12, yP = H - 18 - volH - markH - 8;
  let lo = Infinity, hi = 0, vmax = 0;
  for (const c of cs) { lo = Math.min(lo, c.l * c.u); hi = Math.max(hi, c.h * c.u); vmax = Math.max(vmax, c.v); }
  const mid = (hi + lo) / 2, sp = Math.max(hi - lo, mid * 0.01), pad = sp * 0.1; lo = mid - sp / 2 - pad; hi = mid + sp / 2 + pad;
  const Y = p => y0 + (1 - (p - lo) / (hi - lo)) * (yP - y0), step = (x1 - x0) / cs.length, bw = Math.max(1.5, Math.min(11, step * 0.64)), X = i => x0 + i * step + step / 2;
  const mono = 'ui-monospace,Consolas,monospace';
  // the grid and the price axis, in dollars
  g.font = '600 9.5px ' + mono; g.textAlign = 'left';
  const lastY = Y(cs[cs.length - 1].c * cs[cs.length - 1].u);
  for (let k = 0; k <= 4; k++) {
    const p = lo + (hi - lo) * k / 4, y = Y(p);
    g.fillStyle = 'rgba(198,143,118,.07)'; g.fillRect(x0, Math.round(y), x1 - x0, 1);
    // the price tag sits on the axis: a grid label under it would print through
    if (Math.abs(y - lastY) > 13) { g.fillStyle = 'rgba(160,162,192,.55)'; g.fillText('$' + p.toPrecision(4), x1 + 8, y + 3); }
  }
  // time labels on round clock times, as far apart as the room allows: a fixed count of candles per label printed ~26
  // labels into each other on a narrow chart, and counting candles is not counting time (2026-09-27). At least 52 px
  // between two labels (52 px: "14:00" is ~30 px wide); the step is the first of 10 min, 30 min, 1 h, 2 h, 3 h, 6 h, 12 h that gives them.
  const tA = cs[0].t, tZ = cs[cs.length - 1].t, pxPerMs = tZ > tA ? Math.abs(X(cs.length - 1) - X(0)) / (tZ - tA) : 0;
  let stepMs = 43200e3; for (const m of [10, 30, 60, 120, 180, 360, 720]) { if (m * 60e3 * pxPerMs >= 52) { stepMs = m * 60e3; break; } }
  const slot = c => Math.floor((c.t - span) / stepMs);
  g.textAlign = 'center';
  cs.forEach((c, i) => { if (!i || slot(c) === slot(cs[i - 1]) || X(i) < x0 + 16 || X(i) > x1 - 16) return; g.fillStyle = 'rgba(198,143,118,.06)'; g.fillRect(Math.round(X(i)), y0, 1, H - 18 - y0); g.fillStyle = 'rgba(160,162,192,.5)'; g.fillText(new Date(slot(c) * stepMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), X(i), H - 5); });
  // volume, coloured by the candle's direction
  cs.forEach((c, i) => { if (!c.v) return; const vh = Math.max(1, Math.sqrt(c.v / vmax) * volH); g.fillStyle = c.c >= c.o ? 'rgba(53,224,122,.28)' : 'rgba(255,77,109,.28)'; g.fillRect(X(i) - bw / 2, H - 18 - vh, bw, vh); });
  // the candles
  cs.forEach((c, i) => {
    const x = X(i), flat = Math.abs(c.c - c.o) < c.o * 2e-5 && !c.n, col = flat ? 'rgba(160,162,192,.45)' : c.c >= c.o ? BUYC : SELLC;
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, Y(c.h * c.u)); g.lineTo(Math.round(x) + 0.5, Y(c.l * c.u)); g.stroke();
    const yo = Y(Math.max(c.o, c.c) * c.u), hh = Math.max(1.5, Y(Math.min(c.o, c.c) * c.u) - yo);
    if (!flat) { g.shadowColor = col; g.shadowBlur = c.live ? 14 : 6; }
    g.fillStyle = col; g.globalAlpha = i === CX.hover ? 1 : 0.88; g.fillRect(x - bw / 2, yo, bw, hh); g.globalAlpha = 1; g.shadowBlur = 0;
  });
  // BOBAI's work under its candles
  const my = yP + 8 + markH / 2; g.font = '700 12px ' + mono; g.textAlign = 'center';
  g.fillStyle = 'rgba(240,185,11,.05)'; g.fillRect(x0, yP + 8, x1 - x0, markH);
  const stack = {};
  for (const m of marks) { const k = stack[m.i] = (stack[m.i] || 0) + 1; if (k > 2) continue; g.fillStyle = m.c; g.shadowColor = m.c; g.shadowBlur = 8; g.fillText(m.g, X(m.i) + (k - 1) * 7, my + 4); g.shadowBlur = 0; }
  // the price now
  const last = cs[cs.length - 1], ly = Y(last.c * last.u), up = last.c >= cs[0].o;
  g.setLineDash([3, 4]); g.strokeStyle = up ? 'rgba(53,224,122,.55)' : 'rgba(255,77,109,.55)'; g.beginPath(); g.moveTo(x0, ly + 0.5); g.lineTo(x1, ly + 0.5); g.stroke(); g.setLineDash([]);
  g.fillStyle = up ? BUYC : SELLC; g.fillRect(x1 + 2, ly - 8, AX - 4, 16); g.fillStyle = '#0b090a'; g.font = '800 9.5px ' + mono; g.textAlign = 'left'; g.fillText('$' + (last.c * last.u).toPrecision(4), x1 + 6, ly + 3.5);
  // each swap flashes on the live candle, as on the small chart
  for (const f of CH.flashes) { const k = (now - f.at) / 2600; if (k < 0 || k > 1) continue; g.globalAlpha = 1 - k; g.strokeStyle = f.c; g.lineWidth = 2; g.beginPath(); g.arc(X(cs.length - 1), Y(f.p * S.bnbP), 4 + k * 22, 0, 7); g.stroke(); g.globalAlpha = 1; }
  // the crosshair and the candle's figures
  const o = cxEl.querySelector('.cx-o');
  if (CX.hover >= 0 && CX.hover < cs.length) {
    const c = cs[CX.hover], x = X(CX.hover), f = v => '$' + (v * c.u).toPrecision(5), chg = usdCh(c, c) ?? 0;
    g.setLineDash([2, 3]); g.strokeStyle = 'rgba(236,234,245,.4)'; g.beginPath(); g.moveTo(x + 0.5, y0); g.lineTo(x + 0.5, H - 18); g.stroke(); g.setLineDash([]);
    // THE CANDLE'S TRADES AS THE PAGE READ THEM, AT ONCE (operator, 2026-10-05: "on the timeline the candle shows the buy
    // or sell with its BOBAI and USD; in OPEN CHART it comes a little late"): this list came from the record of scenes and
    // the ledger's counts, which arrive with the next ledger read — the timeline reads every swap itself. Now the same here.
    const { tr, cut, led } = candleTrades(c, c.t - span, c.t, 10);
    const here = [...marks.filter(m => m.i === CX.hover && !/^(buy|sell|BOBAI (bought|sold)) /.test(m.txt)).slice(0, 3).map(m => ({ c: m.c, g: m.g, txt: m.txt })),
      ...tr.map(x => ({ c: x.ours ? '#F0B90B' : x.buy ? BUYC : SELLC, g: x.buy ? '▲' : '▼', txt: `${x.ours ? whoTraded(x) : ''}${x.buy ? 'buy' : 'sell'} ${tradeAmt(x)}` })),
      ...(cut ? [{ c: '#a0a2c0', g: '+', txt: `${cut} smaller` }] : led && c.n > tr.length ? [{ c: '#a0a2c0', g: '+', txt: `${c.n - tr.length} under $100` }] : [])];
    const key = CX.hover + ':' + here.length + ':' + c.c + ':' + (tr.at(-1)?.tx || '');
    if (o.dataset.k !== key) {
      o.dataset.k = key;
      o.innerHTML = `<b>${new Date(c.t - span).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</b> O ${f(c.o)} H ${f(c.h)} L ${f(c.l)} C <i style="color:${chg >= 0 ? BUYC : SELLC}">${f(c.c)} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</i>`
        + (c.n ? ` · ${c.b}▲ ${c.s}▼${c.n > 1 ? ` · ${bnbF(c.v)}${c.v * c.u > 0 ? ' · ' + $amt(c.v * c.u) : ''} in all` : here.some(m => /^(buy|sell) /.test(m.txt)) ? '' : ` · ${bnbF(c.v)}${c.v * c.u > 0 ? ' · ' + $amt(c.v * c.u) : ''}`}` : ' · no trade') + here.map(m => `<div style="color:${m.c}">${m.g} ${m.txt}</div>`).join('');
    }
    o.classList.add('on');
  } else o.classList.remove('on');
}
function cxPaintHead() {
  const all = cxCandles(); if (!all.length) return;
  const ch = CX.tf === '24H' ? chartChange(candles()) : usdCh(all[0], all[all.length - 1]);
  cxEl.querySelector('.cx-px').textContent = '$' + (S.price ? S.price.toPrecision(5) : '…');
  const c = cxEl.querySelector('.cx-ch'); c.textContent = ch == null ? '' : `${ch >= 0 ? '▲ +' : '▼ '}${ch.toFixed(2)}% ${CX.tf}`; c.style.color = (ch ?? 0) >= 0 ? BUYC : SELLC;
  cxEl.querySelector('.cx-s').innerHTML = cxStats(all);
  const w = chartWords(), runs = S.burns.filter(e => Date.parse(e.time) >= Date.now() - 86400e3).length;
  cxEl.querySelector('.cx-say').textContent = w ? `BOBAI: ${w.s} in 24 hours, ${nf(w.n)} trades, and I burned ${runs} time${runs === 1 ? '' : 's'}. Every mark is on BscScan.` : '';
}
async function cxLiq() {
  try { const [rH] = await rpc([call(P, '0x0902f1ac')]); const r0 = BigInt('0x' + rH.slice(2, 66)), r1 = BigInt('0x' + rH.slice(66, 130)); CX.liqUsd = Number(S.token0IsBobai ? r1 : r0) / 1e18 * 2 * S.bnbP; } catch {}
}
function openCx(on) {
  const was = CX.on; CX.on = on; cxEl.classList.toggle('on', on); win.classList.toggle('cx-on', on);
  // the Brain page makes the chart a step in the history, so a phone's back gesture closes it
  if (was !== on) dispatchEvent(new CustomEvent('bt:chart', { detail: on }));
  if (!on) { CX.hover = -1; return; }
  setFocus(null); pinnedK = null; cxPaintHead(); cxLiq().then(cxPaintHead);
  if (!QUEUE.length && performance.now() >= sceneUntil) { setPose(poseOr('think'), 5); const w = chartWords(); if (w) speak(`My chart. ${w.s} in 24 hours. Every mark on it is me, working.`, 5200); }
}
cxOpen.onclick = e => { e.stopPropagation(); openCx(true); };
// the Brain page's card 05 (THE CHART) opens this same view
window.__bobaiChart = (on = true) => openCx(on);
cxEl.querySelector('.cx-x').onclick = e => { e.stopPropagation(); openCx(false); if (mview === 'chart') setView('brain'); };
cxEl.addEventListener('click', e => e.stopPropagation());
cxEl.querySelectorAll('.cx-tf button').forEach(b => b.onclick = () => { CX.tf = b.dataset.tf; cxEl.querySelectorAll('.cx-tf button').forEach(x => x.classList.toggle('on', x === b)); CX.hover = -1; cxPaintHead(); });
const cxAt = e => { const r = cxCv.getBoundingClientRect(), n = cxCandles().length, x = e.clientX - r.left; return x < 8 || x > r.width - 74 ? -1 : clamp(Math.floor((x - 8) / ((r.width - 82) / n)), 0, n - 1); };
cxCv.addEventListener('pointermove', e => { CX.hover = cxAt(e); });
cxCv.addEventListener('pointerdown', e => { CX.hover = cxAt(e); });
cxCv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') CX.hover = -1; });
addEventListener('keydown', e => { if (e.key === 'Escape' && CX.on) { e.stopImmediatePropagation(); openCx(false); if (mview === 'chart') setView('brain'); } }, true);
setInterval(() => { if (CX.on) cxPaintHead(); }, 5000);

// ---------- C9: follow one trade — its 3%, BOBAI by BOBAI, to where it ends up ----------
// The path, as the chain records it (read 2026-09-25): a trade's 3% arrives as BOBAI in the token contract
// (a Transfer to the contract, in the trade's own transaction); the contract later swaps the whole pile to
// BNB (the TAXSWAP event) and the buyback bot splits that BNB by the split in force. So a trade's share of
// a run is its tax over the BOBAI that swap sold — exact, with every step's transaction to check.
let FOLLOW = null;
// any trade by its hash, straight from its receipt: receipts stay readable long after the logs window
async function tradeFromTx(hash) {
  const [rc] = await rpc([['eth_getTransactionReceipt', [hash]]]); if (!rc) return null;
  const sws = (rc.logs || []).filter(l => l.address.toLowerCase() === P && l.topics[0] === SWAP); if (!sws.length) return null;
  const [blk] = await rpc([['eth_getBlockByNumber', [rc.blockNumber, false]]]);
  const t = parseInt(blk.timestamp, 16) * 1000;
  const tx = (rc.logs || []).find(l => l.address.toLowerCase() === BOBAI && l.topics[0] === TAXSWAP); if (tx) takeTaxSwaps([tx]);
  const all = foldBuys(sws.map(l => swapOf(l, t))), mine = all.filter(x => !x.taxSwap);
  return (mine.length ? mine : all).sort((a, b) => b.usd - a.usd)[0];
}
const TXHASH = /0x[0-9a-fA-F]{64}/;
const ALERT_USD = 100; // worker-tg-bot: `if (usdValue < 100) continue;`
const isAlert = x => x.kind === 'trade' && (x.ours || (x.buy && x.usd >= ALERT_USD));
// A trade below the alert line, or a sell: a light from TRADES into the brain, green for a buy, red for a sell, its size
// the trade's — no board, no float, no slow-down, in live and in the replay alike (operator, 2026-10-01: "many trades in
// a row would be chaos, or the replay would take forever")
window.__btDots = 0; // for checks from outside (read-only): how many trade dots flew
function tradeDot(x) { window.__btDots++; const [dc, dk] = dotOf(x.buy), c3 = new THREE.Color(dc); comet(A.src, A.core, dc, 1.5, () => fire(A.core, c3), clamp(0.5 + Math.sqrt(x.usd || 0) / 12, 0.55, 1.3) * dk); }
async function followTrade(x) {
  if (!x || x.kind !== 'trade') return say(['pick a trade: tap a ▲ or ▼ on the timeline, type ', ['follow'], ' for the latest, or paste its tx hash.']);
  if (x.taxSwap) return say(['that one is BOBAI at work, not a trader: the token contract swapped ', [bobaiAmt(x.bobai)], ' of collected tax to ', [bnbF(x.bnb)], '. Follow a buy or a sell to see where its 3% goes.'], [['tx', x.tx]]);
  const ph = livePhase(); if (!ph) return say(['the split in force is not known right now — try again in a moment.']);
  setFocus(null); pinnedK = null;
  const col = x.buy ? BUYC : SELLC, kind = x.buy ? 'BUY' : 'SELL';
  // 1) the tax, exactly: the BOBAI this transaction sent to the token contract
  let tax = null;
  try {
    const [rc] = await rpc([['eth_getTransactionReceipt', [x.tx]]]);
    const toContract = '0x' + BOBAI.slice(2).padStart(64, '0');
    tax = (rc?.logs || []).filter(l => l.address.toLowerCase() === BOBAI && l.topics[0] === TRANSFER && l.topics[2]?.toLowerCase() === toContract && l.topics[1]?.toLowerCase() !== toContract)
      .reduce((a, l) => a + Number(BigInt(l.data)) / 1e18, 0) || null;
  } catch {}
  const exact = tax != null; if (!exact) tax = x.bobai * (x.buy ? 0.03 : 3 / 97);
  const taxUsd = x.usd * 0.03;
  // 2) where it is now: the first tax swap after it (the trade's own transaction swaps what was there before)
  const sw = events.filter(e => e.taxSwap && e.t >= x.t && e.tx !== x.tx).sort((a, b) => a.t - b.t)[0];
  // Tax swaps are known from the last hour of logs on; for an older trade, "no swap seen" does not mean
  // "still queued" — its tax went into the next run after it, whose share we cannot measure, so dollars.
  const seen = x.t >= (S.histFrom || 0), later = !sw && !seen ? S.burns.find(e => Date.parse(e.time) > x.t) : null;
  const run = sw ? S.burns.find(e => { const t = Date.parse(e.time); return t >= sw.t - 5 * 60e3 && t <= sw.t + 20 * 60e3; }) : later;
  const liq = run && S.liq.find(l => Math.abs(Date.parse(l.time) - Date.parse(run.time)) < 20 * 60e3);
  const share = sw ? tax / sw.bobai : null, myBnb = sw ? share * sw.bnb : null;
  // 3) the six slices of the split in force, in the trade's own dollars (and BNB, once swapped)
  const n = v => parseFloat(v) || 0;
  const SL = [['burnA', 'BOBAI burned', n(ph.bobaiPct), run?.bobaiBurnTx], ['burnB', '$BOB burned', n(ph.bobPct), run?.bobBurnTx], ['liq', 'liquidity, LP burned', n(ph.liqPct), liq?.addLiqTx],
    ['defi', 'the DeFi agent', n(ph.lpPct), run?.lpAgentTx], ['giggle', 'the Giggle pot', n(ph.gigglePct), run?.giggleTx], ['creator', 'the creator share', n(ph.creatorPct), run?.creatorTx]].filter(s => s[2] > 0);
  const tot = SL.reduce((a, s) => a + s[2], 0) || 3;
  const amt = s => myBnb != null ? bnbF(myBnb * s[2] / tot) : '$' + nf(x.usd * s[2] / 100, x.usd * s[2] / 100 < 1 ? 4 : 2);
  // the story, step by step, on the scene and in the log
  cine('FOLLOWING A $' + nf(x.usd, x.usd < 10 ? 2 : 0) + ' ' + kind, '3% = ' + cmp(tax) + ' BOBAI → THE BRAIN', col, x.t, false);
  logLine('FOLLOW', col, [`a $${nf(x.usd, 2)} ${x.buy ? 'buy' : 'sell'} paid `, [nf(tax, 2) + ' BOBAI'], ` of tax (≈$${nf(taxUsd, 2)})` + (exact ? ', read from its transaction' : ', 3% of the swap')], [['trade', x.tx]], x.t).classList.add('wrap');
  setPose('idle', 1.4);
  comet(A.src, A.core, col, 1.3, () => {
    fire(A.core, new THREE.Color('#F0B90B')); floatAt(A.core, '+' + cmp(tax) + ' BOBAI', '#F0B90B');
    if (!sw && !later) {
      logLine('FOLLOW', '#F0B90B', ['it waits in the token contract with ', [cmp(S.queued) + ' BOBAI'], ' of tax from other trades, until the contract swaps the pile to BNB. Then the buyback bot splits it: ' + SL.map(s => s[1] + ' ' + amt(s)).join(' · ')]).classList.add('wrap');
      setTimeout(() => floatAt(A.core, 'waiting in the queue', '#F0B90B'), 700);
      return;
    }
    const at = t => new Date(t).toISOString().slice(11, 16) + ' UTC';
    if (sw) logLine('FOLLOW', '#F0B90B', ['the contract swapped it with the rest of its pile: ', [nf(share * 100, share < 0.01 ? 3 : 1) + '%'], ' of ' + cmp(sw.bobai) + ' BOBAI → ', [bnbF(myBnb)], ' of ', bnbF(sw.bnb)], [['swap', sw.tx]]).classList.add('wrap');
    else logLine('FOLLOW', '#F0B90B', ['the contract swapped it to BNB with the rest of its pile, and the bot split it in the run of ', [at(Date.parse(later.time))], ' — here in the trade’s own dollars:']).classList.add('wrap');
    SL.forEach((s, i) => setTimeout(() => {
      const d = D[s[0]]; if (!d || d.pct === 0) return;
      comet(A.core, d.pos, d.c, 1.1, () => { hitDest(s[0]); floatAt(d.pos, amt(s), d.c); });
      logLine('FOLLOW', d.c, [s[1] + ': ', [amt(s)]], run && s[3] ? [['tx', s[3]]] : []);
    }, 900 + i * 650));
    if (!run) setTimeout(() => logLine('FOLLOW', '#F0B90B', ['the buyback bot has not split that BNB yet — it runs every 10 minutes.']), 900);
  });
  // the same path, pinned in the side panel
  FOLLOW = { t: `Following a $${nf(x.usd, 2)} ${x.buy ? 'buy' : 'sell'}`, c: col,
    rows: [['Trade', `$${nf(x.usd, 2)} · ${new Date(x.t).toISOString().slice(11, 16)} UTC`], ['Its 3% tax', `${nf(tax, 2)} BOBAI · ≈$${nf(taxUsd, 2)}`],
      ['Now', sw ? (run ? 'swapped and split' : 'swapped, split next') : later ? 'split in the run of ' + new Date(Date.parse(later.time)).toISOString().slice(11, 16) + ' UTC' : 'waiting in the queue'], ...(sw ? [['Its part of the swap', `${nf(share * 100, share < 0.01 ? 3 : 1)}% → ${bnbF(myBnb)}`]] : []),
      ...SL.map(s => [s[1], amt(s)])],
    note: sw ? 'Every slice is this trade’s share of what the bot actually moved. Each has its transaction.' : later ? 'Older than the hour of chain I can read swap by swap, so the slices are its share of the split in dollars; the transactions are that run’s.' : 'The slices are this trade’s share of the split in force; they happen once the contract swaps its tax.',
    links: [['trade tx', TX + x.tx], ...(sw ? [['tax swap tx', TX + sw.tx]] : []), ...(run ? [['BOBAI burn tx', TX + run.bobaiBurnTx]] : [])] };
  pinnedK = 'follow'; setFocus('follow');
}

// ---------- worker heartbeats: every flare is a real change in a public endpoint ----------
const HB = {};
// His agent lines, from the split above. Five ways each to say it (variety rule),
// and none of them may call a crawler an agent.
function agentLines() {
  const use = HB.agent || 0, menu = HB.agentMenu || 0, n = nf(use), m = nf(menu);
  if (!use) return [
    `No agent has used one of my tools yet today. Registries and agents have read my menu ${m} times.`,
    `Quiet on the agent side: ${m} menu checks today, no tool used yet.`,
    `Registries keep reading my tool list — ${m} times today. Nobody has used a tool yet.`,
    `Registries and agents looked at what I can do ${m} times today. Still waiting for the first to use it.`,
    `My tools are free and listed everywhere. Today: ${m} looks, no calls yet.`,
  ];
  return [
    `Other agents used my tools ${n} time${use === 1 ? '' : 's'} today, and registries read my menu ${m} times.`,
    `${n} real tool call${use === 1 ? '' : 's'} from agents and apps today. I answer every one.`,
    `Agents at work with my tools: ${n} call${use === 1 ? '' : 's'} so far today.`,
    `Machines using me: ${n} tool call${use === 1 ? '' : 's'} today, ${m} menu checks.`,
    `My agent server: ${n} tool call${use === 1 ? '' : 's'} by other agents today — crawlers not counted.`,
  ];
}
let HBN = 0;
async function heartbeats(first) {
  // two small reads; the agent record and the NFT state come from logs(), which already fetched them
  // the bots' heartbeats every 15 s; the day's request counts once a minute (2026-10-06: /stats was 9 KB every 15 s for a
  // figure he says now and then, and /stats/detail is refreshed at the edge only every two minutes anyway)
  const counts = first || HBN++ % 4 === 0;
  const [h, st, det] = await Promise.allSettled([getJSON('https://logs.brainonbnb.com/health'), counts ? getJSON(AG + '/stats') : null, counts ? getJSON(AG + '/stats/detail') : null])
    .then(r => r.map(x => x.status === 'fulfilled' ? x.value : null));
  const lp = S.lp, nft = S.nft;
  const seen = (k, v, t, text, n) => {
    if (v == null) return;
    if (first || HB[k] === undefined) { HB[k] = v; if (t) W[k].last = t; return; }
    if (v !== HB[k]) { HB[k] = v; beat(k, text, n); if (t) W[k].last = t; }
  };
  if (h) { seen('buyback', h.buyback, Date.parse(h.buyback), 'ticked: checked 1ce, splits once the token has swapped its tax'); seen('dev', h.devBuyback, Date.parse(h.devBuyback), 'ticked'); }
  if (lp) { const at = lp.last_check?.at || lp.last?.at; seen('lp', at, Date.parse(at), 'checked its position: ' + (lp.last_check?.acted ? 'acted' : 'nothing to do')); }
  if (nft) seen('nft', nft.latestBlock, null, null);
  if (nft && HB.nft !== undefined && !W.nft.last) W.nft.last = Date.now();
  // WHAT IS REAL (2026-10-04, operator: "BOBAI says 2-3k requests from other
  // agents — if true we should earn on it"). It was not: /stats counts every
  // request, and on 4.10. 9,191 of them were crawlers asking for paths we do
  // not serve. /stats/detail names each one, so three numbers are kept apart:
  // tool USE by other agents and apps (MCP tool calls, our REST API, paid
  // answers), MENU CHECKS (registries and agents reading the tool list), and
  // everything incl. crawlers. BOBAI only ever calls the first "agents using me".
  if (st) {
    const day = st.asked?.by_day?.[new Date().toISOString().slice(0, 10)] || {}; S.kinds = day; const tot = Object.values(day).reduce((a, v) => a + (+v || 0), 0);
    HB.agentAll = tot;
  }
  if (det?.names && det.day === new Date().toISOString().slice(0, 10)) {
    let use = 0, menu = 0;
    for (const [k, v] of Object.entries(det.names)) {
      if (/^rest:ext:(total|circulating)-supply$/.test(k)) continue; // listing sites polling the supply on a timer are no agents using him (2026-10-06)
      if (/^(mcp|paidmcp):(tools_)?call:|^rest:ext:|^sell:answer:[a-z_]+:paid|^sell:watch:paid/.test(k)) use += +v || 0;
      else if (/^mcp:(initialize|tools_list|prompts_list|resources_list)$|^paidmcp:tools_list$/.test(k)) menu += +v || 0;
    }
    HB.agentMenu = menu;
    // a new UTC day starts the count again (2026-10-05: a tab open across midnight kept yesterday's total as "today")
    const newDay = HB.agentDay && HB.agentDay !== det.day; HB.agentDay = det.day; if (newDay) HB.agent = use;
    const prev = HB.agent;
    if (first || prev === undefined) { HB.agent = use; W.agent.last = Date.now(); logLine('BOBAI', W.agent.c, ['agent server today: ', [nf(use)], ` tool call${use === 1 ? '' : 's'} by other agents and apps · `, [nf(menu)], ' menu checks by registries · ', [nf(HB.agentAll || 0)], ' requests in all, crawlers included']); }
    else if (use > prev) { HB.agent = use; beat('agent', `an agent used ${use - prev > 1 ? (use - prev) + ' of my tools' : 'one of my tools'}`, use - prev); }
  }
}

// ================= timeline + replay =================
const tl = $('tlc'), tx = tl.getContext('2d'), tip = $('tip');
// [span, replay length, labelled step, faint step]
const WINS = { '1H': [3600e3, 16000, 600e3, 300e3], '6H': [6 * 3600e3, 26000, 3600e3, 1800e3], '24H': [86400e3, 40000, 3 * 3600e3, 3600e3], '7D': [7 * 86400e3, 48000, 86400e3, 6 * 3600e3] };
let winKey = '24H', WIN = WINS[winKey][0], REPLAY = WINS[winKey][1];
function setWin(k) {
  winKey = k; [WIN, REPLAY] = WINS[k];
  document.querySelectorAll('#bt .tlw button').forEach(b => b.classList.toggle('on', b.dataset.w === k));
  rpLabel();
  from = Date.now() - WIN;
  if (mode === 'replay') startReplay();
}
document.querySelectorAll('#bt .tlw button').forEach(b => b.onclick = () => setWin(b.dataset.w));
let tlMouse = -1;
let liveSince = Date.now(), events = [], mode = 'intro', from = 0, cursor = 0, rStart = 0, playhead = 0, nextAt = 0, hover = null;
const evColor = x => x.kind === 'run' ? D.burnA.c : x.kind === 'liq' ? D.liq.c : x.kind === 'defi' ? D.defi.c : x.kind === 'dev' ? D.creator.c : x.kind === 'trade' ? (x.ours ? '#F0B90B' : x.buy ? BUYC : SELLC) : '#a78bfa';
// lanes = wallets: 1ce (splits + liquidity), d38 (creator payouts), bFAA (DeFi agent), the NFT drops, the pool's swaps
const LANES = ['1ce', 'd38', 'DEFI', 'NFT', 'SWAPS'];
const lane = x => x.kind === 'liq' && x.l?.dev ? 1 : ({ run: 0, liq: 0, dev: 1, defi: 2, nft: 3, trade: 4 })[x.kind]; // a dev add is d38's
const laneY = i => 9 + i * 10;
const TL0 = 10; // no lane names any more: the chart starts at the edge
window.__btTlX = t => { const r = tl.getBoundingClientRect(); return [r.left + TL0 + (t - from) / WIN * (r.width - 14 - TL0), r.top + r.height / 2]; }; // a time's spot on the timeline, for checks (tlclick.mjs)
const tlX = (t, w) => TL0 + (t - from) / WIN * (w - TL0 - 14);
// shapes say what it is before colour does: ▲ buy, ▼ sell, ◆ burn, ● liquidity/agent, ■ payout, ★ NFT
function mark(kind, x, y, r) {
  tx.beginPath();
  if (kind === 'up') { tx.moveTo(x, y - r); tx.lineTo(x + r, y + r * 0.8); tx.lineTo(x - r, y + r * 0.8); }
  else if (kind === 'down') { tx.moveTo(x, y + r); tx.lineTo(x + r, y - r * 0.8); tx.lineTo(x - r, y - r * 0.8); }
  else if (kind === 'diamond') { tx.moveTo(x, y - r * 1.25); tx.lineTo(x + r, y); tx.lineTo(x, y + r * 1.25); tx.lineTo(x - r, y); }
  else if (kind === 'square') { tx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6); }
  else if (kind === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r * 1.2; tx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } }
  else tx.arc(x, y, r, 0, 7);
  tx.closePath();
}
const shapeOf = x => x.kind === 'trade' ? (x.ours ? 'diamond' : x.buy ? 'up' : 'down') : x.kind === 'run' ? 'diamond' : x.kind === 'dev' ? 'square' : x.kind === 'nft' ? 'star' : 'circle';
// a label is formatted once and kept: toLocale*String on every drawn frame was a fifth of a phone's script time (2026-10-06)
const TL_LAB = new Map();
function tlLabel(d) {
  const k = winKey + d; let v = TL_LAB.get(k); if (v) return v;
  const dt = new Date(d);
  v = winKey === '7D' ? dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }).toUpperCase() : dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (TL_LAB.size > 400) TL_LAB.clear(); TL_LAB.set(k, v); return v;
}
// THE TIMELINE IS THE CHART (2026-09-26, operator: "the timeline like the chart you get when you tap it — the
// buys, sells, burns, liquidity, DeFi and NFT drops right on the candles; saves room and looks better"). Candles
// of the pool for the window, BOBAI's work as marks sitting on the candle it happened in, volume along the floor,
// the playhead running through it in a replay. 1H is one-minute candles from the swaps this page read; 6H and 24H
// the ledger's ten minutes; 7D the ledger's hours. A mark keeps its shape (▲ buy, ▼ sell, ◆ burn, ● liquidity and
// DeFi, ★ NFT, ■ payout) and its colour, and is played or not played exactly as before.
const TL_STEP = { '1H': 60e3, '6H': 600e3, '24H': 600e3, '7D': 3600e3 };
function tlCandles(t0, t1) {
  const step = TL_STEP[winKey];
  if (step === 60e3) {
    const sw = S.hist.filter(x => x.bnb > 0 && x.bobai > 0 && x.t >= t0 && x.t < t1).sort((a, b) => a.t - b.t);
    const before = [...CH.rows].reverse().find(r => r.t <= t0);
    let prev = before ? before.c : sw.length ? sw[0].bnb / sw[0].bobai : pxBnb(); if (!prev) return [];
    const out = [];
    for (let t = Math.floor(t0 / step) * step + step, i = 0; t <= t1 + step; t += step) {
      const c = { t, o: prev, c: prev, h: prev, l: prev, v: 0, n: 0, b: 0, s: 0, u: bnbAt(t), ou: bnbAt(t - step) };
      for (; i < sw.length && sw[i].t < t; i++) { const p = sw[i].bnb / sw[i].bobai; c.c = p; c.h = Math.max(c.h, p); c.l = Math.min(c.l, p); c.v += sw[i].bnb; c.n++; if (!sw[i].ours) c[sw[i].buy ? 'b' : 's']++; }
      if (mode === 'live' && t > Date.now() && pxBnb()) { c.c = pxBnb(); c.h = Math.max(c.h, c.c); c.l = Math.min(c.l, c.c); c.live = true; }
      out.push(c); prev = c.c;
    }
    return out;
  }
  const all = candles().filter(c => c.t > t0 && c.t <= t1 + CH.min * 60e3);
  if (step === 600e3) return all;
  const out = [];
  for (const c of all) {                             // hours from the ten-minute candles
    const t = Math.ceil(c.t / step) * step, last = out[out.length - 1];
    if (last && last.t === t) { last.c = c.c; last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.v += c.v; last.n += c.n; last.b += c.b || 0; last.s += c.s || 0; last.live = c.live; last.u = c.u; if (c.x) last.x = [...(last.x || []), ...c.x]; }
    else out.push({ ...c, t });
  }
  return out;
}
let tlHits = [], tlCandleHits = []; // the candles as drawn (x, the candle, its span): the mouse finds them (2026-09-30)
function drawTl(now) {
  const r = tl.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2); if (!r.width) return;
  // rounded on both sides: a fractional width (125% scaling) never equalled the truncated one and the canvas was made anew on every draw (2026-10-05)
  if (tl.width !== Math.round(r.width * dpr) || tl.height !== Math.round(r.height * dpr)) { tl.width = Math.round(r.width * dpr); tl.height = Math.round(r.height * dpr); }
  tx.setTransform(dpr, 0, 0, dpr, 0, 0); tx.clearRect(0, 0, r.width, r.height);
  if (mode === 'live') from = Date.now() - WIN; // the window walks with the clock
  const w = r.width, h = r.height, ph = mode === 'replay' ? playhead : Date.now(), x1 = w - 14, base = h - 15;
  const mono = 'ui-monospace,Consolas,monospace', [, , major, minor] = WINS[winKey], step = TL_STEP[winKey];
  // the price scale: the window's own range, with a floor so a flat day stays a line and not a seismograph
  const cs = tlCandles(from, from + WIN), top = 20, volH = 10, pBot = base - volH - 3;
  let lo = Infinity, hi = 0, vmax = 0; for (const c of cs) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); vmax = Math.max(vmax, c.v); }
  const mid = (hi + lo) / 2 || 1, sp = Math.max(hi - lo, mid * 0.008); lo = mid - sp * 0.56; hi = mid + sp * 0.56;
  const Y = p => top + (1 - (p - lo) / (hi - lo)) * (pBot - top);
  const cw = (x1 - TL0) / (WIN / step), bw = Math.max(1.2, Math.min(9, cw * 0.62));
  // grid: faint steps, labelled steps
  tx.font = '600 8.5px ' + mono; tx.textAlign = 'center';
  const align = s => Math.ceil(from / s) * s + (winKey === '7D' ? new Date().getTimezoneOffset() * 60e3 : 0);
  for (let d = align(minor); d < from + WIN; d += minor) { tx.fillStyle = 'rgba(198,143,118,.05)'; tx.fillRect(tlX(d, w), 3, 1, base - 3); }
  let lastLab = -1e9;
  for (let d = align(major); d < from + WIN; d += major) {
    const X = tlX(d, w); if (X < TL0 + 12 || X > x1 - 30) continue;
    if (X - lastLab < 46) continue;
    lastLab = X; tx.fillStyle = 'rgba(198,143,118,.12)'; tx.fillRect(X, 3, 1, base - 3);
    tx.fillStyle = 'rgba(160,162,192,.6)'; tx.fillText(tlLabel(d), X, h - 3);
  }
  // what has played (a replay) is lit, the rest waits in the dark
  tx.fillStyle = 'rgba(240,185,11,.035)'; tx.fillRect(TL0, 2, Math.max(0, tlX(ph, w) - TL0), base - 2);
  // volume and candles
  tlCandleHits = [];
  for (const c of cs) {
    const X = tlX(c.t - step / 2, w); if (X < TL0 - 4 || X > x1 + 4) continue;
    tlCandleHits.push({ x: X, c, step, half: Math.max(3, cw / 2) });
    const played = c.t - step <= ph, up = c.c >= c.o, flat = Math.abs(c.c - c.o) < c.o * 2e-5 && !c.n;
    const col = flat ? 'rgba(160,162,192,.5)' : up ? BUYC : SELLC;
    tx.globalAlpha = played ? 1 : 0.18;
    if (c.v && vmax) { const vh = Math.max(1, Math.sqrt(c.v / vmax) * volH); tx.fillStyle = up ? 'rgba(53,224,122,.35)' : 'rgba(255,77,109,.35)'; tx.fillRect(X - bw / 2, base - vh, bw, vh); }
    tx.strokeStyle = col; tx.lineWidth = 1; tx.beginPath(); tx.moveTo(Math.round(X) + 0.5, Y(c.h)); tx.lineTo(Math.round(X) + 0.5, Y(c.l)); tx.stroke();
    const yo = Y(Math.max(c.o, c.c)), hh = Math.max(1.2, Y(Math.min(c.o, c.c)) - yo);
    if (!flat && played && c.live) { tx.shadowColor = col; tx.shadowBlur = 10; } // only the live candle glows: a blur per candle per frame was the cost
    tx.fillStyle = col; tx.fillRect(X - bw / 2, yo, bw, hh); tx.shadowBlur = 0;
    // every buy and sell of the candle, small, under it: green ▲ for buys, red ▼ for sells (the ledger counts them)
    const yb = Y(c.l) + 5, tri = Math.max(1.6, Math.min(2.8, bw * 0.45));
    if (c.b) { mark('up', X, yb, tri); tx.fillStyle = BUYC; tx.fill(); }
    if (c.s) { mark('down', X, yb + (c.b ? 6 : 0), tri); tx.fillStyle = SELLC; tx.fill(); }
  }
  tx.globalAlpha = 1;
  // the price now, as a thin line with its tag at the right edge
  if (cs.length && mode === 'live') {
    const lc = cs[cs.length - 1], ly = Y(lc.c), upc = lc.c >= cs[0].o;
    tx.setLineDash([2, 4]); tx.strokeStyle = upc ? 'rgba(53,224,122,.4)' : 'rgba(255,77,109,.4)'; tx.beginPath(); tx.moveTo(TL0, ly + 0.5); tx.lineTo(x1, ly + 0.5); tx.stroke(); tx.setLineDash([]);
  }
  // BOBAI's work on the candles: each mark sits just above the candle it happened in; several in one candle stack up
  tlHits = [];
  const stack = new Map();
  for (const x of events) {
    if (x.t < from || x.t > from + WIN + 60e3) continue;
    const X = tlX(x.t, w), k = Math.round(X / Math.max(6, bw + 2)), n = stack.get(k) || 0; stack.set(k, n + 1);
    const c = cs.find(q => q.t >= x.t) || cs[cs.length - 1], yTop = c ? Y(c.h) : pBot;
    const Ym = Math.max(7, yTop - 7 - n * 9);
    const lit = x.lit ? Math.max(0, 1 - (now - x.lit) / 1600) : 0, col = evColor(x), played = x.t <= ph;
    const rad = (x.kind === 'trade' ? clamp(2 + Math.sqrt(x.usd) * 0.22, 2.4, 4.6) : x.kind === 'run' ? 4 : 3.2) + lit * 2.5 + (hover === x ? 1.5 : 0);
    tx.globalAlpha = played ? 1 : 0.22;
    if (played) { tx.shadowColor = col; tx.shadowBlur = 6 + lit * 14; }
    mark(shapeOf(x), X, Ym, rad); tx.fillStyle = col; tx.fill();
    if (x.ours || x.kind === 'run') { tx.shadowBlur = 0; tx.strokeStyle = 'rgba(255,255,255,.7)'; tx.lineWidth = 1; tx.stroke(); }
    tx.shadowBlur = 0; tx.globalAlpha = 1;
    tlHits.push({ x: X, y: Ym, e: x });
  }
  // each swap of the live candle flashes, as on the big chart
  if (mode === 'live' && cs.length) for (const f of CH.flashes) {
    const k = (now - f.at) / 2600; if (k < 0 || k > 1) continue;
    tx.globalAlpha = 1 - k; tx.strokeStyle = f.c; tx.lineWidth = 1.5; tx.beginPath(); tx.arc(tlX(Date.now(), w) - 4, Y(f.p), 3 + k * 12, 0, 7); tx.stroke(); tx.globalAlpha = 1;
  }
  // the window's price and change, small, top left
  if (cs.length) {
    // ONE 24H FIGURE (2026-10-03: the mood chip said -0.2 %, the timeline +0.50 % 24H — the timeline measured from its own
    // first candle): live, the 24H head reads chartChange like the chip and the big chart; a replay keeps its window's own
    const cc = mode === 'live' && winKey === '24H' ? chartChange(candles()) : null;
    const ch = cc ?? usdCh(cs[0], cs[cs.length - 1]) ?? 0, upc = ch >= 0;
    window.__btTlCh = mode === 'live' ? [winKey, ch] : null; // same24h.mjs: the figure the timeline head shows
    tx.textAlign = 'left'; tx.font = '700 9px ' + mono; tx.fillStyle = 'rgba(160,162,192,.75)'; tx.fillText('$BOBAI', TL0 + 2, 11);
    tx.fillStyle = '#f3efe6'; const pt = '$' + (cs[cs.length - 1].c * S.bnbP).toPrecision(4); tx.fillText(pt, TL0 + 44, 11);
    const cht = (upc ? '▲ +' : '▼ ') + ch.toFixed(2) + '% ' + winKey, chx = TL0 + 50 + tx.measureText(pt).width;
    tx.fillStyle = upc ? BUYC : SELLC; tx.fillText(cht, chx, 11); const left = chx + tx.measureText(cht).width + 14;
    // the key to the marks, on a wide screen (a phone has the CHART tab with its own); from 520 px (3.10.: at 1440 the
    // timeline is 739 px and had no key at 760) — what does not fit beside the price leaves, BUY / SELL / BURN stay
    if (w > 520) {
      tx.textAlign = 'right'; tx.font = '700 8px ' + mono; let kx = x1 - 24; // clear of the gold now-line and its ring
      const keys = [['★', '#a78bfa', 'NFT', 3], ['■', D.creator.c, 'PAYOUT', 1], ['●', D.defi.c, 'DEFI', 4], ['●', D.liq.c, 'LIQUIDITY', 5], ['◆', '#F0B90B', 'BOBAI SWAP', 2], ['◆', D.burnA.c, 'BURN', 9], ['▼', SELLC, 'SELL', 9], ['▲', BUYC, 'BUY', 9]];
      const kw = k => tx.measureText(k[2]).width + 3 + tx.measureText(k[0]).width + 10;
      while (keys.reduce((a, k) => a + kw(k), 0) > kx - left) { const lo = keys.reduce((m, k) => k[3] < m[3] ? k : m); if (lo[3] >= 9) break; keys.splice(keys.indexOf(lo), 1); }
      window.__btTlKey = keys.map(k => [k[0], k[1], k[2]]); // marks.mjs: the key the timeline drew
      for (const [g, c, lab] of keys) {
        tx.fillStyle = 'rgba(160,162,192,.7)'; tx.fillText(lab, kx, 11); kx -= tx.measureText(lab).width + 3;
        tx.fillStyle = c; tx.fillText(g, kx, 11); kx -= tx.measureText(g).width + 10;
      }
      tx.textAlign = 'left';
    }
  }
  // crosshair: where the pointer is, and when that was
  if (tlMouse > TL0 && tlMouse < x1) {
    tx.setLineDash([2, 3]); tx.strokeStyle = 'rgba(236,234,245,.35)'; tx.beginPath(); tx.moveTo(tlMouse + 0.5, 2); tx.lineTo(tlMouse + 0.5, base); tx.stroke(); tx.setLineDash([]);
    const tm = from + (tlMouse - TL0) / (x1 - TL0) * WIN, lab = new Date(tm).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    tx.font = '700 8.5px ' + mono; const tw = tx.measureText(lab).width + 10, lx = clamp(tlMouse - tw / 2, TL0, x1 - tw);
    tx.fillStyle = 'rgba(20,16,17,.95)'; tx.fillRect(lx, base + 1, tw, 12); tx.fillStyle = '#eceaf5'; tx.textAlign = 'left'; tx.fillText(lab, lx + 5, base + 10);
  }
  // playhead; live it is NOW and it breathes
  const px = tlX(ph, w), pulse = 0.5 + 0.5 * Math.sin(now / 400);
  const pg = tx.createLinearGradient(px - 44, 0, px, 0); pg.addColorStop(0, 'rgba(240,185,11,0)'); pg.addColorStop(1, 'rgba(240,185,11,.16)');
  tx.fillStyle = pg; tx.fillRect(px - 44, 2, 44, base - 2);
  tx.fillStyle = '#F0B90B'; tx.shadowColor = '#F0B90B'; tx.shadowBlur = 12; tx.fillRect(px - 1, 2, 2, base - 2); tx.shadowBlur = 0;
  if (mode === 'live') {
    tx.strokeStyle = 'rgba(240,185,11,' + (0.8 - pulse * 0.6) + ')'; tx.lineWidth = 1.5; tx.beginPath(); tx.arc(px, 6, 3 + pulse * 5, 0, 7); tx.stroke();
    if (tlMouse < 0) { tx.font = '700 8px ' + mono; tx.fillStyle = '#F0B90B'; tx.textAlign = 'right'; tx.fillText('NOW', px - 6, h - 3); tx.textAlign = 'left'; }
  }
}
function near(e) {
  const r = tl.getBoundingClientRect(), mx2 = e.clientX - r.left, my2 = e.clientY - r.top; let best = null, bd = 12;
  for (const hh of tlHits) { const d = Math.hypot(hh.x - mx2, hh.y - my2); if (d < bd) { bd = d; best = hh.e; } }
  return best;
}
function describe(x) {
  if (x.kind === 'dev') return `d38 paid out ${bnbAmt(x.d.availableBnb, x.t)} of creator share (${x.d.builder6Bnb ? '80% creator, 20% to 6 builders' : '82% creator, 18% to 5 builders'})`; // the run's own split: builder #6 from 1.10.
  if (x.kind === 'trade' && x.taxSwap) return `the token contract swapped ${cmp(x.bobai)} BOBAI of collected tax to ${bnbAmt(x.bnb, x.t)} for the buyback bot`;
  if (x.kind === 'trade') return x.ours ? `${whoTraded(x)}${x.buy ? 'bought' : 'sold'} ${tradeAmt(x)}` : `${x.buy ? '▲ buy' : '▼ sell'} ${tradeAmt(x)} · $${nf(x.usd * 0.03, 2)} tax to the brain`;
  if (x.kind === 'run') { const fed = [x.e.lpAgentTx && 'the DeFi agent', x.e.giggleTx && 'the Giggle pot'].filter(Boolean);
    return `bot split ${bnbAmt(x.e.totalBnb, x.t)}: burned ${cmp(x.e.bobaiBurned)} BOBAI (${$amt(burnUsd(x.e))}) + ${cmp(bobOf(x.e))} BOB${x.l ? ', added liquidity' : ''}${fed.length ? ', fed ' + fed.join(' and ') : ''}`; }
  if (x.kind === 'liq') return x.l.dev ? `dev wallet d38 added ${bnbAmt(x.l.bnb, x.t)} + ${cmp(x.l.bobai)} BOBAI to the pool, LP burned` : `added ${bnbAmt(x.l.bnb, x.t)} of liquidity, LP burned`;
  if (x.kind === 'defi') return `DeFi agent ${x.step}`;
  { const u = nUsd(x.n), r = bnbUsdAt(x.t); return `${$buy(u, x.n)} ${TIERS[x.n.tier] ? TIERS[x.n.tier].toLowerCase() : 'buy'}${r ? ' (' + bnbF(u / r) + ')' : ''} dropped NFT #${x.n.tokenId}`; }
}
// THE CANDLE UNDER THE MOUSE (2026-09-30, operator: "show it when the mouse is over the candle, not only on the green
// arrow above — and the same for sells"): its minutes, its buys and sells, every trade of it this page read (in BOBAI,
// BNB and dollars at that hour's BNB price), and the candle's total only when it holds more than one trade
// THE TRADES OF A CANDLE, THE BIG ONES NEVER LEFT OUT (operator, 2026-10-05: "over the candle all buys and sells are in
// it — please all correct"; a $9.5K sell was not named). The page reads every swap of about the last hour itself; a
// candle older than that takes the trades of $100 and more that the ledger keeps with it (rows' x, from 2026-10-05).
// More than `max`: the largest stay, in the order they happened, and the rest is counted.
function candleTrades(c, t0, t1, max) {
  let tr = S.hist.filter(x => x.t > t0 && x.t <= t1 && !x.taxSwap && x.usd >= 0.01), led = false;
  if (!tr.length && c.x && c.x.length) { led = true; tr = c.x.map(([buy, bnb, bobai, tx, to], i) => ({ buy: !!buy, bnb, bobai, usd: bnb * (c.u || S.bnbP), tx, t: t0 + i, ours: OURS.includes(to || ''), who: to || '' })); }
  const cut = Math.max(0, tr.length - max);
  if (cut) tr = [...tr].sort((a, b) => b.usd - a.usd).slice(0, max);
  return { tr: tr.sort((a, b) => a.t - b.t), cut, led };
}
const tradeRow = x => [x.ours ? '#F0B90B' : x.buy ? BUYC : SELLC, `${x.ours ? whoTraded(x) : ''}${x.buy ? '▲ buy' : '▼ sell'} ${tradeAmt(x)}`];
function candleTip(h) {
  const c = h.c, t0 = c.t - h.step, t1 = c.t, u = c.u || bnbUsdAt(t1), n = (c.b || 0) + (c.s || 0);
  const fmt = t => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const { tr, cut, led } = candleTrades(c, t0, t1, 8);
  const rows = tr.map(tradeRow);
  if (cut) rows.push(['#a0a2c0', `+ ${cut} smaller`]); else if (led && n > tr.length) rows.push(['#a0a2c0', `+ ${n - tr.length} under $100`]);
  const head = !n ? 'no trade' : `${c.b ? c.b + (c.b === 1 ? ' buy' : ' buys') : ''}${c.b && c.s ? ' · ' : ''}${c.s ? c.s + (c.s === 1 ? ' sell' : ' sells') : ''}`;
  // the candle's own figures from the ledger (BNB, its dollars, and its BOBAI at the candle's price): as the total when
  // it holds more than one listed trade, or on their own when its single trades are older than the page's read (~1 h) —
  // then they ARE that trade's figures for a one-trade candle (2026-09-30: an older candle showed "1 buy" and nothing)
  const px = c.o && c.c ? (c.o + c.c) / 2 : c.c, bob = px > 0 ? c.v / px : 0;
  const fig = `${bob > 1 ? '≈ ' + cmp(bob) + ' BOBAI · ' : ''}${bnbF(c.v)}${u ? ' · ' + $amt(c.v * u) : ''}`;
  const tot = c.v > 0 && (n > 1 && tr.length || !tr.length) ? ` · ${fig}${n > 1 ? ' in all' : ''}` : '';
  const chg = usdCh(c, c) ?? 0;
  return { time: `${fmt(t0)} – ${new Date(t1).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, head: head + tot, chg, rows,
    note: '' };
}
window.__btCandleTip = i => { const h = tlCandleHits[i ?? tlCandleHits.length - 1]; return h ? candleTip(h) : null; }; // for checks from outside
tl.addEventListener('mousemove', e => {
  tlMouse = e.clientX - tl.getBoundingClientRect().left;
  hover = near(e);
  if (!hover) {
    // no mark under the mouse: the candle it is over
    let hc = null, bd = 1e9; for (const h of tlCandleHits) { const d = Math.abs(h.x - tlMouse); if (d <= h.half && d < bd) { bd = d; hc = h; } }
    if (!hc) { tip.style.display = 'none'; return; }
    const ct = candleTip(hc), wr = win.getBoundingClientRect();
    tip.style.display = 'block'; tip.style.left = clamp(e.clientX - wr.left, 180, wr.width - 180) + 'px';
    tip.style.setProperty('--c', ct.chg > 0 ? BUYC : ct.chg < 0 ? SELLC : '#a0a2c0');
    tip.innerHTML = ''; const b = document.createElement('b'); b.textContent = ct.time;
    const s = document.createElement('div'); s.textContent = `${ct.head} · ${ct.chg >= 0 ? '+' : ''}${ct.chg.toFixed(2)}%`; tip.append(b, s);
    for (const [col, txt] of ct.rows) { const r = document.createElement('div'); r.style.color = col; r.textContent = txt; tip.append(r); }
    if (ct.note) { const r = document.createElement('div'); r.style.opacity = '.6'; r.textContent = ct.note; tip.append(r); }
    return;
  }
  const wr = win.getBoundingClientRect();
  tip.style.display = 'block'; tip.style.left = clamp(e.clientX - wr.left, 180, wr.width - 180) + 'px'; tip.style.setProperty('--c', evColor(hover));
  tip.innerHTML = ''; const b = document.createElement('b'); b.textContent = new Date(hover.t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const s = document.createElement('div'); s.textContent = describe(hover); tip.append(b, s);
});
tl.addEventListener('mouseleave', () => { hover = null; tlMouse = -1; tip.style.display = 'none'; });
// scrub: press or drag anywhere on the timeline to go to that minute; the time-lapse carries on from
// there. Dragging only moves the playhead (nothing fires); a tap on a mark also plays that moment.
let scrub = null;
const timeAt = x => { const w = tl.getBoundingClientRect().width; return from + clamp((x - TL0) / (w - 14 - TL0), 0, 1) * WIN; };
function seek(t) {
  events.sort((a, b) => a.t - b.t);
  if (mode !== 'replay') { mode = 'replay'; $('live').classList.add('rp'); $('live').lastChild.textContent = 'REPLAY · SCRUBBING'; $('rclk').classList.add('on'); rpLabel(); }
  playhead = clamp(t, from, Date.now()); rLast = 0;
  // THE FRESH ONES TOO (operator, 2026-10-02: "clicking the timeline during live, the animations come — but for the very
  // fresh ones too, from their start"): the replay's burst rule (momentIn) compared a just-played moment with ITSELF —
  // its live showing was the last board, within 15 s of chain time — and swallowed it. A seek starts a new sequence.
  LAST_M.t = -1e15; LAST_M.level = -1;
  cursor = events.findIndex(x => x.t >= playhead); if (cursor < 0) cursor = events.length;
  dotsFrom(playhead); // scrubbing fires nothing: the dots carry on from here
}
tl.addEventListener('pointerdown', e => {
  const x = e.clientX - tl.getBoundingClientRect().left; if (x < TL0) return;
  scrub = { x0: e.clientX, moved: false, hit: near(e) }; try { tl.setPointerCapture(e.pointerId); } catch {}
  nextAt = Infinity; seek(timeAt(x));
});
tl.addEventListener('pointermove', e => {
  if (!scrub) return;
  if (Math.abs(e.clientX - scrub.x0) > 4) scrub.moved = true;
  seek(timeAt(e.clientX - tl.getBoundingClientRect().left));
});
tl.addEventListener('pointerup', () => {
  if (!scrub) return;
  const s = scrub; scrub = null; nextAt = 0;
  $('live').lastChild.textContent = 'REPLAY · FROM HERE';
  // a buy with its own scene (an alert, its NFT not minted yet) replays that scene; any other trade is followed
  if (!s.moved && s.hit) { s.hit.lit = performance.now(); seek(s.hit.t); cursor++; if (s.hit.kind === 'trade' && !s.hit.ours && !(s.hit.buy && s.hit.usd >= ALERT_USD)) { nextAt = performance.now() + 6000; followTrade(s.hit); } else { run(s.hit, false); nextAt = performance.now() + momentMs(s.hit); } }
});
// Replay controls (A5, 2026-09-25): pause, and a speed that multiplies both the flight between moments
// and the moments themselves. The speed stays picked from one replay to the next; a pause does not.
const MULS = [1, 2, 4, 0.5];
let rMul = 1, paused = false;
function rpLabel() {
  $('rp').textContent = mode === 'replay' ? (portrait ? 'LIVE ›' : 'SKIP TO LIVE ›') : '↺ REPLAY ' + winKey;
  $('rp').closest('.tl').classList.toggle('rpon', mode === 'replay');
  const pp = $('rpp'); pp.textContent = paused ? '▶' : '❚❚'; pp.classList.toggle('on', paused); pp.setAttribute('aria-label', paused ? 'Play the replay' : 'Pause the replay');
  $('rps').textContent = '×' + (rMul === 0.5 ? '½' : rMul); $('rps').classList.toggle('on', rMul !== 1);
}
function togglePause() { if (mode !== 'replay') return; paused = !paused; rpLabel(); }
$('rpp').onclick = togglePause;
$('rps').onclick = () => { rMul = MULS[(MULS.indexOf(rMul) + 1) % MULS.length]; rpLabel(); };
// the next moment, now: the playhead jumps to it and it plays
function nextMoment() {
  if (mode !== 'replay') return;
  const x = events[cursor]; if (!x) { cursor = events.length; goLive(); return; }
  paused = false; nextAt = 0; playhead = Math.min(Date.now(), x.t); rpLabel();
}
addEventListener('keydown', e => {
  if (!bt.classList.contains('on') || e.target.closest('input, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === ' ') { if (e.target.closest('button')) return; // a focused button already takes the space as its own click
    e.preventDefault(); if (mode === 'replay') togglePause(); else startReplay(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); nextMoment(); }
  else if (e.key === 'l' || e.key === 'L') { if (mode === 'replay') { cursor = events.length; goLive(); } }
});
$('rp').onclick = () => { if (mode === 'replay') { cursor = events.length; goLive(); } else startReplay(); };
// ---------- the replay as a film: a title, every scene at full length, the day's sum at the end (2026-09-25) ----------
const WIN_WORD = { '1H': 'HOUR', '6H': '6 HOURS', '24H': '24 HOURS', '7D': '7 DAYS' };
let replayEnded = false;
function storyCard(kicker, title, spec, ms) {
  if (momentEl.classList.contains('held')) return;
  momentEl.classList.remove('defi'); momentEl.classList.add('story');
  momentEl.style.setProperty('--c', '#F0B90B'); momentEl.dataset.level = 2; momentEl._level = 2;
  momentEl.querySelector('.k').textContent = kicker; momentEl.querySelector('.h').textContent = title; showFlip(spec);
  momentEl.querySelector('.bar').textContent = ''; momentEl.querySelector('.card').hidden = true;
  stkCancel(); momentEl.classList.remove('go'); void momentEl.offsetWidth; momentEl.classList.add('go'); win.classList.add('in-moment', 'story-on');
  momentUntil = performance.now() + ms;
  clearTimeout(momentTimer); momentTimer = setTimeout(() => { momentEl.classList.remove('go', 'story'); win.classList.remove('in-moment', 'story-on'); }, ms);
}
function replaySum() {
  const burns = S.burns.filter(e => Date.parse(e.time) >= from), adds = S.liq.filter(l => Date.parse(l.time) >= from), man = S.man.filter(l => Date.parse(l.time) >= from);
  const drops = (S.nft?.drops || []).filter(n => n.ts * 1000 >= from), defi = events.filter(e => e.kind === 'defi' && e.t >= from).length;
  // the closing board: what the window added up to, written on his flipchart like every scene
  const rows = [];
  if (burns.length) rows.push(['BOBAI BURNED', cmp(burns.reduce((a, e) => a + (+e.bobaiBurned || 0), 0)), D.burnA.c]);
  if (drops.length) rows.push([drops.length > 1 ? drops.length + ' BUYS OF $100+' : 'A BUY OF $100+', $buy(drops.reduce((a, n) => a + nUsd(n), 0)), BUYC]);
  if (adds.length) rows.push(['LIQUIDITY LOCKED', bnb4(adds.reduce((a, l) => a + (parseFloat(l.bnb) || 0), 0)), D.liq.c]);
  if (man.length) rows.push(['DEV WALLET ADDED', bnb4(man.reduce((a, l) => a + (parseFloat(l.bnb) || 0), 0)) + ' + ' + cmp(man.reduce((a, l) => a + (+l.bobai || 0), 0)), D.liq.c]);
  if (defi) rows.push(['DEFI MOVES', String(defi), D.defi.c]);
  if (rows.length) return { head: 'THE SCORE', rows };
  // A QUIET STRETCH STILL SAYS SOMETHING (2026-09-30): "the bots kept watch" alone left a visitor with nothing — the
  // board adds the window's trades and the last burn before it, both from the record
  const trades = CH.rows.filter(r => r.t > from).reduce((a, r) => a + (r.b || 0) + (r.s || 0), 0); // the chart's own ledger: the same count it shows
  const lb = [...S.burns].filter(e => Date.parse(e.time) < from).sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
  return { head: 'A QUIET STRETCH', rows: [['THE BOTS', 'KEPT WATCH'], trades ? ['TRADES', nf(trades), BUYC] : null,
    lb ? ['LAST BURN · ' + ago(Date.parse(lb.time)).toUpperCase(), cmp(+lb.bobaiBurned || 0) + ' BOBAI', D.burnA.c] : null].filter(Boolean) };
}
function startReplay() {
  events.sort((a, b) => a.t - b.t); // live swaps were appended as they came
  from = Date.now() - WIN; cursor = events.findIndex(x => x.t >= from); if (cursor < 0) cursor = events.length;
  if (REDUCED) { cursor = events.length; goLive(); return; }
  mode = 'replay'; rStart = performance.now(); playhead = from; rLast = 0; paused = false; replayEnded = false; dotsFrom(from);
  LAST_M.t = -1e15; LAST_M.level = -1; // a new replay: its first moment is not compared with the last live one (see seek)
  storyCard('REPLAYED FROM THE CHAIN · EVERY EVENT IS REAL', 'THE LAST ' + WIN_WORD[winKey], null, 3600);
  nextAt = performance.now() + 3800; // the title has the stage before the clock starts
  $('rclk').classList.add('on'); rpLabel();
  $('live').classList.add('rp'); $('live').lastChild.textContent = 'REPLAY · ' + winKey; // short, on one line (the long form wrapped in two)
  logLine('REPLAY', '#F0B90B', ['the last ' + winKey + ', sped up · every event is real']);
}
function goLive() {
  mode = 'live'; paused = false; $('live').classList.remove('rp'); $('live').lastChild.textContent = 'LIVE'; $('rclk').classList.remove('on'); rpLabel();
  logLine('LIVE', '#00e676', ['watching the pool, the bots and the agent in real time']);
}
// THE SMALL TRADES IN THE REPLAY (operator, 2026-10-01): every swap the page read that has no scene (a buy under $100,
// any sell) flies into the brain as its dot when the playhead passes it — no board, no tax float, no slow-down. At a
// high speed a burst would fire dozens in one frame: four per frame show, the rest pass silently.
let dots = [], dotI = 0;
function dotsFrom(t) { dots = S.hist.filter(x => !isAlert(x) && !x.taxSwap && x.usd >= 0.01).sort((a, b) => a.t - b.t); dotI = dots.findIndex(x => x.t >= t); if (dotI < 0) dotI = dots.length; }
function replayDots(t) { let n = 0; while (dotI < dots.length && dots[dotI].t <= t) { const x = dots[dotI++]; if (n++ < 4) tradeDot(x); } }
// Time-lapse with time dilation: quiet hours fly past, and the playhead slows to a crawl while an
// event plays out, so the timeline, the scene and the log are always on the same moment.
let rLast = 0;
const momentMs = x => sceneMs(x, true); // the replay waits exactly as long as the scene plays
// THE REPLAY'S QUIET STRETCHES (2026-10-06, operator: "Halloween's features may pop up in the replay too, where there is
// time — a 24H replay has free stretches"): how many real seconds are left before the replay's next moment (Infinity
// live, 0 while a moment plays or the replay stands paused). A Halloween scene starts only where it fits.
function replayRoom() {
  if (mode !== 'replay') return Infinity;
  const now = performance.now(); if (paused || now < nextAt || now < sceneUntil) return 0;
  const speed = WIN / (REPLAY / 1000) * rMul, next = events[cursor];
  return Math.max(0, ((next ? next.t : Date.now()) - playhead) / speed);
}
function stepReplay(now) {
  if (mode !== 'replay') return;
  const rc = $('rclk');
  // paused: the clock stands, and the moment on screen keeps the time it had left
  if (paused) { if (rLast) nextAt += now - rLast; rLast = now; rc.lastChild.textContent = 'PAUSED · SPACE OR ▶ PLAYS ON'; return; }
  const dt = rLast ? Math.min(0.1, (now - rLast) / 1000) : 0; rLast = now;
  // busy until the moment on screen has had its full time — counted from when its board and move really showed (sceneUntil)
  const busy = now < nextAt || now < sceneUntil || stageBusy(), speed = WIN / (REPLAY / 1000) * rMul;  // history-ms per real second
  const next = events[cursor];
  let target = playhead + dt * speed * (busy ? 0.03 : 1);
  if (!busy && next && next.t <= target) target = next.t;            // land exactly on the next moment
  playhead = Math.min(Date.now(), target);
  replayDots(playhead);
  if (!busy && next && next.t <= playhead) {
    cursor++;
    // a trade without a board (BOBAI's own swaps) passes at speed: only a scene slows the clock (2026-10-01)
    if (next.t >= from) { next.lit = now; run(next, false); nextAt = now + (next.kind === 'trade' && !(next.buy && !next.ours && next.usd >= ALERT_USD) ? 150 : sceneMs(next, false) + 700) / rMul; }
  }
  // the replay clock: which minute of the past is on screen, and how fast it is running
  rc.firstChild.textContent = new Date(playhead).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).toUpperCase();
  rc.lastChild.textContent = busy ? 'SLOWED FOR THIS MOMENT' : '×' + nf(Math.round(speed / 1000)) + ' SPEED';
  if (playhead >= Date.now() - 1000 && cursor >= events.length && !busy) {
    if (!replayEnded) { replayEnded = true; storyCard('THAT WAS', WIN_WORD[winKey] + ' OF $BOBAI', replaySum(), 5600); nextAt = now + 5800; return; }
    goLive();
  }
}

// ================= adaptive quality =================
// Measured, not guessed: every 2 s the real frame rate decides. Below 45 fps the scene steps down —
// first sharpness, then the glow pass, then half the neurons — and never steps back up mid-session.
const Q = { tier: 0, acc: 0, n: 0 };
let useBloom = true;
const SMALL = matchMedia('(max-width: 820px)').matches;
if (SMALL) { renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); common.uPx.value = renderer.getPixelRatio(); bGeo.setDrawRange(0, NB * 0.6 | 0); }
function applyTier() {
  if (Q.tier >= 1) { renderer.setPixelRatio(1); common.uPx.value = 1; layout(); }
  if (Q.tier >= 2) useBloom = false;
  if (Q.tier >= 3) { bGeo.setDrawRange(0, NB * 0.45 | 0); synapses.visible = false; }
  window.__tier = Q.tier;
}
function adapt(dt) {
  if (introK < 1) return;
  Q.acc += dt; Q.n++;
  if (Q.acc >= 2) { window.__fps = Math.round(Q.n / Q.acc); if (window.__fps < 45 && Q.tier < 3) { Q.tier++; applyTier(); } Q.acc = 0; Q.n = 0; }
}

// ================= loop =================
let last = performance.now(), introK = 0, introStart = 0, opened = false, tlDrawnAt = 0, winWasOn = false;
function frame(now) {
  requestAnimationFrame(frame); FRAME_N++;
  if (!opened) return;
  // A WINDOW OVER IT (2026-09-28): with a card or page window open (the new page sets body.bp-winon) the terminal is
  // only a blurred backdrop, yet it drew every frame and the blur was recomputed with it — the page inside the window
  // began loading seconds late. It holds still until the window closes (dt is capped, so it resumes smoothly).
  if (document.body.classList.contains('bp-winon')) { last = now; winWasOn = true; return; }
  if (winWasOn) { winWasOn = false; afterWindow(); }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  common.uTime.value += dt;
  introK = clamp((now - introStart) / 2600, 0, 1);
  common.uIntro.value = REDUCED ? 1 : introK;
  // breathe + parallax: the brain turns toward the pointer, eased
  const ke = 1 - Math.exp(-dt * 3); smx += (mx - smx) * ke; smy += (my - smy) * ke;
  brain.rotation.y = Math.sin(common.uTime.value * 0.15) * 0.35 + smx * 0.5;
  brain.rotation.x = smy * 0.2;
  const br = 1 + Math.sin(common.uTime.value * 1.6) * 0.012;
  brain.scale.setScalar(br);
  // camera: pointer parallax + a slow lean toward the last action
  cam.push.multiplyScalar(Math.pow(0.55, dt));
  camera.position.x += (mx * 0.5 + cam.push.x - camera.position.x) * 0.025;
  camera.position.y += (-my * 0.3 + cam.push.y - camera.position.y) * 0.025;
  camera.position.z += (12 + cam.push.z - camera.position.z) * 0.025;
  // the view turns as gently as the camera moves (2026-10-01): lookAt followed the push at once, so every lean jolted
  cam.look.x += (cam.push.x * 0.6 - cam.look.x) * 0.025; cam.look.y += (cam.push.y * 0.6 - cam.look.y) * 0.025;
  camera.lookAt(cam.look.x, cam.look.y, 0);
  // figure
  const fk = clamp((introK - 0.45) / 0.35, 0, 1);
  const lean = smx * 3;
  fig.style.opacity = REDUCED ? 1 : fk;
  // a hop when a move lands: up and back down, stretched in the air, squashed on landing
  FACE.hop = Math.max(0, FACE.hop - dt * 2.6); const hp = FACE.hop, air = Math.sin((1 - hp) * Math.PI) * (hp > 0 ? 1 : 0), land = hp > 0 && hp < 0.25 ? (0.25 - hp) * 4 * (hp * 4) : 0;
  const bmT = REDUCED || VID.on ? { y: 0, r: 0, sy: 0, sx: 0 } : bodyMotion(pose, common.uTime.value); // real motion needs no puppet sway
  const ek = 1 - Math.exp(-dt * 5); for (const k in BMS) BMS[k] += (bmT[k] - BMS[k]) * ek; const bm = BMS;
  vidDraw();
  const ok = (now - OUCH_AT) / 1000, hit = ok >= 0 && ok < 0.9 ? Math.sin(ok * 26) * 6 * Math.exp(-ok * 5.5) * OUCH_SIDE : 0, dip = ok >= 0 && ok < 0.5 ? Math.sin(ok / 0.5 * Math.PI) * 1.6 : 0;
  fig.style.transform = `perspective(900px) rotateY(${lean}deg) rotateZ(${bm.r + hit}deg) translateY(${bm.y - air * 3.2 + dip}%) scale(${(0.92 + 0.08 * fk) * (1 - air * 0.02 + land * 0.05 + bm.sx)}, ${(0.92 + 0.08 * fk) * (1 + air * 0.03 - land * 0.06 + bm.sy)})`;
  faceTick(now);
  if (poseT > 0) poseT -= dt; // a move ends by itself: its clip comes home to the standing pose
  lifeTick(now);
  // core charge
  chargeShown += (charge - chargeShown) * 0.05; setRing(chargeShown * clamp(introK * 2 - 1, 0, 1));
  const cp = 1 + Math.sin(common.uTime.value * 3) * 0.08 * (0.4 + chargeShown);
  coreOrb.scale.setScalar(0.45 * cp + chargeShown * 0.3); coreHalo.material.opacity = 0.05 + chargeShown * 0.1;
  for (const d of DEST) {
    d.orb.scale.setScalar((0.28 + d.pct * 0.22 + d.boost * 0.45) * d.mScale); d.halo.scale.setScalar(1.3 * d.mScale); d.halo.material.opacity = (0.05 + d.boost * 0.3) * introK; d.orb.material.opacity = introK;
    if (d.obj) { d.obj.userData.update(dt, d.boost); d.obj.scale.setScalar(clamp(introK * 1.6 - 0.6, 0.001, 1) * d.mScale); }
  }
  updShocks(dt);
  for (const w of WORKERS) {
    orbitPt(w.ph + common.uTime.value * 0.12, w.pos); w.sp.position.copy(w.pos);
    w.flare = Math.max(0, w.flare - dt * 0.8);
    w.sp.scale.setScalar((0.3 + w.flare * 0.5 + Math.sin(common.uTime.value * 2 + w.ph) * 0.03) * introK);
  }
  orbit.material.opacity = 0.16 * introK;
  updStreams(dt); updComets(dt);
  // (no ambient flashes since 2026-09-26, operator: "the brain lights up and shines a bit much — only on actions on the
  // chain": the brain fires only for what really happened — a trade, a burn, liquidity, a step of a bot)
  // the labels wait for the intro title to go (2026-09-27: on a slow line 'BRAIN ONLINE' was typed over the buyback label)
  if (introK > 0.7 && $('intro').classList.contains('out')) { labs.querySelectorAll('.lab:not(.show)').forEach(l => l.classList.add('show')); }
  placeLabels(); fitPortrait(now);
  stepReplay(now);
  // The two canvases of candles are drawn at most 30 times a second, not every frame: at 60 fps the timeline redrew
  // every candle and mark with its glow each frame, the heaviest 2D work on the page (2026-09-26, the operator's
  // "Wackler"). The WebGL scene keeps its full rate.
  // live, the timeline walks a pixel every few seconds: ten draws a second are plenty (a phone spent a quarter of its
  // script time drawing it thirty times); a replay's playhead runs and the open chart follows the finger, so they keep thirty (2026-10-06)
  if (now - tlDrawnAt > (mode === 'replay' || CX.on ? 33 : 100)) { tlDrawnAt = now; drawCx(now); drawTl(now); }
  adapt(dt);
  useBloom ? composer.render() : renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ================= open / close / intro =================
const bt = $('bt');
const EMBED = bt.classList.contains('embed');
async function intro() {
  const el = $('intro'), text = 'BOBAI · BRAIN ONLINE';
  el.classList.remove('out'); el.textContent = '';
  for (let i = 0; i <= text.length; i++) { el.textContent = text.slice(0, i) + (i < text.length ? '▌' : ''); await new Promise(r => setTimeout(r, REDUCED ? 0 : 55)); }
  await new Promise(r => setTimeout(r, REDUCED ? 0 : 700)); el.classList.add('out');
}
let loaded = false;
export async function open() {
  // EMBEDDED (2026-09-26, the new page): the terminal is the page's centre window, not a pop-up over the homepage —
  // it neither locks the page's scroll nor claims the URL's hash, and nothing closes it.
  if (!EMBED && location.hash !== '#brain') history.replaceState(null, '', location.pathname + location.search + '#brain');
  // only the idle still now; the others load when a share card needs them (poseImg, 2026-09-27)
  fig.querySelectorAll('img[data-src][data-p="idle"]').forEach(i => { if (!i.getAttribute('src')) i.src = BASE + i.dataset.src; });
  bt.classList.add('on'); bt.classList.toggle('calm', REDUCED); if (!EMBED) document.body.style.overflow = 'hidden';
  await new Promise(r => requestAnimationFrame(r));
  loadExtraPoses(); faceInit(); vidInit();
  // no hint box any more (operator, 2026-09-26): BOBAI's own greeting bubble already says to tap him
  LIFE.next = performance.now() + 15000; // let the intro, the greeting and the first numbers land first
  // the greeting waits for the terminal to be live (2026-09-30: on a slow phone it was not yet at 3.6 s, the one try was
  // lost, the 9 s fallback started a rest take and the wave came 8 s late) — tried every half second, up to 20 s
  const tryGreet = (n = 0) => { if (SAID_HI) return; if (mode === 'live' && !QUEUE.length && performance.now() >= sceneUntil) greet(); else if (n < 33) setTimeout(() => tryGreet(n + 1), 500); };
  setTimeout(tryGreet, 3600);
  layout(); opened = true; introStart = performance.now(); last = performance.now();
  // focus on the window itself, not the close button: Space pauses the replay, and on a focused X it closed the terminal
  // (A5, 2026-09-25); not the prompt either: that would open the log over the scene. Tab still reaches every button.
  setTimeout(() => { win.tabIndex = -1; win.focus({ preventScroll: true }); }, 900);
  applyPhase();
  intro();
  if (loaded) return; loaded = true;
  liveSince = Date.now();
  logLine('BOOT', '#F0B90B', ['connecting to BNB Chain…']);
  const [evs] = await Promise.all([logs().catch(e => { window.__logsErr = String(e && e.stack || e); logLine('DATA', '#ff4d6d', ['a source did not answer: ' + String(e.message || e).slice(0, 60)]); return []; }), chain().catch(() => logLine('RPC', '#ff5a36', ['chain read failed, retrying']))]);
  events = evs;
  // one more try after a pause: a node that turned the first request away usually answers the second (2026-09-27)
  const hist = await backfill().catch(() => new Promise(r => setTimeout(r, 3000)).then(backfill)).catch(() => null);
  // a buy that minted an NFT plays once, as its drop (with the card) — the backfill's swap of it is not added again
  const dropped = new Set((S.nft?.drops || []).map(n => (n.buyTx || '').toLowerCase()).filter(Boolean));
  // ONLY THE MOMENTS JOIN THE RECORD (operator, 2026-10-01): a buy under $100 or a sell played as a full scene in the
  // replay, slowed down, with a tax float — many in a row were chaos and the replay took forever. They stay in S.hist
  // and the replay fires them as plain dots (replayDots), the way live shows them.
  for (const x of hist || []) if (isAlert(x) && !events.some(e => e.id === x.id) && !(x.buy && dropped.has(x.tx.toLowerCase()))) events.push(x);
  loadCandles(); setInterval(() => { if (!document.hidden && bt.classList.contains('on')) loadCandles(); }, 60e3);
  events.sort((a, b) => a.t - b.t);
  // a cold start on a slow line can come back empty: try the record again instead of showing an empty brain
  for (let i = 0; i < 3 && !events.length; i++) { await new Promise(r => setTimeout(r, 4000)); events = await logs().catch(() => []); }
  logLine('BOOT', '#F0B90B', ['brain online · ', [events.length + ' events'], ' on record']);
  // THE LOG STARTS WITH THE VISIT (operator, 2026-09-28: "a DeFi agent line from 15:50 is still in there — just start
  // at 'connecting to BNB Chain'"): no earlier moments are written in as history any more; the record plays in REPLAY.
  // REPLAY pressed while the record was still loading (a phone on a slow line): it starts now, with every event,
  // instead of being switched off by the boot's own LIVE (2026-09-27)
  if (mode === 'replay') startReplay(); else goLive();
  heartbeats(true); setInterval(() => { if (!document.hidden && bt.classList.contains('on')) heartbeats(false); }, 15000);
  setInterval(() => { if (!document.hidden && bt.classList.contains('on')) chain().catch(() => {}); }, 20000);
  // the homepage refreshed its figures: show them the same moment
  addEventListener('bobai:nums', () => { if (bt.classList.contains('on')) chain().catch(() => {}); });
  setInterval(() => { if (!document.hidden && bt.classList.contains('on') && mode === 'live') trades(); }, 8000);
  setInterval(async () => {
    if (document.hidden || !bt.classList.contains('on') || mode !== 'live') return;
    // a drop whose buy already played live is not played again
    const fresh = (await logs().catch(() => [])).filter(x => !events.some(y => y.id === x.id || (x.kind === 'nft' && y.kind === 'trade' && y.tx.toLowerCase() === (x.n.buyTx || '').toLowerCase())));
    // ONLY WHAT IS NEW SINCE THE VISIT (2026-09-28: a HUGE buy of 1.5 h before played live — a source had not answered
    // at load, so its drop looked new): older records join the record for the replay, silently
    for (const x of fresh) { events.push(x); if (x.t >= Math.max(liveSince - 120e3, Date.now() - 15 * 60e3)) enqueue(x); } // one after another; a long absence's backlog joins the record (and his 'while you were away')
  }, 45000);
}
function close() {
  if (EMBED) return;
  bt.classList.remove('on'); document.body.style.overflow = ''; opened = false;
  if (location.hash === '#brain') history.replaceState(null, '', location.pathname + location.search);
}
bt.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && bt.classList.contains('on')) close(); });
new ResizeObserver(() => { if (opened) { FIT.scale = 1; FIT.tries = 0; layout(); placeFlip(); } }).observe(win); // a new size is fitted afresh
// the clock has its time from the first frame: empty for its first half second, the title row widened and then shrank
// when the time came, and LIVE with the Halloween switch slid 57 px to the left (2026-10-06)
{ const clk = () => { $('clk').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }); }; clk(); setInterval(clk, 500); }

// ---------- MOMENTS (2026-09-26, operator: "the windows can be opened again, with their figures, charts and bars") ----------
// A scene's board is gone after a few seconds. Two ways back to it: a tap on the board holds it (the replay pauses with
// it; a second tap lets it go), and the MOMENTS list names every scene of the window on show — each burn, liquidity
// add, DeFi step, NFT drop and bigger buy — and plays the one tapped again, its board written anew from its own figures.
const scnBtn = document.createElement('button'); scnBtn.type = 'button'; scnBtn.className = 'scn'; scnBtn.setAttribute('aria-expanded', 'false');
scnBtn.innerHTML = '<span>◆ MOMENTS</span><b>0</b>';
{ const hud = document.querySelector('#bt .hud'), shr = $('shr'); if (hud) hud.insertBefore(scnBtn, shr && shr.parentNode === hud ? shr : null); else win.appendChild(scnBtn); }
const scnEl = document.createElement('div'); scnEl.className = 'scnl'; scnEl.setAttribute('role', 'dialog'); scnEl.setAttribute('aria-label', 'The moments of this window');
win.appendChild(scnEl);
const MOM_OK = x => x.kind === 'run' || x.kind === 'liq' || x.kind === 'defi' || x.kind === 'nft'
  || (x.kind === 'trade' && !x.ours && !x.taxSwap && x.buy && x.usd >= ALERT_USD); // alert buys only, $100+ like the TG bot (2026-09-30: NICE BUY starts at $0, so every buy was a moment)
const momList = () => { const t0 = Date.now() - WIN; return events.filter(x => x.t >= t0 && MOM_OK(x)).sort((a, b) => b.t - a.t); };
window.__btMoments = () => momList().map(x => [x.kind, x.kind === 'trade' ? Math.round(x.usd) : null]); // for checks from outside (2026-09-30: buys only $100+)
window.__btJokeState = () => [jokeShown, performance.now() < (LIFE.greetUntil || 0), !!LIFE.saidHi]; // for checks from outside
function momTitle(x) {
  if (x.kind === 'run') return ['BURN', cmp(x.e.bobaiBurned) + ' BOBAI · ' + cmp(bobOf(x.e)) + ' BOB'];
  if (x.kind === 'liq') return [x.l.dev ? 'DEV LIQUIDITY' : 'LIQUIDITY', '+' + bnbF(x.l.bnb) + (x.l.dev ? ' + ' + cmp(x.l.bobai) + ' BOBAI' : '') + ' · LP burned'];
  if (x.kind === 'defi') return ['DEFI AGENT', String(x.step || 'step')];
  if (x.kind === 'nft') return [TIERS[x.n.tier] || 'NFT DROP', '#' + x.n.tokenId + ' · ' + $buy(nUsd(x.n), x.n)];
  return [(tierOf(BUY_TIERS, x.usd) || [])[2] || 'BUY', '$' + nf(x.usd, x.usd < 10 ? 2 : 0)];
}
function paintScn() {
  const L = momList(); scnBtn.querySelector('b').textContent = L.length;
  const head = `<div class="scn-h"><b>MOMENTS · ${winKey}</b><span>tap one to see its board again</span><button type="button" class="scn-x" aria-label="Close">×</button></div>`;
  scnEl.innerHTML = head + (L.length ? '' : '<p class="scn-0">nothing big in this window yet — BOBAI is waiting</p>');
  const box = document.createElement('div'); box.className = 'scn-b';
  for (const x of L.slice(0, 40)) {
    const [k, v] = momTitle(x), r = document.createElement('button'); r.type = 'button'; r.style.setProperty('--c', evColor(x));
    r.innerHTML = '<i></i><em></em><b></b><small></small>';
    r.querySelector('em').textContent = k; r.querySelector('b').textContent = v;
    r.querySelector('small').textContent = new Date(x.t).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    r.onclick = e => { e.stopPropagation(); scnShow(false); replayMoment(x); };
    box.appendChild(r);
  }
  scnEl.appendChild(box);
  scnEl.querySelector('.scn-x').onclick = e => { e.stopPropagation(); scnShow(false); };
}
function scnShow(on) { if (on) paintScn(); scnEl.classList.toggle('on', on); scnBtn.setAttribute('aria-expanded', String(on)); }
scnBtn.onclick = e => { e.stopPropagation(); scnShow(!scnEl.classList.contains('on')); };
scnEl.addEventListener('click', e => e.stopPropagation());
setInterval(() => { if (opened) scnBtn.querySelector('b').textContent = momList().length; }, 5000);
// play one moment again; the replay holds still meanwhile, so the next scene does not cut in
let heldPaused = false;
let REOPEN = false; // a moment reopened from the list: shown again, not announced as new
function replayMoment(x) {
  if (mode === 'replay' && !paused) { paused = true; heldPaused = true; rpLabel(); }
  if (CX.on) { openCx(false); if (mview === 'chart') setView('brain'); }
  if (portrait && mview !== 'brain') setView('brain');
  if (momentEl.classList.contains('held')) { momentEl.classList.remove('held'); momentUntil = 0; }
  momentUntil = 0; x.lit = performance.now(); REOPEN = true; try { run(x, false); } finally { REOPEN = false; } sceneUntil = performance.now() + sceneMs(x, false) + 1500;
  if (x.kind === 'trade') followTrade(x);
}
// hold: a tap on the board keeps it; the next tap (or Esc) lets it go and the replay runs on
function holdRelease() {
  momentEl.classList.remove('held'); clearTimeout(momentTimer);
  stkCancel(); momentEl.classList.remove('go', 'defi', 'story'); win.classList.remove('in-moment', 'story-on');
  if (heldPaused) { heldPaused = false; paused = false; rpLabel(); }
  // let go by a second tap, the stage is free again (2026-10-05: only Esc and the 20 s limit cleared this — after a tap
  // it stayed at Infinity and every smaller board was skipped until a bigger moment came)
  momentUntil = 0;
}
function holdToggle(e) {
  if (!momentEl.classList.contains('go')) return;
  e.stopPropagation();
  if (momentEl.classList.contains('held')) { holdRelease(); return; }
  clearTimeout(momentTimer); momentEl.classList.add('held'); momentEl._heldAt = performance.now(); momentUntil = Infinity;
  if (mode === 'replay' && !paused) { paused = true; heldPaused = true; rpLabel(); }
}
momentEl.querySelector('.mc').addEventListener('click', holdToggle);
flipEl.addEventListener('click', holdToggle);
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (scnEl.classList.contains('on')) { e.stopImmediatePropagation(); scnShow(false); }
  else if (momentEl.classList.contains('held')) { e.stopImmediatePropagation(); holdRelease(); momentUntil = 0; }
}, true);

// ================= HALLOWEEN (2026-10-05) =================
// Operator (2026-10-05, after three rounds): "only the surroundings — the terminal's function and BOBAI's own animations
// stay; scary but also sweet; LESS IS MORE, but what is there is super, with detail, and everything in ONE style; the
// backdrop can go, the stone is super — build it like that; it must have to do with a blockchain; a switch that is
// always in sight; on a phone no display error, rather less". So: a handful of pieces in the stone's own 3D look, with
// muted colours, in a layer of their own UNDER BOBAI, the labels and every window (z 1, no pointer events):
//   THE IDEA     every station of BOBAI's work on the chain wears a costume (operator: "you can use the next-buyback
//                ring as the brain pumpkin, and the points like burn BOBAI"): the buyback ring holds the BRAIN PUMPKIN
//                (its candle is the charge), the BOBAI burn a skull and the BOB burn a coffin (burned is gone for
//                good), the liquidity boost a bubbling cauldron, the DeFi agent a spider (it spins the web), the
//                Giggle pot a pail of sweets (it is for children), the creator a black cat, the trades a bat.
//                Each sits ON its own light and nowhere else — so nothing is scattered, and everything means something
//                With the look on, the six stations and the ring's core show ONLY their costume (operator: "at the six
//                points only the Halloween symbols"): the scene's own lights there are hidden and come back with the
//                switch. The bots that circle the brain are small ghosts ("the small ghosts that fly round the brain").
//   CALM         operator: "far too nervous" — nothing bobs, shakes or flickers; ONE thing happens at a time, with
//                long pauses (the director below); the bat beats its wings only while it flies
//   the stone    a carved platform under his feet: a chain of blocks runs round it
//   the clown    a frightened red balloon rises behind the log box (a phone: behind the view tabs), two gloves take
//                hold of the edge, he looks, grins, blinks and sinks. And now and then he rises BEHIND BOBAI, about
//                BOBAI's size, hands out to grab — only while BOBAI stands, gone the moment he moves
//   blockchain   the ghost that floats through drags a chain of blocks; scared wax candles stand on the candle chart;
//                the one cobweb (top right) is a network with glowing nodes; a skull looks out of the BOBAI burn
//   and          a skeleton hand behind the timeline, a spider on its thread, two bats, a moon where the sky has room
//   windows      a destination's window gets a web in its corner, a spider under it, somebody peeking from behind it
// Every piece looks for a free spot (never over a label, a button or the log's text) and stays away where there is
// none; a phone gets fewer. Pictures: temp/terminal/gen-prop.js (gpt-image-2.5, frames as edits of one base) ->
// prop_pack.py (colours muted there). Season: October until 1 November (UTC), every year; ?hw=1 shows it outside the
// season, ?hw=0 never. The switch at the LIVE pill is remembered (localStorage bt-hw).
const hwSeason = (t = Date.now()) => { const d = new Date(t), m = d.getUTCMonth(); return m === 9 || (m === 10 && d.getUTCDate() < 2); };
window.__btHwSeason = hwSeason;
(() => {
  const q = new URLSearchParams(location.search).get('hw');
  if (q === '0' || (q !== '1' && !hwSeason())) return;
  let on = true; try { on = localStorage.getItem('bt-hw') !== '0'; } catch {}
  const R = (a, b) => a + Math.random() * (b - a), cl3 = (v, a, b) => Math.max(a, Math.min(b, v));
  // the pictures carry this file's own ?v=: a repainted picture under the same name came out of the browser's cache
  // as the old one (2026-10-05, "the old pumpkin is still somewhere and just comes")
  const Q = new URL(import.meta.url).search;
  // a small character: its base picture and its frames on top of each other, one of them shown
  const spr = (name, frames) => '<span class="hw-s" data-n="' + name + '">' + [''].concat(frames).map(f => '<img alt="" decoding="async" draggable="false" data-hw="' + name + (f ? '_' + f : '') + '" data-f="' + f + '"' + (f ? '' : ' class="on"') + '>').join('') + '</span>';
  const frame = (root, f, name) => {
    const s = root.querySelector('.hw-s' + (name ? '[data-n="' + name + '"]' : '')); if (!s) return;
    const t = s.querySelector('img[data-f="' + f + '"]'); if (!t || !t.complete || !t.naturalWidth) return; // a frame not loaded yet is no frame
    for (const i of s.children) i.classList.toggle('on', i === t);
  };
  const batH = '<b><img alt="" draggable="false" data-hw="bat"><img alt="" draggable="false" class="d" data-hw="bat_down"></b>';
  // the bat at TRADES has a third picture: wrapped in its wings, eyes wide (its fright)
  const batT = '<b><img alt="" draggable="false" data-hw="bat"><img alt="" draggable="false" class="d" data-hw="bat_down"><img alt="" draggable="false" class="f" data-hw="bat_scared"></b>';
  const el = document.createElement('div'); el.className = 'hw' + (REDUCED ? ' hw-calm' : ''); el.setAttribute('aria-hidden', 'true');
  // LESS IS MORE (operator, 2026-10-05: "so much small stuff, it is no fun"): five things stand (stone, pumpkin, cat, web
  // with its spider, the skull in the burn), four things happen, one at a time (the clown with his balloon, the clown
  // behind BOBAI, the skeleton hand, the ghost with its chain of blocks). Moon and candles are built but not placed.
  const EXTRAS = true; // operator after the layout picture: "the moon can come in too, and more blockchain Halloween" -> moon, candles on the candle chart, a chain of blocks hanging from the top
  el.innerHTML = ''
    + '<div class="hw-i hw-mo">' + spr('moon', ['panic']) + '</div>'
    + '<div class="hw-i hw-hc"><img alt="" draggable="false" data-hw="chain_v"></div>'
    + '<div class="hw-i hw-da"><img alt="" draggable="false" data-hw="dais"></div>'
    + '<div class="hw-grab"><div class="hw-grabm"><div class="hw-grabi">' + spr('stalker', ['grab']) + '</div></div></div>'
    + WORKERS.map(w => '<div class="hw-bg" style="--c:' + w.c + '"><img alt="" draggable="false" data-hw="ghost"></div>').join('')
    + '<div class="hw-i hw-o" data-k="burnA">' + spr('skull', ['scared']) + '</div>'
    + '<div class="hw-i hw-o" data-k="burnB">' + spr('coffin', ['scared']) + '</div>'
    + '<div class="hw-i hw-o" data-k="liq">' + spr('cauldron', ['scared']) + '</div>'
    + '<div class="hw-i hw-o" data-k="defi">' + spr('spider', ['blink', 'scared']) + '</div>'
    + '<div class="hw-i hw-o" data-k="giggle">' + spr('candy', ['scared']) + '</div>'
    + '<div class="hw-i hw-o" data-k="creator">' + spr('cat', ['blink', 'hiss']) + '</div>'
    + '<div class="hw-i hw-o" data-k="src"><span class="hw-ob">' + batT + '</span></div>'
    + '<div class="hw-web r"><img alt="" draggable="false" data-hw="web"></div>' /* one web, top right (operator, 2026-10-05: less is more) */
    + '<div class="hw-gh"><div class="hw-ghb"><img class="hw-chn" alt="" draggable="false" data-hw="chain">' + spr('ghost', ['peek', 'hide']) + '</div></div>'
    + '<div class="hw-i hw-cl"><div class="hw-clip"><div class="hw-ball"><img alt="" draggable="false" data-hw="balloon"></div><div class="hw-clo">' + spr('clown', ['grin', 'blink']) + '</div></div><div class="hw-burst"><s>' + batH + '</s><s>' + batH + '</s><s>' + batH + '</s><s>' + batH + '</s></div></div>'
    + '<div class="hw-i hw-pk a">' + spr('pumpkin', ['right', 'scream']) + '<i></i></div>'
    + '<div class="hw-i hw-cd"><img alt="" draggable="false" data-hw="candles"><i></i></div>'
    + '<div class="hw-i hw-hd"><div class="hw-clip"><div class="hw-hdi">' + spr('hand', ['grab']) + '</div></div></div>'
    + '<div class="hw-skl"><img class="hw-rope" alt="" draggable="false" data-hw="skeleton_rope"><img class="hw-sklb" alt="" draggable="false" data-hw="skeleton"></div>' /* the desktop: the skeleton that steals the moon */
    + '<div class="hw-mh"><img class="hw-arm" alt="" draggable="false" data-hw="hand_arm"><div class="hw-mhi">' + spr('hand', ['grab']) + '</div></div>'; /* a phone: the hand that steals the moon */
  win.insertBefore(el, win.querySelector('.vign'));
  const flyL = document.createElement('div'); flyL.className = 'hw-fly'; flyL.setAttribute('aria-hidden', 'true'); win.insertBefore(flyL, win.querySelector('.vign'));
  const $h = s => el.querySelector(s);
  // the chain hangs still and swings out once every 18-30 s (terminal.css .hw-hc.swing, 2026-10-07)
  const swingChain = () => setTimeout(() => { const c = $h('.hw-hc'); if (c && on && !REDUCED && !document.hidden) { c.classList.remove('swing'); void c.offsetWidth; c.classList.add('swing'); } swingChain(); }, 18000 + Math.random() * 12000);
  swingChain();
  const skl = $h('.hw-skl'), mh = $h('.hw-mh'), pkA = $h('.hw-pk.a'), cd = $h('.hw-cd'), mo = $h('.hw-mo'), hc = $h('.hw-hc'), cl = $h('.hw-cl'), gh = $h('.hw-gh'), hd = $h('.hw-hd'), da = $h('.hw-da'), grab = $h('.hw-grab');
  const BG = [...el.querySelectorAll('.hw-bg')];
  const ORBS = [...el.querySelectorAll('.hw-o')], sp = $h('.hw-o[data-k="defi"]'), cat = $h('.hw-o[data-k="creator"]');
  // only the two that look for a free edge are watched for something moving over them; the costumes sit on their lights
  const PIECES = [cl, hd, cd, mo, hc], ALL = [da, pkA, ...ORBS, ...PIECES]; // the platform is ground: it is placed, never moved out of anything's way
  // the destinations' windows: somebody behind it (under the window), a web in its corner (over it)
  const dl = document.createElement('div'); dl.className = 'hw-d'; dl.setAttribute('aria-hidden', 'true');
  dl.innerHTML = '<div class="hw-dp"><div class="hw-dpi">' + spr('ghost', ['peek', 'hide']) + spr('clown', ['grin', 'blink']) + '</div></div><div class="hw-ds"><u></u>' + spr('spider', ['blink']) + '</div>';
  const dw = document.createElement('div'); dw.className = 'hw-dw'; dw.setAttribute('aria-hidden', 'true'); dw.innerHTML = '<img alt="" draggable="false" data-hw="web">';
  win.insertBefore(dl, detail); detail.after(dw);

  // the switch: a small pumpkin at the LIVE pill (operator, 2026-10-05: "beside LIVE, not beside the mood — there it gets
  // into BOBAI's face"): under the pill on a wide screen, to its right on a phone
  const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'hw-sw'; sw.id = 'bt-hw';
  sw.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 6.6c0-2 .9-3.2 3-3.6" fill="none" stroke="var(--hs)" stroke-width="1.8" stroke-linecap="round"/><ellipse cx="12" cy="14" rx="9.2" ry="7.3" fill="var(--hf)" stroke="var(--hs)" stroke-width="1.5"/><path d="M7.4 12.6l1.7-2.6 1.7 2.6zM13.2 12.6l1.7-2.6 1.7 2.6zM7.6 15.4q4.4 3.6 8.8 0l-1.7.3-1.3 1.2-1.4-1-1.4 1-1.3-1.2z" fill="var(--he)"/><path class="hw-x" d="M3.5 21.5L20.5 3.5" fill="none" stroke="#ffb469" stroke-width="2.2" stroke-linecap="round"/></svg><b class="hw-oo"></b><span class="hw-t"></span>';
  // A badge at the pill's right end, pinned there by the script and taking no room: as a piece of the title row it
  // squeezed the title on every desktop size and pushed the last button out of a 1280 window (halloween.mjs rule 3).
  // Wide: it sits in the gap between the pill and the clock. Phone: beside the pill — and it steps down beside the mood
  // chip while BOBAI's line lies over the pill's row, so it is never out of sight.
  const livePill = $('live'); livePill.after(sw);
  // Wide: a piece of the title row right after the pill, as long as the row then still fits its window (remembered per
  // window width); where it does not (a 1280 screen), pinned over the gap after the pill. Phone: pinned beside the pill.
  let flowW = -1, flowOk = false, flowAt = 0;
  function swPlace() {
    const hud = sw.parentElement, h = hud.getBoundingClientRect(); if (!h.width) return;
    // not before the window knows its shape: placed by the wide rule on a phone, it showed cut at the left edge and
    // jumped right once layout() set .portrait (2026-10-06, operator). The class change calls this again.
    // It is placed by the layout the window wears now (its class), and shows only once that class fits the window's shape.
    const wr0 = win.getBoundingClientRect(); if (!wr0.width) return;
    const portrait = win.classList.contains('portrait'), settled = portrait === portraitNow(wr0);
    // does the title row still fit with the switch in it? Asked again while the row settles (its title wraps late)
    if (!portrait && (flowW !== (h.width | 0) || performance.now() - flowAt < 9000)) {
      if (flowW !== (h.width | 0)) { flowW = h.width | 0; flowAt = performance.now(); }
      // ... and without making the title any taller: squeezed, its second line wrapped and pushed the mood chip down into
      // the bots' names (layout.mjs, 1366x768)
      const tt = hud.querySelector('.ttl'); sw.classList.remove('hw-flow'); const h0 = tt ? tt.offsetHeight : 0;
      sw.classList.add('hw-flow'); sw.classList.remove('hw-min');
      const wr = win.getBoundingClientRect().right; flowOk = (!tt || tt.offsetHeight <= h0) && ![...hud.children].some(e => { const b = e.getBoundingClientRect(); return b.width > 0 && getComputedStyle(e).visibility !== 'hidden' && b.right > wr - 8; });
    }
    sw.classList.toggle('hw-flow', !portrait && flowOk); sw.classList.toggle('hw-min', !portrait && !flowOk);
    const lv = livePill.getBoundingClientRect(); if (!lv.width) return;
    // phone: beside the pill, always (operator: "it shall stay at LIVE, also while the speech bubble shows")
    // a tight wide row (1280, 1366): the badge hangs just under the pill's right end — beside it, it covered the clock's
    // first digit (operator, 2026-10-05: option 1, "under LIVE")
    if (!portrait && !flowOk) { sw.style.setProperty('--sx', lv.right - h.left - 22 + 'px'); sw.style.setProperty('--sy', lv.bottom - h.top + 4 + 'px'); }
    else { sw.style.setProperty('--sx', lv.right - h.left + (portrait ? 8 : -7) + 'px'); sw.style.setProperty('--sy', lv.top - h.top + (lv.height - 26) / 2 + 'px'); }
    if (!sw._in && settled) { sw._in = true; requestAnimationFrame(() => sw.classList.add('hw-in')); } // there from the start, placed before it shows
  }
  const swT0 = performance.now();
  new MutationObserver(swPlace).observe(win, { attributes: true, attributeFilter: ['class'] });
  { const ro = new ResizeObserver(() => swPlace()); ro.observe(win); ro.observe(sw.parentElement); ro.observe(livePill); addEventListener('resize', swPlace); } // the window and its title row settle during the intro (and a page scrollbar that goes moves them)
  let sayT = 0;
  // its name folds out beside it, over whatever is there, for a moment. The class is hw-say, NOT say: `#bt .say` is
  // BOBAI's speech bubble (opacity 0, scale .6) — with it the button vanished for as long as its name showed (2026-10-05,
  // operator: "click off and the button goes too")
  const hint = ms => { const t = sw.querySelector('.hw-t'); if (t.dataset.t) t.dataset.t = t.dataset.t.replace(portrait ? 'click' : 'tap', portrait ? 'tap' : 'click'); sw.classList.add('hw-say'); clearTimeout(sayT); sayT = setTimeout(() => sw.classList.remove('hw-say'), ms); };

  // ---- the night behind everything: a painting fixed to the camera, drawn first, faded in by its brightness ----
  let back = null, backKey = '', backTo = 0, backLit = 0;
  // the night far behind: the calm painting, nearly without colour and dim (operator, 2026-10-05: first "the backdrop
  // can go", then "though the backdrop is not so bad") — a horizon, not a picture
  const BACKDROP = true;
  const BACK_LIT = 0.6; // how bright the painting stands behind the scene (1 = as painted)
  const backFade = () => {
    if (!back) return; const to = on ? BACK_LIT : 0, from = backLit, t0 = performance.now(); clearInterval(backTo);
    if (to === from) { back.visible = to > 0; return; }
    if (to > 0) back.visible = true;
    // by the clock, not by the tick count: a busy page fires the timer late and the fade must still end on time
    backTo = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / 1400); backLit = from + (to - from) * k; back.material.color.setScalar(backLit); if (k >= 1) { back.visible = to > 0; clearInterval(backTo); } }, 40);
  };
  function sizeBack() {
    if (!back) return; const va = camera.aspect, h = 2 * 40 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.07, t = back.material.map, ta = back._ta;
    back.scale.set(h * va, h, 1);
    // cover the window: a wider window loses a strip below (the moon stays), a narrower one a strip at the right (the wide painting's moon is on its left)
    if (va > ta) { t.repeat.set(1, ta / va); t.offset.set(0, (1 - ta / va) * 0.62); } else { t.repeat.set(va / ta, 1); t.offset.set((1 - va / ta) * (backKey === 'wide' ? 0.2 : 0.85), 0); } /* the tall painting's moon is on its right */
  }
  function loadBack() {
    const key = portrait ? 'tall' : 'wide'; if (key === backKey) return; backKey = key;
    new THREE.TextureLoader().load(BASE + 'hw/back-' + key + '.webp' + Q, tex => {
      if (key !== backKey) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      if (!back) {
        // opaque and first in line (the scene's solid pieces are drawn before anything see-through), writing no depth
        back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
        back.renderOrder = -100; back.frustumCulled = false; back.position.z = -40; back.visible = false;
        if (!camera.parent) scene.add(camera); camera.add(back);
        // the night breathes: a slow drift inside the painting's spare margin
        back.onBeforeRender = () => { const t = performance.now() / 1000; back.position.x = Math.sin(t / 23) * 0.1; back.position.y = Math.cos(t / 31) * 0.07; }; /* a breath, no more: the moon sticker sits on the painted moon */
      } else { back.material.map.dispose(); back.material.map = tex; back.material.needsUpdate = true; }
      back._ta = tex.image.width / tex.image.height; back._key = key; sizeBack(); backFade(); sig = ''; { const r = win.getBoundingClientRect(), m = moonBox(r.width, r.height); put(mo, m, m ? box(-9, -9, 1, 1) : null); } /* the moon takes its place on the painted one */
    });
  }
  // the moon picture sits exactly on the painted moon and comes WITH the painting (placed with the other pieces after
  // the intro, the painted moon stood alone for a second first — operator: "the old moon is still visible")
  function moonBox(W, H, raw) {
    if (!back || !back._ta || back._key !== (portrait ? 'tall' : 'wide')) return null; let M1 = null;
    const va = W / H, ta = back._ta, wide = backKey === 'wide', mx = wide ? 0.341 : 0.816, my = wide ? 0.259 : 0.184, md = wide ? 0.056 : 0.073; let x, y, dia;
    if (va > ta) { const ry = ta / va, oy = (1 - ry) * 0.62; x = mx * W; y = (1 - ((1 - my) - oy) / ry) * H; dia = md * W; }
    else { const rx = va / ta, ox = (1 - rx) * (wide ? 0.2 : 0.85); x = (mx - ox) / rx * W; y = my * H; dia = md * W / rx; }
    // the painting is drawn 7% larger than the window (sizeBack), about its middle
    x = W / 2 + (x - W / 2) * 1.07; y = H / 2 + (y - H / 2) * 1.07; dia *= 1.07;
    const mr = cl3(dia * 0.64, 16, 54); /* the picture's moon is a little larger than the painted one it covers */ M1 = x > mr && x < W - mr ? box(x - mr, y - mr, mr * 2, mr * 2) : null;
    // where the painted moon lies against his head (1280, 1366: the moon picture covered the bots' names beside his
    // brain) only the dim painted one stays — far behind, it covers nothing
    if (M1 && !raw && !portrait && A.figScreen && A.figHpx) { /* never on a phone: there the painted moon alone was the complaint */ const fs = A.figScreen, fh = A.figHpx, fw = A.figW, hd = box(fs.x - fw * 0.43, fs.y - fh * 0.5, fw * 0.86, fh * 0.47); if (cut(M1, hd, 14) && (M1.t + M1.b) / 2 > hd.t) M1 = null; } /* beside the head, not above it */
    return M1;
  }
  function lights(v) {
    for (const d of DEST) { if (!(d.pct > 0)) continue; if (d.obj) d.obj.visible = v; d.orb.visible = v && !d.obj; }
    coreOrb.visible = v;
  }
  // the bots' ghosts ride on the bots' own places, frame by frame (behind the brain they pale, like the bots' names)
  // Small, about the size of the bots' own lights, and there from the first frame the bots are (operator, 2026-10-05:
  // "the ghosts at loading must be much smaller and already be at the brain" — they used to pop in, twice as large,
  // only once the bots' names showed)
  let flying = false, gsz = 0;
  function fly() {
    if (!on) { flying = false; return; } requestAnimationFrame(fly); if (!winBox().width || !A.figHpx) return;
    const g = Math.round(cl3(A.figHpx * (portrait ? 0.0525 : 0.0575), 11, 20)); /* 25% up again (operator: "a tiny bit larger") */ if (g !== gsz) { gsz = g; el.style.setProperty('--bg', g + 'px'); }
    for (const [i, w] of WORKERS.entries()) { const q = toScreen(w.pos), e = BG[i], tf = 'translate(' + (q.x - gsz / 2).toFixed(1) + 'px,' + (q.y - gsz * 0.62).toFixed(1) + 'px)', op = (introK * (w.el.classList.contains('under') ? 0.08 : w.pos.z > A.head.z ? 0.95 : 0.38)).toFixed(2); if (e._tf !== tf) e.style.transform = e._tf = tf; if (e._op !== op) e.style.opacity = e._op = op; } /* written only when changed */
  }
  function load() {
    for (const root of [el, dl, dw]) root.querySelectorAll('img[data-hw]').forEach(i => { if (!i.getAttribute('src')) { i.addEventListener('load', () => { sig = ''; }, { once: true }); i.src = BASE + 'hw/' + i.dataset.hw + '.webp' + Q; } });
  }

  // ---- finding free spots (all in window pixels) ----
  const box = (x, y, w, h) => ({ l: x, t: y, r: x + w, b: y + h });
  const cut = (a, b, pad = 0) => a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;
  // a piece's place; c = the part of it that must stay free (a thread or a rising balloon may pass behind things)
  // A piece that must go somewhere else fades out and comes up at its new place: moved while seen, it jumped across the
  // scene (operator, 2026-10-05: the phone's moon "goes first to the old one and then to its right place")
  const put = (e, b, c) => {
    clearTimeout(e._mv);
    if (!b) { e.classList.remove('put'); e._b = e._c = null; return; }
    const o = e._b, far = o && e.classList.contains('put') && e.classList.contains('hw-i') && (Math.abs(o.l - b.l) > 8 || Math.abs(o.t - b.t) > 8 || Math.abs((o.r - o.l) - (b.r - b.l)) > 12);
    const go = () => { Object.assign(e.style, { left: b.l + 'px', top: b.t + 'px', width: b.r - b.l + 'px', height: b.b - b.t + 'px' }); e.classList.add('put'); };
    e._b = b; e._c = c || b;
    if (far) { e.classList.remove('put'); e._mv = setTimeout(go, 260); } else go();
  };
  let walls = [], term = null, sig = '', hudB = 60, jokeAt = null;
  function read() {
    const r = win.getBoundingClientRect(); walls = []; term = null;
    for (const e of win.querySelectorAll('.lab, .joke, .hud > *, .ttl > *, .term, .tl, .mtabs, .phase, .rclk, .chart-open, .bt-big')) {
      let b = e.getBoundingClientRect();
      // the joke button changes its width with its words ("TELLING YOU SOMETHING", 240 px) and hides while a clip
      // plays: its widest footprint, at its last place, always stays clear (the hand came up behind it, 1440x900)
      if (e === jokeBtn) { if (b.width >= 2) jokeAt = { cx: (b.left + b.right) / 2 - r.left, t: b.top - r.top, b: b.bottom - r.top }; if (!jokeAt) continue; walls.push({ l: jokeAt.cx - 130, t: jokeAt.t, r: jokeAt.cx + 130, b: jokeAt.b, e }); continue; }
      if (b.width < 2 || b.height < 2) continue;
      const w = { l: b.left - r.left, t: b.top - r.top, r: b.right - r.left, b: b.bottom - r.top, e };
      if (e.classList.contains('term')) term = w; else if (!e.classList.contains('ttl')) walls.push(w);
    }
    // the title itself is bare text inside .ttl: its box comes from a range over the row's contents
    const tt = win.querySelector('.ttl'); if (tt) { const g = document.createRange(); g.selectNodeContents(tt); const b = g.getBoundingClientRect(); if (b.width > 2) walls.push({ l: b.left - r.left, t: b.top - r.top, r: b.right - r.left, b: b.bottom - r.top, e: tt }); }
    hudB = 0; for (const w of walls) if (w.e && w.e.closest('.hud')) hudB = Math.max(hudB, w.b);
    // the scene's own lights are no elements: the destinations' orbs, the buyback ring and the trades' orb keep their room too
    if (A.figHpx) { const o = (v, rad, k) => { const p = toScreen(v); walls.push({ l: p.x - rad, t: p.y - rad, r: p.x + rad, b: p.y + rad, e: null, k }); };
      for (const d of DEST) if (d.pct > 0) o(d.pos, A.figHpx * (portrait ? 0.07 : 0.1), d.k); o(A.core, A.figHpx * (portrait ? 0.12 : 0.21), 'core'); o(A.src, A.figHpx * 0.06, 'src'); }
    return r;
  }
  const free = (b, pad = 5, withTerm = true) => b.l >= 2 && !walls.some(w => cut(b, w, pad)) && !(withTerm && term && cut(b, term, pad));
  function place() {
    if (!A.figScreen || !A.figHpx) return false;
    const r = read(), W = r.width, H = r.height, fs = A.figScreen, fh = A.figHpx, fw = A.figW, feet = fs.y + fh * 0.405; /* the ground line just in front of his shoes (the figure's box reaches further down) */
    el.style.setProperty('--w', W + 'px'); el.style.setProperty('--h', H + 'px');
    const trunk = box(fs.x - fw * 0.2, fs.y - fh * 0.5, fw * 0.4, fh), head = box(fs.x - fw * 0.43, fs.y - fh * 0.5, fw * 0.86, fh * 0.47); // his trunk and his head: nothing of ours hides behind them
    const taken = [];
    const him = b => cut(b, trunk) || cut(b, head);
    const ok = (b, pad, withTerm, near = 2) => free(b, pad, withTerm) && b.r <= W - 2 && !him(b) && !taken.some(t => cut(b, t, near));
    // --- the clown first (wide screens): behind the log box, his gloves on its top edge, his balloon beside him
    let C = null, Cc = null;
    if (!portrait && term && term.r - term.l > 200) {
      const tw = term.r - term.l, cw = cl3(tw * 0.21, 56, 82), ch = cw * 219 / 230, bw = cw * 1.36;
      for (const f of [0.7, 0.52, 0.84, 0.36, 0.2]) {
        const l = term.l + tw * f - cw / 2, rest = box(l, term.t + 2 - ch, cw, ch);
        if (l >= term.l + 4 && l + cw <= term.r - 4 && l + bw <= W - 4 && ok(box(rest.l, rest.t + ch * 0.12, cw, ch * 0.88), 3, false)) { C = box(l, term.t + 2 - bw, bw, bw); Cc = rest; cl.style.setProperty('--cw', cw + 'px'); break; }
      }
    }
    // a phone has no log box in view: there he comes up behind the row of view tabs, at the bottom of the scene. A wide
    // screen whose log box has no free edge: behind the timeline (operator: "the clown with the balloon is missing")
    if (portrait || !C) {
      const mt = walls.find(w => w.e && w.e.classList.contains(portrait ? 'mtabs' : 'tl'));
      if (mt) {
        const cw = cl3(W * 0.17, 50, 70), ch = cw * 219 / 230, bw = cw * 1.36; let best = null, bestN = 99;
        // phone: between the first and the second column of stations (operator: "between DeFi agent and Giggle pot, not in the middle")
        for (const f of portrait ? [0.345] : [0.62, 0.74, 0.5, 0.86, 0.4]) {
          const l = cl3(W * f - cw / 2, 4, W - bw - 4), rest = box(l, mt.t - ch, cw, ch - 3), n = walls.filter(w => w.e !== mt.e && cut(box(rest.l, rest.t + ch * 0.2, cw, ch * 0.7), w, 2)).length + (term && cut(rest, term, 2) ? 5 : 0);
          if (n < bestN) { bestN = n; best = [l, rest]; if (!n) break; }
        }
        if (best) { C = box(best[0], mt.t + 2 - bw, bw, bw); Cc = bestN ? null : best[1]; cl.style.setProperty('--cw', cw + 'px'); }
      }
    }
    put(cl, C, Cc || (C ? box(-9, -9, 1, 1) : null)); if (Cc) taken.push(Cc);
    // --- the stone platform under his feet (ground, so it asks nobody)
    const dW = cl3(fw * (portrait ? 1.3 : 1.9), 90, portrait ? 280 : 580), dH = dW * 260 / 640;
    put(da, box(fs.x - dW / 2, feet - dH * 0.2, dW, dH));
    // --- the brain pumpkin lives in the buyback ring: the ring charges round it
    { const c = toScreen(A.core), z = cl3(fh * (portrait ? 0.14 : 0.215), 30, 96); put(pkA, box(c.x - z / 2, c.y - z * (portrait ? 0.6 : 0.52), z, z * 260 / 253)); }
    // --- every station wears its costume, on its own light
    const stage = fh * (portrait ? 0.11 : 0.138), SZ = { burnA: 0.92, burnB: 1.05, liq: 1.12, defi: 1.2, giggle: 1.08, creator: 1.15, src: 1.25 };
    for (const o of ORBS) {
      const k = o.dataset.k, d = k === 'src' ? null : D[k]; if (d && !(d.pct > 0)) { put(o, null); continue; }
      const c = toScreen(d ? d.pos : A.src), i = o.querySelector('img'), z = cl3(stage * SZ[k], 20, 60), ar = i.naturalWidth ? i.naturalHeight / i.naturalWidth : 1;
      const w = ar > 1.25 ? z / ar * 1.15 : z;
      // it leans away from its label: the label stands right of the light on a wide screen, under it on a phone
      let b = k === 'src' || portrait ? box(c.x - w / 2, c.y - w * ar * (portrait ? 0.66 : 0.54), w, w * ar) : box(c.x - w * 0.64, c.y - w * ar * 0.54, w, w * ar);
      // a phone stacks the buyback ring right over BURN $BOB: the coffin stood half behind the pumpkin — it steps down clear of it
      if (pkA._b && cut(b, pkA._b)) { const d = Math.min(12, pkA._b.b + 2 - b.t); b = box(b.l, b.t + d, b.r - b.l, b.b - b.t); }
      put(o, b);
    }
    // --- the skeleton hand (wide screens): it comes up behind the timeline's top edge
    let H1 = null, Hc = null; const tl = walls.find(w => w.e && w.e.classList.contains('tl'));
    if (!portrait && tl) {
      const hi = hd.querySelector('img'), hw = cl3(H * 0.07, 44, 66), hh = hw * (hi.naturalWidth ? hi.naturalHeight / hi.naturalWidth : 1.7);
      for (const f of [0.76, 0.7, 0.82, 0.64, 0.88, 0.58, 0.94, 0.52, 0.46, 0.4, 0.34]) {
        const l = W * f - hw / 2, rest = box(l, tl.t - hh, hw, hh - 3);
        if (!walls.some(w => w.e !== tl.e && cut(rest, w, 4)) && !(term && cut(rest, term, 4)) && !him(rest) && !taken.some(t => cut(rest, t, 2))) { H1 = box(l, tl.t + 2 - hh, hw, hh); Hc = rest; break; }
      }
      // no free spot (operator: "the skeleton hand still comes, doesn't it?"): it comes up where the least stands before it
      // no free spot on the timeline's edge (1366x768): it rises out of the stone, beside his feet, on the side away from
      // the buyback ring — behind the joke button it was never seen
      // (the clown's resting place does not count: hand and clown never come at the same time, handScene waits for him)
      if (!H1) { const feet = fs.y + fh * 0.36, core = toScreen(A.core), side = core.x > fs.x ? -1 : 1;
        for (const k of [0.62, 0.8, 0.5, 0.95]) { const l = fs.x + side * fw * k - hw / 2, ov = term && l < term.r && l + hw > term.l ? Math.min(feet, term.t) : feet, rest = box(l, feet - hh, hw, ov - (feet - hh) - 3);
          if (rest.l >= 4 && rest.r <= W - 4 && rest.b - rest.t > hh * 0.55 && !walls.some(w => cut(rest, w, 3)) && !(term && cut(rest, term, 0)) && !cut(rest, trunk, 2)) { H1 = box(l, feet + 2 - hh, hw, hh); Hc = rest; break; } } } /* its foot may pass behind the log box's roof (1440x900): the box is drawn over this layer */
      if (!H1) { let bestN = 99; for (const f of [0.7, 0.82, 0.58, 0.9, 0.46]) { const l = W * f - hw / 2, rest = box(l, tl.t - hh, hw, hh - 3), n = walls.filter(w => w.e !== tl.e && cut(rest, w, 2)).length + (term && cut(rest, term, 2) ? 4 : 0) + taken.filter(t => cut(rest, t, 2)).length * 2; if (n < bestN) { bestN = n; H1 = box(l, tl.t + 2 - hh, hw, hh); } } Hc = box(-9, -9, 1, 1); }
    }
    put(hd, H1, Hc); if (Hc) taken.push(Hc);
    // --- wax candles on the candle chart: they stand on the timeline's top edge (wide screens)
    let D1 = null;
    if (EXTRAS && !portrait && tl) {
      const dh = cl3(H * 0.075, 40, 62), dwd = dh * 177 / 200;
      for (const f of [0.9, 0.82, 0.7, 0.58, 0.46, 0.36]) {
        const b = box(W * f - dwd / 2, tl.t + 4 - dh, dwd, dh), c = box(b.l, b.t, dwd, dh - 8);
        if (!walls.some(w => w.e !== tl.e && cut(c, w, 4)) && !(term && cut(c, term, 4)) && !him(c) && !taken.some(t => cut(c, t, 4))) { D1 = b; put(cd, b, c); taken.push(c); break; }
      }
    }
    if (!D1) put(cd, null);
    // --- a moon where the sky has room: left of his head, under the title row
    // with the far night behind it stands where the painting's moon stood (moonBox); where that place lies beside his
    // head (1280, 1366) it takes a free spot of the sky like this — neither painting has a moon of its own any more
    // (operator, 2026-10-06: "on the desktop the moon is still the old one — it must be the one with the face")
    let M1 = BACKDROP ? moonBox(W, H) : null;
    { const top = fs.y - fh * 0.5, gap = top - hudB, mr = cl3(fh * 0.13, 20, 46);
      if (EXTRAS && !M1 && gap > mr * 1.6) for (const fx of portrait ? [0.82, 0.14] : [fs.x / W - fw * 1.05 / W, fs.x / W + fw * 1.0 / W, 0.5]) {
        const b = box(W * fx - mr, hudB + gap * 0.46 - mr, mr * 2, mr * 2); if (ok(b, 6, true)) { M1 = b; break; }
      } }
    // still none (1280, 1366: the sky beside his head is full of names): the free spot of the upper sky nearest to the
    // painting's old moon place, never on the bots' orbit round his brain (their names ride on it)
    if (EXTRAS && BACKDROP && !M1) { const P = moonBox(W, H, true), mr = P ? (P.r - P.l) / 2 : cl3(fh * 0.13, 20, 46), px = P ? (P.l + P.r) / 2 : W * 0.34, py = P ? (P.t + P.b) / 2 : hudB + mr * 2; let best = Infinity;
      const ob = { l: W, t: H, r: 0, b: 0 }, v = new THREE.Vector3(); for (let i = 0; i < 32; i++) { const q = toScreen(orbitPt(i / 32 * Math.PI * 2, v)); ob.l = Math.min(ob.l, q.x); ob.r = Math.max(ob.r, q.x); ob.t = Math.min(ob.t, q.y); ob.b = Math.max(ob.b, q.y); }
      const orb = box(ob.l - 30, ob.t - fh * 0.2, ob.r - ob.l + 60, ob.b - ob.t + fh * 0.4);
      for (let y = hudB + 4; y + mr * 2 <= H * 0.6; y += 8) for (let x = 4; x + mr * 2 <= W - 4; x += 8) { const b = box(x, y, mr * 2, mr * 2), d = Math.hypot(x + mr - px, y + mr - py); if (d < best && !cut(b, orb, 0) && ok(b, 6, true)) { best = d; M1 = b; } } }
    // the same moon on every screen (operator, 2026-10-05: "the phone's moon can be the same as the desktop's"): on a small
    // window it may stand partly behind a button of the title row — better than the painted one alone
    put(mo, M1, M1 ? box(-9, -9, 1, 1) : null); if (M1) taken.push(M1);
    // --- a chain of blocks hangs from the top edge, in a free column (it may pass behind the title row's buttons; its lower half must be free)
    let C1 = null;
    { const chh = Math.max(cl3(H * 0.27, 90, 240), hudB + 80), cw2 = chh * 96 / 300; /* long enough to come out under the title row */
      // EVERY COLUMN IS TRIED (operator, 2026-10-06: "where is the beautiful chain that came down from the top?"): the seven
      // fixed spots it had were all taken once the title row and the pieces grew, so it hung nowhere — now the free
      // column nearest to the first choice
      const want = portrait ? [0.9, 0.08] : [0.6, 0.52, 0.68, 0.44, 0.36, 0.76, 0.28], fits = x => { const b = box(x, -chh * 0.06, cw2, chh), rest = box(b.l, hudB + 2, cw2, b.b - hudB - 2); /* always from the top edge (operator, 2026-10-06), behind the title row (the layer lies under it): only what hangs below the row must be free */ return b.l >= 2 && b.r <= W - 2 && b.b > hudB + 30 && !walls.some(w => cut(rest, w, 5)) && !him(rest) && !taken.some(t => cut(rest, t, 4)) ? [b, rest] : null; };
      let got = null, bd = Infinity; for (const f of want) { const g = fits(W * f - cw2 / 2); if (g) { got = g; break; } }
      if (!got) for (let x = 2; x + cw2 <= W - 2; x += 6) { const g = fits(x), d = Math.abs(x + cw2 / 2 - W * want[0]); if (g && d < bd) { bd = d; got = g; } }
      if (got) { C1 = got[0]; put(hc, got[0], got[1]); taken.push(got[1]); } }
    if (!C1) put(hc, null);
    sizeBack();
    return true;
  }
  const sigNow = () => { const r = win.getBoundingClientRect(), t = win.querySelector('.term'), tb = t ? t.getBoundingClientRect() : null; return [r.width | 0, r.height | 0, portrait, tb ? (tb.top - r.top) | 0 : 0, tb ? tb.width | 0 : 0, (A.figHpx || 0) | 0].join('|'); };

  // ---- the destinations' windows ----
  let dKey = '';
  function detailDecor() {
    const open = on && detail.classList.contains('on');
    if (!open) { if (dKey) { dKey = ''; dl.classList.remove('on', 'go'); dw.classList.remove('on'); } return; }
    const r = win.getBoundingClientRect(), d = detail.getBoundingClientRect(), b = { l: d.left - r.left, t: d.top - r.top, r: d.right - r.left, b: d.bottom - r.top };
    if (b.r - b.l < 40) return;
    const dp = dl.querySelector('.hw-dp'), ds = dl.querySelector('.hw-ds'), pw = portrait ? 46 : 54, ph = pw * 1.1;
    dl.classList.toggle('top', portrait);
    // a phone's window is a sheet at the bottom: somebody looks over its top edge. A wide screen's stands at the left: around its right edge.
    if (portrait) Object.assign(dp.style, { left: b.r - pw - 26 + 'px', top: b.t + 3 - ph * 0.8 + 'px', width: pw + 'px', height: ph * 0.8 + 'px' });
    else Object.assign(dp.style, { left: b.r - 3 + 'px', top: b.t + 30 + 'px', width: pw * 0.66 + 'px', height: ph + 'px' });
    dp.style.setProperty('--pw', pw + 'px');
    Object.assign(dw.style, { left: b.r - 92 + 'px', top: b.t + 'px' });
    const room = !portrait && b.b + 78 < (term ? term.t : r.height - 120);
    ds.style.display = room ? '' : 'none'; if (room) Object.assign(ds.style, { left: b.l + (b.r - b.l) * 0.3 - 14 + 'px', top: b.b - 1 + 'px' });
    const k = detail.dataset.k || 'x';
    if (k !== dKey) {
      dKey = k; const who = Math.random() < 0.5 ? 'clown' : 'ghost'; dl.dataset.who = who; frame(dl, '', who);
      dl.classList.remove('go'); void dl.offsetWidth; dl.classList.add('on', 'go'); dw.classList.add('on');
      after(2500, () => { if (dKey === k) frame(dl, who === 'clown' ? 'grin' : 'peek', who); });
      after(4300, () => { if (dKey === k && who === 'clown') { frame(dl, 'blink', who); after(170, () => frame(dl, 'grin', who)); } });
    }
  }
  new MutationObserver(() => detailDecor()).observe(detail, { attributes: true, attributeFilter: ['class', 'data-k'] });

  // ---- the life of the cast: timers that die with the switch ----
  const T = new Set();
  const after = (ms, fn) => { const id = setTimeout(() => { T.delete(id); if (on) fn(); }, ms); T.add(id); return id; };
  let hold = false; // checks only: no new scene while a frame rate is measured (halloween.mjs rule 14, 2026-10-06)
  const live = () => on && !hold && !document.hidden && win.offsetWidth > 0 && sig !== '';
  const loop = (min, max, fn, first) => { const go = () => { if (live()) fn(); after(R(min, max), go); }; after(first == null ? R(min, max) : first, go); };
  let scared = false, ghOn = false;
  // A FRIGHT, not a hop (operator, 2026-10-05: "the symbols must not hop when one moves over them, they must do the
  // scared phase"): every costume has a frightened face — the pumpkin screams, the cat hisses, skull, coffin, cauldron,
  // pail and spider stare in terror, the bat wraps itself in its wings — with one short shiver as it starts
  const FEAR = new Map([[pkA, 'scream'], [cat, 'hiss']]);
  for (const o of ORBS) if (!FEAR.has(o) && o.querySelector('.hw-s')) FEAR.set(o, 'scared');
  const batO = $h('.hw-o[data-k="src"]');
  function fright(o, v) {
    if (!o) return;
    if (o === batO) o.classList.toggle('hw-fr', v && !o.classList.contains('fly')); else frame(o, v ? FEAR.get(o) || '' : '');
    if (v) { o.classList.remove('hw-sv'); void o.offsetWidth; o.classList.add('hw-sv'); clearTimeout(o._sv); o._sv = setTimeout(() => o.classList.remove('hw-sv'), 520); }
  }
  const jolt = (e, wait = 0) => { if (!e || !e._b) return; setTimeout(() => { fright(e, true); clearTimeout(e._fo); e._fo = setTimeout(() => { if (!scared) fright(e, false); }, 1700); }, wait); };
  function scare(v) {
    // they all take fright when a clown shows (operator), one after another within a moment
    if (v !== scared) for (const o of [pkA, ...ORBS]) { clearTimeout(o._fo); if (v) setTimeout(() => { if (scared) fright(o, true); }, Math.random() * 380); else fright(o, false); }
    scared = v;
    if (ghOn) frame(gh, v ? 'hide' : '');
  }
  // the clown: balloon first, then the gloves and the eyes, the grin, a blink, and down again
  function clownScene() {
    if (!cl._b || cl.classList.contains('act') || win.classList.contains('in-moment')) return false;
    if (stale(cl) && !cl._b) return false;
    cl.classList.add('act', 'ball'); frame(cl, '');
    after(1900, () => cl.classList.add('up1'));
    after(3900, () => { scare(true); const bu = cl.querySelector('.hw-burst'); bu.classList.add('go'); after(2600, () => bu.classList.remove('go')); });
    after(4900, () => cl.classList.add('up2'));
    after(6000, () => frame(cl, 'grin'));
    after(7500, () => frame(cl, 'blink')); after(7680, () => frame(cl, 'grin'));
    after(9300, () => cl.classList.remove('up1', 'up2', 'ball'));
    after(10800, () => { frame(cl, ''); scare(false); cl.classList.remove('act'); });
    return true;
  }
  // THE BAT CARRIES A TRADE: it leaves its post at TRADES, flies to the brain pumpkin in the buyback ring (the way the
  // tax of every trade goes) and back
  const bat = $h('.hw-o[data-k="src"]');
  function batRun() {
    if (!bat._b || !pkA._b || bat.classList.contains('fly') || scared) return false;
    const dx = (pkA._b.l + pkA._b.r) / 2 - (bat._b.l + bat._b.r) / 2, dy = pkA._b.t - (bat._b.t + bat._b.b) / 2 - 6;
    bat.style.setProperty('--fx', dx + 'px'); bat.style.setProperty('--fy', dy + 'px'); bat.classList.remove('hw-fr'); bat.classList.add('fly');
    after(2600, () => { pkA.classList.add('blip'); after(500, () => pkA.classList.remove('blip')); });
    after(6400, () => bat.classList.remove('fly'));
    return true;
  }
  // THE GHOST OF WHAT WAS BURNED: it rises out of the skull at the BOBAI burn and floats away through the window,
  // dragging its chain of blocks; the cat hisses as it passes
  function roam() {
    if (ghOn || !A.figScreen || REDUCED) return false; const r = win.getBoundingClientRect(), W = r.width, H = r.height;
    const gs = cl3(A.figHpx * 0.2, 38, 68), sk = $h('.hw-o[data-k="burnA"]')._b, secs = cl3(W / 46, 12, 26);
    // from the skull (or, where the burn has no light, from the edge) to the far side, a little upward
    const x0 = sk ? (sk.l + sk.r) / 2 - gs / 2 : W + 12, y0 = sk ? sk.t - gs * 0.4 : cl3(R(hudB + 8, A.figScreen.y - A.figHpx * 0.1), 44, H * 0.55), ltr = x0 < W / 2;
    const dx = ltr ? W - x0 + gs + 24 : -(x0 + 2 * gs + 24), dy = cl3(hudB + 30 - y0, -H * 0.2, H * 0.12);
    ghOn = true; frame(gh, scared ? 'hide' : ''); gh.classList.toggle('rtl', !ltr); gh.classList.add('run');
    Object.assign(gh.style, { width: gs + 'px', top: y0 + 'px', left: x0 + 'px', transition: 'none', transform: 'translate(0,0) scale(.3)', opacity: '0' });
    void gh.offsetWidth;
    Object.assign(gh.style, { transition: 'transform ' + secs + 's cubic-bezier(.3,0,.7,1), opacity 1.6s ease', transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1)', opacity: '.94' });
    after(secs * 420, () => { if (!scared) { frame(cat, 'hiss'); after(1300, () => { if (!scared) frame(cat, ''); }); } });
    // it wails twice on its way (the frame with the wide mouth)
    after(secs * 280, () => { if (!scared) frame(gh, 'peek'); }); after(secs * 400, () => { if (!scared) frame(gh, ''); }); after(secs * 600, () => { if (!scared) frame(gh, 'peek'); }); after(secs * 720, () => { if (!scared) frame(gh, ''); });
    after(secs * 1000 - 1700, () => { gh.style.opacity = '0'; }); after(secs * 1000 + 100, () => { ghOn = false; gh.classList.remove('run'); });
    return true;
  }
  // A PHONE: THE HAND STEALS THE MOON (operator, 2026-10-05: "the hand must come on the phone too — maybe it grabs the
  // moon?"): a skeleton hand reaches down from the top edge, closes round the moon, everybody takes fright, and it pulls
  // the moon up out of the window; a little later the moon is back in its place. The phone's painting has no moon of
  // its own any more (hw/back-tall.webp), so nothing stays behind.
  let mhOn = false;
  // THE MOON THROWN AT HIS HEAD (2026-10-06, operator: "the hand grabs the moon — the moon panics — pulls it up to just
  // under the top edge and throws it at BOBAI's head; he feels it, and the moon bounces back to where it was"). The arm is
  // the hand picture's own bones, stretched up past the top edge, so it never ends in the air. Only while BOBAI stands
  // still, and his own next move waits for the scene: nothing he does is cut. The moon flies in a layer in front of him
  // (a copy; the one in the sky waits hidden) and comes home on an arc.
  const OUCH_LINES = ['Ouch! Who throws things at a working brain?', 'Hey! That hurt. Back to work, everyone.', 'Ow! Careful, this brain runs the burns.', 'Ouch! Halloween is getting rough.', 'Hey! I felt that in every neuron.'];
  const headHit = from => { const fs = A.figScreen, fh = A.figHpx, fw = A.figW; return fs && fh ? { x: fs.x + (from < fs.x ? -1 : 1) * fw * 0.2, y: fs.y - fh * 0.5 + fh * 0.12 } : null; };
  function pow(x, y) { const p = document.createElement('div'); p.className = 'hw-pow'; p.style.left = x + 'px'; p.style.top = y + 'px'; p.innerHTML = '<i></i>'.repeat(6); flyL.appendChild(p); setTimeout(() => p.remove(), 1300); }
  function moonHome(m) { // the moon in the sky shows again, calm, where it always was
    mo.style.transition = 'none'; mo.style.transform = ''; mo.style.opacity = ''; flyL.querySelectorAll('.hw-flm').forEach(f => f.remove());
    after(600, () => { frame(mo, ''); mo.classList.remove('hw-pan'); scare(false); }); after(1600, () => { mhOn = false; });
  }
  // THE HIT LANDS ON HIS STANDING POSE (2026-10-06, the head-rub clips hub-ouch / hub-ouch-v3): a move only starts
  // when the take before it comes home, so the throw waits — the moon held up at the edge, panicking — until his rest
  // take is `lead` seconds from its end (the flight's length), at most 12 s; then his head-rub follows the hit at once
  // WHILE HE TALKS THE THROW WAITS (2026-10-07, operator: "twice the skeleton had trouble with the moon — BOBAI was just
  // talking and the moon never reached his head"): a line that began during the scene held the throw back for good;
  // now the moon waits, panicking, until the sentence is over (12 s at most), then it flies
  const homeSoon = (fn, lead, t0 = performance.now()) => {
    if (!on) return;
    const rest = VID.on && VID.cur && /^(rest|idle)/.test(VID.cur), left = rest && VID.v ? (VID.v.duration || 8) - VID.v.currentTime : 0;
    const talk = performance.now() < LIFE.sayUntil; // a line still up (its bubble, or held for a move)
    // (a move a line brought with it is waited out the same way: he comes home to rest, then the hit)
    if (performance.now() - t0 > 12000 || !(talk || ownBusy() || (rest && left >= lead))) return fn();
    after(100, () => homeSoon(fn, lead, t0));
  };
  function throwMoon(m, lift, release, start = null, spin0 = 0) {
    const mx = (m.l + m.r) / 2, my = (m.t + m.b) / 2, h = headHit(mx), sx = start ? start.x : 0, sy = start ? start.y : lift;
    release();
    // only a MOVE of his or a scene of the chain calls the throw off (a sentence does not: the ouch line simply follows it)
    if (!h || ownBusy() || win.classList.contains('in-moment') || detail.classList.contains('on')) { // no throw, the moon floats home
      mo.style.transition = 'transform 1.6s cubic-bezier(.3,.7,.4,1)'; mo.style.transform = ''; after(1700, () => moonHome(m)); return;
    }
    // the copy in front of him, at the moon's lifted spot; the sky's moon hides meanwhile
    const c = document.createElement('div'); c.className = 'hw-flm'; c.innerHTML = mo.querySelector('.hw-s').outerHTML;
    Object.assign(c.style, { left: m.l + 'px', top: m.t + 'px', width: m.r - m.l + 'px' }); flyL.appendChild(c);
    mo.style.transition = 'none'; mo.style.opacity = '0'; mo.style.transform = '';
    const dx = h.x - mx, dy = h.y - my, spin = dx > 0 ? 1 : -1;
    setPose('ouch', 6); // queued to the end of his rest take, which is the moment of the hit (homeSoon)
    // AN ARC, NOT A LINE (2026-10-06, operator: "the moon is thrown oddly" — on a phone the moon sits just above him and
    // the straight flight was a short drop): up over the top of the throw, then down onto his head
    const apex = Math.max(Math.min(sy, dy) - Math.max(50, Math.abs(dx - sx) * 0.35), 4 - m.t); // never over the top edge (the skeleton throws from up there)
    const go = c.animate([{ transform: `translate(${sx}px,${sy}px) rotate(${spin0}deg)`, easing: 'cubic-bezier(.2,.6,.4,1)' },
      { transform: `translate(${sx + (dx - sx) * 0.45}px,${apex}px) rotate(${spin * 250}deg)`, offset: 0.42, easing: 'cubic-bezier(.6,0,.9,.6)' },
      { transform: `translate(${dx}px,${dy}px) rotate(${spin * 540}deg)` }], { duration: 760, fill: 'forwards' });
    go.onfinish = () => {
      if (!on) return;
      pow(h.x, h.y); ouch(spin); speak(pick(OUCH_LINES), 3400); LIFE.quietSince = Date.now();
      // it bounces off him and back home on an arc, spinning the other way
      const back = c.animate([{ transform: `translate(${dx}px,${dy}px) rotate(${spin * 540}deg)` }, { transform: `translate(${dx * 0.5}px,${Math.min(dy, 0) * 0.5 - 70}px) rotate(${spin * 300}deg)`, offset: 0.45 }, { transform: 'translate(0px,0px) rotate(0deg)' }], { duration: 1350, easing: 'cubic-bezier(.2,.75,.35,1)', fill: 'forwards' });
      back.onfinish = () => moonHome(m);
    };
  }
  function moonGrab() {
    if (!portrait || mhOn || !mo._b || !mo.classList.contains('put') || +getComputedStyle(mo).opacity < 0.99 || REDUCED || !stands()) return false;
    const m = mo._b, hi = mh.querySelector('.hw-mhi img'), hw = (m.r - m.l) * 1.3, hh = hw * (hi.naturalWidth ? hi.naturalHeight / hi.naturalWidth : 1.8);
    read(); const reach = (m.t + m.b) / 2 + hw * 0.2 - hh, lift = Math.min(-10, hudB + 6 - m.t); // fingertips at the moon's middle; lifted to just under the title row (behind it the moon was hidden)
    mhOn = true; frame(mh, ''); frame(mo, ''); for (const c of moveTakes('ouch')) prefetchClip(c); // his head-rub, ready for the hit
    LIFE.next = Math.max(LIFE.next, performance.now() + 26e3); // his own next move waits for the scene (the throw may wait up to 12 s)
    Object.assign(mh.style, { left: (m.l + m.r) / 2 - hw / 2 + 'px', width: hw + 'px', transition: 'none', transform: 'translateY(' + (-hh - 12) + 'px)' });
    void mh.offsetWidth; mh.classList.add('on');
    Object.assign(mh.style, { transition: 'transform 2s cubic-bezier(.25,.7,.3,1)', transform: 'translateY(' + reach + 'px)' });
    after(2100, () => { frame(mh, 'grab'); frame(mo, 'panic'); mo.classList.add('hw-pan'); scare(true); });
    after(2700, () => { const go = 'transform 1s cubic-bezier(.45,0,.3,1)'; Object.assign(mh.style, { transition: go, transform: 'translateY(' + (reach + lift) + 'px)' }); Object.assign(mo.style, { transition: go, transform: 'translateY(' + lift + 'px)' }); });
    const away = (A.figScreen ? A.figScreen.x : 0) > (m.l + m.r) / 2 ? -26 : 26, wind = { x: away, y: lift - 22 };
    after(4000, () => homeSoon(() => {
      // the wind-up: hand and moon pull back, away from him, then the throw (the flight leaves from there)
      const w = 'transform .28s cubic-bezier(.3,0,.5,1)';
      Object.assign(mh.style, { transition: w, transform: `translate(${away}px,${reach + lift - 22}px)` }); Object.assign(mo.style, { transition: w, transform: `translate(${away}px,${lift - 22}px)` });
      after(290, () => throwMoon(m, lift, () => { // the hand lets go and goes back up, empty
      frame(mh, ''); Object.assign(mh.style, { transition: 'transform 1.3s cubic-bezier(.6,0,.85,.35)', transform: 'translateY(' + (-hh - 40 - m.b) + 'px)' });
      after(1400, () => mh.classList.remove('on'));
    }, wind)); }, 0.75));
    return true;
  }
  // THE DESKTOP: A WHOLE SKELETON (2026-10-06, operator: "a skeleton comes down and grabs the moon with both arms and hands,
  // the moon panics, up to just under the top edge, then it throws it at BOBAI's head"). It hangs head-first on its rope,
  // the rope continued up past the top edge. The moon sits between its hands and behind them, so the finger bones close
  // over its rim (the picture's hands are open and curled already: no second picture, nothing jumps). Its hands' gap is
  // 46% of its width, just under the skull (measured on hw/skeleton.webp).
  function skelGrab() {
    if (portrait || mhOn || !mo._b || !mo.classList.contains('put') || +getComputedStyle(mo).opacity < 0.99 || REDUCED || !stands()) return false;
    const m = mo._b, si = skl.querySelector('.hw-sklb'); if (!si.naturalWidth) return false;
    const d = m.r - m.l, sw = d / 0.46, sh = sw * si.naturalHeight / si.naturalWidth, cx = (m.l + m.r) / 2, cy = (m.t + m.b) / 2;
    // lifted to just under the title row, not behind it (2026-10-06: held at the very top edge, the title row hid it)
    read(); const reach = cy - sh * 0.905, lift = Math.min(-10, hudB + 6 - m.t); // the moon's middle at the hands
    mhOn = true; frame(mo, ''); for (const c of moveTakes('ouch')) prefetchClip(c); // his head-rub, ready for the hit
    LIFE.next = Math.max(LIFE.next, performance.now() + 27e3); // his own next move waits for the scene (the throw may wait up to 12 s)
    Object.assign(skl.style, { left: cx - sw / 2 + 'px', width: sw + 'px', transition: 'none', transform: 'translateY(' + (-sh - 30) + 'px) rotate(0deg)' });
    void skl.offsetWidth; skl.classList.add('on');
    Object.assign(skl.style, { transition: 'transform 2.4s cubic-bezier(.25,.7,.3,1)', transform: 'translateY(' + reach + 'px) rotate(0deg)' });
    after(2500, () => { frame(mo, 'panic'); mo.classList.add('hw-pan'); scare(true); skl.classList.add('hold'); });
    after(3100, () => { const go = 'transform 1.1s cubic-bezier(.45,0,.3,1)'; Object.assign(skl.style, { transition: go, transform: 'translateY(' + (reach + lift) + 'px) rotate(0deg)' }); Object.assign(mo.style, { transition: go, transform: 'translateY(' + lift + 'px)' }); });
    // the swing: it leans toward him from its rope, and lets go
    const toward = (A.figScreen ? A.figScreen.x : cx) > cx ? -1 : 1;
    // THE SWING CARRIES THE MOON (2026-10-06, operator: "the throw is not quite right — the moon and the hands"): the moon
    // turns with the skeleton about the same point of its rope (600 px above its top, .hw-skl transform-origin), and
    // the flight starts where the hands hold it at the moment they let go
    const pivotY = reach - 600, ang = toward * 6, /* 6 deg on the long rope is about 100 px at the hands (14 flung them 240 px) */ rad = ang * Math.PI / 180;
    const held = { x: cx + (0 * Math.cos(rad) - (cy + lift - (pivotY + lift)) * Math.sin(rad)) - cx, y: (pivotY + lift) + (0 * Math.sin(rad) + (cy + lift - (pivotY + lift)) * Math.cos(rad)) - cy };
    after(4300, () => homeSoon(() => {
      const sw = 'transform .32s cubic-bezier(.4,0,.6,1)';
      skl.style.transition = sw; skl.style.transform = 'translateY(' + (reach + lift) + 'px) rotate(' + ang + 'deg)';
      Object.assign(mo.style, { transition: sw, transformOrigin: `${cx - m.l}px ${pivotY - m.t}px`, transform: 'translateY(' + lift + 'px) rotate(' + ang + 'deg)' });
      after(300, () => { mo.style.transformOrigin = ''; throwMoon(m, lift, () => { // it lets go and climbs back up its rope, empty-handed
      skl.classList.remove('hold');
      Object.assign(skl.style, { transition: 'transform 1.6s cubic-bezier(.6,0,.85,.35)', transform: 'translateY(' + (-sh - 60) + 'px) rotate(0deg)' });
      after(1700, () => skl.classList.remove('on'));
    }, held, ang); });
    }, 0.9));
    return true;
  }
  // the hand comes up behind the timeline, gropes, grabs twice, and is gone
  // a scene looks once more at its spot before it starts: placed while the joke button stood elsewhere, the hand came up
  // behind it, unseen (1440x900, 2026-10-05)
  const stale = e => { read(); if (e._c && walls.some(w => cut(e._c, w, 1))) { sig = ''; since = Math.max(since, 2); tick(); return true; } return false; };
  function handScene() {
    if (portrait) return moonGrab();
    if (!hd._b || hd.classList.contains('up') || cl.classList.contains('act')) return false;
    if (stale(hd) && !hd._b) return false;
    hd.classList.add('up'); frame(hd, '');
    after(1600, () => frame(hd, 'grab')); after(2000, () => frame(hd, '')); after(2500, () => frame(hd, 'grab')); after(3000, () => frame(hd, ''));
    after(3900, () => hd.classList.remove('up'));
    return true;
  }
  // the clown behind BOBAI (operator, 2026-10-05: "sometimes a clown is behind BOBAI and wants to grab him — his head,
  // his hands and fingers show, BOBAI notices nothing; he may only come while BOBAI stands"): he rises behind him (the
  // layer lies under the figure), closes his fingers twice and sinks; the moment BOBAI starts a move he is gone
  const stands = () => !ownBusy() && !(VID.on && VID.cur && /^idle/.test(VID.cur)) && !win.classList.contains('in-moment') && !win.classList.contains('talking') && !detail.classList.contains('on');
  let grabT = 0;
  function grabEnd(fast) {
    // the fade is set here, inline: the walk's own transition (transform only) sat on the element and took the CSS fade
    // with it — he was gone in one frame (2026-10-07, operator: "at the end he is gone within a millisecond")
    clearInterval(grabT); grabT = 0; grab.style.transition = `opacity ${fast ? 0.7 : 1.4}s ease`;
    grab.classList.toggle('fast', !!fast); grab.classList.remove('on', 'sneak'); if (scared && !cl.classList.contains('act')) scare(false);
    if (CLOWN.cur) { CLOWN.cur.onended = null; clearInterval(CLOWN.stopT); if (fast) CLOWN.cur.pause(); }
    after(1600, () => { if (!grabT) grab.classList.remove('vid'); });
    after(1600, () => { if (!grabT) { Object.assign(grab.style, { transition: '', transform: '' }); Object.assign(grab.querySelector('.hw-grabm').style, { transition: '', transform: '' }); } });
  }
  // HE SNEAKS UP (2026-10-06, operator: "the big clown behind BOBAI should really creep up: first slowly climb up the
  // gravestone, then behind BOBAI, then reach as if to grab him — he could, but he does not"). Everything of him below
  // the stone's back rim is clipped away while he climbs, so he pulls himself up from behind the stone; the clip moves
  // with him (same duration, same easing). He leaves at once, quietly, when BOBAI starts a move.
  function grabStill() {
    if (grabT || !A.figScreen || cl.classList.contains('act') || !stands()) return false;
    // a whole figure with legs and shoes, standing BEHIND BOBAI on the stone, a head taller and half a step to the side
    // (operator: "he shall stand behind BOBAI, with legs and all")
    const r = win.getBoundingClientRect(), fs = A.figScreen, fh = A.figHpx, fw = A.figW, gi = grab.querySelector('img'), ar = gi.naturalWidth ? gi.naturalWidth / gi.naturalHeight : 0.7;
    const ghh = Math.min(fh * 1.24, fs.y + fh * 0.39 - Math.max(4, portrait ? hudB - 6 : 4)), gw = ghh * ar, side = fs.x > r.width / 2 ? -1 : 1;
    const feet = fs.y + fh * 0.39, rim = feet - fh * 0.05, below = feet - rim; // his soles stand on the stone's far half
    const x1 = cl3(fs.x - gw / 2 + side * fw * 0.3, 2, r.width - gw - 2);
    // he climbs up where nothing of the terminal stands (at 1440 the right side was the buyback ring and its pumpkin): his
    // upper half beside the stone must be free, on his side first, then the other; with neither, straight up behind BOBAI
    read();
    // (each side scored by how much of his upper half lies over the terminal's labels and lights; the smaller wins, and above a
    // fifth of it covered on both sides he rises behind BOBAI instead)
    const climbAt = s2 => cl3(fs.x - gw / 2 + s2 * fw * 1.05, 2, r.width - gw - 2);
    const covered = x => { const b = box(x + gw * 0.15, feet - ghh, gw * 0.7, ghh * 0.6), A0 = (b.r - b.l) * (b.b - b.t); let a = 0;
      for (const w of walls) { const ix = Math.min(b.r, w.r) - Math.max(b.l, w.l), iy = Math.min(b.b, w.b) - Math.max(b.t, w.t); if (ix > 0 && iy > 0) a += ix * iy; } return a / A0; };
    const tries = [side, -side].map(climbAt).map(x => [x, covered(x)]).sort((p, q) => p[1] - q[1]);
    const x0 = tries[0][1] < 0.2 ? tries[0][0] : x1, dx = x1 - x0; (window.__btClimb = window.__btClimb || []).push(tries.map(t => t.map(v => +v.toFixed(2)))); // for checks
    // the window he shows in ends at the stone's back rim (overflow hidden); inside it he rises and sinks, and the window
    // itself walks him sideways — transforms only, nothing repainted (an animated clip-path redrew him every frame and the
    // frame rate fell, rule 14 at 1440)
    const gm = grab.querySelector('.hw-grabm'), low = ghh * 0.86;
    const at = (x, y, ms, ease) => { const tr = ms ? `transform ${ms}ms ${ease}` : 'none'; Object.assign(grab.style, { transition: tr, transform: `translateX(${x}px)` }); Object.assign(gm.style, { transition: tr, transform: `translateY(${y}px)` }); };
    Object.assign(grab.style, { width: gw + 'px', height: ghh - below + 'px', left: x0 + 'px', top: feet - ghh + 'px' }); gm.style.height = ghh + 'px';
    at(0, low, 0); frame(grab, ''); grab.classList.remove('fast', 'sneak'); void grab.offsetWidth; grab.classList.add('on');
    LIFE.next = Math.max(LIFE.next, performance.now() + 16e3); // his own next move waits for the scene
    const t0 = performance.now(); let step = 0;
    grabT = setInterval(() => {
      const t = performance.now() - t0;
      // he stays while BOBAI only SPEAKS (operator, 2026-10-05: "BOBAI said something and he was gone at once — he should stay");
      // he leaves, quietly, when BOBAI starts a move or a scene of the chain takes the stage
      if (!on || ownBusy() || win.classList.contains('in-moment')) return grabEnd(true);
      // the climb: the hair, then the eyes over the rim; a look; then he pulls himself up
      if (step === 0 && t > 300) { step = 1; at(0, low * 0.62, 1500, 'cubic-bezier(.3,.6,.4,1)'); }
      if (step === 1 && t > 2700) { step = 2; at(0, 0, 1700, 'cubic-bezier(.5,0,.3,1)'); }
      // on tiptoe behind him
      if (step === 2 && t > 4600) { step = 3; grab.classList.add('sneak'); at(dx, 0, 2500, 'cubic-bezier(.45,0,.55,1)'); }
      if (step === 3 && t > 7100) { step = 4; grab.classList.remove('sneak'); }
      if (t > 6900 && t < 9800 && !scared) scare(true); // everybody sees him — except BOBAI
      if (step >= 4 && step < 6) frame(grab, (t > 7500 && t < 8200) || (t > 8800 && t < 9600) ? 'grab' : '');
      // he could, and he does not: back the way he came, and down behind the stone
      if (step === 4 && t > 10100) { step = 5; if (scared && !cl.classList.contains('act')) scare(false); grab.classList.add('sneak'); at(0, 0, 2300, 'cubic-bezier(.45,0,.55,1)'); }
      if (step === 5 && t > 12500) { step = 6; frame(grab, ''); grab.classList.remove('sneak'); at(0, low, 1500, 'cubic-bezier(.5,0,.8,.5)'); }
      if (step === 6 && t > 14200) grabEnd(false);
    }, 200);
    return true;
  }
  // THE BIG CLOWN, ANIMATED (2026-10-06, operator: "his body really correct in motion and form — climbing up and all —
  // and it must match the surroundings, the stone"). Three Veo clips from his own picture (temp/terminal/gen_clown.py):
  // climb (he grips a stone slab's edge, pulls himself up, swings a shoe over, stands), reach (claws up behind someone,
  // hesitates, giggles behind his glove) and down (climb, reversed). Each clip ends at the slab's edge, and that edge is
  // laid on the gravestone's back rim: his gloves land on our stone. Packed like BOBAI's takes (colour above, alpha
  // below), drawn by a small WebGL player of its own. The clips load only when this scene is first chosen (2.9 MB); until
  // they are ready another scene plays, and without WebGL or video the picture scene above (grabStill) plays instead.
  const CLOWN = { gl: null, cv: null, tex: null, v: {}, ready: false, loading: false, cur: null, raf: 0 };
  const CLOWN_AR = 432 / 614, CLOWN_FIG = 0.775; // the clip's width/height; his standing height in it (gen_clown.py FIG_H / LEDGE)
  const CLIMB_STAND = 5.7; // s into the climb clip: he stands, hands down, his claws not yet up
  function clownInit() {
    if (CLOWN.gl !== null) return !!CLOWN.gl;
    const cv = document.createElement('canvas'); cv.className = 'hw-clv';
    const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) { CLOWN.gl = false; return false; }
    const sh = (t, src) => { const x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); return x; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 u;void main(){u=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 u;uniform sampler2D t;void main(){float y=1.-u.y;vec3 c=texture2D(t,vec2(u.x,y*.5)).rgb;float a=smoothstep(.04,.96,texture2D(t,vec2(u.x,.5+y*.5)).r);gl_FragColor=vec4(c*a,a);}'));
    gl.linkProgram(pr); gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.BLEND);
    Object.assign(CLOWN, { gl, cv, tex }); grab.querySelector('.hw-grabm').appendChild(cv);
    return true;
  }
  function clownLoad() {
    if (CLOWN.loading) return; CLOWN.loading = true; let n = 0;
    for (const k of ['climb', 'sneak', 'reach', 'down']) {
      const e = document.createElement('video'); e.muted = true; e.playsInline = true; e.setAttribute('playsinline', ''); e.preload = 'auto';
      e.addEventListener('canplaythrough', () => { if (!e._ok) { e._ok = true; if (++n === 4) CLOWN.ready = true; } });
      e.addEventListener('error', () => { CLOWN.gl = false; }); // a clip that cannot play: the picture scene from now on
      e.src = BASE + 'hw/clown-' + k + '.pack.mp4' + Q; e.load(); CLOWN.v[k] = e;
    }
  }
  function clownDraw() {
    CLOWN.raf = 0; const v = CLOWN.cur, gl = CLOWN.gl, cv = CLOWN.cv; if (!v || !gl) return;
    const dpr = Math.min(devicePixelRatio, 2), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (w && h && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
    if (v.readyState >= 2) { gl.bindTexture(gl.TEXTURE_2D, CLOWN.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    if (!v.paused && !v.ended) CLOWN.raf = requestAnimationFrame(clownDraw);
  }
  // play one clip from its start; `done` when it ended (never after the scene was called off)
  // HE MELTS AWAY (2026-10-07, operator: "make him dissolve slowly"): on his way down he starts to fade 1.4 s before the
  // clip ends, so he is gone the moment the climb down is over, never cut off in one frame
  const MELT = 1.4;
  function clownPlay(k, done, until = 0, from = 0) {
    const v = CLOWN.v[k]; if (!v) return; if (CLOWN.cur && CLOWN.cur !== v) CLOWN.cur.pause();
    CLOWN.cur = v; v.currentTime = from; clearInterval(CLOWN.stopT); clearInterval(CLOWN.meltT);
    // by the clip's own time, not the clock: on a slow device the clip runs behind
    if (k === 'down') CLOWN.meltT = setInterval(() => { if (!grabT || CLOWN.cur !== v) return clearInterval(CLOWN.meltT);
      if (v.currentTime >= (v.duration || 8) - MELT) { clearInterval(CLOWN.meltT); grab.style.transition = `opacity ${MELT}s ease`; grab.classList.remove('on'); } }, 50);
    const fin = () => { v.onended = null; clearInterval(CLOWN.stopT); clownDraw(); if (grabT) done && done(); };
    v.onended = fin; if (until) CLOWN.stopT = setInterval(() => { if (v.currentTime >= until) { v.pause(); fin(); } }, 40);
    v.play().then(() => { if (!CLOWN.raf) CLOWN.raf = requestAnimationFrame(clownDraw); }).catch(() => grabEnd(true));
  }
  function grabScene() {
    if (grabT || !A.figScreen || cl.classList.contains('act') || !stands()) return false;
    if (!clownInit()) return grabStill();            // no WebGL: the picture scene
    if (!CLOWN.ready) { clownLoad(); return CLOWN.gl === false ? grabStill() : false; } // loading: another scene plays first
    const r = win.getBoundingClientRect(), fs = A.figScreen, fh = A.figHpx, fw = A.figW, gi = grab.querySelector('img'), ar = gi.naturalWidth ? gi.naturalWidth / gi.naturalHeight : 0.7;
    const ghh = Math.min(fh * 1.24, fs.y + fh * 0.39 - Math.max(4, portrait ? hudB - 6 : 4)), gw = ghh * ar, side = fs.x > r.width / 2 ? -1 : 1;
    const feet = fs.y + fh * 0.39, rim = feet - fh * 0.05;
    // the clip's box: as tall as the picture clown was, but never taller than the room above the stone's rim — the clip's
    // own top is free green, yet a lean in the climb reaches it (2026-10-06, operator: "he gets almost too big and is cut
    // at the top edge")
    const ch = Math.min(ghh / CLOWN_FIG, rim - 4), cw = ch * CLOWN_AR;
    const at = cx => cl3(cx - cw / 2, 2 - cw * 0.2, r.width - cw * 0.8 - 2);
    const x1 = at(fs.x + side * fw * 0.3);
    // he climbs up where nothing of the terminal stands: the side with the least of its labels and lights over his upper
    // half wins; above a fifth of it covered on both sides he climbs up straight behind BOBAI
    read();
    const covered = x => { const b = box(x + cw * 0.25, rim - ghh, cw * 0.5, ghh * 0.6), A0 = (b.r - b.l) * (b.b - b.t); let a = 0;
      for (const w of walls) { const ix = Math.min(b.r, w.r) - Math.max(b.l, w.l), iy = Math.min(b.b, w.b) - Math.max(b.t, w.t); if (ix > 0 && iy > 0) a += ix * iy; } return a / A0; };
    const tries = [side, -side].map(s2 => at(fs.x + s2 * fw * 1.05)).map(x => [x, covered(x)]).sort((p, q) => p[1] - q[1]);
    // ALWAYS BESIDE THE STONE, as in the film he approved (2026-10-07, operator: "he comes from behind and repeats 2-3x —
    // do it exactly as you showed me"): straight up behind BOBAI the climb's claws ran into the reach clip's claws with no
    // walk between. Now the freer side wins even where labels lie (they are free again a few seconds later); only where
    // neither side leaves room on the screen (a phone) he still climbs up behind him.
    const x0 = Math.abs(tries[0][0] - x1) > cw * 0.25 ? tries[0][0] : x1, dx = x1 - x0; (window.__btClimb = window.__btClimb || []).push(tries.map(t => t.map(v => +v.toFixed(2))));
    const gm = grab.querySelector('.hw-grabm');
    Object.assign(grab.style, { width: cw + 'px', height: ch + 'px', left: x0 + 'px', top: rim - ch + 'px', transition: 'none', transform: 'translateX(0px)' });
    Object.assign(gm.style, { transition: 'none', transform: 'none', height: ch + 'px' });
    grab.classList.add('vid'); grab.classList.remove('fast', 'sneak'); void grab.offsetWidth; grab.classList.add('on');
    LIFE.next = Math.max(LIFE.next, performance.now() + 42e3); // his own next move waits for the scene
    // HE WALKS, HE DOES NOT GLIDE (2026-10-06, operator: the slide was a still picture that bobbed — "it repeats oddly, like
    // spikes"): the sneak clip's tiptoe steps play while the page carries him over, mirrored when he goes to the right
    // (the clip walks to the left); 5.5 s, where its steps end in his standing pose
    const SNEAK = 5.5, cv = CLOWN.cv;
    const walk = (x, toRight, then) => { cv.style.transform = toRight ? 'scaleX(-1)' : ''; Object.assign(grab.style, { transition: `transform ${SNEAK * 1000}ms linear`, transform: `translateX(${x}px)` });
      clownPlay('sneak', () => { cv.style.transform = ''; then(); }, SNEAK); };
    let leaving = false;
    // BOBAI starts a move or the chain takes the stage: he does not vanish, he climbs down where he is (operator: "at the
    // end he is simply gone — he should climb down")
    const leave = () => { if (leaving) return; leaving = true; if (scared && !cl.classList.contains('act')) scare(false);
      grab.style.transition = 'none'; grab.style.transform = getComputedStyle(grab).transform; cv.style.transform = '';
      // still on his way up: the down clip is the climb reversed, so it takes over at the same moment of the movement
      const up = CLOWN.cur === CLOWN.v.climb && !CLOWN.v.climb.ended ? Math.max(0, (CLOWN.v.climb.duration || 8) - CLOWN.v.climb.currentTime) : 0;
      clownPlay('down', () => grabEnd(false), 0, up); };
    // he goes on while BOBAI answers a trade with a move (he stands behind him; on a busy market the scene never got past the
    // climb — 2026-10-06, operator: 'he climbs up and is gone'); only a scene of the chain on the stage sends him down
    grabT = setInterval(() => { if (!on) return grabEnd(true); if (win.classList.contains('in-moment')) leave(); }, 200);
    clownPlay('climb', () => {
      const reach = () => { after(1000, () => { if (grabT && !leaving) scare(true); }); // everybody sees him, except BOBAI
        clownPlay('reach', () => { if (leaving) return; if (scared && !cl.classList.contains('act')) scare(false);
          if (dx) walk(0, dx < 0, () => { if (!leaving) { leaving = true; clownPlay('down', () => grabEnd(false)); } });
          else { leaving = true; clownPlay('down', () => grabEnd(false)); } }); };
      if (leaving) return;
      if (dx) walk(dx, dx > 0, () => { if (!leaving) reach(); }); else reach();
    }, dx ? 0 : CLIMB_STAND); // straight behind him: the climb ends where he stands, before its own claws (the reach has them)
    return true;
  }
  // under the mouse or a finger a symbol takes fright (operator: "when one moves over the symbols they may get a fright")
  function poke(ev) {
    if (!on || scared) return; const r = win.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    for (const o of [pkA, ...ORBS]) { const b = o._b; if (!b || x < b.l || x > b.r || y < b.t || y > b.b) continue;
      if (performance.now() - (o._j || 0) < 2200) return; o._j = performance.now(); jolt(o);
      return; }
  }
  win.addEventListener('pointermove', poke, { passive: true }); win.addEventListener('pointerdown', poke, { passive: true });
  function start() {
    const calmNow = o => !scared && performance.now() - (o._j || 0) > 2400; // not in the middle of a fright
    loop(7000, 13000, () => { if (calmNow(pkA)) frame(pkA, Math.random() < 0.5 ? 'right' : ''); });
    loop(6000, 12000, () => { if (calmNow(sp)) { frame(sp, 'blink'); after(170, () => { if (calmNow(sp)) frame(sp, ''); }); } });
    loop(5000, 11000, () => { if (calmNow(cat)) { frame(cat, 'blink'); after(190, () => { if (calmNow(cat)) frame(cat, ''); }); } });
    // the bat at the trades beats its wings now and then where it hangs (operator, 2026-10-06), a second or so; its flight
    // to the buyback and its fright under the mouse stay as they are
    loop(16000, 30000, () => { if (calmNow(batO) && !batO.classList.contains('fly') && !batO.classList.contains('hw-fr')) { batO.classList.add('flap'); after(900, () => batO.classList.remove('flap')); } }); // less often, shorter (operator, 2026-10-06: 'a little less')
    // THE DIRECTOR (operator: "far too nervous"): one thing at a time, in turn, with a long breath between
    if (!REDUCED) {
      const SHOW = [clownScene, batRun, roam, handScene, skelGrab, grabScene, batRun, roam]; let i = 0, lastShow = 0;
      const busy = () => cl.classList.contains('act') || hd.classList.contains('up') || mhOn || !!grabT || ghOn || bat.classList.contains('fly');
      // how long each scene holds the stage (s), so the replay's quiet stretch can be matched to it
      const secsOf = f => f === grabScene ? (CLOWN.ready ? 38 : 15) : f === skelGrab ? 22 : f === handScene ? (portrait ? 20 : 6) : f === roam ? 10 : f === clownScene ? 9 : 7;
      const direct = room => { if (busy() || win.classList.contains('in-moment')) return false;
        for (let n = 0; n < SHOW.length; n++) { const f = SHOW[i++ % SHOW.length]; if (secsOf(f) > room) continue; if (f()) { lastShow = performance.now(); return true; } } return false; };
      loop(22000, 34000, () => direct(replayRoom()), 9000);
      // in a replay, a quiet stretch is used as soon as one is long enough (and the last scene is a while ago)
      loop(2500, 2500, () => { if (mode !== 'replay' || performance.now() - lastShow < 14e3) return; const room = replayRoom(); if (room >= 7) direct(room); });
    }
  }
  function stop() {
    for (const id of T) clearTimeout(id); T.clear(); clearInterval(grabT); grabT = 0; grab.classList.remove('on'); scared = false; ghOn = false;
    cl.classList.remove('act', 'ball', 'up1', 'up2'); hd.classList.remove('up'); bat.classList.remove('fly'); pkA.classList.remove('blip'); for (const p of [pkA, cd, ...ORBS]) p.classList.remove('shake'); gh.style.opacity = '0';
    mh.classList.remove('on'); skl.classList.remove('on', 'hold'); mhOn = false; Object.assign(mo.style, { transition: '', opacity: '', transform: '' }); frame(mo, ''); mo.classList.remove('hw-pan'); flyL.replaceChildren();
    for (const root of [pkA, ...ORBS, gh, hd, mh]) frame(root, ''); frame(cl, ''); batO.classList.remove('hw-fr', 'flap');
  }

  // looked at every few seconds, moved only when the window changed or something now lies over a piece
  let since = 0;
  function tick() {
    if (!on || !win.offsetWidth) { since = 0; return; }
    detailDecor(); swPlace(); lights(false); // the tax phase's own redraw may have lit a station again
    // the night behind: only once the window's shape is known — loaded earlier, a phone got the wide painting first and
    // its moon showed, then the tall one's, and the moon picture went to the one and then to the other (operator, 2026-10-05)
    if (BACKDROP && A.figHpx && (portrait ? 'tall' : 'wide') !== backKey) loadBack();
    // the pieces come once the intro is over and the labels stand: placed while the camera still settled, they jumped
    if (!labs.querySelector('.lab.show')) return;
    if (++since < 2) return; // the labels settle first
    const s = sigNow();
    if (s !== sig) { if (place()) sig = s; return; }
    if (cl.classList.contains('act') || hd.classList.contains('up')) return; // nobody is moved in the middle of a scene
    read();
    for (const e of PIECES) if (e._c && walls.some(w => cut(e._c, w, 1))) { sig = ''; break; }
  }
  setInterval(tick, 1500);
  // a new window size (the enlarge button, a turned phone): the pieces step aside at once and come back where they now fit
  let lastWH = '';
  if (window.ResizeObserver) new ResizeObserver(() => {
    const r = win.getBoundingClientRect(), k = (r.width | 0) + 'x' + (r.height | 0); if (k === lastWH) return;
    const first = !lastWH; lastWH = k; sig = ''; since = Math.min(since, 1);
    if (!first) { for (const e of ALL) put(e, null); cl.classList.remove('act', 'ball', 'up1', 'up2'); hd.classList.remove('up'); sizeBack(); swPlace(); }
  }).observe(win);

  function set(v, byHand) {
    const was = on; on = v; win.classList.toggle('hw-on', on); sw.setAttribute('aria-pressed', on ? 'true' : 'false');
    sw.title = on ? 'Halloween look is on — click for the standard terminal' : 'Halloween look is off — click to bring it back';
    sw.querySelector('.hw-oo').textContent = on ? 'on' : 'off';
    sw.setAttribute('aria-label', sw.title); sw.querySelector('.hw-t').dataset.t = on ? (portrait ? 'Halloween on · tap = off' : 'Halloween on · click = off') : (portrait ? 'Halloween off · tap = on' : 'Halloween off · click = on'); /* shown by CSS, so the chip's own text stays the mood alone */
    stop();
    if (on) { load(); sig = ''; start(); if (!flying) { flying = true; requestAnimationFrame(fly); } } else { for (const e of ALL) put(e, null); detailDecor(); }
    lights(!on);
    swPlace();
    backFade();
    if (byHand) { try { localStorage.setItem('bt-hw', on ? '1' : '0'); } catch {} hint(4500); }
  }
  sw.addEventListener('click', e => { e.stopPropagation(); set(!on, true); });
  // the hint comes only when the switch is used, never on its own at the start (operator, 2026-10-06: "on page load it
  // must not show 'Halloween on · click = off', only when you switch it off or on"); hovering it still shows it
  set(on, false);
  window.__btHw = { get on() { return on; }, set: v => set(!!v, false), place: () => { sig = ''; since = 9; tick(); }, clown: () => clownScene(), ghost: () => roam(), hand: () => handScene(), skeleton: () => skelGrab(), hold: v => { hold = !!v; }, moonOut: () => mhOn, grab: () => grabScene(), bat: () => batRun(), calm: () => !scared, startle: k => jolt(k === 'pumpkin' ? pkA : ORBS.find(o => o.dataset.k === k)),
    // the scene's own lights at the stations: hidden with the look, back exactly as they were without it
    lit: () => DEST.filter(d => d.pct > 0).every(d => d.obj ? d.obj.visible : d.orb.visible) && coreOrb.visible, stands: () => stands(),
    // the share card photographs the scene as it always was: the painting steps out for that one frame
    hide: v => { if (back) back.visible = !v && on && backLit > 0; },
    boxes: () => ({ placed: sig !== '', clown: cl._b ? (cl._c && cl._c.l >= 0 ? cl._c : cl._b) : null, clownFree: !!(cl._c && cl._c.l >= 0), pumpkin: pkA._b, hand: hd._c && hd._c.l >= 0 ? hd._c : null, handPlaced: !!hd._b, candles: cd._c, moon: mo._b, chain: hc._c, dais: da._b, orbs: Object.fromEntries(ORBS.map(o => [o.dataset.k, o._b])), grab: grab.classList.contains('on'), back: back && back.visible ? +backLit.toFixed(2) : 0, backKey }) };
})();
