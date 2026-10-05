import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOsmWorld, networkQuery, contextQuery, bboxAround, fetchOverpass } from '../src/osm.js';
import { legState, nextGreenStart } from '../src/signal.js';
import { adjacency, compare, crossingOrderNotes } from '../src/routing.js';
import { nearestCrossing } from '../src/network.js';
import { makeFixture } from './fixtures/make-osm-fixture.mjs';

const fx = makeFixture();
const g = buildOsmWorld(fx.network, fx.context, { center: fx.center, name: '테스트' });
const hasOsm = (x, y) => g.nodes.has(`n${fx.nodeAt(x, y)}`);
const adj = adjacency(g);
const ctx = {
  speed: 1.2, margin: 2,
  signal: (iid, leg, t) => legState(g.intersections.get(iid).plan, leg, t),
  nextGreen: (iid, leg, t) => nextGreenStart(g.intersections.get(iid).plan, leg, t),
};

test('Overpass 질의: bbox 와 필요한 요소를 담고 고속도로는 뺀다', () => {
  const q = networkQuery(bboxAround(37.5, 127.03, 500));
  assert.match(q, /\[bbox:37\.4954\d+,127\.0243\d+,37\.5045\d+,127\.0356\d+\]/);
  assert.ok(q.includes('node[highway=crossing]') && q.includes('railway=subway_entrance') && q.includes('!~"^(motorway'));
  assert.ok(contextQuery(bboxAround(37.5, 127.03, 500)).includes('way[building]'));
});

test('큰길 차도 노드는 걷지 않고, 보도·골목·지하보도·계단은 걷는다', () => {
  assert.equal(hasOsm(-400, 10), false);
  assert.equal(hasOsm(0, 10), false);
  assert.equal(hasOsm(-400, 22), true);
  assert.equal(hasOsm(150, 300), true);
  assert.ok(g.edges.some((e) => e.via === 'tunnel'));
  assert.ok(g.edges.some((e) => e.slow === 1.6));
  assert.equal(hasOsm(300, 120), false); // 자전거 전용
  assert.equal(hasOsm(400, 120), false); // 사유지
});

test('횡단보도 묶음: 신호 5개(사거리 4 + 합성 1), 비신호 1개', () => {
  const groups = [...g.crossings.values()];
  assert.equal(groups.length, 6);
  assert.equal(groups.filter((x) => x.kind === 'signals').length, 5);
  const marked = groups.find((x) => x.kind === 'marked');
  assert.ok(marked);
  for (const eid of marked.edges) { const e = g.edges.find((x) => x.id === eid); assert.equal(e.delay, 4); assert.equal(e.signal, null); }
  assert.equal(marked.across, '뒷골목');
});

test('사거리: 네 방향 횡단보도가 한 교차로로 묶이고 이름은 junction 노드에서 온다', () => {
  const it = [...g.intersections.values()].find((i) => i.kind === 'osm');
  assert.ok(it);
  assert.equal(it.name, '테스트사거리');
  assert.deepEqual(Object.keys(it.legs).sort(), ['et', 'nt', 'st', 'wt']);
  assert.equal(it.legs.et.across, '큰길');
  assert.equal(it.legs.nt.across, '세로길');
  assert.equal(it.plan.phases.length, 4);
  assert.ok(it.plan.pedGreen.et >= 40 && it.plan.pedGreen.nt >= 20);
  const west = g.crossings.get(it.legs.wt.crossings[0]);
  assert.equal(west.kind, 'signals'); // way 태그
  const east = g.crossings.get(it.legs.et.crossings[0]);
  assert.equal(east.kind, 'signals'); // 노드 태그만으로 판정
  assert.equal(east.name, '테스트사거리 동쪽 횡단보도');
});

test('노드로만 표시된 큰길 횡단보도를 양쪽 보도에 이어 만든다', () => {
  const x = [...g.crossings.values()].find((c) => c.id.startsWith('x'));
  assert.ok(x, '합성 횡단보도 없음');
  assert.equal(x.kind, 'signals');
  assert.equal(x.edges.length, 3);
  assert.ok(Math.abs(x.length - 44) < 1);
  assert.ok(x.nodes.includes(`n${fx.nodeAt(250, 22)}`) && x.nodes.includes(`n${fx.nodeAt(250, -22)}`));
  const it = g.intersections.get(x.intersection);
  assert.equal(it.kind, 'midblock');
  assert.equal(it.name, '큰길 횡단보도');
  assert.equal(it.plan.phases.length, 2);
});

test('끊긴 보도 끝을 가까운 골목에 붙여 연결한다', () => {
  assert.equal(hasOsm(-300, 66), true, '윗골목이 떨어져 나갔습니다');
  const end = `n${fx.nodeAt(-200, 60)}`;
  assert.ok(g.edges.some((e) => e.snapped && (e.a === end || e.b === end)));
});

test('지하철 출입구와 역이 출발·도착 후보가 된다', () => {
  const names = g.pois.map((p) => p.name);
  assert.deepEqual(names, ['테스트역', '테스트역 1번 출구', '테스트역 2번 출구']);
  for (const p of g.pois) assert.ok(g.nodes.has(p.node));
});

test('모든 노드가 한 덩어리로 이어져 있고 경로 비교가 된다', () => {
  const seen = new Set(); const q = [g.nodes.keys().next().value]; seen.add(q[0]);
  while (q.length) { const n = q.pop(); for (const { to } of adj.get(n)) if (!seen.has(to)) { seen.add(to); q.push(to); } }
  assert.equal(seen.size, g.nodes.size);
  const from = g.pois.find((p) => p.name === '테스트역 2번 출구').node, to = g.pois.find((p) => p.name === '테스트역 1번 출구').node;
  let crossedSignal = 0, usedTunnel = 0;
  for (let t0 = 0; t0 < 300; t0 += 20) {
    const c = compare(g, adj, from, to, t0, ctx);
    assert.ok(c && c.fast.time > 0 && c.fast.time <= c.dist.time + 1e-6);
    if (c.fast.steps.some((s) => s.kind === 'cross' && s.edge.signal)) crossedSignal++;
    if (c.fast.edges.some((e) => e.via === 'tunnel')) usedTunnel++;
  }
  assert.ok(crossedSignal + usedTunnel > 0);
});

test('가까운 횡단보도 찾기는 묶음을 돌려준다', () => {
  const hit = nearestCrossing(g, { x: 30, y: 0 }, 10);
  assert.ok(hit && hit.group && hit.group.leg === 'et');
});

test('그리기 레이어: 도로 폭·건물·공원·도로명', () => {
  const primary = g.draw.roads.find((r) => r.hw === 'primary');
  assert.ok(Math.abs(primary.width - 13.2) < 1e-9);
  assert.equal(g.draw.buildings.length, 2);
  assert.equal(g.draw.green.length, 1);
  assert.deepEqual(g.labels.map((l) => l.name).sort(), ['뒷골목', '세로길', '윗골목', '큰길']);
  assert.equal(g.stats.signalized, 5);
});

test('fetchOverpass: 첫 서버가 실패하면 다음 서버를 쓴다', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); if (calls.length === 1) throw new Error('down'); return { ok: true, json: async () => ({ elements: [] }) }; };
  const r = await fetchOverpass('x', { endpoints: ['https://a/x', 'https://b/x'], fetchImpl });
  assert.deepEqual(r, { elements: [] });
  assert.equal(calls.length, 2);
});

test('횡단 순서 안내: 여러 간선으로 된 횡단보도도 하나로 보고, 같은 교차로의 두 횡단보도만 짝짓는다', () => {
  const from = `n${fx.nodeAt(-12, -30)}`, to = `n${fx.nodeAt(30, 22)}`; // 남서 코너 → 북동 코너
  let sawNote = false;
  for (let t0 = 0; t0 < 320; t0 += 16) {
    const c = compare(g, adj, from, to, t0, ctx);
    const notes = crossingOrderNotes(g, c.fast, ctx, adj);
    for (const n of notes) {
      assert.notEqual(n.first, n.altFirst);
      assert.ok(n.diff >= -1e-6 && n.diff < 400, `diff ${n.diff}`);
      sawNote = true;
    }
    assert.ok(notes.length <= 1);
  }
  assert.ok(sawNote, '안내가 한 번도 나오지 않았습니다');
});
