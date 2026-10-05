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

// 간선 하나를 t초에 from 노드에서 진입할 때의 통과 결과. ctx = {speed, margin, signal(iid, leg, t), nextGreen(iid, leg, t)}
// 횡단보도 하나가 여러 간선(연석-차선-연석)으로 되어 있으면, 연석(groupEnds)에서 건너기 시작할 때만 신호를 보고
// 그때 '횡단보도 전체 길이'를 다 건널 수 있는지 판단한다. 이미 차도 위에 있으면 멈추지 않고 이어 건넌다.
export function traverseEdge(e, t, ctx, from) {
  const walkSec = (e.length / ctx.speed) * (e.slow || 1);
  if (e.kind !== 'cross') return { tExit: t + walkSec, wait: 0, walkSec };
  const starting = !e.groupEnds || from === undefined || e.groupEnds.includes(from);
  if (!starting) return { tExit: t + walkSec, wait: 0, walkSec, crossAt: t, committed: true };
  if (!e.signal) {
    // 신호 없는 횡단보도(마킹만 있거나 없는 곳): 차를 살피는 시간만큼 고정 지연
    const d = e.delay || 0;
    return { tExit: t + d + walkSec, wait: d, walkSec, crossAt: t + d, signal: { state: 'none', remain: 0 } };
  }
  const { intersection, leg } = e.signal;
  const s = ctx.signal(intersection, leg, t);
  const need = (e.crossTotal || e.length) / ctx.speed;
  // 보수적 규칙: 남은 녹색 시간 안에 여유(margin)를 두고 횡단보도 전체를 다 건널 수 있을 때만 바로 건넌다.
  if (s.state !== 'red' && s.remain >= need + ctx.margin) {
    return { tExit: t + walkSec, wait: 0, walkSec, crossAt: t, signal: s };
  }
  const g = ctx.nextGreen(intersection, leg, t);
  return { tExit: g + walkSec, wait: g - t, walkSec, crossAt: g, signal: s };
}

// 일반 다익스트라. costFn(edge, tArrive) → tExit(단조증가). opts.skipEdge / opts.allowNode 로 탐색을 제한할 수 있다.
function dijkstra(graph, adj, from, to, t0, costFn, opts = {}) {
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
    for (const { e, to: m } of adj.get(n) || []) {
      if (done.has(m)) continue;
      if (opts.skipEdges && opts.skipEdges.has(e)) continue;
      if (opts.allowNode && !opts.allowNode(m)) continue;
      const tx = costFn(e, t, n);
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

export function shortestTime(graph, adj, from, to, t0, ctx, opts) {
  return dijkstra(graph, adj, from, to, t0, (e, t, n) => traverseEdge(e, t, ctx, n).tExit, opts);
}

// 경로(간선 순서)를 t0에 출발해 실제로 걸었을 때의 시간표
export function evaluate(graph, edgesPath, from, t0, ctx) {
  let t = t0, cur = from, length = 0, wait = 0, walk = 0;
  const steps = [];
  for (const e of edgesPath) {
    const next = e.a === cur ? e.b : e.a;
    const r = traverseEdge(e, t, ctx, cur);
    const step = { edge: e, from: cur, to: next, kind: e.kind, tArrive: t, tExit: r.tExit, wait: r.wait, length: e.length, walkSec: r.walkSec };
    if (e.kind === 'cross') {
      step.intersection = e.signal.intersection; step.leg = e.signal.leg; step.crossAt = r.crossAt; step.signalAtArrival = r.signal;
    }
    steps.push(step);
    length += e.length; wait += r.wait; walk += r.walkSec; t = r.tExit; cur = next;
  }
  return { edges: edgesPath, nodes: [from, ...steps.map((s) => s.to)], steps, length, wait, walk, time: t - t0, arrival: t, t0 };
}

// 한 교차로에서 횡단보도를 두 번 건너는 구간: 첫 횡단보도를 다른 쪽으로 바꾸면 얼마나 더 걸리는지.
// 횡단보도 하나가 여러 간선(연석-차도-연석)으로 되어 있어도 묶음(group) 단위로 본다.
// 교차로 주변(반경 90m)만 보고, 처음 건넌 횡단보도를 빼고 다시 최단시간을 구해 비교한다.
export function crossingOrderNotes(graph, route, ctx, adj) {
  const notes = [];
  const steps = route.steps;
  adj = adj || adjacency(graph);
  const groupOf = (s) => (s && s.kind === 'cross' && s.edge.signal ? (s.edge.group || s.edge.id) : null);
  let i = 0;
  while (i < steps.length) {
    const g1 = groupOf(steps[i]);
    if (!g1) { i++; continue; }
    let e1 = i;
    while (e1 + 1 < steps.length && groupOf(steps[e1 + 1]) === g1) e1++;
    // 같은 교차로의 다음 횡단보도를 짧은 보도(합계 40m 이하)만 지나 만나야 한다
    let walked = 0, j = e1 + 1;
    while (j < steps.length && steps[j].kind !== 'cross' && walked <= 40) { walked += steps[j].length; j++; }
    const g2 = groupOf(steps[j]);
    if (!g2 || g2 === g1 || walked > 40 || steps[j].intersection !== steps[i].intersection) { i = e1 + 1; continue; }
    let e2 = j;
    while (e2 + 1 < steps.length && groupOf(steps[e2 + 1]) === g2) e2++;
    const it = graph.intersections.get(steps[i].intersection);
    if (!it) { i = e1 + 1; continue; }
    const near = (id) => { const n = graph.nodes.get(id); return n && Math.hypot(n.x - it.x, n.y - it.y) <= 90; };
    const skip = new Set(graph.edges.filter((e) => (e.group || e.id) === g1));
    const alt = shortestTime(graph, adj, steps[i].from, steps[e2].to, steps[i].tArrive, ctx, { skipEdges: skip, allowNode: near });
    if (alt) {
      const firstCross = alt.edges.find((e) => e.kind === 'cross' && e.signal && e.signal.intersection === it.id);
      if (firstCross && (firstCross.group || firstCross.id) !== g1) {
        notes.push({ intersection: it.id, name: it.name, first: steps[i].leg, second: steps[j].leg, altFirst: firstCross.signal.leg, diff: alt.arrival - steps[e2].tExit });
      }
    }
    i = e2 + 1;
  }
  return notes;
}

// 지금 출발했을 때와 같은 시각에 도착하는 가장 늦은 출발(초). 신호 때문에 서둘러 나갈 필요가 없는 여유.
export function latestDeparture(graph, adj, from, to, t0, ctx, horizon = 150, step = 10) {
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
    notes: crossingOrderNotes(graph, fastRoute, ctx, adj),
    slack: latestDeparture(graph, adj, from, to, t0, ctx),
  };
}
