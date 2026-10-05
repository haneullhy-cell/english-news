// 실제 OpenStreetMap 데이터(대전 시청역 주변, 2026-10-05)로 그래프 생성과 경로를 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOsmWorld } from '../src/osm.js';
import { legState, nextGreenStart } from '../src/signal.js';
import { adjacency, compare, evaluate } from '../src/routing.js';

const net = JSON.parse(fs.readFileSync(new URL('./fixtures/daejeon-cityhall.json', import.meta.url), 'utf8'));
const g = buildOsmWorld(net, null, { center: { lat: 36.351406, lon: 127.3867 }, name: '대전 시청역' });
const adj = adjacency(g);
const ctx = {
  speed: 1.2, margin: 2,
  signal: (iid, leg, t) => legState(g.intersections.get(iid).plan, leg, t),
  nextGreen: (iid, leg, t) => nextGreenStart(g.intersections.get(iid).plan, leg, t),
};
const poi = (name) => g.pois.find((p) => p.name === name);

test('둔산로·둔산중로 사거리: 신호 횡단보도 4개가 한 교차로, 방향과 건너는 도로가 맞다', () => {
  const its = [...g.intersections.values()];
  assert.equal(its.length, 1);
  const it = its[0];
  assert.equal(it.name, '둔산중로·둔산로');
  assert.deepEqual(Object.keys(it.legs).sort(), ['et', 'nt', 'st', 'wt']);
  // 둔산중로는 남북, 둔산로는 동서로 뻗는다: 북·남 횡단보도는 둔산중로를, 동·서 횡단보도는 둔산로를 건넌다
  assert.equal(it.legs.nt.across, '둔산중로');
  assert.equal(it.legs.st.across, '둔산중로');
  assert.equal(it.legs.et.across, '둔산로');
  assert.equal(it.legs.wt.across, '둔산로');
  for (const leg of Object.values(it.legs)) assert.ok(leg.length > 15 && leg.length < 30, `${leg.length}`);
  // 북·남 횡단보도의 초록불은 동서 직진 현시, 동·서 횡단보도는 남북 직진 현시
  assert.deepEqual(it.plan.phases[0].ped.sort(), ['nt', 'st']);
  assert.deepEqual(it.plan.phases[2].ped.sort(), ['et', 'wt']);
});

test('시청역 횡단보도 시설: 잔여시간 표시기·음향신호기·보행자 버튼', () => {
  const sig = [...g.crossings.values()].filter((c) => c.kind === 'signals');
  assert.equal(sig.length, 4);
  for (const c of sig) assert.deepEqual([c.features.countdown, c.features.sound, c.features.button, c.features.vibration], [true, true, true, false]);
  const kinds = [...g.crossings.values()].map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['marked', 'signals', 'signals', 'signals', 'signals', 'unmarked']);
});

test('시청역 출입구 1~8번이 출발·도착 후보가 되고 모두 서로 이어진다', () => {
  assert.equal(g.pois.length, 8);
  for (let i = 1; i <= 8; i++) assert.ok(poi(`시청역 ${i}번출구`), `${i}번 출구 없음`);
  const a = poi('시청역 1번출구').node;
  for (const p of g.pois) {
    if (p.node === a) continue;
    const c = compare(g, adj, a, p.node, 0, ctx);
    assert.ok(c, `${p.name} 까지 경로 없음`);
  }
});

test('대각선 출구(1번→5번): 두 번 건너고, 신호를 보면 평균적으로 빨라진다', () => {
  const A = poi('시청역 1번출구').node, B = poi('시청역 5번출구').node;
  let total = 0, n = 0;
  for (let t0 = 0; t0 < 300; t0 += 6) {
    const c = compare(g, adj, A, B, t0, ctx);
    const starts = c.fast.steps.filter((s) => s.kind === 'cross' && s.edge.signal && s.edge.groupEnds.includes(s.from));
    assert.equal(starts.length, 2);
    // 차도 한가운데(횡단보도 중간 노드)에서 기다리는 단계가 없다
    for (const s of c.fast.steps) if (s.kind === 'cross' && !s.edge.groupEnds.includes(s.from)) assert.equal(s.wait, 0);
    assert.ok(c.fast.time <= c.dist.time + 1e-6);
    total += c.saving; n++;
  }
  assert.ok(total / n > 10, `평균 절약 ${total / n}초`);
});

test('경로 평가: 걷기 시간 + 대기 시간 = 총 시간', () => {
  const A = poi('시청역 3번출구').node, B = poi('시청역 8번출구').node;
  const c = compare(g, adj, A, B, 42, ctx);
  const ev = evaluate(g, c.fast.edges, A, 42, ctx);
  assert.ok(Math.abs(ev.walk + ev.wait - ev.time) < 1e-6);
});
