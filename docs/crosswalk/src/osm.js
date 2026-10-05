// 실제 지도: OpenStreetMap 데이터(Overpass API)를 받아 보행 그래프·횡단보도·교차로·그리기 레이어로 바꾼다.
// 모델: 보도, 골목, 공원길처럼 '걸을 수 있는 길'만 그래프에 넣고 큰길(primary/secondary)은 차도라서 걷지 않는다.
// 큰길은 횡단보도(footway=crossing)로만 건널 수 있으므로 어디서 언제 건너느냐가 경로에 그대로 반영된다.
import { makeProjection, dist, pointToSegment, bearingDeg } from './geo.js';
import { makePlan, pedGreenFor } from './signal.js';
import { LEG_NAMES } from './network.js';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// 차도만 있어 걷지 않는 길. 횡단보도로만 건넌다.
const MAJOR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link']);
// 걸을 수 있는 길
const WALKABLE = new Set(['footway', 'path', 'pedestrian', 'steps', 'living_street', 'residential', 'service', 'unclassified', 'road', 'track', 'tertiary', 'tertiary_link', 'cycleway', 'bridleway']);
const ROAD_WIDTH = { motorway: 24, trunk: 22, primary: 20, primary_link: 10, secondary: 14, secondary_link: 8, tertiary: 10, tertiary_link: 7, unclassified: 7, residential: 7, living_street: 6, service: 4.5, pedestrian: 6, road: 7, track: 3 };
const CYCLE_BY_CLASS = { motorway: 170, trunk: 170, primary: 160, primary_link: 150, secondary: 150, secondary_link: 140, tertiary: 130, tertiary_link: 120, unclassified: 120, residential: 110, living_street: 100, service: 100 };
const CLASS_LABEL = { footway: '보도', path: '오솔길', pedestrian: '보행자길', steps: '계단', living_street: '골목길', residential: '골목길', service: '진입로', unclassified: '길', road: '길', track: '농로', tertiary: '길', tertiary_link: '길', cycleway: '자전거길', bridleday: '길', primary: '큰길', secondary: '큰길', trunk: '간선도로' };
const SNAP_DEAD_END_M = 12;   // 끊긴 보도 끝을 가까운 길에 붙이는 거리
const CLUSTER_M = 60;         // 신호 횡단보도를 한 교차로로 묶는 거리
const POI_SNAP_M = 80;

export function bboxAround(lat, lon, radiusM) {
  const dLat = radiusM / 110574;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { s: lat - dLat, w: lon - dLon, n: lat + dLat, e: lon + dLon };
}
const bboxStr = (b) => `${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)}`;

export function networkQuery(b) {
  return `[out:json][timeout:60][bbox:${bboxStr(b)}];
(
  way[highway][highway!~"^(motorway|motorway_link|trunk|trunk_link|proposed|construction|raceway|bus_guideway|corridor|platform|abandoned|razed)$"];
  node[highway=crossing];
  node[highway=traffic_signals];
  node[junction];
  node[railway=subway_entrance];
  node[railway=station];
  node[public_transport=station];
);
out body geom;`;
}
export function contextQuery(b) {
  return `[out:json][timeout:60][bbox:${bboxStr(b)}];
(
  way[building];
  way[leisure~"^(park|garden|playground|pitch)$"];
  way[landuse~"^(grass|cemetery|recreation_ground|forest)$"];
  way[natural~"^(water|wood)$"];
  way[waterway~"^(river|stream|canal)$"];
);
out geom;`;
}

// Overpass 서버에 차례로 물어본다. 실패하면 다음 서버.
export async function fetchOverpass(query, opts = {}) {
  const endpoints = opts.endpoints || OVERPASS_ENDPOINTS;
  const f = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || 70000;
  let lastErr = null;
  for (const url of endpoints) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      if (opts.onStatus) opts.onStatus(`${new URL(url).host} 에 요청 중…`);
      const r = await f(url, { method: 'POST', body: `data=${encodeURIComponent(query)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json || !Array.isArray(json.elements)) throw new Error('응답 형식이 다릅니다');
      if (!json.elements.length && json.remark && /error|timeout|runtime/i.test(json.remark)) throw new Error(json.remark);
      return json;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('Overpass 서버에 연결하지 못했습니다');
}

function walkable(t) {
  const hw = t.highway;
  if (!hw || !WALKABLE.has(hw)) return false;
  if (t.foot === 'no' || t.foot === 'private') return false;
  const footOk = t.foot === 'yes' || t.foot === 'designated' || t.foot === 'permissive';
  if ((t.access === 'no' || t.access === 'private') && !footOk) return false;
  if (hw === 'cycleway' && !footOk && t.segregated == null) return false;
  if (t.indoor === 'yes') return false;
  return true;
}
const isCrossingWay = (w) => w.tags.footway === 'crossing' || w.tags.path === 'crossing' || w.tags.cycleway === 'crossing' || (w.tags.highway === 'footway' && !!w.tags.crossing);
const isSignalTags = (t) => t.crossing === 'traffic_signals' || t['crossing:signals'] === 'yes' || t.highway === 'traffic_signals' || t.crossing === 'pelican' || t.crossing === 'toucan';
const isMarkedTags = (t) => ['marked', 'zebra', 'uncontrolled'].includes(t.crossing) || (t['crossing:markings'] && t['crossing:markings'] !== 'no');

// 횡단보도 시설 정보(잔여시간 표시기, 음향신호기, 보행자 버튼 등). way 와 노드 태그를 모두 본다.
export function crossingFeatures(wayTags, nodeTagsList) {
  const all = [wayTags || {}, ...nodeTagsList];
  const has = (k, ok) => all.some((t) => t[k] != null && ok(String(t[k])));
  return {
    countdown: has('traffic_signals:countdown', (v) => v !== 'no'),
    sound: has('traffic_signals:sound', (v) => v !== 'no'),
    vibration: has('traffic_signals:vibration', (v) => v !== 'no'),
    button: has('button_operated', (v) => v === 'yes'),
    island: has('crossing:island', (v) => v === 'yes'),
    tactile: has('tactile_paving', (v) => v !== 'no'),
  };
}

function crossingKind(wayTags, nodeTagsList) {
  if (isSignalTags(wayTags) || nodeTagsList.some(isSignalTags)) return 'signals';
  if (isMarkedTags(wayTags) || nodeTagsList.some(isMarkedTags)) return 'marked';
  return 'unmarked';
}
const roadWidth = (t) => { const lanes = Number(t.lanes); if (lanes > 0) return Math.min(40, lanes * 3.3); return ROAD_WIDTH[t.highway] || 6; };
const roadName = (t) => t.name || (t.tunnel && t.tunnel !== 'no' && ['footway', 'path', 'steps'].includes(t.highway) ? '지하보도' : CLASS_LABEL[t.highway]) || '길';
const classRank = (hw) => ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'].indexOf((hw || '').replace(/_link$/, ''));

function meanLatLon(ways) {
  let n = 0, lat = 0, lon = 0;
  for (const w of ways) for (const g of w.geometry || []) { lat += g.lat; lon += g.lon; n++; }
  return n ? { lat: lat / n, lon: lon / n } : { lat: 37.5, lon: 127.03 };
}
function hashOffset(id, cycle) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % cycle; }
function legBucket(az) { return az < 45 || az >= 315 ? 'nt' : az < 135 ? 'et' : az < 225 ? 'st' : 'wt'; }

export function buildOsmWorld(net, ctxData, opts = {}) {
  const els = net.elements || [];
  const nodesRaw = new Map();
  const ways = [];
  for (const el of els) {
    if (el.type === 'node') nodesRaw.set(el.id, el);
    else if (el.type === 'way' && el.geometry && el.nodes && el.tags) ways.push(el);
  }
  const roadWays = ways.filter((w) => w.tags.highway);
  const center = opts.center || meanLatLon(roadWays);
  const proj = makeProjection(center.lat, center.lon);
  const coord = new Map();
  for (const w of ways) w.nodes.forEach((id, i) => { if (!coord.has(id) && w.geometry[i]) coord.set(id, proj.toLocal(w.geometry[i].lat, w.geometry[i].lon)); });
  for (const [id, n] of nodesRaw) if (!coord.has(id) && n.lat != null) coord.set(id, proj.toLocal(n.lat, n.lon));
  const tagsOf = (id) => (nodesRaw.get(id) && nodesRaw.get(id).tags) || {};

  const graph = {
    kind: 'osm', proj, nodes: new Map(), edges: [], intersections: new Map(), crossings: new Map(), pois: [], streets: [],
    u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, bounds: null,
    area: { name: opts.name || '실제 지도', note: '지도 데이터 © OpenStreetMap 기여자. 신호 시간은 시뮬레이션입니다.', ew: [] },
    draw: { roads: [], paths: [], buildings: [], green: [], water: [] }, labels: [],
  };
  const nid = (id) => `n${id}`;
  const addNode = (id, label) => {
    const k = nid(id);
    if (!graph.nodes.has(k)) { const c = coord.get(id); if (!c) return null; graph.nodes.set(k, { id: k, x: c.x, y: c.y, kind: 'osm', label: label || '길', osm: id }); }
    return k;
  };
  const addEdge = (a, b, kind, extra = {}) => {
    const e = { id: `e${graph.edges.length}`, a, b, kind, length: dist(graph.nodes.get(a), graph.nodes.get(b)), ...extra };
    graph.edges.push(e);
    return e;
  };

  // 노드 → 지나는 도로 way 목록 (횡단보도가 어느 길을 건너는지, 큰길의 어느 쪽인지 알아내는 데 쓴다)
  const nodeWays = new Map();
  for (const w of roadWays) for (const id of w.nodes) { if (!nodeWays.has(id)) nodeWays.set(id, []); nodeWays.get(id).push(w); }

  // 1) 걸을 수 있는 길 → 보도 간선
  for (const w of roadWays) {
    if (isCrossingWay(w) || !walkable(w.tags)) continue;
    const label = roadName(w.tags);
    const slow = w.tags.highway === 'steps' ? 1.6 : 1;
    for (let i = 0; i + 1 < w.nodes.length; i++) {
      const a = addNode(w.nodes[i], label), b = addNode(w.nodes[i + 1], label);
      if (!a || !b || a === b) continue;
      addEdge(a, b, 'walk', { street: label, hw: w.tags.highway, slow, via: w.tags.tunnel && w.tags.tunnel !== 'no' ? 'tunnel' : undefined, way: w.id });
    }
  }

  // 2) 횡단보도 way → 횡단보도 묶음(group). 신호 유무는 way 태그와 노드 태그를 함께 본다.
  const crossingWayNodeIds = new Set();
  for (const w of roadWays) {
    if (!isCrossingWay(w) || w.nodes.length < 2) continue;
    const kind = crossingKind(w.tags, w.nodes.map(tagsOf));
    const features = crossingFeatures(w.tags, w.nodes.map(tagsOf));
    const ids = w.nodes.map((id) => addNode(id, '횡단보도')).filter(Boolean);
    const edges = []; let length = 0;
    for (let i = 0; i + 1 < ids.length; i++) {
      if (ids[i] === ids[i + 1]) continue;
      const e = addEdge(ids[i], ids[i + 1], 'cross', { way: w.id });
      edges.push(e); length += e.length;
    }
    if (!edges.length) continue;
    w.nodes.forEach((id) => crossingWayNodeIds.add(id));
    let across = null;
    for (const id of w.nodes) for (const r of nodeWays.get(id) || []) if (r !== w && !isCrossingWay(r) && r.tags.highway !== 'footway' && r.tags.highway !== 'path' && r.tags.highway !== 'steps') { if (!across || classRank(r.tags.highway) < classRank(across.tags.highway)) across = r; }
    makeGroup(`c${w.id}`, ids, edges, length, kind, across, features);
  }

  function makeGroup(id, ids, edges, length, kind, across, features) {
    const pts = ids.map((k) => graph.nodes.get(k));
    const mid = chainMidpoint(pts);
    const g = { id, nodes: ids, edges: edges.map((e) => e.id), length, mid, kind, features: features || null, across: across ? roadName(across.tags) : '길', acrossClass: across ? across.tags.highway : null, acrossWidth: across ? roadWidth(across.tags) : 8, intersection: null, leg: null, name: '' };
    const ends = [ids[0], ids[ids.length - 1]];
    for (const e of edges) { e.group = id; e.crossTotal = length; e.groupEnds = ends; e.delay = kind === 'signals' ? 0 : kind === 'marked' ? 4 : 2; e.signal = null; }
    graph.crossings.set(id, g);
    return g;
  }

  // 3) 횡단보도 way 없이 노드로만 표시된 큰길 횡단보도: 양쪽 보도를 찾아 횡단 간선을 만든다
  synthesizeNodeCrossings(graph, nodesRaw, nodeWays, coord, crossingWayNodeIds, addNode, addEdge, makeGroup);

  // 4) 끊긴 보도 끝을 가까운 길에 붙인다
  snapDeadEnds(graph, addEdge);

  // 5) 가장 큰 연결 덩어리만 남긴다
  keepLargestComponent(graph);

  // 6) 신호 횡단보도를 교차로로 묶고 신호 계획을 만든다
  buildIntersections(graph, nodesRaw, coord);

  // 7) 지하철 출입구·역 → 출발/도착 후보
  buildPois(graph, nodesRaw, coord);

  // 8) 그리기 레이어와 도로명
  buildDrawLayers(graph, roadWays, ctxData, proj);

  const xs = [...coord.values()];
  graph.bounds = xs.length
    ? { minX: Math.min(...xs.map((p) => p.x)), maxX: Math.max(...xs.map((p) => p.x)), minY: Math.min(...xs.map((p) => p.y)), maxY: Math.max(...xs.map((p) => p.y)) }
    : { minX: -100, maxX: 100, minY: -100, maxY: 100 };
  graph.stats = { nodes: graph.nodes.size, edges: graph.edges.length, crossings: graph.crossings.size, signalized: [...graph.crossings.values()].filter((g) => g.kind === 'signals').length, intersections: graph.intersections.size, pois: graph.pois.length, buildings: graph.draw.buildings.length };
  return graph;
}

function chainMidpoint(pts) {
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) total += dist(pts[i], pts[i + 1]);
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = dist(pts[i], pts[i + 1]);
    if (acc + d >= total / 2) { const t = d ? (total / 2 - acc) / d : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }; }
    acc += d;
  }
  return pts[0] ? { x: pts[0].x, y: pts[0].y } : { x: 0, y: 0 };
}

function synthesizeNodeCrossings(graph, nodesRaw, nodeWays, coord, crossingWayNodeIds, addNode, addEdge, makeGroup) {
  // 후보: highway=crossing 노드 중 횡단보도 way에 속하지 않고, 걷지 않는 큰길 위에 있는 것
  const cands = [];
  for (const [id, n] of nodesRaw) {
    const t = n.tags || {};
    if (t.highway !== 'crossing' || crossingWayNodeIds.has(id)) continue;
    const roads = (nodeWays.get(id) || []).filter((w) => MAJOR.has(w.tags.highway));
    if (!roads.length || !coord.has(id)) continue;
    const road = roads[0];
    const i = road.nodes.indexOf(id);
    const p0 = coord.get(road.nodes[Math.max(0, i - 1)]), p1 = coord.get(road.nodes[Math.min(road.nodes.length - 1, i + 1)]);
    if (!p0 || !p1) continue;
    const L = dist(p0, p1) || 1;
    cands.push({ id, p: coord.get(id), dir: { x: (p1.x - p0.x) / L, y: (p1.y - p0.y) / L }, tags: t, road });
  }
  const used = new Set();
  const walkNodes = [...graph.nodes.values()];
  for (const c of cands) {
    if (used.has(c.id)) continue;
    // 같은 방향의 큰길 위에 30m 안에 있는 다른 후보(평행 차도)를 하나로 묶는다
    const group = [c];
    for (const o of cands) if (o !== c && !used.has(o.id) && dist(o.p, c.p) <= 30 && Math.abs(o.dir.x * c.dir.x + o.dir.y * c.dir.y) > 0.9) group.push(o);
    const perp = { x: -c.dir.y, y: c.dir.x };
    group.sort((a, b) => (a.p.x * perp.x + a.p.y * perp.y) - (b.p.x * perp.x + b.p.y * perp.y));
    const first = group[0].p, last = group[group.length - 1].p;
    const findSide = (from, sign) => {
      let best = null, bd = Infinity;
      for (const n of walkNodes) {
        const dx = n.x - from.x, dy = n.y - from.y;
        const along = (dx * perp.x + dy * perp.y) * sign, lateral = Math.abs(dx * c.dir.x + dy * c.dir.y);
        if (along < 2 || along > 28 || lateral > 10) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    };
    const endA = findSide(first, -1), endB = findSide(last, 1);
    if (!endA || !endB || endA === endB) continue;
    group.forEach((g) => used.add(g.id));
    const ids = [endA.id, ...group.map((g) => addNode(g.id, '횡단보도')).filter(Boolean), endB.id];
    const edges = []; let length = 0;
    for (let i = 0; i + 1 < ids.length; i++) { const e = addEdge(ids[i], ids[i + 1], 'cross', { synthesized: true }); edges.push(e); length += e.length; }
    const kind = crossingKind({}, group.map((g) => g.tags));
    makeGroup(`x${c.id}`, ids, edges, length, kind, c.road, crossingFeatures({}, group.map((g) => g.tags)));
  }
}

function snapDeadEnds(graph, addEdge) {
  const incident = new Map();
  for (const e of graph.edges) { for (const k of [e.a, e.b]) { if (!incident.has(k)) incident.set(k, []); incident.get(k).push(e); } }
  const ends = [...graph.nodes.values()].filter((n) => (incident.get(n.id) || []).length === 1);
  // 보도 간선 격자 색인(25 m 칸)
  const CELL = 25, grid = new Map();
  const cellKey = (cx, cy) => `${cx},${cy}`;
  const index = (e) => {
    const A = graph.nodes.get(e.a), B = graph.nodes.get(e.b);
    for (let cx = Math.floor(Math.min(A.x, B.x) / CELL); cx <= Math.floor(Math.max(A.x, B.x) / CELL); cx++) {
      for (let cy = Math.floor(Math.min(A.y, B.y) / CELL); cy <= Math.floor(Math.max(A.y, B.y) / CELL); cy++) {
        const k = cellKey(cx, cy); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e);
      }
    }
  };
  for (const e of graph.edges) if (e.kind === 'walk') index(e);
  for (const n of ends) {
    const own = incident.get(n.id)[0];
    let best = null, bd = SNAP_DEAD_END_M, bq = null;
    const seen = new Set();
    for (let cx = Math.floor((n.x - bd) / CELL); cx <= Math.floor((n.x + bd) / CELL); cx++) {
      for (let cy = Math.floor((n.y - bd) / CELL); cy <= Math.floor((n.y + bd) / CELL); cy++) {
        for (const e of grid.get(cellKey(cx, cy)) || []) {
          if (seen.has(e)) continue; seen.add(e);
          if (e === own || e.a === n.id || e.b === n.id) continue;
          if (own && own.way != null && e.way === own.way) continue;
          const r = pointToSegment(n, graph.nodes.get(e.a), graph.nodes.get(e.b));
          if (r.d < bd) { bd = r.d; best = e; bq = r; }
        }
      }
    }
    if (!best) continue;
    // 가까운 길을 투영점에서 나누고 끊긴 끝을 잇는다
    const id = `s${graph.nodes.size}`;
    graph.nodes.set(id, { id, x: bq.q.x, y: bq.q.y, kind: 'osm', label: best.street || '길' });
    const extra = { street: best.street, hw: best.hw, slow: best.slow, via: best.via, way: best.way };
    const bEnd = best.b;
    best.b = id; best.length = dist(graph.nodes.get(best.a), graph.nodes.get(id));
    const tail = addEdge(id, bEnd, 'walk', extra);
    const link = addEdge(n.id, id, 'walk', { street: best.street, hw: best.hw, slow: 1, snapped: true });
    index(tail); index(link);
  }
}

function keepLargestComponent(graph) {
  const adj = new Map();
  for (const e of graph.edges) { (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e.b); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e.a); }
  const seen = new Set(); let bestComp = null;
  for (const start of graph.nodes.keys()) {
    if (seen.has(start)) continue;
    const comp = []; const stack = [start]; seen.add(start);
    while (stack.length) { const n = stack.pop(); comp.push(n); for (const m of adj.get(n) || []) if (!seen.has(m)) { seen.add(m); stack.push(m); } }
    if (!bestComp || comp.length > bestComp.length) bestComp = comp;
  }
  if (!bestComp) return;
  const keep = new Set(bestComp);
  for (const id of [...graph.nodes.keys()]) if (!keep.has(id)) graph.nodes.delete(id);
  graph.edges = graph.edges.filter((e) => keep.has(e.a) && keep.has(e.b));
  graph.edges.forEach((e, i) => { e.id = `e${i}`; });
  const byGroup = new Map();
  for (const e of graph.edges) if (e.group) { if (!byGroup.has(e.group)) byGroup.set(e.group, []); byGroup.get(e.group).push(e); }
  for (const [gid, g] of [...graph.crossings]) {
    const edges = byGroup.get(gid) || [];
    if (!edges.length || !g.nodes.every((n) => keep.has(n))) { graph.crossings.delete(gid); edges.forEach((e) => { e.group = null; }); continue; }
    g.edges = edges.map((e) => e.id);
  }
}

function buildIntersections(graph, nodesRaw, coord) {
  const sig = [...graph.crossings.values()].filter((g) => g.kind === 'signals');
  // union-find: 60m 안의 신호 횡단보도는 같은 교차로
  const parent = new Map(sig.map((g) => [g.id, g.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  for (let i = 0; i < sig.length; i++) for (let j = i + 1; j < sig.length; j++) if (dist(sig[i].mid, sig[j].mid) <= CLUSTER_M) union(sig[i].id, sig[j].id);
  const clusters = new Map();
  for (const g of sig) { const r = find(g.id); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(g); }
  // 이름 후보: junction 노드, 신호등 노드
  const junctions = [];
  for (const [id, n] of nodesRaw) { const t = n.tags || {}; if ((t.junction || t.highway === 'traffic_signals') && t.name && coord.has(id)) junctions.push({ name: t.name, p: coord.get(id) }); }
  for (const groups of clusters.values()) {
    const cx = groups.reduce((s, g) => s + g.mid.x, 0) / groups.length, cy = groups.reduce((s, g) => s + g.mid.y, 0) / groups.length;
    const center = { x: cx, y: cy };
    const id = `i${groups.map((g) => g.id).sort().join('_')}`;
    const legs = {};
    if (groups.length === 1) {
      const g = groups[0];
      legs.xw = { name: LEG_NAMES.xw, across: g.across, length: g.length, crossings: [g.id], acrossClass: g.acrossClass, width: g.acrossWidth };
      g.intersection = id; g.leg = 'xw';
    } else {
      for (const g of groups) {
        const leg = legBucket(bearingDeg(center, g.mid));
        if (!legs[leg]) legs[leg] = { name: LEG_NAMES[leg], across: g.across, length: g.length, crossings: [], acrossClass: g.acrossClass, width: g.acrossWidth };
        legs[leg].crossings.push(g.id);
        legs[leg].length = Math.max(legs[leg].length, g.length);
        g.intersection = id; g.leg = leg;
      }
    }
    const plan = planFor(id, legs);
    let name = null, bd = 70;
    for (const j of junctions) { const d = dist(j.p, center); if (d < bd) { bd = d; name = j.name; } }
    if (!name) {
      const names = [...new Set(groups.map((g) => g.across))];
      name = groups.length === 1 ? `${groups[0].across} 횡단보도` : names.slice(0, 2).join('·');
    }
    graph.intersections.set(id, { id, name, x: cx, y: cy, kind: groups.length === 1 ? 'midblock' : 'osm', legs, plan, itstId: null });
    for (const g of groups) g.name = groups.length === 1 ? name : `${name} ${LEG_NAMES[g.leg]}`;
  }
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  for (const g of graph.crossings.values()) {
    if (!g.name) g.name = `${g.across} ${g.kind === 'marked' ? '횡단보도' : '비신호 횡단'}`;
    if (!g.intersection) continue;
    for (const eid of g.edges) { const e = edgeById.get(eid); if (e) e.signal = { intersection: g.intersection, leg: g.leg }; }
  }
}

function planFor(id, legs) {
  const cls = Object.values(legs).map((l) => l.acrossClass).filter(Boolean);
  const cycle = Math.max(...cls.map((c) => CYCLE_BY_CLASS[c] || 120), 110);
  if (legs.xw) {
    const pg = pedGreenFor(legs.xw.length, cycle - 60);
    const pedPhase = pg + 4;
    return makePlan({ cycle, offset: hashOffset(id, cycle), pedGreen: { xw: pg }, phases: [{ name: '차량 통행', dur: cycle - pedPhase, ped: [] }, { name: '보행', dur: pedPhase, ped: ['xw'] }] });
  }
  const left = cycle >= 150 ? 25 : 20;
  const through = cycle - 2 * left;
  // 북·남 횡단보도는 남북 도로를 건너고, 그 보행 녹색은 동서 직진 현시 때 켜진다
  const wNS = Math.max(legs.nt ? legs.nt.width : 0, legs.st ? legs.st.width : 0) || 10;
  const wEW = Math.max(legs.et ? legs.et.width : 0, legs.wt ? legs.wt.width : 0) || 10;
  const ewThrough = Math.round((through * wEW) / (wEW + wNS));
  const nsThrough = through - ewThrough;
  const pedGreen = {};
  for (const leg of ['nt', 'st']) if (legs[leg]) pedGreen[leg] = pedGreenFor(legs[leg].length, ewThrough);
  for (const leg of ['et', 'wt']) if (legs[leg]) pedGreen[leg] = pedGreenFor(legs[leg].length, nsThrough);
  return makePlan({
    cycle, offset: hashOffset(id, cycle), pedGreen,
    phases: [
      { name: '동서 직진', dur: ewThrough, ped: ['nt', 'st'].filter((l) => legs[l]) },
      { name: '동서 좌회전', dur: left, ped: [] },
      { name: '남북 직진', dur: nsThrough, ped: ['et', 'wt'].filter((l) => legs[l]) },
      { name: '남북 좌회전', dur: left, ped: [] },
    ],
  });
}

function buildPois(graph, nodesRaw, coord) {
  const nodes = [...graph.nodes.values()];
  const stations = [];
  for (const [id, n] of nodesRaw) { const t = n.tags || {}; if ((t.railway === 'station' || t.public_transport === 'station') && t.name && coord.has(id)) stations.push({ name: t.name, p: coord.get(id) }); }
  const nearestNode = (p) => { let best = null, bd = POI_SNAP_M; for (const n of nodes) { const d = dist(n, p); if (d < bd) { bd = d; best = n; } } return best; };
  const seen = new Set();
  const push = (name, p) => { if (!name || seen.has(name)) return; const n = nearestNode(p); if (!n) return; seen.add(name); graph.pois.push({ id: `poi${graph.pois.length}`, name, node: n.id, x: p.x, y: p.y }); };
  for (const [id, n] of nodesRaw) {
    const t = n.tags || {};
    if (t.railway !== 'subway_entrance' || !coord.has(id)) continue;
    const p = coord.get(id);
    let name = t.description || t.name;
    if (!name && t.ref) { let st = null, bd = 400; for (const s of stations) { const d = dist(s.p, p); if (d < bd) { bd = d; st = s; } } name = `${st ? st.name : '지하철'} ${t.ref}번 출구`; }
    push(name, p);
  }
  for (const s of stations) push(s.name, s.p);
  graph.pois.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function buildDrawLayers(graph, roadWays, ctxData, proj) {
  const toPts = (w) => (w.geometry || []).map((g) => proj.toLocal(g.lat, g.lon));
  const seenLabel = [];
  for (const w of roadWays) {
    const t = w.tags; const pts = toPts(w);
    if (pts.length < 2) continue;
    const hw = t.highway;
    if (['footway', 'path', 'steps', 'cycleway', 'bridleway', 'track'].includes(hw)) {
      graph.draw.paths.push({ pts, hw, crossing: isCrossingWay(w), tunnel: !!t.tunnel && t.tunnel !== 'no' });
      continue;
    }
    graph.draw.roads.push({ pts, hw, width: roadWidth(t), name: t.name || '', rank: classRank(hw) });
    if (t.name) {
      // 가장 긴 구간의 중간에 도로명을 둔다. 같은 이름은 250m 안에 하나만.
      let bi = 0, bl = 0;
      for (let i = 0; i + 1 < pts.length; i++) { const l = dist(pts[i], pts[i + 1]); if (l > bl) { bl = l; bi = i; } }
      if (bl < 40) continue;
      const mid = { x: (pts[bi].x + pts[bi + 1].x) / 2, y: (pts[bi].y + pts[bi + 1].y) / 2 };
      if (seenLabel.some((l) => l.name === t.name && dist(l, mid) < 250)) continue;
      const dir = { x: (pts[bi + 1].x - pts[bi].x) / bl, y: (pts[bi + 1].y - pts[bi].y) / bl };
      const rank = classRank(hw);
      const label = { name: t.name, x: mid.x, y: mid.y, dir, minScale: rank <= 3 ? 0.14 : rank <= 4 ? 0.3 : 0.6 };
      seenLabel.push(label); graph.labels.push(label);
    }
  }
  graph.draw.roads.sort((a, b) => b.rank - a.rank);
  if (ctxData) addContext(graph, ctxData);
}

// 건물·공원·물 같은 배경 레이어. 보행 그래프와 따로 받아 나중에 더할 수 있다.
export function addContext(graph, ctxData) {
  const proj = graph.proj;
  graph.draw.buildings = []; graph.draw.green = []; graph.draw.water = [];
  for (const el of (ctxData && ctxData.elements) || []) {
    if (el.type !== 'way' || !el.geometry || !el.tags) continue;
    const pts = el.geometry.map((g) => proj.toLocal(g.lat, g.lon));
    if (pts.length < 3) continue;
    const t = el.tags;
    if (t.building) graph.draw.buildings.push({ pts, name: t.name || '' });
    else if (t.natural === 'water' || t.waterway) graph.draw.water.push({ pts });
    else graph.draw.green.push({ pts });
  }
  if (graph.stats) graph.stats.buildings = graph.draw.buildings.length;
}
