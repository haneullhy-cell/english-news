// 초록불 내비 – 화면과 상호작용. build.mjs 가 geo/signal/network/routing/osm 과 함께 하나의 스크립트로 묶는다.
// '세계(world)'는 지금 보는 지도 하나를 뜻한다: 개략도(network.js) 또는 실제 지도(osm.js). 둘 다 같은 그래프 구조라
// 그리기·탭·경로 계산 코드를 공유한다.
import { dist, fmtDist, fmtDur, fmtClock } from './geo.js';
import { legState, nextGreenStart, anchorPlan, extrapolate } from './signal.js';
import { buildDemo, nearestNode, nearestCrossing, crossingName, LEG_SHORT } from './network.js';
import { adjacency, compare } from './routing.js';
import { bboxAround, networkQuery, contextQuery, fetchOverpass, buildOsmWorld, addContext } from './osm.js';
import { PLACES, PREBUILT_RADIUS } from './places.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONT = '"IBM Plex Sans KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif';
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 설정(이 기기에만 저장) ----------
const DEFAULTS = { speed: 1.2, margin: 2, speedup: 1, apiBase: '', lastMap: null };
const STORE_KEY = 'greenlight-navi.v1';
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } }
const settings = loadSettings();

// ---------- 시계(배속 지원) ----------
const clock = {
  speed: Number(settings.speedup) || 1,
  anchorReal: Date.now() / 1000,
  anchorVirtual: Date.now() / 1000,
  now() { return this.anchorVirtual + (Date.now() / 1000 - this.anchorReal) * this.speed; },
  setSpeed(s) { const v = this.now(); this.anchorReal = Date.now() / 1000; this.anchorVirtual = v; this.speed = s; },
};

// ---------- 세계(지도) ----------
function schematicStreetLabels(graph) {
  const out = [];
  const its = [...graph.intersections.values()].filter((i) => i.kind === '4way');
  for (const s of graph.streets) {
    const on = its.filter((i) => (s.kind === 'ew' ? i.ew === s.id : i.ns === s.id));
    const dir = s.kind === 'ew' ? graph.u : graph.v;
    on.sort((a, b) => (a.x * dir.x + a.y * dir.y) - (b.x * dir.x + b.y * dir.y));
    for (let i = 0; i + 1 < on.length; i++) out.push({ name: s.name, x: (on[i].x + on[i + 1].x) / 2, y: (on[i].y + on[i + 1].y) / 2, dir, minScale: 0.12 });
  }
  return out;
}
function makeWorld(graph, meta = {}) {
  const w = {
    graph, adj: adjacency(graph), kind: graph.kind, meta,
    plans: new Map([...graph.intersections].map(([id, it]) => [id, it.plan])),
    labels: graph.kind === 'schematic' ? schematicStreetLabels(graph) : graph.labels,
    streetById: Object.fromEntries((graph.streets || []).map((s) => [s.id, s.name])),
  };
  w.walkName = (e) => (graph.kind === 'schematic' ? `${w.streetById[e.street] || ''} 보도` : (e.street || '길'));
  return w;
}
const SCHEMATIC = buildDemo();
let world = makeWorld(SCHEMATIC, { label: '개략도 · 강남 테헤란로 일대' });

const live = { on: false, base: '', ok: false, lastOk: 0, serverMode: '', obs: new Map(), timer: null, error: '', osm: false };

function sigState(iid, leg, t) {
  if (live.on && live.ok) {
    const o = live.obs.get(iid);
    const l = o && o.legs[leg];
    if (l) { const ex = extrapolate(l, o.t, t); if (ex) return ex; }
  }
  const plan = world.plans.get(iid);
  return plan ? legState(plan, leg, t) : { state: 'red', remain: 0 };
}
function sigNextGreen(iid, leg, t) {
  if (live.on && live.ok) {
    const o = live.obs.get(iid);
    const l = o && o.legs[leg];
    if (l && l.state === 'red' && l.remain != null) { const g = o.t + l.remain; if (g > t) return g; }
  }
  const plan = world.plans.get(iid);
  return plan ? nextGreenStart(plan, leg, t) : t;
}
const routeCtx = () => ({ speed: settings.speed, margin: settings.margin, signal: sigState, nextGreen: sigNextGreen });

async function liveConnect(base) {
  live.base = String(base || '').trim().replace(/\/+$/, '');
  live.on = true; live.error = ''; live.ok = false;
  try {
    const r = await fetch(`${live.base}/api/health`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const h = await r.json();
    live.serverMode = h.mode || ''; live.osm = !!h.osm;
    if (h.mode === 'nokey') live.error = '서버에 TDATA_API_KEY 가 없습니다. 모의 데이터는 --mock 으로 실행합니다.';
  } catch (e) { live.error = `서버에 연결하지 못했습니다 (${e.message || e})`; }
  if (live.timer) clearInterval(live.timer);
  live.timer = setInterval(livePoll, 1000);
  await livePoll();
}
async function livePoll() {
  if (!live.on) return;
  try {
    const r = await fetch(`${live.base}/api/signals`, { cache: 'no-store' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
    const data = await r.json();
    const t = clock.now();
    for (const [iid, rec] of Object.entries(data.intersections || {})) {
      const it = world.graph.intersections.get(iid);
      if (!it || !rec.legs) continue;
      live.obs.set(iid, { t, legs: rec.legs });
      world.plans.set(iid, anchorPlan(it.plan, rec.legs, t));
    }
    live.ok = true; live.lastOk = Date.now(); live.error = '';
    if (data.mode) live.serverMode = data.mode;
    cmpDirty = true;
  } catch (e) {
    live.error = e.message || String(e);
    if (Date.now() - live.lastOk > 5000) live.ok = false;
  }
  updateBadge();
}
function liveDisconnect() {
  live.on = false; live.ok = false; live.error = '';
  if (live.timer) clearInterval(live.timer);
  live.timer = null; live.obs.clear();
  for (const [id, it] of world.graph.intersections) world.plans.set(id, it.plan);
  cmpDirty = true; updateBadge();
}

// ---------- 상태 ----------
const state = {
  from: 'gangnamdaero|teheranro#SW', fromLabel: '강남역',
  to: 'nonhyeonro|bongeunsaro#NE', toLabel: '언주역',
  cmp: null, sel: null, tapMode: null, user: null, userLatLon: null,
};
let dirty = true, cmpDirty = true, lastCmp = 0, lastDraw = 0, toastT = 0;

// ---------- 캔버스와 카메라 ----------
const cv = $('#cv'), ctxMain = cv.getContext('2d'), mapEl = $('#map');
const baseCv = document.createElement('canvas'), ctxBase = baseCv.getContext('2d');
let g2 = ctxMain;            // 지금 그리는 대상. 바탕을 그릴 때만 ctxBase 로 바뀐다.
let baseKey = '', themeVer = 0, worldVer = 0;
const cam = { cx: 0, cy: 0, scale: 0.3 };
let W = 1, H = 1, DPR = 1;
let C = {};

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  themeVer++;
  C = { bg: g('--bg'), surface: g('--surface'), road: g('--road'), roadEdge: g('--road-edge'), roadCenter: g('--road-center'), ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'), accent: g('--accent'), accentInk: g('--accent-ink'), green: g('--green'), red: g('--red'), park: g('--park'), water: g('--water'), building: g('--building'), buildingEdge: g('--building-edge'), path: g('--path'), crossNone: g('--cross-none') };
  dirty = true;
}
function resize() {
  const r = mapEl.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  DPR = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  baseCv.width = cv.width; baseCv.height = cv.height; baseKey = '';
  dirty = true;
}
function fitBounds(b, pad, maxScale = 1.2) {
  cam.scale = Math.max(0.05, Math.min(maxScale, Math.min(W / (b.maxX - b.minX + 2 * pad), H / (b.maxY - b.minY + 2 * pad))));
  cam.cx = (b.minX + b.maxX) / 2; cam.cy = (b.minY + b.maxY) / 2;
  dirty = true;
}
function fitAll() { fitBounds(world.graph.bounds, 70, 8); }
function fitRoute() {
  const r = state.cmp && state.cmp.fast;
  if (!r || r.nodes.length < 2) { fitAll(); return; }
  const pts = r.nodes.map((id) => world.graph.nodes.get(id));
  fitBounds({ minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) }, 140);
}
const w2s = (p) => ({ x: (p.x - cam.cx) * cam.scale + W / 2, y: H / 2 - (p.y - cam.cy) * cam.scale });
const s2w = (sx, sy) => ({ x: (sx - W / 2) / cam.scale + cam.cx, y: cam.cy - (sy - H / 2) / cam.scale });
function zoomAt(factor, sx, sy) {
  const before = s2w(sx, sy);
  cam.scale = Math.max(0.05, Math.min(8, cam.scale * factor));
  const after = s2w(sx, sy);
  cam.cx += before.x - after.x; cam.cy += before.y - after.y;
  dirty = true;
}
function panTo(p) { cam.cx = p.x; cam.cy = p.y; dirty = true; }

// ---------- 그리기 ----------
function line(a, b) { g2.beginPath(); g2.moveTo(a.x, a.y); g2.lineTo(b.x, b.y); g2.stroke(); }
function polyPath(pts) { g2.beginPath(); pts.forEach((p, i) => { const s = w2s(p); if (i) g2.lineTo(s.x, s.y); else g2.moveTo(s.x, s.y); }); }
function strokePts(pts, color, width, dash) { g2.strokeStyle = color; g2.lineWidth = width; g2.setLineDash(dash || []); polyPath(pts); g2.stroke(); g2.setLineDash([]); }
function fillPts(pts, fill, stroke) { polyPath(pts); g2.closePath(); g2.fillStyle = fill; g2.fill(); if (stroke) { g2.strokeStyle = stroke; g2.lineWidth = 1; g2.stroke(); } }
function rrect(x, y, w, h, r, fill, stroke) {
  g2.beginPath(); g2.roundRect(x, y, w, h, r);
  if (fill) { g2.fillStyle = fill; g2.fill(); }
  if (stroke) { g2.strokeStyle = stroke; g2.lineWidth = 1.5; g2.stroke(); }
}
function haloText(txt, x, y, size, color, weight = 600) {
  g2.font = `${weight} ${size}px ${FONT}`;
  g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.lineJoin = 'round'; g2.lineWidth = 4; g2.strokeStyle = C.bg; g2.strokeText(txt, x, y);
  g2.fillStyle = color; g2.fillText(txt, x, y);
}
function inView(p, margin = 60) { const s = w2s(p); return s.x > -margin && s.x < W + margin && s.y > -margin && s.y < H + margin; }

function drawLabelAlong(l) {
  if (cam.scale < l.minScale || !inView(l)) return;
  const p = w2s(l);
  let ang = -Math.atan2(l.dir.y, l.dir.x);
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  const size = cam.scale > 0.5 ? 13 : 11;
  g2.save(); g2.translate(p.x, p.y); g2.rotate(ang);
  g2.font = `500 ${size}px ${FONT}`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  if (world.kind === 'osm') { g2.lineWidth = 3; g2.strokeStyle = C.road; g2.strokeText(l.name, 0, 0); }
  g2.fillStyle = C.ink3; g2.fillText(l.name, 0, 0);
  g2.restore();
}

function drawSchematicBase() {
  for (const s of world.graph.streets) {
    const a = w2s(s.from), b = w2s(s.to), wpx = Math.max(2, s.width * cam.scale);
    g2.strokeStyle = C.roadEdge; g2.lineWidth = wpx + 2; line(a, b);
    g2.strokeStyle = C.road; g2.lineWidth = wpx; line(a, b);
    if (wpx > 12) { g2.strokeStyle = C.roadCenter; g2.lineWidth = 1; g2.setLineDash([10, 10]); line(a, b); g2.setLineDash([]); }
  }
}
function drawOsmBase() {
  const d = world.graph.draw;
  g2.lineJoin = 'round'; g2.lineCap = 'round';
  for (const a of d.green) fillPts(a.pts, C.park);
  for (const a of d.water) fillPts(a.pts, C.water);
  if (cam.scale >= 0.3) for (const b of d.buildings) { if (inView(b.pts[0], 200)) fillPts(b.pts, C.building, C.buildingEdge); }
  for (const r of d.roads) {
    const wpx = Math.max(1.5, r.width * cam.scale);
    strokePts(r.pts, C.roadEdge, wpx + 2); strokePts(r.pts, C.road, wpx);
  }
  if (cam.scale >= 0.22) for (const p of d.paths) {
    if (p.crossing) continue;
    strokePts(p.pts, C.path, p.hw === 'steps' ? 3 : 1.5, p.tunnel ? [2, 6] : p.hw === 'steps' ? [3, 3] : null);
  }
  g2.lineCap = 'butt';
}

function drawRoute(r, color, width, dash) {
  g2.lineCap = 'round'; g2.lineJoin = 'round';
  const seg = (e, d) => { g2.setLineDash(d || []); line(w2s(world.graph.nodes.get(e.a)), w2s(world.graph.nodes.get(e.b))); };
  const under = (e) => e.via === 'underpass' || e.via === 'tunnel';
  if (!dash) { g2.strokeStyle = C.surface; g2.lineWidth = width + 3; for (const e of r.edges) if (!under(e)) seg(e); }
  g2.strokeStyle = color; g2.lineWidth = width;
  for (const e of r.edges) if (!under(e)) seg(e, dash);
  g2.lineWidth = Math.max(2, width - 1);
  for (const e of r.edges) if (under(e)) seg(e, [3, 7]);
  g2.setLineDash([]); g2.lineCap = 'butt';
}

function groupState(gr, t) {
  if (gr.kind !== 'signals' || !gr.intersection) return { state: 'none', remain: 0 };
  return sigState(gr.intersection, gr.leg, t);
}
function drawCrossings(t) {
  const G = world.graph;
  // 띠(간선마다)
  for (const e of G.edges) {
    if (e.kind !== 'cross' || !e.group) continue;
    const gr = G.crossings.get(e.group); if (!gr) continue;
    const A = w2s(G.nodes.get(e.a)), B = w2s(G.nodes.get(e.b));
    if (!inView(G.nodes.get(e.a))) continue;
    const s = groupState(gr, t);
    const col = s.state === 'none' ? C.crossNone : s.state === 'red' ? C.red : C.green;
    const wpx = Math.max(gr.kind === 'signals' ? 4 : 3, 5 * cam.scale);
    const selected = state.sel === gr.id;
    if (selected) { g2.strokeStyle = C.accent; g2.lineWidth = wpx + 8; g2.globalAlpha = 0.45; line(A, B); g2.globalAlpha = 1; }
    g2.strokeStyle = col; g2.globalAlpha = gr.kind === 'signals' ? 0.9 : 0.7; g2.lineWidth = wpx; line(A, B); g2.globalAlpha = 1;
    if (cam.scale > 1.6) {
      const L = e.length, dx = (B.x - A.x) / L, dy = (B.y - A.y) / L;
      g2.strokeStyle = 'rgba(255,255,255,.85)'; g2.lineWidth = wpx * 0.7;
      for (let i = 0.5; i + 0.5 < L; i += 1) line({ x: A.x + dx * i, y: A.y + dy * i }, { x: A.x + dx * (i + 0.5), y: A.y + dy * (i + 0.5) });
    }
  }
  // 숫자 알약(횡단보도 묶음마다). 교차로 중심에서 바깥쪽으로 밀어 겹치지 않게 한다.
  const onRoute = new Set(state.cmp ? state.cmp.fast.edges.filter((e) => e.group).map((e) => e.group) : []);
  for (const gr of G.crossings.values()) {
    if (gr.kind !== 'signals' || !inView(gr.mid)) continue;
    const selected = state.sel === gr.id;
    if (!(cam.scale >= 0.28 || selected || (onRoute.has(gr.id) && cam.scale >= 0.18))) {
      const m = w2s(gr.mid); g2.beginPath(); g2.arc(m.x, m.y, 3, 0, Math.PI * 2); g2.fillStyle = groupState(gr, t).state === 'red' ? C.red : C.green; g2.fill();
      continue;
    }
    const s = groupState(gr, t);
    const col = s.state === 'red' ? C.red : C.green;
    const mid = w2s(gr.mid);
    const it = gr.intersection ? G.intersections.get(gr.intersection) : null;
    let ox = 0, oy = 0;
    if (it) { const c = w2s(it); ox = mid.x - c.x; oy = mid.y - c.y; }
    const len = Math.hypot(ox, oy);
    if (len < 1) {
      const a = G.nodes.get(gr.nodes[0]), b = G.nodes.get(gr.nodes[gr.nodes.length - 1]);
      ox = -(b.y - a.y); oy = -(b.x - a.x); const l2 = Math.hypot(ox, oy) || 1; ox /= l2; oy /= l2;
    } else { ox /= len; oy /= len; }
    const fs = selected ? 15 : cam.scale >= 0.6 ? 12 : 11;
    const push = Math.max(4, 5 * cam.scale) / 2 + (selected ? 14 : 11);
    const px = mid.x + ox * push, py = mid.y + oy * push;
    const blinkOff = s.state === 'flash' && !reduceMotion && Math.floor(Date.now() / 500) % 2 === 1;
    const txt = String(Math.min(999, Math.max(0, Math.ceil(s.remain))));
    g2.font = `700 ${fs}px ${FONT}`;
    const pw = g2.measureText(txt).width + 10, ph = fs + 7;
    rrect(px - pw / 2, py - ph / 2, pw, ph, 6, col, selected ? C.ink : 'rgba(255,255,255,.9)');
    g2.fillStyle = blinkOff ? 'rgba(255,255,255,.45)' : '#fff';
    g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(txt, px, py + 0.5);
  }
}

function drawPin(node, label, fill, ink) {
  const p = w2s(node);
  g2.beginPath(); g2.arc(p.x, p.y, 12, 0, Math.PI * 2); g2.fillStyle = C.surface; g2.fill();
  g2.beginPath(); g2.arc(p.x, p.y, 10, 0, Math.PI * 2); g2.fillStyle = fill; g2.fill();
  g2.font = `700 11px ${FONT}`; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillStyle = ink; g2.fillText(label, p.x, p.y + 0.5);
}

function drawBase() {
  g2 = ctxBase;
  g2.setTransform(DPR, 0, 0, DPR, 0, 0);
  g2.fillStyle = C.bg; g2.fillRect(0, 0, W, H);
  g2.lineCap = 'butt'; g2.lineJoin = 'round';
  if (world.kind === 'schematic') drawSchematicBase(); else drawOsmBase();
  for (const l of world.labels) drawLabelAlong(l);
  g2 = ctxMain;
}
function draw() {
  const t = clock.now();
  const G = world.graph;
  const key = `${cam.cx.toFixed(2)}|${cam.cy.toFixed(2)}|${cam.scale.toFixed(5)}|${W}|${H}|${DPR}|${themeVer}|${worldVer}`;
  if (key !== baseKey) { drawBase(); baseKey = key; }
  g2 = ctxMain;
  g2.setTransform(1, 0, 0, 1, 0, 0);
  g2.drawImage(baseCv, 0, 0);
  g2.setTransform(DPR, 0, 0, DPR, 0, 0);
  g2.lineCap = 'butt'; g2.lineJoin = 'round';
  if (state.cmp) {
    if (!state.cmp.sameRoute) drawRoute(state.cmp.dist, C.ink3, 3, [7, 7]);
    drawRoute(state.cmp.fast, C.accent, 5, null);
  }
  drawCrossings(t);
  if (cam.scale > 0.16) {
    for (const it of G.intersections.values()) {
      if (it.kind === 'midblock' || !inView(it)) continue;
      const p = w2s(it);
      let lift;
      if (world.kind === 'schematic') { const ew = G.area.ew.find((s) => s.id === it.ew); lift = (ew.width / 2 + 3) * cam.scale + (cam.scale >= 0.18 ? 34 : 10); }
      else lift = 28 * cam.scale + 30;
      haloText(it.name, p.x, p.y - lift, cam.scale > 0.45 ? 13 : 12, C.ink2);
    }
  }
  if (state.user) {
    const p = w2s(state.user);
    g2.beginPath(); g2.arc(p.x, p.y, 16, 0, Math.PI * 2); g2.fillStyle = C.accent; g2.globalAlpha = 0.2; g2.fill(); g2.globalAlpha = 1;
    g2.beginPath(); g2.arc(p.x, p.y, 7, 0, Math.PI * 2); g2.fillStyle = C.accent; g2.fill();
    g2.lineWidth = 2; g2.strokeStyle = '#fff'; g2.stroke();
  }
  if (state.from && G.nodes.get(state.from)) drawPin(G.nodes.get(state.from), '출', C.accent, C.accentInk);
  if (state.to && G.nodes.get(state.to)) drawPin(G.nodes.get(state.to), '도', C.ink, C.surface);
  lastDraw = Date.now(); dirty = false;
}

// ---------- 상호작용 ----------
const pointers = new Map();
let drag = null, pinch = null, tapCandidate = false;
cv.addEventListener('pointerdown', (ev) => {
  cv.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) { drag = { x: ev.clientX, y: ev.clientY, cx: cam.cx, cy: cam.cy, moved: 0 }; tapCandidate = true; }
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; tapCandidate = false; }
});
cv.addEventListener('pointermove', (ev) => {
  if (!pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const rect = cv.getBoundingClientRect();
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0 && pinch.d > 0) zoomAt(d / pinch.d, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
    pinch.d = d;
  } else if (pointers.size === 1 && drag) {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    if (drag.moved > 5) tapCandidate = false;
    cam.cx = drag.cx - dx / cam.scale; cam.cy = drag.cy + dy / cam.scale; dirty = true;
  }
});
function endPointer(ev) {
  const wasTap = tapCandidate && pointers.size === 1 && drag && drag.moved <= 5;
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    const rect = cv.getBoundingClientRect();
    if (wasTap) onTap(ev.clientX - rect.left, ev.clientY - rect.top);
    drag = null; tapCandidate = false;
  }
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('wheel', (ev) => { ev.preventDefault(); const rect = cv.getBoundingClientRect(); zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - rect.left, ev.clientY - rect.top); }, { passive: false });

function onTap(sx, sy) {
  const p = s2w(sx, sy);
  if (state.tapMode) {
    const nn = nearestNode(world.graph, p);
    if (!nn || nn.d > 140) { toast('길 가까이를 눌러주세요.'); return; }
    const which = state.tapMode;
    setEndpoint(which, nn.node.id, nn.node.label);
    setTapMode(null);
    toast(`${which === 'from' ? '출발' : '도착'} 지점을 지정했습니다.`);
    return;
  }
  const hit = nearestCrossing(world.graph, p, Math.max(8, 18 / cam.scale));
  if (hit && hit.group) { selectCrossing(hit.group.id); return; }
  if (state.sel) { state.sel = null; renderPanel(); dirty = true; }
}
function setTapMode(mode) {
  state.tapMode = mode;
  cv.classList.toggle('aim', !!mode);
  const hint = $('#hint');
  hint.hidden = !mode;
  if (mode) hint.textContent = mode === 'from' ? '지도에서 출발 지점(길)을 누르세요' : '지도에서 도착 지점(길)을 누르세요';
}

// ---------- 출발·도착 ----------
function setEndpoint(which, nodeId, label) {
  if (which === 'from') { state.from = nodeId; state.fromLabel = label; } else { state.to = nodeId; state.toLabel = label; }
  syncSelects(); state.sel = null; dirty = true;
  recompute(); fitRoute();
}
function buildSelects() {
  for (const [sel, which] of [[$('#selFrom'), 'from'], [$('#selTo'), 'to']]) {
    sel.innerHTML = '';
    const opts = [...world.graph.pois.map((p) => ({ v: p.node, t: p.name })), { v: '__map', t: '지도에서 선택…' }];
    if (state.user) opts.unshift({ v: '__user', t: '내 위치' });
    for (const o of opts) { const el = document.createElement('option'); el.value = o.v; el.textContent = o.t; sel.appendChild(el); }
    const custom = document.createElement('option'); custom.value = '__custom'; custom.hidden = true; sel.appendChild(custom);
    sel.onchange = () => {
      const v = sel.value;
      if (v === '__map') { setTapMode(which); syncSelects(); toast(`지도에서 ${which === 'from' ? '출발' : '도착'} 지점을 누르세요.`); return; }
      if (v === '__user') { const nn = nearestNode(world.graph, state.user); setEndpoint(which, nn.node.id, '내 위치'); return; }
      const poi = world.graph.pois.find((p) => p.node === v);
      if (poi) setEndpoint(which, poi.node, poi.name);
    };
  }
  syncSelects();
}
function syncSelects() {
  for (const [sel, node, label] of [[$('#selFrom'), state.from, state.fromLabel], [$('#selTo'), state.to, state.toLabel]]) {
    const poi = world.graph.pois.find((p) => p.node === node && p.name === label);
    if (poi) sel.value = poi.node;
    else { const c = sel.querySelector('option[value="__custom"]'); c.textContent = label; c.hidden = false; sel.value = '__custom'; }
  }
}
$('#swap').addEventListener('click', () => {
  [state.from, state.to] = [state.to, state.from];
  [state.fromLabel, state.toLabel] = [state.toLabel, state.fromLabel];
  syncSelects(); dirty = true; recompute(); fitRoute();
});

// ---------- 경로 계산과 패널 ----------
function recompute() {
  lastCmp = Date.now(); cmpDirty = false;
  const G = world.graph;
  state.cmp = state.from && state.to && state.from !== state.to && G.nodes.has(state.from) && G.nodes.has(state.to)
    ? compare(G, world.adj, state.from, state.to, clock.now(), routeCtx()) : null;
  dirty = true;
  if (!state.sel) renderPanel();
}

function stepRows(route) {
  const rows = []; let acc = null;
  const flush = () => { if (acc) { rows.push(acc); acc = null; } };
  for (const s of route.steps) {
    if (s.kind === 'walk') {
      const via = s.edge.via || (s.edge.hw === 'steps' ? 'steps' : 'walk');
      const name = world.walkName(s.edge);
      if (acc && (acc.kind !== 'walk' || acc.via !== via || acc.name !== name)) flush();
      if (!acc) acc = { kind: 'walk', length: 0, sec: 0, via, name, tArrive: s.tArrive };
      acc.length += s.length; acc.sec += s.walkSec;
    } else {
      const gid = s.edge.group;
      if (acc && acc.kind === 'cross' && acc.group === gid) { acc.length += s.length; acc.sec += s.walkSec; continue; }
      flush();
      acc = { kind: 'cross', group: gid, length: s.length, sec: s.walkSec, wait: s.wait, tArrive: s.tArrive, crossAt: s.crossAt, signal: !!s.edge.signal, name: crossingName(world.graph, s.edge) };
    }
  }
  flush();
  return rows;
}
function stepsHTML(route) {
  return `<ol class="steps">${stepRows(route).map((r) => {
    if (r.kind === 'walk') {
      const what = r.via === 'underpass' ? '지하보도로 건너기 (계단 포함)' : r.via === 'tunnel' ? `${r.name} (지하 통로)` : r.via === 'steps' ? '계단' : `${r.name} 따라 걷기`;
      return `<li class="step"><span class="chip walk">${fmtDur(r.sec)}</span><div><b>${esc(what)}</b><div class="meta">${fmtDist(r.length)}</div></div></li>`;
    }
    const chip = r.wait > 0.5 ? `<span class="chip wait">${fmtDur(r.wait)} 대기</span>` : '<span class="chip go">바로 건넘</span>';
    const meta = r.signal ? `${fmtClock(r.tArrive)} 도착 → ${fmtClock(r.crossAt)} 건너기 시작 · ${Math.round(r.length)} m` : `신호 없음 · 차를 살피고 건너기 · ${Math.round(r.length)} m`;
    return `<li class="step">${chip}<div><b>${esc(r.name)}</b><div class="meta">${meta}</div></div></li>`;
  }).join('')}</ol>`;
}
function routeHTML(c) {
  const { fast, dist: d } = c;
  const row = (cls, title, r) => `<div class="cmp-row ${cls}"><div class="cmp-h"><span class="sw"></span>${title}</div><div class="cmp-time">${fmtDur(r.time)}</div><div class="cmp-meta">${fmtDist(r.length)} · 신호 대기 ${fmtDur(r.wait)} · ${fmtClock(r.arrival)} 도착</div></div>`;
  let verdict;
  if (c.saving >= 5) {
    verdict = `신호를 보고 걸으면 <strong>${fmtDur(c.saving)} 빠릅니다.</strong> ` + (c.extraDist > 5
      ? `${Math.round(c.extraDist)} m 더 걷지만 기다리는 시간이 ${fmtDur(d.wait - fast.wait)} 줄어듭니다.`
      : '거리는 같고, 어느 횡단보도를 언제 건너느냐만 다릅니다.');
  } else {
    verdict = '지금 출발하면 두 방식의 차이가 거의 없습니다. 거리만 본 경로도 신호가 잘 맞습니다.';
  }
  const notes = c.notes.filter((n) => n.diff >= 5).map((n) => `<p class="note"><b>${esc(n.name)}</b>에서는 ${LEG_SHORT[n.first] || ''} 횡단보도를 먼저 건너세요. ${LEG_SHORT[n.altFirst] || '다른 쪽'}부터 건너면 ${fmtDur(n.diff)} 더 걸립니다.</p>`).join('');
  const slack = c.slack >= 15 ? `<p class="note">지금 출발해도, <b>${fmtDur(c.slack)} 뒤</b>에 출발해도 도착 시각은 같습니다. 어차피 신호에서 기다리게 되니 서두르지 않아도 됩니다.</p>` : '';
  const src = live.on && live.ok ? '실시간 신호' : '시뮬레이션 신호';
  return `<div class="route-head"><span><b>${esc(state.fromLabel)}</b> → <b>${esc(state.toLabel)}</b></span><span>${src} · ${settings.speed.toFixed(1)} m/s</span></div>
<div class="cmp">${row('fast', '신호 보고 걷기', fast)}${row('dist', '거리만 보고 걷기', d)}</div>
<p class="verdict">${verdict}</p>${slack}${notes}
<h2 class="sec">신호 보고 걷기 · 단계별</h2>${stepsHTML(fast)}
<h2 class="sec">거리만 보고 걷기 · 단계별</h2>${stepsHTML(d)}`;
}

const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', ' ': '' };
const SEG_RECT = { a: [12, 2, 36, 9], b: [49, 10, 9, 36], c: [49, 54, 9, 36], d: [12, 89, 36, 9], e: [2, 54, 9, 36], f: [2, 10, 9, 36], g: [12, 45.5, 36, 9] };
function ledSVG(n, cls) {
  const txt = String(Math.min(999, Math.max(0, Math.ceil(n)))).padStart(3, ' ');
  let x = 0, body = '';
  for (const ch of txt) {
    const on = SEG[ch] || '';
    for (const [k, r] of Object.entries(SEG_RECT)) body += `<rect x="${x + r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="2" class="${on.includes(k) ? 'on' : 'off'}"/>`;
    x += 68;
  }
  return `<svg class="led ${cls}" viewBox="0 0 196 100" aria-hidden="true">${body}</svg>`;
}

function crossingInfo(groupId) {
  const G = world.graph;
  const gr = G.crossings.get(groupId);
  const it = gr && gr.intersection ? G.intersections.get(gr.intersection) : null;
  const t = clock.now();
  const need = (gr.length / settings.speed);
  if (!it || gr.kind !== 'signals') return { gr, it: null, t, s: { state: 'none', remain: 0 }, need, plan: null, nextStart: null };
  const s = sigState(it.id, gr.leg, t);
  const plan = world.plans.get(it.id);
  const nextStart = s.state === 'red' ? t + s.remain : nextGreenStart(plan, gr.leg, t);
  return { gr, it, t, s, need, plan, nextStart };
}
function featuresHTML(gr, it) {
  const f = gr.features;
  if (!f) return '';
  const chips = [];
  if (f.countdown) chips.push('잔여시간 표시기');
  if (f.sound) chips.push('음향신호기');
  if (f.vibration) chips.push('진동 안내');
  if (f.button) chips.push('보행자 버튼');
  if (f.island) chips.push('중앙 보행섬');
  if (f.tactile) chips.push('점자블록');
  if (!chips.length) return '';
  const note = f.button && it && it.kind === 'midblock'
    ? '<p class="note">보행자 버튼이 있는 단일로 횡단보도입니다. 버튼을 눌러야 초록불이 켜지는 신호라면 실제 대기 시간이 계산과 다를 수 있습니다.</p>' : '';
  return `<div class="xfeat">${chips.map((c) => `<span class="pill">${c}</span>`).join('')}<span class="xsrc">OpenStreetMap</span></div>${note}`;
}
function crossingHTML(groupId) {
  const { gr, it, s, need, plan } = crossingInfo(groupId);
  const sub = `${gr.across ? `${gr.across} 건너기 · ` : ''}${Math.round(gr.length)} m · ${settings.speed.toFixed(1)} m/s로 ${fmtDur(need)}`;
  if (!it) {
    return `<div class="xcard">
<div class="xhead"><div><div class="xname">${esc(gr.name)}</div><div class="xsub">${esc(sub)}</div></div><button class="btn" id="btnCloseX" type="button">닫기</button></div>
<p class="note">${gr.kind === 'marked' ? '신호등이 없는 횡단보도입니다. 차를 살피고 건너세요. 경로 계산에는 4초를 더합니다.' : '신호도 표시도 없는 횡단 지점입니다. 경로 계산에는 2초를 더합니다.'}</p>${featuresHTML(gr, null)}
<div class="xactions"><button class="btn primary" id="btnFromHere" type="button">여기서 출발</button><button class="btn" id="btnToHere" type="button">여기까지</button></div>
</div>`;
  }
  const greenDur = (plan.starts[gr.leg] || [{ dur: 0 }])[0].dur;
  void s;
  return `<div class="xcard">
<div class="xhead"><div><div class="xname">${esc(gr.name)}</div><div class="xsub">${esc(sub)}</div></div><button class="btn" id="btnCloseX" type="button">닫기</button></div>
<div class="ledwrap"><div id="led"></div><div class="ledlabel" id="ledLabel"></div></div>
<div class="xverdict" id="xverdict"></div>
<div class="xplan">신호 주기 ${plan.cycle}초 · 보행 초록불 ${greenDur}초 · <span id="xnext"></span></div>${featuresHTML(gr, it)}
<div class="xactions"><button class="btn primary" id="btnFromHere" type="button">여기서 출발</button><button class="btn" id="btnToHere" type="button">여기까지</button></div>
</div>`;
}
function updateCrossingCard() {
  const led = $('#led'); if (!led) return;
  const { s, need, nextStart, t } = crossingInfo(state.sel);
  led.innerHTML = ledSVG(s.remain, s.state);
  const liveTag = s.live ? ' (실시간)' : '';
  if (s.state === 'red') {
    $('#ledLabel').innerHTML = `다음 초록불까지${liveTag}<small>빨간불입니다. ${fmtClock(nextStart)}에 켜집니다.</small>`;
    $('#xverdict').className = 'xverdict'; $('#xverdict').textContent = `초록불이 켜지면 ${fmtDur(need)} 걸려 건넙니다. 기다리는 동안 서두를 필요 없습니다.`;
  } else {
    const ok = s.remain >= need + settings.margin;
    $('#ledLabel').innerHTML = `초록불 남은 시간${liveTag}<small>${s.state === 'flash' ? '점멸 중입니다.' : '막 켜졌습니다.'} ${fmtDur(need)}면 건널 수 있습니다.</small>`;
    $('#xverdict').className = `xverdict ${ok ? 'ok' : 'no'}`;
    $('#xverdict').textContent = ok ? `지금 건너면 ${fmtDur(s.remain - need)} 남기고 도착합니다.` : `남은 시간이 부족합니다. 다음 초록불(${fmtClock(nextStart)})을 기다리세요.`;
  }
  $('#xnext').textContent = `다음 초록불 ${fmtClock(nextStart)} · 지금 ${fmtClock(t)}`;
}
function selectCrossing(groupId) {
  const gr = world.graph.crossings.get(groupId); if (!gr) return;
  state.sel = groupId; dirty = true;
  const sp = w2s(gr.mid);
  if (sp.x < 40 || sp.x > W - 40 || sp.y < 40 || sp.y > H - 40) panTo(gr.mid);
  renderPanel();
}
function renderPanel() {
  const panel = $('#panel');
  if (state.sel) {
    panel.innerHTML = crossingHTML(state.sel);
    updateCrossingCard();
    $('#btnCloseX').onclick = () => { state.sel = null; renderPanel(); dirty = true; };
    const pick = (which) => {
      const gr = world.graph.crossings.get(state.sel);
      const a = world.graph.nodes.get(gr.nodes[0]);
      setEndpoint(which, a.id, gr.name);
      toast(`${which === 'from' ? '출발' : '도착'} 지점을 ${gr.name} 앞으로 정했습니다.`);
    };
    $('#btnFromHere').onclick = () => pick('from');
    $('#btnToHere').onclick = () => pick('to');
    return;
  }
  if (state.cmp) { const top = panel.scrollTop; panel.innerHTML = routeHTML(state.cmp); panel.scrollTop = top; return; }
  panel.innerHTML = state.from && state.to && state.from !== state.to
    ? '<p class="note">두 지점을 잇는 길을 찾지 못했습니다. 지도에 보도 정보가 없는 곳일 수 있습니다. 다른 지점을 골라보세요.</p>'
    : '<p class="note">출발과 도착을 고르면 거리만 본 경로와 신호를 본 경로를 비교합니다. 지도의 횡단보도를 누르면 그 신호의 잔여시간을 봅니다.</p>';
}

// ---------- 지도 바꾸기(개략도 ↔ 실제 지도) ----------
const osm = { loading: false, status: '' };
function setMapStatus(msg) { osm.status = msg; const el = $('#mapStatus'); if (el) el.textContent = msg; }
function renderMapNow() {
  const el = $('#mapNow'); if (!el) return;
  const G = world.graph;
  el.innerHTML = world.kind === 'schematic'
    ? `<span class="pill">개략도</span><b>${esc(G.area.name)}</b><span class="status">실제 거리로 그린 격자. 신호는 시뮬레이션.</span>`
    : `<span class="pill osm">실제 지도</span><b>${esc(world.meta.label || G.area.name)}</b><span class="status">길 ${G.stats.edges}개 · 횡단보도 ${G.stats.crossings}개(신호 ${G.stats.signalized}) · 교차로 ${G.stats.intersections}곳 · 출입구 ${G.stats.pois}곳</span>`;
  $('#attrib').hidden = world.kind !== 'osm';
  $('#areaNote').textContent = `${world.kind === 'schematic' ? '데모 지역' : '지도'}: ${G.area.name}. ${G.area.note}`;
}
function pickDefaultEndpoints(opts = {}) {
  const G = world.graph;
  if (world.kind === 'schematic') {
    state.from = 'gangnamdaero|teheranro#SW'; state.fromLabel = '강남역';
    state.to = 'nonhyeonro|bongeunsaro#NE'; state.toLabel = '언주역';
    return;
  }
  const center = opts.userPos || { x: 0, y: 0 };
  let from = null, to = null;
  if (opts.userPos) { const nn = nearestNode(G, opts.userPos); if (nn) from = { node: nn.node.id, name: '내 위치' }; }
  const pois = G.pois.slice();
  if (!from && pois.length) { pois.sort((a, b) => dist(a, center) - dist(b, center)); from = { node: pois[0].node, name: pois[0].name }; }
  if (!from) { const nn = nearestNode(G, center); from = nn ? { node: nn.node.id, name: nn.node.label } : null; }
  if (from) {
    const fp = G.nodes.get(from.node);
    const far = pois.filter((p) => p.node !== from.node).sort((a, b) => dist(b, fp) - dist(a, fp))[0];
    if (far) to = { node: far.node, name: far.name };
    else { let best = null, bd = -1; for (const n of G.nodes.values()) { const d = dist(n, fp); if (d > bd) { bd = d; best = n; } } if (best) to = { node: best.id, name: best.label }; }
  }
  state.from = from ? from.node : null; state.fromLabel = from ? from.name : '';
  state.to = to ? to.node : null; state.toLabel = to ? to.name : '';
}
function setWorld(graph, meta = {}, opts = {}) {
  world = makeWorld(graph, meta); worldVer++;
  state.sel = null; state.cmp = null; setTapMode(null);
  state.user = opts.userPos || null;
  live.obs.clear();
  pickDefaultEndpoints(opts);
  buildSelects(); renderMapNow(); updateBadge();
  recompute(); fitRoute();
}
// 넷리파이 빌드 때 미리 받아 둔 지도(data/<장소>.network.json). 없거나 못 읽으면 null.
async function fetchPrebuilt(key, kind) {
  try {
    const r = await fetch(new URL(`data/${key}.${kind}.json`, location.href), { cache: 'no-cache' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.elements) && j.elements.length ? j : null;
  } catch { return null; }
}
async function prebuiltInfo() {
  try { const r = await fetch(new URL('data/index.json', location.href), { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function fetchOsm(kind, bbox, onStatus) {
  if (settings.apiBase) {
    try {
      onStatus('서버에서 지도 데이터를 받는 중…');
      const u = `${settings.apiBase.replace(/\/+$/, '')}/api/osm?kind=${kind}&s=${bbox.s}&w=${bbox.w}&n=${bbox.n}&e=${bbox.e}`;
      const r = await fetch(u, { cache: 'no-store' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      return await r.json();
    } catch (e) { onStatus(`서버 실패(${e.message || e}), OpenStreetMap에 직접 요청…`); }
  }
  return fetchOverpass(kind === 'context' ? contextQuery(bbox) : networkQuery(bbox), { onStatus });
}
async function loadRealMap(center, radius, label, opts = {}) {
  if (osm.loading) return;
  osm.loading = true; $('#btnLoadMap').disabled = true;
  const bbox = bboxAround(center.lat, center.lon, radius);
  try {
    let net = null, prebuilt = false, fetchedAt = '';
    if (opts.key && PLACES[opts.key] && radius <= PREBUILT_RADIUS) {
      setMapStatus('미리 받아 둔 지도를 여는 중…');
      net = await fetchPrebuilt(opts.key, 'network');
      if (net) { prebuilt = true; const info = await prebuiltInfo(); fetchedAt = (info && info.fetchedAt || '').slice(0, 10); }
    }
    if (!net) net = await fetchOsm('network', bbox, setMapStatus);
    setMapStatus('보행 그래프를 만드는 중…');
    await new Promise((r) => setTimeout(r, 20));
    const graph = buildOsmWorld(net, null, { center, name: label });
    if (graph.nodes.size < 20) throw new Error('이 지역에는 걸을 수 있는 길 데이터가 거의 없습니다.');
    const userPos = opts.userLatLon ? graph.proj.toLocal(opts.userLatLon.lat, opts.userLatLon.lon) : null;
    setWorld(graph, { label, center, radius }, { userPos });
    if (!opts.userLatLon) { settings.lastMap = { lat: center.lat, lon: center.lon, radius, label, key: opts.key || null }; saveSettings(); }
    setMapStatus(`불러왔습니다${prebuilt ? ` (미리 받아 둔 지도${fetchedAt ? `, ${fetchedAt} 기준` : ''})` : ''}. 길 ${graph.stats.edges}개, 횡단보도 ${graph.stats.crossings}개(신호 ${graph.stats.signalized}), 교차로 ${graph.stats.intersections}곳.`);
    toast(`실제 지도: ${label}. 횡단보도 ${graph.stats.crossings}개를 찾았습니다.`);
    const ctxPromise = prebuilt ? fetchPrebuilt(opts.key, 'context').then((c) => c || fetchOsm('context', bbox, () => {})) : fetchOsm('context', bbox, () => {});
    ctxPromise.then((ctxData) => { if (ctxData && world.graph === graph) { addContext(graph, ctxData); worldVer++; renderMapNow(); dirty = true; } }).catch(() => {});
  } catch (e) {
    const kind = e && e.kind;
    const head = kind === 'blocked' ? '지도 서버에 요청을 보내지 못했습니다. 인터넷 연결을 확인해 주세요.'
      : kind === 'busy' ? '지도 서버들이 지금 바빠 응답하지 않습니다. 잠시 뒤 다시 불러오기를 눌러주세요.'
      : '지도를 불러오지 못했습니다.';
    setMapStatus(`실패: ${head} (${(e && e.message) || e})`);
    toast('실제 지도를 불러오지 못했습니다.');
    if (opts.auto) openMapSheet(true);
  } finally {
    osm.loading = false; $('#btnLoadMap').disabled = false;
  }
}
function openMapSheet(open) { $('#mapsheet').hidden = !open; if (open) { renderMapNow(); setMapStatus(osm.status); } }
$('#btnMap').addEventListener('click', () => openMapSheet(true));
$('#btnCloseMap').addEventListener('click', () => openMapSheet(false));
$('#btnSchematic').addEventListener('click', () => { setWorld(SCHEMATIC, { label: '개략도 · 강남 테헤란로 일대' }); settings.lastMap = null; saveSettings(); setMapStatus(''); toast('개략도로 돌아왔습니다.'); });
$('#btnLoadMap').addEventListener('click', async () => {
  const which = $('#inCenter').value, radius = Number($('#inRadius').value) || 700;
  if (which === 'user') {
    const ll = await getPosition();
    if (!ll) return;
    await loadRealMap(ll, radius, '내 위치 주변', { userLatLon: ll });
    return;
  }
  if (which === 'view') {
    const c = world.graph.proj.toLatLon(cam.cx, cam.cy);
    await loadRealMap(c, radius, '지금 보는 곳 주변');
    return;
  }
  const pl = PLACES[which] || PLACES.dj_cityhall;
  await loadRealMap({ lat: pl.lat, lon: pl.lon }, radius, pl.name, { key: which });
});

// ---------- 배지·설정·토스트 ----------
function updateBadge() {
  const b = $('#badge');
  let text = '시뮬레이션', cls = 'badge';
  if (live.on) {
    if (live.ok) { text = live.serverMode === 'mock' ? '실시간 (모의 서버)' : live.serverMode === 'live' ? '실시간 (서울 T-Data)' : '실시간'; cls += ' live'; }
    else { text = '연결 실패 · 시뮬레이션'; cls += ' fail'; }
  }
  b.textContent = text; b.className = cls;
  const st = $('#liveStatus');
  if (st) {
    if (!live.on) st.textContent = '시뮬레이션 신호를 쓰고 있습니다.';
    else if (live.ok) st.textContent = `연결됨 · ${live.obs.size}개 교차로 · ${live.serverMode === 'mock' ? '모의 데이터' : '서울 T-Data'}`;
    else st.textContent = live.error || '연결 중…';
    $('#btnLive').textContent = live.on ? '끊기' : '연결';
  }
}
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3200);
}
function openSettings(open) { $('#settings').hidden = !open; }
$('#btnSettings').addEventListener('click', () => openSettings(true));
$('#badge').addEventListener('click', () => openSettings(true));
$('#btnCloseSettings').addEventListener('click', () => openSettings(false));
$('#zin').addEventListener('click', () => zoomAt(1.5, W / 2, H / 2));
$('#zout').addEventListener('click', () => zoomAt(1 / 1.5, W / 2, H / 2));
$('#fit').addEventListener('click', fitAll);
$('#loc').addEventListener('click', locate);

const inSpeed = $('#inSpeed'), inMargin = $('#inMargin'), inSpeedup = $('#inSpeedup'), inApi = $('#inApi');
inSpeed.value = settings.speed; inMargin.value = settings.margin; inSpeedup.value = String(settings.speedup); inApi.value = settings.apiBase;
const speedWord = (v) => (v < 1.0 ? '천천히' : v < 1.3 ? '보통' : v < 1.5 ? '빠르게' : '매우 빠르게');
function syncOutputs() { $('#outSpeed').textContent = `${settings.speed.toFixed(1)} m/s · ${speedWord(settings.speed)}`; $('#outMargin').textContent = `${settings.margin}초`; }
inSpeed.addEventListener('input', () => { settings.speed = Number(inSpeed.value); syncOutputs(); saveSettings(); cmpDirty = true; });
inMargin.addEventListener('input', () => { settings.margin = Number(inMargin.value); syncOutputs(); saveSettings(); cmpDirty = true; });
inSpeedup.addEventListener('change', () => { settings.speedup = Number(inSpeedup.value); clock.setSpeed(settings.speedup); saveSettings(); cmpDirty = true; toast(settings.speedup === 1 ? '실제 시간으로 흐릅니다.' : `시간이 ${settings.speedup}배로 흐릅니다.`); });
$('#btnLive').addEventListener('click', async () => {
  if (live.on) { liveDisconnect(); return; }
  settings.apiBase = inApi.value.trim(); saveSettings();
  updateBadge(); $('#liveStatus').textContent = '연결 중…';
  await liveConnect(settings.apiBase || '');
});
inApi.addEventListener('change', () => { settings.apiBase = inApi.value.trim(); saveSettings(); });

// ---------- 내 위치 ----------
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { toast('이 환경에서는 위치를 쓸 수 없습니다.'); resolve(null); return; }
    toast('위치를 확인하는 중…');
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => { toast(`위치를 가져오지 못했습니다. ${err && err.message ? err.message : '권한이 없습니다.'}`); resolve(null); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
  });
}
async function locate() {
  const ll = await getPosition();
  if (!ll) return;
  state.userLatLon = ll;
  const G = world.graph;
  const p = G.proj.toLocal(ll.lat, ll.lon);
  const b = G.bounds;
  const inside = p.x > b.minX - 400 && p.x < b.maxX + 400 && p.y > b.minY - 400 && p.y < b.maxY + 400;
  if (!inside) {
    state.user = null; dirty = true;
    const d = dist(p, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    toast(`지금 지도 범위 밖입니다 (약 ${fmtDist(d)} 떨어짐). 지도 버튼에서 '내 위치 주변'을 불러오세요.`);
    $('#inCenter').value = 'user'; openMapSheet(true);
    return;
  }
  state.user = p; panTo(p); buildSelects();
  toast('내 위치를 표시했습니다. 출발 목록에서 "내 위치"를 고를 수 있어요.');
}

// ---------- 시작 ----------
function loop() {
  const now = Date.now();
  if (cmpDirty || now - lastCmp > 5000) recompute();
  if (dirty || now - lastDraw > 250) draw();
  if (state.sel) updateCrossingCard();
  requestAnimationFrame(loop);
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(() => { resize(); }).observe(mapEl);
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);
new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { dirty = true; });

readTheme(); resize(); buildSelects(); syncOutputs(); updateBadge(); renderMapNow(); recompute();
requestAnimationFrame(() => { resize(); fitRoute(); });
if (settings.apiBase) liveConnect(settings.apiBase);
// 주소 끝의 #dunsan 같은 이름으로 열면 그 곳의 실제 지도를 바로 불러온다. 없으면 지난번 지도.
const HASH_PLACES = { dunsan: 'dj_cityhall', cityhall: 'dj_cityhall', complex: 'dj_complex', daejeon: 'dj_station', yuseong: 'dj_yuseong', gangnam: 'gangnam', yeoksam: 'yeoksam' };
const hashKey = HASH_PLACES[(location.hash || '').replace(/^#/, '').toLowerCase()];
if (hashKey) {
  const pl = PLACES[hashKey];
  $('#inCenter').value = hashKey;
  toast(`${pl.name} 실제 지도를 불러오는 중…`);
  loadRealMap({ lat: pl.lat, lon: pl.lon }, Number($('#inRadius').value) || 700, pl.name, { key: hashKey, auto: true });
} else if (settings.lastMap && Number.isFinite(settings.lastMap.lat)) {
  const lm = settings.lastMap;
  if (lm.key && PLACES[lm.key]) $('#inCenter').value = lm.key;
  $('#inRadius').value = String(lm.radius || 700);
  toast(`지난번 지도(${lm.label})를 불러오는 중…`);
  loadRealMap({ lat: lm.lat, lon: lm.lon }, lm.radius || 700, lm.label, { key: lm.key, auto: true });
}
requestAnimationFrame(loop);

// 테스트와 디버깅용 손잡이(화면 동작에는 쓰지 않음)
window.__greenlight = { get world() { return world; }, state, cam, settings, live, w2s: (p) => w2s(p), recompute, selectCrossing, loadRealMap, setWorld, SCHEMATIC };
