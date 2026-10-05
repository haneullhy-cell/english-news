// 교차로 보행 신호의 운영 계획과 상태 계산.
// 시간 단위는 초(실수). 각 교차로는 주기(cycle), 옵셋(offset), 현시 목록(phases)을 가진다.
// 보행 녹색은 해당 현시가 시작될 때 함께 켜지고 pedGreen[leg]초 동안 유지된다.
// 경찰청 기준대로 앞 7초는 점등(green), 나머지는 점멸(flash)로 본다.
export const STEADY_GREEN_SEC = 7;      // 보행 녹색 초기 진입(점등) 시간
export const WALK_DESIGN_SPEED = 1.0;   // 보행신호 시간 산정 기준 속도 m/s

// 횡단 길이(m)와 현시 길이(초)로 보행 녹색 시간을 정한다: 7초 + 횡단거리/1.0m/s, 현시보다 3초 짧게.
export function pedGreenFor(lengthM, phaseDur) {
  const want = Math.round(STEADY_GREEN_SEC + lengthM / WALK_DESIGN_SPEED);
  return Math.max(8, Math.min(phaseDur - 3, want));
}

export function makePlan({ cycle, offset = 0, phases, pedGreen = {} }) {
  const sum = phases.reduce((s, p) => s + p.dur, 0);
  if (Math.abs(sum - cycle) > 1e-6) throw new Error(`주기(${cycle}초)와 현시 합(${sum}초)이 다릅니다`);
  const starts = {};
  let acc = 0;
  for (const p of phases) {
    for (const leg of p.ped) {
      const dur = Math.min(pedGreen[leg] ?? p.dur, p.dur);
      if (!starts[leg]) starts[leg] = [];
      starts[leg].push({ at: acc, dur });
    }
    acc += p.dur;
  }
  return { cycle, offset, phases, pedGreen, starts, legs: Object.keys(starts) };
}

function cyclePos(plan, t) {
  const c = plan.cycle;
  return (((t - plan.offset) % c) + c) % c;
}

// 특정 횡단보도(leg)의 t초 시점 상태: {state:'green'|'flash'|'red', remain}
// remain은 녹색이면 녹색이 끝날 때까지, 적색이면 다음 녹색이 켜질 때까지의 초.
export function legState(plan, leg, t) {
  const T = cyclePos(plan, t);
  for (const g of plan.starts[leg] || []) {
    const e = T - g.at;
    if (e >= 0 && e < g.dur) {
      return { state: e < STEADY_GREEN_SEC ? 'green' : 'flash', remain: g.dur - e, greenDur: g.dur };
    }
  }
  const next = nextGreenStart(plan, leg, t);
  return { state: 'red', remain: next - t };
}

// t 이후(t 자체는 제외) 처음 녹색이 켜지는 절대 시각
export function nextGreenStart(plan, leg, t) {
  const list = plan.starts[leg] || [];
  if (!list.length) return Infinity;
  const T = cyclePos(plan, t);
  let best = Infinity;
  for (const g of list) {
    let d = g.at - T;
    if (d <= 1e-9) d += plan.cycle;
    if (d < best) best = d;
  }
  return t + best;
}

// 실시간 관측값으로 계획의 옵셋을 맞춘다. obs = { leg: {state, remain} } (시각 t에 관측).
// 관측과 가장 잘 맞는 옵셋을 0.5초 간격으로 찾아 돌려준다. 미래 예측(경로 계산)에 쓴다.
export function anchorPlan(plan, obs, t) {
  const legs = Object.keys(obs).filter((l) => plan.starts[l] && obs[l] && obs[l].state !== 'unknown');
  if (!legs.length) return plan;
  let best = { err: Infinity, offset: plan.offset };
  for (let off = 0; off < plan.cycle; off += 0.5) {
    const cand = { ...plan, offset: off };
    let err = 0;
    for (const leg of legs) {
      const o = obs[leg];
      const s = legState(cand, leg, t);
      const sameColor = (o.state === 'red') === (s.state === 'red');
      err += sameColor ? Math.abs((o.remain ?? 0) - s.remain) : 1000;
      if (err >= best.err) break;
    }
    if (err < best.err) best = { err, offset: off };
  }
  return { ...plan, offset: best.offset, anchoredAt: t, anchorError: best.err };
}

// 관측값을 현재 시각으로 외삽한다. 남은 시간이 다 지났으면 null(계획으로 대체).
export function extrapolate(o, tObs, t) {
  if (!o || o.remain == null || o.state === 'unknown') return null;
  const remain = o.remain - (t - tObs);
  if (remain <= 0) return null;
  return { state: o.state, remain, live: true };
}
