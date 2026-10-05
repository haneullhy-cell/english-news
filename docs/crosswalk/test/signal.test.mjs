import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, legState, nextGreenStart, anchorPlan, pedGreenFor, extrapolate } from '../src/signal.js';

const plan = () => makePlan({
  cycle: 160, offset: 23,
  pedGreen: { nt: 52, st: 52, et: 40, wt: 40 },
  phases: [
    { dur: 55, ped: ['nt', 'st'] }, { dur: 25, ped: [] },
    { dur: 55, ped: ['et', 'wt'] }, { dur: 25, ped: [] },
  ],
});

test('주기와 현시 합이 다르면 거부', () => {
  assert.throws(() => makePlan({ cycle: 100, phases: [{ dur: 60, ped: [] }] }));
});

test('현시 시작 직후는 점등 녹색, 7초 뒤부터 점멸, 녹색이 끝나면 적색', () => {
  const p = plan();
  const t0 = 23; // 주기 시작
  assert.equal(legState(p, 'nt', t0).state, 'green');
  assert.equal(legState(p, 'nt', t0 + 6.9).state, 'green');
  assert.equal(legState(p, 'nt', t0 + 7.1).state, 'flash');
  assert.equal(legState(p, 'nt', t0 + 52.5).state, 'red');
  assert.equal(legState(p, 'et', t0 + 80).state, 'green');
  assert.equal(legState(p, 'et', t0 + 10).state, 'red');
});

test('한 주기 동안 녹색+적색 시간의 합은 주기와 같다', () => {
  const p = plan();
  let green = 0;
  for (let t = 0; t < 160; t += 0.5) if (legState(p, 'wt', t).state !== 'red') green += 0.5;
  assert.equal(green, 40);
});

test('잔여시간은 1초가 지나면 1초 줄어든다', () => {
  const p = plan();
  const a = legState(p, 'st', 100), b = legState(p, 'st', 101);
  assert.equal(a.state, b.state);
  assert.ok(Math.abs(a.remain - 1 - b.remain) < 1e-9);
});

test('적색 잔여시간이 끝나는 시점에 녹색이 켜진다', () => {
  const p = plan();
  for (const t of [0, 23.5, 77, 150, 999.9]) {
    const s = legState(p, 'et', t);
    if (s.state === 'red') {
      const n = nextGreenStart(p, 'et', t);
      assert.ok(Math.abs(n - (t + s.remain)) < 1e-9);
      assert.equal(legState(p, 'et', n + 0.01).state, 'green');
      assert.equal(legState(p, 'et', n - 0.01).state, 'red');
    }
  }
});

test('관측값으로 옵셋을 되찾는다(0.5초 이내)', () => {
  const truth = plan();
  const t = 1234.5;
  const obs = {};
  for (const leg of ['nt', 'et', 'st', 'wt']) obs[leg] = legState(truth, leg, t);
  const guess = { ...truth, offset: 0 };
  const fixed = anchorPlan(guess, obs, t);
  for (const leg of ['nt', 'et', 'st', 'wt']) {
    const a = legState(truth, leg, t + 30), b = legState(fixed, leg, t + 30);
    assert.equal(a.state === 'red', b.state === 'red');
    assert.ok(Math.abs(a.remain - b.remain) <= 0.5);
  }
});

test('보행 녹색 시간은 7초 + 거리/1.0m/s, 현시보다 3초 짧게', () => {
  assert.equal(pedGreenFor(30, 55), 37);
  assert.equal(pedGreenFor(56, 55), 52);
});

test('관측값 외삽: 남은 시간이 지나면 null', () => {
  const o = { state: 'green', remain: 10 };
  assert.equal(extrapolate(o, 100, 104).remain, 6);
  assert.equal(extrapolate(o, 100, 111), null);
});
