import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemo, nearestCrossing, nearestNode } from '../src/network.js';
import { adjacency } from '../src/routing.js';

test('데모 도로망: 교차로 9개 + 중간 횡단보도 4개, 횡단보도 간선 40개', () => {
  const g = buildDemo();
  const its = [...g.intersections.values()];
  assert.equal(its.filter((i) => i.kind === '4way').length, 9);
  assert.equal(its.filter((i) => i.kind === 'midblock').length, 4);
  assert.equal(g.edges.filter((e) => e.kind === 'cross').length, 9 * 4 + 4);
});

test('모든 노드가 서로 이어져 있다', () => {
  const g = buildDemo();
  const adj = adjacency(g);
  const start = g.nodes.keys().next().value;
  const seen = new Set([start]); const q = [start];
  while (q.length) { const n = q.pop(); for (const { to } of adj.get(n)) if (!seen.has(to)) { seen.add(to); q.push(to); } }
  assert.equal(seen.size, g.nodes.size);
});

test('횡단보도 길이는 건너는 도로 폭 + 6m', () => {
  const g = buildDemo();
  const it = g.intersections.get('gangnamdaero|teheranro');
  assert.ok(Math.abs(it.legs.nt.length - 56) < 1e-6); // 강남대로 50m
  assert.ok(Math.abs(it.legs.et.length - 56) < 1e-6); // 테헤란로 50m
  const y = g.intersections.get('nonhyeonro|yeoksamro');
  assert.ok(Math.abs(y.legs.et.length - 30) < 1e-6); // 역삼로 24m
  assert.ok(Math.abs(y.legs.nt.length - 36) < 1e-6); // 논현로 30m
});

test('역 사이 거리가 실제와 비슷하다(강남역↔역삼역 약 830m)', () => {
  const g = buildDemo();
  const a = g.intersections.get('gangnamdaero|teheranro'), b = g.intersections.get('nonhyeonro|teheranro');
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d > 800 && d < 860, `distance ${d}`);
});

test('가까운 횡단보도·노드 찾기', () => {
  const g = buildDemo();
  const it = g.intersections.get('nonhyeonro|teheranro');
  const n1 = g.nodes.get(it.legs.nt.nodes[0]), n2 = g.nodes.get(it.legs.nt.nodes[1]);
  const mid = { x: (n1.x + n2.x) / 2 + 1, y: (n1.y + n2.y) / 2 + 1 };
  const hit = nearestCrossing(g, mid, 10);
  assert.equal(hit.edge.signal.leg, 'nt');
  assert.equal(nearestNode(g, n1).node.id, n1.id);
});
