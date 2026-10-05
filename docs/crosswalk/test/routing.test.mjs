import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemo } from '../src/network.js';
import { legState, nextGreenStart } from '../src/signal.js';
import { adjacency, traverseEdge, shortestDistance, shortestTime, evaluate, compare } from '../src/routing.js';

const g = buildDemo();
const adj = adjacency(g);
const ctx = {
  speed: 1.2, margin: 2,
  signal: (iid, leg, t) => legState(g.intersections.get(iid).plan, leg, t),
  nextGreen: (iid, leg, t) => nextGreenStart(g.intersections.get(iid).plan, leg, t),
};
const FROM = 'gangnamdaero|teheranro#SW', TO = 'nonhyeonro|bongeunsaro#NE';

test('횡단보도: 녹색 잔여가 충분하면 바로, 아니면 다음 녹색까지 기다린다', () => {
  const it = g.intersections.get('gangnamdaero|teheranro');
  const e = g.edges.find((x) => x.id === it.legs.nt.edge);
  const need = e.length / ctx.speed;
  let sawGo = false, sawWait = false;
  for (let t = 0; t < 320; t += 1) {
    const s = legState(it.plan, 'nt', t);
    const r = traverseEdge(e, t, ctx);
    if (s.state !== 'red' && s.remain >= need + 2) { assert.equal(r.wait, 0); sawGo = true; }
    else { assert.ok(r.wait > 0); assert.equal(legState(it.plan, 'nt', r.crossAt + 0.01).state, 'green'); sawWait = true; }
  }
  assert.ok(sawGo && sawWait);
});

test('FIFO: 늦게 도착하면 통과도 늦거나 같다', () => {
  const e = g.edges.find((x) => x.kind === 'cross');
  let prev = -Infinity;
  for (let t = 0; t < 500; t += 0.7) {
    const r = traverseEdge(e, t, ctx);
    assert.ok(r.tExit >= prev - 1e-9);
    prev = r.tExit;
  }
});

test('최단시간 경로는 최단거리 경로보다 느리지 않다', () => {
  for (const t0 of [0, 37, 91, 140, 777]) {
    const c = compare(g, adj, FROM, TO, t0, ctx);
    assert.ok(c.fast.time <= c.dist.time + 1e-6, `t0=${t0}: fast ${c.fast.time} dist ${c.dist.time}`);
    assert.ok(c.fast.length >= c.dist.length - 1e-6);
    assert.ok(c.fast.nodes[0] === FROM && c.fast.nodes.at(-1) === TO);
  }
});

test('경로 평가: 보행시간 + 대기시간 = 총 시간', () => {
  const r = shortestTime(g, adj, FROM, TO, 100, ctx);
  const ev = evaluate(g, r.edges, FROM, 100, ctx);
  assert.ok(Math.abs(ev.walk + ev.wait - ev.time) < 1e-6);
  assert.ok(Math.abs(ev.arrival - r.arrival) < 1e-6);
  assert.ok(ev.length > 1000 && ev.length < 2500);
});

test('어느 시각엔가는 신호를 고려한 경로가 거리만 본 경로보다 빨라진다', () => {
  let best = 0;
  for (let t0 = 0; t0 < 160; t0 += 4) best = Math.max(best, compare(g, adj, FROM, TO, t0, ctx).saving);
  assert.ok(best > 20, `best saving ${best}`);
});

test('같은 지점이면 빈 경로', () => {
  const d = shortestDistance(g, adj, FROM, FROM);
  assert.equal(d.edges.length, 0);
});
