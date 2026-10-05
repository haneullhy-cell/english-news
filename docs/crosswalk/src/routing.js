// 시간 의존 최단경로. 보도 간선은 거리/속도, 횡단보도 간선은 도착 시각의 신호 상태에 따라 대기 시간이 붙는다.
// 도착이 늦을수록 통과도 늦어지는(FIFO) 성질이 있어 다익스트라를 그대로 쓸 수 있다.

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].k <= a[i].k) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export function adjacency(graph) {
  const adj = new Map();
  for (const id of graph.nodes.keys()) adj.set(id, []);
  for (const e of graph.edges) { adj.get(e.a).push({ e, to: e.b }); adj.get(e.b).push({ e, to: e.a }); }
  return adj;
}

// 간선 하나를 t초에 진입할 때의 통과 결과. ctx = {speed, margin, signal(iid, leg, t), nextGreen(iid, leg, t)}
export function traverseEdge(e, t, ctx) {
  const walkSec = e.length / ctx.speed;
  if (e.kind !== 'cross') return { tExit: t + walkSec, wait: 0, walkSec };
  const { intersection, leg } = e.signal;
  const s = ctx.signal(intersection, leg, t);
  // 보수적 규칙: 남은 녹색 시간 안에 여유(margin)를 두고 다 건널 수 있을 때만 바로 건넌다.
  if (s.state !== 'red' && s.remain >= walkSec + ctx.margin) {
    return { tExit: t + walkSec, wait: 0, walkSec, crossAt: t, signal: s };
  }
  const g = ctx.nextGreen(intersection, leg, t);
  return { tExit: g + walkSec, wait: g - t, walkSec, crossAt: g, signal: s };
}

// 일반 다익스트라. costFn(edge, tArrive) → tExit(단조증가).
function dijkstra(graph, adj, from, to, t0, costFn) {
  const best = new Map([[from, t0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push(t0, from);
  const done = new Set();
  while (heap.size) {
    const { k: t, v: n } = heap.pop();
    if (done.has(n)) continue;
    done.add(n);
    if (n === to) break;
    for (const { e, to: m } of adj.get(n)) {
      if (done.has(m)) continue;
      const tx = costFn(e, t);
      if (tx < (best.get(m) ?? Infinity)) { best.set(m, tx); prev.set(m, { n, e }); heap.push(tx, m); }
    }
  }
  if (!best.has(to)) return null;
  const nodesPath = [to], edgesPath = [];
  let cur = to;
  while (cur !== from) { const p = prev.get(cur); edgesPath.push(p.e); cur = p.n; nodesPath.push(cur); }
  return { nodes: nodesPath.reverse(), edges: edgesPath.reverse(), arrival: best.get(to) };
}

export function shortestDistance(graph, adj, from, to) {
  const r = dijkstra(graph, adj, from, to, 0, (e, t) => t + e.length);
  return r && { ...r, length: r.arrival };
}

export function shortestTime(graph, adj, from, to, t0, ctx) {
  return dijkstra(graph, adj, from, to, t0, (e, t) => traverseEdge(e, t, ctx).tExit);
}

// 경로(간선 순서)를 t0에 출발해 실제로 걸었을 때의 시간표
export function evaluate(graph, edgesPath, from, t0, ctx) {
  let t = t0, cur = from, length = 0, wait = 0, walk = 0;
  const steps = [];
  for (const e of edgesPath) {
    const next = e.a === cur ? e.b : e.a;
    const r = traverseEdge(e, t, ctx);
    const step = { edge: e, from: cur, to: next, kind: e.kind, tArrive: t, tExit: r.tExit, wait: r.wait, length: e.length, walkSec: r.walkSec };
    if (e.kind === 'cross') {
      step.intersection = e.signal.intersection; step.leg = e.signal.leg; step.crossAt = r.crossAt; step.signalAtArrival = r.signal;
    }
    steps.push(step);
    length += e.length; wait += r.wait; walk += r.walkSec; t = r.tExit; cur = next;
  }
  return { edges: edgesPath, nodes: [from, ...steps.map((s) => s.to)], steps, length, wait, walk, time: t - t0, arrival: t, t0 };
}

// 두 횡단보도를 연달아 건너는 교차로에서 '어느 쪽을 먼저 건너는지'가 얼마나 차이 나는지
export function crossingOrderNotes(graph, route, ctx) {
  const notes = [];
  const edgeBetween = (a, b) => graph.edges.find((e) => e.kind === 'cross' && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
  for (let i = 0; i + 1 < route.steps.length; i++) {
    const s1 = route.steps[i], s2 = route.steps[i + 1];
    if (s1.kind !== 'cross' || s2.kind !== 'cross' || s1.intersection !== s2.intersection) continue;
    const it = graph.intersections.get(s1.intersection);
    if (it.kind !== '4way') continue;
    const corners = Object.values(it.corners);
    const other = corners.find((c) => c !== s1.from && c !== s1.to && c !== s2.to);
    const e1 = edgeBetween(s1.from, other), e2 = edgeBetween(other, s2.to);
    if (!e1 || !e2) continue;
    const r1 = traverseEdge(e1, s1.tArrive, ctx);
    const r2 = traverseEdge(e2, r1.tExit, ctx);
    const diff = r2.tExit - s2.tExit; // 다른 순서가 얼마나 더 걸리는지(≥0)
    notes.push({ intersection: it.id, name: it.name, first: s1.leg, second: s2.leg, altFirst: e1.signal.leg, altSecond: e2.signal.leg, diff });
  }
  return notes;
}

// 지금 출발했을 때와 같은 시각에 도착하는 가장 늦은 출발(초). 신호 때문에 서둘러 나갈 필요가 없는 여유.
export function latestDeparture(graph, adj, from, to, t0, ctx, horizon = 180, step = 5) {
  const base = shortestTime(graph, adj, from, to, t0, ctx);
  if (!base) return 0;
  let ok = 0;
  for (let d = step; d <= horizon; d += step) {
    const r = shortestTime(graph, adj, from, to, t0 + d, ctx);
    if (!r || r.arrival > base.arrival + 1) break;
    ok = d;
  }
  return ok;
}

export function compare(graph, adj, from, to, t0, ctx) {
  const d = shortestDistance(graph, adj, from, to);
  const f = shortestTime(graph, adj, from, to, t0, ctx);
  if (!d || !f) return null;
  const distRoute = evaluate(graph, d.edges, from, t0, ctx);
  const fastRoute = evaluate(graph, f.edges, from, t0, ctx);
  const sameRoute = distRoute.edges.length === fastRoute.edges.length && distRoute.edges.every((e, i) => e === fastRoute.edges[i]);
  return {
    from, to, t0,
    dist: distRoute, fast: fastRoute, sameRoute,
    saving: distRoute.time - fastRoute.time,
    extraDist: fastRoute.length - distRoute.length,
    notes: crossingOrderNotes(graph, fastRoute, ctx),
    slack: latestDeparture(graph, adj, from, to, t0, ctx),
  };
}
