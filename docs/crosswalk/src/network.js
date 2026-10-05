// 데모 지역(강남 테헤란로 일대)의 개략 도로망과 보행 그래프.
// 실제 역 사이 거리를 바탕으로 격자를 잡았고 도로는 직선으로 단순화했다. 신호 시간은 시뮬레이션 값이다.
import { dist, pointToSegment, makeProjection, ORIGIN } from './geo.js';
import { makePlan, pedGreenFor } from './signal.js';

const rad = (d) => (d * Math.PI) / 180;
const SIDE = 3;   // 횡단보도 시작점이 차도 가장자리에서 떨어진 거리(m)
const SUB = 60;   // 보도 구간을 이 길이 이하로 잘라 노드를 둔다(지도 탭 위치 맞추기용)
const EXT = 220;  // 격자 밖으로 도로를 더 그리는 길이(m)
const STAIRS_M = 110; // 지하보도 계단·우회를 걷는 거리로 환산한 값(m). 1.2 m/s로 약 90초.

export const DEMO_AREA = {
  name: '강남 테헤란로 일대',
  note: '실제 역 간 거리를 바탕으로 한 개략도. 신호 시간은 시뮬레이션입니다.',
  ewBearingDeg: 21,      // 동서 도로 방향(동쪽 기준, 북쪽으로 +21°). 테헤란로는 동북동으로 뻗는다.
  nsBearingDeg: 107.5,   // 남북 도로 방향(동쪽 기준). 북북서.
  ew: [
    { id: 'yeoksamro', name: '역삼로', b: -380, width: 24 },
    { id: 'teheranro', name: '테헤란로', b: 0, width: 50 },
    { id: 'bongeunsaro', name: '봉은사로', b: 760, width: 32 },
  ],
  ns: [
    { id: 'gangnamdaero', name: '강남대로', a: 0, width: 50 },
    { id: 'nonhyeonro', name: '논현로', a: 833, width: 30 },
    { id: 'seolleungro', name: '선릉로', a: 2028, width: 30 },
  ],
  // 교차로 사이의 단일로 횡단보도(자체 신호)
  midblocks: [
    { id: 'mb_teheran_w', street: 'teheranro', a: 430, name: '테헤란로 중간 횡단보도 (강남역↔역삼역)' },
    { id: 'mb_teheran_e', street: 'teheranro', a: 1430, name: '테헤란로 중간 횡단보도 (역삼역↔선릉역)' },
    { id: 'mb_bongeunsa', street: 'bongeunsaro', a: 1430, name: '봉은사로 중간 횡단보도 (언주역↔선정릉역)' },
    { id: 'mb_yeoksam', street: 'yeoksamro', a: 430, name: '역삼로 중간 횡단보도' },
  ],
  names: {
    'gangnamdaero|teheranro': '강남역', 'nonhyeonro|teheranro': '역삼역', 'seolleungro|teheranro': '선릉역',
    'gangnamdaero|bongeunsaro': '신논현역', 'nonhyeonro|bongeunsaro': '언주역', 'seolleungro|bongeunsaro': '선정릉역',
    'gangnamdaero|yeoksamro': '강남대로·역삼로', 'nonhyeonro|yeoksamro': '논현로·역삼로', 'seolleungro|yeoksamro': '선릉로·역삼로',
  },
  // 축(동서 도로)별 신호 주기(초)
  cycles: { teheranro: 160, bongeunsaro: 150, yeoksamro: 130 },
  // 지하보도(지하철 통로)로 네 코너가 모두 이어진 교차로. 신호 대기는 없지만 계단만큼 더 걷는다.
  underpasses: ['gangnamdaero|teheranro'],
};

export const LEG_NAMES = { nt: '북쪽 횡단보도', et: '동쪽 횡단보도', st: '남쪽 횡단보도', wt: '서쪽 횡단보도', xw: '횡단보도' };
export const LEG_SHORT = { nt: '북쪽', et: '동쪽', st: '남쪽', wt: '서쪽', xw: '' };

function fourWayPlan(area, ew, ns, legs, a, b) {
  const cycle = area.cycles[ew.id];
  const left = cycle >= 150 ? 25 : 20;
  const through = cycle - 2 * left;
  const ewThrough = Math.round((through * ew.width) / (ew.width + ns.width));
  const nsThrough = through - ewThrough;
  const pedGreen = {
    nt: pedGreenFor(legs.nt.length, ewThrough), st: pedGreenFor(legs.st.length, ewThrough),
    et: pedGreenFor(legs.et.length, nsThrough), wt: pedGreenFor(legs.wt.length, nsThrough),
  };
  // 축 연동(약 50 km/h 진행에 맞춘 옵셋) + 도로별 차이
  const offset = (a / 13.9 + Math.abs(b) * 0.31 + 17) % cycle;
  return makePlan({
    cycle, offset, pedGreen,
    phases: [
      { name: `${ew.name} 직진`, dur: ewThrough, ped: ['nt', 'st'] },
      { name: `${ew.name} 좌회전`, dur: left, ped: [] },
      { name: `${ns.name} 직진`, dur: nsThrough, ped: ['et', 'wt'] },
      { name: `${ns.name} 좌회전`, dur: left, ped: [] },
    ],
  });
}

function midblockPlan(area, ew, leg, a) {
  const cycle = area.cycles[ew.id];
  const pg = pedGreenFor(leg.length, cycle - 60);
  const pedPhase = pg + 4;
  const offset = (a / 13.9 + 71) % cycle;
  return makePlan({
    cycle, offset, pedGreen: { xw: pg },
    phases: [
      { name: '차량 통행', dur: cycle - pedPhase, ped: [] },
      { name: '보행', dur: pedPhase, ped: ['xw'] },
    ],
  });
}

export function buildDemo(area = DEMO_AREA) {
  const u = { x: Math.cos(rad(area.ewBearingDeg)), y: Math.sin(rad(area.ewBearingDeg)) };
  const v = { x: Math.cos(rad(area.nsBearingDeg)), y: Math.sin(rad(area.nsBearingDeg)) };
  const P = (a, b) => ({ x: a * u.x + b * v.x, y: a * u.y + b * v.y });
  const shift = (p, du, dv) => ({ x: p.x + du * u.x + dv * v.x, y: p.y + du * u.y + dv * v.y });

  const nodes = new Map();
  const edges = [];
  const intersections = new Map();
  const crossings = new Map();
  const addNode = (id, p, kind, label) => { nodes.set(id, { id, x: p.x, y: p.y, kind, label }); return id; };
  const addEdge = (a, b, kind, extra = {}) => {
    const e = { id: `e${edges.length}`, a, b, kind, length: dist(nodes.get(a), nodes.get(b)), ...extra };
    edges.push(e);
    return e;
  };
  const walk = (aId, bId, street) => {
    const A = nodes.get(aId), B = nodes.get(bId);
    const n = Math.max(1, Math.ceil(dist(A, B) / SUB));
    let prev = aId;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const id = `${aId}~${bId}~${i}`;
      addNode(id, { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t }, 'sub', `${street.name} 보도`);
      addEdge(prev, id, 'walk', { street: street.id });
      prev = id;
    }
    addEdge(prev, bId, 'walk', { street: street.id });
  };

  // 1) 교차로: 코너 노드 4개 + 횡단보도 4개
  const ewSorted = [...area.ew].sort((p, q) => p.b - q.b);
  const nsSorted = [...area.ns].sort((p, q) => p.a - q.a);
  for (const ew of ewSorted) {
    for (const ns of nsSorted) {
      const id = `${ns.id}|${ew.id}`;
      const name = area.names[id] || `${ns.name}·${ew.name}`;
      const c = P(ns.a, ew.b);
      const hu = ns.width / 2 + SIDE, hv = ew.width / 2 + SIDE;
      const NE = addNode(`${id}#NE`, shift(c, hu, hv), 'corner', `${name} 북동쪽`);
      const NW = addNode(`${id}#NW`, shift(c, -hu, hv), 'corner', `${name} 북서쪽`);
      const SE = addNode(`${id}#SE`, shift(c, hu, -hv), 'corner', `${name} 남동쪽`);
      const SW = addNode(`${id}#SW`, shift(c, -hu, -hv), 'corner', `${name} 남서쪽`);
      const legs = {
        nt: { name: LEG_NAMES.nt, across: ns.name, length: 2 * hu, nodes: [NW, NE] },
        st: { name: LEG_NAMES.st, across: ns.name, length: 2 * hu, nodes: [SW, SE] },
        et: { name: LEG_NAMES.et, across: ew.name, length: 2 * hv, nodes: [NE, SE] },
        wt: { name: LEG_NAMES.wt, across: ew.name, length: 2 * hv, nodes: [NW, SW] },
      };
      const plan = fourWayPlan(area, ew, ns, legs, ns.a, ew.b);
      const it = { id, name, x: c.x, y: c.y, kind: '4way', ew: ew.id, ns: ns.id, legs, plan, corners: { NE, NW, SE, SW }, itstId: null };
      intersections.set(id, it);
      for (const [leg, L] of Object.entries(legs)) {
        const gid = `${id}:${leg}`;
        const e = addEdge(L.nodes[0], L.nodes[1], 'cross', { signal: { intersection: id, leg }, group: gid, delay: 0, groupEnds: [L.nodes[0], L.nodes[1]] });
        e.crossTotal = e.length;
        L.edge = e.id; L.crossings = [gid];
        const A = nodes.get(L.nodes[0]), B = nodes.get(L.nodes[1]);
        crossings.set(gid, { id: gid, nodes: [...L.nodes], edges: [e.id], length: e.length, mid: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, kind: 'signals', across: L.across, intersection: id, leg, name: `${name} ${L.name}` });
      }
      if ((area.underpasses || []).includes(id)) {
        it.underpass = true;
        const cs = [NE, NW, SW, SE];
        for (let i = 0; i < cs.length; i++) {
          for (let j = i + 1; j < cs.length; j++) {
            const e = addEdge(cs[i], cs[j], 'walk', { via: 'underpass', street: ns.id, intersection: id });
            e.length += STAIRS_M;
          }
        }
      }
    }
  }

  // 2) 동서 도로의 양측 보도(중간 횡단보도가 있으면 거기서 끊는다)
  for (const ew of ewSorted) {
    for (let i = 0; i + 1 < nsSorted.length; i++) {
      const I1 = intersections.get(`${nsSorted[i].id}|${ew.id}`);
      const I2 = intersections.get(`${nsSorted[i + 1].id}|${ew.id}`);
      const mbs = area.midblocks
        .filter((m) => m.street === ew.id && m.a > nsSorted[i].a && m.a < nsSorted[i + 1].a)
        .sort((p, q) => p.a - q.a);
      let prevN = I1.corners.NE, prevS = I1.corners.SE;
      for (const mb of mbs) {
        const c = P(mb.a, ew.b);
        const hv = ew.width / 2 + SIDE;
        const N = addNode(`${mb.id}#N`, shift(c, 0, hv), 'mid', `${mb.name} 북측`);
        const S = addNode(`${mb.id}#S`, shift(c, 0, -hv), 'mid', `${mb.name} 남측`);
        walk(prevN, N, ew); walk(prevS, S, ew);
        const leg = { name: LEG_NAMES.xw, across: ew.name, length: 2 * hv, nodes: [N, S], crossings: [`${mb.id}:xw`] };
        const it = { id: mb.id, name: mb.name, x: c.x, y: c.y, kind: 'midblock', ew: ew.id, legs: { xw: leg }, plan: midblockPlan(area, ew, leg, mb.a), itstId: null };
        intersections.set(mb.id, it);
        const ce = addEdge(N, S, 'cross', { signal: { intersection: mb.id, leg: 'xw' }, group: `${mb.id}:xw`, delay: 0, groupEnds: [N, S] });
        ce.crossTotal = ce.length; leg.edge = ce.id;
        crossings.set(`${mb.id}:xw`, { id: `${mb.id}:xw`, nodes: [N, S], edges: [ce.id], length: ce.length, mid: { x: c.x, y: c.y }, kind: 'signals', across: ew.name, intersection: mb.id, leg: 'xw', name: mb.name });
        prevN = N; prevS = S;
      }
      walk(prevN, I2.corners.NW, ew); walk(prevS, I2.corners.SW, ew);
    }
  }

  // 3) 남북 도로의 양측 보도
  for (const ns of nsSorted) {
    for (let i = 0; i + 1 < ewSorted.length; i++) {
      const I1 = intersections.get(`${ns.id}|${ewSorted[i].id}`);      // 남쪽 교차로
      const I2 = intersections.get(`${ns.id}|${ewSorted[i + 1].id}`);  // 북쪽 교차로
      walk(I1.corners.NE, I2.corners.SE, ns);
      walk(I1.corners.NW, I2.corners.SW, ns);
    }
  }

  // 4) 그리기용 도로 띠
  const streets = [];
  const aMin = nsSorted[0].a - EXT, aMax = nsSorted[nsSorted.length - 1].a + EXT;
  const bMin = ewSorted[0].b - EXT, bMax = ewSorted[ewSorted.length - 1].b + EXT;
  for (const ew of ewSorted) streets.push({ id: ew.id, name: ew.name, width: ew.width, kind: 'ew', from: P(aMin, ew.b), to: P(aMax, ew.b) });
  for (const ns of nsSorted) streets.push({ id: ns.id, name: ns.name, width: ns.width, kind: 'ns', from: P(ns.a, bMin), to: P(ns.a, bMax) });

  const xs = [...nodes.values()].map((n) => n.x), ys = [...nodes.values()].map((n) => n.y);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };

  const pois = [...intersections.values()].filter((it) => it.kind === '4way').map((it) => ({ id: it.id, name: it.name, node: it.corners.SW }));

  return { kind: 'schematic', proj: makeProjection(ORIGIN.lat, ORIGIN.lon), area, nodes, edges, intersections, crossings, streets, bounds, pois, u, v, draw: null, labels: [] };
}

export function nearestNode(graph, p) {
  let best = null, bd = Infinity;
  for (const n of graph.nodes.values()) {
    const d = dist(n, p);
    if (d < bd) { bd = d; best = n; }
  }
  return best ? { node: best, d: bd } : null;
}

// 가장 가까운 횡단보도(묶음). 간선 하나가 아니라 횡단보도 전체(group)를 돌려준다.
export function nearestCrossing(graph, p, maxDist) {
  let best = null, bd = Infinity;
  for (const e of graph.edges) {
    if (e.kind !== 'cross' || !e.group) continue;
    const { d } = pointToSegment(p, graph.nodes.get(e.a), graph.nodes.get(e.b));
    if (d < bd) { bd = d; best = e; }
  }
  return best && bd <= maxDist ? { edge: best, group: graph.crossings.get(best.group), d: bd } : null;
}

export function crossingName(graph, edgeOrGroup) {
  const g = edgeOrGroup.group ? graph.crossings.get(edgeOrGroup.group) : edgeOrGroup;
  return g ? g.name : '횡단보도';
}
