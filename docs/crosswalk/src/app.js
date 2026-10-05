// 초록불 내비 – 화면과 상호작용. build.mjs 가 geo/signal/network/routing 과 함께 하나의 스크립트로 묶는다.
import { toLocal, dist, fmtDist, fmtDur, fmtClock } from './geo.js';
import { legState, nextGreenStart, anchorPlan, extrapolate } from './signal.js';
import { buildDemo, nearestNode, nearestCrossing, crossingName, LEG_SHORT } from './network.js';
import { adjacency, compare } from './routing.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FONT = '"IBM Plex Sans KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif';
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- 설정(이 기기에만 저장) ----------
const DEFAULTS = { speed: 1.2, margin: 2, speedup: 1, apiBase: '' };
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

// ---------- 도로망과 신호 ----------
const graph = buildDemo();
const adj = adjacency(graph);
const plans = new Map([...graph.intersections].map(([id, it]) => [id, it.plan]));
const streetName = Object.fromEntries(graph.streets.map((s) => [s.id, s.name]));

const live = { on: false, base: '', ok: false, lastOk: 0, serverMode: '', obs: new Map(), timer: null, error: '' };

function sigState(iid, leg, t) {
  if (live.on && live.ok) {
    const o = live.obs.get(iid);
    const l = o && o.legs[leg];
    if (l) { const ex = extrapolate(l, o.t, t); if (ex) return ex; }
  }
  return legState(plans.get(iid), leg, t);
}
function sigNextGreen(iid, leg, t) {
  if (live.on && live.ok) {
    const o = live.obs.get(iid);
    const l = o && o.legs[leg];
    if (l && l.state === 'red' && l.remain != null) { const g = o.t + l.remain; if (g > t) return g; }
  }
  return nextGreenStart(plans.get(iid), leg, t);
}
const routeCtx = () => ({ speed: settings.speed, margin: settings.margin, signal: sigState, nextGreen: sigNextGreen });

async function liveConnect(base) {
  live.base = String(base || '').trim().replace(/\/+$/, '');
  live.on = true; live.error = ''; live.ok = false;
  try {
    const r = await fetch(`${live.base}/api/health`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const h = await r.json();
    live.serverMode = h.mode || '';
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
      const it = graph.intersections.get(iid);
      if (!it || !rec.legs) continue;
      live.obs.set(iid, { t, legs: rec.legs });
      plans.set(iid, anchorPlan(it.plan, rec.legs, t));
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
  for (const [id, it] of graph.intersections) plans.set(id, it.plan);
  cmpDirty = true; updateBadge();
}

// ---------- 상태 ----------
const state = {
  from: 'gangnamdaero|teheranro#SW', fromLabel: '강남역',
  to: 'nonhyeonro|bongeunsaro#NE', toLabel: '언주역',
  cmp: null, sel: null, tapMode: null, user: null,
};
let dirty = true, cmpDirty = true, lastCmp = 0, lastDraw = 0, toastT = 0;

// ---------- 캔버스와 카메라 ----------
const cv = $('#cv'), g2 = cv.getContext('2d'), mapEl = $('#map');
const cam = { cx: 0, cy: 0, scale: 0.3 };
let W = 1, H = 1, DPR = 1;
let C = {};

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n).trim();
  C = { bg: g('--bg'), surface: g('--surface'), road: g('--road'), roadEdge: g('--road-edge'), roadCenter: g('--road-center'), ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'), accent: g('--accent'), accentInk: g('--accent-ink'), green: g('--green'), red: g('--red') };
  dirty = true;
}
function resize() {
  const r = mapEl.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  DPR = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  dirty = true;
}
function fitAll() {
  const b = graph.bounds, pad = 70;
  cam.scale = Math.min(W / (b.maxX - b.minX + 2 * pad), H / (b.maxY - b.minY + 2 * pad));
  cam.cx = (b.minX + b.maxX) / 2; cam.cy = (b.minY + b.maxY) / 2;
  dirty = true;
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
function fitRoute() {
  const r = state.cmp && state.cmp.fast;
  if (!r || r.nodes.length < 2) { fitAll(); return; }
  const pts = r.nodes.map((id) => graph.nodes.get(id));
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const pad = 140;
  cam.scale = Math.max(0.05, Math.min(1.2, Math.min(W / (maxX - minX + 2 * pad), H / (maxY - minY + 2 * pad))));
  cam.cx = (minX + maxX) / 2; cam.cy = (minY + maxY) / 2;
  dirty = true;
}

// ---------- 그리기 ----------
function line(a, b) { g2.beginPath(); g2.moveTo(a.x, a.y); g2.lineTo(b.x, b.y); g2.stroke(); }
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

// 도로명 위치: 같은 도로 위의 교차로 사이 중간점
const streetLabels = (() => {
  const out = [];
  const its = [...graph.intersections.values()].filter((i) => i.kind === '4way');
  for (const s of graph.streets) {
    const on = its.filter((i) => (s.kind === 'ew' ? i.ew === s.id : i.ns === s.id));
    const dir = s.kind === 'ew' ? graph.u : graph.v;
    on.sort((a, b) => (a.x * dir.x + a.y * dir.y) - (b.x * dir.x + b.y * dir.y));
    for (let i = 0; i + 1 < on.length; i++) {
      out.push({ name: s.name, x: (on[i].x + on[i + 1].x) / 2, y: (on[i].y + on[i + 1].y) / 2, dir, width: s.width });
    }
  }
  return out;
})();

function drawStreetName(l) {
  const p = w2s(l);
  let ang = -Math.atan2(l.dir.y, l.dir.x);
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
  const size = cam.scale > 0.5 ? 13 : 11;
  g2.save(); g2.translate(p.x, p.y); g2.rotate(ang);
  g2.font = `500 ${size}px ${FONT}`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.fillStyle = C.ink3; g2.fillText(l.name, 0, 0);
  g2.restore();
}

function drawRoute(r, color, width, dash) {
  g2.lineCap = 'round'; g2.lineJoin = 'round';
  const seg = (e, d) => { g2.setLineDash(d || []); line(w2s(graph.nodes.get(e.a)), w2s(graph.nodes.get(e.b))); };
  if (!dash) { g2.strokeStyle = C.surface; g2.lineWidth = width + 3; for (const e of r.edges) if (e.via !== 'underpass') seg(e); }
  g2.strokeStyle = color; g2.lineWidth = width;
  for (const e of r.edges) if (e.via !== 'underpass') seg(e, dash);
  g2.lineWidth = Math.max(2, width - 1);
  for (const e of r.edges) if (e.via === 'underpass') seg(e, [3, 7]);
  g2.setLineDash([]); g2.lineCap = 'butt';
}

function drawCrossing(e, t) {
  const A = w2s(graph.nodes.get(e.a)), B = w2s(graph.nodes.get(e.b));
  const s = sigState(e.signal.intersection, e.signal.leg, t);
  const col = s.state === 'red' ? C.red : C.green;
  const wpx = Math.max(4, 5 * cam.scale);
  const selected = state.sel === e.id;
  if (selected) { g2.strokeStyle = C.accent; g2.lineWidth = wpx + 8; g2.globalAlpha = 0.45; line(A, B); g2.globalAlpha = 1; }
  g2.strokeStyle = col; g2.globalAlpha = 0.9; g2.lineWidth = wpx; line(A, B); g2.globalAlpha = 1;
  if (cam.scale > 1.6) {
    const L = e.length, dx = (B.x - A.x) / L, dy = (B.y - A.y) / L;
    g2.strokeStyle = 'rgba(255,255,255,.85)'; g2.lineWidth = wpx * 0.7;
    for (let i = 0.5; i + 0.5 < L; i += 1) line({ x: A.x + dx * i, y: A.y + dy * i }, { x: A.x + dx * (i + 0.5), y: A.y + dy * (i + 0.5) });
  }
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const onRoute = state.cmp && state.cmp.fast.edges.includes(e);
  if (cam.scale >= 0.28 || selected || (onRoute && cam.scale >= 0.18)) {
    // 숫자 알약은 교차로 중심에서 바깥쪽으로 밀어 네 개가 겹치지 않게 한다
    const it = graph.intersections.get(e.signal.intersection);
    const c = w2s(it);
    let ox = mid.x - c.x, oy = mid.y - c.y;
    const len = Math.hypot(ox, oy);
    if (len < 1) { ox = -graph.v.x; oy = graph.v.y; } else { ox /= len; oy /= len; }
    const fs = selected ? 15 : cam.scale >= 0.6 ? 12 : 11;
    const push = wpx / 2 + (selected ? 14 : 11);
    const px = mid.x + ox * push, py = mid.y + oy * push;
    const blinkOff = s.state === 'flash' && !reduceMotion && Math.floor(Date.now() / 500) % 2 === 1;
    const txt = String(Math.min(999, Math.max(0, Math.ceil(s.remain))));
    g2.font = `700 ${fs}px ${FONT}`;
    const pw = g2.measureText(txt).width + 10, ph = fs + 7;
    rrect(px - pw / 2, py - ph / 2, pw, ph, 6, col, selected ? C.ink : 'rgba(255,255,255,.9)');
    g2.fillStyle = blinkOff ? 'rgba(255,255,255,.45)' : '#fff';
    g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(txt, px, py + 0.5);
  } else {
    g2.beginPath(); g2.arc(mid.x, mid.y, 3, 0, Math.PI * 2); g2.fillStyle = col; g2.fill();
  }
}

function drawPin(node, label, fill, ink) {
  const p = w2s(node);
  g2.beginPath(); g2.arc(p.x, p.y, 12, 0, Math.PI * 2); g2.fillStyle = C.surface; g2.fill();
  g2.beginPath(); g2.arc(p.x, p.y, 10, 0, Math.PI * 2); g2.fillStyle = fill; g2.fill();
  g2.font = `700 11px ${FONT}`; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillStyle = ink; g2.fillText(label, p.x, p.y + 0.5);
}

function draw() {
  const t = clock.now();
  g2.setTransform(DPR, 0, 0, DPR, 0, 0);
  g2.fillStyle = C.bg; g2.fillRect(0, 0, W, H);
  g2.lineCap = 'butt'; g2.lineJoin = 'round';
  for (const s of graph.streets) {
    const a = w2s(s.from), b = w2s(s.to), wpx = Math.max(2, s.width * cam.scale);
    g2.strokeStyle = C.roadEdge; g2.lineWidth = wpx + 2; line(a, b);
    g2.strokeStyle = C.road; g2.lineWidth = wpx; line(a, b);
    if (wpx > 12) { g2.strokeStyle = C.roadCenter; g2.lineWidth = 1; g2.setLineDash([10, 10]); line(a, b); g2.setLineDash([]); }
  }
  if (cam.scale > 0.12) for (const l of streetLabels) drawStreetName(l);
  if (state.cmp) {
    if (!state.cmp.sameRoute) drawRoute(state.cmp.dist, C.ink3, 3, [7, 7]);
    drawRoute(state.cmp.fast, C.accent, 5, null);
  }
  for (const e of graph.edges) if (e.kind === 'cross') drawCrossing(e, t);
  if (cam.scale > 0.16) {
    for (const it of graph.intersections.values()) {
      if (it.kind !== '4way') continue;
      const p = w2s(it);
      const ew = graph.area.ew.find((s) => s.id === it.ew);
      const lift = (ew.width / 2 + 3) * cam.scale + (cam.scale >= 0.18 ? 34 : 10);
      haloText(it.name, p.x, p.y - lift, cam.scale > 0.45 ? 13 : 12, C.ink2);
    }
  }
  if (state.user) {
    const p = w2s(state.user);
    g2.beginPath(); g2.arc(p.x, p.y, 16, 0, Math.PI * 2); g2.fillStyle = C.accent; g2.globalAlpha = 0.2; g2.fill(); g2.globalAlpha = 1;
    g2.beginPath(); g2.arc(p.x, p.y, 7, 0, Math.PI * 2); g2.fillStyle = C.accent; g2.fill();
    g2.lineWidth = 2; g2.strokeStyle = '#fff'; g2.stroke();
  }
  if (state.from) drawPin(graph.nodes.get(state.from), '출', C.accent, C.accentInk);
  if (state.to) drawPin(graph.nodes.get(state.to), '도', C.ink, C.surface);
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
    const nn = nearestNode(graph, p);
    if (!nn || nn.d > 140) { toast('보도 가까이를 눌러주세요.'); return; }
    const which = state.tapMode;
    setEndpoint(which, nn.node.id, nn.node.label);
    setTapMode(null);
    toast(`${which === 'from' ? '출발' : '도착'} 지점을 지정했습니다.`);
    return;
  }
  const hit = nearestCrossing(graph, p, Math.max(8, 18 / cam.scale));
  if (hit) { selectCrossing(hit.edge.id); return; }
  if (state.sel) { state.sel = null; renderPanel(); dirty = true; }
}
function setTapMode(mode) {
  state.tapMode = mode;
  cv.classList.toggle('aim', !!mode);
  const hint = $('#hint');
  hint.hidden = !mode;
  if (mode) hint.textContent = mode === 'from' ? '지도에서 출발 지점(보도)을 누르세요' : '지도에서 도착 지점(보도)을 누르세요';
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
    const opts = [...graph.pois.map((p) => ({ v: p.node, t: p.name })), { v: '__map', t: '지도에서 선택…' }];
    if (state.user) opts.unshift({ v: '__user', t: '내 위치' });
    for (const o of opts) { const el = document.createElement('option'); el.value = o.v; el.textContent = o.t; sel.appendChild(el); }
    const custom = document.createElement('option'); custom.value = '__custom'; custom.hidden = true; sel.appendChild(custom);
    sel.onchange = () => {
      const v = sel.value;
      if (v === '__map') { setTapMode(which); syncSelects(); toast(`지도에서 ${which === 'from' ? '출발' : '도착'} 지점을 누르세요.`); return; }
      if (v === '__user') { const nn = nearestNode(graph, state.user); setEndpoint(which, nn.node.id, '내 위치'); return; }
      const poi = graph.pois.find((p) => p.node === v);
      if (poi) setEndpoint(which, poi.node, poi.name);
    };
  }
  syncSelects();
}
function syncSelects() {
  for (const [sel, node, label] of [[$('#selFrom'), state.from, state.fromLabel], [$('#selTo'), state.to, state.toLabel]]) {
    const poi = graph.pois.find((p) => p.node === node);
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
  state.cmp = state.from && state.to && state.from !== state.to ? compare(graph, adj, state.from, state.to, clock.now(), routeCtx()) : null;
  dirty = true;
  if (!state.sel) renderPanel();
}

function stepRows(route) {
  const rows = []; let acc = null;
  for (const s of route.steps) {
    if (s.kind === 'walk') {
      const via = s.edge.via || 'walk';
      if (acc && (acc.via !== via || acc.street !== s.edge.street)) { rows.push(acc); acc = null; }
      if (!acc) acc = { kind: 'walk', length: 0, sec: 0, via, street: s.edge.street, tArrive: s.tArrive };
      acc.length += s.length; acc.sec += s.walkSec;
    } else { if (acc) { rows.push(acc); acc = null; } rows.push(s); }
  }
  if (acc) rows.push(acc);
  return rows;
}
function stepsHTML(route) {
  return `<ol class="steps">${stepRows(route).map((r) => {
    if (r.kind === 'walk') {
      const what = r.via === 'underpass' ? '지하보도로 건너기 (계단 포함)' : `${streetName[r.street] || ''} 보도 따라 걷기`;
      return `<li class="step"><span class="chip walk">${fmtDur(r.sec)}</span><div><b>${esc(what)}</b><div class="meta">${fmtDist(r.length)}</div></div></li>`;
    }
    const e = r.edge, name = crossingName(graph, e);
    const chip = r.wait > 0.5 ? `<span class="chip wait">${fmtDur(r.wait)} 대기</span>` : '<span class="chip go">바로 건넘</span>';
    return `<li class="step">${chip}<div><b>${esc(name)}</b><div class="meta">${fmtClock(r.tArrive)} 도착 → ${fmtClock(r.crossAt)} 건너기 시작 · ${Math.round(r.length)} m</div></div></li>`;
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
  const notes = c.notes.filter((n) => n.diff >= 5).map((n) => `<p class="note"><b>${esc(n.name)}</b>에서는 ${LEG_SHORT[n.first]} 횡단보도를 먼저 건너세요. ${LEG_SHORT[n.altFirst]}부터 건너면 ${fmtDur(n.diff)} 더 걸립니다.</p>`).join('');
  const slack = c.slack >= 15 ? `<p class="note">지금 출발해도, <b>${fmtDur(c.slack)} 뒤</b>에 출발해도 도착 시각은 같습니다. 어차피 신호에서 기다리게 되니 서두르지 않아도 됩니다.</p>` : '';
  const live1 = live.on && live.ok ? '실시간 신호' : '시뮬레이션 신호';
  return `<div class="route-head"><span><b>${esc(state.fromLabel)}</b> → <b>${esc(state.toLabel)}</b></span><span>${live1} · ${settings.speed.toFixed(1)} m/s</span></div>
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

function crossingInfo(edgeId) {
  const e = graph.edges.find((x) => x.id === edgeId);
  const it = graph.intersections.get(e.signal.intersection);
  const leg = it.legs[e.signal.leg];
  const t = clock.now();
  const s = sigState(it.id, e.signal.leg, t);
  const need = e.length / settings.speed;
  const plan = plans.get(it.id);
  const nextStart = s.state === 'red' ? t + s.remain : nextGreenStart(plan, e.signal.leg, t);
  return { e, it, leg, t, s, need, plan, nextStart };
}
function crossingHTML(edgeId) {
  const { e, it, leg, s, need, plan } = crossingInfo(edgeId);
  const title = it.kind === 'midblock' ? it.name : `${it.name} ${leg.name}`;
  const sub = `${leg.across} 건너기 · ${Math.round(e.length)} m · ${settings.speed.toFixed(1)} m/s로 ${fmtDur(need)}`;
  const greenDur = (plan.starts[e.signal.leg] || [{ dur: 0 }])[0].dur;
  return `<div class="xcard">
<div class="xhead"><div><div class="xname">${esc(title)}</div><div class="xsub">${esc(sub)}</div></div><button class="btn" id="btnCloseX" type="button">닫기</button></div>
<div class="ledwrap"><div id="led">${ledSVG(s.remain, s.state)}</div><div class="ledlabel" id="ledLabel"></div></div>
<div class="xverdict" id="xverdict"></div>
<div class="xplan">신호 주기 ${plan.cycle}초 · 보행 초록불 ${greenDur}초 · <span id="xnext"></span></div>
<div class="xactions"><button class="btn primary" id="btnFromHere" type="button">여기서 출발</button><button class="btn" id="btnToHere" type="button">여기까지</button></div>
</div>`;
}
function updateCrossingCard() {
  const led = $('#led'); if (!led) return;
  const { e, it, leg, s, need, nextStart, t } = crossingInfo(state.sel);
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
  void e; void it; void leg;
}
function selectCrossing(edgeId) {
  state.sel = edgeId; dirty = true;
  const e = graph.edges.find((x) => x.id === edgeId);
  const mid = { x: (graph.nodes.get(e.a).x + graph.nodes.get(e.b).x) / 2, y: (graph.nodes.get(e.a).y + graph.nodes.get(e.b).y) / 2 };
  const sp = w2s(mid);
  if (sp.x < 40 || sp.x > W - 40 || sp.y < 40 || sp.y > H - 40) panTo(mid);
  renderPanel();
}
function renderPanel() {
  const panel = $('#panel');
  if (state.sel) {
    panel.innerHTML = crossingHTML(state.sel);
    updateCrossingCard();
    $('#btnCloseX').onclick = () => { state.sel = null; renderPanel(); dirty = true; };
    const pick = (which) => {
      const e = graph.edges.find((x) => x.id === state.sel);
      const a = graph.nodes.get(e.a);
      setEndpoint(which, a.id, a.label);
      toast(`${which === 'from' ? '출발' : '도착'} 지점을 ${a.label}으로 정했습니다.`);
    };
    $('#btnFromHere').onclick = () => pick('from');
    $('#btnToHere').onclick = () => pick('to');
    return;
  }
  if (state.cmp) { const top = panel.scrollTop; panel.innerHTML = routeHTML(state.cmp); panel.scrollTop = top; return; }
  panel.innerHTML = '<p class="note">출발과 도착을 고르면 거리만 본 경로와 신호를 본 경로를 비교합니다. 지도의 횡단보도를 누르면 그 신호의 잔여시간을 봅니다.</p>';
}

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
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2800);
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
$('#areaNote').textContent = `데모 지역: ${graph.area.name}. ${graph.area.note} 교차로 ${[...graph.intersections.values()].filter((i) => i.kind === '4way').length}곳, 단일로 횡단보도 ${[...graph.intersections.values()].filter((i) => i.kind === 'midblock').length}곳.`;

// ---------- 내 위치 ----------
function locate() {
  if (!navigator.geolocation) { toast('이 환경에서는 위치를 쓸 수 없습니다.'); return; }
  toast('위치를 확인하는 중…');
  navigator.geolocation.getCurrentPosition((pos) => {
    const p = toLocal(pos.coords.latitude, pos.coords.longitude);
    const b = graph.bounds;
    const inside = p.x > b.minX - 600 && p.x < b.maxX + 600 && p.y > b.minY - 600 && p.y < b.maxY + 600;
    if (!inside) { state.user = null; toast(`데모 지역(강남) 밖입니다. 강남역에서 ${fmtDist(dist(p, { x: 0, y: 0 }))} 떨어져 있어요.`); dirty = true; return; }
    state.user = p; panTo(p); buildSelects();
    toast('내 위치를 표시했습니다. 출발 목록에서 "내 위치"를 고를 수 있어요.');
  }, (err) => toast(`위치를 가져오지 못했습니다. ${err && err.message ? err.message : '권한이 없습니다.'}`), { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
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

readTheme(); resize(); buildSelects(); syncOutputs(); updateBadge(); recompute();
requestAnimationFrame(() => { resize(); fitRoute(); });
if (settings.apiBase) liveConnect(settings.apiBase);
requestAnimationFrame(loop);

// 테스트와 디버깅용 손잡이(화면 동작에는 쓰지 않음)
window.__greenlight = { state, graph, cam, settings, live, w2s: (p) => w2s(p), recompute, selectCrossing };
